import { PAYMENT_METHODS } from "./finance.constants.js";
import { recordFinancePayment } from "./payments.service.js";
import { str } from "./finance.utils.js";

function isDiscount(payment) {
  return str(payment?.method).toLowerCase() === "discount" || str(payment?.mode).toLowerCase() === "discount";
}

function isSuccess(payment) {
  const status = str(payment?.status).toLowerCase();
  return status === "success" || status === "paid" || status === "completed";
}

export async function onFeePaymentRecorded(feeDoc, payment, editor = "master-admin") {
  if (!payment?.id || isDiscount(payment)) return;
  if (!isSuccess(payment)) return;
  const method = PAYMENT_METHODS.includes(str(payment.method)) ? str(payment.method) : "Cash";
  try {
    await recordFinancePayment({
      direction: "IN",
      sourceType: "FEE",
      sourceId: payment.id,
      action: "collect",
      partyType: "STUDENT",
      partyId: feeDoc.admissionId || feeDoc.feeId,
      partyName: feeDoc.student,
      amount: payment.amount,
      method,
      date: payment.date,
      referenceNumber: payment.invoice || payment.id,
      notes: payment.note || "",
      editor,
      incomeAccountCode: "4000",
    });
  } catch (err) {
    console.error("finance fee payment bridge failed:", err?.message || err);
  }
}

export async function onFeePaymentUpdated(feeDoc, payment, previous, editor = "master-admin") {
  if (!payment?.id || isDiscount(payment)) return;
  const becameRefunded =
    str(payment.status).toLowerCase() === "refunded" &&
    str(previous?.status).toLowerCase() !== "refunded";
  try {
    if (becameRefunded) {
      await recordFinancePayment({
        direction: "OUT",
        sourceType: "REFUND",
        sourceId: `${payment.id}:refund`,
        action: "refund",
        partyType: "STUDENT",
        partyId: feeDoc.admissionId || feeDoc.feeId,
        partyName: feeDoc.student,
        amount: payment.amount,
        method: PAYMENT_METHODS.includes(str(payment.method)) ? str(payment.method) : "Cash",
        date: payment.refundedAt || new Date(),
        refundOf: payment.id,
        refundReason: payment.note || "Fee refund",
        editor,
        expenseAccountCode: "4000",
      });
      return;
    }
    if (isSuccess(payment)) {
      await onFeePaymentRecorded(feeDoc, payment, editor);
    }
  } catch (err) {
    console.error("finance fee payment update bridge failed:", err?.message || err);
  }
}
