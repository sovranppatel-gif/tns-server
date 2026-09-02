import mongoose from "mongoose";
import { Student, STUDENT_STATUSES } from "./students.model.js";
import { User, USER_TYPES } from "../../models/User.js";
import { Admission } from "../../models/Admission.js";
import { University } from "../universities/universities.model.js";
import { Course } from "../courses/courses.model.js";
import { Batch } from "../batches/batches.model.js";
import { StudentFee } from "../fees/fees.model.js";
import {
  Attendance,
  ATTENDANCE_STATUSES,
} from "../attendance/attendance.model.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { normalizeStudentPayload } from "./students.validation.js";

const GST_INSTITUTE_ID = "institute-gst";
const LIST_SELECT =
  "studentId admissionId admissionMongoId universityId courseId batchId session currentTerm universityName universityShortName courseName courseCode courseCategory batchName nameEnglish nameHindi fatherName gender category contact photo status admissionDate createdAt updatedAt";

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  if (!raw || raw === GST_INSTITUTE_ID) return null;
  if (!/^[a-fA-F0-9]{24}$/.test(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

async function reconcileApprovedPortalProfile(doc) {
  const email = String(doc.contact?.email || "").toLowerCase();
  const mobile = String(doc.contact?.mobile || "").replace(/\D/g, "");
  const or = [{ erpStudentId: doc._id }];
  if (email) or.push({ type: USER_TYPES.STUDENT, email });
  if (mobile) or.push({ type: USER_TYPES.STUDENT, phone: `91${mobile}` });
  const user = await User.findOne({ $or: or }).select("profile name email phone erpStudentId").lean();
  if (!user?.profile) return doc;

  const profile = user.profile;
  const avatar = String(profile.avatar || "");
  if (avatar && !avatar.includes("ui-avatars.com")) doc.photo = avatar;
  if (user.name) doc.nameEnglish = user.name;
  if (profile.dob) doc.dateOfBirth = profile.dob;
  if (profile.gender) doc.gender = profile.gender;
  doc.contact = {
    ...(doc.contact?.toObject?.() || doc.contact || {}),
    email: user.email || email,
    mobile: String(user.phone || "").replace(/^91/, "") || mobile,
  };
  if (profile.parent) {
    doc.guardian = {
      ...(doc.guardian?.toObject?.() || doc.guardian || {}),
      name: profile.parent.name || doc.guardian?.name || "",
      relation: profile.parent.relation || doc.guardian?.relation || "",
      mobile: profile.parent.phone || doc.guardian?.mobile || "",
    };
  }
  if (profile.address) {
    const line = [profile.address.line1, profile.address.line2].filter(Boolean).join(", ");
    doc.address = {
      ...(doc.address?.toObject?.() || doc.address || {}),
      permanent: line || doc.address?.permanent || "",
      correspondence: line || doc.address?.correspondence || "",
      district: profile.address.city || doc.address?.district || "",
      state: profile.address.state || doc.address?.state || "",
      pinCode: profile.address.pincode || doc.address?.pinCode || "",
    };
  }
  if (!user.erpStudentId) {
    await User.updateOne({ _id: user._id }, { $set: { erpStudentId: doc._id } });
  }
  await doc.save();
  return doc;
}

function idStr(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function dayStart(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatINR(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInstituteCourse(course) {
  return String(course?.type || "") === "Institute" || !course?.universityId;
}

function academicStructure(course) {
  if (!course) return { termType: "", count: 0 };
  const structureType = String(course.structureType || "").trim();
  if (structureType === "Single Level") return { termType: "", count: 0 };
  const fromList = Array.isArray(course.semesters) ? course.semesters.length : 0;
  const count = Number(course.semesterCount) || fromList || 0;
  if (count <= 0) return { termType: "", count: 0 };
  const termType = structureType === "Year" ? "Year" : "Semester";
  return { termType, count };
}

function currentTermLabel(term) {
  const type = String(term?.type || "").trim();
  const number = Number(term?.number);
  if (!type || !Number.isFinite(number) || number <= 0) return "";
  return `${type} ${number}`;
}

function universityLabelFrom(uni, student) {
  const shortName = String(uni?.shortName || student?.universityShortName || "").trim();
  const name = String(uni?.name || student?.universityName || "").trim();
  if (shortName && name) return `${shortName} — ${name}`;
  return shortName || name || "";
}

function courseLabelFrom(course, student) {
  const name = String(course?.name || student?.courseName || "").trim();
  const code = String(course?.code || student?.courseCode || "").trim();
  if (name && code) return `${name} — ${code}`;
  return name || code || "";
}

function batchLabelFrom(batch, student) {
  return (
    String(batch?.name || student?.batchName || "").trim() ||
    String(batch?.batchId || "").trim()
  );
}

function slimPhoto(photo) {
  const value = String(photo || "");
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  if (value.length > 2000) return "";
  return value;
}

function hasPhotoValue(photo) {
  const value = String(photo || "");
  return Boolean(value) && value !== "undefined";
}

function subjectsForTerm(course, term) {
  if (!course) return [];
  const number = Number(term?.number);
  const semesters = Array.isArray(course.semesters) ? course.semesters : [];
  if (Number.isFinite(number) && number > 0) {
    const match = semesters.find((s) => Number(s.number) === number);
    if (match && Array.isArray(match.subjects)) {
      return match.subjects.map((sub, index) => ({
        number: index + 1,
        name: sub.name || "",
        code: sub.code || "",
        subjectType: sub.subjectType || "",
      }));
    }
  }
  if (semesters.length === 1 && Array.isArray(semesters[0].subjects)) {
    return semesters[0].subjects.map((sub, index) => ({
      number: index + 1,
      name: sub.name || "",
      code: sub.code || "",
      subjectType: sub.subjectType || "",
    }));
  }
  return [];
}

function toListRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const uni = d.universityId && typeof d.universityId === "object" ? d.universityId : null;
  const course = d.courseId && typeof d.courseId === "object" ? d.courseId : null;
  const batch = d.batchId && typeof d.batchId === "object" ? d.batchId : null;
  const photo = slimPhoto(d.photo);
  return {
    _id: String(d._id),
    id: d.studentId || String(d._id),
    studentId: d.studentId,
    admissionId: d.admissionId || "",
    admissionMongoId: d.admissionMongoId ? String(d.admissionMongoId) : "",
    universityId: idStr(d.universityId),
    courseId: idStr(d.courseId),
    batchId: idStr(d.batchId),
    session: d.session || "",
    currentTerm: d.currentTerm || { type: "", number: null },
    currentTermLabel: currentTermLabel(d.currentTerm) || "—",
    universityLabel: universityLabelFrom(uni, d) || "—",
    courseLabel: courseLabelFrom(course, d) || "—",
    courseName: course?.name || d.courseName || "",
    courseCode: course?.code || d.courseCode || "",
    courseCategory: course?.category || d.courseCategory || "",
    batchLabel: batchLabelFrom(batch, d) || "—",
    batchName: batch?.name || d.batchName || "",
    nameEnglish: d.nameEnglish || "",
    nameHindi: d.nameHindi || "",
    fatherName: d.fatherName || "",
    gender: d.gender || "",
    category: d.category || "",
    mobile: d.contact?.mobile || "",
    email: d.contact?.email || "",
    status: d.status || "Active",
    admissionDate: d.admissionDate,
    admissionDateLabel: formatDateLabel(d.admissionDate) || "—",
    photo,
    hasPhoto: hasPhotoValue(d.photo),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function toDetailRow(doc, extras = {}) {
  const base = toListRow(doc);
  const d = doc?.toObject ? doc.toObject() : doc;
  const course = d.courseId && typeof d.courseId === "object" ? d.courseId : extras.course || null;
  return {
    ...base,
    photo: d.photo || "",
    nameHindi: d.nameHindi || "",
    dateOfBirth: d.dateOfBirth || "",
    samagraId: d.samagraId || "",
    casteCertificateNo: d.casteCertificateNo || "",
    maritalStatus: d.maritalStatus || "",
    husbandName: d.husbandName || "",
    motherName: d.motherName || "",
    contact: d.contact || {},
    address: d.address || {},
    guardian: d.guardian || {},
    education: Array.isArray(d.education) ? d.education : [],
    admissionDetails: d.admissionDetails || {},
    documents: Array.isArray(d.documents) ? d.documents : [],
    batchHistory: (Array.isArray(d.batchHistory) ? d.batchHistory : []).map((row) => ({
      ...row,
      _id: row._id ? String(row._id) : undefined,
      batchId: row.batchId ? String(row.batchId) : "",
      courseId: row.courseId ? String(row.courseId) : "",
      joiningLabel: formatDateLabel(row.joiningDate),
      leavingLabel: row.leavingDate ? formatDateLabel(row.leavingDate) : "Current",
      currentTermLabel: currentTermLabel(row.currentTerm),
    })),
    currentSubjects: subjectsForTerm(course, d.currentTerm),
    universityStatus: extras.university?.status || "",
    courseStatus: course?.status || "",
    batchStatus: extras.batch?.status || "",
    feesSummary: extras.feesSummary || null,
    attendanceSummary: extras.attendanceSummary || null,
    resultsSummary: extras.resultsSummary || {
      available: false,
      message: "Results are managed in the Results module",
      terms: [],
    },
  };
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function buildStats() {
  const start = monthStart();
  const [total, active, completed, inactive, newAdmissions] = await Promise.all([
    Student.countDocuments({}).maxTimeMS(8000),
    Student.countDocuments({ status: "Active" }).maxTimeMS(8000),
    Student.countDocuments({ status: "Completed" }).maxTimeMS(8000),
    Student.countDocuments({
      status: { $in: ["Inactive", "Dropped", "Cancelled", "Suspended"] },
    }).maxTimeMS(8000),
    Student.countDocuments({
      $or: [{ admissionDate: { $gte: start } }, { createdAt: { $gte: start } }],
    }).maxTimeMS(8000),
  ]);
  return { total, active, newAdmissions, completed, inactive };
}

function compact(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function slimStoredPhoto(photo) {
  const value = String(photo || "");
  if (!value || value === "undefined") return "";
  if (value.startsWith("data:") && value.length > 250000) return "";
  return value;
}

function slimEducation(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const documentUrl = String(row.documentUrl || row.url || "");
      const safeUrl =
        documentUrl.startsWith("data:") || documentUrl.length > 2000 ? "" : documentUrl;
      return {
        className: String(row.className || "").trim(),
        board: String(row.board || "").trim(),
        year: String(row.year || "").trim(),
        rollNo: String(row.rollNo || "").trim(),
        percentage: String(row.percentage || "").trim(),
        division: String(row.division || "").trim(),
        documentUrl: safeUrl,
        documentName: String(row.documentName || row.name || "").trim(),
      };
    })
    .filter((row) => row && Object.values(row).some(Boolean));
}

async function nextStudentId() {
  const year = new Date().getFullYear();
  const prefix = `TNS-${year}-`;
  const latest = await Student.findOne({ studentId: new RegExp(`^${prefix}`) })
    .sort({ studentId: -1 })
    .select("studentId")
    .lean()
    .maxTimeMS(8000);

  let seq = 1;
  if (latest?.studentId) {
    const part = latest.studentId.slice(prefix.length);
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

async function loadUniversity(id, { requireActive = false, optional = false } = {}) {
  const oid = asObjectId(id);
  if (!oid) return null;
  const uni = await University.findOne({ _id: oid, softDelete: { $ne: true } })
    .lean()
    .maxTimeMS(8000);
  if (!uni) {
    if (optional) return null;
    throw httpError("University not found", 404);
  }
  if (requireActive && String(uni.status || "Active") !== "Active") {
    throw httpError("Selected university is not active", 400);
  }
  return uni;
}

async function loadCourse(id, { requireActive = false, optional = false } = {}) {
  const oid = asObjectId(id);
  if (!oid) return null;
  const course = await Course.findOne({ _id: oid, softDelete: { $ne: true } })
    .lean()
    .maxTimeMS(8000);
  if (!course) {
    if (optional) return null;
    throw httpError("Course not found", 404);
  }
  if (requireActive && String(course.status || "Active") !== "Active") {
    throw httpError("Selected course is not available", 400);
  }
  return course;
}

async function loadBatch(id, { optional = false } = {}) {
  const oid = asObjectId(id);
  if (!oid) {
    const code = String(id || "").trim();
    if (!code) return null;
    const byCode = await Batch.findOne({
      $or: [{ batchId: code }, { name: code }],
      softDelete: { $ne: true },
    })
      .lean()
      .maxTimeMS(8000);
    if (!byCode) {
      if (optional) return null;
      throw httpError("Batch not found", 404);
    }
    return byCode;
  }
  const batch = await Batch.findOne({ _id: oid, softDelete: { $ne: true } })
    .lean()
    .maxTimeMS(8000);
  if (!batch) {
    if (optional) return null;
    throw httpError("Batch not found", 404);
  }
  return batch;
}

function assertCourseUniversity(course, university, { required = true } = {}) {
  if (!course) return;
  if (isInstituteCourse(course)) return;
  if (!university) {
    if (required) throw httpError("Please select a university", 400);
    return;
  }
  if (String(course.universityId) !== String(university._id)) {
    if (required) {
      throw httpError("Selected course does not belong to the selected university", 400);
    }
  }
}

function assertBatchCourse(batch, course) {
  if (!batch || !course) return;
  if (String(batch.courseId) !== String(course._id)) {
    throw httpError("Selected batch does not belong to the selected course", 400);
  }
}

function assertCurrentTerm(course, term, { required = false } = {}) {
  const structure = academicStructure(course);
  if (structure.count <= 0) {
    return { type: "", number: null };
  }
  const number = Number(term?.number);
  if (!Number.isFinite(number) || number <= 0) {
    if (required) {
      throw httpError(`Please select ${structure.termType.toLowerCase()}`, 400);
    }
    return { type: structure.termType, number: 1 };
  }
  if (number < 1 || number > structure.count) {
    if (required) {
      throw httpError(`Invalid ${structure.termType.toLowerCase()} selection`, 400);
    }
    return { type: structure.termType, number: 1 };
  }
  return { type: structure.termType, number };
}

async function resolveAcademics(payload, { requireActive = false, existing = null } = {}) {
  const courseId = payload.courseId !== undefined && payload.courseId !== ""
    ? payload.courseId
    : existing?.courseId;
  const universityId = payload.universityId !== undefined && payload.universityId !== ""
    ? payload.universityId
    : existing?.universityId;
  const batchId = payload.batchId !== undefined ? payload.batchId : existing?.batchId;

  const courseChanging =
    Boolean(existing) &&
    Boolean(payload.courseId) &&
    String(payload.courseId) !== String(existing?.courseId || "");
  const uniChanging =
    Boolean(existing) &&
    payload.universityId !== undefined &&
    String(payload.universityId || "") !== String(existing?.universityId || "");

  const course = courseId
    ? await loadCourse(courseId, {
        requireActive: requireActive || courseChanging,
        optional: !requireActive && !courseChanging,
      })
    : null;

  let university = null;
  if (universityId) {
    university = await loadUniversity(universityId, {
      requireActive: requireActive || uniChanging,
      optional: !requireActive && !uniChanging,
    });
  } else if (course && !isInstituteCourse(course) && course.universityId) {
    university = await loadUniversity(course.universityId, {
      requireActive: requireActive || courseChanging,
      optional: !requireActive && !courseChanging,
    });
  }

  if (course) {
    assertCourseUniversity(course, university, {
      required: requireActive || courseChanging || uniChanging,
    });
  }

  let batch = null;
  if (batchId) {
    batch = await loadBatch(batchId, {
      optional: !requireActive,
    });
    if (batch && course) {
      try {
        assertBatchCourse(batch, course);
      } catch (err) {
        if (requireActive) throw err;
        batch = null;
      }
    }
  }

  const currentTerm = course
    ? assertCurrentTerm(course, payload.currentTerm ?? existing?.currentTerm, {
        required: requireActive || courseChanging,
      })
    : payload.currentTerm ?? existing?.currentTerm ?? { type: "", number: null };

  return {
    course,
    university,
    batch,
    currentTerm,
    universityId: university?._id || existing?.universityId || null,
    courseId: course?._id || existing?.courseId || null,
    batchId:
      batch?._id ||
      (payload.batchId !== undefined && !payload.batchId ? null : existing?.batchId || null),
    session: payload.session !== undefined ? payload.session : existing?.session || "",
    universityName: university?.name || course?.universityName || existing?.universityName || "",
    universityShortName:
      university?.shortName || course?.universityShortName || existing?.universityShortName || "",
    courseName: course?.name || existing?.courseName || "",
    courseCode: course?.code || existing?.courseCode || "",
    courseCategory: course?.category || existing?.courseCategory || "",
    batchName: batch?.name || existing?.batchName || "",
  };
}

async function refreshBatchEnrolledCount(batchDoc) {
  if (!batchDoc?._id) return;
  const keys = [String(batchDoc._id), String(batchDoc.batchId || "")].filter(Boolean);
  const count = await Admission.countDocuments({
    status: "Approved",
    $or: [
      { "details.batchId": { $in: keys } },
      { "details.batchMongoId": { $in: keys } },
      { "details.seedBatchId": { $in: keys } },
    ],
  }).maxTimeMS(8000);
  await Batch.updateOne({ _id: batchDoc._id }, { $set: { enrolledCount: count } });
}

async function writeAdmissionBatchLink(admission, batch, { clear = false } = {}) {
  if (!admission?._id) return;
  const set = {};
  if (clear) {
    set["details.batchId"] = "";
    set["details.batchMongoId"] = "";
  } else if (batch) {
    set["details.batchId"] = batch.batchId || "";
    set["details.batchMongoId"] = String(batch._id);
    if (batch.courseId) set["details.courseId"] = String(batch.courseId);
    if (batch.courseName) set["details.courseName"] = batch.courseName;
    if (batch.courseCode) set["details.courseCode"] = batch.courseCode;
    if (batch.universityId) set["details.universityId"] = String(batch.universityId);
    if (batch.universityName) set["details.universityName"] = batch.universityName;
  } else {
    return;
  }
  await Admission.updateOne({ _id: admission._id }, { $set: set });
}

function closeOpenBatchHistory(student, leavingDate) {
  const history = Array.isArray(student.batchHistory) ? student.batchHistory : [];
  for (const row of history) {
    if (!row.leavingDate) {
      row.leavingDate = leavingDate;
    }
  }
  student.batchHistory = history;
}

function pushBatchHistory(student, batch, { joiningDate, currentTerm, note = "" } = {}) {
  if (!batch) return;
  const history = Array.isArray(student.batchHistory) ? [...student.batchHistory] : [];
  history.push({
    batchId: batch._id,
    batchCode: batch.batchId || "",
    batchName: batch.name || "",
    courseId: batch.courseId || student.courseId || null,
    joiningDate: joiningDate || new Date(),
    leavingDate: null,
    currentTerm: currentTerm || student.currentTerm || {},
    note,
  });
  student.batchHistory = history;
  student.batchId = batch._id;
  student.batchName = batch.name || "";
}

async function linkAdmissionStudentIds(admission, student) {
  if (!admission?._id || !student) return;
  const studentId = student.studentId;
  const studentMongoId = student._id;
  await Admission.updateOne(
    { _id: admission._id },
    {
      $set: {
        studentId,
        studentMongoId,
        studentStatus: admission.studentStatus || student.status || "Active",
        "details.studentId": studentId,
        "details.studentMongoId": String(studentMongoId),
      },
    }
  );
  admission.studentId = studentId;
  admission.studentMongoId = studentMongoId;
}

async function findAdmissionForCreate(payload) {
  const mongoId = asObjectId(payload.admissionMongoId);
  if (mongoId) {
    const byOid = await Admission.findById(mongoId);
    if (byOid) return byOid;
  }
  const admissionId = String(payload.admissionId || "").trim();
  if (admissionId) {
    return Admission.findOne({ admissionId });
  }
  return null;
}

function studentFromAdmission(admission) {
  const rawDetails = admission.details;
  const d =
    rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
      ? typeof rawDetails.toObject === "function"
        ? rawDetails.toObject()
        : { ...rawDetails }
      : {};
  const batchRef = asObjectId(d.batchMongoId) || asObjectId(d.batchId);
  return normalizeStudentPayload({
    admissionId: admission.admissionId,
    admissionMongoId: String(admission._id),
    universityId: admission.universityId || d.universityId,
    courseId: admission.courseId || d.courseId,
    ...(batchRef ? { batchId: String(batchRef) } : {}),
    session: admission.session || d.session,
    termType: admission.termType || d.termType || "Semester",
    termNumber: admission.termNumber ?? d.termNumber ?? 1,
    nameEnglish: d.nameEnglish || admission.applicant,
    nameHindi: d.nameHindi,
    fatherName: d.fatherName,
    motherName: d.motherName,
    dateOfBirth: d.dateOfBirth,
    gender: d.gender,
    category: d.category,
    samagraId: d.samagraId,
    casteCertificateNo: d.casteCertificateNo,
    maritalStatus: d.maritalStatus,
    husbandName: d.husbandName,
    mobile: d.studentMobile || d.contactNo || admission.phone,
    alternateMobile: d.contactNo && d.studentMobile ? d.contactNo : "",
    email: admission.email || d.email,
    permanentAddress: d.permanentAddress,
    correspondenceAddress: d.homeAddress,
    village: d.village,
    post: d.post,
    tehsil: d.tehsil,
    district: d.district || admission.city,
    state: d.state || admission.state,
    pinCode: d.pinCode,
    guardianName: d.guardianName || d.fatherName,
    relation: d.relation,
    guardianMobile: d.guardianMobile,
    guardianAddress: d.guardianAddress || d.permanentAddress,
    education: d.education,
    photo: d.photoPreview || d.photo,
    admissionDate: admission.admissionDate,
    status: "Active",
    admissionDetails: {
      registrationNo: d.registrationNo || admission.admissionId || "",
      officeRegistrationNo: d.officeRegistrationNo || "",
      totalFee: d.totalFee || admission.fee || "",
      institutionName: d.institutionName || "",
      officeDate: d.officeDate || "",
      applicantDate: d.applicantDate || "",
      mode: admission.mode || "",
      counsellor: admission.counsellor || "",
    },
  });
}

async function feesSummaryForAdmission(admissionMongoId, admissionId) {
  if (!admissionMongoId && !admissionId) return null;
  const query = admissionMongoId
    ? { admissionMongoId }
    : { admissionId: String(admissionId) };
  const fee = await StudentFee.findOne(query).lean().maxTimeMS(8000);
  if (!fee) return null;
  return {
    available: true,
    feeId: fee.feeId,
    admissionId: fee.admissionId,
    courseFee: Number(fee.totalAmount) || 0,
    courseFeeLabel: formatINR(fee.totalAmount),
    paid: Number(fee.paidAmount) || 0,
    paidLabel: formatINR(fee.paidAmount),
    due: Number(fee.dueAmount) || 0,
    dueLabel: formatINR(fee.dueAmount),
    status: fee.status || "",
  };
}

async function attendanceSummaryForAdmission(admissionMongoId, admissionId, studentMongoId) {
  const or = [];
  if (studentMongoId) or.push({ studentId: studentMongoId });
  if (admissionMongoId) or.push({ admissionMongoId });
  if (admissionId) or.push({ admissionId: String(admissionId) });
  if (!or.length) return null;
  const match = or.length === 1 ? or[0] : { $or: or };
  const rows = await Attendance.find(match)
    .select("status")
    .lean()
    .maxTimeMS(8000);
  if (!rows.length) {
    return {
      available: true,
      overall: 0,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      total: 0,
    };
  }
  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let counted = 0;
  for (const row of rows) {
    const status = String(row.status || "");
    if (!ATTENDANCE_STATUSES.includes(status) || status === "Holiday") continue;
    counted += 1;
    if (status === "Present") present += 1;
    else if (status === "Absent") absent += 1;
    else if (status === "Late") late += 1;
    else if (status === "Leave") leave += 1;
  }
  const attended = present + late;
  const overall = counted > 0 ? Math.round((attended / counted) * 100) : 0;
  return {
    available: true,
    overall,
    present,
    absent,
    late,
    leave,
    total: counted,
  };
}

function logAndEmit(editor, action, student, message) {
  createActivityLog({
    section: "Students",
    action,
    actor: editor,
    resourceId: student.studentId,
    message,
    path: `/api/students/${student.studentId}`,
  }).catch(() => null);
  emitSectionUpdate({
    section: "Students",
    action,
    resourceId: student.studentId,
    message,
    at: new Date().toISOString(),
  });
}

export async function listStudents(params = {}) {
  const {
    search = "",
    status = "",
    universityId = "",
    courseId = "",
    batchId = "",
    session = "",
    gender = "",
    category = "",
    termType = "",
    termNumber = "",
  } = params;

  const query = {};
  const uniOid = asObjectId(universityId);
  const courseOid = asObjectId(courseId);
  const batchOid = asObjectId(batchId);
  if (uniOid) query.universityId = uniOid;
  if (courseOid) query.courseId = courseOid;
  if (batchOid) query.batchId = batchOid;
  if (status) query.status = status;
  if (session) query.session = session;
  if (gender) query.gender = gender;
  if (category) query.category = category;
  if (termType) query["currentTerm.type"] = termType;
  const termN = Number(termNumber);
  if (Number.isFinite(termN) && termN > 0) query["currentTerm.number"] = termN;

  if (String(search || "").trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), "i");
    query.$or = [
      { studentId: rx },
      { admissionId: rx },
      { nameEnglish: rx },
      { nameHindi: rx },
      { fatherName: rx },
      { "contact.mobile": rx },
      { "contact.alternateMobile": rx },
      { "contact.email": rx },
      { courseName: rx },
      { courseCode: rx },
      { batchName: rx },
      { universityName: rx },
      { universityShortName: rx },
    ];
  }

  const [docs, stats] = await Promise.all([
    Student.find(query)
      .select(LIST_SELECT)
      .populate("universityId", "name shortName status")
      .populate("courseId", "name code category status")
      .populate("batchId", "name batchId status currentSemester")
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(15000),
    buildStats(),
  ]);

  return { rows: docs.map(toListRow), stats };
}

export async function getStudentStats() {
  return buildStats();
}

export async function getStudentMeta() {
  const [sessions, approved] = await Promise.all([
    Student.distinct("session").maxTimeMS(8000),
    Admission.find({ status: "Approved" })
      .select("admissionId applicant course email phone universityId courseId session admissionDate details studentId studentMongoId")
      .sort({ admissionDate: -1 })
      .limit(400)
      .lean()
      .maxTimeMS(10000),
  ]);

  const existingLinks = await Student.find({
    $or: [
      { admissionMongoId: { $in: approved.map((a) => a._id) } },
      { admissionId: { $in: approved.map((a) => a.admissionId).filter(Boolean) } },
    ],
  })
    .select("admissionMongoId admissionId")
    .lean()
    .maxTimeMS(8000);

  const taken = new Set(
    existingLinks.flatMap((s) =>
      [s.admissionMongoId ? String(s.admissionMongoId) : "", s.admissionId || ""].filter(Boolean)
    )
  );

  return {
    statuses: STUDENT_STATUSES,
    genders: ["Male", "Female", "Other"],
    categories: ["General", "OBC", "SC", "ST", "EWS", "Other"],
    documentTypes: [
      "Passport Photo",
      "Aadhaar",
      "10th Marksheet",
      "12th Marksheet",
      "Graduation Marksheet",
      "Transfer Certificate",
      "Migration Certificate",
      "Caste Certificate",
      "Domicile",
      "Other",
    ],
    sessions: (sessions || []).filter(Boolean).sort(),
    eligibleAdmissions: approved
      .filter((row) => {
        if (String(row.studentId || "").trim()) return false;
        if (row.studentMongoId) return false;
        if (taken.has(String(row._id))) return false;
        if (row.admissionId && taken.has(String(row.admissionId))) return false;
        return true;
      })
      .map((row) => ({
        _id: String(row._id),
        admissionId: row.admissionId,
        applicant: row.applicant,
        course: row.course,
        email: row.email,
        phone: row.phone,
        universityId: row.universityId ? String(row.universityId) : row.details?.universityId || "",
        courseId: row.courseId ? String(row.courseId) : row.details?.courseId || "",
        session: row.session || row.details?.session || "",
        admissionDate: row.admissionDate,
      })),
  };
}

export async function getStudentById(id, { includeSummaries = true } = {}) {
  const oid = asObjectId(id);
  const query = oid
    ? { $or: [{ _id: oid }, { studentId: String(id).trim() }] }
    : { studentId: String(id || "").trim() };

  const doc = await Student.findOne(query)
    .populate("universityId", "name shortName status")
    .populate(
      "courseId",
      "name code category status structureType semesterCount semesters universityId universityName universityShortName type"
    )
    .populate("batchId", "name batchId status currentSemester startDate endDate courseId universityId")
    .maxTimeMS(10000);

  if (!doc) return null;

  await reconcileApprovedPortalProfile(doc);

  const lean = doc.toObject();
  const course = lean.courseId && typeof lean.courseId === "object" ? lean.courseId : null;
  const university =
    lean.universityId && typeof lean.universityId === "object" ? lean.universityId : null;
  const batch = lean.batchId && typeof lean.batchId === "object" ? lean.batchId : null;

  let feesSummary = null;
  let attendanceSummary = null;
  if (includeSummaries) {
    [feesSummary, attendanceSummary] = await Promise.all([
      feesSummaryForAdmission(lean.admissionMongoId, lean.admissionId),
      attendanceSummaryForAdmission(lean.admissionMongoId, lean.admissionId, lean._id),
    ]);
  }

  return toDetailRow(lean, {
    course,
    university,
    batch,
    feesSummary,
    attendanceSummary,
  });
}

async function createStudentRecord(payload, editor, { admission = null, requireActive = true } = {}) {
  if (!payload.nameEnglish) throw httpError("Student name is required", 400);

  const academics = await resolveAcademics(payload, {
    requireActive,
    existing: null,
  });

  if (academics.course && !Number(academics.currentTerm?.number)) {
    const structure = academicStructure(academics.course);
    if (structure.count > 0) {
      academics.currentTerm = { type: structure.termType, number: 1 };
    }
  }

  if (admission) {
    const existing = await Student.findOne({
      $or: [
        { admissionMongoId: admission._id },
        { admissionId: admission.admissionId },
      ],
    })
      .lean()
      .maxTimeMS(8000);
    if (existing) {
      await linkAdmissionStudentIds(admission, existing);
      return getStudentById(existing._id);
    }
  } else if (payload.admissionMongoId || payload.admissionId) {
    const dup = await Student.findOne({
      $or: [
        payload.admissionMongoId ? { admissionMongoId: asObjectId(payload.admissionMongoId) } : null,
        payload.admissionId ? { admissionId: payload.admissionId } : null,
      ].filter(Boolean),
    })
      .lean()
      .maxTimeMS(8000);
    if (dup) throw httpError("A student already exists for this admission", 409);
  }

  let studentId = await nextStudentId();
  const docPayload = compact({
    ...payload,
    studentId,
    status: payload.status || "Active",
    universityId: academics.universityId,
    courseId: academics.courseId,
    batchId: academics.batchId,
    session: academics.session || payload.session || "",
    currentTerm: academics.currentTerm,
    universityName: academics.universityName,
    universityShortName: academics.universityShortName,
    courseName: academics.courseName,
    courseCode: academics.courseCode,
    courseCategory: academics.courseCategory,
    batchName: academics.batchName,
    createdBy: editor,
    updatedBy: editor,
  });

  docPayload.universityId = asObjectId(docPayload.universityId);
  docPayload.courseId = asObjectId(docPayload.courseId);
  docPayload.batchId = asObjectId(docPayload.batchId);
  docPayload.admissionMongoId =
    asObjectId(docPayload.admissionMongoId) || (admission ? admission._id : null);
  docPayload.photo = slimStoredPhoto(docPayload.photo);
  if (Array.isArray(docPayload.education)) {
    docPayload.education = slimEducation(docPayload.education);
  }

  if (academics.batch) {
    docPayload.batchHistory = [
      {
        batchId: academics.batch._id,
        batchCode: academics.batch.batchId || "",
        batchName: academics.batch.name || "",
        courseId: academics.batch.courseId || academics.courseId,
        joiningDate: payload.joiningDate || payload.admissionDate || new Date(),
        leavingDate: null,
        currentTerm: academics.currentTerm,
        note: "Initial assignment",
      },
    ];
  }

  let created;
  try {
    created = await Student.create(docPayload);
  } catch (err) {
    if (err?.code === 11000) {
      const existingDup = await Student.findOne({
        $or: [
          admission ? { admissionMongoId: admission._id } : null,
          admission ? { admissionId: admission.admissionId } : null,
          docPayload.admissionMongoId ? { admissionMongoId: docPayload.admissionMongoId } : null,
          docPayload.admissionId ? { admissionId: docPayload.admissionId } : null,
        ].filter(Boolean),
      });
      if (existingDup) {
        if (admission) await linkAdmissionStudentIds(admission, existingDup);
        return getStudentById(existingDup._id);
      }

      if (err?.keyPattern?.studentId) {
        docPayload.studentId = await nextStudentId();
        created = await Student.create(docPayload);
      } else {
        throw err;
      }
    } else {
      delete docPayload.photo;
      delete docPayload.education;
      try {
        created = await Student.create(docPayload);
      } catch (retryErr) {
        throw err;
      }
    }
  }

  if (admission) {
    try {
      await linkAdmissionStudentIds(admission, created);
    } catch (linkErr) {
      console.error("link admission student ids failed:", linkErr?.message || linkErr);
    }
    if (academics.batch) {
      try {
        await writeAdmissionBatchLink(admission, academics.batch);
        await refreshBatchEnrolledCount(academics.batch);
      } catch (batchErr) {
        console.error("student batch link failed:", batchErr?.message || batchErr);
      }
    }
  } else if (created.admissionMongoId && academics.batch) {
    const adm = await Admission.findById(created.admissionMongoId);
    if (adm) {
      await linkAdmissionStudentIds(adm, created);
      await writeAdmissionBatchLink(adm, academics.batch);
      await refreshBatchEnrolledCount(academics.batch);
    }
  }

  logAndEmit(editor, "create", created, `Created student ${created.studentId}`);
  return getStudentById(created._id);
}

export async function createStudent(payload, editor = "master-admin") {
  const admission = await findAdmissionForCreate(payload);
  if (admission && String(admission.status) !== "Approved") {
    throw httpError("Student can only be created from an approved admission", 400);
  }
  if (admission) {
    const fromAdm = studentFromAdmission(admission);
    const merged = {
      ...fromAdm,
      ...payload,
      nameEnglish: payload.nameEnglish || fromAdm.nameEnglish,
      contact: { ...fromAdm.contact, ...(payload.contact || {}) },
      address: { ...fromAdm.address, ...(payload.address || {}) },
      guardian: { ...fromAdm.guardian, ...(payload.guardian || {}) },
      admissionId: admission.admissionId,
      admissionMongoId: String(admission._id),
    };
    if (!merged.photo) merged.photo = fromAdm.photo;
    if (!merged.education?.length) merged.education = fromAdm.education;
    return createStudentRecord(merged, editor, { admission, requireActive: false });
  }
  if (!payload.nameEnglish) throw httpError("Student name is required", 400);
  return createStudentRecord(payload, editor, { requireActive: true });
}

async function createMinimalStudentFromAdmission(admission, editor) {
  const studentId = await nextStudentId();
  const details =
    admission.details && typeof admission.details === "object"
      ? admission.details.toObject?.() || admission.details
      : {};
  const name = String(details.nameEnglish || admission.applicant || "STUDENT")
    .trim()
    .toUpperCase();
  const course = await loadCourse(admission.courseId || details.courseId, {
    requireActive: false,
    optional: true,
  });
  const university = await loadUniversity(
    admission.universityId || details.universityId || course?.universityId,
    { requireActive: false, optional: true }
  );
  const term = course
    ? assertCurrentTerm(
        course,
        {
          type: admission.termType || details.termType,
          number: admission.termNumber ?? details.termNumber ?? 1,
        },
        { required: false }
      )
    : { type: admission.termType || "Semester", number: 1 };

  const minimalDoc = {
    studentId,
    admissionId: admission.admissionId || "",
    admissionMongoId: admission._id,
    universityId: university?._id || asObjectId(admission.universityId),
    courseId: course?._id || asObjectId(admission.courseId),
    session: admission.session || details.session || "",
    currentTerm: term,
    universityName: university?.name || details.universityName || "",
    universityShortName: university?.shortName || details.universityShortName || "",
    courseName: course?.name || details.courseNameSnapshot || admission.course || "",
    courseCode: course?.code || details.courseCodeSnapshot || "",
    courseCategory: course?.category || "",
    nameEnglish: name,
    nameHindi: details.nameHindi || "",
    fatherName: details.fatherName || "",
    motherName: details.motherName || "",
    dateOfBirth: details.dateOfBirth || "",
    gender: details.gender || "",
    category: details.category || "",
    contact: {
      mobile: details.studentMobile || details.contactNo || admission.phone || "",
      alternateMobile: details.contactNo || "",
      email: admission.email || details.email || "",
    },
    address: {
      permanent: details.permanentAddress || "",
      correspondence: details.homeAddress || "",
      village: details.village || "",
      post: details.post || "",
      tehsil: details.tehsil || "",
      district: details.district || admission.city || "",
      state: details.state || admission.state || "",
      pinCode: details.pinCode || "",
    },
    guardian: {
      name: details.guardianName || details.fatherName || "",
      relation: details.relation || "",
      mobile: details.guardianMobile || "",
      address: details.guardianAddress || details.permanentAddress || "",
    },
    status: "Active",
    admissionDate: admission.admissionDate || new Date(),
    createdBy: editor,
    updatedBy: editor,
  };

  let created;
  try {
    created = await Student.create(minimalDoc);
  } catch (err) {
    if (err?.code === 11000) {
      const existingDup = await Student.findOne({
        $or: [
          { admissionMongoId: admission._id },
          { admissionId: admission.admissionId },
        ],
      });
      if (existingDup) {
        await linkAdmissionStudentIds(admission, existingDup);
        return getStudentById(existingDup._id);
      }
    }
    throw err;
  }

  await linkAdmissionStudentIds(admission, created);
  logAndEmit(editor, "create", created, `Created student ${created.studentId}`);
  return getStudentById(created._id);
}

export async function ensureStudentFromAdmission(admissionDoc, editor = "master-admin") {
  const admissionId =
    admissionDoc && typeof admissionDoc === "object"
      ? admissionDoc._id || admissionDoc.id
      : admissionDoc;
  if (!admissionId) return null;

  const admission = await Admission.findById(admissionId);
  if (!admission) return null;
  if (String(admission.status) !== "Approved") return null;

  const existing = await Student.findOne({
    $or: [
      { admissionMongoId: admission._id },
      { admissionId: admission.admissionId },
    ],
  });
  if (existing) {
    if (!admission.studentId) {
      await linkAdmissionStudentIds(admission, existing);
    }
    return existing.toObject ? existing.toObject() : existing;
  }

  try {
    const payload = studentFromAdmission(admission);
    if (!payload.nameEnglish) {
      payload.nameEnglish = String(admission.applicant || "STUDENT").trim().toUpperCase();
    }
    const created = await createStudentRecord(payload, editor, {
      admission,
      requireActive: false,
    });
    console.log(
      `Student auto-created from approved admission ${admission.admissionId}: ${created?.studentId || created?.id}`
    );
    return created;
  } catch (err) {
    console.error(
      "ensureStudentFromAdmission primary create failed:",
      admission.admissionId,
      err?.message || err
    );
    try {
      const created = await createMinimalStudentFromAdmission(admission, editor);
      console.log(
        `Student auto-created (minimal) from approved admission ${admission.admissionId}: ${created?.studentId || created?.id}`
      );
      return created;
    } catch (fallbackErr) {
      console.error(
        "ensureStudentFromAdmission failed:",
        admission.admissionId,
        fallbackErr?.message || fallbackErr
      );
      return null;
    }
  }
}

export async function createStudentFromAdmission(admissionRef, payload = {}, editor = "master-admin") {
  const oid = asObjectId(admissionRef);
  const admission = oid
    ? await Admission.findById(oid)
    : await Admission.findOne({ admissionId: String(admissionRef || "").trim() });
  if (!admission) throw httpError("Admission not found", 404);
  if (String(admission.status) !== "Approved") {
    throw httpError("Only approved admissions can be converted to students", 400);
  }
  const fromAdm = studentFromAdmission(admission);
  const merged = {
    ...fromAdm,
    ...payload,
    contact: { ...fromAdm.contact, ...(payload.contact || {}) },
    address: { ...fromAdm.address, ...(payload.address || {}) },
    guardian: { ...fromAdm.guardian, ...(payload.guardian || {}) },
    admissionId: admission.admissionId,
    admissionMongoId: String(admission._id),
    nameEnglish: payload.nameEnglish || fromAdm.nameEnglish,
  };
  return createStudentRecord(merged, editor, { admission, requireActive: false });
}

export async function updateStudent(id, payload = {}, editor = "master-admin") {
  const oid = asObjectId(id);
  const doc = oid
    ? await Student.findById(oid)
    : await Student.findOne({ studentId: String(id || "").trim() });
  if (!doc) throw httpError("Student not found", 404);

  const existing = doc.toObject();
  const academics = await resolveAcademics(
    {
      universityId: payload.universityId !== undefined ? payload.universityId : existing.universityId,
      courseId: payload.courseId !== undefined ? payload.courseId : existing.courseId,
      batchId: payload.batchId !== undefined ? payload.batchId : existing.batchId,
      session: payload.session !== undefined ? payload.session : existing.session,
      currentTerm: payload.currentTerm !== undefined ? payload.currentTerm : existing.currentTerm,
    },
    { requireActive: false, existing }
  );

  const scalar = [
    "nameEnglish",
    "nameHindi",
    "fatherName",
    "motherName",
    "dateOfBirth",
    "gender",
    "category",
    "samagraId",
    "casteCertificateNo",
    "maritalStatus",
    "husbandName",
    "photo",
    "session",
    "status",
  ];
  for (const key of scalar) {
    if (payload[key] !== undefined) doc[key] = payload[key];
  }
  if (payload.contact) doc.contact = { ...(doc.contact?.toObject?.() || doc.contact || {}), ...payload.contact };
  if (payload.address) doc.address = { ...(doc.address?.toObject?.() || doc.address || {}), ...payload.address };
  if (payload.guardian) doc.guardian = { ...(doc.guardian?.toObject?.() || doc.guardian || {}), ...payload.guardian };
  if (payload.education) doc.education = payload.education;
  if (payload.admissionDetails) doc.admissionDetails = payload.admissionDetails;
  if (payload.documents) doc.documents = payload.documents;
  if (payload.admissionDate) doc.admissionDate = payload.admissionDate;

  doc.universityId = academics.universityId;
  doc.courseId = academics.courseId;
  doc.session = academics.session || doc.session;
  doc.currentTerm = academics.currentTerm;
  doc.universityName = academics.universityName || doc.universityName;
  doc.universityShortName = academics.universityShortName || doc.universityShortName;
  doc.courseName = academics.courseName || doc.courseName;
  doc.courseCode = academics.courseCode || doc.courseCode;
  doc.courseCategory = academics.courseCategory || doc.courseCategory;

  if (payload.batchId !== undefined) {
    const nextBatchId = academics.batch ? String(academics.batch._id) : "";
    const prevBatchId = existing.batchId ? String(existing.batchId) : "";
    if (nextBatchId !== prevBatchId) {
      await applyBatchChange(doc, academics.batch, {
        joiningDate: payload.joiningDate || new Date(),
        currentTerm: academics.currentTerm,
        editor,
      });
    }
  }

  doc.updatedBy = editor;
  await doc.save();
  logAndEmit(editor, "update", doc, `Updated student ${doc.studentId}`);
  return getStudentById(doc._id);
}

async function applyBatchChange(student, batch, { joiningDate, currentTerm, editor } = {}) {
  const prevBatchId = student.batchId;
  closeOpenBatchHistory(student, joiningDate || new Date());

  if (prevBatchId) {
    const prev = await Batch.findById(prevBatchId).lean().maxTimeMS(5000);
    if (prev) {
      const admission = student.admissionMongoId
        ? await Admission.findById(student.admissionMongoId)
        : null;
      if (admission) await writeAdmissionBatchLink(admission, prev, { clear: true });
      await refreshBatchEnrolledCount(prev);
    }
  }

  if (batch) {
    pushBatchHistory(student, batch, {
      joiningDate,
      currentTerm,
      note: editor ? `Assigned by ${editor}` : "",
    });
    const admission = student.admissionMongoId
      ? await Admission.findById(student.admissionMongoId)
      : null;
    if (admission) {
      await writeAdmissionBatchLink(admission, batch);
      await refreshBatchEnrolledCount(batch);
    }
  } else {
    student.batchId = null;
    student.batchName = "";
  }
}

export async function assignStudentBatch(id, payload = {}, editor = "master-admin") {
  const oid = asObjectId(id);
  const doc = oid
    ? await Student.findById(oid)
    : await Student.findOne({ studentId: String(id || "").trim() });
  if (!doc) throw httpError("Student not found", 404);

  if (!payload.batchId) throw httpError("Batch is required", 400);

  const academics = await resolveAcademics(
    {
      universityId: payload.universityId || doc.universityId,
      courseId: payload.courseId || doc.courseId,
      batchId: payload.batchId,
      session: payload.session !== undefined ? payload.session : doc.session,
      currentTerm: payload.currentTerm || doc.currentTerm,
    },
    { requireActive: true, existing: doc.toObject() }
  );

  if (!academics.batch) throw httpError("Batch not found", 404);

  const sameBatch = String(doc.batchId || "") === String(academics.batch._id);
  if (!sameBatch) {
    await applyBatchChange(doc, academics.batch, {
      joiningDate: payload.joiningDate || new Date(),
      currentTerm: academics.currentTerm,
      editor,
    });
  }

  if (payload.session !== undefined) doc.session = payload.session || doc.session;
  doc.session = academics.session || doc.session;
  doc.currentTerm = academics.currentTerm;
  if (academics.universityId) doc.universityId = academics.universityId;
  if (academics.courseId) doc.courseId = academics.courseId;
  doc.universityName = academics.universityName || doc.universityName;
  doc.courseName = academics.courseName || doc.courseName;
  doc.courseCode = academics.courseCode || doc.courseCode;
  doc.updatedBy = editor;
  await doc.save();

  logAndEmit(
    editor,
    "update",
    doc,
    `Assigned batch ${academics.batch.name || academics.batch.batchId} to ${doc.studentId}`
  );
  return getStudentById(doc._id);
}

export async function updateStudentStatus(id, status, editor = "master-admin") {
  if (!STUDENT_STATUSES.includes(status)) {
    throw httpError("Invalid student status", 400);
  }
  const oid = asObjectId(id);
  const doc = oid
    ? await Student.findById(oid)
    : await Student.findOne({ studentId: String(id || "").trim() });
  if (!doc) throw httpError("Student not found", 404);

  doc.status = status;
  doc.updatedBy = editor;
  await doc.save();

  if (doc.admissionMongoId) {
    await Admission.updateOne(
      { _id: doc.admissionMongoId },
      { $set: { studentStatus: status } }
    );
  }

  logAndEmit(editor, "update", doc, `Student ${doc.studentId} status → ${status}`);
  return getStudentById(doc._id, { includeSummaries: false });
}

export async function syncStudentsFromAdmissions(editor = "master-admin") {
  const approved = await Admission.find({ status: "Approved" })
    .sort({ admissionDate: -1 })
    .maxTimeMS(20000);

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;

  for (const admission of approved) {
    try {
      const hadLink = Boolean(admission.studentId);
      const result = await ensureStudentFromAdmission(admission._id, editor);
      if (!result) {
        failed += 1;
        continue;
      }
      if (!hadLink && result.studentId) created += 1;
      else if (!hadLink) linked += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error("sync student failed:", admission.admissionId, err?.message || err);
    }
  }

  const list = await listStudents();
  return {
    created,
    linked,
    skipped,
    failed,
    totalApproved: approved.length,
    rows: list.rows,
    stats: list.stats,
  };
}

/**
 * Keep Student.batchId in sync when Batches module assigns/removes admissions.
 */
export async function syncStudentBatchFromAdmission(admission, batch, { clear = false, editor = "master-admin" } = {}) {
  if (!admission?._id) return null;
  const student = await Student.findOne({
    $or: [{ admissionMongoId: admission._id }, { admissionId: admission.admissionId }],
  });
  if (!student) return null;

  if (clear) {
    if (student.batchId && String(student.batchId) === String(batch?._id || "")) {
      closeOpenBatchHistory(student, new Date());
      student.batchId = null;
      student.batchName = "";
      student.updatedBy = editor;
      await student.save();
    }
    return student;
  }

  if (!batch) return student;
  if (String(student.batchId || "") === String(batch._id)) return student;

  closeOpenBatchHistory(student, new Date());
  pushBatchHistory(student, batch, {
    joiningDate: new Date(),
    currentTerm: student.currentTerm,
    note: "Synced from batch assignment",
  });
  student.updatedBy = editor;
  await student.save();
  return student;
}
