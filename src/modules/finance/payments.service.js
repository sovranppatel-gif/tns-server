import { StudentFee } from "../fees/fees.model.js";
import {
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_SOURCE_TYPES,
  PAYMENT_STATUSES,
} from "./finance.constants.js";
import { nextFinanceId } from "./finance.ids.js";
import {
  accountCodeForMethod,
  postLedger,
  reverseLedger,
} from "./ledger.service.js";
import { FinancePayment, FinancialAccount } from "./finance.models.js";
import {
  actorOf,
  asObjectId,
  escapeRegex,
  formatDateLabel,
  httpError,
  isCompletedStatus,
  maskAccountNumber,
  money,
  paginationMeta,
  paginationParams,
  rangeFromPreset,
  str,
  toIsoDate,
} from "./finance.utils.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";

function incomeAccountFor(sourceType, override) {
  if (override) return override;
  if (sourceType === "FEE") return "4000";
  if (sourceType === "INCOME") return "4090";
  if (sourceType === "REFUND") return "4000";
  return "4090";
}

function expenseAccountFor(sourceType, override, employeeType) {
  if (override) return override;
  if (sourceType === "PAYROLL") return employeeType === "STAFF" ? "5010" : "5000";
  if (sourceType === "EXPENSE") return "5990";
  if (sourceType === "ADVANCE" || sourceType === "LOAN") return "1210";
  return "5990";
}

function toPaymentRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: d.paymentId,
    paymentId: d.paymentId,
    date: toIsoDate(d.date),
    dateLabel: formatDateLabel(d.date),
    dateRaw: d.date,
    direction: d.direction,
    type: d.direction === "IN" ? "Incoming" : "Outgoing",
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    action: d.action,
    source: d.sourceType,
    partyType: d.partyType,
    partyId: d.partyId,
    partyName: d.partyName,
    party: d.partyName,
    amount: money(d.amount),
    method: d.method,
    account: d.financialAccountCode,
    financialAccountCode: d.financialAccountCode,
    status: d.status,
    referenceNumber: d.referenceNumber || "",
    notes: d.notes || "",
    refundOf: d.refundOf || "",
    refundReason: d.refundReason || "",
    universityId: d.universityId ? String(d.universityId) : "",
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: d.createdAt,
  };
}

export function serializePayment(doc) {
  return toPaymentRow(doc);
}

export async function findPaymentBySource(sourceType, sourceId, action) {
  return FinancePayment.findOne({
    sourceType,
    sourceId: str(sourceId),
    action: str(action),
  });
}

async function postForPayment(payment, { debitCode, creditCode, cashDelta }) {
  const book = await FinancialAccount.findOne({
    accountCode: payment.financialAccountCode,
  }).lean();
  const chartCode = book?.chartCode || (payment.direction === "IN" ? debitCode : creditCode);
  return postLedger({
    sourceType: payment.sourceType,
    sourceId: payment.sourceId,
    action: payment.action,
    date: payment.date,
    description: `${payment.direction === "IN" ? "Receipt" : "Payment"} ${payment.paymentId} — ${payment.partyName || payment.sourceType}`,
    referenceNumber: payment.referenceNumber || payment.paymentId,
    paymentId: payment.paymentId,
    universityId: payment.universityId || null,
    debitCode: debitCode || chartCode,
    creditCode,
    amount: payment.amount,
    editor: payment.createdBy,
    cashAccountCode: isCompletedStatus(payment.status) ? payment.financialAccountCode : "",
    cashDelta: isCompletedStatus(payment.status) ? cashDelta : 0,
  });
}

/**
 * Create a central payment + accounting entry. Idempotent on sourceType+sourceId+action.
 */
