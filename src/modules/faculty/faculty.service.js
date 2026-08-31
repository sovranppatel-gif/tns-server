import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User, USER_TYPES } from "../../models/User.js";
import { Batch } from "../batches/batches.model.js";
import { Course } from "../courses/courses.model.js";
import { ExamSchedule } from "../exams/examSchedule.model.js";
import { Student } from "../students/students.model.js";
import { University } from "../universities/universities.model.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import {
  FACULTY_DEPARTMENTS,
  FACULTY_DESIGNATIONS,
  FACULTY_ID_PREFIX,
  FACULTY_PERMISSIONS,
} from "./faculty.constants.js";
import { FacultyAssignment } from "./facultyAssignment.model.js";
import { Faculty } from "./faculty.model.js";
import { asObjectId, httpError } from "./faculty.validation.js";

const QUERY_MS = 8000;

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toIsoDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function nextFacultyId() {
  const rows = await Faculty.aggregate([
    { $match: { facultyId: { $regex: `^${FACULTY_ID_PREFIX}\\d+$` } } },
    {
      $project: {
        n: {
          $convert: {
            input: { $substrBytes: ["$facultyId", FACULTY_ID_PREFIX.length, 8] },
            to: "int",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]).option({ maxTimeMS: QUERY_MS });
  const seq = (Number(rows[0]?.n) || 0) + 1;
  return `${FACULTY_ID_PREFIX}${String(seq).padStart(4, "0")}`;
}

async function loadUniversity(id) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return University.findOne({ _id: oid, softDelete: { $ne: true } })
    .select("name shortName status")
    .lean()
    .maxTimeMS(QUERY_MS);
}

async function loadCourse(id) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return Course.findOne({ _id: oid, softDelete: { $ne: true } })
    .select("name code universityId universityName universityShortName semesters structureType semesterCount type")
    .lean()
    .maxTimeMS(QUERY_MS);
}

async function loadBatch(id) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return Batch.findOne({ _id: oid, softDelete: { $ne: true } })
    .select("name batchId courseId universityId enrolledCount status")
    .lean()
    .maxTimeMS(QUERY_MS);
}

export async function findFacultyDoc(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  if (mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw) {
    return Faculty.findOne({ _id: raw, softDelete: { $ne: true } }).maxTimeMS(QUERY_MS);
  }
  return Faculty.findOne({
    facultyId: raw.toUpperCase(),
    softDelete: { $ne: true },
  }).maxTimeMS(QUERY_MS);
}

function toListRow(doc, extras = {}) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const personal = d.personalDetails || {};
  const employment = d.employmentDetails || {};
  const account = d.accountDetails || {};
  return {
    _id: String(d._id),
    id: d.facultyId || String(d._id),
    facultyId: d.facultyId,
    fullName: personal.fullName || "",
    profilePhoto: personal.profilePhoto || "",
    gender: personal.gender || "",
    mobile: personal.mobile || "",
    email: personal.email || "",
    designation: employment.designation || "",
    department: employment.department || "",
    qualification: employment.qualification || "",
    specialization: employment.specialization || "",
    experienceYears: Number(employment.experienceYears) || 0,
    employmentType: employment.employmentType || "",
    joiningDate: toIsoDate(employment.joiningDate),
    joiningDateLabel: formatDateLabel(employment.joiningDate),
    loginEnabled: Boolean(account.loginEnabled),
    username: account.username || "",
    status: d.status || "Active",
    assignedCourses: extras.assignedCourses || [],
    assignmentCount: extras.assignmentCount || 0,
    createdAt: d.createdAt,
  };
}

function toDetailRow(doc, extras = {}) {
  const base = toListRow(doc, extras);
  const d = doc?.toObject ? doc.toObject() : doc;
  const personal = d.personalDetails || {};
  const employment = d.employmentDetails || {};
  const account = d.accountDetails || {};
  return {
    ...base,
    personalDetails: {
      ...personal,
      dateOfBirth: toIsoDate(personal.dateOfBirth),
      dateOfBirthLabel: formatDateLabel(personal.dateOfBirth),
    },
    employmentDetails: {
      ...employment,
      facultyId: d.facultyId,
      joiningDate: toIsoDate(employment.joiningDate),
      joiningDateLabel: formatDateLabel(employment.joiningDate),
    },
    accountDetails: {
      loginEnabled: Boolean(account.loginEnabled),
      username: account.username || "",
      hasPassword: Boolean(account.userId),
    },
    permissions: Array.isArray(d.permissions) ? d.permissions : [],
    stats: extras.stats || {
      assignedCourses: 0,
      assignedSubjects: 0,
      assignedBatches: 0,
      totalStudents: 0,
    },
  };
}

