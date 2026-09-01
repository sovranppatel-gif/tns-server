import { createActivityLog } from "../activityLog/activityLog.service.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { Faculty } from "../faculty/faculty.model.js";
import { FacultyAttendance } from "../faculty/facultyAttendance.model.js";
import { Staff } from "../staff/staff.model.js";
import {
  EMPLOYEE_TYPES,
  PAYMENT_METHODS,
  PAYROLL_ADJUSTMENT_TYPES,
  PAYROLL_STATUSES,
  UNIT_SALARY_TYPES,
} from "./finance.constants.js";
import { calculatePayroll } from "./finance.calc.js";
import { nextFinanceId } from "./finance.ids.js";
import {
  EmployeeAdvance,
  EmployeeLoan,
  FinancePayment,
  PayrollItem,
  PayrollRun,
  SalaryStructure,
} from "./finance.models.js";
import { recordFinancePayment } from "./payments.service.js";
import { recoverAdvance, recoverLoan } from "./salary.service.js";
import {
  actorOf,
  asObjectId,
  escapeRegex,
  formatDateLabel,
  httpError,
  money,
  monthBounds,
  monthLabel,
  paginationMeta,
  paginationParams,
  parseDate,
  paymentStatusFromAmounts,
  remainingOf,
  str,
  toIsoDate,
} from "./finance.utils.js";

function toRunRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.runId,
    runId: d.runId,
    month: d.month,
    year: d.year,
    period: monthLabel(d.year, d.month),
    employeeType: d.employeeType,
    universityId: d.universityId ? String(d.universityId) : "",
    universityName: d.universityName || "",
    status: d.status,
    totals: d.totals || {},
    generatedBy: d.generatedBy,
    approvedBy: d.approvedBy || "",
    notes: d.notes || "",
    createdAt: d.createdAt,
  };
}

function toItemRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.itemId,
    itemId: d.itemId,
    runId: d.runId,
    runMongoId: String(d.runMongoId),
    month: d.month,
    year: d.year,
    period: monthLabel(d.year, d.month),
    employeeType: d.employeeType,
    employeeMongoId: String(d.employeeMongoId),
    employeeCode: d.employeeCode,
    employee: d.snapshot?.name || d.employeeCode,
    department: d.snapshot?.department || "",
    designation: d.snapshot?.designation || "",
    salaryType: d.snapshot?.salaryType || "",
    structureId: d.snapshot?.structureId || "",
    basicSalary: money(d.basicSalary),
    totalAllowances: money(d.totalAllowances),
    allowances: money(d.totalAllowances),
    incentives: money(d.incentives),
    bonus: money(d.bonus),
    overtime: money(d.overtime),
    reimbursement: money(d.reimbursement),
    otherEarnings: money(d.otherEarnings),
    structureDeductions: money(d.structureDeductions),
    otherDeductions: money(d.otherDeductions),
    advanceRecovery: money(d.advanceRecovery),
    loanRecovery: money(d.loanRecovery),
    leaveDeduction: money(d.leaveDeduction),
    deductions: money(d.totalDeductions),
    totalDeductions: money(d.totalDeductions),
    grossSalary: money(d.grossSalary),
    netPayable: money(d.netPayable),
    paidAmount: money(d.paidAmount),
    outstanding: remainingOf(d.netPayable, d.paidAmount),
    unitsWorked: d.unitsWorked || 0,
    unitRate: money(d.unitRate),
    attendanceSummary: d.attendanceSummary || {},
    adjustments: d.adjustments || [],
    status: d.status,
    paymentStatus: paymentStatusFromAmounts(d.netPayable, d.paidAmount),
    paymentMethod: d.paymentMethod || "",
    paidAt: d.paidAt,
    createdBy: d.createdBy,
    approvedBy: d.approvedBy || "",
  };
}

async function findRun(id) {
  const oid = asObjectId(id);
  return PayrollRun.findOne(oid ? { $or: [{ _id: oid }, { runId: str(id) }] } : { runId: str(id) });
}

async function findItem(id) {
  const oid = asObjectId(id);
  return PayrollItem.findOne(oid ? { $or: [{ _id: oid }, { itemId: str(id) }] } : { itemId: str(id) });
}

