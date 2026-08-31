import { Notification } from "../models/Notification.js";
import { User, USER_TYPES } from "../models/User.js";
import { getIO } from "../lib/socket.js";

function toPublicNotification(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    title: d.title,
    body: d.body || "",
    type: d.type || "general",
    read: Boolean(d.read),
    meta: d.meta && typeof d.meta === "object" ? d.meta : {},
    createdAt: d.createdAt,
    time: formatRelativeTime(d.createdAt),
  };
}

function formatRelativeTime(date) {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function createStudentNotification({
  email,
  title,
  body = "",
  type = "general",
  meta = {},
}) {
  const normalizedEmail = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalizedEmail || !title) return null;

  const user = await User.findOne({
    type: USER_TYPES.STUDENT,
    email: normalizedEmail,
  })
    .select("_id email")
    .lean();

  const doc = await Notification.create({
    email: normalizedEmail,
    userId: user?._id || null,
    title: String(title).trim(),
    body: String(body || "").trim(),
    type: String(type || "general").trim(),
    read: false,
    meta: meta && typeof meta === "object" ? meta : {},
  });

  const payload = toPublicNotification(doc);
  const io = getIO();
  if (io) {
    io.to(`student:${normalizedEmail}`).emit("notification:new", payload);
    if (user?._id) {
      io.to(`student:${user._id.toString()}`).emit("notification:new", payload);
    }
  }

  return payload;
}

/**
 * Notify student when online admission is Approved or Rejected.
 */
export async function notifyAdmissionStatusChange(admission, previousStatus) {
  if (!admission) return null;
  const status = String(admission.status || "");
  if (status !== "Approved" && status !== "Rejected") return null;
  if (previousStatus && previousStatus === status) return null;

  const email = String(
    admission.email || admission.details?.submittedByEmail || ""
  )
    .toLowerCase()
    .trim();
  if (!email) return null;

  const admissionId = admission.admissionId || "";
  const course = admission.course || "";

  // Avoid duplicate notifications for the same admission + status
  const existing = await Notification.findOne({
    email,
    type: "admission",
    "meta.admissionMongoId": String(admission._id),
    "meta.status": status,
  })
    .select("_id")
    .lean();
  if (existing) return null;

  if (status === "Approved") {
    return createStudentNotification({
      email,
      type: "admission",
      title: `Admission ${admissionId} approved`,
      body: course
        ? `Grow Skills Tech has approved your admission for ${course}. Welcome aboard!`
        : "Grow Skills Tech has approved your admission. Welcome aboard!",
      meta: {
        admissionId,
        admissionMongoId: String(admission._id),
        status,
        course,
      },
    });
  }

  return createStudentNotification({
    email,
    type: "admission",
    title: `Admission ${admissionId} not approved`,
    body: course
      ? `Your admission application for ${course} was not approved. Please contact Grow Skills Tech for more details.`
      : "Your admission application was not approved. Please contact Grow Skills Tech for more details.",
    meta: {
      admissionId,
      admissionMongoId: String(admission._id),
      status,
      course,
    },
  });
}

/**
 * Notify student when admin approves a submitted fee payment.
 */
export async function notifyFeePaymentApproved(feeDoc, payment) {
  if (!feeDoc || !payment) return null;
  const email = String(feeDoc.email || "")
    .toLowerCase()
    .trim();
  if (!email) return null;

  const feeId = feeDoc.feeId || "";
  const paymentId = payment.id || "";
  const course = feeDoc.course || "";
  const amountLabel =
    typeof payment.amount === "number"
      ? `₹${Number(payment.amount).toLocaleString("en-IN")}`
      : "";

  const existing = await Notification.findOne({
    email,
    type: "fee",
    "meta.paymentId": paymentId,
    "meta.status": "Success",
  })
    .select("_id")
    .lean();
  if (existing) return null;

  return createStudentNotification({
    email,
    type: "fee",
    title: "Fee payment approved",
    body: course
      ? `Your fee submission${amountLabel ? ` of ${amountLabel}` : ""} for ${course} was approved successfully.`
      : `Your fee submission${amountLabel ? ` of ${amountLabel}` : ""} was approved successfully.`,
    meta: {
      feeId,
      paymentId,
      admissionId: feeDoc.admissionId || "",
      course,
      status: "Success",
      amount: Number(payment.amount) || 0,
    },
  });
}

export { toPublicNotification, formatRelativeTime };
