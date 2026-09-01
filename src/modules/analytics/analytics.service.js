import mongoose from "mongoose";
import { Admission } from "../../models/Admission.js";
import { Attendance, COUNT_LATE_AS_PRESENT } from "../attendance/attendance.model.js";
import { Course } from "../courses/courses.model.js";
import { Enquiry } from "../enquiries/enquiries.model.js";
import { ExamResult } from "../exams/examResult.model.js";
import { StudentFee } from "../fees/fees.model.js";
import { Lead } from "../leads/leads.model.js";
import { Student } from "../students/students.model.js";

const QUERY_MS = 12000;
const TZ = "Asia/Kolkata";

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

function deltaPct(curr, prev) {
  if (!prev) return curr ? 100 : 0;
  return Math.round(((num(curr) - num(prev)) / Math.abs(num(prev))) * 1000) / 10;
}

function formatINR(amount) {
  return `₹${num(amount).toLocaleString("en-IN")}`;
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
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to.getFullYear(), to.getMonth() - 5, 1, 0, 0, 0, 0);
  return { from, to };
}

function parseFilters(query = {}) {
  const fallback = defaultRange();
  const from = dayStart(query.from) || fallback.from;
  const to = dayEnd(query.to) || fallback.to;
  const safeFrom = from > to ? fallback.from : from;
  const safeTo = from > to ? fallback.to : to;
  return {
    from: safeFrom,
    to: safeTo,
    fromKey: isoDate(safeFrom),
    toKey: isoDate(safeTo),
    universityId: asOid(query.universityId),
    courseId: asOid(query.courseId),
    batchId: asOid(query.batchId),
    session: str(query.session),
  };
}

function previousWindow(from, to) {
  const duration = Math.max(1, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return { from: prevFrom, to: prevTo };
}

function monthsInRange(from, to) {
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    out.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      name: cursor.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function monthKeyExpr(field) {
  return { $dateToString: { format: "%Y-%m", date: `$${field}`, timezone: TZ } };
}

function countBy(docs, key = "_id") {
  const map = {};
  for (const row of docs || []) {
    const id = row[key] == null || row[key] === "" ? "Unknown" : String(row[key]);
    map[id] = num(row.count);
  }
  return map;
}

function mapCount(docs) {
  const map = {};
  for (const row of docs || []) {
    map[String(row._id || "Unknown")] = num(row.count ?? row.amount ?? row.value);
  }
  return map;
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`analytics ${label}:`, err?.message || err);
    return fallback;
  }
}

function periodOr(from, to, fields) {
  return { $or: fields.map((field) => ({ [field]: { $gte: from, $lte: to } })) };
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
    const course = await Course.findById(filters.courseId).select("name code").lean().maxTimeMS(QUERY_MS);
    courseName = course?.name || "";
    courseCode = course?.code || "";
  }

  let studentIds = [];
  let admissionMongoIds = [];
  let admissionIds = [];
  if (hasPeopleFilter) {
    const students = await Student.find(match).select("_id admissionMongoId admissionId").lean().maxTimeMS(QUERY_MS);
    studentIds = students.map((s) => s._id);
    admissionMongoIds = students.map((s) => s.admissionMongoId).filter(Boolean);
    admissionIds = students.map((s) => s.admissionId).filter(Boolean);
  }

  return { filters, match, hasPeopleFilter, studentIds, admissionMongoIds, admissionIds, courseName, courseCode };
}

function feeAccountMatch(scope) {
  if (!scope.hasPeopleFilter) return {};
  const or = [];
  if (scope.admissionMongoIds.length) or.push({ admissionMongoId: { $in: scope.admissionMongoIds } });
  if (scope.admissionIds.length) or.push({ admissionId: { $in: scope.admissionIds } });
  if (scope.filters.courseId) {
    or.push({ courseId: scope.filters.courseId });
    if (scope.courseName) or.push({ course: scope.courseName });
    if (scope.courseCode) or.push({ courseCode: scope.courseCode });
  }
  if (!or.length) return { _id: { $exists: false } };
  return { $or: or };
}

function admissionMatch(scope, from, to) {
  const match = { ...periodOr(from, to, ["admissionDate", "createdAt"]) };
  if (scope.filters.universityId) match.universityId = scope.filters.universityId;
  if (scope.filters.session) match.session = scope.filters.session;
  if (scope.filters.courseId) {
    const or = [{ courseId: scope.filters.courseId }];
    if (scope.courseName) or.push({ course: scope.courseName });
    match.$and = [{ $or: or }];
  }
  return match;
}

