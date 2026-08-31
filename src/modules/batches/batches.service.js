import mongoose from "mongoose";
import { Batch, BATCH_STATUSES } from "./batches.model.js";
import { Course } from "../courses/courses.model.js";
import { University } from "../universities/universities.model.js";
import { Admission } from "../../models/Admission.js";
import {
  Attendance,
  ATTENDANCE_STATUSES,
} from "../attendance/attendance.model.js";
import { allocateAttendanceId } from "../attendance/attendanceIds.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { syncStudentBatchFromAdmission } from "../students/students.service.js";

const AUG_1_2026 = new Date("2026-08-01T00:00:00.000Z");

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

function idVariants(value) {
  const oid = asObjectId(value);
  if (!oid) return [];
  return [oid, String(oid)];
}

function dayStart(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + (Number(months) || 0));
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

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeStatus(startDate, endDate, forced) {
  if (forced && BATCH_STATUSES.includes(forced)) return forced;
  const now = dayStart(new Date());
  const start = dayStart(startDate);
  const end = endDate ? dayStart(endDate) : null;
  if (end && now > end) return "Completed";
  if (now < start) return "Upcoming";
  return "Running";
}

function computeProgress(startDate, endDate) {
  const start = dayStart(startDate).getTime();
  const end = endDate ? dayStart(endDate).getTime() : start + 180 * 86400000;
  const now = dayStart(new Date()).getTime();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

async function nextBatchId() {
  const latest = await Batch.findOne({ batchId: /^BAT-\d+$/i })
    .sort({ batchId: -1 })
    .select("batchId")
    .lean();
  let seq = 1;
  if (latest?.batchId) {
    const n = parseInt(String(latest.batchId).replace(/^BAT-/i, ""), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `BAT-${String(seq).padStart(4, "0")}`;
}

function batchNameForCourse(course, startDate = AUG_1_2026) {
  const code = String(course.code || "").trim().toUpperCase();
  const year = startDate.getUTCFullYear();
  if (code) return `${code}-${year}-A`;
  const slug = String(course.name || "BATCH")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    .toUpperCase();
  return `${slug || "BATCH"}-${year}-A`;
}

function buildAdmissionMatch({ universityId, courseId, courseName, universityName }) {
  const uniIds = idVariants(universityId);
  const courseIds = idVariants(courseId);
  const courseLabel = String(courseName || "").trim();
  const uniLabel = String(universityName || "").trim();
  const and = [{ status: "Approved" }];

  const courseOr = [];
  if (courseIds.length) {
    courseOr.push(
      { "details.courseId": { $in: courseIds } },
      { courseId: { $in: courseIds } }
    );
  }
  if (courseLabel) {
    const rx = new RegExp(`^${escapeRegex(courseLabel)}$`, "i");
    courseOr.push({ course: rx }, { "details.course": rx }, { "details.courseName": rx });
  }
  if (courseOr.length) and.push({ $or: courseOr });

  const uniOr = [];
  if (uniIds.length) {
    uniOr.push(
      { "details.universityId": { $in: uniIds } },
      { universityId: { $in: uniIds } }
    );
  }
  if (uniLabel) {
    const rx = new RegExp(`^${escapeRegex(uniLabel)}$`, "i");
    uniOr.push({ "details.universityName": rx }, { college: rx });
  }
  // If no university filter available, still match by course only
  if (uniOr.length) and.push({ $or: uniOr });

  return { $and: and };
}

function normalizeCourseKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coursesLikelyMatch(admissionCourse, courseDoc) {
  const a = normalizeCourseKey(admissionCourse);
  const name = normalizeCourseKey(courseDoc?.name);
  const code = normalizeCourseKey(courseDoc?.code);
  if (!a) return false;
  if (name && (a === name || a.includes(name) || name.includes(a))) return true;
  if (code && (a.includes(code) || a.includes(code.replace(/\s/g, "")))) return true;
  // e.g. "BCA (IGNOU-BCA)" ↔ code IGNOU-BCA
  const paren = String(admissionCourse || "").match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    const p = normalizeCourseKey(paren[1]);
    if (code && (p === code || code.includes(p) || p.includes(code))) return true;
    if (name && (p.includes(name) || name.includes(p))) return true;
  }
  // MERN / Full Stack soft match
  if (
    /full\s*stack|mern|react.*node/.test(a) &&
    /full\s*stack|web\s*development|mern/.test(name)
  ) {
    return true;
  }
  if (/^bca\b/.test(a) && /^bca\b/.test(name)) return true;
  return false;
}

async function loadEnrolledAdmissions({ universityId, courseId, courseName, universityName, courseCode }) {
  const courseOnly = buildAdmissionMatch({
    courseId,
    courseName,
  });
  let admissions = await Admission.find(courseOnly).lean().maxTimeMS(12000);

  if (!admissions.length && courseName) {
    const rx = new RegExp(escapeRegex(String(courseName).trim()), "i");
    admissions = await Admission.find({
      status: "Approved",
      $or: [{ course: rx }, { "details.course": rx }, { "details.courseName": rx }],
    })
      .lean()
      .maxTimeMS(12000);
  }

  if (!admissions.length && (courseName || courseCode)) {
    const allApproved = await Admission.find({ status: "Approved" })
      .lean()
      .maxTimeMS(12000);
    const fakeCourse = { name: courseName, code: courseCode };
    admissions = allApproved.filter((adm) =>
      coursesLikelyMatch(adm.course || adm.details?.course || "", fakeCourse)
    );
  }

  if (!admissions.length && (universityId || universityName)) {
    admissions = await Admission.find(
      buildAdmissionMatch({
        universityId,
        courseId,
        courseName,
        universityName,
      })
    )
      .lean()
      .maxTimeMS(12000);
  }

  return admissions;
}

async function countEnrolled(scope) {
  const rows = await loadEnrolledAdmissions(scope);
  return rows.length;
}

function batchAssignmentKeys(batch) {
  const keys = [];
  if (batch?.batchId) keys.push(String(batch.batchId));
  if (batch?._id) keys.push(String(batch._id));
  return [...new Set(keys.filter(Boolean))];
}

function admissionBatchKeys(adm) {
  const details = adm?.details && typeof adm.details === "object" ? adm.details : {};
  return [
    details.batchId,
    details.batchMongoId,
    details.seedBatchId,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
}

function isAssignedToBatch(adm, batch) {
  const assigned = admissionBatchKeys(adm);
  if (!assigned.length) return false;
  const keys = new Set(batchAssignmentKeys(batch));
  return assigned.some((k) => keys.has(k));
}

async function countAssignedToBatch(batch) {
  const keys = batchAssignmentKeys(batch);
  if (!keys.length) return 0;
  return Admission.countDocuments({
    status: "Approved",
    $or: [
      { "details.batchId": { $in: keys } },
      { "details.batchMongoId": { $in: keys } },
      { "details.seedBatchId": { $in: keys } },
    ],
  }).maxTimeMS(12000);
}

async function refreshBatchEnrolledCount(batchDoc, editor) {
  const count = await countAssignedToBatch(batchDoc);
  if (typeof batchDoc.save === "function") {
    batchDoc.enrolledCount = count;
    if (editor) batchDoc.updatedBy = editor;
    await batchDoc.save();
    return batchDoc;
  }
  await Batch.updateOne(
    { _id: batchDoc._id },
    { $set: { enrolledCount: count, ...(editor ? { updatedBy: editor } : {}) } }
  );
  return { ...batchDoc, enrolledCount: count };
}

async function findBatchDoc(id) {
  const oid = asObjectId(id);
  if (oid) {
    const byOid = await Batch.findOne({ _id: oid, softDelete: false });
    if (byOid) return byOid;
  }
  return Batch.findOne({ batchId: String(id || "").trim(), softDelete: false });
}

function toStudentRow(adm, { assigned = false, otherBatchId = "" } = {}) {
  const details = adm.details && typeof adm.details === "object" ? adm.details : {};
  return {
    _id: String(adm._id),
    admissionId: adm.admissionId || "",
    applicant:
      String(details.nameEnglish || "").trim() ||
      String(adm.applicant || "").trim() ||
      "—",
    email: adm.email || details.email || "",
    phone: adm.phone || details.studentMobile || details.contactNo || "",
    course: adm.course || details.courseName || details.course || "",
    courseId: details.courseId ? String(details.courseId) : "",
    status: adm.status,
    assigned,
    otherBatchId: otherBatchId || "",
    batchId: details.batchId || details.seedBatchId || "",
  };
}

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    ...d,
    _id: String(d._id),
    id: d.batchId || String(d._id),
    batchId: d.batchId,
    courseId: d.courseId ? String(d.courseId) : "",
    universityId: d.universityId ? String(d.universityId) : "",
    program: d.courseName || "",
    students: d.enrolledCount ?? 0,
    startLabel: formatDateLabel(d.startDate),
    endLabel: formatDateLabel(d.endDate),
    progressLabel: `${d.progress ?? 0}%`,
  };
}

function buildStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const running = list.filter((r) => r.status === "Running").length;
  const upcoming = list.filter((r) => r.status === "Upcoming").length;
  const completed = list.filter((r) => r.status === "Completed").length;
  const students = list.reduce((s, r) => s + (Number(r.enrolledCount) || 0), 0);
  const avgSize =
    list.length > 0 ? Math.round(students / list.length) : 0;
  const avgProgress =
    list.length > 0
      ? Math.round(
          list.reduce((s, r) => s + (Number(r.progress) || 0), 0) / list.length
        )
      : 0;
  return {
    total: list.length,
    running,
    upcoming,
    completed,
    students,
    avgSize,
    avgProgress,
  };
}