export async function recordFinancePayment({
  direction,
  sourceType,
  sourceId,
  action = "collect",
  partyType = "OTHER",
  partyId = "",
  partyName = "",
  amount,
  method = "Cash",
  financialAccountCode,
  universityId = null,
  status = "Completed",
  referenceNumber = "",
  notes = "",
  date,
  refundOf = "",
  refundReason = "",
  editor,
  incomeAccountCode,
  expenseAccountCode,
  employeeType,
} = {}) {
  await ensureFinanceDefaults();
  const value = money(amount);
  if (value <= 0) throw httpError("Payment amount must be greater than 0", 400);
  if (!PAYMENT_DIRECTIONS.includes(direction)) throw httpError("Invalid payment direction", 400);
  if (!PAYMENT_SOURCE_TYPES.includes(sourceType)) throw httpError("Invalid payment source", 400);

  const methodName = PAYMENT_METHODS.includes(str(method)) ? str(method) : "Cash";
  const accountCode = str(financialAccountCode).toUpperCase() || accountCodeForMethod(methodName);
  const book = await FinancialAccount.findOne({ accountCode, status: "Active" });
  if (!book) throw httpError("Payment account is inactive or missing", 400);

  const existing = await findPaymentBySource(sourceType, sourceId, action);
  if (existing) {
    if (money(existing.amount) === value && existing.status === status) {
      return toPaymentRow(existing);
    }
    const prevAmount = money(existing.amount);
    const wasComplete = isCompletedStatus(existing.status);
    const nowComplete = isCompletedStatus(status);
    if (wasComplete && nowComplete && prevAmount !== value) {
      const delta = value - prevAmount;
      await applyCashDelta(existing.financialAccountCode, direction === "IN" ? delta : -delta, editor);
    } else if (wasComplete && !nowComplete) {
      await applyCashDelta(existing.financialAccountCode, direction === "IN" ? -prevAmount : prevAmount, editor);
    } else if (!wasComplete && nowComplete) {
      await applyCashDelta(accountCode, direction === "IN" ? value : -value, editor);
    }
    existing.amount = value;
    existing.status = PAYMENT_STATUSES.includes(status) ? status : existing.status;
    existing.method = methodName;
    existing.financialAccountCode = accountCode;
    existing.referenceNumber = str(referenceNumber) || existing.referenceNumber;
    existing.notes = str(notes) || existing.notes;
    existing.partyName = str(partyName) || existing.partyName;
    existing.updatedBy = actorOf(editor);
    if (date) existing.date = date;
    await existing.save();
    if (nowComplete) {
      const pair = ledgerPair({
        direction,
        sourceType,
        incomeAccountCode,
        expenseAccountCode,
        employeeType,
        chartCode: book.chartCode,
      });
      await postLedger({
        sourceType,
        sourceId: str(sourceId),
        action,
        date: existing.date,
        description: `${direction === "IN" ? "Receipt" : "Payment"} ${existing.paymentId} — ${existing.partyName || sourceType}`,
        referenceNumber: existing.referenceNumber || existing.paymentId,
        paymentId: existing.paymentId,
        universityId: existing.universityId,
        debitCode: pair.debitCode,
        creditCode: pair.creditCode,
        amount: value,
        editor,
        cashAccountCode: "",
        cashDelta: 0,
      });
    }
    return toPaymentRow(existing);
  }

  const paymentId = await nextFinanceId("pay", "TXN-", 5);
  let doc;
  try {
    doc = await FinancePayment.create({
      paymentId,
      date: date || new Date(),
      direction,
      sourceType,
      sourceId: str(sourceId),
      action,
      partyType,
      partyId: str(partyId),
      partyName: str(partyName),
      amount: value,
      method: methodName,
      financialAccountCode: accountCode,
      universityId: asObjectId(universityId),
      status: PAYMENT_STATUSES.includes(status) ? status : "Completed",
      referenceNumber: str(referenceNumber),
      notes: str(notes),
      refundOf: str(refundOf),
      refundReason: str(refundReason),
      createdBy: actorOf(editor),
      updatedBy: actorOf(editor),
    });
  } catch (err) {
    if (err?.code === 11000) {
      const again = await findPaymentBySource(sourceType, sourceId, action);
      if (again) return toPaymentRow(again);
    }
    throw err;
  }

  if (isCompletedStatus(doc.status)) {
    const pair = ledgerPair({
      direction,
      sourceType,
      incomeAccountCode,
      expenseAccountCode,
      employeeType,
      chartCode: book.chartCode,
    });
    await postForPayment(doc, {
      debitCode: pair.debitCode,
      creditCode: pair.creditCode,
      cashDelta: direction === "IN" ? value : -value,
    });
  }

  return toPaymentRow(doc);
}