function attendanceMatch(scope, from, to) {
  const match = { date: { $gte: from, $lte: to } };
  if (scope.filters.universityId) match.universityId = scope.filters.universityId;
  if (scope.filters.courseId) match.courseId = scope.filters.courseId;
  if (scope.filters.batchId) match.batchId = scope.filters.batchId;
  return match;
}

function examMatch(scope, from, to) {
  const match = {
    $or: [{ examDate: { $gte: from, $lte: to } }, { submittedAt: { $gte: from, $lte: to } }],
  };
  if (scope.hasPeopleFilter && scope.studentIds.length) match.studentId = { $in: scope.studentIds };
  else if (scope.hasPeopleFilter && !scope.studentIds.length) match._id = { $exists: false };
  if (scope.courseName) match.courseName = scope.courseName;
  return match;
}

function metric(value, prev, extra = {}) {
  return {
    value: num(value),
    prev: num(prev),
    delta: deltaPct(value, prev),
    ...extra,
  };
}

async function studentMix(scope) {
  const match = scope.hasPeopleFilter ? scope.match : {};
  const [byStatus, byGender, byCategory, byCourse, newCurr, newPrev] = await Promise.all([
    Student.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
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
      {
        $project: {
          label: {
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
          },
        },
      },
      { $group: { _id: "$label", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.countDocuments({
      ...match,
      ...periodOr(scope.filters.from, scope.filters.to, ["admissionDate", "createdAt"]),
    }).maxTimeMS(QUERY_MS),
    Student.countDocuments({
      ...match,
      ...periodOr(scope.prev.from, scope.prev.to, ["admissionDate", "createdAt"]),
    }).maxTimeMS(QUERY_MS),
  ]);

  const status = countBy(byStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  return {
    total,
    active: status.Active || 0,
    newStudents: metric(newCurr, newPrev),
    byStatus: Object.entries(status).map(([name, value]) => ({ name, value })),
    byGender: (byGender || []).map((row) => ({ name: row._id || "Unspecified", value: num(row.count) })),
    byCategory: (byCategory || []).map((row) => ({ name: row._id || "Unspecified", value: num(row.count) })),
    byCourse: (byCourse || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
  };
}

async function admissionTrends(scope, months) {
  const currMatch = admissionMatch(scope, scope.filters.from, scope.filters.to);
  const prevMatch = admissionMatch(scope, scope.prev.from, scope.prev.to);
  const [currStatus, prevCount, byMode, byCourse, monthly, enquiryCurr, enquiryPrev, enquiryMonthly, enquirySources, leadStatus] =
    await Promise.all([
      Admission.aggregate([{ $match: currMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]).option({
        maxTimeMS: QUERY_MS,
      }),
      Admission.countDocuments(prevMatch).maxTimeMS(QUERY_MS),
      Admission.aggregate([{ $match: currMatch }, { $group: { _id: "$mode", count: { $sum: 1 } } }]).option({
        maxTimeMS: QUERY_MS,
      }),
      Admission.aggregate([
        { $match: currMatch },
        { $group: { _id: { $ifNull: ["$course", "Unassigned"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).option({ maxTimeMS: QUERY_MS }),
      Admission.aggregate([
        { $match: currMatch },
        {
          $project: {
            month: { $ifNull: [monthKeyExpr("admissionDate"), monthKeyExpr("createdAt")] },
          },
        },
        { $group: { _id: "$month", count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Enquiry.countDocuments({ submittedAt: { $gte: scope.filters.from, $lte: scope.filters.to } }).maxTimeMS(QUERY_MS),
      Enquiry.countDocuments({ submittedAt: { $gte: scope.prev.from, $lte: scope.prev.to } }).maxTimeMS(QUERY_MS),
      Enquiry.aggregate([
        { $match: { submittedAt: { $gte: scope.filters.from, $lte: scope.filters.to } } },
        { $group: { _id: monthKeyExpr("submittedAt"), count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Enquiry.aggregate([
        { $match: { submittedAt: { $gte: scope.filters.from, $lte: scope.filters.to } } },
        { $group: { _id: { $ifNull: ["$heardAbout", "Unknown"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]).option({ maxTimeMS: QUERY_MS }),
      Lead.aggregate([
        { $match: { createdAt: { $gte: scope.filters.from, $lte: scope.filters.to } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
    ]);

  const status = countBy(currStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  const approved = status.Approved || 0;
  const leadMap = countBy(leadStatus);
  const leads = Object.values(leadMap).reduce((s, n) => s + n, 0);
  const admissionMonth = mapCount(monthly);
  const enquiryMonth = mapCount(enquiryMonthly);

  return {
    total,
    approved,
    pending: (status.Pending || 0) + (status.Verification || 0),
    admissions: metric(total, prevCount),
    enquiries: metric(enquiryCurr, enquiryPrev),
    conversionRate: pct(approved, enquiryCurr || total),
    byStatus: ["Pending", "Verification", "Approved", "Rejected", "Cancelled"]
      .filter((name) => status[name] || name === "Pending" || name === "Approved")
      .map((name) => ({ name, value: status[name] || 0 })),
    byMode: (byMode || []).map((row) => ({ name: row._id || "Unknown", value: num(row.count) })),
    byCourse: (byCourse || []).map((row) => ({ name: row._id || "Unassigned", value: num(row.count) })),
    sources: (enquirySources || []).map((row) => ({ name: row._id || "Unknown", value: num(row.count) })),
    leads: ["New", "Contacted", "Qualified", "Converted", "Lost"].map((name) => ({
      name,
      value: leadMap[name] || 0,
    })),
    funnel: [
      { name: "Enquiries", value: enquiryCurr },
      { name: "Leads", value: leads },
      { name: "Admissions", value: total },
      { name: "Approved", value: approved },
    ],
    monthly: months.map((m) => ({
      name: m.name,
      admissions: num(admissionMonth[m.key]),
      enquiries: num(enquiryMonth[m.key]),
    })),
  };
}

async function feeTrends(scope, months) {
  const accountMatch = feeAccountMatch(scope);
  const payCurr = {
    "payments.date": { $gte: scope.filters.from, $lte: scope.filters.to },
    "payments.amount": { $gt: 0 },
    "payments.status": { $nin: ["Refunded", "Failed", "Cancelled"] },
  };
  const payPrev = {
    "payments.date": { $gte: scope.prev.from, $lte: scope.prev.to },
    "payments.amount": { $gt: 0 },
    "payments.status": { $nin: ["Refunded", "Failed", "Cancelled"] },
  };

  const [totals, byCourse, byMethod, monthly, prevCollected] = await Promise.all([
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
        },
      },
      { $sort: { collected: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $match: accountMatch },
      { $unwind: "$payments" },
      { $match: payCurr },
      {
        $group: {
          _id: { $ifNull: ["$payments.method", { $ifNull: ["$payments.mode", "Unknown"] }] },
          amount: { $sum: "$payments.amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $match: accountMatch },
      { $unwind: "$payments" },
      { $match: payCurr },
      { $group: { _id: monthKeyExpr("payments.date"), amount: { $sum: "$payments.amount" } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $match: accountMatch },
      { $unwind: "$payments" },
      { $match: payPrev },
      { $group: { _id: null, amount: { $sum: "$payments.amount" } } },
    ]).option({ maxTimeMS: QUERY_MS }),
  ]);

  let collected = 0;
  let pending = 0;
  let billed = 0;
  let overdue = 0;
  const byStatus = { Paid: 0, Partial: 0, Pending: 0, Overdue: 0 };
  for (const row of totals || []) {
    collected += num(row.collected);
    pending += num(row.pending);
    billed += num(row.billed);
    if (row._id === "Overdue") overdue += num(row.pending);
    if (byStatus[row._id] != null) byStatus[row._id] = num(row.count);
  }

  const periodCollected = (byMethod || []).reduce((s, row) => s + num(row.amount), 0);
  const monthMap = {};
  for (const row of monthly || []) monthMap[row._id] = num(row.amount);

  return {
    collected,
    pending,
    billed,
    overdue,
    collectionRate: pct(collected, billed || collected + pending),
    periodCollected: metric(periodCollected, prevCollected?.[0]?.amount, {
      label: formatINR(periodCollected),
      prevLabel: formatINR(prevCollected?.[0]?.amount),
    }),
    pendingLabel: formatINR(pending),
    overdueLabel: formatINR(overdue),
    collectedLabel: formatINR(collected),
    byStatus: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
    byCourse: (byCourse || []).map((row) => ({
      name: row._id || "Unassigned",
      collected: num(row.collected),
      pending: num(row.pending),
      value: num(row.collected),
    })),
    byMethod: (byMethod || []).map((row) => ({ name: row._id || "Unknown", value: num(row.amount) })),
    monthly: months.map((m) => ({
      name: m.name,
      collected: num(monthMap[m.key]),
      collectedLakhs: Math.round((num(monthMap[m.key]) / 100000) * 100) / 100,
    })),
  };
}

async function attendanceTrends(scope) {
  const currMatch = attendanceMatch(scope, scope.filters.from, scope.filters.to);
  const prevMatch = attendanceMatch(scope, scope.prev.from, scope.prev.to);
  const daySpan = Math.ceil((scope.filters.to - scope.filters.from) / 86400000) + 1;
  const bucket = daySpan > 45 ? "week" : "day";
  const format = bucket === "week" ? "%G-W%V" : "%Y-%m-%d";

  const [currStatus, prevStatus, byCourse, buckets] = await Promise.all([
    Attendance.aggregate([{ $match: currMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
    Attendance.aggregate([{ $match: prevMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
    Attendance.aggregate([
      { $match: currMatch },
      {
        $group: {
          _id: { $ifNull: ["$courseName", "Unassigned"] },
          present: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ["$status", "Late"] }, 1, 0] } },
          marked: { $sum: 1 },
        },
      },
      { $sort: { marked: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    Attendance.aggregate([
      { $match: currMatch },
      {
        $group: {
          _id: { $dateToString: { format, date: "$date", timezone: TZ } },
          present: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ["$status", "Late"] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
          marked: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
  ]);

  const rateOf = (rows) => {
    const map = countBy(rows);
    const present = map.Present || 0;
    const late = map.Late || 0;
    const total = Object.values(map).reduce((s, n) => s + n, 0);
    const presentLike = COUNT_LATE_AS_PRESENT ? present + late : present;
    return { percent: pct(presentLike, total), present, late, absent: map.Absent || 0, marked: total };
  };

  const curr = rateOf(currStatus);
  const prev = rateOf(prevStatus);

  return {
    ...curr,
    rate: metric(curr.percent, prev.percent),
    byStatus: [
      { name: "Present", value: curr.present },
      { name: "Absent", value: curr.absent },
      { name: "Late", value: curr.late },
    ].filter((row) => row.value > 0),
    byCourse: (byCourse || []).map((row) => {
      const presentLike = COUNT_LATE_AS_PRESENT ? num(row.present) + num(row.late) : num(row.present);
      return { name: row._id || "Unassigned", value: pct(presentLike, row.marked), marked: num(row.marked) };
    }),
    trend: (buckets || []).map((row) => {
      const presentLike = COUNT_LATE_AS_PRESENT ? num(row.present) + num(row.late) : num(row.present);
      const id = String(row._id || "");
      let name = id;
      if (bucket === "day" && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
        const [, m, d] = id.split("-");
        name = `${d}/${m}`;
      }
      return {
        name,
        percent: pct(presentLike, row.marked),
        present: num(row.present),
        absent: num(row.absent),
        marked: num(row.marked),
      };
    }),
    bucket,
  };
}

async function examTrends(scope, months) {
  const currMatch = examMatch(scope, scope.filters.from, scope.filters.to);
  const prevMatch = examMatch(scope, scope.prev.from, scope.prev.to);
  const [curr, prev, byCourse, monthly] = await Promise.all([
    ExamResult.aggregate([
      { $match: currMatch },
      { $group: { _id: "$result", count: { $sum: 1 }, avg: { $avg: "$percentage" } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    ExamResult.aggregate([
      { $match: prevMatch },
      { $group: { _id: "$result", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    ExamResult.aggregate([
      { $match: currMatch },
      {
        $group: {
          _id: { $ifNull: ["$courseName", "Unassigned"] },
          passed: { $sum: { $cond: [{ $eq: ["$result", "PASS"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$result", "FAIL"] }, 1, 0] } },
          avg: { $avg: "$percentage" },
        },
      },
      { $sort: { passed: -1 } },
      { $limit: 10 },
    ]).option({ maxTimeMS: QUERY_MS }),
    ExamResult.aggregate([
      { $match: currMatch },
      {
        $project: {
          month: { $ifNull: [monthKeyExpr("examDate"), monthKeyExpr("submittedAt")] },
          result: 1,
          percentage: 1,
        },
      },
      {
        $group: {
          _id: "$month",
          passed: { $sum: { $cond: [{ $eq: ["$result", "PASS"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$result", "FAIL"] }, 1, 0] } },
          avg: { $avg: "$percentage" },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
  ]);

  const currMap = countBy(curr);
  const prevMap = countBy(prev);
  const passed = currMap.PASS || 0;
  const failed = currMap.FAIL || 0;
  const total = passed + failed;
  const prevTotal = (prevMap.PASS || 0) + (prevMap.FAIL || 0);
  const avg = total
    ? Math.round(((curr || []).reduce((s, row) => s + num(row.avg) * num(row.count), 0) / total) * 10) / 10
    : 0;
  const monthMap = {};
  for (const row of monthly || []) {
    monthMap[row._id] = {
      passed: num(row.passed),
      failed: num(row.failed),
      avg: Math.round(num(row.avg) * 10) / 10,
    };
  }

  return {
    total,
    passed,
    failed,
    average: avg,
    passRate: metric(pct(passed, total), pct(prevMap.PASS || 0, prevTotal)),
    byResult: [
      { name: "Pass", value: passed },
      { name: "Fail", value: failed },
    ],
    byCourse: (byCourse || []).map((row) => ({
      name: row._id || "Unassigned",
      passed: num(row.passed),
      failed: num(row.failed),
      average: Math.round(num(row.avg) * 10) / 10,
    })),
    monthly: months.map((m) => ({
      name: m.name,
      passed: num(monthMap[m.key]?.passed),
      failed: num(monthMap[m.key]?.failed),
      average: num(monthMap[m.key]?.avg),
    })),
  };
}

function buildInsights({ students, admissions, fees, attendance, exams }) {
  const out = [];
  const topCourse = students.byCourse?.[0];
  if (topCourse?.value) {
    out.push({
      tone: "info",
      title: "Highest enrolment",
      text: `${topCourse.name} has ${topCourse.value} students — the largest course in this filter.`,
    });
  }
  if (fees.collectionRate < 70) {
    out.push({
      tone: "warn",
      title: "Collection below 70%",
      text: `Overall collection is ${fees.collectionRate}%. ${fees.overdueLabel} is overdue.`,
    });
  } else {
    out.push({
      tone: "good",
      title: "Fee collection",
      text: `Collection rate is ${fees.collectionRate}% (${fees.collectedLabel} received, ${fees.pendingLabel} pending).`,
    });
  }
  if (attendance.rate.delta < -5) {
    out.push({
      tone: "warn",
      title: "Attendance dipped",
      text: `Attendance is ${attendance.percent}% — ${Math.abs(attendance.rate.delta)} points lower than the previous period.`,
    });
  } else {
    out.push({
      tone: "info",
      title: "Attendance",
      text: `Marked attendance is ${attendance.percent}% across ${attendance.marked} records in this period.`,
    });
  }
  if (admissions.enquiries.value && admissions.conversionRate < 25) {
    out.push({
      tone: "warn",
      title: "Low conversion",
      text: `Only ${admissions.conversionRate}% of enquiries became approved admissions.`,
    });
  } else if (admissions.admissions.delta > 0) {
    out.push({
      tone: "good",
      title: "Admissions up",
      text: `${admissions.total} admissions this period, ${admissions.admissions.delta}% vs previous window.`,
    });
  }
  if (exams.total) {
    out.push({
      tone: exams.passRate.value >= 60 ? "good" : "warn",
      title: "Exam pass rate",
      text: `${exams.passRate.value}% passed (${exams.passed} / ${exams.total}), average score ${exams.average}%.`,
    });
  }
  if (fees.periodCollected.delta < -10) {
    out.push({
      tone: "warn",
      title: "Collections slower",
      text: `Receipts this period are ${fees.periodCollected.label}, ${Math.abs(fees.periodCollected.delta)}% below the last window.`,
    });
  }
  return out.slice(0, 6);
}

export async function getAnalyticsOverview(query = {}) {
  const filters = parseFilters(query);
  const prev = previousWindow(filters.from, filters.to);
  const months = monthsInRange(filters.from, filters.to);
  const scope = { ...(await resolveScope(filters)), prev };

  const [students, admissions, fees, attendance, exams] = await Promise.all([
    safe("students", () => studentMix(scope), {
      total: 0,
      active: 0,
      newStudents: metric(0, 0),
      byStatus: [],
      byGender: [],
      byCategory: [],
      byCourse: [],
    }),
    safe("admissions", () => admissionTrends(scope, months), {
      total: 0,
      approved: 0,
      pending: 0,
      admissions: metric(0, 0),
      enquiries: metric(0, 0),
      conversionRate: 0,
      byStatus: [],
      byMode: [],
      byCourse: [],
      sources: [],
      leads: [],
      funnel: [],
      monthly: months.map((m) => ({ name: m.name, admissions: 0, enquiries: 0 })),
    }),
    safe("fees", () => feeTrends(scope, months), {
      collected: 0,
      pending: 0,
      collectionRate: 0,
      periodCollected: metric(0, 0, { label: "₹0", prevLabel: "₹0" }),
      pendingLabel: "₹0",
      overdueLabel: "₹0",
      collectedLabel: "₹0",
      byStatus: [],
      byCourse: [],
      byMethod: [],
      monthly: months.map((m) => ({ name: m.name, collected: 0, collectedLakhs: 0 })),
    }),
    safe("attendance", () => attendanceTrends(scope), {
      percent: 0,
      marked: 0,
      rate: metric(0, 0),
      byStatus: [],
      byCourse: [],
      trend: [],
      bucket: "day",
    }),
    safe("exams", () => examTrends(scope, months), {
      total: 0,
      passed: 0,
      failed: 0,
      average: 0,
      passRate: metric(0, 0),
      byResult: [],
      byCourse: [],
      monthly: months.map((m) => ({ name: m.name, passed: 0, failed: 0, average: 0 })),
    }),
  ]);

  const monthly = months.map((m, i) => ({
    name: m.name,
    admissions: admissions.monthly[i]?.admissions || 0,
    enquiries: admissions.monthly[i]?.enquiries || 0,
    collected: fees.monthly[i]?.collected || 0,
    collectedLakhs: fees.monthly[i]?.collectedLakhs || 0,
    passed: exams.monthly[i]?.passed || 0,
    failed: exams.monthly[i]?.failed || 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    title: "Institute analytics",
    description: "Trends and period-over-period comparison. Open Reports for printable tables.",
    filters: {
      from: filters.fromKey,
      to: filters.toKey,
      universityId: filters.universityId ? String(filters.universityId) : "",
      courseId: filters.courseId ? String(filters.courseId) : "",
      batchId: filters.batchId ? String(filters.batchId) : "",
      session: filters.session,
      previousFrom: isoDate(prev.from),
      previousTo: isoDate(prev.to),
    },
    kpis: {
      activeStudents: { value: students.active, total: students.total },
      newStudents: students.newStudents,
      admissions: admissions.admissions,
      enquiries: admissions.enquiries,
      conversionRate: { value: admissions.conversionRate },
      collected: fees.periodCollected,
      pending: { value: fees.pending, label: fees.pendingLabel },
      collectionRate: { value: fees.collectionRate },
      attendance: attendance.rate,
      passRate: exams.passRate,
      examAverage: { value: exams.average },
    },
    insights: buildInsights({ students, admissions, fees, attendance, exams }),
    charts: {
      monthly,
      attendance: attendance.trend,
      studentsByCourse: students.byCourse,
      studentsByGender: students.byGender,
      studentsByCategory: students.byCategory,
      studentsByStatus: students.byStatus,
      feeStatus: fees.byStatus,
      feeByCourse: fees.byCourse,
      paymentMethods: fees.byMethod,
      feeMonthly: fees.monthly,
      admissionStatus: admissions.byStatus,
      admissionMode: admissions.byMode,
      admissionCourse: admissions.byCourse,
      enquirySources: admissions.sources,
      leadPipeline: admissions.leads,
      funnel: admissions.funnel,
      attendanceByCourse: attendance.byCourse,
      attendanceStatus: attendance.byStatus,
      examResults: exams.byResult,
      examByCourse: exams.byCourse,
      examMonthly: exams.monthly,
    },
  };
}
