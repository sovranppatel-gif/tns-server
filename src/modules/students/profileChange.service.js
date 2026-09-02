import mongoose from "mongoose";
import { isValidEmail, isValidMobile } from "../../lib/erpStudentAccount.js";
import {
  avatarFromName,
  toPublicStudent,
} from "../../lib/studentPublicProfile.js";
import { User, USER_TYPES } from "../../models/User.js";
import {
  PROFILE_CHANGE_STATUSES,
  StudentProfileChangeRequest,
} from "../../models/StudentProfileChangeRequest.js";
import { Student } from "./students.model.js";
import { notifyProfileChangeReviewed } from "../../lib/studentNotifications.js";

const STUDENT_SAFE_SELECT =
  "_id email name phone promoCode heardAbout heardAboutOther emailVerified phoneVerified mustResetPassword type isActive profile erpStudentId";

function pickTrimmed(value, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function emptyAddress() {
  return { line1: "", line2: "", city: "", state: "", pincode: "" };
}

function emptyParent() {
  return { name: "", relation: "", phone: "", email: "" };
}

function emptyEmergency() {
  return { name: "", relation: "", phone: "" };
}

function normalizeAddress(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    line1: pickTrimmed(src.line1, 200),
    line2: pickTrimmed(src.line2, 200),
    city: pickTrimmed(src.city, 100),
    state: pickTrimmed(src.state, 100),
    pincode: pickTrimmed(src.pincode, 12),
  };
}

function normalizeParent(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    name: pickTrimmed(src.name, 100),
    relation: pickTrimmed(src.relation, 50),
    phone: pickTrimmed(src.phone, 20),
    email: pickTrimmed(src.email, 200).toLowerCase(),
  };
}

function normalizeEmergency(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    name: pickTrimmed(src.name, 100),
    relation: pickTrimmed(src.relation, 50),
    phone: pickTrimmed(src.phone, 20),
  };
}

function sanitizeAvatar(url) {
  const value = pickTrimmed(url, 500);
  if (!value || value.startsWith("data:")) return "";
  if (value.includes("ui-avatars.com")) return value;
  if (value.startsWith("/uploads/")) return value;
  if (/^https?:\/\//i.test(value)) return value.slice(0, 500);
  return "";
}

function studentUserIdFromJwt(req) {
  const sub = String(req.student?.sub || "");
  if (sub.startsWith("student:")) return sub.slice("student:".length);
  return "";
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);
}

export async function findStudentUserFromJwt(req) {
  const id = studentUserIdFromJwt(req);
  if (isObjectId(id)) {
    const byId = await User.findOne({
      _id: id,
      type: USER_TYPES.STUDENT,
    }).select(STUDENT_SAFE_SELECT);
    if (byId) return byId;
  }
  const email = String(req.student?.email || "")
    .toLowerCase()
    .trim();
  if (!email) return null;
  return User.findOne({ type: USER_TYPES.STUDENT, email }).select(STUDENT_SAFE_SELECT);
}

export function snapshotFromUser(user) {
  const publicUser = toPublicStudent(user);
  return {
    name: publicUser.name || "",
    email: String(publicUser.email || "").toLowerCase(),
    mobile: publicUser.mobile || "",
    dob: publicUser.dob || "",
    gender: publicUser.gender || "",
    bloodGroup: publicUser.bloodGroup || "",
    avatar: user.profile?.avatar || publicUser.avatar || "",
    address: { ...emptyAddress(), ...(publicUser.address || {}) },
    parent: { ...emptyParent(), ...(publicUser.parent || {}) },
    emergency: { ...emptyEmergency(), ...(publicUser.emergency || {}) },
  };
}

export function sanitizeProposed(body = {}, current = {}) {
  const mobile = String(body.mobile ?? body.phone ?? current.mobile ?? "")
    .replace(/\D/g, "")
    .slice(-10);
  const genderRaw = pickTrimmed(body.gender ?? current.gender, 20);
  const gender = ["Male", "Female", "Other"].includes(genderRaw) ? genderRaw : "";
  const avatar =
    sanitizeAvatar(body.avatar) || sanitizeAvatar(current.avatar) || "";

  return {
    name: pickTrimmed(body.name ?? current.name, 100),
    email: pickTrimmed(body.email ?? current.email, 200).toLowerCase(),
    mobile,
    dob: pickTrimmed(body.dob ?? current.dob, 20),
    gender,
    bloodGroup: pickTrimmed(body.bloodGroup ?? current.bloodGroup, 10),
    avatar,
    address: normalizeAddress(body.address ?? current.address),
    parent: normalizeParent(body.parent ?? current.parent),
    emergency: normalizeEmergency(body.emergency ?? current.emergency),
  };
}