function ledgerPair({ direction, sourceType, incomeAccountCode, expenseAccountCode, employeeType, chartCode }) {
  if (direction === "IN") {
    return {
      debitCode: chartCode || "1000",
      creditCode: incomeAccountFor(sourceType, incomeAccountCode),
    };
  }
  return {
    debitCode: expenseAccountFor(sourceType, expenseAccountCode, employeeType),
    creditCode: chartCode || "1000",
  };
}

async function applyCashDelta(accountCode, delta, editor) {
  if (!delta) return;
  const account = await FinancialAccount.findOne({ accountCode: str(accountCode).toUpperCase() });
  if (!account) return;
  account.currentBalance = (Number(account.currentBalance) || 0) + delta;
  account.updatedBy = actorOf(editor);
  await account.save();
}

export async function refundFinancePayment(paymentId, payload = {}, editor = "master-admin") {
  const doc = await FinancePayment.findOne({
    $or: [{ paymentId: str(paymentId) }, ...(asObjectId(paymentId) ? [{ _id: asObjectId(paymentId) }] : [])],
  });
  if (!doc) throw httpError("Payment not found", 404);
  if (doc.direction !== "IN") throw httpError("Only incoming payments can be refunded from this action", 400);
  if (!isCompletedStatus(doc.status) && doc.status !== "Partial") {
    throw httpError("Only completed payments can be refunded", 400);
  }
  if (doc.status === "Refunded") throw httpError("Payment is already refunded", 400);

  const refundAmount = payload.amount != null && str(payload.amount) !== "" ? money(payload.amount) : money(doc.amount);
  if (refundAmount <= 0) throw httpError("Refund amount must be greater than 0", 400);
  if (refundAmount > money(doc.amount)) throw httpError("Refund cannot exceed original payment", 400);

  const method = PAYMENT_METHODS.includes(str(payload.method)) ? str(payload.method) : doc.method;
  const accountCode = str(payload.financialAccountCode).toUpperCase() || doc.financialAccountCode;
  const refundSourceId = `${doc.paymentId}:refund`;

  const refund = await recordFinancePayment({
    direction: "OUT",
    sourceType: "REFUND",
    sourceId: refundSourceId,
    action: "refund",
    partyType: doc.partyType,
    partyId: doc.partyId,
    partyName: doc.partyName,
    amount: refundAmount,
    method,
    financialAccountCode: accountCode,
    universityId: doc.universityId,
    status: "Completed",
    referenceNumber: str(payload.referenceNumber) || doc.paymentId,
    notes: str(payload.notes),
    date: payload.date ? new Date(payload.date) : new Date(),
    refundOf: doc.paymentId,
    refundReason: str(payload.reason || payload.refundReason),
    editor,
    expenseAccountCode: incomeAccountFor(doc.sourceType),
  });

  if (refundAmount >= money(doc.amount)) {
    doc.status = "Refunded";
  }
  doc.updatedBy = actorOf(editor);
  await doc.save();

  return { original: toPaymentRow(doc), refund };
}