async function refreshRunTotals(run) {
  const items = await PayrollItem.find({ runMongoId: run._id, status: { $ne: "Cancelled" } }).lean();
  const totals = {
    employees: items.length,
    processed: items.filter((i) => ["Approved", "Partially Paid", "Paid"].includes(i.status)).length,
    pending: items.filter((i) => !["Paid", "Cancelled"].includes(i.status)).length,
    gross: items.reduce((s, i) => s + (Number(i.grossSalary) || 0), 0),
    deductions: items.reduce((s, i) => s + (Number(i.totalDeductions) || 0), 0),
    net: items.reduce((s, i) => s + (Number(i.netPayable) || 0), 0),
    paid: items.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0),
  };
  run.totals = totals;
  const allPaid = items.length > 0 && items.every((i) => i.status === "Paid");
  const anyPaid = items.some((i) => money(i.paidAmount) > 0);
  if (run.status !== "Cancelled") {
    if (allPaid) run.status = "Paid";
    else if (anyPaid) run.status = "Partially Paid";
  }
  await run.save();
  return run;
}

async function facultyAttendanceSummary(facultyMongoId, year, month) {
  const { from, to } = monthBounds(year, month);
  const rows = await FacultyAttendance.find({
    facultyMongoId,
    date: { $gte: from, $lt: to },
  }).lean();
  const summary = { present: 0, absent: 0, leave: 0, late: 0, note: "" };
  for (const row of rows) {
    const st = str(row.status);
    if (st === "Present") summary.present += 1;
    else if (st === "Absent") summary.absent += 1;
    else if (st === "Leave") summary.leave += 1;
    else if (st === "Late") {
      summary.late += 1;
      summary.present += 1;
    }
  }
  if (!rows.length) {
    summary.note = "No faculty attendance records for this month. Unit-based pay requires a manual units value.";
  }
  return summary;
}

function structureForDate(structures, date) {
  const t = date.getTime();
  return structures.find((s) => {
    const from = new Date(s.effectiveFrom).getTime();
    const to = s.effectiveTo ? new Date(s.effectiveTo).getTime() : Number.MAX_SAFE_INTEGER;
    return from <= t && t <= to && s.status !== "Draft";
  });
}

async function dueRecoveries(employeeType, employeeMongoId) {
  const [advances, loans] = await Promise.all([
    EmployeeAdvance.find({ employeeType, employeeMongoId, status: "Active", remainingAmount: { $gt: 0 } }),
    EmployeeLoan.find({ employeeType, employeeMongoId, status: "Active", remainingAmount: { $gt: 0 } }),
  ]);
  let advanceRecovery = 0;
  let loanRecovery = 0;
  const advanceDocs = [];
  const loanDocs = [];
  for (const adv of advances) {
    const take =
      adv.recoveryMethod === "Full"
        ? money(adv.remainingAmount)
        : Math.min(money(adv.monthlyRecoveryAmount) || money(adv.remainingAmount), money(adv.remainingAmount));
    advanceRecovery += take;
    advanceDocs.push({ doc: adv, take });
  }
  for (const loan of loans) {
    const take = Math.min(money(loan.emiAmount) || money(loan.remainingAmount), money(loan.remainingAmount));
    loanRecovery += take;
    loanDocs.push({ doc: loan, take });
  }
  return { advanceRecovery, loanRecovery, advanceDocs, loanDocs };
}

async function loadActiveEmployees(employeeType) {
  if (employeeType === "STAFF") {
    return Staff.find({ softDelete: { $ne: true }, isArchived: { $ne: true }, status: { $in: ["Active", "On Leave"] } }).lean();
  }
  return Faculty.find({ softDelete: false, status: "Active" }).lean();
}