async function ensureGstUniversity() {
  let uni = await University.findOne({
    softDelete: false,
    $or: [{ shortName: "GST" }, { name: /^Grow Skills Tech/i }],
  })
    .lean()
    .maxTimeMS(8000);

  if (uni) return uni;

  uni = await University.create({
    name: "Grow Skills Tech",
    shortName: "GST",
    registrationNumber: "GST-INST-001",
    affiliationNumber: "INSTITUTE",
    city: "Jabalpur",
    state: "Madhya Pradesh",
    status: "Active",
    remarks: "Institute training university record for batches/attendance",
    createdBy: "system-seed",
    updatedBy: "system-seed",
  });
  return uni.toObject ? uni.toObject() : uni;
}

export async function listBatches(params = {}) {
  const {
    search = "",
    status = "",
    universityId = "",
    courseId = "",
  } = params;

  const query = { softDelete: false };
  if (status) query.status = status;
  const uniOid = asObjectId(universityId);
  const courseOid = asObjectId(courseId);
  if (uniOid) query.universityId = uniOid;
  if (courseOid) query.courseId = courseOid;

  if (search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    query.$or = [
      { batchId: rx },
      { name: rx },
      { courseName: rx },
      { courseCode: rx },
      { universityName: rx },
      { faculty: rx },
      { schedule: rx },
      { status: rx },
    ];
  }

  const rows = await Batch.find(query)
    .sort({ startDate: -1, createdAt: -1 })
    .lean()
    .maxTimeMS(12000);

  const mapped = rows.map(toRow);
  return { rows: mapped, stats: buildStats(mapped) };
}

