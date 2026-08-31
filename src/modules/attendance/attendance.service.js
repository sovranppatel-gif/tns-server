import mongoose from "mongoose";
import { Admission } from "../../models/Admission.js";
import { Course } from "../courses/courses.model.js";
import { University } from "../universities/universities.model.js";
import { Batch } from "../batches/batches.model.js";
import { Student } from "../students/students.model.js";
import {
  Attendance,
  AttendanceLock,
  ATTENDANCE_STATUSES,
  ATTENDANCE_METHODS,
  MANUAL_ATTENDANCE_STATUSES,
  COUNT_LATE_AS_PRESENT,
} from "./attendance.model.js";
import { allocateAttendanceId } from "./attendanceIds.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";

const ROSTER_STATUSES = ["Active"];
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

let indexSyncPromise = null;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
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

function dayEnd(value) {
  const d = dayStart(value);
  d.setHours(23, 59, 59, 999);
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

function formatDateNumeric(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toIsoDate(value) {
  const d = dayStart(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

function idStr(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function roundPercent(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function slimPhoto(photo) {
  const value = String(photo || "");
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  if (value.length > 2000) return "";
  return value;
}

function currentTermLabel(term, fallbackNumber, fallbackTitle) {
  const type = String(term?.type || "").trim();
  const number = Number(term?.number || fallbackNumber);
  if (type && Number.isFinite(number) && number > 0) return `${type} ${number}`;
  if (fallbackTitle) return fallbackTitle;
  if (Number.isFinite(number) && number > 0) return `Semester ${number}`;
  return "";
}

function studentDisplayName(student) {
  return (
    String(student?.nameEnglish || "").trim() ||
    String(student?.student || "").trim() ||
    "—"
  );
}

function admissionDisplayName(admission) {
  const details =
    admission?.details && typeof admission.details === "object"
      ? admission.details
      : {};
  return (
    String(details.nameEnglish || "").trim() ||
    String(admission?.applicant || "").trim() ||
    "—"
  );
}

async function nextAttendanceId() {
  return allocateAttendanceId();
}

export async function ensureAttendanceIndexes() {
  if (!indexSyncPromise) {
    indexSyncPromise = (async () => {
      try {
        const indexes = await Attendance.collection.indexes();
        const stale = indexes.find(
          (idx) =>
            idx.unique &&
            idx.key?.admissionMongoId === 1 &&
            idx.key?.courseId === 1 &&
            idx.key?.semester === 1 &&
            idx.key?.date === 1 &&
            !idx.partialFilterExpression
        );
        if (stale?.name) {
          await Attendance.collection.dropIndex(stale.name);
        }
      } catch (err) {
        if (err?.codeName !== "NamespaceNotFound" && err?.code !== 27) {
          console.error("[attendance] drop stale index:", err.message);
        }
      }
      await Promise.all([
        Attendance.syncIndexes().catch((err) =>
          console.error("[attendance] syncIndexes:", err.message)
        ),
        AttendanceLock.syncIndexes().catch((err) =>
          console.error("[attendance] lock syncIndexes:", err.message)
        ),
      ]);
    })();
  }
  return indexSyncPromise;
}

function applySearchFilter(rows, search) {
  const q = String(search || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const hay = [
      row.student,
      row.name,
      row.studentId,
      row.studentCode,
      row.email,
      row.phone,
      row.mobile,
      row.admissionId,
      row.courseName,
      row.course,
      row.courseCode,
      row.universityName,
      row.batchName,
      row.batchCode,
      row.semester,
      row.semesterTitle,
      row.status,
      row.method,
      row.remarks,
      row.attendanceId,
    ]
      .map((v) => String(v ?? "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

function emptyCounts() {
  return {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    unmarked: 0,
    marked: 0,
    percent: 0,
  };
}

function computeStats(rows, { includeLateInPercent = COUNT_LATE_AS_PRESENT } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = emptyCounts();
  counts.total = list.length;
  for (const row of list) {
    const status = String(row.status || "").toLowerCase();
    if (status === "present") counts.present += 1;
    else if (status === "absent") counts.absent += 1;
    else if (status === "late") counts.late += 1;
    else if (status === "leave") counts.leave += 1;
    else if (status === "holiday") counts.leave += 1;
    else counts.unmarked += 1;
  }
  counts.marked = counts.total - counts.unmarked;
  const presentLike = includeLateInPercent
    ? counts.present + counts.late
    : counts.present;
  counts.percent =
    counts.total > 0 ? roundPercent((presentLike / counts.total) * 100) : 0;
  return counts;
}

function toRow(doc, extras = {}) {
  const date = doc.date || extras.date;
  const term = doc.term || extras.term || {};
  const termNumber = Number(term.number || doc.semester || extras.semester) || "";
  const remarks = doc.remarks || doc.note || extras.remarks || extras.note || "";
  const studentCode =
    doc.studentCode || extras.studentCode || extras.studentIdCode || "";
  const markedAt = doc.markedAt || doc.updatedAt || extras.markedAt || null;
  return {
    id: doc._id ? String(doc._id) : extras.id || "",
    _id: doc._id ? String(doc._id) : extras.id || "",
    attendanceId: doc.attendanceId || extras.attendanceId || "",
    studentMongoId: doc.studentId
      ? String(doc.studentId)
      : extras.studentMongoId || "",
    studentId: studentCode || extras.studentId || "",
    studentCode: studentCode || extras.studentCode || "",
    admissionId: doc.admissionId || extras.admissionId || "",
    admissionMongoId: doc.admissionMongoId
      ? String(doc.admissionMongoId)
      : extras.admissionMongoId || "",
    student: doc.student || extras.student || "—",
    name: doc.student || extras.student || "—",
    email: doc.email || extras.email || "",
    phone: doc.phone || extras.phone || extras.mobile || "",
    mobile: extras.mobile || doc.phone || extras.phone || "",
    photo: extras.photo || "",
    universityId: doc.universityId
      ? String(doc.universityId)
      : extras.universityId || "",
    universityName: doc.universityName || extras.universityName || "",
    courseId: doc.courseId ? String(doc.courseId) : extras.courseId || "",
    courseName: doc.courseName || extras.courseName || "",
    course: doc.courseName || extras.courseName || "",
    courseCode: doc.courseCode || extras.courseCode || "",
    batchId: doc.batchId ? String(doc.batchId) : extras.batchId || "",
    batchName: doc.batchName || extras.batchName || "",
    batchCode: doc.batchCode || extras.batchCode || "",
    term: {
      type: term.type || extras.termType || "Semester",
      number: termNumber || extras.semester || "",
    },
    currentTerm: extras.currentTerm || currentTermLabel(term, termNumber),
    semester: doc.semester ?? extras.semester ?? termNumber,
    semesterTitle: doc.semesterTitle || extras.semesterTitle || "",
    date: date ? new Date(date).toISOString() : "",
    dateLabel: formatDateLabel(date),
    dateNumeric: formatDateNumeric(date),
    status: doc.status || extras.status || "Unmarked",
    method: doc.method || extras.method || "",
    remarks,
    note: remarks,
    markedBy: doc.markedBy || extras.markedBy || "",
    markedAt: markedAt ? new Date(markedAt).toISOString() : "",
    markedAtLabel: markedAt ? formatDateLabel(markedAt) : "",
    updatedBy: doc.updatedBy || extras.updatedBy || "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : "",
    marked: Boolean(doc._id || doc.attendanceId),
    isLocked: Boolean(doc.isLocked || extras.isLocked),
  };
}

function termTitleFromCourse(course, sem) {
  const semesterMeta = (course?.semesters || []).find(
    (s) => Number(s.number) === sem
  );
  const structureType = String(course?.structureType || "Semester");
  const kind =
    structureType === "Year"
      ? "Year"
      : structureType === "Single Level"
        ? "Level"
        : "Semester";
  return (
    semesterMeta?.title ||
    (semesterMeta?.number ? `${kind} ${semesterMeta.number}` : `${kind} ${sem}`)
  );
}

function validateSemesterOnCourse(course, sem) {
  const semesterMeta = (course.semesters || []).find(
    (s) => Number(s.number) === sem
  );
  const maxSem =
    Number(course.semesterCount) ||
    (Array.isArray(course.semesters) ? course.semesters.length : 0) ||
    0;
  if (maxSem > 0 && sem > maxSem) {
    throw httpError(`Semester ${sem} is not available for this course`, 400);
  }
  const structureType = String(course.structureType || "Semester");
  return {
    type:
      structureType === "Year"
        ? "Year"
        : structureType === "Single Level"
          ? "Level"
          : "Semester",
    number: sem,
    title: semesterMeta?.title || termTitleFromCourse(course, sem),
  };
}

async function resolveScope({
  universityId,
  courseId,
  batchId,
  semester,
  requireBatch = true,
}) {
  const uniOid = asObjectId(universityId);
  const courseOid = asObjectId(courseId);
  const batchOid = asObjectId(batchId);
  const sem = Number(semester);

  if (!uniOid) throw httpError("University is required", 400);
  if (!courseOid) throw httpError("Course is required", 400);
  if (requireBatch && !batchOid) throw httpError("Batch is required", 400);
  if (!Number.isFinite(sem) || sem < 1) throw httpError("Semester is required", 400);

  const [university, course, batch] = await Promise.all([
    University.findOne({ _id: uniOid, softDelete: false })
      .select("name shortName status")
      .lean()
      .maxTimeMS(8000),
    Course.findOne({ _id: courseOid, softDelete: false })
      .select(
        "name code universityId universityName structureType semesters semesterCount status type"
      )
      .lean()
      .maxTimeMS(8000),
    batchOid
      ? Batch.findOne({ _id: batchOid, softDelete: false })
          .select(
            "name batchId courseId universityId status courseName courseCode universityName startDate endDate createdAt"
          )
          .lean()
          .maxTimeMS(8000)
      : Promise.resolve(null),
  ]);

  if (!university) throw httpError("University not found", 404);
  if (university.status === "Inactive") {
    throw httpError("University is inactive", 400);
  }
  if (!course) throw httpError("Course not found", 404);
  if (requireBatch && !batch) throw httpError("Batch not found", 404);

  if (course.universityId && String(course.universityId) !== String(uniOid)) {
    throw httpError("Course does not belong to selected university", 400);
  }
  if (batch) {
    if (String(batch.courseId) !== String(courseOid)) {
      throw httpError("Batch does not belong to selected course", 400);
    }
    if (batch.universityId && String(batch.universityId) !== String(uniOid)) {
      throw httpError("Batch does not belong to selected university", 400);
    }
  }

  const term = validateSemesterOnCourse(course, sem);

  return {
    universityId: uniOid,
    universityName: university.name || university.shortName || "",
    universityShortName: university.shortName || "",
    courseId: courseOid,
    courseName: course.name || "",
    courseCode: course.code || "",
    course,
    batchId: batch ? batch._id : null,
    batchName: batch?.name || "",
    batchCode: batch?.batchId || "",
    batchStartDate: batch?.startDate || batch?.createdAt || null,
    batchEndDate: batch?.endDate || null,
    batchStatus: batch?.status || "",
    batch,
    semester: sem,
    semesterTitle: term.title,
    term,
  };
}

async function getScopeLock(scope, targetDate) {
  if (!scope.batchId) return null;
  return AttendanceLock.findOne({
    batchId: scope.batchId,
    date: targetDate,
    "term.number": scope.semester,
  })
    .lean()
    .maxTimeMS(8000);
}

function assertUnlocked(lock, extraLocked = false) {
  if (lock?.isLocked || extraLocked) {
    throw httpError(
      "Attendance is locked for this batch, date and semester",
      423
    );
  }
}

function batchDateWindow(batch) {
  if (!batch) return null;
  const today = dayStart(new Date());
  const startSource = batch.startDate || batch.createdAt;
  if (!startSource) {
    return { min: today, max: today, upcoming: false };
  }
  const min = dayStart(startSource);
  const end = batch.endDate ? dayStart(batch.endDate) : null;
  const upcoming = min > today;
  if (upcoming) {
    return { min, max: min, upcoming: true };
  }
  let max = today;
  if (end && end < max) max = end;
  if (max < min) max = min;
  return { min, max, upcoming: false };
}

function assertDateInBatchWindow(scope, targetDate) {
  const window = batchDateWindow(scope.batch);
  if (!window || !targetDate) return window;
  if (window.upcoming) {
    throw httpError(
      `This batch has not started yet. Attendance can be marked from ${formatDateNumeric(window.min)}`,
      400
    );
  }
  if (targetDate < window.min) {
    throw httpError(
      `Attendance cannot be marked before the batch start date (${formatDateNumeric(window.min)})`,
      400
    );
  }
  if (targetDate > window.max) {
    throw httpError(
      `Attendance cannot be marked after ${formatDateNumeric(window.max)}`,
      400
    );
  }
  return window;
}

function studentSearchClause(search) {
  const q = String(search || "").trim();
  if (!q) return null;
  const rx = new RegExp(escapeRegex(q), "i");
  return {
    $or: [
      { studentId: rx },
      { nameEnglish: rx },
      { admissionId: rx },
      { "contact.mobile": rx },
      { "contact.email": rx },
      { "contact.alternateMobile": rx },
    ],
  };
}

async function findRosterStudents(scope, { search = "" } = {}) {
  const query = {
    batchId: scope.batchId,
    status: { $in: ROSTER_STATUSES },
  };
  if (scope.courseId) query.courseId = scope.courseId;

  const searchClause = studentSearchClause(search);
  if (searchClause) Object.assign(query, searchClause);

  let students = await Student.find(query)
    .select(
      "studentId admissionId admissionMongoId universityId courseId batchId currentTerm universityName courseName courseCode batchName nameEnglish contact photo status"
    )
    .sort({ nameEnglish: 1, studentId: 1 })
    .lean()
    .maxTimeMS(12000);

  if (students.length || !scope.batchId) return students;

  const batchKeys = [String(scope.batchId), String(scope.batchCode || "")].filter(Boolean);
  const assignedAdmissions = await Admission.find({
    status: "Approved",
    $or: [
      { "details.batchMongoId": { $in: batchKeys } },
      { "details.batchId": { $in: batchKeys } },
      { "details.seedBatchId": { $in: batchKeys } },
    ],
  })
    .select("_id")
    .lean()
    .maxTimeMS(8000);

  const admissionIds = assignedAdmissions.map((a) => a._id).filter(Boolean);
  if (!admissionIds.length) return students;

  const fallbackQuery = {
    admissionMongoId: { $in: admissionIds },
    status: { $in: ROSTER_STATUSES },
  };
  if (searchClause) Object.assign(fallbackQuery, searchClause);

  return Student.find(fallbackQuery)
    .select(
      "studentId admissionId admissionMongoId universityId courseId batchId currentTerm universityName courseName courseCode batchName nameEnglish contact photo status"
    )
    .sort({ nameEnglish: 1, studentId: 1 })
    .lean()
    .maxTimeMS(12000);
}

function assertStudentInScope(student, scope, rosterIds = null) {
  if (!student) throw httpError("Student not found", 404);
  if (!ROSTER_STATUSES.includes(student.status || "Active")) {
    throw httpError(
      `${student.studentId || student.nameEnglish || "Student"} is not an active student`,
      400
    );
  }
  const onRoster = rosterIds
    ? rosterIds.has(String(student._id))
    : String(student.batchId || "") === String(scope.batchId);
  if (!onRoster) {
    throw httpError(
      `${student.studentId || student.nameEnglish || "Student"} does not belong to the selected batch`,
      400
    );
  }
  if (student.courseId && String(student.courseId) !== String(scope.courseId)) {
    throw httpError(
      `${student.studentId || student.nameEnglish || "Student"} does not belong to the selected course`,
      400
    );
  }
  if (
    scope.universityId &&
    student.universityId &&
    String(student.universityId) !== String(scope.universityId)
  ) {
    throw httpError(
      `${student.studentId || student.nameEnglish || "Student"} does not belong to the selected university`,
      400
    );
  }
}

function markQueryForDate(scope, targetDate, studentOids, admissionOids) {
  const or = [];
  if (studentOids.length) {
    or.push({
      studentId: { $in: studentOids },
      date: targetDate,
      $or: [{ "term.number": scope.semester }, { semester: scope.semester }],
    });
  }
  if (admissionOids.length) {
    or.push({
      admissionMongoId: { $in: admissionOids },
      date: targetDate,
      $or: [{ "term.number": scope.semester }, { semester: scope.semester }],
    });
  }
  if (scope.batchId) {
    or.push({
      batchId: scope.batchId,
      date: targetDate,
      $or: [{ "term.number": scope.semester }, { semester: scope.semester }],
    });
  }
  if (!or.length) {
    return {
      courseId: scope.courseId,
      date: targetDate,
      $or: [{ "term.number": scope.semester }, { semester: scope.semester }],
    };
  }
  return { $or: or };
}

function indexMarks(marks) {
  const byStudent = new Map();
  const byAdmission = new Map();
  const byAdmissionCode = new Map();
  for (const mark of marks) {
    if (mark.studentId) byStudent.set(String(mark.studentId), mark);
    if (mark.admissionMongoId) {
      byAdmission.set(String(mark.admissionMongoId), mark);
    }
    if (mark.admissionId) {
      byAdmissionCode.set(String(mark.admissionId).trim(), mark);
    }
  }
  return { byStudent, byAdmission, byAdmissionCode };
}

function pickMark(student, maps) {
  return (
    maps.byStudent.get(String(student._id)) ||
    (student.admissionMongoId
      ? maps.byAdmission.get(String(student.admissionMongoId))
      : null) ||
    (student.admissionId
      ? maps.byAdmissionCode.get(String(student.admissionId).trim())
      : null) ||
    null
  );
}

function studentBaseExtras(student, scope, targetDate, lock) {
  const currentTerm = student.currentTerm || {};
  return {
    studentMongoId: String(student._id),
    studentId: student.studentId || "",
    studentCode: student.studentId || "",
    admissionId: student.admissionId || "",
    admissionMongoId: student.admissionMongoId
      ? String(student.admissionMongoId)
      : "",
    student: studentDisplayName(student),
    email: student.contact?.email || "",
    phone: student.contact?.mobile || "",
    mobile: student.contact?.mobile || "",
    photo: slimPhoto(student.photo),
    universityId: String(scope.universityId),
    universityName: scope.universityName,
    courseId: String(scope.courseId),
    courseName: scope.courseName,
    courseCode: scope.courseCode,
    batchId: String(scope.batchId),
    batchName: scope.batchName,
    batchCode: scope.batchCode,
    semester: scope.semester,
    semesterTitle: scope.semesterTitle,
    term: scope.term,
    termType: scope.term.type,
    currentTerm: currentTermLabel(
      currentTerm,
      currentTerm.number || scope.semester,
      scope.semesterTitle
    ),
    date: targetDate,
    status: "Unmarked",
    method: "",
    isLocked: Boolean(lock?.isLocked),
  };
}

function paginateRows(rows, page, limit) {
  const total = rows.length;
  const safeLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  );
  const safePage = Math.max(Number(page) || 1, 1);
  const start = (safePage - 1) * safeLimit;
  return {
    rows: rows.slice(start, start + safeLimit),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit) || 1),
    },
  };
}

function scopeMeta(scope, targetDate, extras = {}) {
  const window = batchDateWindow(scope.batch);
  return {
    requiresFilters: false,
    universityId: String(scope.universityId),
    universityName: scope.universityName,
    universityShortName: scope.universityShortName || "",
    courseId: String(scope.courseId),
    courseName: scope.courseName,
    courseCode: scope.courseCode,
    batchId: scope.batchId ? String(scope.batchId) : "",
    batchName: scope.batchName,
    batchCode: scope.batchCode,
    semester: scope.semester,
    semesterTitle: scope.semesterTitle,
    term: scope.term,
    date: targetDate.toISOString(),
    dateLabel: formatDateNumeric(targetDate),
    dateShort: formatDateLabel(targetDate),
    dateMin: window ? toIsoDate(window.min) : "",
    dateMax: window ? toIsoDate(window.max) : "",
    batchStartDate: window ? window.min.toISOString() : "",
    batchEndDate: scope.batchEndDate ? new Date(scope.batchEndDate).toISOString() : "",
    batchUpcoming: Boolean(window?.upcoming),
    ...extras,
  };
}

/**
 * Institute-wide overview for StatCards — active students + marks for the date.
 * Independent from the selected-batch roster.
 */
export async function getAttendanceOverview(params = {}) {
  await ensureAttendanceIndexes();
  const targetDate = dayStart(params.date);

  const [studentCount, marks] = await Promise.all([
    Student.countDocuments({ status: { $in: ROSTER_STATUSES } }).maxTimeMS(8000),
    Attendance.find({ date: targetDate })
      .select("status studentId admissionMongoId")
      .lean()
      .maxTimeMS(10000),
  ]);

  const byStudent = new Map();
  for (const mark of marks) {
    const key = String(mark.studentId || mark.admissionMongoId || mark._id);
    if (!byStudent.has(key)) byStudent.set(key, mark);
  }

  const uniqueMarks = [...byStudent.values()];
  const stats = computeStats(
    uniqueMarks.map((m) => ({ status: m.status || "Unmarked" }))
  );

  const markedStudents = uniqueMarks.length;
  stats.total = studentCount;
  stats.unmarked = Math.max(0, studentCount - markedStudents);
  const presentLike = COUNT_LATE_AS_PRESENT
    ? (stats.present || 0) + (stats.late || 0)
    : stats.present || 0;
  stats.percent =
    studentCount > 0 ? roundPercent((presentLike / studentCount) * 100) : 0;
  stats.marked = markedStudents;

  return {
    stats,
    meta: {
      overview: true,
      date: targetDate.toISOString(),
      dateLabel: formatDateNumeric(targetDate),
      studentCount,
      markedCount: markedStudents,
    },
  };
}

/**
 * Cascaded roster: University → Course → Batch → Semester → Date.
 * Merges active students assigned to the batch with attendance for that day/term.
 */
export async function listAttendance(params = {}) {
  await ensureAttendanceIndexes();
  const {
    universityId = "",
    courseId = "",
    batchId = "",
    semester = "",
    date = "",
    search = "",
    status = "",
    page = 1,
    limit = DEFAULT_LIST_LIMIT,
  } = params;

  if (!universityId || !courseId || !batchId || !semester) {
    return {
      rows: [],
      stats: emptyCounts(),
      meta: {
        requiresFilters: true,
        message: "Select university, course, batch and semester to load attendance",
      },
      pagination: { page: 1, limit: DEFAULT_LIST_LIMIT, total: 0, totalPages: 1 },
    };
  }

  const scope = await resolveScope({
    universityId,
    courseId,
    batchId,
    semester,
    requireBatch: true,
  });
  const targetDate = dayStart(date);
  assertDateInBatchWindow(scope, targetDate);
  const lock = await getScopeLock(scope, targetDate);

  const students = await findRosterStudents(scope, { search: "" });
  const studentOids = students.map((s) => s._id);
  const admissionOids = students
    .map((s) => s.admissionMongoId)
    .filter(Boolean);

  const marks = await Attendance.find(
    markQueryForDate(scope, targetDate, studentOids, admissionOids)
  )
    .lean()
    .maxTimeMS(8000);

  const maps = indexMarks(marks);

  let rows = students.map((student) => {
    const mark = pickMark(student, maps);
    const extras = studentBaseExtras(student, scope, targetDate, lock);
    if (mark) {
      return toRow(mark, extras);
    }
    return toRow({}, extras);
  });

  if (status) {
    const wanted = String(status).trim().toLowerCase();
    rows = rows.filter((r) => String(r.status || "").toLowerCase() === wanted);
  }

  rows = applySearchFilter(rows, search);
  const stats = computeStats(rows);
  const paged = paginateRows(rows, page, limit);

  return {
    rows: paged.rows,
    stats,
    pagination: paged.pagination,
    meta: scopeMeta(scope, targetDate, {
      rosterCount: students.length,
      markedCount: marks.length,
      isLocked: Boolean(lock?.isLocked),
      lockedBy: lock?.lockedBy || "",
      lockedAt: lock?.lockedAt || null,
      page: paged.pagination.page,
      limit: paged.pagination.limit,
      total: paged.pagination.total,
      totalPages: paged.pagination.totalPages,
    }),
  };
}

async function findExistingMark({
  studentId,
  admissionMongoId,
  admissionId,
  date,
  termNumber,
}) {
  const sem = Number(termNumber);
  const dateMatch = { date };
  const termMatch = {
    $or: [{ "term.number": sem }, { semester: sem }],
  };

  if (studentId) {
    const byStudent = await Attendance.findOne({
      studentId,
      ...dateMatch,
      ...termMatch,
    });
    if (byStudent) return byStudent;
  }
  if (admissionMongoId) {
    const byAdmission = await Attendance.findOne({
      admissionMongoId,
      ...dateMatch,
      ...termMatch,
    });
    if (byAdmission) return byAdmission;
  }
  if (admissionId) {
    const byCode = await Attendance.findOne({
      admissionId: String(admissionId).trim(),
      ...dateMatch,
      ...termMatch,
    });
    if (byCode) return byCode;
  }
  return null;
}

async function logAttendanceChange({
  editor,
  action,
  student,
  doc,
  oldStatus,
  newStatus,
  method,
  path,
  extraMessage,
}) {
  const studentLabel =
    student?.studentId ||
    student?.nameEnglish ||
    doc.studentCode ||
    doc.student ||
    doc.attendanceId;
  await createActivityLog({
    section: "Attendance",
    action,
    actor: editor,
    resourceId: doc.attendanceId || idStr(doc._id),
    message:
      extraMessage ||
      `Attendance ${oldStatus ? `${oldStatus} → ${newStatus}` : newStatus} · ${studentLabel} · ${formatDateLabel(doc.date)}`,
    path,
    method,
    meta: {
      studentId: student?.studentId || doc.studentCode || "",
      studentMongoId: student?._id ? String(student._id) : idStr(doc.studentId),
      attendanceId: doc.attendanceId || "",
      date: doc.date ? new Date(doc.date).toISOString() : "",
      oldStatus: oldStatus || "",
      newStatus: newStatus || doc.status,
      changedBy: editor,
      changedAt: new Date().toISOString(),
      method: method || doc.method || "Manual",
    },
  }).catch(() => null);
}

function applyMarkFields(doc, { student, scope, targetDate, status, method, remarks, editor }) {
  doc.studentId = student._id;
  doc.studentCode = student.studentId || doc.studentCode || "";
  doc.admissionId = student.admissionId || doc.admissionId || "";
  doc.admissionMongoId = student.admissionMongoId || doc.admissionMongoId || null;
  doc.student = studentDisplayName(student);
  doc.email = student.contact?.email || doc.email || "";
  doc.phone = student.contact?.mobile || doc.phone || "";
  doc.universityId = scope.universityId;
  doc.universityName = scope.universityName;
  doc.courseId = scope.courseId;
  doc.courseName = scope.courseName;
  doc.courseCode = scope.courseCode;
  doc.batchId = scope.batchId;
  doc.batchName = scope.batchName;
  doc.batchCode = scope.batchCode;
  doc.term = { type: scope.term.type, number: scope.semester };
  doc.semester = scope.semester;
  doc.semesterTitle = scope.semesterTitle;
  doc.date = targetDate;
  doc.status = status;
  doc.method = method;
  doc.remarks = remarks;
  doc.note = remarks;
  doc.updatedBy = editor;
  if (!doc.markedBy) doc.markedBy = editor;
  else doc.markedBy = editor;
  if (!doc.markedAt) doc.markedAt = new Date();
  doc.isLocked = false;
}

async function upsertStudentMark({
  student,
  scope,
  targetDate,
  status,
  method,
  remarks,
  editor,
  skipLog = false,
}) {
  const existing = await findExistingMark({
    studentId: student._id,
    admissionMongoId: student.admissionMongoId,
    admissionId: student.admissionId,
    date: targetDate,
    termNumber: scope.semester,
  });

  const oldStatus = existing?.status || "";
  let doc = existing;
  let created = false;

  if (existing) {
    if (existing.isLocked) {
      throw httpError("This attendance record is locked", 423);
    }
    applyMarkFields(existing, {
      student,
      scope,
      targetDate,
      status,
      method,
      remarks,
      editor,
    });
    doc = await existing.save();
  } else {
    try {
      doc = await Attendance.create({
        attendanceId: await nextAttendanceId(),
        studentId: student._id,
        studentCode: student.studentId || "",
        admissionId: student.admissionId || "",
        admissionMongoId: student.admissionMongoId || null,
        student: studentDisplayName(student),
        email: student.contact?.email || "",
        phone: student.contact?.mobile || "",
        universityId: scope.universityId,
        universityName: scope.universityName,
        courseId: scope.courseId,
        courseName: scope.courseName,
        courseCode: scope.courseCode,
        batchId: scope.batchId,
        batchName: scope.batchName,
        batchCode: scope.batchCode,
        term: { type: scope.term.type, number: scope.semester },
        semester: scope.semester,
        semesterTitle: scope.semesterTitle,
        date: targetDate,
        status,
        method,
        remarks,
        note: remarks,
        markedBy: editor,
        markedAt: new Date(),
        updatedBy: editor,
        isLocked: false,
      });
      created = true;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const raced = await findExistingMark({
        studentId: student._id,
        admissionMongoId: student.admissionMongoId,
        admissionId: student.admissionId,
        date: targetDate,
        termNumber: scope.semester,
      });
      if (!raced) throw err;
      applyMarkFields(raced, {
        student,
        scope,
        targetDate,
        status,
        method,
        remarks,
        editor,
      });
      doc = await raced.save();
    }
  }

  const changed = created || oldStatus !== status;
  if (changed && !skipLog) {
    await logAttendanceChange({
      editor,
      action: created ? "mark" : "update",
      student,
      doc,
      oldStatus: created ? "" : oldStatus,
      newStatus: status,
      method,
      path: created ? "/api/attendance/bulk" : `/api/attendance/${doc.attendanceId}`,
    });
  }

  return { doc, created, oldStatus, changed };
}

function resolveManualStatus(value) {
  const statusRaw = String(value || "Present").trim();
  if (!MANUAL_ATTENDANCE_STATUSES.includes(statusRaw)) {
    throw httpError(
      `Invalid attendance status. Allowed: ${MANUAL_ATTENDANCE_STATUSES.join(", ")}`,
      400
    );
  }
  return statusRaw;
}

function resolveMethod(value, fallback = "Manual") {
  const method = String(value || fallback).trim();
  return ATTENDANCE_METHODS.includes(method) ? method : fallback;
}

async function loadStudentsForRecords(records, scope) {
  const mongoIds = [];
  const codes = [];
  for (const item of records) {
    const oid =
      asObjectId(item.studentMongoId) ||
      asObjectId(item.studentId) ||
      asObjectId(item.id);
    if (oid) mongoIds.push(oid);
    const code = String(item.studentCode || item.studentId || "").trim();
    if (code && !asObjectId(code)) codes.push(code);
  }

  const or = [];
  if (mongoIds.length) or.push({ _id: { $in: mongoIds } });
  if (codes.length) or.push({ studentId: { $in: codes } });
  if (!or.length) {
    throw httpError("Each record must include a studentId", 400);
  }

  const students = await Student.find(or.length === 1 ? or[0] : { $or: or })
    .lean()
    .maxTimeMS(10000);

  const roster = await findRosterStudents(scope);
  const rosterIds = new Set(roster.map((s) => String(s._id)));
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const byCode = new Map(students.map((s) => [String(s.studentId || ""), s]));

  const resolved = [];
  for (const item of records) {
    const oid =
      asObjectId(item.studentMongoId) ||
      asObjectId(item.studentId) ||
      asObjectId(item.id);
    const code = String(item.studentCode || item.studentId || "").trim();
    const student = (oid && byId.get(String(oid))) || (code && byCode.get(code));
    if (!student) {
      throw httpError(
        `Student not found: ${code || item.studentId || item.studentMongoId || "unknown"}`,
        400
      );
    }
    assertStudentInScope(student, scope, rosterIds);
    resolved.push({ item, student });
  }
  return resolved;
}

export async function markBulkAttendance(payload = {}, editor = "master-admin") {
  await ensureAttendanceIndexes();
  const {
    universityId,
    courseId,
    batchId,
    semester,
    date,
    method = "Manual",
    records = [],
  } = payload;

  if (!Array.isArray(records) || records.length === 0) {
    throw httpError("At least one attendance record is required", 400);
  }
  if (date && Number.isNaN(new Date(date).getTime())) {
    throw httpError("Date is invalid", 400);
  }

  const scope = await resolveScope({
    universityId,
    courseId,
    batchId,
    semester,
    requireBatch: true,
  });
  const targetDate = dayStart(date);
  assertDateInBatchWindow(scope, targetDate);
  const lock = await getScopeLock(scope, targetDate);
  assertUnlocked(lock);

  const methodSafe = resolveMethod(method, "Manual");
  const resolved = await loadStudentsForRecords(records, scope);
  const results = [];
  const changes = [];

  for (const { item, student } of resolved) {
    const status = resolveManualStatus(item.status);
    const itemMethod = resolveMethod(item.method, methodSafe);
    const remarks = String(item.remarks ?? item.note ?? "").trim();
    const upserted = await upsertStudentMark({
      student,
      scope,
      targetDate,
      status,
      method: itemMethod,
      remarks,
      editor,
      skipLog: true,
    });
    results.push(toRow(upserted.doc.toObject ? upserted.doc.toObject() : upserted.doc));
    if (upserted.changed) {
      changes.push({
        studentId: student.studentId,
        attendanceId: upserted.doc.attendanceId,
        oldStatus: upserted.oldStatus,
        newStatus: status,
      });
    }
  }

  await createActivityLog({
    section: "Attendance",
    action: "mark",
    actor: editor,
    resourceId: `${scope.batchCode || scope.batchId}-S${scope.semester}`,
    message: `Saved attendance for ${results.length} student(s) — ${scope.batchName || scope.courseName} ${scope.semesterTitle} (${formatDateLabel(targetDate)})`,
    path: "/api/attendance/bulk",
    method: methodSafe,
    meta: {
      date: targetDate.toISOString(),
      method: methodSafe,
      changedBy: editor,
      changedAt: new Date().toISOString(),
      records: changes,
    },
  }).catch(() => null);

  emitSectionUpdate({
    section: "Attendance",
    action: "mark",
    message: `Attendance updated (${results.length})`,
    at: new Date().toISOString(),
  });

  const list = await listAttendance({
    universityId: String(scope.universityId),
    courseId: String(scope.courseId),
    batchId: String(scope.batchId),
    semester: scope.semester,
    date: targetDate.toISOString(),
    page: payload.page,
    limit: payload.limit || DEFAULT_LIST_LIMIT,
  });

  return {
    marked: results.length,
    rows: list.rows,
    stats: list.stats,
    meta: list.meta,
    pagination: list.pagination,
  };
}

export async function markOneAttendance(payload = {}, editor = "master-admin") {
  const data = await markBulkAttendance(
    {
      ...payload,
      records: [
        {
          studentId: payload.studentId,
          studentMongoId: payload.studentMongoId,
          studentCode: payload.studentCode,
          status: payload.status,
          remarks: payload.remarks ?? payload.note,
          method: payload.method,
        },
      ],
    },
    editor
  );
  const entry =
    data.rows.find(
      (row) =>
        String(row.studentMongoId) === String(payload.studentMongoId || "") ||
        String(row.studentId) === String(payload.studentId || payload.studentCode || "")
    ) || data.rows[0] || null;
  return { ...data, entry };
}

export async function updateAttendance(id, payload = {}, editor = "master-admin") {
  await ensureAttendanceIndexes();
  const oid = asObjectId(id);
  const query = oid ? { _id: oid } : { attendanceId: String(id || "").trim() };

  const doc = await Attendance.findOne(query);
  if (!doc) throw httpError("Attendance record not found", 404);
  if (doc.isLocked) throw httpError("This attendance record is locked", 423);

  const lock = doc.batchId
    ? await AttendanceLock.findOne({
        batchId: doc.batchId,
        date: doc.date,
        "term.number": doc.term?.number || doc.semester,
      })
        .lean()
        .maxTimeMS(5000)
    : null;
  assertUnlocked(lock);

  const oldStatus = doc.status;
  if (payload.status != null) {
    doc.status = resolveManualStatus(payload.status);
  }
  if (payload.method != null) {
    doc.method = resolveMethod(payload.method, doc.method || "Manual");
  }
  if (payload.remarks != null || payload.note != null) {
    const remarks = String(payload.remarks ?? payload.note ?? "").trim();
    doc.remarks = remarks;
    doc.note = remarks;
  }
  doc.updatedBy = editor;
  doc.markedBy = editor;
  await doc.save();

  await logAttendanceChange({
    editor,
    action: "update",
    student: { studentId: doc.studentCode, _id: doc.studentId },
    doc,
    oldStatus,
    newStatus: doc.status,
    method: doc.method,
    path: `/api/attendance/${doc.attendanceId}`,
  });

  emitSectionUpdate({
    section: "Attendance",
    action: "update",
    resourceId: doc.attendanceId,
    message: `Attendance ${doc.attendanceId} updated`,
    at: new Date().toISOString(),
  });

  return toRow(doc.toObject());
}

export async function searchAttendance(params = {}) {
  await ensureAttendanceIndexes();
  const {
    universityId = "",
    courseId = "",
    batchId = "",
    semester = "",
    search = "",
    date = "",
    page = 1,
    limit = 50,
  } = params;

  if (universityId && courseId && batchId && semester) {
    return listAttendance({
      universityId,
      courseId,
      batchId,
      semester,
      date,
      search,
      page,
      limit,
    });
  }

  const q = String(search || "").trim();
  if (!q) {
    return {
      rows: [],
      stats: emptyCounts(),
      pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      meta: {
        requiresFilters: true,
        searchOnly: true,
        message: "Select filters or enter a search term",
      },
    };
  }

  const query = {};
  const uniOid = asObjectId(universityId);
  const courseOid = asObjectId(courseId);
  const batchOid = asObjectId(batchId);
  if (uniOid) query.universityId = uniOid;
  if (courseOid) query.courseId = courseOid;
  if (batchOid) query.batchId = batchOid;
  if (semester) {
    const sem = Number(semester);
    if (Number.isFinite(sem) && sem > 0) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ semester: sem }, { "term.number": sem }],
      });
    }
  }
  if (date) query.date = dayStart(date);

  const rx = new RegExp(escapeRegex(q), "i");
  const textOr = [
    { student: rx },
    { email: rx },
    { phone: rx },
    { admissionId: rx },
    { studentCode: rx },
    { attendanceId: rx },
    { courseName: rx },
    { courseCode: rx },
    { universityName: rx },
    { batchName: rx },
    { batchCode: rx },
    { semesterTitle: rx },
    { status: rx },
  ];
  const maybeSem = Number(q);
  if (Number.isFinite(maybeSem) && maybeSem > 0) {
    textOr.push({ semester: maybeSem });
  }
  query.$or = textOr;

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [docs, total] = await Promise.all([
    Attendance.find(query)
      .sort({ date: -1, student: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean()
      .maxTimeMS(10000),
    Attendance.countDocuments(query).maxTimeMS(8000),
  ]);

  const rows = docs.map((d) => toRow(d));
  return {
    rows,
    stats: computeStats(rows),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit) || 1),
    },
    meta: {
      requiresFilters: false,
      searchOnly: true,
      total,
    },
  };
}