export async function generatePayroll(payload = {}, editor = "master-admin") {
  const month = Number(payload.month);
  const year = Number(payload.year);
  if (!month || month < 1 || month > 12) throw httpError("Payroll month is required (1-12)", 400);
  if (!year || year < 2000) throw httpError("Payroll year is required", 400);
  const typeRaw = str(payload.employeeType).toUpperCase() || "ALL";
  const types = typeRaw === "ALL" || !typeRaw ? ["FACULTY", "STAFF"] : [typeRaw];
  if (types.some((t) => !EMPLOYEE_TYPES.includes(t))) throw httpError("Employee type must be FACULTY, STAFF or ALL", 400);

  const selectedIds = Array.isArray(payload.employeeIds)
    ? payload.employeeIds.map((id) => str(id)).filter(Boolean)
    : [];
  const unitsMap = payload.units && typeof payload.units === "object" ? payload.units : {};

  let run = null;
  if (payload.runId) {
    run = await findRun(payload.runId);
  }
  if (!run) {
    run = await PayrollRun.findOne({
      month,
      year,
      employeeType: typeRaw,
      status: { $ne: "Cancelled" },
    });
  }
  if (!run) {
    const runId = await nextFinanceId("prun", "PR-", 4);
    run = await PayrollRun.create({
      runId,
      month,
      year,
      employeeType: typeRaw,
      universityId: asObjectId(payload.universityId),
      status: "Generated",
      generatedBy: actorOf(editor),
      notes: str(payload.notes),
    });
  }

  const periodDate = new Date(year, month - 1, 15);
  const created = [];
  const skipped = [];

  for (const employeeType of types) {
    const employees = await loadActiveEmployees(employeeType);
    const mongoIds = employees.map((e) => e._id);
    const structures = await SalaryStructure.find({
      employeeType,
      employeeMongoId: { $in: mongoIds },
      status: { $in: ["Active", "Superseded"] },
    }).lean();
    const byEmp = new Map();
    for (const s of structures) {
      const key = String(s.employeeMongoId);
      if (!byEmp.has(key)) byEmp.set(key, []);
      byEmp.get(key).push(s);
    }

    for (const emp of employees) {
      const code = employeeType === "FACULTY" ? emp.facultyId : emp.staffId;
      const mongoId = emp._id;
      if (selectedIds.length) {
        const match =
          selectedIds.includes(String(mongoId)) ||
          selectedIds.includes(code) ||
          selectedIds.includes(code?.toUpperCase());
        if (!match) continue;
      }

      const existing = await PayrollItem.findOne({
        employeeType,
        employeeMongoId: mongoId,
        month,
        year,
        status: { $ne: "Cancelled" },
      });
      if (existing) {
        skipped.push({ employeeCode: code, reason: "Payroll already exists for this month" });
        continue;
      }

      const list = (byEmp.get(String(mongoId)) || []).sort(
        (a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom)
      );
      const structure = structureForDate(list, periodDate);
      if (!structure) {
        skipped.push({ employeeCode: code, reason: "No salary structure covering this month" });
        continue;
      }

      const attendance =
        employeeType === "FACULTY"
          ? await facultyAttendanceSummary(mongoId, year, month)
          : { present: 0, absent: 0, leave: 0, late: 0, note: "Staff attendance is not available yet. Daily/hourly pay needs a manual units value." };

      const unitKey = `${employeeType}:${code}`;
      const unitKey2 = `${employeeType}:${mongoId}`;
      let unitsWorked = Number(unitsMap[unitKey] ?? unitsMap[unitKey2] ?? unitsMap[code] ?? 0) || 0;
      if (UNIT_SALARY_TYPES.has(structure.salaryType) && unitsWorked <= 0) {
        if (structure.salaryType === "Per Day" || structure.salaryType === "Daily Wage") {
          unitsWorked = attendance.present || 0;
        }
      }

      const recoveries = await dueRecoveries(employeeType, mongoId);
      const calc = calculatePayroll({
        salaryType: structure.salaryType,
        structure,
        unitsWorked,
        adjustments: [],
        advanceRecovery: recoveries.advanceRecovery,
        loanRecovery: recoveries.loanRecovery,
        leaveDeduction: 0,
      });

      if (UNIT_SALARY_TYPES.has(structure.salaryType) && unitsWorked <= 0) {
        calc.netPayable = 0;
        calc.grossSalary = 0;
        calc.basicSalary = 0;
      }

      const itemId = await nextFinanceId("pitm", "PS-", 5);
      try {
        const item = await PayrollItem.create({
          itemId,
          runMongoId: run._id,
          runId: run.runId,
          month,
          year,
          employeeType,
          employeeMongoId: mongoId,
          employeeCode: code,
          snapshot: {
            name: emp.personalDetails?.fullName || "",
            department: emp.employmentDetails?.department || "",
            designation: emp.employmentDetails?.designation || "",
            employmentType: emp.employmentDetails?.employmentType || "",
            salaryType: structure.salaryType,
            structureId: structure.structureId,
          },
          ...calc,
          attendanceSummary: attendance,
          adjustments: [],
          status: "Generated",
          createdBy: actorOf(editor),
          updatedBy: actorOf(editor),
        });
        created.push(toItemRow(item));
      } catch (err) {
        if (err?.code === 11000) {
          skipped.push({ employeeCode: code, reason: "Duplicate payroll for this month" });
          continue;
        }
        throw err;
      }
    }
  }

  await refreshRunTotals(run);
  await createActivityLog({
    section: "Payroll",
    action: "generate",
    message: `Generated payroll ${run.runId} for ${monthLabel(year, month)} (${created.length} employees)`,
    actor: actorOf(editor),
    resourceId: run.runId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Payroll", action: "generate", resourceId: run.runId });

  if (!created.length && skipped.length) {
    const onlyDup = skipped.every((s) => /already exists|Duplicate/i.test(s.reason));
    if (onlyDup) throw httpError("Payroll already generated for the selected employees and month", 409);
  }

  return {
    run: toRunRow(run),
    createdCount: created.length,
    skippedCount: skipped.length,
    skipped,
    rows: created,
  };
}

export async function listPayrollRuns(params = {}) {
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.year) query.year = Number(params.year);
  if (params.month) query.month = Number(params.month);
  if (params.employeeType && params.employeeType !== "ALL") query.employeeType = str(params.employeeType).toUpperCase();
  if (params.status && PAYROLL_STATUSES.includes(params.status)) query.status = params.status;
  const [rows, total] = await Promise.all([
    PayrollRun.find(query).sort({ year: -1, month: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    PayrollRun.countDocuments(query),
  ]);
  return { rows: rows.map(toRunRow), pagination: paginationMeta(page, limit, total) };
}

export async function listPayrollItems(params = {}) {
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.runId) {
    const run = await findRun(params.runId);
    if (run) query.runMongoId = run._id;
    else query.runId = str(params.runId);
  }
  if (params.year) query.year = Number(params.year);
  if (params.month) query.month = Number(params.month);
  if (params.employeeType && EMPLOYEE_TYPES.includes(str(params.employeeType).toUpperCase())) {
    query.employeeType = str(params.employeeType).toUpperCase();
  }
  if (params.status && PAYROLL_STATUSES.includes(params.status)) query.status = params.status;
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ employeeCode: rx }, { itemId: rx }, { "snapshot.name": rx }, { "snapshot.designation": rx }];
  }
  const [rows, total] = await Promise.all([
    PayrollItem.find(query).sort({ year: -1, month: -1, "snapshot.name": 1 }).skip(skip).limit(limit).lean(),
    PayrollItem.countDocuments(query),
  ]);
  return { rows: rows.map(toItemRow), pagination: paginationMeta(page, limit, total) };
}

