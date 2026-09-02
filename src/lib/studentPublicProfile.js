import mongoose from "mongoose";
import { User, USER_TYPES } from "../models/User.js";
import { Student } from "../modules/students/students.model.js";

export function avatarFromName(name) {
  const label = encodeURIComponent(String(name || "Student").trim() || "Student");
  return `https://ui-avatars.com/api/?name=${label}&background=FF5E14&color=fff&size=128`;
}

const emptyAddress = () => ({
  line1: "",
  line2: "",
  city: "",
  state: "",
  pincode: "",
});
const emptyParent = () => ({
  name: "",
  relation: "",
  phone: "",
  email: "",
});
const emptyEmergency = () => ({
  name: "",
  relation: "",
  phone: "",
});

function formatEnrollmentDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

export function toPublicStudent(user) {
  const profile = user.profile || {};
  const name = user.name || "Student";
  const mobile = user.phone ? String(user.phone).replace(/^91/, "") : null;
  const displayPhone = mobile ? `+91 ${mobile}` : "";

  return {
    id: user._id.toString(),
    email: user.email,
    name,
    mobile,
    phone: displayPhone || user.phone || null,
    promoCode: user.promoCode || null,
    heardAbout: user.heardAbout || null,
    heardAboutOther: user.heardAboutOther || null,
    emailVerified: Boolean(user.emailVerified),
    phoneVerified: Boolean(user.phoneVerified),
    mustResetPassword: Boolean(user.mustResetPassword),
    role: "student",
    type: user.type,
    enrollmentId: profile.rollNo || "",
    dob: profile.dob || "",
    gender: profile.gender || "",
    bloodGroup: profile.bloodGroup || "",
    avatar: profile.avatar || avatarFromName(name),
    batch: profile.batch || "",
    course: profile.course || "",
    semester: profile.semester || "",
    rollNo: profile.rollNo || "",
    enrollmentDate: profile.enrollmentDate || "",
    trainer: profile.trainer || "",
    trainerEmail: profile.trainerEmail || "",
    address: {
      ...emptyAddress(),
      ...(profile.address?.toObject?.() || profile.address || {}),
    },
    parent: {
      ...emptyParent(),
      ...(profile.parent?.toObject?.() || profile.parent || {}),
    },
    emergency: {
      ...emptyEmergency(),
      ...(profile.emergency?.toObject?.() || profile.emergency || {}),
    },
    education: Array.isArray(profile.education)
      ? profile.education.map((e) => ({
          level: e.level || "",
          institute: e.institute || "",
          year: e.year || "",
          percentage: e.percentage || "",
        }))
      : [],
    skills: Array.isArray(profile.skills)
      ? profile.skills.map((s) => String(s || "").trim()).filter(Boolean)
      : [],
    achievements: Array.isArray(profile.achievements)
      ? profile.achievements.map((s) => String(s || "").trim()).filter(Boolean)
      : [],
  };
}

export async function findErpStudent(email, user) {
  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized) return null;

  if (user?.erpStudentId) {
    const byId = await Student.findById(user.erpStudentId).lean().maxTimeMS(5000);
    if (byId) return byId;
  }

  return Student.findOne({ "contact.email": normalized }).lean().maxTimeMS(5000);
}

export async function enrichPublicStudent(publicUser, { email, user } = {}) {
  const next = { ...publicUser };
  const erp = await findErpStudent(email || publicUser.email, user);
  if (!erp) return { user: next, erp: null };

  const name = erp.nameEnglish || next.name;
  next.name = next.name || name;
  next.enrollmentId = next.enrollmentId || erp.studentId || "";
  next.rollNo = next.rollNo || erp.studentId || "";
  next.course = next.course || erp.courseName || "";
  next.batch = next.batch || erp.batchName || "";
  next.dob = next.dob || erp.dateOfBirth || "";
  next.gender = next.gender || erp.gender || "";
  if (!next.enrollmentDate && erp.admissionDate) {
    next.enrollmentDate = formatEnrollmentDate(erp.admissionDate);
  }
  if (erp.currentTerm?.number && !next.semester) {
    const type = erp.currentTerm.type || "Semester";
    next.semester = `${type} ${erp.currentTerm.number}`;
  }
  if (erp.photo && (!next.avatar || String(next.avatar).includes("ui-avatars.com"))) {
    next.avatar = erp.photo;
  }

  return { user: next, erp };
}

export async function loadStudentUser(email, sub) {
  const select =
    "_id email name phone promoCode heardAbout heardAboutOther emailVerified phoneVerified mustResetPassword type isActive profile erpStudentId";
  const id = String(sub || "").startsWith("student:")
    ? String(sub).slice("student:".length)
    : "";
  if (
    id &&
    mongoose.Types.ObjectId.isValid(id) &&
    String(new mongoose.Types.ObjectId(id)) === String(id)
  ) {
    const byId = await User.findOne({ _id: id, type: USER_TYPES.STUDENT })
      .select(select)
      .lean()
      .maxTimeMS(5000);
    if (byId) return byId;
  }

  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized) return null;
  return User.findOne({
    type: USER_TYPES.STUDENT,
    email: normalized,
  })
    .select(select)
    .lean()
    .maxTimeMS(5000);
}
