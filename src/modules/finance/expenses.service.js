import { University } from "../universities/universities.model.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import {
  EXPENSE_FREQUENCIES,
  EXPENSE_PAYMENT_STATUSES,
  EXPENSE_WORKFLOW,
  PAYMENT_METHODS,
} from "./finance.constants.js";
import { calculateExpenseTotal } from "./finance.calc.js";
import { nextFinanceId } from "./finance.ids.js";
import { Expense, ExpenseCategory, FinancePayment } from "./finance.models.js";
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
  paymentStatusFromAmounts,
  rangeFromPreset,
  remainingOf,
  str,
  toIsoDate,
} from "./finance.utils.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";

function toCategoryRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: String(d._id),
    name: d.name,
    accountCode: d.accountCode,
    status: d.status,
    system: Boolean(d.system),
  };
}

function toExpenseRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const outstanding = remainingOf(d.totalAmount, d.paidAmount);
  return {
    _id: String(d._id),
    id: d.expenseId,
    expenseId: d.expenseId,
    date: toIsoDate(d.date),
    dateLabel: formatDateLabel(d.date),
    categoryId: d.categoryId ? String(d.categoryId) : "",
    categoryName: d.categoryName,
    category: d.categoryName,
    accountCode: d.accountCode,
    description: d.description || "",
    amount: money(d.amount),
    taxAmount: money(d.taxAmount),
    totalAmount: money(d.totalAmount),
    paidAmount: money(d.paidAmount),
    outstanding,
    vendor: d.vendor || "",
    paymentStatus: d.paymentStatus,
    workflowStatus: d.workflowStatus,
    status: d.workflowStatus,
    paymentMethod: d.paymentMethod,
    financialAccountCode: d.financialAccountCode || "",
    invoiceNumber: d.invoiceNumber || "",
    referenceNumber: d.referenceNumber || "",
    attachmentUrl: d.attachmentUrl || "",
    attachmentName: d.attachmentName || "",
    notes: d.notes || "",
    universityId: d.universityId ? String(d.universityId) : "",
    universityName: d.universityName || "",
    reimbursable: Boolean(d.reimbursable),
    recurring: d.recurring || { enabled: false },
    approvalHistory: d.approvalHistory || [],
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    approvedBy: d.approvedBy || "",
    createdAt: d.createdAt,
  };
}

async function loadUniversity(id) {
  const oid = asObjectId(id);
  if (!oid) return { universityId: null, universityName: "" };
  const uni = await University.findOne({ _id: oid, softDelete: { $ne: true } })
    .select("name shortName")
    .lean();
  if (!uni) return { universityId: null, universityName: "" };
  return { universityId: uni._id, universityName: uni.shortName || uni.name };
}

async function loadCategory(idOrName) {
  const oid = asObjectId(idOrName);
  if (oid) {
    const cat = await ExpenseCategory.findById(oid);
    if (cat) return cat;
  }
  if (str(idOrName)) return ExpenseCategory.findOne({ name: str(idOrName) });
  return null;
}

function nextRecurringDate(fromDate, frequency) {
  const next = new Date(fromDate);
  if (frequency === "Quarterly") next.setMonth(next.getMonth() + 3);
  else if (frequency === "Yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

export async function listExpenseCategories() {
  await ensureFinanceDefaults();
  const rows = await ExpenseCategory.find({}).sort({ name: 1 }).lean();
  return rows.map(toCategoryRow);
}

export async function upsertExpenseCategory(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const name = str(payload.name);
  if (!name) throw httpError("Category name is required", 400);
  const oid = asObjectId(payload.id || payload._id);
  let doc = oid ? await ExpenseCategory.findById(oid) : await ExpenseCategory.findOne({ name });
  if (!doc) {
    doc = await ExpenseCategory.create({
      name,
      accountCode: str(payload.accountCode).toUpperCase() || "5990",
      status: payload.status === "Inactive" ? "Inactive" : "Active",
      createdBy: actorOf(editor),
      updatedBy: actorOf(editor),
    });
  } else {
    if (payload.name) doc.name = name;
    if (payload.accountCode) doc.accountCode = str(payload.accountCode).toUpperCase();
    if (payload.status) doc.status = payload.status === "Inactive" ? "Inactive" : "Active";
    doc.updatedBy = actorOf(editor);
    await doc.save();
  }
  return toCategoryRow(doc);
}

export async function setExpenseCategoryStatus(id, status, editor) {
  const doc = await ExpenseCategory.findById(asObjectId(id) || id);
  if (!doc) throw httpError("Category not found", 404);
  doc.status = status === "Inactive" ? "Inactive" : "Active";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toCategoryRow(doc);
}

function buildExpenseQuery(params) {
  const query = {};
  if (params.category) query.categoryName = str(params.category);
  if (params.paymentStatus && EXPENSE_PAYMENT_STATUSES.includes(params.paymentStatus)) {
    query.paymentStatus = params.paymentStatus;
  }
  if (params.workflowStatus && EXPENSE_WORKFLOW.includes(params.workflowStatus)) {
    query.workflowStatus = params.workflowStatus;
  }
  if (params.reimbursable === "1" || params.reimbursable === "true") query.reimbursable = true;
  if (params.recurring === "1" || params.recurring === "true") query["recurring.enabled"] = true;
  const uni = asObjectId(params.universityId);
  if (uni) query.universityId = uni;
  if (params.from || params.to || params.preset || params.range) {
    const { from, to } = rangeFromPreset(params.preset || params.range, params.from, params.to);
    query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  }
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { expenseId: rx },
      { vendor: rx },
      { description: rx },
      { invoiceNumber: rx },
      { referenceNumber: rx },
      { categoryName: rx },
    ];
  }
  return query;
}

