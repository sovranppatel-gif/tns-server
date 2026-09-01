import { University } from "../universities/universities.model.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { INCOME_STATUSES, PAYMENT_METHODS } from "./finance.constants.js";
import { calculateIncomeTotal } from "./finance.calc.js";
import { nextFinanceId } from "./finance.ids.js";
import { FinancePayment, IncomeCategory, IncomeRecord } from "./finance.models.js";
import { maybeSyncFeePayments, recordFinancePayment } from "./payments.service.js";
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
  rangeFromPreset,
  remainingOf,
  str,
  toIsoDate,
} from "./finance.utils.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";

function incomeStatusFromAmounts(total, received) {
  const t = money(total);
  const r = money(received);
  if (t <= 0 || r >= t) return "Received";
  if (r > 0) return "Partial";
  return "Pending";
}

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

function toIncomeRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.incomeId,
    incomeId: d.incomeId,
    date: toIsoDate(d.date),
    dateLabel: formatDateLabel(d.date),
    categoryId: d.categoryId ? String(d.categoryId) : "",
    categoryName: d.categoryName,
    category: d.categoryName,
    accountCode: d.accountCode,
    source: d.source || "",
    description: d.description || "",
    amount: money(d.amount),
    taxAmount: money(d.taxAmount),
    totalAmount: money(d.totalAmount),
    receivedAmount: money(d.receivedAmount),
    outstanding: remainingOf(d.totalAmount, d.receivedAmount),
    status: d.status,
    paymentMethod: d.paymentMethod,
    financialAccountCode: d.financialAccountCode || "",
    receivedFrom: d.receivedFrom || "",
    referenceNumber: d.referenceNumber || "",
    attachmentUrl: d.attachmentUrl || "",
    attachmentName: d.attachmentName || "",
    notes: d.notes || "",
    universityId: d.universityId ? String(d.universityId) : "",
    universityName: d.universityName || "",
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
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
    const cat = await IncomeCategory.findById(oid);
    if (cat) return cat;
  }
  if (str(idOrName)) return IncomeCategory.findOne({ name: str(idOrName) });
  return null;
}

export async function listIncomeCategories() {
  await ensureFinanceDefaults();
  const rows = await IncomeCategory.find({}).sort({ name: 1 }).lean();
  return rows.map(toCategoryRow);
}