export async function getBatchById(id) {
  const oid = asObjectId(id);
  const doc = oid
    ? await Batch.findOne({ _id: oid, softDelete: false }).lean()
    : await Batch.findOne({ batchId: String(id).trim(), softDelete: false }).lean();
  return doc ? toRow(doc) : null;
}

export async function createBatch(payload = {}, editor = "master-admin") {
  const courseOid = asObjectId(payload.courseId);
  if (!courseOid) {
    const err = new Error("Course is required");
    err.status = 400;
    throw err;
  }

  const course = await Course.findOne({ _id: courseOid, softDelete: false }).lean();
  if (!course) {
    const err = new Error("Course not found");
    err.status = 404;
    throw err;
  }

  let universityId = asObjectId(payload.universityId) || course.universityId || null;
  let universityName =
    String(payload.universityName || "").trim() ||
    course.universityName ||
    "";

  if (!universityId && course.type === "Institute") {
    const gst = await ensureGstUniversity();
    universityId = gst._id;
    universityName = gst.name || "Grow Skills Tech";
  }

  const startDate = payload.startDate
    ? dayStart(payload.startDate)
    : dayStart(AUG_1_2026);
  const duration = Number(payload.durationMonths ?? course.durationMonths) || 6;
  const endDate = payload.endDate
    ? dayStart(payload.endDate)
    : addMonths(startDate, duration);

  const name =
    String(payload.name || "").trim() || batchNameForCourse(course, startDate);

  const status = computeStatus(startDate, endDate, payload.status);
  const progress = computeProgress(startDate, endDate);

  const doc = await Batch.create({
    batchId: await nextBatchId(),
    name,
    courseId: course._id,
    courseName: course.name,
    courseCode: course.code || "",
    universityId,
    universityName,
    startDate,
    endDate,
    currentSemester: Number(payload.currentSemester) || 1,
    capacity: Number(payload.capacity) || 20,
    enrolledCount: 0,
    faculty: String(payload.faculty || "").trim(),
    schedule: String(payload.schedule || "Mon–Sat · Morning").trim(),
    progress,
    status,
    createdBy: editor,
    updatedBy: editor,
  });

  await createActivityLog({
    section: "Batches",
    action: "create",
    actor: editor,
    resourceId: doc.batchId,
    message: `Created batch ${doc.batchId} — ${doc.name}`,
    path: "/api/batches",
  });
  emitSectionUpdate({
    section: "Batches",
    action: "create",
    resourceId: doc.batchId,
    message: `Batch ${doc.batchId} created`,
    at: new Date().toISOString(),
  });

  return toRow(doc);
}

