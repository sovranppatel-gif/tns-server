import {
  METHOD_TO_ACCOUNT,
} from "./finance.constants.js";
import { nextFinanceId } from "./finance.ids.js";
import {
  AccountingTransaction,
  ChartAccount,
  FinancialAccount,
} from "./finance.models.js";
import { actorOf, httpError, money, str } from "./finance.utils.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";

export function accountCodeForMethod(method) {
  return METHOD_TO_ACCOUNT[str(method)] || "CASH";
}

export async function getChartAccount(code) {
  const key = str(code).toUpperCase();
  if (!key) return null;
  return ChartAccount.findOne({ code: key, status: "Active" }).lean();
}

export async function getFinancialAccount(code) {
  const key = str(code).toUpperCase();
  if (!key) return null;
  return FinancialAccount.findOne({ accountCode: key, status: "Active" });
}

async function lineFor(code, debit, credit) {
  const account = await getChartAccount(code);
  if (!account) throw httpError(`Chart account ${code} not found or inactive`, 400);
  return {
    accountCode: account.code,
    accountName: account.name,
    accountType: account.type,
    debit: money(debit),
    credit: money(credit),
  };
}

export async function applyFinancialBalance(accountCode, delta, editor) {
  const code = str(accountCode).toUpperCase();
  if (!code || !delta) return null;
  const account = await FinancialAccount.findOne({ accountCode: code });
  if (!account) return null;
  account.currentBalance = (Number(account.currentBalance) || 0) + delta;
  account.updatedBy = actorOf(editor);
  await account.save();
  return account;
}

export async function findLedger(sourceType, sourceId, action) {
  return AccountingTransaction.findOne({
    sourceType,
    sourceId: str(sourceId),
    action,
  });
}

/**
 * Idempotent double-entry post.
 * If a posted entry already exists for sourceType+sourceId+action, it is returned unchanged
 * unless `amount` differs, in which case balances are adjusted by the delta and lines updated.
 */
export async function postLedger({
  sourceType,
  sourceId,
  action,
  date,
  description,
  referenceNumber = "",
  paymentId = "",
  universityId = null,
  debitCode,
  creditCode,
  amount,
  editor,
  cashAccountCode = "",
  cashDelta = 0,
} = {}) {
  await ensureFinanceDefaults();
  const value = money(amount);
  if (value <= 0) throw httpError("Ledger amount must be greater than 0", 400);
  if (!sourceType || !sourceId || !action) {
    throw httpError("sourceType, sourceId and action are required", 400);
  }

  const existing = await findLedger(sourceType, sourceId, action);
  if (existing && existing.status === "Posted") {
    const prev = money(existing.debitTotal);
    if (prev === value) return existing.toObject ? existing.toObject() : existing;
    const delta = value - prev;
    existing.lines = [
      await lineFor(debitCode, value, 0),
      await lineFor(creditCode, 0, value),
    ];
    existing.debitTotal = value;
    existing.creditTotal = value;
    existing.description = description || existing.description;
    existing.referenceNumber = referenceNumber || existing.referenceNumber;
    existing.date = date || existing.date;
    await existing.save();
    if (cashAccountCode && delta) {
      await applyFinancialBalance(cashAccountCode, cashDelta < 0 ? -delta : delta, editor);
    }
    return existing.toObject();
  }

  const lines = [
    await lineFor(debitCode, value, 0),
    await lineFor(creditCode, 0, value),
  ];
  const transactionId = await nextFinanceId("acc", "ACC-", 5);
  try {
    const doc = await AccountingTransaction.create({
      transactionId,
      date: date || new Date(),
      description: str(description),
      referenceNumber: str(referenceNumber),
      sourceType,
      sourceId: str(sourceId),
      action,
      paymentId: str(paymentId),
      universityId: universityId || null,
      lines,
      debitTotal: value,
      creditTotal: value,
      status: "Posted",
      createdBy: actorOf(editor),
    });
    if (cashAccountCode && cashDelta) {
      await applyFinancialBalance(cashAccountCode, cashDelta, editor);
    }
    return doc.toObject();
  } catch (err) {
    if (err?.code === 11000) {
      const again = await findLedger(sourceType, sourceId, action);
      if (again) return again.toObject ? again.toObject() : again;
    }
    throw err;
  }
}

export async function reverseLedger({ sourceType, sourceId, action, editor, cashAccountCode = "", cashDelta = 0 }) {
  const existing = await findLedger(sourceType, sourceId, action);
  if (!existing || existing.status === "Reversed") return existing;
  existing.status = "Reversed";
  existing.reversedBy = actorOf(editor);
  await existing.save();
  if (cashAccountCode && cashDelta) {
    await applyFinancialBalance(cashAccountCode, cashDelta, editor);
  }
  return existing.toObject();
}
