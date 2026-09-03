import { Router } from "express";
import mongoose from "mongoose";
import {
  Admission,
  ADMISSION_MODES,
  ADMISSION_STATUSES,
} from "../models/Admission.js";
import { requireMasterAdminJwt } from "../middleware/requireMasterAdminJwt.js";
import { requireStudentJwt } from "../middleware/requireStudentJwt.js";
import {
  verifyMasterAdminToken,
  verifyStudentToken,
} from "../lib/jwt.js";
import { educationDocumentUpload } from "../modules/admissions/admissions.upload.js";
import { notifyAdmissionStatusChange } from "../lib/studentNotifications.js";
import { upsertFeeFromAdmission } from "../modules/fees/fees.service.js";
import { ensureStudentFromAdmission } from "../modules/students/students.service.js";
import { University } from "../modules/universities/universities.model.js";
import { Course } from "../modules/courses/courses.model.js";
import { Student } from "../modules/students/students.model.js";
import { admissionsImportUpload } from "../modules/admissions/admissions-import.upload.js";
import { executeAdmissionEnrichment } from "../modules/admissions/admissionEnrichment.service.js";
import { bestPhoto } from "../lib/photo.js";

const router = Router();

const GST_INSTITUTE_ID = "institute-gst";

function courseOption(doc) {
  const name = String(doc.name || "").trim();
  const code = String(doc.code || "").trim();
  return {
    id: String(doc._id),
    _id: String(doc._id),
    name,
    code,
    label: code ? `${name} — ${code}` : name,
    durationLabel: doc.durationLabel || "",
    semesterCount: Number(doc.semesterCount) || 0,
    category: doc.category || "",
    feesTotal: doc.fees?.total || "",
    feesRegistration: doc.fees?.registration || "",
    feesExam: doc.fees?.exam || "",
    type: doc.type || "University",
  };
}

function courseDisplayLabel(course) {
  const name = String(course?.name || "").trim();
  const code = String(course?.code || "").trim();
  if (!name) return code;
  return code ? `${name} — ${code}` : name;
}

function courseTotalFee(course) {
  const total = course?.fees?.total;
  if (total == null) return "";
  return String(total).trim();
}

function isInstituteCourse(course) {
  return String(course?.type || "") === "Institute" || !course?.universityId;
}

function isGstUniversityDoc(uni) {
  if (!uni) return false;
  return (
    /^(GST|TNS)$/i.test(String(uni.shortName || "").trim()) ||
    /grow\s*skills/i.test(String(uni.name || "").trim()) ||
    /thakur\s*niranjan/i.test(String(uni.name || "").trim())
  );
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

function pickNestedId(raw, key) {
  const top = raw?.[key];
  if (top != null && String(top).trim()) return String(top).trim();
  const details = raw?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const nested = details[key];
    if (nested != null && String(nested).trim()) return String(nested).trim();
  }
  return "";
}

function hasOwnNested(raw, key) {
  if (raw && Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
    return true;
  }
  const details = raw?.details;
  return Boolean(
    details &&
      typeof details === "object" &&
      !Array.isArray(details) &&
      Object.prototype.hasOwnProperty.call(details, key)
  );
}