export function validateProposed(proposed) {
  if (!proposed.name) return "Name is required";
  if (!isValidEmail(proposed.email)) return "Enter a valid email address";
  if (!isValidMobile(proposed.mobile)) {
    return "Enter a valid 10-digit Indian mobile number";
  }
  return "";
}

export async function assertPersonalUnique(user, proposed) {
  if (proposed.email !== String(user.email || "").toLowerCase()) {
    const exists = await User.findOne({
      type: USER_TYPES.STUDENT,
      email: proposed.email,
      _id: { $ne: user._id },
    });
    if (exists) {
      const err = new Error("An account with this email already exists");
      err.status = 409;
      throw err;
    }
  }

  const phone = `91${proposed.mobile}`;
  if (phone !== user.phone) {
    const exists = await User.findOne({
      type: USER_TYPES.STUDENT,
      phone,
      _id: { $ne: user._id },
    });
    if (exists) {
      const err = new Error("An account with this mobile number already exists");
      err.status = 409;
      throw err;
    }
  }
}

function stable(value) {
  return JSON.stringify(value);
}

export function hasProfileChanges(current, proposed) {
  return stable(current) !== stable(proposed);
}

export function toPublicChange(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    studentUserId: doc.studentUserId?.toString?.() || "",
    studentEmail: doc.studentEmail || "",
    studentName: doc.studentName || "",
    status: doc.status,
    proposed: doc.proposed || {},
    currentSnapshot: doc.currentSnapshot || {},
    adminNote: doc.adminNote || "",
    reviewedBy: doc.reviewedBy || "",
    reviewedAt: doc.reviewedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function getPendingForUser(user) {
  const doc = await StudentProfileChangeRequest.findOne({
    studentUserId: user._id,
    status: "Pending",
  }).sort({ updatedAt: -1 });
  return toPublicChange(doc);
}

export async function upsertPendingRequest(user, proposed) {
  const currentSnapshot = snapshotFromUser(user);
  if (!hasProfileChanges(currentSnapshot, proposed)) {
    const err = new Error("No profile changes to submit");
    err.status = 400;
    throw err;
  }

  const payload = {
    studentUserId: user._id,
    studentEmail: user.email,
    studentName: user.name,
    proposed,
    currentSnapshot,
    status: "Pending",
    adminNote: "",
    reviewedBy: "",
    reviewedAt: null,
  };

  const existing = await StudentProfileChangeRequest.findOne({
    studentUserId: user._id,
    status: "Pending",
  });
  if (existing) {
    Object.assign(existing, payload);
    existing.markModified("proposed");
    existing.markModified("currentSnapshot");
    await existing.save();
    return existing;
  }

  return StudentProfileChangeRequest.create(payload);
}

export async function applyProposed(user, proposed) {
  user.name = proposed.name;
  if (proposed.email !== String(user.email || "").toLowerCase()) {
    user.email = proposed.email;
    user.emailVerified = false;
  }
  const phone = `91${proposed.mobile}`;
  if (phone !== user.phone) {
    user.phone = phone;
    user.phoneVerified = false;
  }

  const profile = {
    ...(user.profile?.toObject?.() || user.profile || {}),
  };
  profile.dob = proposed.dob;
  profile.gender = proposed.gender;
  profile.bloodGroup = proposed.bloodGroup;
  profile.avatar =
    proposed.avatar && !String(proposed.avatar).includes("ui-avatars.com")
      ? proposed.avatar
      : avatarFromName(proposed.name);
  profile.address = proposed.address || emptyAddress();
  profile.parent = proposed.parent || emptyParent();
  profile.emergency = proposed.emergency || emptyEmergency();
  user.profile = profile;
  user.markModified("profile");
  await user.save();

  if (user.erpStudentId) {
    const erp = await Student.findById(user.erpStudentId);
    if (erp) {
      erp.nameEnglish = proposed.name;
      erp.dateOfBirth = proposed.dob || erp.dateOfBirth;
      erp.gender = proposed.gender || erp.gender;
      erp.contact = {
        ...(erp.contact?.toObject?.() || erp.contact || {}),
        email: proposed.email,
        mobile: proposed.mobile,
      };
      if (proposed.avatar && String(proposed.avatar).startsWith("/uploads/")) {
        erp.photo = proposed.avatar;
      }
      if (proposed.parent?.name) {
        erp.guardian = {
          ...(erp.guardian?.toObject?.() || erp.guardian || {}),
          name: proposed.parent.name,
          relation: proposed.parent.relation,
          mobile: proposed.parent.phone,
        };
      }
      const addr = proposed.address || {};
      const line = [addr.line1, addr.line2].filter(Boolean).join(", ");
      if (line || addr.city || addr.state || addr.pincode) {
        erp.address = {
          ...(erp.address?.toObject?.() || erp.address || {}),
          permanent: line || erp.address?.permanent || "",
          correspondence: line || erp.address?.correspondence || "",
          district: addr.city || erp.address?.district || "",
          state: addr.state || erp.address?.state || "",
          pinCode: addr.pincode || erp.address?.pinCode || "",
        };
      }
      erp.updatedBy = "profile-change-approval";
      erp.markModified("contact");
      erp.markModified("guardian");
      erp.markModified("address");
      await erp.save();
    }
  }

  return user;
}

export async function listProfileChanges({ status, search } = {}) {
  const filter = {};
  if (status && PROFILE_CHANGE_STATUSES.includes(status)) {
    filter.status = status;
  }
  const q = String(search || "").trim();
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { studentName: new RegExp(safe, "i") },
      { studentEmail: new RegExp(safe, "i") },
    ];
  }

  const [rows, pending, approved, rejected] = await Promise.all([
    StudentProfileChangeRequest.find(filter).sort({ createdAt: -1 }).limit(300),
    StudentProfileChangeRequest.countDocuments({ status: "Pending" }),
    StudentProfileChangeRequest.countDocuments({ status: "Approved" }),
    StudentProfileChangeRequest.countDocuments({ status: "Rejected" }),
  ]);

  return {
    rows: rows.map(toPublicChange),
    stats: {
      pending,
      approved,
      rejected,
      total: pending + approved + rejected,
    },
  };
}