export async function listPayments(params = {}) {
  await ensureFinanceDefaults();
  const { page, limit, skip, isExport } = paginationParams(params);
  const query = {};
  if (params.direction && PAYMENT_DIRECTIONS.includes(params.direction)) query.direction = params.direction;
  if (params.sourceType && PAYMENT_SOURCE_TYPES.includes(params.sourceType)) query.sourceType = params.sourceType;
  if (params.method && PAYMENT_METHODS.includes(params.method)) query.method = params.method;
  if (params.status && PAYMENT_STATUSES.includes(params.status)) query.status = params.status;
  if (params.account) query.financialAccountCode = str(params.account).toUpperCase();
  const uni = asObjectId(params.universityId);
  if (uni) query.universityId = uni;
  const { from, to } = rangeFromPreset(params.preset || params.range, params.from, params.to);
  if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };

  const search = str(params.search);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { paymentId: rx },
      { partyName: rx },
      { partyId: rx },
      { referenceNumber: rx },
      { sourceId: rx },
      { notes: rx },
    ];
  }

  const [rows, total] = await Promise.all([
    FinancePayment.find(query).sort({ date: -1, createdAt: -1 }).skip(isExport ? 0 : skip).limit(limit).lean(),
    FinancePayment.countDocuments(query),
  ]);
  return {
    rows: rows.map(toPaymentRow),
    pagination: paginationMeta(page, limit, total),
  };
}

export async function getPaymentById(id) {
  const oid = asObjectId(id);
  const doc = await FinancePayment.findOne(
    oid ? { $or: [{ _id: oid }, { paymentId: str(id) }] } : { paymentId: str(id) }
  );
  if (!doc) return null;
  return toPaymentRow(doc);
}