function parseTermNumber(raw, details) {
  const value = raw?.termNumber ?? details?.termNumber;
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Resolve university/course/term/fee for create and (when provided) update.
 * New admissions require an Active course. Updates of existing records stay lenient.
 */
async function resolveAdmissionAcademics(raw = {}, { isCreate = false, existing = null } = {}) {
  const detailsIn =
    raw.details && typeof raw.details === "object" && !Array.isArray(raw.details)
      ? raw.details
      : {};
  const existingDetails =
    existing?.details && typeof existing.details === "object" && !Array.isArray(existing.details)
      ? existing.details
      : {};

  const incomingCourseId = pickNestedId(raw, "courseId");
  const incomingUniversityId = pickNestedId(raw, "universityId");
  const existingCourseId = existing?.courseId
    ? String(existing.courseId)
    : existingDetails.courseId
      ? String(existingDetails.courseId)
      : "";
  const existingUniversityId = existing?.universityId
    ? String(existing.universityId)
    : existingDetails.universityId
      ? String(existingDetails.universityId)
      : "";

  const courseIdRaw = incomingCourseId || (isCreate ? "" : existingCourseId);
  const universityIdRaw = hasOwnNested(raw, "universityId")
    ? incomingUniversityId
    : isCreate
      ? incomingUniversityId
      : existingUniversityId;

  if (!isCreate && !courseIdRaw) {
    return {
      ok: true,
      legacy: true,
    };
  }

  if (isCreate && !courseIdRaw) {
    return { ok: false, error: "Please select a course" };
  }

  if (!mongoose.isValidObjectId(courseIdRaw)) {
    return { ok: false, error: "Invalid course" };
  }

  const course = await Course.findOne({
    _id: courseIdRaw,
    softDelete: { $ne: true },
  })
    .lean()
    .maxTimeMS(8000);

  const courseChanging =
    isCreate || String(courseIdRaw) !== String(existingCourseId || "");

  if (!course) {
    if (!isCreate && !courseChanging) {
      return { ok: true, legacy: true };
    }
    return { ok: false, error: "Course not found" };
  }
  const requireActive = isCreate || courseChanging;

  if (requireActive && String(course.status || "Active") !== "Active") {
    return {
      ok: false,
      error: "Selected course is not available for new admission",
    };
  }

  const institute = isInstituteCourse(course);
  let university = null;
  let universityId = null;

  if (!institute) {
    const neededUniId =
      universityIdRaw && universityIdRaw !== GST_INSTITUTE_ID
        ? universityIdRaw
        : String(course.universityId || "");

    if (!neededUniId || !mongoose.isValidObjectId(neededUniId)) {
      if (requireActive) {
        return { ok: false, error: "Please select a university" };
      }
    } else {
      university = await University.findOne({
        _id: neededUniId,
        softDelete: { $ne: true },
      })
        .lean()
        .maxTimeMS(8000);

      if (!university) {
        if (requireActive) return { ok: false, error: "University not found" };
      } else {
        if (requireActive && String(university.status || "Active") !== "Active") {
          return { ok: false, error: "Selected university is not active" };
        }
        if (String(course.universityId) !== String(university._id)) {
          return {
            ok: false,
            error: "Selected course does not belong to the selected university",
          };
        }
        universityId = university._id;
      }
    }
  } else if (
    universityIdRaw &&
    universityIdRaw !== GST_INSTITUTE_ID &&
    mongoose.isValidObjectId(universityIdRaw)
  ) {
    university = await University.findOne({
      _id: universityIdRaw,
      softDelete: { $ne: true },
    })
      .lean()
      .maxTimeMS(8000);

    if (university) {
      if (requireActive && !isGstUniversityDoc(university)) {
        return {
          ok: false,
          error: "Institute courses cannot be linked to this university",
        };
      }
      if (requireActive && String(university.status || "Active") !== "Active") {
        return { ok: false, error: "Selected university is not active" };
      }
      if (isGstUniversityDoc(university)) {
        universityId = university._id;
      }
    }
  }

  const structure = academicStructure(course);
  let termNumber = parseTermNumber(raw, detailsIn);
  if (termNumber == null && !isCreate) {
    termNumber = parseTermNumber(existing, existingDetails);
  }
  let termType = String(
    raw.termType || detailsIn.termType || structure.termType || ""
  ).trim();

  if (structure.count > 0) {
    if (requireActive && !termNumber) {
      return {
        ok: false,
        error: `Please select ${structure.termType.toLowerCase()}`,
      };
    }
    if (termNumber != null && (termNumber < 1 || termNumber > structure.count)) {
      return {
        ok: false,
        error: `Invalid ${structure.termType.toLowerCase()} selection`,
      };
    }
    termType = structure.termType;
  } else {
    termType = "";
    termNumber = null;
  }

  const uniName =
    university?.name ||
    course.universityName ||
    (institute ? "Thakur Niranjan Singh I.T.I. & Computer" : "");
  const uniShort =
    university?.shortName ||
    course.universityShortName ||
    (institute ? "TNS" : "");

  const totalFee = courseTotalFee(course);
  const session = String(
    raw.session || detailsIn.session || existing?.session || existingDetails.session || ""
  ).trim();

  return {
    ok: true,
    legacy: false,
    universityId,
    courseId: course._id,
    courseLabel: courseDisplayLabel(course),
    college: uniName,
    fee: totalFee,
    session,
    termType,
    termNumber,
    applyFee: isCreate || courseChanging,
    snapshots: {
      universityId: universityId ? String(universityId) : "",
      courseId: String(course._id),
      universityName: uniName,
      universityNameSnapshot: uniName,
      universityShortName: uniShort,
      courseNameSnapshot: course.name || "",
      courseCodeSnapshot: course.code || "",
      courseDuration: course.durationLabel || "",
      category: course.category || "",
      semesterCount: Number(course.semesterCount) || 0,
      termType,
      termNumber,
      session,
      totalFee: isCreate || courseChanging ? totalFee : detailsIn.totalFee || existingDetails.totalFee || totalFee,
    },
  };
}

function applyAcademicToPayload(payload, academic) {
  if (!academic?.ok || academic.legacy) return payload;
  const next = { ...payload };
  next.course = academic.courseLabel || next.course;
  next.courseId = academic.courseId || null;
  next.universityId = academic.universityId || null;
  next.termType = academic.termType || "";
  next.termNumber = academic.termNumber;
  next.session = academic.session || next.session || "";
  if (academic.college) next.college = academic.college;
  if (academic.applyFee) {
    next.fee = academic.fee || "";
  }
  if (next.details && typeof next.details === "object") {
    next.details = {
      ...next.details,
      ...academic.snapshots,
    };
    if (academic.applyFee) next.details.totalFee = academic.fee || "";
  } else {
    next.details = { ...academic.snapshots };
  }
  return next;
}

function hasAcademicInput(body = {}) {
  if (!body || typeof body !== "object") return false;
  if (
    body.courseId != null ||
    body.universityId != null ||
    body.termType != null ||
    body.termNumber != null ||
    body.session != null
  ) {
    return true;
  }
  const details = body.details;
  if (!details || typeof details !== "object") return false;
  return Boolean(
    details.courseId ||
      details.universityId ||
      details.termType != null ||
      details.termNumber != null
  );
}

/**
 * Active universities + courses for student online admission / public catalog.
 * Source of truth: master-admin Universities + Courses modules.
 */
async function buildAdmissionCatalog() {
  const [universities, courses] = await Promise.all([
    University.find({ softDelete: false, status: "Active" })
      .select("name shortName")
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(8000),
    Course.find({ softDelete: false, status: "Active" })
      .select(
        "name code type universityId universityShortName universityName durationLabel semesterCount category fees"
      )
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(8000),
  ]);

  const byUni = new Map();
  for (const uni of universities) {
    const id = String(uni._id);
    const shortName = String(uni.shortName || "").trim();
    const name = String(uni.name || "").trim();
    byUni.set(id, {
      id,
      _id: id,
      name,
      shortName,
      label: shortName && name ? `${shortName} — ${name}` : shortName || name,
      type: "University",
      courses: [],
    });
  }

  let gstBucket = null;
  const ensureGst = () => {
    if (!gstBucket) {
      gstBucket = {
        id: GST_INSTITUTE_ID,
        _id: GST_INSTITUTE_ID,
        name: "Thakur Niranjan Singh I.T.I. & Computer",
        shortName: "TNS",
        label: "TNS — Thakur Niranjan Singh I.T.I. & Computer",
        type: "Institute",
        courses: [],
      };
    }
    return gstBucket;
  };

  for (const doc of courses) {
    const option = courseOption(doc);
    if (!option.name) continue;

    if (doc.type === "Institute" || !doc.universityId) {
      ensureGst().courses.push(option);
      continue;
    }

    const uniId = String(doc.universityId);
    const bucket = byUni.get(uniId);
    if (bucket) {
      bucket.courses.push(option);
    } else {
      // Orphan university-linked course — still show under GST so student can apply
      ensureGst().courses.push(option);
    }
  }

  const universityList = [...byUni.values()].filter((u) => u.courses.length > 0);
  if (gstBucket?.courses.length) {
    universityList.push(gstBucket);
  }

  return {
    universities: universityList,
    totalCourses: universityList.reduce((sum, u) => sum + u.courses.length, 0),
  };
}

/** Student or master-admin JWT (for education marksheet uploads). */
function requireStudentOrMasterAdminJwt(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ success: false, message: "Authorization required" });
  }

  const raw = token.trim();
  try {
    const decoded = verifyStudentToken(raw);
    req.student = {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      phone: decoded.phone || null,
    };
    return next();
  } catch {
    // fall through to master-admin
  }

  try {
    const decoded = verifyMasterAdminToken(raw);
    req.masterAdmin = {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name,
    };
    return next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      message:
        e.name === "TokenExpiredError"
          ? "Token expired"
          : "Invalid or expired token",
    });
  }
}