async function assignmentSummaries(facultyIds) {
  if (!facultyIds.length) return new Map();
  const rows = await FacultyAssignment.aggregate([
    { $match: { facultyMongoId: { $in: facultyIds }, softDelete: false, status: "Active" } },
    {
      $group: {
        _id: "$facultyMongoId",
        courses: { $addToSet: "$courseName" },
        count: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: QUERY_MS });
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        assignedCourses: (row.courses || []).filter(Boolean),
        assignmentCount: row.count || 0,
      },
    ])
  );
}

async function syncFacultyUser(faculty, { loginEnabled, username, password, editor }) {
  const email = String(faculty.personalDetails?.email || "").toLowerCase();
  const name = faculty.personalDetails?.fullName || "";
  const phone = faculty.personalDetails?.mobile || "";
  const existingId = faculty.accountDetails?.userId || null;
  const userName = String(username || email || faculty.facultyId).toLowerCase().trim();

  if (!loginEnabled) {
    if (existingId) {
      await User.updateOne(
        { _id: existingId },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
    }
    faculty.accountDetails = {
      loginEnabled: false,
      userId: existingId || null,
      username: userName,
    };
    faculty.updatedBy = editor;
    await faculty.save();
    return faculty;
  }

  if (!email) throw httpError("Email is required to enable faculty login", 400);

  let user = existingId ? await User.findById(existingId) : null;
  if (!user) {
    user = await User.findOne({ type: USER_TYPES.FACULTY, email });
  }

  const updates = {
    email,
    name,
    phone: phone || null,
    type: USER_TYPES.FACULTY,
    isActive: faculty.status === "Active",
    erpFacultyId: faculty._id,
    emailVerified: true,
  };
  if (password) {
    updates.passwordHash = await bcrypt.hash(password, 10);
  }

  if (user) {
    if (!password && !user.passwordHash) {
      throw httpError("Password is required when enabling faculty login", 400);
    }
    Object.assign(user, updates);
    await user.save();
  } else {
    if (!password) throw httpError("Password is required when enabling faculty login", 400);
    user = await User.create({
      ...updates,
      passwordHash: updates.passwordHash,
    });
  }

  faculty.accountDetails = {
    loginEnabled: true,
    userId: user._id,
    username: userName,
  };
  faculty.updatedBy = editor;
  await faculty.save();
  return faculty;
}

export async function getFacultyStats() {
  const start = monthStart();
  const [total, active, inactive, newThisMonth, assigned] = await Promise.all([
    Faculty.countDocuments({ softDelete: false }).maxTimeMS(QUERY_MS),
    Faculty.countDocuments({ softDelete: false, status: "Active" }).maxTimeMS(QUERY_MS),
    Faculty.countDocuments({ softDelete: false, status: "Inactive" }).maxTimeMS(QUERY_MS),
    Faculty.countDocuments({
      softDelete: false,
      createdAt: { $gte: start },
    }).maxTimeMS(QUERY_MS),
    FacultyAssignment.distinct("facultyMongoId", {
      softDelete: false,
      status: "Active",
    }),
  ]);
  return {
    total,
    active,
    inactive,
    newThisMonth,
    assigned: Array.isArray(assigned) ? assigned.length : 0,
  };
}

export async function getFacultyMeta() {
  const [designations, departments] = await Promise.all([
    Faculty.distinct("employmentDetails.designation", { softDelete: false }),
    Faculty.distinct("employmentDetails.department", { softDelete: false }),
  ]);
  return {
    designations: [...new Set([...FACULTY_DESIGNATIONS, ...(designations || []).filter(Boolean)])],
    departments: [...new Set([...FACULTY_DEPARTMENTS, ...(departments || []).filter(Boolean)])],
    permissions: FACULTY_PERMISSIONS,
  };
}

export async function listFaculties(params = {}) {
  const isExport =
    String(params.export || "").trim() === "1" ||
    String(params.export || "").toLowerCase() === "true";
  const page = Math.max(1, Number(params.page) || 1);
  const maxLimit = isExport ? 2000 : 50;
  const limit = Math.min(maxLimit, Math.max(1, Number(params.limit) || (isExport ? 2000 : 10)));
  const query = { softDelete: false };
  const status = String(params.status || "").trim();
  const designation = String(params.designation || "").trim();
  const department = String(params.department || "").trim();
  if (status) query.status = status;
  if (designation) query["employmentDetails.designation"] = designation;
  if (department) query["employmentDetails.department"] = department;

  const uniOid = asObjectId(params.universityId);
  const courseOid = asObjectId(params.courseId);
  if (uniOid || courseOid) {
    const assignQuery = { softDelete: false };
    if (uniOid) assignQuery.universityId = uniOid;
    if (courseOid) assignQuery.courseId = courseOid;
    const ids = await FacultyAssignment.distinct("facultyMongoId", assignQuery);
    query._id = { $in: ids };
  }

  const search = String(params.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { facultyId: rx },
      { "personalDetails.fullName": rx },
      { "personalDetails.mobile": rx },
      { "personalDetails.alternateMobile": rx },
      { "personalDetails.email": rx },
      { "employmentDetails.designation": rx },
      { "employmentDetails.department": rx },
    ];
  }

  const [docs, total, stats] = await Promise.all([
    Faculty.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .maxTimeMS(QUERY_MS),
    Faculty.countDocuments(query).maxTimeMS(QUERY_MS),
    isExport ? Promise.resolve(null) : getFacultyStats(),
  ]);

  const summary = isExport ? new Map() : await assignmentSummaries(docs.map((d) => d._id));
  const rows = docs.map((doc) => toListRow(doc, summary.get(String(doc._id)) || {}));

  return {
    rows,
    stats: stats || {},
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
    },
  };
}