async function findStudentDoc(studentId) {
  const oid = asObjectId(studentId);
  const query = oid
    ? { $or: [{ _id: oid }, { studentId: String(studentId).trim() }] }
    : { studentId: String(studentId || "").trim() };
  const student = await Student.findOne(query)
    .select(
      "studentId admissionId admissionMongoId nameEnglish contact photo universityId courseId batchId currentTerm universityName courseName courseCode batchName status"
    )
    .lean()
    .maxTimeMS(8000);
  if (!student) throw httpError("Student not found", 404);
  return student;
}

export async function getStudentAttendanceHistory(studentId, params = {}) {
  await ensureAttendanceIndexes();
  const student = await findStudentDoc(studentId);
  const {
    from = "",
    to = "",
    semester = "",
    courseId = "",
    batchId = "",
  } = params;

  const or = [{ studentId: student._id }];
  if (student.admissionMongoId) or.push({ admissionMongoId: student.admissionMongoId });
  if (student.admissionId) or.push({ admissionId: student.admissionId });
  if (student.studentId) or.push({ studentCode: student.studentId });

  const query = { $or: or };
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = dayStart(from);
    if (to) query.date.$lte = dayEnd(to);
  }
  if (semester) {
    const sem = Number(semester);
    if (Number.isFinite(sem) && sem > 0) {
      query.$and = [
        { $or: [{ semester: sem }, { "term.number": sem }] },
      ];
    }
  }
  const courseOid = asObjectId(courseId);
  const batchOid = asObjectId(batchId);
  if (courseOid) query.courseId = courseOid;
  if (batchOid) query.batchId = batchOid;

  const docs = await Attendance.find(query)
    .sort({ date: -1, createdAt: -1 })
    .lean()
    .maxTimeMS(12000);

  const rows = docs.map((d) => toRow(d, {
    studentMongoId: String(student._id),
    studentId: student.studentId,
    studentCode: student.studentId,
    student: studentDisplayName(student),
    currentTerm: currentTermLabel(student.currentTerm, student.currentTerm?.number),
  }));

  const workingDays = rows.filter(
    (r) => MANUAL_ATTENDANCE_STATUSES.includes(r.status) || r.status === "Holiday"
  );
  const stats = computeStats(
    workingDays.map((r) => ({
      status: r.status === "Holiday" ? "Leave" : r.status,
    }))
  );
  stats.workingDays = workingDays.length;
  stats.total = workingDays.length;
  const presentLike = COUNT_LATE_AS_PRESENT
    ? stats.present + stats.late
    : stats.present;
  stats.percent =
    workingDays.length > 0
      ? roundPercent((presentLike / workingDays.length) * 100)
      : 0;

  return {
    student: {
      studentMongoId: String(student._id),
      studentId: student.studentId,
      name: studentDisplayName(student),
      admissionId: student.admissionId || "",
      phone: student.contact?.mobile || "",
      email: student.contact?.email || "",
      photo: slimPhoto(student.photo),
      courseName: student.courseName || "",
      batchName: student.batchName || "",
      currentTerm: currentTermLabel(student.currentTerm, student.currentTerm?.number),
    },
    rows,
    stats,
    meta: {
      from: from || "",
      to: to || "",
      semester: semester || "",
      courseId: courseOid ? String(courseOid) : "",
      batchId: batchOid ? String(batchOid) : "",
    },
  };
}