export async function getPayrollItem(id) {
  const doc = await findItem(id);
  return doc ? toItemRow(doc) : null;
}

export async function getPayrollRun(id) {
  const run = await findRun(id);
  if (!run) return null;
  const items = await PayrollItem.find({ runMongoId: run._id }).sort({ "snapshot.name": 1 }).lean();
  return { ...toRunRow(run), items: items.map(toItemRow) };
}

export async function addPayrollAdjustment(id, payload = {}, editor = "master-admin") {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  if (["Paid", "Cancelled"].includes(doc.status)) throw httpError("Cannot adjust a paid or cancelled payroll", 400);
  const type = PAYROLL_ADJUSTMENT_TYPES.includes(payload.type) ? payload.type : "";
  if (!type) throw httpError("Invalid adjustment type", 400);
  const amount = money(payload.amount);
  if (amount <= 0) throw httpError("Adjustment amount must be greater than 0", 400);
  doc.adjustments.push({
    type,
    amount,
    reason: str(payload.reason),
    createdBy: actorOf(editor),
    date: new Date(),
  });
  if (type === "Bonus") doc.bonus = money(doc.bonus) + amount;
  else if (type === "Incentive") doc.incentives = money(doc.incentives) + amount;
  else if (type === "Overtime") doc.overtime = money(doc.overtime) + amount;
  else if (type === "Reimbursement") doc.reimbursement = money(doc.reimbursement) + amount;
  else if (type === "Other Earnings") doc.otherEarnings = money(doc.otherEarnings) + amount;
  else if (type === "Other Deductions") doc.otherDeductions = money(doc.otherDeductions) + amount;
  else if (type === "Leave Deduction") doc.leaveDeduction = money(doc.leaveDeduction) + amount;

  doc.grossSalary =
    money(doc.basicSalary) +
    money(doc.totalAllowances) +
    money(doc.incentives) +
    money(doc.bonus) +
    money(doc.overtime) +
    money(doc.reimbursement) +
    money(doc.otherEarnings);
  doc.totalDeductions =
    money(doc.structureDeductions) +
    money(doc.advanceRecovery) +
    money(doc.loanRecovery) +
    money(doc.leaveDeduction) +
    money(doc.otherDeductions);
  doc.netPayable = Math.max(0, money(doc.grossSalary) - money(doc.totalDeductions));
  if (money(doc.paidAmount) > money(doc.netPayable)) {
    throw httpError("Adjustment would make net payable less than amount already paid", 400);
  }
  if (money(doc.paidAmount) > 0 && money(doc.paidAmount) < money(doc.netPayable)) doc.status = "Partially Paid";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  const run = await PayrollRun.findById(doc.runMongoId);
  if (run) await refreshRunTotals(run);
  return toItemRow(doc);
}