export async function getFacultyById(id) {
  const doc = await findFacultyDoc(id);
  if (!doc) return null;
  const assignments = await FacultyAssignment.find({
    facultyMongoId: doc._id,
    softDelete: false,
  })
    .sort({ createdAt: -1 })
    .lean()
    .maxTimeMS(QUERY_MS);

  const active = assignments.filter((a) => a.status === "Active");
  const batchIds = [...new Set(active.map((a) => String(a.batchId || "")).filter(Boolean))];
  const courseIds = [...new Set(active.map((a) => String(a.courseId || "")).filter(Boolean))];
  const subjectKeys = [...new Set(active.map((a) => a.subjectKey).filter(Boolean))];

  let totalStudents = 0;
  if (batchIds.length) {
    totalStudents = await Student.countDocuments({
      batchId: { $in: batchIds.map((id) => asObjectId(id)).filter(Boolean) },
      status: { $in: ["Active"] },
    }).maxTimeMS(QUERY_MS);
  }

  const summary = {
    assignedCourses: [...new Set(active.map((a) => a.courseName).filter(Boolean))],
    assignmentCount: active.length,
    stats: {
      assignedCourses: courseIds.length,
      assignedSubjects: subjectKeys.length,
      assignedBatches: batchIds.length,
      totalStudents,
    },
  };
  return toDetailRow(doc, summary);
}

export async function createFaculty(payload, editor = "master-admin") {
  const email = payload.personalDetails.email;
  const existing = await Faculty.findOne({
    softDelete: false,
    "personalDetails.email": email,
  })
    .select("_id facultyId")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (existing) throw httpError("A faculty member with this email already exists", 409);

  let facultyId = await nextFacultyId();
  const doc = await Faculty.create({
    facultyId,
    personalDetails: payload.personalDetails,
    employmentDetails: payload.employmentDetails,
    accountDetails: {
      loginEnabled: false,
      username: payload.accountDetails?.username || email,
    },
    permissions: payload.permissions || [],
    status: payload.status || "Active",
    createdBy: editor,
    updatedBy: editor,
  });

  if (payload.accountDetails?.loginEnabled) {
    await syncFacultyUser(doc, {
      loginEnabled: true,
      username: payload.accountDetails.username,
      password: payload.password,
      editor,
    });
  }

  emitSectionUpdate({ section: "faculty", action: "create", resourceId: String(doc._id) });
  return toDetailRow(await Faculty.findById(doc._id));
}

export async function updateFaculty(id, payload, editor = "master-admin") {
  const doc = await findFacultyDoc(id);
  if (!doc) throw httpError("Faculty not found", 404);

  if (payload.personalDetails) {
    const nextEmail = String(payload.personalDetails.email || "").toLowerCase();
    if (nextEmail) {
      const existing = await Faculty.findOne({
        _id: { $ne: doc._id },
        softDelete: false,
        "personalDetails.email": nextEmail,
      })
        .select("_id facultyId")
        .lean()
        .maxTimeMS(QUERY_MS);
      if (existing) throw httpError("A faculty member with this email already exists", 409);
    }
    doc.personalDetails = { ...doc.personalDetails.toObject?.() || doc.personalDetails, ...payload.personalDetails };
  }
  if (payload.employmentDetails) {
    doc.employmentDetails = {
      ...(doc.employmentDetails.toObject?.() || doc.employmentDetails),
      ...payload.employmentDetails,
    };
  }
  if (payload.status) doc.status = payload.status;
  if (payload.permissions) doc.permissions = payload.permissions;
  doc.updatedBy = editor;
  await doc.save();

  if (payload.accountDetails) {
    await syncFacultyUser(doc, {
      loginEnabled: Boolean(payload.accountDetails.loginEnabled),
      username: payload.accountDetails.username,
      password: payload.password,
      editor,
    });
  }

  emitSectionUpdate({ section: "faculty", action: "update", resourceId: String(doc._id) });
  return getFacultyById(doc._id);
}