export async function getAttendanceReport(params = {}) {
  await ensureAttendanceIndexes();
  const {
    universityId = "",
    courseId = "",
    batchId = "",
    semester = "",
    from = "",
    to = "",
  } = params;

  const scope = await resolveScope({
    universityId,
    courseId,
    batchId,
    semester,
    requireBatch: true,
  });
  if (!from || !to) throw httpError("From date and to date are required", 400);
  const fromDate = dayStart(from);
  const toDate = dayEnd(to);
  if (fromDate > toDate) throw httpError("From date cannot be after to date", 400);
  const window = batchDateWindow(scope.batch);
  if (window?.upcoming) {
    throw httpError(
      `This batch has not started yet. Attendance reports are available from ${formatDateNumeric(window.min)}`,
      400
    );
  }
  if (window && fromDate < window.min) {
    throw httpError(
      `From date cannot be before the batch start date (${formatDateNumeric(window.min)})`,
      400
    );
  }
  if (window && dayStart(to) > window.max) {
    throw httpError(
      `To date cannot be after ${formatDateNumeric(window.max)}`,
      400
    );
  }

  const students = await findRosterStudents(scope);
  const studentOids = students.map((s) => s._id);
  const admissionOids = students.map((s) => s.admissionMongoId).filter(Boolean);

  const markOr = [];
  if (studentOids.length) markOr.push({ studentId: { $in: studentOids } });
  if (admissionOids.length) markOr.push({ admissionMongoId: { $in: admissionOids } });
  if (scope.batchId) markOr.push({ batchId: scope.batchId });

  const marks = markOr.length
    ? await Attendance.find({
        $and: [
          { $or: markOr },
          { date: { $gte: fromDate, $lte: toDate } },
          { $or: [{ "term.number": scope.semester }, { semester: scope.semester }] },
        ],
      })
        .lean()
        .maxTimeMS(15000)
    : [];

  const byKey = new Map();
  const pushMark = (key, mark) => {
    if (!byKey.has(key)) byKey.set(key, new Map());
    const dayKey = dayStart(mark.date).toISOString();
    const existing = byKey.get(key).get(dayKey);
    if (!existing) byKey.get(key).set(dayKey, mark);
  };
  for (const mark of marks) {
    if (mark.studentId) pushMark(`s:${mark.studentId}`, mark);
    if (mark.admissionMongoId) pushMark(`a:${mark.admissionMongoId}`, mark);
  }

  const rows = students.map((student) => {
    const days =
      byKey.get(`s:${student._id}`) ||
      (student.admissionMongoId
        ? byKey.get(`a:${student.admissionMongoId}`)
        : null) ||
      new Map();
    const dayMarks = [...days.values()];
    const counts = computeStats(
      dayMarks.map((m) => ({ status: m.status || "Unmarked" }))
    );
    const workingDays = dayMarks.length;
    const presentLike = COUNT_LATE_AS_PRESENT
      ? counts.present + counts.late
      : counts.present;
    return {
      studentMongoId: String(student._id),
      studentId: student.studentId,
      student: studentDisplayName(student),
      admissionId: student.admissionId || "",
      phone: student.contact?.mobile || "",
      email: student.contact?.email || "",
      currentTerm: currentTermLabel(
        student.currentTerm,
        student.currentTerm?.number,
        scope.semesterTitle
      ),
      totalDays: workingDays,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      leave: counts.leave,
      unmarked: 0,
      percent:
        workingDays > 0 ? roundPercent((presentLike / workingDays) * 100) : 0,
    };
  });

  return {
    rows,
    stats: {
      students: rows.length,
      averagePercent:
        rows.length > 0
          ? roundPercent(
              rows.reduce((sum, r) => sum + Number(r.percent || 0), 0) / rows.length
            )
          : 0,
    },
    meta: scopeMeta(scope, fromDate, {
      from: fromDate.toISOString(),
      to: dayStart(to).toISOString(),
      fromLabel: formatDateNumeric(fromDate),
      toLabel: formatDateNumeric(to),
      report: true,
    }),
  };
}

