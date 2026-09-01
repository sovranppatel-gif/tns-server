import { createActivityLog } from "../activityLog/activityLog.service.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { Faculty } from "../faculty/faculty.model.js";
import { Staff } from "../staff/staff.model.js";
import {
  ADVANCE_RECOVERY_METHODS,
  ADVANCE_STATUSES,
  EMPLOYEE_TYPES,
  LOAN_STATUSES,
  PAYMENT_FREQUENCIES,
  SALARY_STRUCTURE_STATUSES,
  SALARY_TYPES,
  UNIT_SALARY_TYPES,
} from "./finance.constants.js";
import { calculateSalary } from "./finance.calc.js";
import { nextFinanceId } from "./finance.ids.js";
import { EmployeeAdvance, EmployeeLoan, PayrollItem, SalaryStructure } from "./finance.models.js";
import { recordFinancePayment } from "./payments.service.js";
import {
  actorOf,
  asObjectId,
  escapeRegex,
  formatDateLabel,
  httpError,
  money,
  paginationMeta,
  paginationParams,
  parseDate,
  remainingOf,
  str,
  toIsoDate,
} from "./finance.utils.js";

function employeeQuery(id) {
  const oid = asObjectId(id);
  const raw = str(id).toUpperCase();
  return oid ? { $or: [{ _id: oid }, { facultyId: raw }, { staffId: raw }] } : { $or: [{ facultyId: raw }, { staffId: raw }] };
}

export async function loadEmployee(employeeType, employeeId) {
  const type = str(employeeType).toUpperCase();
  if (!EMPLOYEE_TYPES.includes(type)) throw httpError("Employee type must be FACULTY or STAFF", 400);
  const raw = str(employeeId);
  if (!raw) throw httpError("Employee is required", 400);
  if (type === "FACULTY") {
    const oid = asObjectId(raw);
    const doc = await Faculty.findOne({
      softDelete: { $ne: true },
      ...(oid ? { $or: [{ _id: oid }, { facultyId: raw.toUpperCase() }] } : { facultyId: raw.toUpperCase() }),
    }).lean();
    if (!doc) throw httpError("Faculty not found", 404);
    return {
      employeeType: "FACULTY",
      employeeMongoId: doc._id,
      employeeCode: doc.facultyId,
      employeeName: doc.personalDetails?.fullName || "",
      department: doc.employmentDetails?.department || "",
      designation: doc.employmentDetails?.designation || "",
      employmentType: doc.employmentDetails?.employmentType || "",
      status: doc.status,
    };
  }
  const oid = asObjectId(raw);
  const doc = await Staff.findOne({
    softDelete: { $ne: true },
    isArchived: { $ne: true },
    ...(oid ? { $or: [{ _id: oid }, { staffId: raw.toUpperCase() }] } : { staffId: raw.toUpperCase() }),
  }).lean();
  if (!doc) throw httpError("Staff not found", 404);
  return {
    employeeType: "STAFF",
    employeeMongoId: doc._id,
    employeeCode: doc.staffId,
    employeeName: doc.personalDetails?.fullName || "",
    department: doc.employmentDetails?.department || "",
    designation: doc.employmentDetails?.designation || "",
    employmentType: doc.employmentDetails?.employmentType || "",
    monthlySalary: Number(doc.employmentDetails?.monthlySalary) || 0,
    status: doc.status,
  };
}

