import { StudentFee } from "../fees/fees.model.js";
import { ACCOUNT_TYPES } from "./finance.constants.js";
import { nextFinanceId } from "./finance.ids.js";
import {
  AccountingTransaction,
  ChartAccount,
  Expense,
  IncomeRecord,
  PayrollItem,
} from "./finance.models.js";
import { getCashFlow, getPaymentsDashboard, maybeSyncFeePayments } from "./payments.service.js";
import {
  actorOf,
  asObjectId,
  escapeRegex,
  formatDateLabel,
  httpError,
  money,
  paginationMeta,
  paginationParams,
  rangeFromPreset,
  str,
  toIsoDate,
} from "./finance.utils.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";

function toAccountRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.code,
    code: d.code,
    name: d.name,
    type: d.type,
    parentCode: d.parentCode || "",
    description: d.description || "",
    status: d.status,
    system: Boolean(d.system),
  };
}

function toTxnRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.transactionId,
    transactionId: d.transactionId,
    date: toIsoDate(d.date),
    dateLabel: formatDateLabel(d.date),
    dateRaw: d.date,
    description: d.description || "",
    referenceNumber: d.referenceNumber || "",
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    action: d.action,
    paymentId: d.paymentId || "",
    lines: d.lines || [],
    debitTotal: money(d.debitTotal),
    creditTotal: money(d.creditTotal),
    status: d.status,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
  };
}

export async function listChartAccounts(params = {}) {
  await ensureFinanceDefaults();
  const query = {};
  if (params.type && ACCOUNT_TYPES.includes(params.type)) query.type = params.type;
  if (params.status) query.status = params.status;
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ code: rx }, { name: rx }, { description: rx }];
  }
  const rows = await ChartAccount.find(query).sort({ code: 1 }).lean();
  return rows.map(toAccountRow);
}

export async function upsertChartAccount(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const code = str(payload.code).toUpperCase();
  const name = str(payload.name);
  if (!code) throw httpError("Account code is required", 400);
  if (!name) throw httpError("Account name is required", 400);
  if (payload.type && !ACCOUNT_TYPES.includes(payload.type)) throw httpError("Invalid account type", 400);
  let doc = await ChartAccount.findOne({ code });
  if (!doc) {
    doc = await ChartAccount.create({
      code,
      name,
      type: payload.type || "Expense",
      parentCode: str(payload.parentCode).toUpperCase(),
      description: str(payload.description),
      status: payload.status === "Inactive" ? "Inactive" : "Active",
      createdBy: actorOf(editor),
      updatedBy: actorOf(editor),
    });
  } else {
    doc.name = name;
    if (payload.type) doc.type = payload.type;
    if (payload.parentCode != null) doc.parentCode = str(payload.parentCode).toUpperCase();
    if (payload.description != null) doc.description = str(payload.description);
    if (payload.status) doc.status = payload.status === "Inactive" ? "Inactive" : "Active";
    doc.updatedBy = actorOf(editor);
    await doc.save();
  }
  return toAccountRow(doc);
}

export async function setChartAccountStatus(id, status, editor) {
  const oid = asObjectId(id);
  const doc = await ChartAccount.findOne(oid ? { $or: [{ _id: oid }, { code: str(id).toUpperCase() }] } : { code: str(id).toUpperCase() });
  if (!doc) throw httpError("Account not found", 404);
  doc.status = status === "Inactive" ? "Inactive" : "Active";
  doc.updatedBy = actorOf(editor);
  await doc.save();
  return toAccountRow(doc);
}

export async function listAccountingTransactions(params = {}) {
  await ensureFinanceDefaults();
  const { page, limit, skip } = paginationParams(params);
  const query = { status: params.status === "Reversed" ? "Reversed" : "Posted" };
  if (params.status === "all") delete query.status;
  if (params.sourceType) query.sourceType = str(params.sourceType).toUpperCase();
  if (params.account || params.accountCode) query["lines.accountCode"] = str(params.account || params.accountCode).toUpperCase();
  const uni = asObjectId(params.universityId);
  if (uni) query.universityId = uni;
  if (params.from || params.to || params.preset || params.range) {
    const { from, to } = rangeFromPreset(params.preset || params.range, params.from, params.to);
    query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  }
  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ transactionId: rx }, { description: rx }, { referenceNumber: rx }, { sourceId: rx }, { paymentId: rx }];
  }
  const [rows, total] = await Promise.all([
    AccountingTransaction.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    AccountingTransaction.countDocuments(query),
  ]);
  return { rows: rows.map(toTxnRow), pagination: paginationMeta(page, limit, total) };
}