export async function listExpenses(params = {}) {
  await ensureFinanceDefaults();
  const { page, limit, skip } = paginationParams(params);
  const query = buildExpenseQuery(params);
  const [rows, total] = await Promise.all([
    Expense.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(query),
  ]);
  return { rows: rows.map(toExpenseRow), pagination: paginationMeta(page, limit, total) };
}

async function findExpenseDoc(id) {
  const oid = asObjectId(id);
  return Expense.findOne(oid ? { $or: [{ _id: oid }, { expenseId: str(id) }] } : { expenseId: str(id) });
}

export async function getExpenseById(id) {
  const doc = await findExpenseDoc(id);
  return doc ? toExpenseRow(doc) : null;
}

async function applyExpensePayment(doc, amount, payload, editor) {
  const outstanding = remainingOf(doc.totalAmount, doc.paidAmount);
  const payAmount = amount != null && str(amount) !== "" ? money(amount) : outstanding;
  if (payAmount <= 0) throw httpError("Payment amount must be greater than 0", 400);
  if (payAmount > outstanding) throw httpError("Payment cannot exceed outstanding amount", 400);

  const seq = (await FinancePayment.countDocuments({ sourceType: "EXPENSE", sourceId: new RegExp(`^${doc.expenseId}:pay`) })) + 1;
  const sourceId = `${doc.expenseId}:pay:${seq}`;
  await recordFinancePayment({
    direction: "OUT",
    sourceType: "EXPENSE",
    sourceId,
    action: "pay",
    partyType: "VENDOR",
    partyName: doc.vendor || doc.categoryName,
    amount: payAmount,
    method: PAYMENT_METHODS.includes(payload.method) ? payload.method : doc.paymentMethod || "Cash",
    financialAccountCode: str(payload.financialAccountCode).toUpperCase() || doc.financialAccountCode,
    universityId: doc.universityId,
    referenceNumber: str(payload.referenceNumber) || doc.referenceNumber || doc.invoiceNumber,
    notes: str(payload.notes) || doc.description,
    date: parseDate(payload.date, new Date()),
    editor,
    expenseAccountCode: doc.accountCode,
  });

  doc.paidAmount = money(doc.paidAmount) + payAmount;
  doc.paymentStatus = paymentStatusFromAmounts(doc.totalAmount, doc.paidAmount);
  if (doc.paymentStatus === "Paid") doc.workflowStatus = "Paid";
  else if (["Approved", "Payment Pending"].includes(doc.workflowStatus) || doc.workflowStatus === "Paid") {
    doc.workflowStatus = "Payment Pending";
  }
  if (payload.method) doc.paymentMethod = payload.method;
  if (payload.financialAccountCode) doc.financialAccountCode = str(payload.financialAccountCode).toUpperCase();
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return doc;
}