export async function listFinanceEmployees(params = {}) {
  const type = str(params.type || params.employeeType).toUpperCase();
  const search = str(params.search);
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
  const rx = search ? new RegExp(escapeRegex(search), "i") : null;

  if (type === "STAFF") {
    const query = { softDelete: { $ne: true }, isArchived: { $ne: true } };
    if (params.status) query.status = params.status;
    if (rx) {
      query.$or = [
        { staffId: rx },
        { "personalDetails.fullName": rx },
        { "employmentDetails.designation": rx },
        { "employmentDetails.department": rx },
      ];
    }
    const rows = await Staff.find(query).sort({ "personalDetails.fullName": 1 }).limit(limit).lean();
    const ids = rows.map((r) => r._id);
    const structures = await SalaryStructure.find({
      employeeType: "STAFF",
      employeeMongoId: { $in: ids },
      status: "Active",
    })
      .select("employeeMongoId structureId netSalary salaryType")
      .lean();
    const map = new Map(structures.map((s) => [String(s.employeeMongoId), s]));
    return rows.map((r) => {
      const s = map.get(String(r._id));
      return {
        employeeType: "STAFF",
        employeeMongoId: String(r._id),
        employeeId: r.staffId,
        employeeCode: r.staffId,
        fullName: r.personalDetails?.fullName || "",
        department: r.employmentDetails?.department || "",
        designation: r.employmentDetails?.designation || "",
        employmentType: r.employmentDetails?.employmentType || "",
        status: r.status,
        suggestedSalary: Number(r.employmentDetails?.monthlySalary) || 0,
        hasSalaryStructure: Boolean(s),
        structureId: s?.structureId || "",
        netSalary: s?.netSalary || 0,
        salaryType: s?.salaryType || "",
      };
    });
  }

  const query = { softDelete: { $ne: true } };
  if (params.status) query.status = params.status;
  if (rx) {
    query.$or = [
      { facultyId: rx },
      { "personalDetails.fullName": rx },
      { "employmentDetails.designation": rx },
      { "employmentDetails.department": rx },
    ];
  }
  const rows = await Faculty.find(type === "FACULTY" ? query : query)
    .sort({ "personalDetails.fullName": 1 })
    .limit(limit)
    .lean();
  const ids = rows.map((r) => r._id);
  const structures = await SalaryStructure.find({
    employeeType: "FACULTY",
    employeeMongoId: { $in: ids },
    status: "Active",
  })
    .select("employeeMongoId structureId netSalary salaryType")
    .lean();
  const map = new Map(structures.map((s) => [String(s.employeeMongoId), s]));
  return rows.map((r) => {
    const s = map.get(String(r._id));
    return {
      employeeType: "FACULTY",
      employeeMongoId: String(r._id),
      employeeId: r.facultyId,
      employeeCode: r.facultyId,
      fullName: r.personalDetails?.fullName || "",
      department: r.employmentDetails?.department || "",
      designation: r.employmentDetails?.designation || "",
      employmentType: r.employmentDetails?.employmentType || "",
      status: r.status,
      suggestedSalary: 0,
      hasSalaryStructure: Boolean(s),
      structureId: s?.structureId || "",
      netSalary: s?.netSalary || 0,
      salaryType: s?.salaryType || "",
    };
  });
}

function toStructureRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.structureId,
    structureId: d.structureId,
    employeeType: d.employeeType,
    employeeMongoId: String(d.employeeMongoId),
    employeeCode: d.employeeCode,
    employeeName: d.employeeName,
    employee: d.employeeName,
    department: d.department,
    designation: d.designation,
    employmentType: d.employmentType,
    salaryType: d.salaryType,
    paymentFrequency: d.paymentFrequency,
    effectiveFrom: toIsoDate(d.effectiveFrom),
    effectiveFromLabel: formatDateLabel(d.effectiveFrom),
    effectiveTo: toIsoDate(d.effectiveTo),
    effectiveToLabel: d.effectiveTo ? formatDateLabel(d.effectiveTo) : "Present",
    earnings: d.earnings || [],
    deductions: d.deductions || [],
    basicSalary: money(d.basicSalary),
    unitRate: money(d.unitRate),
    totalAllowances: money(d.totalAllowances),
    totalIncentives: money(d.totalIncentives),
    bonus: money(d.bonus),
    totalDeductions: money(d.totalDeductions),
    grossSalary: money(d.grossSalary),
    netSalary: money(d.netSalary),
    status: d.status,
    revisedFrom: d.revisedFrom || "",
    notes: d.notes || "",
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: d.createdAt,
  };
}

async function overlappingActive(employeeType, employeeMongoId, from, to, excludeId) {
  const query = {
    employeeType,
    employeeMongoId,
    status: { $in: ["Active", "Draft"] },
    effectiveFrom: { $lte: to || new Date(2999, 0, 1) },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
  };
  if (excludeId) query._id = { $ne: excludeId };
  return SalaryStructure.findOne(query);
}