export async function setAttendanceLock(payload = {}, editor = "master-admin", locked = true) {
  await ensureAttendanceIndexes();
  const scope = await resolveScope({
    universityId: payload.universityId,
    courseId: payload.courseId,
    batchId: payload.batchId,
    semester: payload.semester,
    requireBatch: true,
  });
  const targetDate = dayStart(payload.date);
  assertDateInBatchWindow(scope, targetDate);

  const doc = await AttendanceLock.findOneAndUpdate(
    {
      batchId: scope.batchId,
      date: targetDate,
      "term.number": scope.semester,
    },
    {
      $set: {
        universityId: scope.universityId,
        courseId: scope.courseId,
        batchId: scope.batchId,
        term: { type: scope.term.type, number: scope.semester },
        date: targetDate,
        isLocked: Boolean(locked),
        ...(locked
          ? { lockedBy: editor, lockedAt: new Date(), unlockedBy: "", unlockedAt: null }
          : { unlockedBy: editor, unlockedAt: new Date() }),
      },
    },
    { upsert: true, new: true }
  );

  await Attendance.updateMany(
    {
      batchId: scope.batchId,
      date: targetDate,
      $or: [{ "term.number": scope.semester }, { semester: scope.semester }],
    },
    {
      $set: {
        isLocked: Boolean(locked),
        lockedBy: locked ? editor : "",
        lockedAt: locked ? new Date() : null,
      },
    }
  );

  await createActivityLog({
    section: "Attendance",
    action: locked ? "lock" : "unlock",
    actor: editor,
    resourceId: `${scope.batchCode || scope.batchId}-S${scope.semester}`,
    message: `${locked ? "Locked" : "Unlocked"} attendance — ${scope.batchName} ${scope.semesterTitle} (${formatDateLabel(targetDate)})`,
    path: locked ? "/api/attendance/lock" : "/api/attendance/unlock",
    meta: {
      date: targetDate.toISOString(),
      isLocked: Boolean(locked),
      changedBy: editor,
      changedAt: new Date().toISOString(),
      method: "Manual",
    },
  }).catch(() => null);

  const list = await listAttendance({
    universityId: String(scope.universityId),
    courseId: String(scope.courseId),
    batchId: String(scope.batchId),
    semester: scope.semester,
    date: targetDate.toISOString(),
  });

  return {
    isLocked: Boolean(doc.isLocked),
    lockedBy: doc.lockedBy || "",
    lockedAt: doc.lockedAt || null,
    rows: list.rows,
    stats: list.stats,
    meta: list.meta,
  };
}