/** Same IT training courses as landing “Connect With Grow Skills Tech” */
export const TRAINING_COURSES = [
  "Full-Stack MERN Development (React, Node, MongoDB)",
  "Frontend Engineering (React.js / Next.js Pro)",
  "Backend Architecture & API Development",
  "Mobile App Development (React Native / Flutter)",
  "Python, Data Analytics & AI/ML Basics",
  "UI/UX Design & Figma Mastery",
  "Industrial Training / College Internship Program",
  "Custom Corporate / Batch Training",
];

async function nextAdmissionId() {
  const year = new Date().getFullYear();
  const prefix = `ADM-${year}-`;
  const latest = await Admission.findOne({ admissionId: new RegExp(`^${prefix}`) })
    .sort({ admissionId: -1 })
    .select("admissionId")
    .lean();

  let seq = 1;
  if (latest?.admissionId) {
    const part = latest.admissionId.slice(prefix.length);
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function normalizeAdmissionDetails(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const details = { ...raw };
  const gender = String(details.gender || "").trim();
  const maritalStatus = String(details.maritalStatus || "").trim();
  const husbandName = String(details.husbandName || "")
    .trim()
    .toUpperCase();

  details.gender = gender;
  details.maritalStatus = maritalStatus;
  details.husbandName =
    gender === "Female" && maritalStatus === "Married" ? husbandName : "";

  delete details.registrationFee;

  return details;
}

function normalizePayload(raw = {}) {
  const mode = ADMISSION_MODES.includes(String(raw.mode || "").trim())
    ? String(raw.mode).trim()
    : "Online";
  const status = ADMISSION_STATUSES.includes(String(raw.status || "").trim())
    ? String(raw.status).trim()
    : "Pending";

  const details = normalizeAdmissionDetails(raw.details);

  const payload = {
    applicant: String(raw.applicant || "").trim(),
    email: String(raw.email || "").trim().toLowerCase(),
    phone: String(raw.phone || "").trim(),
    course: String(raw.course || "").trim(),
    mode,
    counsellor: String(raw.counsellor || "").trim(),
    fee: String(raw.fee || "").trim(),
    status,
    city: String(raw.city || "").trim(),
    state: String(raw.state || "").trim(),
    college: String(raw.college || "").trim(),
    studentStatus: String(raw.studentStatus || "").trim(),
    notes: String(raw.notes || "").trim(),
    ...(details !== undefined ? { details } : {}),
  };

  if (raw.session != null) payload.session = String(raw.session).trim();
  if (raw.termType != null) payload.termType = String(raw.termType).trim();
  if (raw.termNumber != null && raw.termNumber !== "") {
    const n = Number(raw.termNumber);
    if (Number.isFinite(n) && n > 0) payload.termNumber = Math.round(n);
    else payload.termNumber = null;
  }

  return payload;
}

function validatePayload(payload) {
  if (!payload.applicant) return "Applicant name is required";
  if (!payload.email) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Invalid email address";
  if (!payload.phone) return "Phone number is required";
  if (!payload.course && !payload.courseId) return "Please select a course";
  return null;
}

/** Strip large document fields from list payloads while preserving list photos. */
function slimDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (value == null) continue;
    if (key === "registrationFee") continue;
    if (typeof value === "string") {
      if (value.startsWith("data:")) {
        if (key === "photoPreview" || /photo/i.test(key)) out.hasPhoto = true;
        else out[`has_${key}`] = true;
        continue;
      }
      if (value.length > 2000) continue;
    }
    if (
      key === "photoPreview" ||
      key === "photo" ||
      key === "educationDocument" ||
      key === "marksheetData" ||
      key === "documentData"
    ) {
      if (value) out.hasPhoto = key === "photoPreview" || key === "photo" ? true : out.hasPhoto;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function compactPhoto(photo) {
  const value = String(photo || "").trim();
  if (!value) return "";
  return value;
}

function studentMatchQuery(rows) {
  const ids = rows.flatMap((row) => [row.studentMongoId, row.details?.studentMongoId]).filter((value) => mongoose.isValidObjectId(value));
  const admissionIds = rows.map((row) => row._id).filter((value) => mongoose.isValidObjectId(value));
  const admissionNumbers = rows.map((row) => row.admissionId).filter(Boolean);
  const emails = rows.map((row) => String(row.email || "").toLowerCase()).filter(Boolean);
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (admissionIds.length) or.push({ admissionMongoId: { $in: admissionIds } });
  if (admissionNumbers.length) or.push({ admissionId: { $in: admissionNumbers } });
  if (emails.length) or.push({ "contact.email": { $in: emails } });
  return or.length ? { $or: or } : null;
}

async function loadLinkedStudents(rows) {
  const query = studentMatchQuery(rows);
  if (!query) return [];
  return Student.find(query)
    .select("studentId admissionId admissionMongoId nameEnglish nameHindi fatherName motherName dateOfBirth gender category contact address guardian photo documents education admissionDetails status")
    .lean()
    .maxTimeMS(10000);
}

function studentKeySet(row) {
  return [row._id, row.studentMongoId, row.admissionMongoId, row.admissionId, row.studentId, row.email, row.contact?.email]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function findLinkedStudent(doc, students = []) {
  const keys = new Set(studentKeySet(doc));
  return students.find((student) => studentKeySet(student).some((key) => keys.has(key))) || null;
}

function toRow(doc, linkedStudent = null) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const details =
    d.details && typeof d.details === "object" && !Array.isArray(d.details)
      ? { ...d.details }
      : {};
  delete details.registrationFee;
  const courseId = d.courseId ? String(d.courseId) : details.courseId || "";
  const universityId = d.universityId
    ? String(d.universityId)
    : details.universityId || "";
  const student = linkedStudent || {};
  const studentDetails = student.admissionDetails && typeof student.admissionDetails === "object" ? student.admissionDetails : {};
  const photo = compactPhoto(bestPhoto(student.photo, details.photoPreview, details.photo));
  return {
    id: d.admissionId,
    _id: String(d._id),
    admissionId: d.admissionId,
    applicant: d.applicant || student.nameEnglish || details.nameEnglish || "",
    email: d.email,
    phone: d.phone,
    program: d.course,
    course: d.course,
    courseId,
    universityId,
    termType: d.termType || details.termType || "",
    termNumber: d.termNumber ?? details.termNumber ?? null,
    session: d.session || details.session || "",
    mode: d.mode,
    counsellor: d.counsellor || "—",
    fee: d.fee,
    status: d.status,
    city: d.city,
    state: d.state,
    college: d.college,
    studentStatus: d.studentStatus,
    studentId: d.studentId || details.studentId || student.studentId || "",
    studentMongoId: d.studentMongoId
      ? String(d.studentMongoId)
      : details.studentMongoId
        ? String(details.studentMongoId)
        : student._id
          ? String(student._id)
          : "",
      nameEnglish: student.nameEnglish || details.nameEnglish || d.applicant || "",
      nameHindi: student.nameHindi || details.nameHindi || "",
      fatherName: student.fatherName || details.fatherName || "",
      motherName: student.motherName || details.motherName || "",
      dateOfBirth: student.dateOfBirth || details.dateOfBirth || "",
      gender: student.gender || details.gender || "",
      category: student.category || details.category || "",
      photo,
      hasPhoto: Boolean(photo || student.photo || details.photoPreview || details.photo),
      mobile: student.contact?.mobile || d.phone || details.studentMobile || details.contactNo || "",
      address: student.address || {},
      guardian: student.guardian || {},
      education: Array.isArray(student.education) ? student.education : details.education || [],
      documentCount: Array.isArray(student.documents) ? student.documents.length : 0,
      studentStatus: student.status || d.studentStatus || "",
      studentDetails,
    notes: d.notes,
    details,
    date: d.admissionDate
      ? new Date(d.admissionDate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—",
    admissionDate: d.admissionDate,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function toListRow(doc, linkedStudent = null) {
  const row = toRow(doc, linkedStudent);
  return {
    ...row,
    details: slimDetails(row.details),
  };
}

/**
 * POST /api/admissions/upload-education-document
 * multipart field: file
 * Auth: student or master-admin JWT
 * Max size: 400 KB — PDF or image
 */
router.post(
  "/upload-education-document",
  requireStudentOrMasterAdminJwt,
  (req, res, next) => {
    educationDocumentUpload.single("file")(req, res, (err) => {
      if (err) {
        const isSize =
          err.code === "LIMIT_FILE_SIZE" ||
          /File too large/i.test(String(err.message || ""));
        return res.status(400).json({
          success: false,
          message: isSize
            ? "Document must be 400 KB or smaller"
            : err.message || "Upload failed",
        });
      }
      next();
    });
  },
  (req, res) => {
    try {
      if (!req.file?.filename) {
        return res
          .status(400)
          .json({ success: false, message: "No document file received" });
      }
      const url = `/uploads/admissions/education/${req.file.filename}`;
      return res.status(201).json({
        success: true,
        message: "Document uploaded",
        data: {
          url,
          name: req.file.originalname || req.file.filename,
          size: req.file.size,
          mimeType: req.file.mimetype,
        },
      });
    } catch (err) {
      console.error("admission education upload error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Failed to upload document" });
    }
  }
);

/**
 * GET /api/admissions/online/mine
 * Latest online admission for the logged-in student.
 */
router.get("/online/mine", requireStudentJwt, async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    const entry = await Admission.findOne({
      email,
      mode: "Online",
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!entry) {
      return res.json({ success: true, entry: null });
    }

    return res.json({ success: true, entry: toRow(entry) });
  } catch (err) {
    console.error("online admission mine error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load online admission",
    });
  }
});

/**
 * GET /api/admissions/online/access
 * Fast gate for student portal — no full form payload.
 */
router.get("/online/access", requireStudentJwt, async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    const rows = await Admission.find({ email })
      .select("status course")
      .sort({ admissionDate: -1, createdAt: -1 })
      .limit(8)
      .lean()
      .maxTimeMS(4000);

    const approved = rows.find((row) => row.status === "Approved") || null;
    const latest = rows[0] || null;

    return res.json({
      success: true,
      approved: Boolean(approved),
      status: approved ? "Approved" : String(latest?.status || ""),
      course: approved?.course || latest?.course || "",
    });
  } catch (err) {
    console.error("online admission access error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to check admission access",
    });
  }
});