export async function updatePayrollUnits(id, payload = {}, editor = "master-admin") {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  if (["Paid", "Cancelled"].includes(doc.status)) throw httpError("Cannot edit a paid or cancelled payroll", 400);
  if (!UNIT_SALARY_TYPES.has(doc.snapshot?.salaryType)) {
    throw httpError("Units can only be set for per-class / hourly / daily salary types", 400);
  }
  doc.unitsWorked = Math.max(0, Number(payload.unitsWorked) || 0);
  const calc = calculatePayroll({
    salaryType: doc.snapshot.salaryType,
    structure: { basicSalary: doc.unitRate, unitRate: doc.unitRate, totalAllowances: 0, totalDeductions: 0 },
    unitsWorked: doc.unitsWorked,
    adjustments: doc.adjustments,
    advanceRecovery: doc.advanceRecovery,
    loanRecovery: doc.loanRecovery,
    leaveDeduction: 0,
  });
  Object.assign(doc, calc);
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toItemRow(doc);
}

export async function approvePayrollItem(id, editor = "master-admin") {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  if (!["Generated", "Reviewed", "Draft"].includes(doc.status)) {
    throw httpError("Payroll is not awaiting approval", 400);
  }
  doc.status = "Approved";
  doc.approvedBy = actorOf(editor);
  doc.updatedBy = actorOf(editor);
  await doc.save();
  const run = await PayrollRun.findById(doc.runMongoId);
  if (run) {
    run.approvedBy = actorOf(editor);
    await refreshRunTotals(run);
    const pending = await PayrollItem.countDocuments({
      runMongoId: run._id,
      status: { $in: ["Generated", "Reviewed", "Draft"] },
    });
    if (pending === 0 && run.status !== "Paid" && run.status !== "Partially Paid") run.status = "Approved";
    await run.save();
  }
  await createActivityLog({
    section: "Payroll",
    action: "approve",
    message: `Approved payroll ${doc.itemId} for ${doc.snapshot?.name}`,
    actor: actorOf(editor),
    resourceId: doc.itemId,
  }).catch(() => {});
  return toItemRow(doc);
}