export async function updateBatch(id, payload = {}, editor = "master-admin") {
  const oid = asObjectId(id);
  const doc = oid
    ? await Batch.findOne({ _id: oid, softDelete: false })
    : await Batch.findOne({ batchId: String(id).trim(), softDelete: false });

  if (!doc) {
    const err = new Error("Batch not found");
    err.status = 404;
    throw err;
  }

  const fields = [
    "name",
    "faculty",
    "schedule",
    "capacity",
    "currentSemester",
    "status",
  ];
  for (const key of fields) {
    if (payload[key] !== undefined) {
      if (key === "status" && !BATCH_STATUSES.includes(payload.status)) continue;
      if (key === "capacity" || key === "currentSemester") {
        doc[key] = Number(payload[key]) || doc[key];
      } else {
        doc[key] = String(payload[key] ?? "").trim();
      }
    }
  }
  if (payload.startDate) doc.startDate = dayStart(payload.startDate);
  if (payload.endDate) doc.endDate = dayStart(payload.endDate);

  doc.enrolledCount = await countAssignedToBatch(doc);
  if (!payload.status) {
    doc.status = computeStatus(doc.startDate, doc.endDate);
  }
  doc.progress = computeProgress(doc.startDate, doc.endDate);
  doc.updatedBy = editor;
  await doc.save();

  await createActivityLog({
    section: "Batches",
    action: "update",
    actor: editor,
    resourceId: doc.batchId,
    message: `Updated batch ${doc.batchId}`,
    path: `/api/batches/${doc.batchId}`,
  });
  emitSectionUpdate({
    section: "Batches",
    action: "update",
    resourceId: doc.batchId,
    message: `Batch ${doc.batchId} updated`,
    at: new Date().toISOString(),
  });

  return toRow(doc);
}

export async function deleteBatch(id, editor = "master-admin") {
  const oid = asObjectId(id);
  const doc = oid
    ? await Batch.findOne({ _id: oid, softDelete: false })
    : await Batch.findOne({ batchId: String(id).trim(), softDelete: false });

  if (!doc) {
    const err = new Error("Batch not found");
    err.status = 404;
    throw err;
  }

  doc.softDelete = true;
  doc.status = "Archived";
  doc.updatedBy = editor;
  await doc.save();

  await createActivityLog({
    section: "Batches",
    action: "delete",
    actor: editor,
    resourceId: doc.batchId,
    message: `Archived batch ${doc.batchId}`,
    path: `/api/batches/${doc.batchId}`,
  });

  return toRow(doc);
}