export async function getAccountingTransaction(id) {
  const oid = asObjectId(id);
  const doc = await AccountingTransaction.findOne(
    oid ? { $or: [{ _id: oid }, { transactionId: str(id) }] } : { transactionId: str(id) }
  );
  return doc ? toTxnRow(doc) : null;
}

export async function getLedger(params = {}) {
  await ensureFinanceDefaults();
  const accountCode = str(params.account || params.accountCode).toUpperCase();
  if (!accountCode) throw httpError("Account is required", 400);
  const account = await ChartAccount.findOne({ code: accountCode }).lean();
  if (!account) throw httpError("Account not found", 404);
  const { from, to } = rangeFromPreset(params.preset || params.range || "fy", params.from, params.to);

  const prior = await AccountingTransaction.aggregate([
    { $match: { status: "Posted", date: { $lt: from }, "lines.accountCode": accountCode } },
    { $unwind: "$lines" },
    { $match: { "lines.accountCode": accountCode } },
    { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  const opening = (prior[0]?.debit || 0) - (prior[0]?.credit || 0);

  const txns = await AccountingTransaction.find({
    status: "Posted",
    date: { $gte: from, $lt: to },
    "lines.accountCode": accountCode,
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  let balance = opening;
  const rows = [];
  for (const txn of txns) {
    const line = (txn.lines || []).find((l) => l.accountCode === accountCode);
    if (!line) continue;
    const debit = money(line.debit);
    const credit = money(line.credit);
    if (account.type === "Asset" || account.type === "Expense") balance += debit - credit;
    else balance += credit - debit;
    rows.push({
      date: toIsoDate(txn.date),
      dateLabel: formatDateLabel(txn.date),
      transactionId: txn.transactionId,
      referenceNumber: txn.referenceNumber || "",
      description: txn.description || "",
      sourceType: txn.sourceType,
      sourceId: txn.sourceId,
      debit,
      credit,
      balance,
    });
  }

  return {
    account: toAccountRow(account),
    from: toIsoDate(from),
    to: toIsoDate(to),
    openingBalance: opening,
    closingBalance: balance,
    rows,
  };
}

export async function getAccountingDashboard(params = {}) {
  await ensureFinanceDefaults();
  await maybeSyncFeePayments();
  const { from, to } = rangeFromPreset(params.preset || params.range || "month", params.from, params.to);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const uni = asObjectId(params.universityId);

  const payDash = await getPaymentsDashboard({ ...params, from: toIsoDate(from), to: toIsoDate(new Date(to.getTime() - 1)) });
  const cashFlow = await getCashFlow(params);

  const feeQuery = uni ? { universityId: uni } : {};
  const [feeDue, unpaidExpenses, unpaidPayroll, unpaidIncome, monthIn, monthOut, incomeCats, expenseCats] = await Promise.all([
    StudentFee.aggregate([{ $group: { _id: null, due: { $sum: "$dueAmount" }, paid: { $sum: "$paidAmount" } } }]),
    Expense.aggregate([
      { $match: { workflowStatus: { $nin: ["Cancelled"] }, paymentStatus: { $in: ["Pending", "Partially Paid"] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$totalAmount", "$paidAmount"] } } } },
    ]),
    PayrollItem.aggregate([
      { $match: { status: { $nin: ["Cancelled", "Paid"] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$netPayable", "$paidAmount"] } } } },
    ]),
    IncomeRecord.aggregate([
      { $match: { status: { $in: ["Pending", "Partial"] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ["$totalAmount", "$receivedAmount"] } } } },
    ]),
    AccountingTransaction.aggregate([
      { $match: { status: "Posted", date: { $gte: monthStart }, "lines.accountType": "Income" } },
      { $unwind: "$lines" },
      { $match: { "lines.accountType": "Income" } },
      { $group: { _id: null, total: { $sum: "$lines.credit" } } },
    ]),
    AccountingTransaction.aggregate([
      { $match: { status: "Posted", date: { $gte: monthStart }, "lines.accountType": "Expense" } },
      { $unwind: "$lines" },
      { $match: { "lines.accountType": "Expense" } },
      { $group: { _id: null, total: { $sum: "$lines.debit" } } },
    ]),
    AccountingTransaction.aggregate([
      { $match: { status: "Posted", date: { $gte: from, $lt: to } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountType": "Income", "lines.credit": { $gt: 0 } } },
      { $group: { _id: "$lines.accountName", value: { $sum: "$lines.credit" } } },
      { $sort: { value: -1 } },
    ]),
    AccountingTransaction.aggregate([
      { $match: { status: "Posted", date: { $gte: from, $lt: to } } },
      { $unwind: "$lines" },
      { $match: { "lines.accountType": "Expense", "lines.debit": { $gt: 0 } } },
      { $group: { _id: "$lines.accountName", value: { $sum: "$lines.debit" } } },
      { $sort: { value: -1 } },
    ]),
  ]);

  const books = payDash.accounts || [];
  const cashBalance = books.filter((b) => b.type === "Cash" || b.type === "Petty Cash").reduce((s, b) => s + (b.currentBalance || 0), 0);
  const bankBalance = books.filter((b) => b.type === "Bank" || b.type === "UPI").reduce((s, b) => s + (b.currentBalance || 0), 0);

  const monthly = {};
  for (const row of payDash.monthlyCashFlow || []) {
    monthly[row.name] = { name: row.name, income: row.inflow, expenses: row.outflow };
  }

  return {
    totalIncome: payDash.totalReceived,
    totalExpenses: payDash.totalPaid,
    netProfit: payDash.totalReceived - payDash.totalPaid,
    cashBalance,
    bankBalance,
    pendingReceivables: (feeDue[0]?.due || 0) + (unpaidIncome[0]?.total || 0),
    pendingPayables: (unpaidExpenses[0]?.total || 0) + (unpaidPayroll[0]?.total || 0),
    thisMonthIncome: monthIn[0]?.total || 0,
    thisMonthExpenses: monthOut[0]?.total || 0,
    feeCollected: feeDue[0]?.paid || 0,
    feePending: feeDue[0]?.due || 0,
    incomeByCategory: incomeCats.map((r) => ({ name: r._id, value: r.value })),
    expenseByCategory: expenseCats.map((r) => ({ name: r._id, value: r.value })),
    monthlyIncomeVsExpenses: Object.values(monthly),
    cashFlowTrend: payDash.monthlyCashFlow || [],
    cashFlow,
    accounts: books,
  };
}

export async function createManualJournal(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length < 2) throw httpError("A journal needs at least two lines", 400);
  let debit = 0;
  let credit = 0;
  const resolved = [];
  for (const line of lines) {
    const account = await ChartAccount.findOne({ code: str(line.accountCode).toUpperCase(), status: "Active" }).lean();
    if (!account) throw httpError(`Account ${line.accountCode} not found`, 400);
    const d = money(line.debit);
    const c = money(line.credit);
    if (d && c) throw httpError("A line cannot have both debit and credit", 400);
    if (!d && !c) continue;
    debit += d;
    credit += c;
    resolved.push({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      debit: d,
      credit: c,
    });
  }
  if (debit !== credit) throw httpError("Debits and credits must be equal", 400);
  if (debit <= 0) throw httpError("Journal amount must be greater than 0", 400);
  const sourceId = str(payload.sourceId) || `MANUAL-${Date.now()}`;
  const transactionId = await nextFinanceId("acc", "ACC-", 5);
  const doc = await AccountingTransaction.create({
    transactionId,
    date: payload.date ? new Date(payload.date) : new Date(),
    description: str(payload.description) || "Manual journal",
    referenceNumber: str(payload.referenceNumber),
    sourceType: "OTHER",
    sourceId,
    action: "adjust",
    lines: resolved,
    debitTotal: debit,
    creditTotal: credit,
    status: "Posted",
    createdBy: actorOf(editor),
  });
  return toTxnRow(doc);
}