function buildComputed(payload) {
  const salaryType = SALARY_TYPES.includes(payload.salaryType) ? payload.salaryType : "Monthly Fixed";
  const basic = money(payload.basicSalary);
  const unitRate = money(payload.unitRate != null ? payload.unitRate : basic);
  const computed = calculateSalary({
    basicSalary: basic,
    earnings: payload.earnings || [],
    deductions: payload.deductions || [],
  });
  if (UNIT_SALARY_TYPES.has(salaryType)) {
    computed.unitRate = unitRate || basic;
    computed.netSalary = computed.unitRate;
    computed.grossSalary = computed.unitRate;
    computed.basicSalary = computed.unitRate;
  } else {
    computed.unitRate = 0;
  }
  return { salaryType, computed };
}

export async function listSalaryStructures(params = {}) {
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.employeeType && EMPLOYEE_TYPES.includes(str(params.employeeType).toUpperCase())) {
    query.employeeType = str(params.employeeType).toUpperCase();
  }
  if (params.status && SALARY_STRUCTURE_STATUSES.includes(params.status)) query.status = params.status;
  if (params.salaryType && SALARY_TYPES.includes(params.salaryType)) query.salaryType = params.salaryType;
  if (params.department) query.department = str(params.department);
  if (params.designation) query.designation = str(params.designation);
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ employeeName: rx }, { employeeCode: rx }, { structureId: rx }, { designation: rx }];
  }
  const [rows, total] = await Promise.all([
    SalaryStructure.find(query).sort({ effectiveFrom: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    SalaryStructure.countDocuments(query),
  ]);
  return { rows: rows.map(toStructureRow), pagination: paginationMeta(page, limit, total) };
}

async function findStructureDoc(id) {
  const oid = asObjectId(id);
  return SalaryStructure.findOne(oid ? { $or: [{ _id: oid }, { structureId: str(id) }] } : { structureId: str(id) });
}

export async function getSalaryStructure(id) {
  const doc = await findStructureDoc(id);
  if (!doc) return null;
  const history = await SalaryStructure.find({
    employeeType: doc.employeeType,
    employeeMongoId: doc.employeeMongoId,
  })
    .sort({ effectiveFrom: -1 })
    .lean();
  return { ...toStructureRow(doc), history: history.map(toStructureRow) };
}

export async function createSalaryStructure(payload = {}, editor = "master-admin") {
  const emp = await loadEmployee(payload.employeeType, payload.employeeId || payload.employeeMongoId || payload.employeeCode);
  const effectiveFrom = parseDate(payload.effectiveFrom, new Date());
  const effectiveTo = parseDate(payload.effectiveTo);
  if (effectiveTo && effectiveTo < effectiveFrom) throw httpError("Effective to cannot be before effective from", 400);
  const clash = await overlappingActive(emp.employeeType, emp.employeeMongoId, effectiveFrom, effectiveTo);
  if (clash) {
    throw httpError(
      `An active salary structure (${clash.structureId}) already covers this period. Revise it instead of creating a duplicate.`,
      409
    );
  }
  const { salaryType, computed } = buildComputed(payload);
  const structureId = await nextFinanceId("sal", "SAL-", 4);
  const doc = await SalaryStructure.create({
    structureId,
    ...emp,
    salaryType,
    paymentFrequency: PAYMENT_FREQUENCIES.includes(payload.paymentFrequency) ? payload.paymentFrequency : "Monthly",
    effectiveFrom,
    effectiveTo,
    earnings: computed.earnings,
    deductions: computed.deductions,
    basicSalary: computed.basicSalary,
    unitRate: computed.unitRate || 0,
    totalAllowances: computed.totalAllowances,
    totalIncentives: computed.totalIncentives,
    bonus: computed.bonus,
    totalDeductions: computed.totalDeductions,
    grossSalary: computed.grossSalary,
    netSalary: computed.netSalary,
    status: payload.status === "Draft" ? "Draft" : "Active",
    notes: str(payload.notes),
    createdBy: actorOf(editor),
    updatedBy: actorOf(editor),
  });
  await createActivityLog({
    section: "Salary Management",
    action: "create",
    message: `Created salary structure ${doc.structureId} for ${doc.employeeName}`,
    actor: actorOf(editor),
    resourceId: doc.structureId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Salary Management", action: "create", resourceId: doc.structureId });
  return toStructureRow(doc);
}

export async function updateSalaryStructure(id, payload = {}, editor = "master-admin") {
  const doc = await findStructureDoc(id);
  if (!doc) throw httpError("Salary structure not found", 404);
  const payrollExists = await PayrollItem.exists({
    employeeType: doc.employeeType,
    employeeMongoId: doc.employeeMongoId,
    status: { $nin: ["Cancelled"] },
    "snapshot.structureId": doc.structureId,
  });
  if (payrollExists && payload.force !== true) {
    throw httpError("This structure already has payroll. Use Revise to keep history.", 409);
  }
  if (payload.effectiveFrom) doc.effectiveFrom = parseDate(payload.effectiveFrom, doc.effectiveFrom);
  if (payload.effectiveTo !== undefined) doc.effectiveTo = parseDate(payload.effectiveTo);
  if (doc.effectiveTo && doc.effectiveTo < doc.effectiveFrom) {
    throw httpError("Effective to cannot be before effective from", 400);
  }
  const clash = await overlappingActive(doc.employeeType, doc.employeeMongoId, doc.effectiveFrom, doc.effectiveTo, doc._id);
  if (clash) throw httpError(`Overlaps existing structure ${clash.structureId}`, 409);
  if (payload.salaryType || payload.earnings || payload.deductions || payload.basicSalary != null || payload.unitRate != null) {
    const { salaryType, computed } = buildComputed({
      salaryType: payload.salaryType || doc.salaryType,
      basicSalary: payload.basicSalary != null ? payload.basicSalary : doc.basicSalary,
      unitRate: payload.unitRate != null ? payload.unitRate : doc.unitRate,
      earnings: payload.earnings || doc.earnings,
      deductions: payload.deductions || doc.deductions,
    });
    doc.salaryType = salaryType;
    doc.earnings = computed.earnings;
    doc.deductions = computed.deductions;
    doc.basicSalary = computed.basicSalary;
    doc.unitRate = computed.unitRate || 0;
    doc.totalAllowances = computed.totalAllowances;
    doc.totalIncentives = computed.totalIncentives;
    doc.bonus = computed.bonus;
    doc.totalDeductions = computed.totalDeductions;
    doc.grossSalary = computed.grossSalary;
    doc.netSalary = computed.netSalary;
  }
  if (payload.paymentFrequency && PAYMENT_FREQUENCIES.includes(payload.paymentFrequency)) {
    doc.paymentFrequency = payload.paymentFrequency;
  }
  if (payload.status && SALARY_STRUCTURE_STATUSES.includes(payload.status)) doc.status = payload.status;
  if (payload.notes != null) doc.notes = str(payload.notes);
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toStructureRow(doc);
}

export async function reviseSalaryStructure(id, payload = {}, editor = "master-admin") {
  const current = await findStructureDoc(id);
  if (!current) throw httpError("Salary structure not found", 404);
  const effectiveFrom = parseDate(payload.effectiveFrom, new Date());
  const dayBefore = new Date(effectiveFrom);
  dayBefore.setDate(dayBefore.getDate() - 1);
  current.effectiveTo = dayBefore;
  current.status = "Superseded";
  current.updatedBy = actorOf(editor);
  await current.save();

  const created = await createSalaryStructure(
    {
      ...payload,
      employeeType: current.employeeType,
      employeeId: String(current.employeeMongoId),
      effectiveFrom,
    },
    editor
  );
  await SalaryStructure.updateOne({ structureId: created.structureId }, { $set: { revisedFrom: current.structureId } });
  await createActivityLog({
    section: "Salary Management",
    action: "revise",
    message: `Revised salary for ${current.employeeName}: ${current.structureId} → ${created.structureId}`,
    actor: actorOf(editor),
    resourceId: created.structureId,
  }).catch(() => {});
  return getSalaryStructure(created.structureId);
}

export async function getSalaryOverview() {
  const [facultyTotal, staffTotal, activeStructures, drafts, facultyStructs, staffStructs, upcoming] = await Promise.all([
    Faculty.countDocuments({ softDelete: false, status: "Active" }),
    Staff.countDocuments({ softDelete: { $ne: true }, isArchived: { $ne: true }, status: "Active" }),
    SalaryStructure.countDocuments({ status: "Active" }),
    SalaryStructure.countDocuments({ status: "Draft" }),
    SalaryStructure.aggregate([
      { $match: { status: "Active", employeeType: "FACULTY", salaryType: "Monthly Fixed" } },
      { $group: { _id: null, total: { $sum: "$netSalary" }, count: { $sum: 1 } } },
    ]),
    SalaryStructure.aggregate([
      { $match: { status: "Active", employeeType: "STAFF", salaryType: "Monthly Fixed" } },
      { $group: { _id: null, total: { $sum: "$netSalary" }, count: { $sum: 1 } } },
    ]),
    SalaryStructure.find({
      status: "Active",
      effectiveFrom: { $gt: new Date() },
    })
      .sort({ effectiveFrom: 1 })
      .limit(8)
      .lean(),
  ]);
  const monthlyLiability = (facultyStructs[0]?.total || 0) + (staffStructs[0]?.total || 0);
  return {
    totalActiveEmployees: facultyTotal + staffTotal,
    faculty: facultyTotal,
    staff: staffTotal,
    activeStructures,
    pendingSalaryStructures: drafts,
    monthlySalaryLiability: monthlyLiability,
    facultyMonthlyLiability: facultyStructs[0]?.total || 0,
    staffMonthlyLiability: staffStructs[0]?.total || 0,
    upcomingRevisions: upcoming.map(toStructureRow),
  };
}

function toAdvanceRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.advanceId,
    advanceId: d.advanceId,
    employeeType: d.employeeType,
    employeeMongoId: String(d.employeeMongoId),
    employeeCode: d.employeeCode,
    employeeName: d.employeeName,
    amount: money(d.amount),
    date: toIsoDate(d.date),
    dateLabel: formatDateLabel(d.date),
    reason: d.reason || "",
    recoveryMethod: d.recoveryMethod,
    monthlyRecoveryAmount: money(d.monthlyRecoveryAmount),
    recoveredAmount: money(d.recoveredAmount),
    remainingAmount: money(d.remainingAmount),
    status: d.status,
    notes: d.notes || "",
    createdBy: d.createdBy,
  };
}

function toLoanRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.loanId,
    loanId: d.loanId,
    employeeType: d.employeeType,
    employeeMongoId: String(d.employeeMongoId),
    employeeCode: d.employeeCode,
    employeeName: d.employeeName,
    amount: money(d.amount),
    issueDate: toIsoDate(d.issueDate),
    issueDateLabel: formatDateLabel(d.issueDate),
    emiAmount: money(d.emiAmount),
    recoveredAmount: money(d.recoveredAmount),
    remainingAmount: money(d.remainingAmount),
    status: d.status,
    notes: d.notes || "",
    createdBy: d.createdBy,
  };
}

