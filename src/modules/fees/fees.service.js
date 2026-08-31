import mongoose from "mongoose";
import { Admission } from "../../models/Admission.js";
import { Course } from "../courses/courses.model.js";
import { StudentFee, FEE_STATUSES } from "./fees.model.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { notifyFeePaymentApproved } from "../../lib/studentNotifications.js";

export function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const raw = String(value || "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!raw || /as\s*per/i.test(raw)) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function formatINR(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isDateOnlyString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parsePaymentDate(input, fallbackDate) {
  if (input === undefined || input === null || String(input).trim() === "") {
    return fallbackDate ? new Date(fallbackDate) : new Date();
  }
  const raw = String(input).trim();
  if (isDateOnlyString(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const next = fallbackDate ? new Date(fallbackDate) : new Date();
    if (Number.isNaN(next.getTime())) return new Date(y, m - 1, d);
    next.setFullYear(y, m - 1, d);
    return next;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? fallbackDate
      ? new Date(fallbackDate)
      : new Date()
    : parsed;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function nextFeeId() {
  // Numeric max — lexical sort breaks after FEE-9 (FEE-9 > FEE-10 as strings)
  const rows = await StudentFee.find({ feeId: /^FEE-\d+$/i })
    .select("feeId")
    .lean()
    .maxTimeMS(10000);
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.feeId || "").replace(/^FEE-/i, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `FEE-${max + 1}`;
}

async function nextPaymentId() {
  const latest = await StudentFee.findOne({ "payments.id": /^PAY-\d+$/i })
    .select("payments.id")
    .lean();

  let max = 4000;
  if (latest?.payments?.length) {
    for (const p of latest.payments) {
      const n = parseInt(String(p.id || "").replace(/^PAY-/i, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  // Also scan recent docs for higher ids
  const recent = await StudentFee.find({})
    .sort({ updatedAt: -1 })
    .limit(50)
    .select("payments.id")
    .lean();
  for (const doc of recent) {
    for (const p of doc.payments || []) {
      const n = parseInt(String(p.id || "").replace(/^PAY-/i, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `PAY-${max + 1}`;
}

function resolveInstallmentCount(course, installmentAllowed) {
  if (!installmentAllowed) return 1;
  const semesters = Number(course?.semesterCount) || 0;
  if (semesters >= 2) return Math.min(semesters, 8);
  const months = Number(course?.durationMonths) || 0;
  if (months >= 12) return 4;
  if (months >= 6) return 3;
  return 4;
}

function computeStatus(total, paid, nextDue) {
  if (total <= 0) return "Paid";
  if (paid >= total) return "Paid";
  if (paid > 0) {
    if (nextDue && nextDue < new Date() && paid < total) return "Overdue";
    return "Partial";
  }
  if (nextDue && nextDue < new Date()) return "Overdue";
  return "Pending";
}

function refreshInstallmentStatuses(installments, now = new Date()) {
  return (installments || []).map((ins) => {
    const amount = Number(ins.amount) || 0;
    const paid = Math.min(Number(ins.paid) || 0, amount);
    let status = "Pending";
    if (amount <= 0 || paid >= amount) {
      status = "Paid";
    } else if (paid > 0) {
      status = "Partial";
    } else if (ins.dueDate && new Date(ins.dueDate) < now) {
      status = "Overdue";
    } else {
      status = "Due";
    }
    return {
      ...ins,
      paid,
      status,
      paidDate:
        status === "Paid"
          ? ins.paidDate || now
          : paid > 0
            ? ins.paidDate || null
            : null,
    };
  });
}

function recomputeTotals(doc) {
  const installments = refreshInstallmentStatuses(doc.installments || []);
  const totalAmount = installments.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const paidAmount = installments.reduce((s, i) => s + (Number(i.paid) || 0), 0);
  const dueAmount = Math.max(0, totalAmount - paidAmount);
  const paidCount = installments.filter((i) => i.status === "Paid").length;
  const nextOpen = installments.find((i) => i.status !== "Paid");
  const nextDueDate = nextOpen?.dueDate || null;
  const status = computeStatus(totalAmount, paidAmount, nextDueDate);

  return {
    installments,
    totalAmount,
    paidAmount,
    dueAmount,
    installmentCount: installments.length || 1,
    currentInstallment: Math.min(paidCount + (nextOpen ? 1 : 0), installments.length || 1),
    nextDueDate,
    status,
  };
}

function buildInstallments({
  totalAmount,
  registrationFee,
  startDate,
}) {
  const start = startDate instanceof Date ? startDate : new Date(startDate || Date.now());
  const items = [];
  let remaining = Math.max(0, totalAmount);

  if (registrationFee > 0) {
    const reg = Math.min(registrationFee, remaining);
    items.push({
      id: "INS-REG",
      label: "Registration Fee",
      category: "Registration",
      amount: reg,
      paid: 0,
      dueDate: start,
      paidDate: null,
      status: "Due",
    });
    remaining -= reg;
  }

  if (remaining > 0) {
    items.push({
      id: "INS-BAL",
      label: "Remaining Fee",
      category: "Tuition",
      amount: remaining,
      paid: 0,
      dueDate: start,
      paidDate: null,
      status: "Due",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "INS-BAL",
      label: "Course Fee",
      category: "Tuition",
      amount: Math.max(0, totalAmount),
      paid: 0,
      dueDate: start,
      paidDate: null,
      status: totalAmount > 0 ? "Due" : "Paid",
    });
  }

  return items;
}

function applyPaymentToInstallments(installments, amount, paidAt = new Date(), preferredId = "") {
  let left = Math.max(0, Number(amount) || 0);
  let next = installments.map((ins) => ({ ...ins }));
  let lastTouched = "";

  if (preferredId) {
    const idx = next.findIndex((i) => i.id === preferredId);
    if (idx >= 0) {
      const ordered = [next[idx], ...next.filter((_, i) => i !== idx)];
      const applied = applyPaymentToInstallments(ordered, left, paidAt, "");
      const map = new Map(applied.installments.map((i) => [i.id, i]));
      next = next.map((i) => map.get(i.id) || i);
      return {
        installments: next,
        leftover: applied.leftover,
        installmentId: applied.installmentId || preferredId,
      };
    }
  }

  for (const ins of next) {
    if (left <= 0) break;
    const need = Math.max(0, (Number(ins.amount) || 0) - (Number(ins.paid) || 0));
    if (need <= 0) continue;
    const apply = Math.min(need, left);
    ins.paid = (Number(ins.paid) || 0) + apply;
    if (ins.paid >= ins.amount) {
      ins.paidDate = paidAt;
      ins.status = "Paid";
    } else if (ins.paid > 0) {
      ins.paidDate = paidAt;
      ins.status = "Partial";
    }
    lastTouched = ins.id;
    left -= apply;
  }

  return { installments: next, leftover: left, installmentId: lastTouched };
}

function resetInstallmentPaid(installments) {
  return (installments || []).map((ins) => ({
    ...(typeof ins.toObject === "function" ? ins.toObject() : { ...ins }),
    paid: 0,
    paidDate: null,
    status: "Pending",
  }));
}

function isSuccessfulPayment(payment) {
  const status = String(payment?.status || "Success").trim().toLowerCase();
  return status === "success" || status === "paid" || status === "completed";
}

function isDiscountPayment(payment) {
  return /^(discount|waiver|scholarship)$/i.test(String(payment?.method || "").trim());
}

function sumSuccessfulDiscounts(payments) {
  return (payments || [])
    .filter((p) => isSuccessfulPayment(p) && isDiscountPayment(p))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/**
 * Rebuild installment paid amounts from the full payment list (chronological).
 * Used after editing/cancelling a payment so totals stay consistent.
 */
function rebuildInstallmentsFromPayments(installments, payments) {
  let next = resetInstallmentPaid(installments);
  const ordered = (payments || [])
    .slice()
    .filter(isSuccessfulPayment)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const updatedPayments = (payments || []).map((p) =>
    typeof p.toObject === "function" ? p.toObject() : { ...p }
  );

  for (const pay of ordered) {
    const amount = Number(pay.amount) || 0;
    if (amount <= 0) continue;
    const paidAt = pay.date ? new Date(pay.date) : new Date();
    const applied = applyPaymentToInstallments(next, amount, paidAt, pay.installmentId || "");
    next = applied.installments;
    const idx = updatedPayments.findIndex((p) => p.id === pay.id);
    if (idx >= 0 && applied.installmentId) {
      updatedPayments[idx] = {
        ...updatedPayments[idx],
        installmentId: applied.installmentId,
      };
    }
  }

  return {
    installments: next,
    payments: updatedPayments,
  };
}

function extractAdmissionPayment(details = {}) {
  const payment = details?.payment;
  if (payment && typeof payment === "object") {
    const amount = parseMoney(payment.amount);
    if (amount > 0) {
      return {
        amount,
        method:
          payment.onlineMethod ||
          payment.offlineMethod ||
          payment.method ||
          payment.mode ||
          "Admission payment",
        mode: payment.mode || "",
        note: payment.note || "Recorded at admission",
        proofName: payment.proofName || "",
        date: payment.date ? new Date(payment.date) : new Date(),
        installmentId: payment.installmentId || "INS-REG",
      };
    }
  }

  return null;
}

function isRegistrationInstallment(ins) {
  return (
    String(ins?.id || "") === "INS-REG" ||
    /registration\s*fee/i.test(String(ins?.label || ""))
  );
}

const FEE_TYPES = [
  { id: "INS-REG", label: "Registration Fee", category: "Registration" },
  { id: "INS-BAL", label: "Tuition Fee", category: "Tuition" },
  { id: "INS-EXAM", label: "Exam Fee", category: "Exam" },
  { id: "INS-LIB", label: "Library Fee", category: "Library" },
  { id: "INS-APP", label: "Apps Fee", category: "Apps" },
  { id: "INS-LAB", label: "Lab Fee", category: "Lab" },
  { id: "INS-HOST", label: "Hostel Fee", category: "Hostel" },
  { id: "INS-TRANS", label: "Transport Fee", category: "Transport" },
  { id: "INS-OTHER", label: "Other Fee", category: "Other" },
];

function findFeeType(idOrKey) {
  const key = String(idOrKey || "").trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  return (
    FEE_TYPES.find((t) => t.id === key) ||
    FEE_TYPES.find((t) => t.category.toLowerCase() === lower) ||
    FEE_TYPES.find((t) => t.label.toLowerCase() === lower) ||
    null
  );
}

function splitFeeTypeInstallment(installments, type, amount, dueDate) {
  const list = (installments || []).map((i) =>
    typeof i.toObject === "function" ? i.toObject() : { ...i }
  );
  if (!type?.id || amount <= 0 || list.some((i) => i.id === type.id)) return list;

  const source = [...list]
    .filter((i) => i.id !== type.id && i.id !== "INS-REG")
    .sort((a, b) => {
      const unpaidA = Math.max(0, (Number(a.amount) || 0) - (Number(a.paid) || 0));
      const unpaidB = Math.max(0, (Number(b.amount) || 0) - (Number(b.paid) || 0));
      if (a.id === "INS-BAL" && b.id !== "INS-BAL") return -1;
      if (b.id === "INS-BAL" && a.id !== "INS-BAL") return 1;
      return unpaidB - unpaidA;
    })[0];

  if (!source) return list;
  const unpaid = Math.max(0, (Number(source.amount) || 0) - (Number(source.paid) || 0));
  const carve = Math.min(amount, unpaid);
  if (carve <= 0) return list;

  source.amount = Math.max(Number(source.paid) || 0, (Number(source.amount) || 0) - carve);

  const next = list.filter((i) => (Number(i.amount) || 0) > 0 || (Number(i.paid) || 0) > 0);
  const item = {
    id: type.id,
    label: type.label,
    category: type.category,
    amount: carve,
    paid: 0,
    dueDate: dueDate || source.dueDate || new Date(),
    paidDate: null,
    status: "Due",
  };
  if (type.id === "INS-REG") {
    next.unshift(item);
  } else {
    const balIdx = next.findIndex((i) => i.id === "INS-BAL");
    if (balIdx >= 0) next.splice(balIdx, 0, item);
    else next.push(item);
  }
  return next;
}

function splitRegistrationInstallment(installments, registrationFee, dueDate) {
  return splitFeeTypeInstallment(
    installments,
    findFeeType("INS-REG"),
    registrationFee,
    dueDate
  );
}

async function persistRegistrationInstallment(doc) {
  if (!doc) return doc;
  const current = doc.installments || [];
  if (current.some(isRegistrationInstallment)) return doc;

  const course = await findCourseForAdmission({
    course: doc.course,
    details: { courseId: doc.courseId },
  });
  const registrationFee =
    parseMoney(doc.registrationFee) ||
    parseMoney(doc.courseFees?.registration) ||
    parseMoney(course?.fees?.registration);
  if (registrationFee <= 0) return doc;

  const split = splitRegistrationInstallment(
    current,
    registrationFee,
    doc.nextDueDate || new Date()
  );
  if (split === current || !split.some(isRegistrationInstallment)) return doc;

  const recomputed = recomputeTotals({ installments: split });
  const courseFees = {
    ...(doc.courseFees || {}),
    registration:
      doc.courseFees?.registration ||
      course?.fees?.registration ||
      formatINR(registrationFee),
  };

  await StudentFee.updateOne(
    { _id: doc._id },
    {
      $set: {
        ...recomputed,
        registrationFee,
        courseFees,
        syncedAt: new Date(),
      },
    }
  );

  return {
    ...doc,
    ...recomputed,
    registrationFee,
    courseFees,
  };
}

async function findCourseForAdmission(admission, courseCache = null) {
  const details = admission.details && typeof admission.details === "object" ? admission.details : {};
  const courseId = admission.courseId
    ? String(admission.courseId)
    : details.courseId
      ? String(details.courseId)
      : "";
  const courseName = String(admission.course || details.courseName || details.courseNameSnapshot || "").trim();

  if (courseCache) {
    if (courseId && courseCache.byId.has(courseId)) {
      return courseCache.byId.get(courseId);
    }
    if (courseName) {
      const exact = courseCache.byNameExact.get(courseName.toLowerCase());
      if (exact) return exact;
      for (const course of courseCache.list) {
        if (String(course.name || "").toLowerCase().includes(courseName.toLowerCase())) {
          return course;
        }
      }
    }
    return null;
  }

  if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
    const byId = await Course.findOne({
      _id: courseId,
      softDelete: { $ne: true },
    }).lean();
    if (byId) return byId;
  }

  if (!courseName) return null;

  const byName = await Course.findOne({
    softDelete: { $ne: true },
    name: new RegExp(`^${courseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).lean();
  if (byName) return byName;

  return Course.findOne({
    softDelete: { $ne: true },
    name: new RegExp(courseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  }).lean();
}

async function loadCourseCache() {
  const list = await Course.find({ softDelete: { $ne: true } })
    .select("name code fees semesterCount durationMonths")
    .lean();
  const byId = new Map(list.map((c) => [String(c._id), c]));
  const byNameExact = new Map(
    list.map((c) => [String(c.name || "").trim().toLowerCase(), c])
  );
  return { list, byId, byNameExact };
}

function resolveAmounts(admission, course) {
  const details = admission.details && typeof admission.details === "object" ? admission.details : {};
  const courseFees = course?.fees || {};
  const registrationFee = parseMoney(courseFees.registration);
  const examFee = parseMoney(courseFees.exam);
  const fromDetails = parseMoney(details.totalFee);
  const fromCourse = parseMoney(courseFees.total);
  const fromAdmissionFee = parseMoney(admission.fee);
  const initialPay = parseMoney(details?.payment?.amount);

  let totalAmount = fromDetails || fromCourse || 0;
  if (!totalAmount && fromAdmissionFee) {
    // Offline admissions often store only paid/deposit amount in `fee`
    totalAmount = Math.max(fromAdmissionFee, initialPay, registrationFee + examFee);
  }
  if (!totalAmount) {
    totalAmount = Math.max(registrationFee + examFee, initialPay, 5000);
  }

  const installmentAllowed =
    typeof courseFees.installmentAllowed === "boolean"
      ? courseFees.installmentAllowed
      : true;

  return {
    totalAmount,
    registrationFee,
    examFee,
    installmentAllowed,
    courseFees: {
      total: courseFees.total || details.totalFee || formatINR(totalAmount),
      registration:
        courseFees.registration ||
        (registrationFee ? formatINR(registrationFee) : ""),
      exam: courseFees.exam || (examFee ? formatINR(examFee) : ""),
      installmentAllowed,
    },
  };
}

function mapInstallment(ins) {
  const amount = Number(ins.amount) || 0;
  const paid = Number(ins.paid) || 0;
  const due = Math.max(0, amount - paid);
  return {
    id: ins.id,
    label: ins.label,
    category: ins.category || "Tuition",
    amount,
    amountLabel: formatINR(amount),
    paid,
    paidLabel: formatINR(paid),
    due,
    dueLabel: formatINR(due),
    dueDate: formatDate(ins.dueDate),
    paidDate: ins.paidDate ? formatDate(ins.paidDate) : "—",
    dueDateRaw: ins.dueDate ? new Date(ins.dueDate).toISOString() : null,
    paidDateRaw: ins.paidDate ? new Date(ins.paidDate).toISOString() : null,
    status: ins.status,
  };
}

function toListRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const paidCount = (d.installments || []).filter((i) => i.status === "Paid").length;
  const totalInst = d.installmentCount || (d.installments || []).length || 1;
  const pendingPayments = (d.payments || []).filter(
    (p) => String(p.status || "").trim().toLowerCase() === "pending"
  ).length;
  return {
    _id: String(d._id),
    id: d.feeId,
    feeId: d.feeId,
    admissionId: d.admissionId,
    admissionMongoId: d.admissionMongoId ? String(d.admissionMongoId) : null,
    student: d.student,
    email: d.email,
    phone: d.phone,
    course: d.course,
    courseId: d.courseId ? String(d.courseId) : null,
    courseCode: d.courseCode || "",
    category: d.category || "Tuition",
    installment: `${Math.min(paidCount || d.currentInstallment || 0, totalInst)}/${totalInst}`,
    amount: formatINR(d.totalAmount),
    paid: formatINR(d.paidAmount),
    due: formatINR(d.dueAmount),
    status: d.status,
    date: formatDate(d.nextDueDate || d.updatedAt || d.createdAt),
    totalAmount: d.totalAmount,
    paidAmount: d.paidAmount,
    dueAmount: d.dueAmount,
    discountAmount: sumSuccessfulDiscounts(d.payments),
    installmentCount: totalInst,
    currentInstallment: d.currentInstallment,
    nextDueDate: d.nextDueDate ? new Date(d.nextDueDate).toISOString() : null,
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
    pendingPayments,
    hasPendingPayments: pendingPayments > 0,
  };
}

function toDetail(doc) {
  const list = toListRow(doc);
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    ...list,
    notes: d.notes || "",
    installmentAllowed: Boolean(d.installmentAllowed),
    courseFees: d.courseFees || {},
    registrationFee: d.registrationFee || 0,
    examFee: d.examFee || 0,
    installments: (d.installments || []).map(mapInstallment),
    payments: (d.payments || [])
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((p) => ({
        id: p.id,
        invoice: p.invoice || "",
        method: p.method || p.mode || "—",
        mode: p.mode || "",
        amount: Number(p.amount) || 0,
        amountLabel: formatINR(p.amount),
        date: formatDate(p.date),
        dateRaw: p.date ? new Date(p.date).toISOString() : null,
        refundedAt: p.refundedAt ? new Date(p.refundedAt).toISOString() : null,
        status: p.status || "Success",
        note: p.note || "",
        installmentId: p.installmentId || "",
        proofName: p.proofName || "",
      })),
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    syncedAt: d.syncedAt ? new Date(d.syncedAt).toISOString() : null,
  };
}

function buildStats(rows) {
  let collected = 0;
  let pending = 0;
  let overdue = 0;
  let paidCount = 0;
  for (const row of rows) {
    collected += Number(row.paidAmount) || 0;
    pending += Number(row.dueAmount) || 0;
    if (row.status === "Overdue") overdue += Number(row.dueAmount) || 0;
    if (row.status === "Paid") paidCount += 1;
  }
  return {
    total: rows.length,
    collected: formatINR(collected),
    collectedRaw: collected,
    pending: formatINR(pending),
    pendingRaw: pending,
    overdue: formatINR(overdue),
    overdueRaw: overdue,
    paidCount,
    byStatus: Object.fromEntries(
      FEE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])
    ),
  };
}

async function createFeeFromAdmission(admission, course) {
  const amounts = resolveAmounts(admission, course);
  const startDate = admission.admissionDate ? new Date(admission.admissionDate) : new Date();

  let installments = buildInstallments({
    totalAmount: amounts.totalAmount,
    registrationFee: amounts.registrationFee,
    startDate,
  });

  const payments = [];
  const initial = extractAdmissionPayment(admission.details);
  if (initial) {
    const applied = applyPaymentToInstallments(
      installments,
      initial.amount,
      initial.date,
      initial.installmentId || "INS-REG"
    );
    installments = applied.installments;
    const payId = await nextPaymentId();
    payments.push({
      id: payId,
      invoice: `INV-${admission.admissionId}-01`,
      method: initial.method,
      mode: initial.mode,
      amount: initial.amount - (applied.leftover || 0),
      date: initial.date,
      status: "Success",
      note: initial.note || "Recorded at admission",
      installmentId: applied.installmentId || initial.installmentId || "",
      proofName: initial.proofName || "",
    });
  }

  const recomputed = recomputeTotals({ installments });
  const feeId = await nextFeeId();

  const doc = await StudentFee.create({
    feeId,
    admissionId: admission.admissionId,
    admissionMongoId: admission._id,
    student: admission.applicant,
    email: admission.email || "",
    phone: admission.phone || "",
    course: admission.course,
    courseId: course?._id || null,
    courseCode: course?.code || admission.details?.courseCode || "",
    category: "Tuition",
    registrationFee: amounts.registrationFee,
    examFee: amounts.examFee,
    installmentAllowed: amounts.installmentAllowed,
    courseFees: amounts.courseFees,
    payments,
    notes: admission.notes || "",
    syncedAt: new Date(),
    ...recomputed,
  });

  return doc;
}

function isAutoAdmissionPayment(payment) {
  const note = String(payment?.note || "");
  return /registration fee collected at admission|recorded at admission/i.test(note);
}

function hasExtraLedgerPayments(payments) {
  return (payments || []).some((p) => !isAutoAdmissionPayment(p));
}

function admissionDoc(admission) {
  return admission?.toObject ? admission.toObject() : admission;
}

/**
 * Create or rebuild the fee ledger from admission form amounts.
 * Rebuilds only when there are no extra (manual) payments yet.
 */
export async function upsertFeeFromAdmission(admissionInput) {
  const admission = admissionDoc(admissionInput);
  if (!admission?._id) return null;
  const admissionStatus = String(admission.status || "");
  if (admissionStatus === "Rejected" || admissionStatus === "Cancelled") return null;

  const existing = await StudentFee.findOne({ admissionMongoId: admission._id });
  const course = await findCourseForAdmission(admission);

  if (!existing) {
    return createFeeFromAdmission(admission, course);
  }

  if (hasExtraLedgerPayments(existing.payments)) return existing;

  const amounts = resolveAmounts(admission, course);
  const startDate = admission.admissionDate ? new Date(admission.admissionDate) : new Date();

  let installments = buildInstallments({
    totalAmount: amounts.totalAmount,
    registrationFee: amounts.registrationFee,
    startDate,
  });

  const payments = [];
  const initial = extractAdmissionPayment(admission.details);
  if (initial) {
    const applied = applyPaymentToInstallments(
      installments,
      initial.amount,
      initial.date,
      initial.installmentId || "INS-REG"
    );
    installments = applied.installments;
    const payId = await nextPaymentId();
    payments.push({
      id: payId,
      invoice: `INV-${admission.admissionId}-01`,
      method: initial.method,
      mode: initial.mode,
      amount: initial.amount - (applied.leftover || 0),
      date: initial.date,
      status: "Success",
      note: initial.note || "Recorded at admission",
      installmentId: applied.installmentId || initial.installmentId || "",
      proofName: initial.proofName || "",
    });
  }

  const recomputed = recomputeTotals({ installments });
  existing.set({
    student: admission.applicant,
    email: admission.email || "",
    phone: admission.phone || "",
    course: admission.course,
    courseId: course?._id || existing.courseId,
    courseCode: course?.code || admission.details?.courseCode || existing.courseCode,
    registrationFee: amounts.registrationFee,
    examFee: amounts.examFee,
    installmentAllowed: amounts.installmentAllowed,
    courseFees: amounts.courseFees,
    payments,
    notes: admission.notes || existing.notes || "",
    syncedAt: new Date(),
    ...recomputed,
  });
  await existing.save();
  return existing;
}

/**
 * Ensure missing fee ledgers exist for non-rejected admissions.
 * Existing records are left untouched (fast path for list/detail).
 */
let syncInFlight = null;
let lastSyncAt = 0;
const SYNC_COOLDOWN_MS = 15_000;

async function repairUnpaidRegistrationLedgers(admissions = null) {
  const list =
    admissions ||
    (await Admission.find({ status: { $ne: "Rejected" } })
      .select(
        "admissionId applicant email phone course fee notes details admissionDate status"
      )
      .lean());
  if (!list.length) return { created: 0, repaired: 0, skipped: true };

  const unpaid = await StudentFee.find({
    admissionMongoId: { $in: list.map((a) => a._id) },
    paidAmount: { $in: [0, null] },
  })
    .select("admissionMongoId")
    .lean();
  const unpaidIds = new Set(unpaid.map((e) => String(e.admissionMongoId)));

  let repaired = 0;
  for (const admission of list) {
    if (!unpaidIds.has(String(admission._id))) continue;
    if (parseMoney(admission.details?.registrationFee) <= 0) continue;
    try {
      await upsertFeeFromAdmission(admission);
      repaired += 1;
    } catch (err) {
      console.error(
        `fee repair failed for ${admission.admissionId}:`,
        err?.message || err
      );
    }
  }
  return { created: 0, repaired, skipped: true };
}

export async function syncFeesFromAdmissions({ force = false } = {}) {
  const now = Date.now();
  if (!force && syncInFlight) return syncInFlight;
  if (!force && now - lastSyncAt < SYNC_COOLDOWN_MS) {
    return repairUnpaidRegistrationLedgers();
  }

  syncInFlight = (async () => {
    const admissions = await Admission.find({ status: { $ne: "Rejected" } })
      .select(
        "admissionId applicant email phone course fee notes details admissionDate status"
      )
      .sort({ admissionDate: -1 })
      .lean();

    if (!admissions.length) {
      lastSyncAt = Date.now();
      return { created: 0, totalAdmissions: 0 };
    }

    const existing = await StudentFee.find({
      admissionMongoId: { $in: admissions.map((a) => a._id) },
    })
      .select("admissionMongoId paidAmount")
      .lean();
    const existingSet = new Set(existing.map((e) => String(e.admissionMongoId)));

    const missing = admissions.filter((a) => !existingSet.has(String(a._id)));
    const courseCache = await loadCourseCache();
    let created = 0;
    for (const admission of missing) {
      const course = await findCourseForAdmission(admission, courseCache);
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        try {
          await createFeeFromAdmission(admission, course);
          created += 1;
          break;
        } catch (err) {
          if (err?.code === 11000 && attempts < 5) {
            continue;
          }
          console.error(
            `fee create failed for ${admission.admissionId}:`,
            err?.message || err
          );
          break;
        }
      }
    }

    let repaired = 0;
    const unpaidIds = new Set(
      existing.filter((e) => !e.paidAmount).map((e) => String(e.admissionMongoId))
    );
    for (const admission of admissions) {
      if (!unpaidIds.has(String(admission._id))) continue;
      const registrationPaid = parseMoney(admission.details?.registrationFee);
      if (registrationPaid <= 0) continue;
      try {
        await upsertFeeFromAdmission(admission);
        repaired += 1;
      } catch (err) {
        console.error(
          `fee repair failed for ${admission.admissionId}:`,
          err?.message || err
        );
      }
    }

    lastSyncAt = Date.now();
    return { created, repaired, totalAdmissions: admissions.length };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

export async function listFees() {
  // Only creates missing ledgers; cooldown avoids repeat work on rapid refresh
  await syncFeesFromAdmissions();
  const docs = await StudentFee.find({}).sort({ updatedAt: -1 }).lean();
  const rows = docs.map(toListRow);
  return { rows, stats: buildStats(rows) };
}

export async function getFeeById(id) {
  // Fast path: never sync on detail open — that was causing multi-second delays
  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { feeId: id }] }
    : { feeId: id };
  let doc = await StudentFee.findOne(query).lean();
  if (!doc) return null;

  const hasMonthlySplit = (doc.installments || []).some((i) =>
    /monthly fee/i.test(String(i.label || ""))
  );
  const needsRebuild =
    !hasExtraLedgerPayments(doc.payments) &&
    (hasMonthlySplit || (!doc.paidAmount && doc.admissionMongoId));

  if (needsRebuild && doc.admissionMongoId) {
    const admission = await Admission.findById(doc.admissionMongoId).lean();
    if (admission && String(admission.status || "") !== "Rejected") {
      const updated = await upsertFeeFromAdmission(admission);
      if (updated) doc = updated.toObject ? updated.toObject() : updated;
    }
  }

  doc = await persistRegistrationInstallment(doc);

  return toDetail(doc);
}

export async function recordFeePayment(id, payload = {}, editor = "master-admin") {
  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { feeId: id }] }
    : { feeId: id };
  let doc = await StudentFee.findOne(query);
  if (!doc) {
    const err = new Error("Fee record not found");
    err.status = 404;
    throw err;
  }

  const hadRegistration = (doc.installments || []).some(isRegistrationInstallment);
  await persistRegistrationInstallment(
    typeof doc.toObject === "function" ? doc.toObject() : doc
  );
  if (!hadRegistration) {
    const reloaded = await StudentFee.findOne(query);
    if (reloaded) doc = reloaded;
  }

  const amount = parseMoney(payload.amount);
  if (amount <= 0) {
    const err = new Error("Payment amount must be greater than 0");
    err.status = 400;
    throw err;
  }

  const paidAt = payload.date ? new Date(payload.date) : new Date();
  let installments = doc.installments.map((i) =>
    typeof i.toObject === "function" ? i.toObject() : { ...i }
  );

  const selectedType =
    findFeeType(payload.installmentId) || findFeeType(payload.feeType);
  if (
    selectedType &&
    selectedType.id !== "INS-BAL" &&
    !installments.some((i) => i.id === selectedType.id)
  ) {
    installments = splitFeeTypeInstallment(
      installments,
      selectedType,
      amount,
      paidAt
    );
    if (selectedType.id === "INS-REG") {
      doc.registrationFee = amount;
    }
  }

  let targetInstallments = installments;
  let leftover = 0;
  let touchedId = "";

  if (payload.installmentId) {
    const idx = installments.findIndex((i) => i.id === payload.installmentId);
    if (idx >= 0) {
      const ordered = [
        installments[idx],
        ...installments.filter((_, i) => i !== idx),
      ];
      const applied = applyPaymentToInstallments(ordered, amount, paidAt);
      const map = new Map(applied.installments.map((i) => [i.id, i]));
      targetInstallments = installments.map((i) => map.get(i.id) || i);
      leftover = applied.leftover;
      touchedId = applied.installmentId || payload.installmentId;
    } else {
      const applied = applyPaymentToInstallments(installments, amount, paidAt);
      targetInstallments = applied.installments;
      leftover = applied.leftover;
      touchedId = applied.installmentId;
    }
  } else {
    const applied = applyPaymentToInstallments(installments, amount, paidAt);
    targetInstallments = applied.installments;
    leftover = applied.leftover;
    touchedId = applied.installmentId;
  }

  const isDiscount =
    String(payload.type || "").trim().toLowerCase() === "discount" ||
    isDiscountPayment({ method: payload.method });

  const credited = amount - (leftover || 0);
  if (credited <= 0) {
    const err = new Error(
      isDiscount
        ? "No outstanding dues to apply this discount"
        : "No outstanding dues to apply this payment"
    );
    err.status = 400;
    throw err;
  }

  const payId = await nextPaymentId();
  const paymentCount = (doc.payments || []).length + 1;
  const note = String(payload.note || "").trim();
  doc.payments.push({
    id: payId,
    invoice: payload.invoice || `INV-${doc.admissionId}-${String(paymentCount).padStart(2, "0")}`,
    method: isDiscount
      ? "Discount"
      : String(payload.method || payload.mode || "Cash").trim() || "Cash",
    mode: isDiscount ? "Discount" : String(payload.mode || "").trim(),
    amount: credited,
    date: paidAt,
    status: "Success",
    note: isDiscount ? note || "Fee discount" : note,
    installmentId: touchedId || "",
    proofName: String(payload.proofName || "").trim(),
  });

  const recomputed = recomputeTotals({ installments: targetInstallments });
  Object.assign(doc, recomputed);
  doc.syncedAt = new Date();
  await doc.save();

  await createActivityLog({
    section: "Fees",
    action: isDiscount ? "discount" : "payment",
    message: isDiscount
      ? `Applied ${formatINR(credited)} discount on ${doc.feeId} (${doc.student})`
      : `Recorded ${formatINR(credited)} for ${doc.feeId} (${doc.student})`,
    actor: editor,
    resourceId: doc.feeId,
    meta: { feeId: doc.feeId, amount: credited, paymentId: payId, type: isDiscount ? "discount" : "payment" },
  }).catch(() => {});

  emitSectionUpdate({
    section: "Fees",
    action: isDiscount ? "discount" : "payment",
    resourceId: doc.feeId,
    message: isDiscount
      ? `Discount applied for ${doc.feeId}`
      : `Payment recorded for ${doc.feeId}`,
  });

  return toDetail(doc.toObject());
}

const PAYMENT_STATUSES = ["Success", "Pending", "Failed", "Cancelled", "Refunded"];

export async function updateFeePayment(id, paymentId, payload = {}, editor = "master-admin") {
  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { feeId: id }] }
    : { feeId: id };
  const doc = await StudentFee.findOne(query);
  if (!doc) {
    const err = new Error("Fee record not found");
    err.status = 404;
    throw err;
  }

  const payKey = String(paymentId || "").trim();
  const payIdx = (doc.payments || []).findIndex((p) => p.id === payKey);
  if (payIdx < 0) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }

  const current = typeof doc.payments[payIdx].toObject === "function"
    ? doc.payments[payIdx].toObject()
    : { ...doc.payments[payIdx] };

  const nextAmount =
    payload.amount !== undefined && payload.amount !== null && String(payload.amount).trim() !== ""
      ? parseMoney(payload.amount)
      : Number(current.amount) || 0;

  if (nextAmount < 0) {
    const err = new Error("Payment amount cannot be negative");
    err.status = 400;
    throw err;
  }

  let nextStatus = current.status || "Success";
  if (payload.status !== undefined && payload.status !== null && String(payload.status).trim()) {
    const raw = String(payload.status).trim();
    const matched = PAYMENT_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
    if (!matched) {
      const err = new Error(`Invalid payment status. Use: ${PAYMENT_STATUSES.join(", ")}`);
      err.status = 400;
      throw err;
    }
    nextStatus = matched;
  }

  const nextDate = parsePaymentDate(payload.date, current.date);
  if (Number.isNaN(nextDate.getTime())) {
    const err = new Error("Invalid payment date");
    err.status = 400;
    throw err;
  }

  const becameRefunded =
    nextStatus === "Refunded" &&
    String(current.status || "").toLowerCase() !== "refunded";

  const updatedPayment = {
    ...current,
    amount: nextAmount,
    method:
      payload.method !== undefined
        ? String(payload.method || "").trim() || current.method || "Cash"
        : current.method || "Cash",
    mode: payload.mode !== undefined ? String(payload.mode || "").trim() : current.mode || "",
    note: payload.note !== undefined ? String(payload.note || "").trim() : current.note || "",
    invoice:
      payload.invoice !== undefined
        ? String(payload.invoice || "").trim()
        : current.invoice || "",
    proofName:
      payload.proofName !== undefined
        ? String(payload.proofName || "").trim()
        : current.proofName || "",
    installmentId:
      payload.installmentId !== undefined
        ? String(payload.installmentId || "").trim()
        : current.installmentId || "",
    date: becameRefunded && current.date ? new Date(current.date) : nextDate,
    status: nextStatus,
    refundedAt: becameRefunded
      ? new Date()
      : nextStatus === "Refunded"
        ? current.refundedAt || null
        : null,
  };

  if (isSuccessfulPayment(updatedPayment) && nextAmount <= 0) {
    const err = new Error("Successful payment amount must be greater than 0");
    err.status = 400;
    throw err;
  }

  const payments = doc.payments.map((p, i) =>
    i === payIdx
      ? updatedPayment
      : typeof p.toObject === "function"
        ? p.toObject()
        : { ...p }
  );

  const rebuilt = rebuildInstallmentsFromPayments(doc.installments, payments);

  // Cap successful payment amounts that exceed remaining dues after rebuild
  const successfulSum = rebuilt.payments
    .filter(isSuccessfulPayment)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const installmentTotal = (rebuilt.installments || []).reduce(
    (s, i) => s + (Number(i.amount) || 0),
    0
  );
  if (successfulSum > installmentTotal + 0.5) {
    const err = new Error(
      `Edited amount would exceed course fee total (${formatINR(installmentTotal)}). Reduce amount or mark payment as Cancelled/Failed.`
    );
    err.status = 400;
    throw err;
  }

  doc.payments = rebuilt.payments;
  const recomputed = recomputeTotals({ installments: rebuilt.installments });
  Object.assign(doc, recomputed);
  doc.syncedAt = new Date();
  await doc.save();

  await createActivityLog({
    section: "Fees",
    action: "payment-update",
    message: `Updated payment ${payKey} on ${doc.feeId} (${doc.student})`,
    actor: editor,
    resourceId: doc.feeId,
    meta: {
      feeId: doc.feeId,
      paymentId: payKey,
      amount: nextAmount,
      status: nextStatus,
    },
  }).catch(() => {});

  emitSectionUpdate({
    section: "Fees",
    action: "payment-update",
    resourceId: doc.feeId,
    message: `Payment ${payKey} updated for ${doc.feeId}`,
  });

  const prevStatus = String(current.status || "").trim().toLowerCase();
  const becameSuccess =
    isSuccessfulPayment(updatedPayment) && prevStatus !== "success" && prevStatus !== "paid" && prevStatus !== "completed";
  if (becameSuccess) {
    void notifyFeePaymentApproved(doc.toObject ? doc.toObject() : doc, updatedPayment).catch((err) => {
      console.error("fee payment notify failed:", err?.message || err);
    });
  }

  return toDetail(doc.toObject());
}

/**
 * Student portal — list fee ledgers for approved admissions of this email.
 */
export async function listStudentFees(email, { skipSync = false } = {}) {
  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized) {
    return { rows: [], stats: buildStats([]) };
  }

  if (!skipSync) {
    await syncFeesFromAdmissions();
  }

  const approved = await Admission.find({
    email: normalized,
    status: "Approved",
  })
    .select("_id")
    .lean()
    .maxTimeMS(8000);

  const ids = approved.map((a) => a._id);
  if (!ids.length) {
    return { rows: [], stats: buildStats([]) };
  }

  const docs = await StudentFee.find({
    email: normalized,
    admissionMongoId: { $in: ids },
  })
    .sort({ updatedAt: -1 })
    .lean()
    .maxTimeMS(8000);

  const details = docs.map(toDetail);
  const rows = docs.map(toListRow);
  return {
    rows,
    details,
    stats: buildStats(rows),
  };
}

export async function getStudentFeeById(email, id) {
  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized || !id) return null;

  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { feeId: id }] }
    : { feeId: id };
  const doc = await StudentFee.findOne({
    ...query,
    email: normalized,
  }).lean();
  if (!doc) return null;

  const admission = await Admission.findOne({
    _id: doc.admissionMongoId,
    status: "Approved",
  })
    .select("_id status")
    .lean();
  if (!admission) return null;

  return toDetail(doc);
}

/**
 * Student submits an online fee payment — stays Pending until admin approves.
 * Does NOT credit installments until status becomes Success.
 */
export async function submitStudentFeePayment(email, id, payload = {}) {
  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized) {
    const err = new Error("Student email required");
    err.status = 401;
    throw err;
  }

  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { feeId: id }] }
    : { feeId: id };
  const doc = await StudentFee.findOne({ ...query, email: normalized });
  if (!doc) {
    const err = new Error("Fee record not found");
    err.status = 404;
    throw err;
  }

  const admission = await Admission.findOne({
    _id: doc.admissionMongoId,
    status: "Approved",
  })
    .select("_id")
    .lean();
  if (!admission) {
    const err = new Error("Fee is only available for approved admissions");
    err.status = 403;
    throw err;
  }

  const amount = parseMoney(payload.amount);
  if (amount <= 0) {
    const err = new Error("Payment amount must be greater than 0");
    err.status = 400;
    throw err;
  }

  const dueAmount = Math.max(0, Number(doc.dueAmount) || 0);
  const pendingSum = (doc.payments || [])
    .filter((p) => String(p.status || "").toLowerCase() === "pending")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const available = Math.max(0, dueAmount - pendingSum);
  if (amount > available) {
    const err = new Error(
      available <= 0
        ? "No outstanding dues left to submit (or a payment is already pending approval)"
        : `Amount cannot exceed remaining payable ${formatINR(available)}`
    );
    err.status = 400;
    throw err;
  }

  const installmentId = String(payload.installmentId || "").trim();
  if (installmentId) {
    const exists = (doc.installments || []).some((i) => i.id === installmentId);
    if (!exists) {
      const err = new Error("Invalid installment selected");
      err.status = 400;
      throw err;
    }
  }

  const payId = await nextPaymentId();
  const paymentCount = (doc.payments || []).length + 1;
  const method =
    String(payload.method || payload.mode || "UPI").trim() || "UPI";

  doc.payments.push({
    id: payId,
    invoice: `INV-${doc.admissionId}-${String(paymentCount).padStart(2, "0")}`,
    method,
    mode: String(payload.mode || "Online").trim() || "Online",
    amount,
    date: new Date(),
    status: "Pending",
    note: String(payload.note || "Student online fee submission").trim(),
    installmentId,
    proofName: String(payload.proofName || "").trim(),
  });

  doc.syncedAt = new Date();
  // Do not recompute paid/due — Pending payments are not credited yet
  await doc.save();

  await createActivityLog({
    section: "Fees",
    action: "student-submit",
    message: `Student submitted ${formatINR(amount)} for ${doc.feeId} (Pending approval)`,
    actor: normalized,
    resourceId: doc.feeId,
    meta: { feeId: doc.feeId, amount, paymentId: payId, status: "Pending" },
  }).catch(() => {});

  emitSectionUpdate({
    section: "Fees",
    action: "student-submit",
    resourceId: doc.feeId,
    message: `Pending fee payment submitted for ${doc.feeId}`,
  });

  return toDetail(doc.toObject());
}