export async function approvePayrollRun(id, editor = "master-admin") {
  const run = await findRun(id);
  if (!run) throw httpError("Payroll run not found", 404);
  await PayrollItem.updateMany(
    { runMongoId: run._id, status: { $in: ["Generated", "Reviewed", "Draft"] } },
    { $set: { status: "Approved", approvedBy: actorOf(editor), updatedBy: actorOf(editor) } }
  );
  run.approvedBy = actorOf(editor);
  run.status = "Approved";
  await refreshRunTotals(run);
  return getPayrollRun(run.runId);
}

export async function cancelPayrollItem(id, editor = "master-admin") {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  if (money(doc.paidAmount) > 0) throw httpError("Cannot cancel payroll that already has payments", 400);
  doc.status = "Cancelled";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  const run = await PayrollRun.findById(doc.runMongoId);
  if (run) await refreshRunTotals(run);
  return toItemRow(doc);
}

async function applyRecoveriesOnPay(doc) {
  if (doc._recoveriesApplied) return;
  const advances = await EmployeeAdvance.find({
    employeeType: doc.employeeType,
    employeeMongoId: doc.employeeMongoId,
    status: "Active",
    remainingAmount: { $gt: 0 },
  });
  let remainingAdv = money(doc.advanceRecovery);
  for (const adv of advances) {
    if (remainingAdv <= 0) break;
    const take = await recoverAdvance(adv, remainingAdv);
    remainingAdv -= take;
  }
  const loans = await EmployeeLoan.find({
    employeeType: doc.employeeType,
    employeeMongoId: doc.employeeMongoId,
    status: "Active",
    remainingAmount: { $gt: 0 },
  });
  let remainingLoan = money(doc.loanRecovery);
  for (const loan of loans) {
    if (remainingLoan <= 0) break;
    const take = await recoverLoan(loan, remainingLoan);
    remainingLoan -= take;
  }
}