/**
 * GET /api/admissions/online/approved
 * All Approved admissions for the logged-in student (shown as enrolled courses).
 */
router.get("/online/approved", requireStudentJwt, async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    const admissions = await Admission.find({
      email,
      status: "Approved",
    })
      .sort({ admissionDate: -1, createdAt: -1 })
      .lean()
      .maxTimeMS(8000);

    const courseIds = [
      ...new Set(
        admissions
          .map((row) => {
            const id = row?.details?.courseId;
            return mongoose.isValidObjectId(id) ? String(id) : null;
          })
          .filter(Boolean)
      ),
    ];

    const courseDocs =
      courseIds.length > 0
        ? await Course.find({
            _id: { $in: courseIds },
            softDelete: false,
          })
            .select(
              "name code durationLabel semesterCount category universityName universityShortName type"
            )
            .lean()
            .maxTimeMS(8000)
        : [];

    const courseById = new Map(
      courseDocs.map((doc) => [String(doc._id), doc])
    );

    const rows = admissions.map((entry) => {
      const base = toRow(entry);
      const details =
        base.details && typeof base.details === "object" ? base.details : {};
      const courseDoc = details.courseId
        ? courseById.get(String(details.courseId))
        : null;

      const duration =
        String(details.courseDuration || "").trim() ||
        courseDoc?.durationLabel ||
        "";
      const universityName =
        String(details.universityName || "").trim() ||
        courseDoc?.universityName ||
        base.college ||
        "";
      const semesterCount = Number(
        courseDoc?.semesterCount ?? details.semesterCount ?? 0
      );

      return {
        ...base,
        title: base.course,
        duration,
        universityName,
        universityShortName:
          String(details.universityShortName || "").trim() ||
          courseDoc?.universityShortName ||
          "",
        category: courseDoc?.category || details.category || "",
        semesterCount: Number.isFinite(semesterCount) ? semesterCount : 0,
        courseCode:
          String(details.courseCode || "").trim() || courseDoc?.code || "",
      };
    });

    return res.json({
      success: true,
      rows,
      total: rows.length,
    });
  } catch (err) {
    console.error("online admission approved error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load approved courses",
    });
  }
});