export async function getBatchStudents(id) {
  const batch = await findBatchDoc(id);
  if (!batch) {
    const err = new Error("Batch not found");
    err.status = 404;
    throw err;
  }

  const batchLean = batch.toObject ? batch.toObject() : batch;
  const assignedQuery = {
    status: "Approved",
    $or: [
      { "details.batchId": { $in: batchAssignmentKeys(batchLean) } },
      { "details.batchMongoId": { $in: batchAssignmentKeys(batchLean) } },
      { "details.seedBatchId": { $in: batchAssignmentKeys(batchLean) } },
    ],
  };

  const assignedDocs = await Admission.find(assignedQuery)
    .sort({ applicant: 1 })
    .lean()
    .maxTimeMS(12000);

  const courseCandidates = await loadEnrolledAdmissions({
    universityId: batch.universityId,
    courseId: batch.courseId,
    courseName: batch.courseName,
    courseCode: batch.courseCode,
    universityName: batch.universityName,
  });

  const assignedIds = new Set(assignedDocs.map((a) => String(a._id)));
  const thisKeys = new Set(batchAssignmentKeys(batchLean));

  const available = [];
  for (const adm of courseCandidates) {
    if (assignedIds.has(String(adm._id))) continue;
    const keys = admissionBatchKeys(adm);
    const inOther = keys.some((k) => k && !thisKeys.has(k));
    if (inOther) {
      available.push(
        toStudentRow(adm, {
          assigned: false,
          otherBatchId: keys[0] || "",
        })
      );
      continue;
    }
    available.push(toStudentRow(adm, { assigned: false }));
  }

  // Also include Approved students with matching courseId even if fuzzy load missed them
  // (available already from loadEnrolledAdmissions)

  const enrolledCount = assignedDocs.length;
  if (Number(batch.enrolledCount) !== enrolledCount) {
    batch.enrolledCount = enrolledCount;
    await batch.save();
  }

  return {
    batch: toRow(batch),
    assigned: assignedDocs.map((a) => toStudentRow(a, { assigned: true })),
    available: available.filter((s) => !s.otherBatchId),
    blocked: available.filter((s) => s.otherBatchId),
    capacity: Number(batch.capacity) || 20,
    enrolledCount,
    seatsLeft: Math.max(0, (Number(batch.capacity) || 20) - enrolledCount),
  };
}

export async function assignBatchStudents(id, admissionIds = [], editor = "master-admin") {
  const batch = await findBatchDoc(id);
  if (!batch) {
    const err = new Error("Batch not found");
    err.status = 404;
    throw err;
  }

  const ids = (Array.isArray(admissionIds) ? admissionIds : [])
    .map((v) => asObjectId(v))
    .filter(Boolean);
  if (!ids.length) {
    const err = new Error("Select at least one student");
    err.status = 400;
    throw err;
  }

  const currentCount = await countAssignedToBatch(batch);
  const capacity = Number(batch.capacity) || 20;
  const seatsLeft = Math.max(0, capacity - currentCount);

  const admissions = await Admission.find({
    _id: { $in: ids },
    status: "Approved",
  });

  if (!admissions.length) {
    const err = new Error("No approved students found for the given ids");
    err.status = 404;
    throw err;
  }

  const batchLean = batch.toObject ? batch.toObject() : batch;
  const thisKeys = new Set(batchAssignmentKeys(batchLean));
  const toAssign = [];

  for (const adm of admissions) {
    if (isAssignedToBatch(adm, batchLean)) continue;
    const keys = admissionBatchKeys(adm);
    const inOther = keys.some((k) => k && !thisKeys.has(k));
    if (inOther) {
      const err = new Error(
        `${adm.applicant || adm.admissionId} is already in batch ${keys[0]}`
      );
      err.status = 409;
      throw err;
    }
    toAssign.push(adm);
  }

  if (toAssign.length > seatsLeft) {
    const err = new Error(
      `Batch capacity is ${capacity}. Only ${seatsLeft} seat(s) left; tried to add ${toAssign.length}.`
    );
    err.status = 400;
    throw err;
  }

  let assigned = 0;
  for (const adm of toAssign) {
    const details =
      adm.details && typeof adm.details === "object" ? { ...adm.details } : {};
    details.batchId = batch.batchId;
    details.batchMongoId = String(batch._id);
    details.courseId = details.courseId || String(batch.courseId);
    details.courseName = details.courseName || batch.courseName || "";
    details.courseCode = details.courseCode || batch.courseCode || "";
    if (batch.universityId) {
      details.universityId = details.universityId || String(batch.universityId);
    }
    if (batch.universityName) {
      details.universityName = details.universityName || batch.universityName;
    }
    adm.details = details;
    if (!adm.course && batch.courseName) adm.course = batch.courseName;
    await adm.save();
    await syncStudentBatchFromAdmission(adm, batch, { editor });
    assigned += 1;
  }

  await refreshBatchEnrolledCount(batch, editor);

  await createActivityLog({
    section: "Batches",
    action: "update",
    actor: editor,
    resourceId: batch.batchId,
    message: `Assigned ${assigned} student(s) to batch ${batch.batchId}`,
    path: `/api/batches/${batch.batchId}/students`,
  });
  emitSectionUpdate({
    section: "Batches",
    action: "update",
    resourceId: batch.batchId,
    message: `Batch ${batch.batchId}: ${assigned} student(s) assigned`,
    at: new Date().toISOString(),
  });

  return getBatchStudents(batch._id);
}