const STATUS_RANK = {
  holiday: 1,
  present: 2,
  late: 3,
  leave: 4,
  absent: 5,
};

function statusKey(status) {
  const s = String(status || "").trim().toLowerCase();
  if (STATUS_RANK[s]) return s;
  return "";
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelFromKey(key) {
  const [ys, ms] = String(key || "").split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return key || "—";
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function shortMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { month: "short" });
}

/**
 * Student portal — own attendance summary (calendar, trend, course-wise).
 */
export async function getStudentMyAttendance({ email, year, month } = {}) {
  const normalizedEmail = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalizedEmail) {
    throw httpError("Student email is required", 401);
  }

  const [admissions, studentDoc] = await Promise.all([
    Admission.find({
      email: normalizedEmail,
      status: "Approved",
    })
      .select("_id admissionId course details")
      .lean()
      .maxTimeMS(8000),
    Student.findOne({ "contact.email": normalizedEmail })
      .select("_id studentId admissionId admissionMongoId")
      .lean()
      .maxTimeMS(8000),
  ]);

  const admissionMongoIds = admissions.map((a) => a._id).filter(Boolean);
  const admissionCodes = admissions
    .map((a) => String(a.admissionId || "").trim())
    .filter(Boolean);

  const or = [{ email: normalizedEmail }];
  if (admissionMongoIds.length) {
    or.push({ admissionMongoId: { $in: admissionMongoIds } });
  }
  if (admissionCodes.length) {
    or.push({ admissionId: { $in: admissionCodes } });
  }
  if (studentDoc?._id) or.push({ studentId: studentDoc._id });
  if (studentDoc?.studentId) or.push({ studentCode: studentDoc.studentId });

  const docs = await Attendance.find({ $or: or })
    .sort({ date: 1 })
    .lean()
    .maxTimeMS(12000);

  const now = new Date();
  let y = Number(year);
  let m = Number(month);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) y = now.getFullYear();
  if (!Number.isFinite(m) || m < 1 || m > 12) m = now.getMonth() + 1;

  const selectedKey = `${y}-${String(m).padStart(2, "0")}`;
  const monthStart = new Date(y, m - 1, 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
  const daysInMonth = monthEnd.getDate();

  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;

  const calendarDays = {};
  const trendMap = new Map();
  const subjectMap = new Map();
  const monthKeysSet = new Set();

  for (const doc of docs) {
    const date = doc.date ? new Date(doc.date) : null;
    if (!date || Number.isNaN(date.getTime())) continue;

    const key = monthKey(date);
    if (key) monthKeysSet.add(key);

    const status = statusKey(doc.status);
    if (!status) continue;

    if (status === "present") presentDays += 1;
    else if (status === "absent") absentDays += 1;
    else if (status === "late") lateDays += 1;
    else if (status === "leave") leaveDays += 1;
    else if (status === "holiday") holidayDays += 1;

    if (date >= monthStart && date <= monthEnd) {
      const day = date.getDate();
      const prev = calendarDays[day];
      if (!prev || (STATUS_RANK[status] || 0) > (STATUS_RANK[prev] || 0)) {
        calendarDays[day] = status;
      }
    }

    if (!trendMap.has(key)) {
      trendMap.set(key, {
        key,
        month: shortMonth(date),
        present: 0,
        absent: 0,
        late: 0,
        leave: 0,
        holiday: 0,
      });
    }
    const bucket = trendMap.get(key);
    if (status === "present") bucket.present += 1;
    else if (status === "absent") bucket.absent += 1;
    else if (status === "late") bucket.late += 1;
    else if (status === "leave") bucket.leave += 1;
    else if (status === "holiday") bucket.holiday += 1;

    const subject =
      String(doc.courseName || doc.courseCode || "").trim() || "General";
    if (!subjectMap.has(subject)) {
      subjectMap.set(subject, {
        subject,
        present: 0,
        absent: 0,
        late: 0,
        leave: 0,
        holiday: 0,
      });
    }
    const sub = subjectMap.get(subject);
    if (status === "present") sub.present += 1;
    else if (status === "absent") sub.absent += 1;
    else if (status === "late") sub.late += 1;
    else if (status === "leave") sub.leave += 1;
    else if (status === "holiday") sub.holiday += 1;
  }

  monthKeysSet.add(selectedKey);
  const months = [...monthKeysSet]
    .sort()
    .reverse()
    .map((key) => ({
      value: key,
      label: monthLabelFromKey(key),
    }));

  const trend = [...trendMap.values()]
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .slice(-8)
    .map((row) => {
      const marked =
        row.present + row.absent + row.late + row.leave + row.holiday;
      const presentLike = row.present + row.late;
      return {
        month: row.month,
        present: row.present,
        absent: row.absent,
        late: row.late,
        leave: row.leave,
        percent: marked > 0 ? Math.round((presentLike / marked) * 100) : 0,
      };
    });

  const subjects = [...subjectMap.values()]
    .map((row) => {
      const marked =
        row.present + row.absent + row.late + row.leave + row.holiday;
      const presentLike = row.present + row.late;
      return {
        subject: row.subject,
        present: row.present,
        absent: row.absent,
        late: row.late,
        leave: row.leave,
        percent: marked > 0 ? Math.round((presentLike / marked) * 100) : 0,
      };
    })
    .sort((a, b) => b.percent - a.percent || a.subject.localeCompare(b.subject));

  const totalMarked =
    presentDays + absentDays + lateDays + leaveDays + holidayDays;
  const presentLike = presentDays + lateDays;
  const attendancePercent =
    totalMarked > 0 ? Math.round((presentLike / totalMarked) * 100) : 0;

  const monthRows = docs
    .filter((doc) => {
      const date = doc.date ? new Date(doc.date) : null;
      return date && date >= monthStart && date <= monthEnd;
    })
    .map((d) => toRow(d));

  return {
    stats: {
      attendancePercent,
      presentDays,
      absentDays,
      lateDays,
      leaveDays,
      holidayDays,
      totalMarked,
    },
    calendar: {
      year: y,
      monthIndex: m - 1,
      month: monthLabelFromKey(selectedKey),
      daysInMonth,
      days: calendarDays,
    },
    trend,
    subjects,
    months,
    rows: monthRows,
    meta: {
      email: normalizedEmail,
      admissions: admissions.length,
      records: docs.length,
      selectedMonth: selectedKey,
      hasData: docs.length > 0,
    },
  };
}