/**
 * GET /api/admissions/catalog
 * Public catalog for student online admission — live universities & courses.
 */
router.get("/catalog", async (_req, res) => {
  try {
    const data = await buildAdmissionCatalog();
    return res.json({
      success: true,
      message: "Admission catalog fetched",
      universities: data.universities,
      totalCourses: data.totalCourses,
    });
  } catch (err) {
    console.error("admission catalog error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load universities and courses",
    });
  }
});

/**
 * POST /api/admissions/online
 * Student portal online admission application.
 * Auth: student JWT
 * Forces mode=Online, status=Pending
 */
router.post("/online", requireStudentJwt, async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();

    if (email) {
      const existingOpen = await Admission.findOne({
        email,
        mode: "Online",
        status: { $in: ["Pending", "Verification"] },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (existingOpen) {
        return res.status(409).json({
          success: false,
          message:
            "You already have an online application under review. Please wait for admin approval.",
          entry: toRow(existingOpen),
        });
      }
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    let payload = normalizePayload({
      ...body,
      mode: "Online",
      status: "Pending",
      ...(email ? { email } : {}),
    });

    if (pickNestedId(body, "courseId")) {
      const academic = await resolveAdmissionAcademics(body, { isCreate: true });
      if (!academic.ok) {
        return res.status(400).json({ success: false, message: academic.error });
      }
      payload = applyAcademicToPayload(payload, academic);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const admissionDate =
      body.admissionDate != null && String(body.admissionDate).trim()
        ? new Date(body.admissionDate)
        : new Date();
    if (Number.isNaN(admissionDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid admission date" });
    }

    const details =
      payload.details && typeof payload.details === "object"
        ? {
            ...payload.details,
            source: "student-online",
            submittedByEmail: email || "",
          }
        : {
            source: "student-online",
            submittedByEmail: email || "",
          };

    const admissionId = await nextAdmissionId();
    if (!String(details.registrationNo || "").trim()) {
      details.registrationNo = admissionId;
    }

    const created = await Admission.create({
      ...payload,
      details,
      mode: "Online",
      status: "Pending",
      admissionId,
      admissionDate,
      createdBy: email || "student",
    });

    try {
      await upsertFeeFromAdmission(created);
    } catch (feeErr) {
      console.error("online admission fee sync failed:", feeErr?.message || feeErr);
    }

    return res.status(201).json({
      success: true,
      message: "Online admission application submitted",
      entry: toRow(created),
    });
  } catch (err) {
    console.error("online admission create error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Admission ID conflict — please retry",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to submit online admission",
    });
  }
});

router.use(requireMasterAdminJwt);

router.post(
  "/import-update",
  (req, res, next) => {
    admissionsImportUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || "XLSX upload failed",
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({
          success: false,
          message: "No XLSX file received",
        });
      }
      const dryRun = String(req.body?.dryRun ?? "true").toLowerCase() !== "false";
      const report = await executeAdmissionEnrichment(
        req.file.buffer,
        req.file.originalname || "student-enrichment.xlsx",
        dryRun
      );
      return res.json(report);
    } catch (err) {
      console.error("admission enrichment import error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to process admission enrichment XLSX",
      });
    }
  }
);