export async function listAdvances(params = {}) {
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.employeeType && EMPLOYEE_TYPES.includes(str(params.employeeType).toUpperCase())) {
    query.employeeType = str(params.employeeType).toUpperCase();
  }
  if (params.status && ADVANCE_STATUSES.includes(params.status)) query.status = params.status;
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ employeeName: rx }, { employeeCode: rx }, { advanceId: rx }, { reason: rx }];
  }
  const [rows, total] = await Promise.all([
    EmployeeAdvance.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
    EmployeeAdvance.countDocuments(query),
  ]);
  return { rows: rows.map(toAdvanceRow), pagination: paginationMeta(page, limit, total) };
}

export async function createAdvance(payload = {}, editor = "master-admin") {
  const emp = await loadEmployee(payload.employeeType, payload.employeeId || payload.employeeMongoId);
  const amount = money(payload.amount);
  if (amount <= 0) throw httpError("Advance amount must be greater than 0", 400);
  const recoveryMethod = ADVANCE_RECOVERY_METHODS.includes(payload.recoveryMethod)
    ? payload.recoveryMethod
    : "Installments";
  const monthly = recoveryMethod === "Full" ? amount : money(payload.monthlyRecoveryAmount);
  if (recoveryMethod === "Installments" && monthly <= 0) {
    throw httpError("Monthly recovery amount is required for installment recovery", 400);
  }
  const advanceId = await nextFinanceId("adv", "ADV-", 4);
  const doc = await EmployeeAdvance.create({
    advanceId,
    ...emp,
    amount,
    date: parseDate(payload.date, new Date()),
    reason: str(payload.reason),
    recoveryMethod,
    monthlyRecoveryAmount: monthly,
    recoveredAmount: 0,
    remainingAmount: amount,
    status: "Active",
    notes: str(payload.notes),
    createdBy: actorOf(editor),
    updatedBy: actorOf(editor),
  });
  if (payload.disburse === true || payload.disburse === "1") {
    await recordFinancePayment({
      direction: "OUT",
      sourceType: "ADVANCE",
      sourceId: `${advanceId}:disburse`,
      action: "advance",
      partyType: emp.employeeType,
      partyId: emp.employeeCode,
      partyName: emp.employeeName,
      amount,
      method: payload.method || "Cash",
      financialAccountCode: payload.financialAccountCode,
      date: doc.date,
      notes: doc.reason,
      editor,
      expenseAccountCode: "1210",
    }).catch((err) => console.error("advance disbursement post failed:", err?.message || err));
  }
  return toAdvanceRow(doc);
}