export async function upsertIncomeCategory(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const name = str(payload.name);
  if (!name) throw httpError("Category name is required", 400);
  const oid = asObjectId(payload.id || payload._id);
  let doc = oid ? await IncomeCategory.findById(oid) : await IncomeCategory.findOne({ name });
  if (!doc) {
    doc = await IncomeCategory.create({
      name,
      accountCode: str(payload.accountCode).toUpperCase() || "4090",
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

export async function setIncomeCategoryStatus(id, status, editor) {
  const doc = await IncomeCategory.findById(asObjectId(id) || id);
  if (!doc) throw httpError("Category not found", 404);
  doc.status = status === "Inactive" ? "Inactive" : "Active";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toCategoryRow(doc);
}

export async function listIncome(params = {}) {
  await ensureFinanceDefaults();
  const { page, limit, skip } = paginationParams(params);
  const query = {};
  if (params.category) query.categoryName = str(params.category);
  if (params.status && INCOME_STATUSES.includes(params.status)) query.status = params.status;
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
      { incomeId: rx },
      { receivedFrom: rx },
      { source: rx },
      { description: rx },
      { referenceNumber: rx },
      { categoryName: rx },
    ];
  }
  const [rows, total] = await Promise.all([
    IncomeRecord.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    IncomeRecord.countDocuments(query),
  ]);
  return { rows: rows.map(toIncomeRow), pagination: paginationMeta(page, limit, total) };
}

async function findIncomeDoc(id) {
  const oid = asObjectId(id);
  return IncomeRecord.findOne(oid ? { $or: [{ _id: oid }, { incomeId: str(id) }] } : { incomeId: str(id) });
}

export async function getIncomeById(id) {
  const doc = await findIncomeDoc(id);
  return doc ? toIncomeRow(doc) : null;
}

async function applyIncomeReceipt(doc, amount, payload, editor) {
  const outstanding = remainingOf(doc.totalAmount, doc.receivedAmount);
  const payAmount = amount != null && str(amount) !== "" ? money(amount) : outstanding;
  if (payAmount <= 0) throw httpError("Receipt amount must be greater than 0", 400);
  if (payAmount > outstanding) throw httpError("Receipt cannot exceed outstanding amount", 400);
  const seq =
    (await FinancePayment.countDocuments({
      sourceType: "INCOME",
      sourceId: new RegExp(`^${doc.incomeId}:receive`),
    })) + 1;
  await recordFinancePayment({
    direction: "IN",
    sourceType: "INCOME",
    sourceId: `${doc.incomeId}:receive:${seq}`,
    action: "receive",
    partyType: "OTHER",
    partyName: doc.receivedFrom || doc.source || doc.categoryName,
    amount: payAmount,
    method: PAYMENT_METHODS.includes(payload.method || payload.paymentMethod)
      ? payload.method || payload.paymentMethod
      : doc.paymentMethod || "Cash",
    financialAccountCode: str(payload.financialAccountCode).toUpperCase() || doc.financialAccountCode,
    universityId: doc.universityId,
    referenceNumber: str(payload.referenceNumber) || doc.referenceNumber,
    notes: str(payload.notes) || doc.description,
    date: parseDate(payload.date, new Date()),
    editor,
    incomeAccountCode: doc.accountCode,
  });
  doc.receivedAmount = money(doc.receivedAmount) + payAmount;
  doc.status = incomeStatusFromAmounts(doc.totalAmount, doc.receivedAmount);
  if (payload.method || payload.paymentMethod) doc.paymentMethod = payload.method || payload.paymentMethod;
  if (payload.financialAccountCode) doc.financialAccountCode = str(payload.financialAccountCode).toUpperCase();
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return doc;
}

export async function createIncome(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const category = await loadCategory(payload.categoryId || payload.categoryName || payload.category);
  if (!category || category.status === "Inactive") throw httpError("Select a valid income category", 400);
  if (/student fees/i.test(category.name)) {
    throw httpError("Student fee income is recorded automatically from Fees. Use another category for other income.", 400);
  }
  const totals = calculateIncomeTotal({ amount: payload.amount, taxAmount: payload.taxAmount });
  if (totals.totalAmount <= 0) throw httpError("Income amount must be greater than 0", 400);
  const uni = await loadUniversity(payload.universityId);
  const incomeId = await nextFinanceId("inc", "INC-", 4);
  const doc = await IncomeRecord.create({
    incomeId,
    date: parseDate(payload.date, new Date()),
    categoryId: category._id,
    categoryName: category.name,
    accountCode: category.accountCode || "4090",
    source: str(payload.source),
    description: str(payload.description),
    ...totals,
    receivedAmount: 0,
    status: "Pending",
    paymentMethod: PAYMENT_METHODS.includes(payload.paymentMethod) ? payload.paymentMethod : "Cash",
    financialAccountCode: str(payload.financialAccountCode).toUpperCase(),
    receivedFrom: str(payload.receivedFrom),
    referenceNumber: str(payload.referenceNumber),
    attachmentUrl: str(payload.attachmentUrl),
    attachmentName: str(payload.attachmentName),
    notes: str(payload.notes),
    ...uni,
    createdBy: actorOf(editor),
    updatedBy: actorOf(editor),
  });

  const markReceived = str(payload.status) === "Received" || payload.receiveNow === true || payload.receiveNow === "1";
  if (markReceived) {
    await applyIncomeReceipt(doc, totals.totalAmount, payload, editor);
  }

  await createActivityLog({
    section: "Income",
    action: "create",
    message: `Created income ${doc.incomeId}`,
    actor: actorOf(editor),
    resourceId: doc.incomeId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Income", action: "create", resourceId: doc.incomeId });
  return toIncomeRow(doc);
}

export async function updateIncome(id, payload = {}, editor = "master-admin") {
  const doc = await findIncomeDoc(id);
  if (!doc) throw httpError("Income record not found", 404);
  if (doc.status === "Cancelled") throw httpError("Cancelled income cannot be edited", 400);
  if (payload.categoryId || payload.categoryName || payload.category) {
    const category = await loadCategory(payload.categoryId || payload.categoryName || payload.category);
    if (!category) throw httpError("Select a valid income category", 400);
    if (/student fees/i.test(category.name)) {
      throw httpError("Student fee income is recorded automatically from Fees.", 400);
    }
    doc.categoryId = category._id;
    doc.categoryName = category.name;
    doc.accountCode = category.accountCode || doc.accountCode;
  }
  if (payload.date) doc.date = parseDate(payload.date, doc.date);
  if (payload.source != null) doc.source = str(payload.source);
  if (payload.description != null) doc.description = str(payload.description);
  if (payload.receivedFrom != null) doc.receivedFrom = str(payload.receivedFrom);
  if (payload.amount != null || payload.taxAmount != null) {
    const totals = calculateIncomeTotal({
      amount: payload.amount != null ? payload.amount : doc.amount,
      taxAmount: payload.taxAmount != null ? payload.taxAmount : doc.taxAmount,
    });
    if (totals.totalAmount < money(doc.receivedAmount)) {
      throw httpError("Total cannot be less than amount already received", 400);
    }
    Object.assign(doc, totals);
    doc.status = incomeStatusFromAmounts(doc.totalAmount, doc.receivedAmount);
  }
  if (payload.paymentMethod && PAYMENT_METHODS.includes(payload.paymentMethod)) doc.paymentMethod = payload.paymentMethod;
  if (payload.financialAccountCode) doc.financialAccountCode = str(payload.financialAccountCode).toUpperCase();
  if (payload.referenceNumber != null) doc.referenceNumber = str(payload.referenceNumber);
  if (payload.notes != null) doc.notes = str(payload.notes);
  if (payload.attachmentUrl != null) doc.attachmentUrl = str(payload.attachmentUrl);
  if (payload.attachmentName != null) doc.attachmentName = str(payload.attachmentName);
  if (payload.universityId !== undefined) Object.assign(doc, await loadUniversity(payload.universityId));
  if (payload.status === "Cancelled" && money(doc.receivedAmount) === 0) doc.status = "Cancelled";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toIncomeRow(doc);
}

export async function receiveIncomePayment(id, payload = {}, editor = "master-admin") {
  const doc = await findIncomeDoc(id);
  if (!doc) throw httpError("Income record not found", 404);
  if (doc.status === "Cancelled") throw httpError("Cannot receive payment on cancelled income", 400);
  await applyIncomeReceipt(doc, payload.amount, payload, editor);
  await createActivityLog({
    section: "Income",
    action: "receive",
    message: `Received payment on income ${doc.incomeId}`,
    actor: actorOf(editor),
    resourceId: doc.incomeId,
  }).catch(() => {});
  emitSectionUpdate({ section: "Income", action: "receive", resourceId: doc.incomeId });
  return toIncomeRow(doc);
}

export async function getIncomeDashboard(params = {}) {
  await ensureFinanceDefaults();
  await maybeSyncFeePayments();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { from, to } = rangeFromPreset(params.preset || "month", params.from, params.to);
  const base = { status: { $ne: "Cancelled" } };
  const uni = asObjectId(params.universityId);
  if (uni) base.universityId = uni;

  const feeMatch = {
    sourceType: "FEE",
    status: { $in: ["Completed", "Partial"] },
    ...(uni ? { universityId: uni } : {}),
  };

  const [otherAll, otherMonth, pending, received, feeAll, feeMonth, byCategory, monthlyOther, monthlyFee] =
    await Promise.all([
      IncomeRecord.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
      IncomeRecord.aggregate([
        { $match: { ...base, date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$receivedAmount" } } },
      ]),
      IncomeRecord.aggregate([
        { $match: { ...base, status: { $in: ["Pending", "Partial"] } } },
        { $group: { _id: null, total: { $sum: { $subtract: ["$totalAmount", "$receivedAmount"] } }, count: { $sum: 1 } } },
      ]),
      IncomeRecord.aggregate([
        { $match: { ...base, status: "Received" } },
        { $group: { _id: null, total: { $sum: "$receivedAmount" }, count: { $sum: 1 } } },
      ]),
      FinancePayment.aggregate([{ $match: feeMatch }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      FinancePayment.aggregate([
        { $match: { ...feeMatch, date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      IncomeRecord.aggregate([
        { $match: { ...base, date: { $gte: from, $lt: to } } },
        { $group: { _id: "$categoryName", value: { $sum: "$receivedAmount" } } },
        { $sort: { value: -1 } },
      ]),
      IncomeRecord.aggregate([
        { $match: { ...base, date: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
        { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, total: { $sum: "$receivedAmount" } } },
      ]),
      FinancePayment.aggregate([
        { $match: { ...feeMatch, date: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
        { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, total: { $sum: "$amount" } } },
      ]),
    ]);

  const feeIncome = feeAll[0]?.total || 0;
  const otherIncome = otherAll[0]?.total || 0;
  const trend = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const other = monthlyOther.find((r) => r._id.y === d.getFullYear() && r._id.m === d.getMonth() + 1)?.total || 0;
    const fee = monthlyFee.find((r) => r._id.y === d.getFullYear() && r._id.m === d.getMonth() + 1)?.total || 0;
    trend.push({
      name: d.toLocaleDateString("en-IN", { month: "short" }),
      other,
      fees: fee,
      value: other + fee,
    });
  }

  const categories = [{ name: "Student Fees", value: feeIncome }, ...byCategory.map((r) => ({ name: r._id, value: r.value }))];

  return {
    totalIncome: feeIncome + (received[0]?.total || 0),
    thisMonthIncome: (feeMonth[0]?.total || 0) + (otherMonth[0]?.total || 0),
    pendingIncome: pending[0]?.total || 0,
    pendingCount: pending[0]?.count || 0,
    receivedIncome: (received[0]?.total || 0) + feeIncome,
    outstandingReceivables: pending[0]?.total || 0,
    feeIncome,
    otherIncome,
    byCategory: categories.filter((c) => c.value > 0),
    monthlyTrend: trend,
  };
}