export async function getPaymentsDashboard(params = {}) {
  await ensureFinanceDefaults();
  const { from, to } = rangeFromPreset(params.preset || params.range || "month", params.from, params.to);
  const match = { status: { $in: ["Completed", "Partial"] } };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const uni = asObjectId(params.universityId);
  if (uni) match.universityId = uni;

  const [agg, methods, monthly, pending, failed, books] = await Promise.all([
    FinancePayment.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$direction",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    FinancePayment.aggregate([
      { $match: match },
      { $group: { _id: "$method", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    FinancePayment.aggregate([
      { $match: { ...match, date: { $gte: new Date(new Date().getFullYear(), 0, 1) } } },
      {
        $group: {
          _id: { y: { $year: "$date" }, m: { $month: "$date" }, dir: "$direction" },
          total: { $sum: "$amount" },
        },
      },
    ]),
    FinancePayment.countDocuments({ status: "Pending" }),
    FinancePayment.countDocuments({ status: { $in: ["Failed", "Cancelled"] } }),
    FinancialAccount.find({ status: "Active" }).lean(),
  ]);

  const received = agg.find((r) => r._id === "IN")?.total || 0;
  const paid = agg.find((r) => r._id === "OUT")?.total || 0;
  const methodMap = Object.fromEntries(methods.map((m) => [m._id, m.total]));
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const inAmt = monthly.find((r) => r._id.y === d.getFullYear() && r._id.m === d.getMonth() + 1 && r._id.dir === "IN")?.total || 0;
    const outAmt = monthly.find((r) => r._id.y === d.getFullYear() && r._id.m === d.getMonth() + 1 && r._id.dir === "OUT")?.total || 0;
    months.push({
      name: d.toLocaleDateString("en-IN", { month: "short" }),
      key,
      inflow: inAmt,
      outflow: outAmt,
      net: inAmt - outAmt,
    });
  }

  return {
    totalReceived: money(received),
    totalPaid: money(paid),
    cashTransactions: money(methodMap.Cash || 0),
    bankTransactions: money((methodMap["Bank Transfer"] || 0) + (methodMap.Cheque || 0) + (methodMap["Credit Card"] || 0) + (methodMap["Debit Card"] || 0) + (methodMap["Online Gateway"] || 0)),
    upiTransactions: money(methodMap.UPI || 0),
    pendingPayments: pending,
    failedCancelled: failed,
    methodDistribution: methods.map((m) => ({ name: m._id, value: m.total })),
    monthlyCashFlow: months,
    accounts: books.map((b) => ({
      accountCode: b.accountCode,
      name: b.name,
      type: b.type,
      currentBalance: b.currentBalance || 0,
      openingBalance: b.openingBalance || 0,
      bankName: b.bankName || "",
      accountNumberMasked: maskAccountNumber(b.accountNumber),
      ifsc: b.ifsc || "",
      status: b.status,
    })),
  };
}

export async function listFinancialAccounts() {
  await ensureFinanceDefaults();
  const rows = await FinancialAccount.find({}).sort({ accountCode: 1 }).lean();
  return rows.map((b) => ({
    _id: String(b._id),
    id: b.accountCode,
    accountCode: b.accountCode,
    name: b.name,
    type: b.type,
    chartCode: b.chartCode,
    bankName: b.bankName || "",
    accountNumberMasked: maskAccountNumber(b.accountNumber),
    ifsc: b.ifsc || "",
    openingBalance: b.openingBalance || 0,
    currentBalance: b.currentBalance || 0,
    status: b.status,
    notes: b.notes || "",
  }));
}

export async function upsertFinancialAccount(payload = {}, editor = "master-admin") {
  await ensureFinanceDefaults();
  const accountCode = str(payload.accountCode).toUpperCase();
  if (!accountCode) throw httpError("Account code is required", 400);
  const name = str(payload.name);
  if (!name) throw httpError("Account name is required", 400);
  const opening = money(payload.openingBalance);
  let doc = await FinancialAccount.findOne({ accountCode });
  if (!doc) {
    doc = await FinancialAccount.create({
      accountCode,
      name,
      type: payload.type || "Cash",
      chartCode: str(payload.chartCode).toUpperCase(),
      bankName: str(payload.bankName),
      accountNumber: str(payload.accountNumber),
      ifsc: str(payload.ifsc).toUpperCase(),
      openingBalance: opening,
      currentBalance: opening,
      status: payload.status === "Inactive" ? "Inactive" : "Active",
      notes: str(payload.notes),
      createdBy: actorOf(editor),
      updatedBy: actorOf(editor),
    });
  } else {
    const openingDelta = opening - (Number(doc.openingBalance) || 0);
    doc.name = name;
    doc.type = payload.type || doc.type;
    if (payload.chartCode) doc.chartCode = str(payload.chartCode).toUpperCase();
    doc.bankName = str(payload.bankName);
    if (payload.accountNumber) doc.accountNumber = str(payload.accountNumber);
    doc.ifsc = str(payload.ifsc).toUpperCase() || doc.ifsc;
    if (payload.openingBalance != null && str(payload.openingBalance) !== "") {
      doc.openingBalance = opening;
      doc.currentBalance = (Number(doc.currentBalance) || 0) + openingDelta;
    }
    if (payload.status) doc.status = payload.status === "Inactive" ? "Inactive" : "Active";
    doc.notes = str(payload.notes);
    doc.updatedBy = actorOf(editor);
    await doc.save();
  }
  const rows = await listFinancialAccounts();
  return rows.find((r) => r.accountCode === accountCode);
}

export async function getCashFlow(params = {}) {
  await ensureFinanceDefaults();
  const { from, to } = rangeFromPreset(params.preset || "month", params.from, params.to);
  const books = await FinancialAccount.find({ status: "Active" }).lean();
  const match = {
    status: { $in: ["Completed", "Partial"] },
    date: { $gte: from, $lt: to },
  };
  const uni = asObjectId(params.universityId);
  if (uni) match.universityId = uni;

  const byAccount = await FinancePayment.aggregate([
    { $match: match },
    {
      $group: {
        _id: { account: "$financialAccountCode", dir: "$direction" },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const before = await FinancePayment.aggregate([
    {
      $match: {
        status: { $in: ["Completed", "Partial"] },
        date: { $lt: from },
        ...(uni ? { universityId: uni } : {}),
      },
    },
    {
      $group: {
        _id: { account: "$financialAccountCode", dir: "$direction" },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const rows = books.map((book) => {
    const openingFromTx = (before || []).reduce((sum, row) => {
      if (row._id.account !== book.accountCode) return sum;
      return sum + (row._id.dir === "IN" ? row.total : -row.total);
    }, Number(book.openingBalance) || 0);
    const cashIn = byAccount.find((r) => r._id.account === book.accountCode && r._id.dir === "IN")?.total || 0;
    const cashOut = byAccount.find((r) => r._id.account === book.accountCode && r._id.dir === "OUT")?.total || 0;
    return {
      accountCode: book.accountCode,
      name: book.name,
      type: book.type,
      openingBalance: openingFromTx,
      cashIn,
      cashOut,
      closingBalance: openingFromTx + cashIn - cashOut,
    };
  });

  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
    rows,
    totals: {
      openingBalance: rows.reduce((s, r) => s + r.openingBalance, 0),
      cashIn: rows.reduce((s, r) => s + r.cashIn, 0),
      cashOut: rows.reduce((s, r) => s + r.cashOut, 0),
      closingBalance: rows.reduce((s, r) => s + r.closingBalance, 0),
    },
  };
}

function isSuccessfulFeePayment(p) {
  const status = str(p.status).toLowerCase();
  const method = str(p.method).toLowerCase();
  if (method === "discount") return false;
  return status === "success" || status === "paid" || status === "completed";
}

export async function syncFeePaymentsIntoFinance() {
  await ensureFinanceDefaults();
  const fees = await StudentFee.find({})
    .select("feeId student admissionId payments dueAmount paidAmount")
    .lean()
    .maxTimeMS(20000);
  let created = 0;
  for (const fee of fees) {
    for (const pay of fee.payments || []) {
      if (!pay?.id) continue;
      const method = str(pay.method);
      if (method.toLowerCase() === "discount") continue;
      const status = str(pay.status).toLowerCase();
      if (status === "failed" || status === "cancelled") continue;
      if (isSuccessfulFeePayment(pay) || status === "refunded") {
        const existing = await findPaymentBySource("FEE", pay.id, "collect");
        if (!existing && isSuccessfulFeePayment(pay)) {
          await recordFinancePayment({
            direction: "IN",
            sourceType: "FEE",
            sourceId: pay.id,
            action: "collect",
            partyType: "STUDENT",
            partyId: fee.admissionId || fee.feeId,
            partyName: fee.student,
            amount: pay.amount,
            method: PAYMENT_METHODS.includes(method) ? method : "Cash",
            date: pay.date,
            referenceNumber: pay.invoice || pay.id,
            notes: pay.note || "",
            editor: "fee-sync",
            incomeAccountCode: "4000",
          });
          created += 1;
        }
        if (status === "refunded") {
          const refundExisting = await findPaymentBySource("REFUND", `${pay.id}:refund`, "refund");
          if (!refundExisting) {
            await recordFinancePayment({
              direction: "OUT",
              sourceType: "REFUND",
              sourceId: `${pay.id}:refund`,
              action: "refund",
              partyType: "STUDENT",
              partyId: fee.admissionId || fee.feeId,
              partyName: fee.student,
              amount: pay.amount,
              method: PAYMENT_METHODS.includes(method) ? method : "Cash",
              date: pay.refundedAt || pay.date || new Date(),
              refundOf: existing?.paymentId || "",
              refundReason: pay.note || "Fee refund",
              editor: "fee-sync",
              expenseAccountCode: "4000",
            });
            created += 1;
          }
        }
      }
    }
  }
  return { created };
}

let lastFeeSync = 0;
export async function maybeSyncFeePayments() {
  if (Date.now() - lastFeeSync < 45000) return { skipped: true };
  lastFeeSync = Date.now();
  try {
    return await syncFeePaymentsIntoFinance();
  } catch (err) {
    console.error("fee payment sync failed:", err?.message || err);
    return { error: err.message };
  }
}

export { reverseLedger };