export async function listLoans(params = {}) {
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.employeeType && EMPLOYEE_TYPES.includes(str(params.employeeType).toUpperCase())) {
    query.employeeType = str(params.employeeType).toUpperCase();
  }
  if (params.status && LOAN_STATUSES.includes(params.status)) query.status = params.status;
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ employeeName: rx }, { employeeCode: rx }, { loanId: rx }];
  }
  const [rows, total] = await Promise.all([
    EmployeeLoan.find(query).sort({ issueDate: -1 }).skip(skip).limit(limit).lean(),
    EmployeeLoan.countDocuments(query),
  ]);
  return { rows: rows.map(toLoanRow), pagination: paginationMeta(page, limit, total) };
}

export async function createLoan(payload = {}, editor = "master-admin") {
  const emp = await loadEmployee(payload.employeeType, payload.employeeId || payload.employeeMongoId);
  const amount = money(payload.amount);
  if (amount <= 0) throw httpError("Loan amount must be greater than 0", 400);
  const emi = money(payload.emiAmount || payload.emi);
  if (emi <= 0) throw httpError("EMI / installment amount is required", 400);
  const loanId = await nextFinanceId("loan", "LN-", 4);
  const doc = await EmployeeLoan.create({
    loanId,
    ...emp,
    amount,
    issueDate: parseDate(payload.issueDate || payload.date, new Date()),
    emiAmount: emi,
    recoveredAmount: 0,
    remainingAmount: amount,
    status: "Active",
    notes: str(payload.notes),
    createdBy: actorOf(editor),
    updatedBy: actorOf(editor),
  });
  if (payload.disburse === true || payload.disburse === "1") {
    await recordFinancePayment({
      direction: "OUT",
      sourceType: "LOAN",
      sourceId: `${loanId}:disburse`,
      action: "loan",
      partyType: emp.employeeType,
      partyId: emp.employeeCode,
      partyName: emp.employeeName,
      amount,
      method: payload.method || "Bank Transfer",
      financialAccountCode: payload.financialAccountCode,
      date: doc.issueDate,
      notes: doc.notes,
      editor,
      expenseAccountCode: "1210",
    }).catch((err) => console.error("loan disbursement post failed:", err?.message || err));
  }
  return toLoanRow(doc);
}

export async function recoverAdvance(advance, amount) {
  const take = Math.min(money(amount), money(advance.remainingAmount));
  advance.recoveredAmount = money(advance.recoveredAmount) + take;
  advance.remainingAmount = remainingOf(advance.amount, advance.recoveredAmount);
  if (advance.remainingAmount <= 0) advance.status = "Closed";
  await advance.save();
  return take;
}

export async function recoverLoan(loan, amount) {
  const take = Math.min(money(amount), money(loan.remainingAmount));
  loan.recoveredAmount = money(loan.recoveredAmount) + take;
  loan.remainingAmount = remainingOf(loan.amount, loan.recoveredAmount);
  if (loan.remainingAmount <= 0) loan.status = "Closed";
  await loan.save();
  return take;
}

export { toStructureRow, toAdvanceRow, toLoanRow, employeeQuery };