router.get("/meta", (_req, res) => {
  return res.json({
    success: true,
    courses: TRAINING_COURSES,
    modes: ADMISSION_MODES,
    statuses: ADMISSION_STATUSES,
  });
});

router.get("/", async (_req, res) => {
  try {
    const rows = await Admission.find()
      .sort({ admissionDate: -1, createdAt: -1 })
      .lean()
      .maxTimeMS(12000);

    const students = await loadLinkedStudents(rows);
    const listRows = rows.map((row) => toListRow(row, findLinkedStudent(row, students)));
    let pending = 0;
    let approved = 0;
    let verification = 0;
    let rejected = 0;
    let cancelled = 0;
    let online = 0;
    let onlinePending = 0;
    for (const r of rows) {
      if (r.status === "Pending") pending += 1;
      else if (r.status === "Approved") approved += 1;
      else if (r.status === "Verification") verification += 1;
      else if (r.status === "Rejected") rejected += 1;
      else if (r.status === "Cancelled") cancelled += 1;
      if (r.mode === "Online") {
        online += 1;
        if (r.status === "Pending" || r.status === "Verification") onlinePending += 1;
      }
    }

    return res.json({
      success: true,
      rows: listRows,
      stats: {
        total: rows.length,
        pending,
        approved,
        verification,
        rejected,
        cancelled,
        online,
        onlinePending,
      },
    });
  } catch (err) {
    console.error("admissions list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch admissions" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid admission id" });
    }
    const entry = await Admission.findById(id).lean();
    if (!entry) {
      return res.status(404).json({ success: false, message: "Admission not found" });
    }
    const students = await loadLinkedStudents([entry]);
    return res.json({ success: true, entry: toRow(entry, findLinkedStudent(entry, students)) });
  } catch (err) {
    console.error("admission get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch admission" });
  }
});