export async function updateFacultyStatus(id, status, editor = "master-admin") {
  const doc = await findFacultyDoc(id);
  if (!doc) throw httpError("Faculty not found", 404);
  doc.status = status;
  doc.updatedBy = editor;
  await doc.save();
  if (doc.accountDetails?.userId) {
    await User.updateOne(
      { _id: doc.accountDetails.userId },
      { $set: { isActive: status === "Active" } }
    );
  }
  emitSectionUpdate({ section: "faculty", action: "status", resourceId: String(doc._id) });
  return toListRow(doc);
}

export async function deleteFaculty(id, editor = "master-admin") {
  const doc = await findFacultyDoc(id);
  if (!doc) throw httpError("Faculty not found", 404);
  doc.softDelete = true;
  doc.status = "Inactive";
  doc.updatedBy = editor;
  await doc.save();
  await FacultyAssignment.updateMany(
    { facultyMongoId: doc._id, softDelete: false },
    { $set: { status: "Inactive", updatedBy: editor } }
  );
  if (doc.accountDetails?.userId) {
    await User.updateOne({ _id: doc.accountDetails.userId }, { $set: { isActive: false } });
  }
  emitSectionUpdate({ section: "faculty", action: "delete", resourceId: String(doc._id) });
  return toListRow(doc);
}

export async function listFacultyStudents(facultyRef) {
  const doc = await findFacultyDoc(facultyRef);
  if (!doc) throw httpError("Faculty not found", 404);
  const assignments = await FacultyAssignment.find({
    facultyMongoId: doc._id,
    softDelete: false,
    status: "Active",
  })
    .lean()
    .maxTimeMS(QUERY_MS);

  const batchIds = assignments.map((a) => a.batchId).filter(Boolean);
  if (!batchIds.length) return { rows: [], total: 0 };

  const students = await Student.find({
    batchId: { $in: batchIds },
  })
    .select("studentId admissionId nameEnglish status courseName batchName currentTerm contact")
    .sort({ nameEnglish: 1 })
    .limit(200)
    .lean()
    .maxTimeMS(QUERY_MS);

  const byBatch = new Map(assignments.map((a) => [String(a.batchId), a]));
  const rows = students.map((s) => {
    const assignment = byBatch.get(String(s.batchId));
    const term = s.currentTerm || {};
    return {
      _id: String(s._id),
      studentId: s.studentId,
      admissionId: s.admissionId || "",
      name: s.nameEnglish || "",
      course: s.courseName || assignment?.courseName || "",
      batch: s.batchName || assignment?.batchName || "",
      semester: term.number ? `${term.type || "Semester"} ${term.number}` : assignment?.semester || "—",
      status: s.status || "Active",
      mobile: s.contact?.mobile || "",
    };
  });
  return { rows, total: rows.length };
}

export async function listFacultyExams(facultyRef) {
  const doc = await findFacultyDoc(facultyRef);
  if (!doc) throw httpError("Faculty not found", 404);
  const assignments = await FacultyAssignment.find({
    facultyMongoId: doc._id,
    softDelete: false,
    status: "Active",
  })
    .select("courseId batchId")
    .lean()
    .maxTimeMS(QUERY_MS);

  const courseIds = assignments.map((a) => a.courseId).filter(Boolean);
  const batchIds = assignments.map((a) => a.batchId).filter(Boolean);
  if (!courseIds.length && !batchIds.length) return { rows: [], total: 0 };

  const or = [];
  if (courseIds.length) or.push({ courseId: { $in: courseIds } });
  if (batchIds.length) or.push({ batchId: { $in: batchIds } });

  const rows = await ExamSchedule.find({
    softDelete: false,
    $or: or,
  })
    .populate("examPaperId", "title code")
    .populate("courseId", "name code")
    .populate("batchId", "name batchId")
    .sort({ startAt: -1 })
    .limit(50)
    .lean()
    .maxTimeMS(QUERY_MS);

  return {
    rows: rows.map((row) => ({
      _id: String(row._id),
      title: row.examPaperId?.title || row.examPaperId?.code || "Exam",
      course: row.courseId?.name || row.courseId?.code || "—",
      batch: row.batchId?.name || row.batchId?.batchId || "—",
      status: row.status || "",
      assigned: Number(row.assignedCount) || 0,
      startAt: row.startAt,
    })),
    total: rows.length,
  };
}

export { loadUniversity, loadCourse, loadBatch, toListRow, formatDateLabel };
