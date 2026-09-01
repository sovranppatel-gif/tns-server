import mongoose from "mongoose";
import { Admission } from "../../models/Admission.js";
import { COUNT_LATE_AS_PRESENT } from "../attendance/attendance.model.js";
import { Attendance } from "../attendance/attendance.model.js";
import { Batch } from "../batches/batches.model.js";
import { Course } from "../courses/courses.model.js";
import { Enquiry } from "../enquiries/enquiries.model.js";
import { ExamResult } from "../exams/examResult.model.js";
import { Faculty } from "../faculty/faculty.model.js";
import { FacultyAssignment } from "../faculty/facultyAssignment.model.js";
import { StudentFee } from "../fees/fees.model.js";
import { Lead } from "../leads/leads.model.js";
import { Staff } from "../staff/staff.model.js";
import { Student } from "../students/students.model.js";
import { University } from "../universities/universities.model.js";

const QUERY_MS = 12000;
const ROW_LIMIT = 400;
const TZ = "Asia/Kolkata";

export const REPORT_TYPES = [
  "overview",
  "students",
  "admissions",
  "fees",
  "defaulters",
  "attendance",
  "exams",
  "people",
];

function asOid(value) {
  const raw = String(value || "").trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

function str(value) {
  return String(value || "").trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((num(part) / num(total)) * 1000) / 10;
}

function formatINR(amount) {
  return `₹${num(amount).toLocaleString("en-IN")}`;
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

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayStart(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayEnd(value) {
  const d = dayStart(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function defaultRange() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (now.getDate() <= 7) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const from = new Date(year, month, 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to, fromKey: isoDate(from), toKey: isoDate(to) };
}

function parseFilters(query = {}) {
  const fallback = defaultRange();
  const from = dayStart(query.from) || fallback.from;
  const to = dayEnd(query.to) || fallback.to;
  const thresholdRaw = num(query.threshold);
  return {
    from: from > to ? fallback.from : from,
    to: from > to ? fallback.to : to,
    fromKey: isoDate(from > to ? fallback.from : from),
    toKey: isoDate(from > to ? fallback.to : to),
    universityId: asOid(query.universityId),
    courseId: asOid(query.courseId),
    batchId: asOid(query.batchId),
    session: str(query.session),
    threshold: thresholdRaw > 0 && thresholdRaw <= 100 ? thresholdRaw : 75,
    shortageOnly: String(query.shortageOnly || "").toLowerCase() === "true",
  };
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`reports ${label}:`, err?.message || err);
    return fallback;
  }
}

function countBy(docs, key = "_id") {
  const map = {};
  for (const row of docs || []) {
    const id = row[key] == null || row[key] === "" ? "Unknown" : String(row[key]);
    map[id] = num(row.count);
  }
  return map;
}

function periodMatch(from, to, fields) {
  return {
    $or: fields.map((field) => ({ [field]: { $gte: from, $lte: to } })),
  };
}

async function resolveScope(filters) {
  const match = {};
  if (filters.universityId) match.universityId = filters.universityId;
  if (filters.courseId) match.courseId = filters.courseId;
  if (filters.batchId) match.batchId = filters.batchId;
  if (filters.session) match.session = filters.session;

  const hasPeopleFilter = Boolean(
    filters.universityId || filters.courseId || filters.batchId || filters.session
  );

  let courseName = "";
  let courseCode = "";
  if (filters.courseId) {
    const course = await Course.findById(filters.courseId)
      .select("name code")
      .lean()
      .maxTimeMS(QUERY_MS);
    courseName = course?.name || "";
    courseCode = course?.code || "";
  }

  let studentIds = [];
  let admissionMongoIds = [];
  let admissionIds = [];
  if (hasPeopleFilter) {
    const students = await Student.find(match)
      .select("_id admissionMongoId admissionId")
      .lean()
      .maxTimeMS(QUERY_MS);
    studentIds = students.map((s) => s._id);
    admissionMongoIds = students.map((s) => s.admissionMongoId).filter(Boolean);
    admissionIds = students.map((s) => s.admissionId).filter(Boolean);
  }

  return {
    filters,
    match,
    hasPeopleFilter,
    studentIds,
    admissionMongoIds,
    admissionIds,
    courseName,
    courseCode,
  };
}

function feeAccountMatch(scope) {
  if (!scope.hasPeopleFilter) return {};
  const or = [];
  if (scope.admissionMongoIds.length) {
    or.push({ admissionMongoId: { $in: scope.admissionMongoIds } });
  }
  if (scope.admissionIds.length) or.push({ admissionId: { $in: scope.admissionIds } });
  if (scope.filters.courseId) {
    or.push({ courseId: scope.filters.courseId });
    if (scope.courseName) or.push({ course: scope.courseName });
    if (scope.courseCode) or.push({ courseCode: scope.courseCode });
  }
  if (!or.length) return { _id: { $exists: false } };
  return { $or: or };
}

function attendanceMatch(scope, from, to) {
  const match = { date: { $gte: from, $lte: to } };
  if (scope.filters.universityId) match.universityId = scope.filters.universityId;
  if (scope.filters.courseId) match.courseId = scope.filters.courseId;
  if (scope.filters.batchId) match.batchId = scope.filters.batchId;
  return match;
}

function studentCourseLabel() {
  return {
    $let: {
      vars: {
        name: { $trim: { input: { $ifNull: ["$courseName", ""] } } },
        code: { $trim: { input: { $ifNull: ["$courseCode", ""] } } },
      },
      in: {
        $cond: [
          { $gt: [{ $strLenCP: "$$name" }, 0] },
          "$$name",
          { $cond: [{ $gt: [{ $strLenCP: "$$code" }, 0] }, "$$code", "Unassigned"] },
        ],
      },
    },
  };
}

export async function getReportsMeta() {
  const [universities, courses, batches, studentSessions, admissionSessions] = await Promise.all([
    University.find({ softDelete: false })
      .select("name shortName status")
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(QUERY_MS),
    Course.find({ softDelete: false })
      .select("name code universityId status")
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(QUERY_MS),
    Batch.find({ softDelete: false })
      .select("name batchId courseId universityId status")
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(QUERY_MS),
    Student.distinct("session").maxTimeMS(QUERY_MS),
    Admission.distinct("session").maxTimeMS(QUERY_MS),
  ]);

  const sessions = [
    ...new Set(
      [...(studentSessions || []), ...(admissionSessions || [])]
        .map((s) => str(s))
        .filter(Boolean)
    ),
  ].sort();

  return {
    universities: (universities || []).map((row) => ({
      id: String(row._id),
      name: row.shortName || row.name,
      status: row.status || "Active",
    })),
    courses: (courses || []).map((row) => ({
      id: String(row._id),
      name: row.code ? `${row.name} (${row.code})` : row.name,
      universityId: row.universityId ? String(row.universityId) : "",
      status: row.status || "Active",
    })),
    batches: (batches || []).map((row) => ({
      id: String(row._id),
      name: row.name,
      courseId: row.courseId ? String(row.courseId) : "",
      universityId: row.universityId ? String(row.universityId) : "",
      status: row.status || "Running",
    })),
    sessions,
  };
}

async function studentSnapshot(scope, { withRows = true } = {}) {
  const match = scope.hasPeopleFilter ? scope.match : {};
  const [byStatus, byGender, byCategory, byCourse, incomplete, rows] = await Promise.all([
    Student.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ["$gender", "Unspecified"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ["$category", "Unspecified"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.aggregate([
      { $match: match },
      { $project: { label: studentCourseLabel() } },
      { $group: { _id: "$label", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.countDocuments({
      ...match,
      $or: [{ photo: { $in: ["", null] } }, { documents: { $size: 0 } }, { documents: { $exists: false } }],
    }).maxTimeMS(QUERY_MS),
    withRows
      ? Student.find(match)
          .select(
            "studentId admissionId nameEnglish courseName courseCode batchName session universityName gender category status contact.mobile documents photo admissionDate"
          )
          .sort({ nameEnglish: 1 })
          .limit(ROW_LIMIT)
          .lean()
          .maxTimeMS(QUERY_MS)
      : Promise.resolve([]),
  ]);

  const status = countBy(byStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  const newInPeriod = await Student.countDocuments({
    ...match,
    ...periodMatch(scope.filters.from, scope.filters.to, ["admissionDate", "createdAt"]),
  }).maxTimeMS(QUERY_MS);

  return {
    stats: {
      total,
      active: status.Active || 0,
      completed: status.Completed || 0,
      dropped: (status.Dropped || 0) + (status.Inactive || 0) + (status.Cancelled || 0),
      newInPeriod,
      incomplete,
    },
    charts: {
      byStatus: Object.entries(status).map(([name, value]) => ({ name, value })),
      byGender: (byGender || []).map((row) => ({ name: row._id || "Unspecified", value: num(row.count) })),
      byCategory: (byCategory || []).map((row) => ({ name: row._id || "Unspecified", value: num(row.count) })),
      byCourse: (byCourse || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
    },
    rows: (rows || []).map((row) => {
      const docs = Array.isArray(row.documents) ? row.documents.length : 0;
      return {
        id: row.studentId || String(row._id),
        studentId: row.studentId || "—",
        name: row.nameEnglish || "—",
        course: row.courseName || row.courseCode || "—",
        batch: row.batchName || "—",
        session: row.session || "—",
        university: row.universityName || "—",
        gender: row.gender || "—",
        category: row.category || "—",
        status: row.status || "Active",
        mobile: row.contact?.mobile || "—",
        documents: docs,
        photo: row.photo ? "Yes" : "No",
        incomplete: !row.photo || docs === 0,
        admitted: formatDate(row.admissionDate),
      };
    }),
  };
}

async function feeSnapshot(scope, { withRows = true } = {}) {
  const accountMatch = feeAccountMatch(scope);
  const [totals, byCourse, byMethod, payments, accounts] = await Promise.all([
    StudentFee.aggregate([
      { $match: accountMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
          pending: { $sum: { $ifNull: ["$dueAmount", 0] } },
          billed: { $sum: { $ifNull: ["$totalAmount", 0] } },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $match: accountMatch },
      {
        $group: {
          _id: { $ifNull: ["$course", "Unassigned"] },
          collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
          pending: { $sum: { $ifNull: ["$dueAmount", 0] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { collected: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $match: accountMatch },
      { $unwind: "$payments" },
      {
        $match: {
          "payments.date": { $gte: scope.filters.from, $lte: scope.filters.to },
          "payments.amount": { $gt: 0 },
          "payments.status": { $nin: ["Refunded", "Failed", "Cancelled"] },
        },
      },
      {
        $group: {
          _id: {
            $ifNull: ["$payments.method", { $ifNull: ["$payments.mode", "Unknown"] }],
          },
          amount: { $sum: "$payments.amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
    withRows
      ? StudentFee.aggregate([
          { $match: accountMatch },
          { $unwind: "$payments" },
          {
            $match: {
              "payments.date": { $gte: scope.filters.from, $lte: scope.filters.to },
              "payments.amount": { $gt: 0 },
            },
          },
          { $sort: { "payments.date": -1 } },
          { $limit: ROW_LIMIT },
          {
            $project: {
              feeId: 1,
              student: 1,
              course: 1,
              amount: "$payments.amount",
              method: { $ifNull: ["$payments.method", "$payments.mode"] },
              status: "$payments.status",
              invoice: "$payments.invoice",
              date: "$payments.date",
              note: "$payments.note",
            },
          },
        ]).option({ maxTimeMS: QUERY_MS })
      : Promise.resolve([]),
    withRows
      ? StudentFee.find(accountMatch)
          .select("feeId student course status totalAmount paidAmount dueAmount nextDueDate category phone")
          .sort({ dueAmount: -1, student: 1 })
          .limit(ROW_LIMIT)
          .lean()
          .maxTimeMS(QUERY_MS)
      : Promise.resolve([]),
  ]);

  let collected = 0;
  let pending = 0;
  let billed = 0;
  let overdue = 0;
  let accountsCount = 0;
  const byStatus = { Paid: 0, Partial: 0, Pending: 0, Overdue: 0 };
  for (const row of totals || []) {
    accountsCount += num(row.count);
    collected += num(row.collected);
    pending += num(row.pending);
    billed += num(row.billed);
    if (row._id === "Overdue") overdue += num(row.pending);
    if (byStatus[row._id] != null) byStatus[row._id] = num(row.count);
  }

  const periodCollected = (byMethod || []).reduce((s, row) => s + num(row.amount), 0);
  const periodPayments = (byMethod || []).reduce((s, row) => s + num(row.count), 0);

  return {
    stats: {
      accounts: accountsCount,
      billed,
      billedLabel: formatINR(billed),
      collected,
      collectedLabel: formatINR(collected),
      pending,
      pendingLabel: formatINR(pending),
      overdue,
      overdueLabel: formatINR(overdue),
      periodCollected,
      periodCollectedLabel: formatINR(periodCollected),
      periodPayments,
      collectionRate: pct(collected, billed || collected + pending),
    },
    charts: {
      byStatus: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
      byCourse: (byCourse || []).map((row) => ({
        name: row._id || "Unassigned",
        value: num(row.collected),
        pending: num(row.pending),
      })),
      byMethod: (byMethod || []).map((row) => ({
        name: row._id || "Unknown",
        value: num(row.amount),
      })),
    },
    rows: (accounts || []).map((row) => ({
      id: row.feeId || String(row._id),
      feeId: row.feeId || "—",
      student: row.student || "—",
      course: row.course || "—",
      category: row.category || "—",
      billed: num(row.totalAmount),
      billedLabel: formatINR(row.totalAmount),
      paid: num(row.paidAmount),
      paidLabel: formatINR(row.paidAmount),
      due: num(row.dueAmount),
      dueLabel: formatINR(row.dueAmount),
      status: row.status || "Pending",
      nextDue: formatDate(row.nextDueDate),
      phone: row.phone || "—",
    })),
    payments: (payments || []).map((row) => ({
      id: `${row.feeId}-${row.invoice || row.date}`,
      feeId: row.feeId || "—",
      student: row.student || "—",
      course: row.course || "—",
      amount: num(row.amount),
      amountLabel: formatINR(row.amount),
      method: row.method || "—",
      status: row.status || "Success",
      invoice: row.invoice || "—",
      date: formatDate(row.date),
      note: row.note || "",
    })),
  };
}

async function defaulterSnapshot(scope) {
  const match = {
    ...feeAccountMatch(scope),
    dueAmount: { $gt: 0 },
    status: { $in: ["Overdue", "Pending", "Partial"] },
  };
  const [totals, rows] = await Promise.all([
    StudentFee.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          due: { $sum: "$dueAmount" },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.find(match)
      .select("feeId student course status dueAmount paidAmount totalAmount nextDueDate phone category")
      .sort({ dueAmount: -1, nextDueDate: 1 })
      .limit(ROW_LIMIT)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  const byStatus = countBy(totals);
  const dueTotal = (totals || []).reduce((s, row) => s + num(row.due), 0);
  const count = (totals || []).reduce((s, row) => s + num(row.count), 0);

  return {
    stats: {
      count,
      due: dueTotal,
      dueLabel: formatINR(dueTotal),
      overdue: byStatus.Overdue || 0,
      partial: byStatus.Partial || 0,
      pending: byStatus.Pending || 0,
    },
    charts: {
      byStatus: (totals || []).map((row) => ({ name: row._id || "Pending", value: num(row.count) })),
    },
    rows: (rows || []).map((row) => ({
      id: row.feeId || String(row._id),
      feeId: row.feeId || "—",
      student: row.student || "—",
      course: row.course || "—",
      category: row.category || "—",
      billed: num(row.totalAmount),
      billedLabel: formatINR(row.totalAmount),
      paid: num(row.paidAmount),
      paidLabel: formatINR(row.paidAmount),
      due: num(row.dueAmount),
      dueLabel: formatINR(row.dueAmount),
      status: row.status || "Pending",
      nextDue: formatDate(row.nextDueDate),
      phone: row.phone || "—",
    })),
  };
}

async function attendanceSnapshot(scope) {
  const match = attendanceMatch(scope, scope.filters.from, scope.filters.to);
  const grouped = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          person: { $ifNull: ["$studentId", "$admissionMongoId"] },
          day: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } },
        },
        status: { $first: "$status" },
        student: { $first: "$student" },
        studentCode: { $first: "$studentCode" },
        course: { $first: "$courseName" },
        batch: { $first: "$batchName" },
      },
    },
    {
      $group: {
        _id: "$_id.person",
        student: { $first: "$student" },
        studentCode: { $first: "$studentCode" },
        course: { $first: "$course" },
        batch: { $first: "$batch" },
        present: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ["$status", "Late"] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $in: ["$status", ["Leave", "Holiday"]] }, 1, 0] } },
        marked: { $sum: 1 },
      },
    },
    {
      $addFields: {
        presentLike: COUNT_LATE_AS_PRESENT ? { $add: ["$present", "$late"] } : "$present",
      },
    },
    {
      $addFields: {
        percent: {
          $cond: [
            { $gt: ["$marked", 0] },
            { $round: [{ $multiply: [{ $divide: ["$presentLike", "$marked"] }, 100] }, 1] },
            0,
          ],
        },
      },
    },
    { $sort: { percent: 1, student: 1 } },
  ]).option({ maxTimeMS: QUERY_MS });

  const threshold = scope.filters.threshold;
  let present = 0;
  let absent = 0;
  let late = 0;
  let leave = 0;
  let marked = 0;
  let below = 0;
  const byCourseMap = new Map();

  const mapped = (grouped || []).map((row) => {
    present += num(row.present);
    absent += num(row.absent);
    late += num(row.late);
    leave += num(row.leave);
    marked += num(row.marked);
    const percent = num(row.percent);
    if (percent < threshold && num(row.marked) > 0) below += 1;
    const course = row.course || "Unassigned";
    const bucket = byCourseMap.get(course) || { name: course, present: 0, marked: 0 };
    bucket.present += COUNT_LATE_AS_PRESENT ? num(row.present) + num(row.late) : num(row.present);
    bucket.marked += num(row.marked);
    byCourseMap.set(course, bucket);
    return {
      id: String(row._id || row.studentCode || row.student),
      student: row.student || "—",
      studentCode: row.studentCode || "—",
      course,
      batch: row.batch || "—",
      present: num(row.present),
      absent: num(row.absent),
      late: num(row.late),
      leave: num(row.leave),
      marked: num(row.marked),
      percent,
      status: percent < threshold ? "Shortage" : "OK",
    };
  });

  const rows = scope.filters.shortageOnly
    ? mapped.filter((row) => row.status === "Shortage")
    : mapped;

  const byCourse = [...byCourseMap.values()]
    .map((row) => ({
      name: row.name,
      value: row.marked ? pct(row.present, row.marked) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    stats: {
      students: mapped.length,
      marked,
      present,
      absent,
      late,
      leave,
      below,
      threshold,
      average: mapped.length ? Math.round((mapped.reduce((s, r) => s + r.percent, 0) / mapped.length) * 10) / 10 : 0,
      percent: marked ? pct(COUNT_LATE_AS_PRESENT ? present + late : present, marked) : 0,
    },
    charts: {
      byCourse,
      byStatus: [
        { name: "Present", value: present },
        { name: "Absent", value: absent },
        { name: "Late", value: late },
        { name: "Leave", value: leave },
      ],
    },
    rows: rows.slice(0, ROW_LIMIT),
  };
}

async function admissionSnapshot(scope) {
  const match = {
    ...periodMatch(scope.filters.from, scope.filters.to, ["admissionDate", "createdAt"]),
  };
  if (scope.filters.courseId) {
    match.$and = match.$and || [];
    const or = [{ courseId: scope.filters.courseId }];
    if (scope.courseName) or.push({ course: scope.courseName });
    match.$and.push({ $or: or });
  }
  if (scope.filters.universityId) match.universityId = scope.filters.universityId;
  if (scope.filters.session) match.session = scope.filters.session;

  const enquiryMatch = { submittedAt: { $gte: scope.filters.from, $lte: scope.filters.to } };
  const leadMatch = { createdAt: { $gte: scope.filters.from, $lte: scope.filters.to } };

  const [byStatus, byMode, byCourse, rows, enquiryCount, leadByStatus] = await Promise.all([
    Admission.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Admission.aggregate([
      { $match: match },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Admission.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ["$course", "Unassigned"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    Admission.find(match)
      .select("admissionId applicant course mode status phone counsellor session admissionDate createdAt")
      .sort({ admissionDate: -1, createdAt: -1 })
      .limit(ROW_LIMIT)
      .lean()
      .maxTimeMS(QUERY_MS),
    Enquiry.countDocuments(enquiryMatch).maxTimeMS(QUERY_MS),
    Lead.aggregate([
      { $match: leadMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
  ]);

  const status = countBy(byStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  const approved = status.Approved || 0;
  const leadStatus = countBy(leadByStatus);
  const leads = Object.values(leadStatus).reduce((s, n) => s + n, 0);
  const converted = leadStatus.Converted || 0;

  return {
    stats: {
      total,
      pending: (status.Pending || 0) + (status.Verification || 0),
      approved,
      rejected: status.Rejected || 0,
      cancelled: status.Cancelled || 0,
      enquiries: enquiryCount,
      leads,
      converted,
      conversionRate: pct(approved, enquiryCount || total),
      leadConversion: pct(converted, leads),
    },
    charts: {
      byStatus: ["Pending", "Verification", "Approved", "Rejected", "Cancelled"]
        .filter((name) => status[name] || name === "Pending" || name === "Approved")
        .map((name) => ({ name, value: status[name] || 0 })),
      byMode: (byMode || []).map((row) => ({ name: row._id || "Unknown", value: num(row.count) })),
      byCourse: (byCourse || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
      funnel: [
        { name: "Enquiries", value: enquiryCount },
        { name: "Leads", value: leads },
        { name: "Admissions", value: total },
        { name: "Approved", value: approved },
      ],
    },
    rows: (rows || []).map((row) => ({
      id: row.admissionId || String(row._id),
      admissionId: row.admissionId || "—",
      applicant: row.applicant || "—",
      course: row.course || "—",
      mode: row.mode || "—",
      status: row.status || "Pending",
      phone: row.phone || "—",
      counsellor: row.counsellor || "—",
      session: row.session || "—",
      date: formatDate(row.admissionDate || row.createdAt),
    })),
  };
}

async function examSnapshot(scope) {
  const match = {
    $or: [
      { examDate: { $gte: scope.filters.from, $lte: scope.filters.to } },
      { submittedAt: { $gte: scope.filters.from, $lte: scope.filters.to } },
    ],
  };
  if (scope.hasPeopleFilter && scope.studentIds.length) {
    match.studentId = { $in: scope.studentIds };
  } else if (scope.hasPeopleFilter && !scope.studentIds.length) {
    match._id = { $exists: false };
  }
  if (scope.courseName) match.courseName = scope.courseName;

  const [totals, byCourse, rows] = await Promise.all([
    ExamResult.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$result",
          count: { $sum: 1 },
          avg: { $avg: "$percentage" },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    ExamResult.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ["$courseName", "Unassigned"] },
          count: { $sum: 1 },
          passed: { $sum: { $cond: [{ $eq: ["$result", "PASS"] }, 1, 0] } },
          avg: { $avg: "$percentage" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    ExamResult.find(match)
      .select(
        "studentName studentCode admissionId examTitle courseName batchName result percentage obtainedMarks totalMarks examDate submittedAt"
      )
      .sort({ percentage: -1, submittedAt: -1 })
      .limit(ROW_LIMIT)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  const status = countBy(totals);
  const passed = status.PASS || 0;
  const failed = status.FAIL || 0;
  const total = passed + failed;
  const avg =
    (totals || []).reduce((s, row) => s + num(row.avg) * num(row.count), 0) / (total || 1);

  return {
    stats: {
      total,
      passed,
      failed,
      passRate: pct(passed, total),
      average: Math.round(avg * 10) / 10,
    },
    charts: {
      byResult: [
        { name: "Pass", value: passed },
        { name: "Fail", value: failed },
      ],
      byCourse: (byCourse || []).map((row) => ({
        name: row._id || "Unassigned",
        value: num(row.count),
        passed: num(row.passed),
        average: Math.round(num(row.avg) * 10) / 10,
      })),
    },
    rows: (rows || []).map((row) => ({
      id: String(row._id),
      student: row.studentName || "—",
      studentCode: row.studentCode || row.admissionId || "—",
      exam: row.examTitle || "—",
      course: row.courseName || "—",
      batch: row.batchName || "—",
      marks: `${num(row.obtainedMarks)}/${num(row.totalMarks)}`,
      obtained: num(row.obtainedMarks),
      totalMarks: num(row.totalMarks),
      percent: num(row.percentage),
      result: row.result || "FAIL",
      date: formatDate(row.examDate || row.submittedAt),
    })),
    toppers: (rows || []).filter((row) => row.result === "PASS").slice(0, 10).map((row) => ({
      id: String(row._id),
      student: row.studentName || "—",
      exam: row.examTitle || "—",
      course: row.courseName || "—",
      percent: num(row.percentage),
      marks: `${num(row.obtainedMarks)}/${num(row.totalMarks)}`,
    })),
  };
}

async function peopleSnapshot(scope) {
  const facultyMatch = { softDelete: false };
  const staffMatch = { softDelete: false, isArchived: { $ne: true } };
  const from = scope.filters.from;
  const to = scope.filters.to;

  const [facultyByStatus, facultyByDept, staffByStatus, staffByDept, staffByCategory, assignments, facultyRows, staffRows] =
    await Promise.all([
      Faculty.aggregate([
        { $match: facultyMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Faculty.aggregate([
        { $match: facultyMatch },
        { $group: { _id: { $ifNull: ["$employmentDetails.department", "Unassigned"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Staff.aggregate([
        { $match: staffMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Staff.aggregate([
        { $match: staffMatch },
        { $group: { _id: { $ifNull: ["$employmentDetails.department", "Unassigned"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Staff.aggregate([
        { $match: staffMatch },
        { $group: { _id: { $ifNull: ["$employmentDetails.staffCategory", "Unassigned"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).option({ maxTimeMS: QUERY_MS }),
      FacultyAssignment.aggregate([
        { $match: { softDelete: false, status: "Active" } },
        {
          $group: {
            _id: "$facultyMongoId",
            count: { $sum: 1 },
            subjects: { $addToSet: "$subjectName" },
            batches: { $addToSet: "$batchName" },
          },
        },
      ]).option({ maxTimeMS: QUERY_MS }),
      Faculty.find(facultyMatch)
        .select("facultyId personalDetails.fullName personalDetails.mobile employmentDetails status")
        .sort({ "personalDetails.fullName": 1 })
        .limit(ROW_LIMIT)
        .lean()
        .maxTimeMS(QUERY_MS),
      Staff.find(staffMatch)
        .select("staffId personalDetails.fullName personalDetails.mobile employmentDetails status")
        .sort({ "personalDetails.fullName": 1 })
        .limit(ROW_LIMIT)
        .lean()
        .maxTimeMS(QUERY_MS),
    ]);

  const assignMap = new Map(
    (assignments || []).map((row) => [String(row._id), row])
  );
  const facultyStatus = countBy(facultyByStatus);
  const staffStatus = countBy(staffByStatus);
  const facultyJoined = await Faculty.countDocuments({
    ...facultyMatch,
    "employmentDetails.joiningDate": { $gte: from, $lte: to },
  }).maxTimeMS(QUERY_MS);
  const staffJoined = await Staff.countDocuments({
    ...staffMatch,
    "employmentDetails.joiningDate": { $gte: from, $lte: to },
  }).maxTimeMS(QUERY_MS);

  const facultyList = (facultyRows || []).map((row) => {
    const load = assignMap.get(String(row._id));
    return {
      id: row.facultyId || String(row._id),
      code: row.facultyId || "—",
      name: row.personalDetails?.fullName || "—",
      mobile: row.personalDetails?.mobile || "—",
      designation: row.employmentDetails?.designation || "—",
      department: row.employmentDetails?.department || "—",
      type: row.employmentDetails?.employmentType || "—",
      assignments: num(load?.count),
      subjects: (load?.subjects || []).filter(Boolean).join(", ") || "—",
      status: row.status || "Active",
      joined: formatDate(row.employmentDetails?.joiningDate),
    };
  });

  return {
    stats: {
      faculty: Object.values(facultyStatus).reduce((s, n) => s + n, 0),
      facultyActive: facultyStatus.Active || 0,
      staff: Object.values(staffStatus).reduce((s, n) => s + n, 0),
      staffActive: staffStatus.Active || 0,
      facultyJoined,
      staffJoined,
      assignments: (assignments || []).reduce((s, row) => s + num(row.count), 0),
    },
    charts: {
      facultyByDept: (facultyByDept || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
      staffByDept: (staffByDept || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
      staffByCategory: (staffByCategory || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
    },
    facultyRows: facultyList,
    staffRows: (staffRows || []).map((row) => ({
      id: row.staffId || String(row._id),
      code: row.staffId || "—",
      name: row.personalDetails?.fullName || "—",
      mobile: row.personalDetails?.mobile || "—",
      designation: row.employmentDetails?.designation || "—",
      department: row.employmentDetails?.department || "—",
      category: row.employmentDetails?.staffCategory || "—",
      shift: row.employmentDetails?.shift || "—",
      type: row.employmentDetails?.employmentType || "—",
      status: row.status || "Active",
      joined: formatDate(row.employmentDetails?.joiningDate),
    })),
    rows: facultyList,
  };
}

async function buildOverview(scope) {
  const [students, fees, defaulters, attendance, admissions, exams, people] = await Promise.all([
    safe("overview-students", () => studentSnapshot(scope, { withRows: false }), {
      stats: { total: 0, active: 0, newInPeriod: 0, incomplete: 0 },
      charts: { byCourse: [] },
      rows: [],
    }),
    safe("overview-fees", () => feeSnapshot(scope, { withRows: false }), {
      stats: {
        collected: 0,
        collectedLabel: "₹0",
        pending: 0,
        pendingLabel: "₹0",
        overdue: 0,
        overdueLabel: "₹0",
        periodCollected: 0,
        periodCollectedLabel: "₹0",
        collectionRate: 0,
      },
      charts: { byStatus: [] },
      rows: [],
    }),
    safe("overview-defaulters", () => defaulterSnapshot(scope), { stats: { count: 0, dueLabel: "₹0" }, rows: [] }),
    safe("overview-attendance", () => attendanceSnapshot(scope), {
      stats: { percent: 0, below: 0, average: 0, students: 0 },
      rows: [],
    }),
    safe("overview-admissions", () => admissionSnapshot(scope), {
      stats: { total: 0, pending: 0, approved: 0, enquiries: 0, conversionRate: 0 },
      charts: { byStatus: [] },
      rows: [],
    }),
    safe("overview-exams", () => examSnapshot(scope), {
      stats: { total: 0, passed: 0, failed: 0, passRate: 0, average: 0 },
      rows: [],
    }),
    safe("overview-people", () => peopleSnapshot(scope), {
      stats: { facultyActive: 0, staffActive: 0 },
    }),
  ]);

  const collectionRate = num(fees.stats.collectionRate);
  const attendanceRate = num(attendance.stats.percent);
  const admissionRate = num(admissions.stats.conversionRate);
  const passRate = num(exams.stats.passRate);
  const parts = [
    [collectionRate, 0.35],
    [attendanceRate, 0.3],
    [admissionRate, 0.2],
    [passRate, 0.15],
  ];
  const weightSum = parts.reduce((s, [, w]) => s + w, 0);
  const score = Math.round(parts.reduce((s, [v, w]) => s + v * (w / weightSum), 0));

  return {
    stats: {
      students: students.stats.total,
      activeStudents: students.stats.active,
      newStudents: students.stats.newInPeriod,
      incompleteProfiles: students.stats.incomplete,
      admissions: admissions.stats.total,
      pendingAdmissions: admissions.stats.pending,
      approvedAdmissions: admissions.stats.approved,
      enquiries: admissions.stats.enquiries,
      conversionRate: admissions.stats.conversionRate,
      collectedLabel: fees.stats.periodCollectedLabel,
      pendingLabel: fees.stats.pendingLabel,
      overdueLabel: fees.stats.overdueLabel,
      collectionRate,
      attendancePercent: attendance.stats.percent,
      attendanceShortage: attendance.stats.below,
      examPassRate: exams.stats.passRate,
      examAverage: exams.stats.average,
      faculty: people.stats.facultyActive,
      staff: people.stats.staffActive,
      health: Math.max(0, Math.min(100, score)),
    },
    charts: {
      byCourse: students.charts.byCourse,
      feeStatus: fees.charts.byStatus,
      admissionStatus: admissions.charts.byStatus,
      examResult: [
        { name: "Pass", value: exams.stats.passed },
        { name: "Fail", value: exams.stats.failed },
      ],
    },
    lists: {
      defaulters: (defaulters.rows || []).slice(0, 8),
      shortage: (attendance.rows || []).filter((r) => r.status === "Shortage").slice(0, 8),
      pendingAdmissions: (admissions.rows || [])
        .filter((r) => r.status === "Pending" || r.status === "Verification")
        .slice(0, 8),
      toppers: (exams.toppers || []).slice(0, 8),
    },
    rows: [
      { id: "students", label: "Active students", value: String(students.stats.active) },
      { id: "admissions", label: "Admissions in period", value: String(admissions.stats.total) },
      { id: "fees", label: "Collected in period", value: fees.stats.periodCollectedLabel },
      { id: "pending", label: "Fee pending", value: fees.stats.pendingLabel },
      { id: "attendance", label: "Attendance %", value: `${attendance.stats.percent}%` },
      { id: "exams", label: "Exam pass rate", value: `${exams.stats.passRate}%` },
    ],
  };
}

function wrap(type, title, description, filters, payload) {
  return {
    type,
    title,
    description,
    generatedAt: new Date().toISOString(),
    filters: {
      from: filters.fromKey,
      to: filters.toKey,
      universityId: filters.universityId ? String(filters.universityId) : "",
      courseId: filters.courseId ? String(filters.courseId) : "",
      batchId: filters.batchId ? String(filters.batchId) : "",
      session: filters.session,
      threshold: filters.threshold,
      shortageOnly: filters.shortageOnly,
    },
    ...payload,
  };
}

export async function getReport(type, query = {}) {
  const reportType = REPORT_TYPES.includes(String(type || "").toLowerCase())
    ? String(type).toLowerCase()
    : "overview";
  const filters = parseFilters(query);
  const scope = await resolveScope(filters);

  if (reportType === "students") {
    const data = await studentSnapshot(scope);
    return wrap(reportType, "Student Strength", "Current roster by course, status, category and documents.", filters, data);
  }
  if (reportType === "admissions") {
    const data = await admissionSnapshot(scope);
    return wrap(reportType, "Admissions & Conversion", "Enquiry → lead → admission funnel for the selected period.", filters, data);
  }
  if (reportType === "fees") {
    const data = await feeSnapshot(scope);
    return wrap(reportType, "Fee Collection", "Current balances plus payments collected in the selected period.", filters, data);
  }
  if (reportType === "defaulters") {
    const data = await defaulterSnapshot(scope);
    return wrap(reportType, "Fee Defaulters", "Students with outstanding dues, highest due first.", filters, data);
  }
  if (reportType === "attendance") {
    const data = await attendanceSnapshot(scope);
    return wrap(reportType, "Attendance & Shortage", `Present % for the selected dates. Shortage is below ${filters.threshold}%.`, filters, data);
  }
  if (reportType === "exams") {
    const data = await examSnapshot(scope);
    return wrap(reportType, "Exam Results", "Pass, fail and toppers for exams in the selected period.", filters, data);
  }
  if (reportType === "people") {
    const data = await peopleSnapshot(scope);
    return wrap(reportType, "Faculty & Staff", "Headcount, departments and faculty teaching load.", filters, data);
  }

  const data = await buildOverview(scope);
  return wrap(
    "overview",
    "Monthly Institute Report",
    "Owner snapshot: strength, collection, attendance, admissions and exams.",
    filters,
    data
  );
}