export async function removeBatchStudents(id, admissionIds = [], editor = "master-admin") {
  const batch = await findBatchDoc(id);
  if (!batch) {
    const err = new Error("Batch not found");
    err.status = 404;
    throw err;
  }

  const ids = (Array.isArray(admissionIds) ? admissionIds : [])
    .map((v) => asObjectId(v))
    .filter(Boolean);
  if (!ids.length) {
    const err = new Error("Select at least one student to remove");
    err.status = 400;
    throw err;
  }

  const batchLean = batch.toObject ? batch.toObject() : batch;
  const admissions = await Admission.find({ _id: { $in: ids } });
  let removed = 0;

  for (const adm of admissions) {
    if (!isAssignedToBatch(adm, batchLean)) continue;
    const details =
      adm.details && typeof adm.details === "object" ? { ...adm.details } : {};
    delete details.batchId;
    delete details.batchMongoId;
    // Keep seedBatchId only if it pointed at this batch — clear it too so they become available
    if (
      details.seedBatchId &&
      batchAssignmentKeys(batchLean).includes(String(details.seedBatchId))
    ) {
      delete details.seedBatchId;
    }
    adm.details = details;
    await adm.save();
    await syncStudentBatchFromAdmission(adm, batch, { clear: true, editor });
    removed += 1;
  }

  await refreshBatchEnrolledCount(batch, editor);

  await createActivityLog({
    section: "Batches",
    action: "update",
    actor: editor,
    resourceId: batch.batchId,
    message: `Removed ${removed} student(s) from batch ${batch.batchId}`,
    path: `/api/batches/${batch.batchId}/students`,
  });
  emitSectionUpdate({
    section: "Batches",
    action: "update",
    resourceId: batch.batchId,
    message: `Batch ${batch.batchId}: ${removed} student(s) removed`,
    at: new Date().toISOString(),
  });

  return getBatchStudents(batch._id);
}

async function nextAttendanceId(seqRef) {
  return allocateAttendanceId(seqRef);
}

function pickDemoStatus(dayIndex, studentIndex) {
  const roll = (dayIndex * 7 + studentIndex * 3) % 10;
  if (roll === 0) return "Absent";
  if (roll === 1) return "Late";
  if (roll === 2) return "Leave";
  return "Present";
}

/**
 * Ensure one Aug-1-2026 batch per Active course, refresh enrolled counts,
 * and seed last 7 days attendance for Approved students.
 */