router.post("/", async (req, res) => {
  try {
    let payload = normalizePayload(req.body);
    const academic = await resolveAdmissionAcademics(req.body, { isCreate: true });
    if (!academic.ok) {
      return res.status(400).json({ success: false, message: academic.error });
    }
    payload = applyAcademicToPayload(payload, academic);

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const admissionDate =
      req.body?.admissionDate != null && String(req.body.admissionDate).trim()
        ? new Date(req.body.admissionDate)
        : new Date();
    if (Number.isNaN(admissionDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid admission date" });
    }

    const admissionId = await nextAdmissionId();
    const details =
      payload.details && typeof payload.details === "object" ? { ...payload.details } : {};
    if (!String(details.registrationNo || "").trim()) {
      details.registrationNo = admissionId;
    }

    const created = await Admission.create({
      ...payload,
      details,
      admissionId,
      admissionDate,
      createdBy: req.masterAdmin?.email || "master-admin",
    });

    try {
      await upsertFeeFromAdmission(created);
    } catch (feeErr) {
      console.error("admission fee sync failed:", feeErr?.message || feeErr);
    }

    if (created.status === "Approved") {
      try {
        await ensureStudentFromAdmission(created._id, req.masterAdmin?.email || "master-admin");
      } catch (stuErr) {
        console.error("admission student sync failed:", stuErr?.message || stuErr);
      }
    }

    const fresh = await Admission.findById(created._id);
    const entry = toRow(fresh || created);
    return res.status(201).json({
      success: true,
      message: entry.studentId
        ? `Admission created · Student ${entry.studentId}`
        : "Admission created successfully",
      entry,
    });
  } catch (err) {
    console.error("admission create error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: "Admission ID conflict — retry" });
    }
    if (err?.name === "ValidationError" || err?.name === "CastError") {
      return res.status(400).json({ success: false, message: err.message || "Invalid admission data" });
    }
    return res.status(500).json({ success: false, message: "Failed to create admission" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid admission id" });
    }

    const existing = await Admission.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Admission not found" });
    }
    const previousStatus = existing.status;

    let payload = normalizePayload(req.body);
    if (hasAcademicInput(req.body)) {
      const academic = await resolveAdmissionAcademics(req.body, {
        isCreate: false,
        existing,
      });
      if (!academic.ok) {
        return res.status(400).json({ success: false, message: academic.error });
      }
      payload = applyAcademicToPayload(payload, academic);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const update = { ...payload };
    if (req.body?.admissionDate != null && String(req.body.admissionDate).trim()) {
      const d = new Date(req.body.admissionDate);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid admission date" });
      }
      update.admissionDate = d;
    }

    const updated = await Admission.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Admission not found" });
    }

    if (
      (updated.status === "Approved" || updated.status === "Rejected") &&
      updated.status !== previousStatus
    ) {
      notifyAdmissionStatusChange(updated, previousStatus).catch((e) =>
        console.error("admission notification failed:", e)
      );
    }

    try {
      await upsertFeeFromAdmission(updated);
    } catch (feeErr) {
      console.error("admission fee sync failed:", feeErr?.message || feeErr);
    }

    if (updated.status === "Approved") {
      try {
        await ensureStudentFromAdmission(updated._id, req.masterAdmin?.email || "master-admin");
      } catch (stuErr) {
        console.error("admission student sync failed:", stuErr?.message || stuErr);
      }
    }

    const fresh = await Admission.findById(updated._id);
    const entry = toRow(fresh || updated);
    return res.json({
      success: true,
      message: entry.studentId
        ? `Admission updated · Student ${entry.studentId}`
        : "Admission updated",
      entry,
    });
  } catch (err) {
    console.error("admission update error:", err);
    if (err?.name === "ValidationError" || err?.name === "CastError") {
      return res.status(400).json({ success: false, message: err.message || "Invalid admission data" });
    }
    return res.status(500).json({ success: false, message: "Failed to update admission" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid admission id" });
    }
    const deleted = await Admission.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Admission not found" });
    }
    return res.json({ success: true, message: "Admission deleted" });
  } catch (err) {
    console.error("admission delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete admission" });
  }
});

export default router;