export async function approveProfileChange(id, reviewer) {
  const doc = await StudentProfileChangeRequest.findById(id);
  if (!doc) {
    const err = new Error("Request not found");
    err.status = 404;
    throw err;
  }
  if (doc.status !== "Pending") {
    const err = new Error("This request is already reviewed");
    err.status = 400;
    throw err;
  }

  const user = await User.findById(doc.studentUserId);
  if (!user || user.type !== USER_TYPES.STUDENT) {
    const err = new Error("Student account not found");
    err.status = 404;
    throw err;
  }

  await assertPersonalUnique(user, doc.proposed);
  const previousEmail = String(doc.studentEmail || user.email || "").toLowerCase();
  await applyProposed(user, doc.proposed);

  doc.status = "Approved";
  doc.reviewedBy = reviewer;
  doc.reviewedAt = new Date();
  await doc.save();

  try {
    await notifyProfileChangeReviewed({
      user,
      previousEmail,
      status: "Approved",
    });
  } catch (err) {
    console.error("profile approve notify failed:", err);
  }

  return toPublicChange(doc);
}

export async function rejectProfileChange(id, reviewer, note) {
  const doc = await StudentProfileChangeRequest.findById(id);
  if (!doc) {
    const err = new Error("Request not found");
    err.status = 404;
    throw err;
  }
  if (doc.status !== "Pending") {
    const err = new Error("This request is already reviewed");
    err.status = 400;
    throw err;
  }

  const student = await User.findById(doc.studentUserId);
  const previousEmail = String(doc.studentEmail || student?.email || "").toLowerCase();

  doc.status = "Rejected";
  doc.adminNote = pickTrimmed(note, 400);
  doc.reviewedBy = reviewer;
  doc.reviewedAt = new Date();
  await doc.save();

  if (student) {
    try {
      await notifyProfileChangeReviewed({
        user: student,
        previousEmail,
        status: "Rejected",
        adminNote: doc.adminNote,
      });
    } catch (err) {
      console.error("profile reject notify failed:", err);
    }
  }

  return toPublicChange(doc);
}