export async function payPayrollItem(id, payload = {}, editor = "master-admin") {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  if (["Cancelled"].includes(doc.status)) throw httpError("Cannot pay a cancelled payroll", 400);
  if (!["Approved", "Partially Paid", "Generated", "Reviewed"].includes(doc.status) && doc.status !== "Paid") {
    throw httpError("Approve payroll before recording payment", 400);
  }
  if (doc.status === "Generated" || doc.status === "Reviewed") {
    doc.status = "Approved";
    doc.approvedBy = actorOf(editor);
  }
  const outstanding = remainingOf(doc.netPayable, doc.paidAmount);
  const payAmount = payload.amount != null && str(payload.amount) !== "" ? money(payload.amount) : outstanding;
  if (payAmount <= 0) throw httpError("Payment amount must be greater than 0", 400);
  if (payAmount > outstanding) throw httpError("Payment cannot exceed outstanding salary", 400);

  const seq =
    (await FinancePayment.countDocuments({
      sourceType: "PAYROLL",
      sourceId: new RegExp(`^${doc.itemId}:pay`),
    })) + 1;
  await recordFinancePayment({
    direction: "OUT",
    sourceType: "PAYROLL",
    sourceId: `${doc.itemId}:pay:${seq}`,
    action: "pay",
    partyType: doc.employeeType,
    partyId: doc.employeeCode,
    partyName: doc.snapshot?.name || doc.employeeCode,
    amount: payAmount,
    method: PAYMENT_METHODS.includes(payload.method) ? payload.method : "Bank Transfer",
    financialAccountCode: str(payload.financialAccountCode).toUpperCase(),
    date: parseDate(payload.date, new Date()),
    referenceNumber: str(payload.referenceNumber) || doc.itemId,
    notes: str(payload.notes) || `Salary ${monthLabel(doc.year, doc.month)}`,
    editor,
    expenseAccountCode: doc.employeeType === "STAFF" ? "5010" : "5000",
    employeeType: doc.employeeType,
  });

  if (money(doc.paidAmount) === 0) {
    await applyRecoveriesOnPay(doc);
  }

  doc.paidAmount = money(doc.paidAmount) + payAmount;
  doc.paymentMethod = PAYMENT_METHODS.includes(payload.method) ? payload.method : doc.paymentMethod;
  doc.paidAt = new Date();
  const ps = paymentStatusFromAmounts(doc.netPayable, doc.paidAmount);
  doc.status = ps === "Paid" ? "Paid" : "Partially Paid";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  const run = await PayrollRun.findById(doc.runMongoId);
  if (run) await refreshRunTotals(run);
  await createActivityLog({
    section: "Payroll",
    action: "pay",
    message: `Paid ${payAmount} on payroll ${doc.itemId} (${doc.snapshot?.name})`,
    actor: actorOf(editor),
    resourceId: doc.itemId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Payroll", action: "pay", resourceId: doc.itemId });
  return toItemRow(doc);
}

export async function getPayslip(id) {
  const doc = await findItem(id);
  if (!doc) throw httpError("Payroll item not found", 404);
  return {
    ...toItemRow(doc),
    organization: {
      name: "THAKUR NIRANJAN SINGH I.T.I. & COMPUTER",
      displayName: "Thakur Niranjan Singh I.T.I. & Computer",
    },
    paymentDate: doc.paidAt ? formatDateLabel(doc.paidAt) : "—",
    earnings: [
      { name: "Basic Salary", amount: doc.basicSalary },
      { name: "Allowances", amount: doc.totalAllowances },
      { name: "Incentives", amount: doc.incentives },
      { name: "Bonus", amount: doc.bonus },
      { name: "Overtime", amount: doc.overtime },
      { name: "Reimbursement", amount: doc.reimbursement },
      { name: "Other Earnings", amount: doc.otherEarnings },
    ].filter((r) => money(r.amount) > 0 || r.name === "Basic Salary"),
    deductionLines: [
      { name: "Structure Deductions", amount: doc.structureDeductions },
      { name: "Advance Recovery", amount: doc.advanceRecovery },
      { name: "Loan Recovery", amount: doc.loanRecovery },
      { name: "Leave Deduction", amount: doc.leaveDeduction },
      { name: "Other Deductions", amount: doc.otherDeductions },
    ].filter((r) => money(r.amount) > 0),
  };
}

export async function getPayrollDashboard(params = {}) {
  const now = new Date();
  const month = Number(params.month) || now.getMonth() + 1;
  const year = Number(params.year) || now.getFullYear();
  const type = str(params.employeeType).toUpperCase();
  const match = { month, year, status: { $ne: "Cancelled" } };
  if (EMPLOYEE_TYPES.includes(type)) match.employeeType = type;

  const [items, facultyCount, staffCount] = await Promise.all([
    PayrollItem.find(match).lean(),
    Faculty.countDocuments({ softDelete: false, status: "Active" }),
    Staff.countDocuments({ softDelete: { $ne: true }, isArchived: { $ne: true }, status: "Active" }),
  ]);

  const totalEmployees = type === "FACULTY" ? facultyCount : type === "STAFF" ? staffCount : facultyCount + staffCount;
  const processed = items.filter((i) => ["Approved", "Partially Paid", "Paid", "Generated", "Reviewed"].includes(i.status)).length;
  const pending = Math.max(0, totalEmployees - items.length);
  const paidItems = items.filter((i) => i.status === "Paid");
  const unpaid = items.filter((i) => i.status !== "Paid");

  return {
    currentPayrollMonth: monthLabel(year, month),
    month,
    year,
    totalEmployees,
    processedEmployees: processed,
    pendingEmployees: pending,
    totalGrossSalary: items.reduce((s, i) => s + (Number(i.grossSalary) || 0), 0),
    totalDeductions: items.reduce((s, i) => s + (Number(i.totalDeductions) || 0), 0),
    totalNetPayable: items.reduce((s, i) => s + (Number(i.netPayable) || 0), 0),
    totalPaid: items.reduce((s, i) => s + (Number(i.paidAmount) || 0), 0),
    pendingSalaryPayments: unpaid.reduce((s, i) => s + remainingOf(i.netPayable, i.paidAmount), 0),
    paidCount: paidItems.length,
    generated: items.length > 0,
  };
}
