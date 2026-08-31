import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { User, USER_TYPES } from "../models/User.js";
import { Student } from "../modules/students/students.model.js";

export const isValidMobile = (value) =>
  /^[6-9]\d{9}$/.test(String(value || ""));

export const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));

export function tenDigitMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("91")) {
    const last10 = digits.slice(-10);
    return isValidMobile(last10) ? last10 : "";
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    const last10 = digits.slice(-10);
    return isValidMobile(last10) ? last10 : "";
  }
  return isValidMobile(digits) ? digits : "";
}

export function parseLoginIdentifier(raw) {
  const trimmed = String(raw || "").trim();
  const email = trimmed.toLowerCase();
  if (isValidEmail(email)) {
    return { kind: "email", email, mobile: "", raw: trimmed };
  }
  const mobile = tenDigitMobile(trimmed);
  if (mobile) {
    return { kind: "mobile", email: "", mobile, raw: trimmed };
  }
  return { kind: "invalid", email: "", mobile: "", raw: trimmed };
}

export function maskEmail(email) {
  const value = String(email || "").toLowerCase().trim();
  const at = value.indexOf("@");
  if (at < 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const keep = local.slice(0, 1);
  return `${keep}***@${domain}`;
}

function studentEmail(student) {
  return String(student?.contact?.email || "")
    .toLowerCase()
    .trim();
}

function studentMobile(student) {
  return (
    tenDigitMobile(student?.contact?.mobile) ||
    tenDigitMobile(student?.contact?.alternateMobile)
  );
}

function termLabel(student) {
  const type = String(student?.currentTerm?.type || "").trim();
  const number = student?.currentTerm?.number;
  if (!number) return "";
  return `${type || "Semester"} ${number}`.trim();
}

/**
 * Find an ERP Student by profile email or 10-digit mobile.
 */
export async function findErpStudentByIdentifier(parsed) {
  const or = [];
  if (parsed?.email) {
    or.push({ "contact.email": parsed.email });
  }
  if (parsed?.mobile) {
    or.push({ "contact.mobile": parsed.mobile });
    or.push({ "contact.mobile": `91${parsed.mobile}` });
    or.push({ "contact.alternateMobile": parsed.mobile });
    or.push({ "contact.alternateMobile": `91${parsed.mobile}` });
    or.push({
      "contact.mobile": { $regex: `${parsed.mobile}$` },
    });
  }
  if (!or.length) return null;

  return Student.findOne({
    $or: or,
    status: { $nin: ["Cancelled", "Dropped"] },
  });
}

async function findStudentUser({ email, phone, erpStudentId, excludeId } = {}) {
  const or = [];
  if (erpStudentId) or.push({ erpStudentId });
  if (email) or.push({ email });
  if (phone) {
    or.push({ phone });
    const mobile = tenDigitMobile(phone);
    if (mobile && phone !== `91${mobile}`) or.push({ phone: `91${mobile}` });
    if (mobile && phone !== mobile) or.push({ phone: mobile });
  }
  if (!or.length) return null;

  const query = {
    type: USER_TYPES.STUDENT,
    $or: or,
  };
  if (excludeId) query._id = { $ne: excludeId };
  return User.findOne(query);
}

/**
 * Create or link a student User for an ERP Student.
 * Password is unusable until they set one via email OTP.
 */
export async function ensureUserForErpStudent(student) {
  const email = studentEmail(student);
  if (!email || !isValidEmail(email)) {
    const err = new Error(
      "This student has no email on the profile. Ask the institute to add an email, then use Forgot password."
    );
    err.statusCode = 400;
    throw err;
  }

  const mobile = studentMobile(student);
  const phone = mobile ? `91${mobile}` : null;

  let user = await findStudentUser({
    email,
    phone,
    erpStudentId: student._id,
  });

  const profilePatch = {
    course: student.courseName || "",
    batch: student.batchName || "",
    rollNo: student.studentId || "",
    semester: termLabel(student),
    enrollmentDate: student.admissionDate
      ? new Date(student.admissionDate).toISOString().slice(0, 10)
      : "",
  };

  if (user) {
    if (!user.erpStudentId) user.erpStudentId = student._id;
    if (!user.name) user.name = student.nameEnglish || user.name;
    if (phone && !user.phone) {
      const taken = await User.findOne({
        type: USER_TYPES.STUDENT,
        phone,
        _id: { $ne: user._id },
      });
      if (!taken) user.phone = phone;
    }
    user.profile = user.profile || {};
    if (!user.profile.course) user.profile.course = profilePatch.course;
    if (!user.profile.batch) user.profile.batch = profilePatch.batch;
    if (!user.profile.rollNo) user.profile.rollNo = profilePatch.rollNo;
    if (!user.profile.semester) user.profile.semester = profilePatch.semester;
    if (!user.profile.enrollmentDate) {
      user.profile.enrollmentDate = profilePatch.enrollmentDate;
    }
    user.markModified("profile");
    await user.save();
    return user;
  }

  let phoneToUse = phone;
  if (phoneToUse) {
    const taken = await User.findOne({
      type: USER_TYPES.STUDENT,
      phone: phoneToUse,
    });
    if (taken) phoneToUse = null;
  }

  const dummyHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  user = await User.create({
    type: USER_TYPES.STUDENT,
    email,
    name: student.nameEnglish || "Student",
    passwordHash: dummyHash,
    phone: phoneToUse,
    emailVerified: true,
    phoneVerified: false,
    mustResetPassword: true,
    erpStudentId: student._id,
    profile: profilePatch,
  });
  return user;
}

/**
 * Resolve identifier (email or mobile) to a student User.
 * ERP students are provisioned automatically so they can set a password via OTP.
 */
export async function resolveStudentAccount(identifier) {
  const parsed = parseLoginIdentifier(identifier);
  if (parsed.kind === "invalid") {
    const err = new Error("Enter a valid email address or 10-digit mobile number");
    err.statusCode = 400;
    throw err;
  }

  const erpStudent = await findErpStudentByIdentifier(parsed);
  if (erpStudent) {
    const user = await ensureUserForErpStudent(erpStudent);
    return { parsed, user, erpStudent, email: user.email };
  }

  const user = await findStudentUser({
    email: parsed.email || undefined,
    phone: parsed.mobile ? `91${parsed.mobile}` : undefined,
  });

  if (!user || !user.isActive) {
    const err = new Error("No student found with this email or mobile number");
    err.statusCode = 404;
    throw err;
  }

  return { parsed, user, erpStudent: null, email: user.email };
}