export async function syncBatchesAndAttendance(editor = "system-seed") {
  const gst = await ensureGstUniversity();
  const courses = await Course.find({ softDelete: false, status: "Active" })
    .lean()
    .maxTimeMS(15000);

  const startDate = dayStart(AUG_1_2026);
  let batchesCreated = 0;
  let batchesUpdated = 0;
  let attendanceUpserts = 0;

  const today = dayStart(new Date());
  let last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    last7.push(d);
  }
  // Keep days on/after batch start; if clock is before Aug 1, use first week of batch
  const onOrAfterStart = last7.filter((d) => d >= startDate);
  if (onOrAfterStart.length) {
    last7 = onOrAfterStart;
  } else {
    last7 = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      last7.push(d);
    }
  }

  const attSeq = { value: 0 };

  for (const course of courses) {
    let universityId = course.universityId || null;
    let universityName = course.universityName || "";

    if (!universityId) {
      universityId = gst._id;
      universityName = universityName || gst.name || "Grow Skills Tech";
    }

    const name = batchNameForCourse(course, startDate);
    const duration = Number(course.durationMonths) || 6;
    const endDate = addMonths(startDate, duration);
    const enrolledCount = await countEnrolled({
      universityId,
      courseId: course._id,
      courseName: course.name,
      courseCode: course.code,
      universityName,
    });

    let batch = await Batch.findOne({
      softDelete: false,
      courseId: course._id,
      startDate,
    });

    if (!batch) {
      batch = await Batch.create({
        batchId: await nextBatchId(),
        name,
        courseId: course._id,
        courseName: course.name,
        courseCode: course.code || "",
        universityId,
        universityName,
        startDate,
        endDate,
        currentSemester: 1,
        capacity: 40,
        enrolledCount,
        faculty: "",
        schedule: "Mon–Sat · Morning",
        progress: computeProgress(startDate, endDate),
        status: computeStatus(startDate, endDate),
        createdBy: editor,
        updatedBy: editor,
      });
      batchesCreated += 1;
    } else {
      batch.name = name;
      batch.courseName = course.name;
      batch.courseCode = course.code || "";
      batch.universityId = universityId;
      batch.universityName = universityName;
      batch.endDate = endDate;
      batch.enrolledCount = enrolledCount;
      batch.progress = computeProgress(startDate, endDate);
      batch.status = computeStatus(startDate, endDate);
      batch.updatedBy = editor;
      await batch.save();
      batchesUpdated += 1;
    }

    const admissions = await loadEnrolledAdmissions({
      universityId,
      courseId: course._id,
      courseName: course.name,
      courseCode: course.code,
      universityName,
    });

    if (!admissions.length) continue;

    const semester = Number(batch.currentSemester) || 1;
    const semesterTitle = `Semester ${semester}`;

      for (let dayIndex = 0; dayIndex < last7.length; dayIndex += 1) {
      const date = last7[dayIndex];

      for (let sIdx = 0; sIdx < admissions.length; sIdx += 1) {
        const adm = admissions[sIdx];
        const details =
          adm.details && typeof adm.details === "object" ? adm.details : {};
        const student =
          String(details.nameEnglish || "").trim() ||
          String(adm.applicant || "").trim() ||
          "—";
        const status = pickDemoStatus(dayIndex, sIdx);
        if (!ATTENDANCE_STATUSES.includes(status)) continue;

        const existing = await Attendance.findOne({
          admissionMongoId: adm._id,
          courseId: course._id,
          semester,
          date,
        });

        if (existing) {
          existing.status = status;
          existing.method = "Manual";
          existing.universityId = universityId;
          existing.universityName = universityName;
          existing.courseName = course.name;
          existing.courseCode = course.code || "";
          existing.semesterTitle = semesterTitle;
          existing.student = student;
          existing.email = adm.email || details.email || existing.email;
          existing.markedBy = editor;
          await existing.save();
          attendanceUpserts += 1;
          continue;
        }

        try {
          await Attendance.create({
            attendanceId: await nextAttendanceId(attSeq),
            admissionId: adm.admissionId,
            admissionMongoId: adm._id,
            student,
            email: adm.email || details.email || "",
            phone:
              adm.phone ||
              details.studentMobile ||
              details.contactNo ||
              "",
            universityId,
            universityName,
            courseId: course._id,
            courseName: course.name,
            courseCode: course.code || "",
            semester,
            semesterTitle,
            date,
            status,
            method: "Manual",
            note: "Seeded batch attendance",
            markedBy: editor,
          });
          attendanceUpserts += 1;
        } catch (createErr) {
          // Race / stale seq: refresh from DB and retry once
          if (createErr?.code !== 11000) throw createErr;
          attSeq.value = 0;
          await Attendance.create({
            attendanceId: await nextAttendanceId(attSeq),
            admissionId: adm.admissionId,
            admissionMongoId: adm._id,
            student,
            email: adm.email || details.email || "",
            phone:
              adm.phone ||
              details.studentMobile ||
              details.contactNo ||
              "",
            universityId,
            universityName,
            courseId: course._id,
            courseName: course.name,
            courseCode: course.code || "",
            semester,
            semesterTitle,
            date,
            status,
            method: "Manual",
            note: "Seeded batch attendance",
            markedBy: editor,
          });
          attendanceUpserts += 1;
        }
      }
    }
  }

  const list = await listBatches();
  emitSectionUpdate({
    section: "Batches",
    action: "sync",
    message: `Synced ${batchesCreated + batchesUpdated} batches, ${attendanceUpserts} attendance rows`,
    at: new Date().toISOString(),
  });

  return {
    courses: courses.length,
    batchesCreated,
    batchesUpdated,
    attendanceUpserts,
    rows: list.rows,
    stats: list.stats,
  };
}