export async function createExpense(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const category = await loadCategory(payload.categoryId || payload.categoryName || payload.category);
  if (!category || category.status === "Inactive") throw httpError("Select a valid expense category", 400);
  const totals = calculateExpenseTotal({ amount: payload.amount, taxAmount: payload.taxAmount });
  if (totals.totalAmount <= 0) throw httpError("Expense amount must be greater than 0", 400);
  const uni = await loadUniversity(payload.universityId);

  const recurringEnabled = Boolean(payload.recurring?.enabled || payload.recurringEnabled);
  const frequency = EXPENSE_FREQUENCIES.includes(payload.recurring?.frequency || payload.frequency)
    ? payload.recurring?.frequency || payload.frequency
    : "Monthly";
  const startDate = parseDate(payload.recurring?.startDate || payload.startDate, new Date());

  let workflowStatus = EXPENSE_WORKFLOW.includes(payload.workflowStatus) ? payload.workflowStatus : "Draft";
  if (payload.submit === true || payload.submit === "1") workflowStatus = "Submitted";

  const expenseId = await nextFinanceId("exp", "EXP-", 4);
  const doc = await Expense.create({
    expenseId,
    date: parseDate(payload.date, new Date()),
    categoryId: category._id,
    categoryName: category.name,
    accountCode: category.accountCode || "5990",
    description: str(payload.description),
    ...totals,
    paidAmount: 0,
    vendor: str(payload.vendor || payload.payee),
    paymentStatus: "Pending",
    workflowStatus,
    paymentMethod: PAYMENT_METHODS.includes(payload.paymentMethod) ? payload.paymentMethod : "Cash",
    financialAccountCode: str(payload.financialAccountCode).toUpperCase(),
    invoiceNumber: str(payload.invoiceNumber),
    referenceNumber: str(payload.referenceNumber),
    attachmentUrl: str(payload.attachmentUrl),
    attachmentName: str(payload.attachmentName),
    notes: str(payload.notes),
    ...uni,
    reimbursable: Boolean(payload.reimbursable),
    recurring: {
      enabled: recurringEnabled,
      frequency: recurringEnabled ? frequency : "",
      startDate: recurringEnabled ? startDate : null,
      endDate: recurringEnabled ? parseDate(payload.recurring?.endDate || payload.endDate) : null,
      nextDueDate: recurringEnabled ? startDate : null,
      templateId: recurringEnabled ? expenseId : "",
    },
    approvalHistory: [{ action: "Created", by: actorOf(editor), at: new Date(), remarks: "" }],
    createdBy: actorOf(editor),
    updatedBy: actorOf(editor),
  });

  const markPaid = str(payload.paymentStatus) === "Paid" || payload.payNow === true || payload.payNow === "1";
  if (markPaid) {
    await applyExpensePayment(doc, totals.totalAmount, payload, editor);
  }

  await createActivityLog({
    section: "Expenses",
    action: "create",
    message: `Created expense ${doc.expenseId}`,
    actor: actorOf(editor),
    resourceId: doc.expenseId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Expenses", action: "create", resourceId: doc.expenseId });
  return toExpenseRow(doc);
}

export async function updateExpense(id, payload = {}, editor = "master-admin") {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (["Paid", "Cancelled"].includes(doc.workflowStatus) && payload.force !== true) {
    throw httpError("Paid or cancelled expenses cannot be edited", 400);
  }
  if (payload.categoryId || payload.categoryName || payload.category) {
    const category = await loadCategory(payload.categoryId || payload.categoryName || payload.category);
    if (!category) throw httpError("Select a valid expense category", 400);
    doc.categoryId = category._id;
    doc.categoryName = category.name;
    doc.accountCode = category.accountCode || doc.accountCode;
  }
  if (payload.date) doc.date = parseDate(payload.date, doc.date);
  if (payload.description != null) doc.description = str(payload.description);
  if (payload.vendor != null || payload.payee != null) doc.vendor = str(payload.vendor || payload.payee);
  if (payload.amount != null || payload.taxAmount != null) {
    const totals = calculateExpenseTotal({
      amount: payload.amount != null ? payload.amount : doc.amount,
      taxAmount: payload.taxAmount != null ? payload.taxAmount : doc.taxAmount,
    });
    if (totals.totalAmount < money(doc.paidAmount)) {
      throw httpError("Total cannot be less than amount already paid", 400);
    }
    Object.assign(doc, totals);
    doc.paymentStatus = paymentStatusFromAmounts(doc.totalAmount, doc.paidAmount);
  }
  if (payload.paymentMethod && PAYMENT_METHODS.includes(payload.paymentMethod)) {
    doc.paymentMethod = payload.paymentMethod;
  }
  if (payload.financialAccountCode) doc.financialAccountCode = str(payload.financialAccountCode).toUpperCase();
  if (payload.invoiceNumber != null) doc.invoiceNumber = str(payload.invoiceNumber);
  if (payload.referenceNumber != null) doc.referenceNumber = str(payload.referenceNumber);
  if (payload.notes != null) doc.notes = str(payload.notes);
  if (payload.attachmentUrl != null) doc.attachmentUrl = str(payload.attachmentUrl);
  if (payload.attachmentName != null) doc.attachmentName = str(payload.attachmentName);
  if (payload.reimbursable != null) doc.reimbursable = Boolean(payload.reimbursable);
  if (payload.universityId !== undefined) Object.assign(doc, await loadUniversity(payload.universityId));
  if (payload.recurring || payload.recurringEnabled != null) {
    const enabled = Boolean(payload.recurring?.enabled ?? payload.recurringEnabled);
    const frequency = EXPENSE_FREQUENCIES.includes(payload.recurring?.frequency || payload.frequency)
      ? payload.recurring?.frequency || payload.frequency
      : doc.recurring?.frequency || "Monthly";
    const startDate = parseDate(payload.recurring?.startDate || payload.startDate, doc.recurring?.startDate || doc.date);
    doc.recurring = {
      enabled,
      frequency: enabled ? frequency : "",
      startDate: enabled ? startDate : null,
      endDate: enabled ? parseDate(payload.recurring?.endDate || payload.endDate, doc.recurring?.endDate) : null,
      nextDueDate: enabled ? parseDate(payload.recurring?.nextDueDate, startDate) : null,
      templateId: enabled ? doc.recurring?.templateId || doc.expenseId : "",
    };
  }
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toExpenseRow(doc);
}

export async function submitExpense(id, editor) {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (!["Draft", "Rejected"].includes(doc.workflowStatus)) {
    throw httpError("Only draft or rejected expenses can be submitted", 400);
  }
  doc.workflowStatus = "Submitted";
  doc.approvalHistory.push({ action: "Submitted", by: actorOf(editor), at: new Date(), remarks: "" });
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toExpenseRow(doc);
}

export async function approveExpense(id, payload = {}, editor = "master-admin") {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (!["Submitted", "Draft"].includes(doc.workflowStatus)) {
    throw httpError("Expense is not awaiting approval", 400);
  }
  doc.workflowStatus = money(doc.paidAmount) >= money(doc.totalAmount) ? "Paid" : "Payment Pending";
  doc.approvedBy = actorOf(editor);
  doc.approvalHistory.push({
    action: "Approved",
    by: actorOf(editor),
    at: new Date(),
    remarks: str(payload.remarks),
  });
  doc.updatedBy = actorOf(editor);
  await doc.save();
  await createActivityLog({
    section: "Expenses",
    action: "approve",
    message: `Approved expense ${doc.expenseId}`,
    actor: actorOf(editor),
    resourceId: doc.expenseId,
  }).catch(() => {});
  return toExpenseRow(doc);
}

export async function rejectExpense(id, payload = {}, editor = "master-admin") {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (!["Submitted", "Draft", "Payment Pending"].includes(doc.workflowStatus)) {
    throw httpError("Expense cannot be rejected in its current status", 400);
  }
  if (money(doc.paidAmount) > 0) throw httpError("Cannot reject an expense that already has payments", 400);
  doc.workflowStatus = "Rejected";
  doc.approvalHistory.push({
    action: "Rejected",
    by: actorOf(editor),
    at: new Date(),
    remarks: str(payload.remarks),
  });
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toExpenseRow(doc);
}

export async function cancelExpense(id, payload = {}, editor = "master-admin") {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (money(doc.paidAmount) > 0) throw httpError("Cannot cancel an expense that already has payments", 400);
  doc.workflowStatus = "Cancelled";
  doc.paymentStatus = "Cancelled";
  doc.approvalHistory.push({
    action: "Cancelled",
    by: actorOf(editor),
    at: new Date(),
    remarks: str(payload.remarks),
  });
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toExpenseRow(doc);
}

export async function payExpense(id, payload = {}, editor = "master-admin") {
  const doc = await findExpenseDoc(id);
  if (!doc) throw httpError("Expense not found", 404);
  if (["Cancelled", "Rejected"].includes(doc.workflowStatus)) {
    throw httpError("Cannot pay a cancelled or rejected expense", 400);
  }
  if (!["Approved", "Payment Pending", "Paid", "Submitted", "Draft"].includes(doc.workflowStatus)) {
    throw httpError("Expense is not payable in its current status", 400);
  }
  await applyExpensePayment(doc, payload.amount, payload, editor);
  await createActivityLog({
    section: "Expenses",
    action: "pay",
    message: `Recorded payment on expense ${doc.expenseId}`,
    actor: actorOf(editor),
    resourceId: doc.expenseId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Expenses", action: "pay", resourceId: doc.expenseId });
  return toExpenseRow(doc);
}

export async function generateRecurringExpenses(editor = "master-admin") {
  const now = new Date();
  const templates = await Expense.find({
    "recurring.enabled": true,
    "recurring.nextDueDate": { $ne: null, $lte: now },
    workflowStatus: { $ne: "Cancelled" },
  });
  const created = [];
  for (const tpl of templates) {
    const payload = {
      date: tpl.recurring.nextDueDate || now,
      categoryId: tpl.categoryId,
      description: tpl.description,
      amount: tpl.amount,
      taxAmount: tpl.taxAmount,
      vendor: tpl.vendor,
      paymentMethod: tpl.paymentMethod,
      financialAccountCode: tpl.financialAccountCode,
      notes: `Generated from recurring ${tpl.expenseId}`,
      universityId: tpl.universityId,
      reimbursable: tpl.reimbursable,
      submit: true,
    };
    const row = await createExpense(payload, editor);
    created.push(row);
    const next = nextRecurringDate(tpl.recurring.nextDueDate || now, tpl.recurring.frequency || "Monthly");
    const end = tpl.recurring.endDate ? new Date(tpl.recurring.endDate) : null;
    tpl.recurring.nextDueDate = end && next > end ? null : next;
    await tpl.save();
  }
  return { created: created.length, rows: created };
}

export async function getExpensesDashboard(params = {}) {
  await ensureFinanceDefaults();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { from, to } = rangeFromPreset(params.preset || "month", params.from, params.to);
  const base = { workflowStatus: { $nin: ["Cancelled"] } };
  const uni = asObjectId(params.universityId);
  if (uni) base.universityId = uni;

  const [all, monthRows, pendingApproval, paid, unpaid, reimbursable, byCategory, monthly] = await Promise.all([
    Expense.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } }]),
    Expense.aggregate([
      { $match: { ...base, date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Expense.countDocuments({ ...base, workflowStatus: "Submitted" }),
    Expense.aggregate([
      { $match: { ...base, paymentStatus: "Paid" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { ...base, paymentStatus: { $in: ["Pending", "Partially Paid"] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$totalAmount", "$paidAmount"] } }, count: { $sum: 1 } } },
    ]),
    Expense.countDocuments({ ...base, reimbursable: true, paymentStatus: { $ne: "Paid" } }),
    Expense.aggregate([
      { $match: { ...base, date: { $gte: from, $lt: to } } },
      { $group: { _id: "$categoryName", value: { $sum: "$totalAmount" } } },
      { $sort: { value: -1 } },
    ]),
    Expense.aggregate([
      { $match: { ...base, date: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
      {
        $group: {
          _id: { y: { $year: "$date" }, m: { $month: "$date" } },
          total: { $sum: "$totalAmount" },
        },
      },
    ]),
  ]);

  const trend = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const hit = monthly.find((r) => r._id.y === d.getFullYear() && r._id.m === d.getMonth() + 1);
    trend.push({ name: d.toLocaleDateString("en-IN", { month: "short" }), value: hit?.total || 0 });
  }

  const dueSoon = await Expense.find({
    "recurring.enabled": true,
    "recurring.nextDueDate": { $ne: null, $lte: new Date(now.getTime() + 7 * 86400000) },
  })
    .select("expenseId categoryName recurring.nextDueDate vendor totalAmount")
    .lean();

  return {
    totalExpenses: all[0]?.total || 0,
    totalCount: all[0]?.count || 0,
    thisMonthExpenses: monthRows[0]?.total || 0,
    pendingApproval,
    paidExpenses: paid[0]?.total || 0,
    paidCount: paid[0]?.count || 0,
    unpaidExpenses: unpaid[0]?.total || 0,
    unpaidCount: unpaid[0]?.count || 0,
    reimbursableExpenses: reimbursable,
    byCategory: byCategory.map((r) => ({ name: r._id, value: r.value })),
    monthlyTrend: trend,
    recurringDueSoon: dueSoon.map((r) => ({
      expenseId: r.expenseId,
      categoryName: r.categoryName,
      vendor: r.vendor,
      nextDueDate: toIsoDate(r.recurring?.nextDueDate),
      amount: r.totalAmount,
    })),
  };
}
