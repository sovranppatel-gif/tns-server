import { Admission } from "../../models/Admission.js";
import { ActivityLog } from "../activityLog/activityLog.model.js";
import { Attendance, COUNT_LATE_AS_PRESENT } from "../attendance/attendance.model.js";
import { getAttendanceOverview } from "../attendance/attendance.service.js";
import { Batch } from "../batches/batches.model.js";
import { Course } from "../courses/courses.model.js";
import { Enquiry } from "../enquiries/enquiries.model.js";
import { getExamOverview } from "../exams/examResult.service.js";
import { ExamSchedule } from "../exams/examSchedule.model.js";
import { StudentFee } from "../fees/fees.model.js";
import { Lead } from "../leads/leads.model.js";
import { Student } from "../students/students.model.js";
import { SupportTicket } from "../support/supportTicket.model.js";
import { University } from "../universities/universities.model.js";

const TZ = "Asia/Kolkata";
const QUERY_MS = 8000;

function formatINR(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
}

function monthStart(base = new Date()) {
  const d = new Date(base);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function lastNMonths(n = 6) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      key,
      name: d.toLocaleDateString("en-IN", { month: "short" }),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    });
  }
  return out;
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`dashboard ${label}:`, err?.message || err);
    return fallback;
  }
}

function countBy(docs, key = "_id") {
  const map = {};
  for (const row of docs || []) {
    const id = row[key] == null || row[key] === "" ? "Unknown" : String(row[key]);
    map[id] = Number(row.count) || 0;
  }
  return map;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((Number(part) / Number(total)) * 1000) / 10;
}

function gradeFromScore(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B+";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
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

function formatDateTime(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKeyExpr(field) {
  return {
    $dateToString: { format: "%Y-%m", date: `$${field}`, timezone: TZ },
  };
}

async function studentCounts() {
  const start = monthStart();
  const [byStatus, newThisMonth, byGender, byCourse] = await Promise.all([
    Student.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
    Student.countDocuments({
      $or: [{ admissionDate: { $gte: start } }, { createdAt: { $gte: start } }],
    }).maxTimeMS(QUERY_MS),
    Student.aggregate([
      { $group: { _id: { $ifNull: ["$gender", "Unspecified"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Student.aggregate([
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
                  {
                    $cond: [{ $gt: [{ $strLenCP: "$$code" }, 0] }, "$$code", "Unassigned"],
                  },
                ],
              },
            },
          },
        },
      },
      { $group: { _id: "$label", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]).option({ maxTimeMS: QUERY_MS }),
  ]);

  const status = countBy(byStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  return {
    total,
    active: status.Active || 0,
    completed: status.Completed || 0,
    inactive:
      (status.Inactive || 0) +
      (status.Dropped || 0) +
      (status.Cancelled || 0) +
      (status.Suspended || 0),
    newThisMonth,
    byGender: (byGender || []).map((row) => ({
      name: row._id || "Unspecified",
      value: Number(row.count) || 0,
    })),
    byCourse: (byCourse || []).map((row) => ({
      name: row._id || "Unassigned",
      value: Number(row.count) || 0,
    })),
  };
}

async function admissionCounts() {
  const start = monthStart();
  const months = lastNMonths(6);
  const from = new Date(months[0].year, months[0].month - 1, 1);

  const [byStatus, byMode, thisMonth, monthly, recent] = await Promise.all([
    Admission.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
    Admission.aggregate([{ $group: { _id: "$mode", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
    Admission.countDocuments({
      $or: [{ admissionDate: { $gte: start } }, { createdAt: { $gte: start } }],
    }).maxTimeMS(QUERY_MS),
    Admission.aggregate([
      {
        $match: {
          $or: [{ admissionDate: { $gte: from } }, { createdAt: { $gte: from } }],
        },
      },
      {
        $project: {
          month: monthKeyExpr("admissionDate"),
          createdMonth: monthKeyExpr("createdAt"),
          admissionDate: 1,
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$month", "$createdMonth"] },
          count: { $sum: 1 },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    Admission.find({})
      .select("admissionId applicant course status mode admissionDate createdAt phone")
      .sort({ createdAt: -1, admissionDate: -1 })
      .limit(8)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  const status = countBy(byStatus);
  const total = Object.values(status).reduce((s, n) => s + n, 0);
  const monthMap = countBy(monthly);
  return {
    total,
    pending: status.Pending || 0,
    verification: status.Verification || 0,
    approved: status.Approved || 0,
    rejected: status.Rejected || 0,
    cancelled: status.Cancelled || 0,
    thisMonth,
    online: (byMode || []).reduce(
      (s, row) => s + (String(row._id || "").toLowerCase() === "online" ? Number(row.count) || 0 : 0),
      0
    ),
    byStatus: ["Pending", "Verification", "Approved", "Rejected", "Cancelled"]
      .filter((name) => status[name] || name === "Pending" || name === "Approved")
      .map((name) => ({ name, value: status[name] || 0 })),
    byMode: (byMode || []).map((row) => ({
      name: row._id || "Unknown",
      value: Number(row.count) || 0,
    })),
    trend: months.map((m) => ({ name: m.name, admissions: monthMap[m.key] || 0 })),
    recent: (recent || []).map((row) => ({
      id: row.admissionId || String(row._id),
      _id: String(row._id),
      applicant: row.applicant || "—",
      course: row.course || "—",
      status: row.status || "Pending",
      mode: row.mode || "—",
      phone: row.phone || "",
      date: formatDateLabel(row.admissionDate || row.createdAt),
    })),
  };
}

async function feeCounts() {
  const months = lastNMonths(6);
  const from = new Date(months[0].year, months[0].month - 1, 1);

  const [totals, monthly, overdueRows] = await Promise.all([
    StudentFee.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
          pending: { $sum: { $ifNull: ["$dueAmount", 0] } },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.aggregate([
      { $unwind: "$payments" },
      {
        $match: {
          "payments.date": { $gte: from },
          "payments.amount": { $gt: 0 },
          "payments.status": { $nin: ["Refunded", "Failed", "Cancelled"] },
        },
      },
      { $group: { _id: monthKeyExpr("payments.date"), collected: { $sum: "$payments.amount" } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    StudentFee.find({ status: { $in: ["Overdue", "Pending", "Partial"] }, dueAmount: { $gt: 0 } })
      .select("feeId student course status dueAmount nextDueDate paidAmount totalAmount")
      .sort({ nextDueDate: 1, dueAmount: -1 })
      .limit(8)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  let collected = 0;
  let pending = 0;
  let overdue = 0;
  let paidCount = 0;
  let total = 0;
  const byStatus = { Paid: 0, Partial: 0, Pending: 0, Overdue: 0 };
  for (const row of totals || []) {
    const status = row._id || "Pending";
    const count = Number(row.count) || 0;
    total += count;
    collected += Number(row.collected) || 0;
    pending += Number(row.pending) || 0;
    if (status === "Overdue") overdue += Number(row.pending) || 0;
    if (status === "Paid") paidCount += count;
    if (byStatus[status] != null) byStatus[status] = count;
  }

  const monthMap = {};
  for (const row of monthly || []) {
    monthMap[row._id] = Number(row.collected) || 0;
  }

  return {
    total,
    collected,
    collectedLabel: formatINR(collected),
    pending,
    pendingLabel: formatINR(pending),
    overdue,
    overdueLabel: formatINR(overdue),
    paidCount,
    collectionRate: pct(collected, collected + pending),
    byStatus: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
    trend: months.map((m) => ({
      name: m.name,
      collected: monthMap[m.key] || 0,
      collectedLakhs: Math.round(((monthMap[m.key] || 0) / 100000) * 100) / 100,
    })),
    dues: (overdueRows || []).map((row) => ({
      id: row.feeId || String(row._id),
      student: row.student || "—",
      course: row.course || "—",
      status: row.status || "Pending",
      due: formatINR(row.dueAmount),
      dueRaw: Number(row.dueAmount) || 0,
      date: formatDateLabel(row.nextDueDate),
    })),
  };
}

async function attendanceWeek() {
  const start = daysAgo(6);
  const studentCount = await Student.countDocuments({ status: "Active" }).maxTimeMS(QUERY_MS);
  const marks = await Attendance.find({ date: { $gte: start } })
    .select("date status studentId admissionMongoId")
    .lean()
    .maxTimeMS(QUERY_MS);

  const byDay = new Map();
  for (let i = 6; i >= 0; i -= 1) {
    const d = daysAgo(i);
    const key = localDateKey(d);
    byDay.set(key, {
      name: d.toLocaleDateString("en-IN", { weekday: "short" }),
      date: key,
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
      marked: 0,
      unique: new Set(),
    });
  }

  for (const mark of marks || []) {
    const d = mark.date ? new Date(mark.date) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = localDateKey(d);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    const person = String(mark.studentId || mark.admissionMongoId || "");
    if (person) {
      if (bucket.unique.has(person)) continue;
      bucket.unique.add(person);
    }
    bucket.marked += 1;
    const status = String(mark.status || "").toLowerCase();
    if (status === "present") bucket.present += 1;
    else if (status === "absent") bucket.absent += 1;
    else if (status === "late") bucket.late += 1;
    else if (status === "leave" || status === "holiday") bucket.leave += 1;
  }

  return [...byDay.values()].map((row) => {
    const presentLike = COUNT_LATE_AS_PRESENT ? row.present + row.late : row.present;
    const denom = studentCount > 0 ? studentCount : row.marked;
    return {
      name: row.name,
      date: row.date,
      present: row.present,
      absent: row.absent,
      late: row.late,
      leave: row.leave,
      marked: row.marked,
      percent: denom > 0 ? Math.round((presentLike / denom) * 1000) / 10 : 0,
    };
  });
}

async function catalogueCounts() {
  const [courses, batches, universities, runningBatches] = await Promise.all([
    Course.aggregate([
      { $match: { softDelete: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Batch.aggregate([
      { $match: { softDelete: false } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          students: { $sum: { $ifNull: ["$enrolledCount", 0] } },
          progress: { $avg: { $ifNull: ["$progress", 0] } },
        },
      },
    ]).option({ maxTimeMS: QUERY_MS }),
    University.aggregate([
      { $match: { softDelete: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_MS }),
    Batch.find({ softDelete: false, status: "Running" })
      .select("batchId name courseName enrolledCount capacity progress schedule faculty status")
      .sort({ enrolledCount: -1 })
      .limit(6)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  const courseStatus = countBy(courses);
  const uniStatus = countBy(universities);
  let batchTotal = 0;
  let running = 0;
  let upcoming = 0;
  let completed = 0;
  let students = 0;
  let progressSum = 0;
  for (const row of batches || []) {
    const count = Number(row.count) || 0;
    batchTotal += count;
    students += Number(row.students) || 0;
    progressSum += (Number(row.progress) || 0) * count;
    if (row._id === "Running") running = count;
    if (row._id === "Upcoming") upcoming = count;
    if (row._id === "Completed") completed = count;
  }

  return {
    courses: {
      total: Object.values(courseStatus).reduce((s, n) => s + n, 0),
      active: courseStatus.Active || 0,
      inactive: courseStatus.Inactive || 0,
      draft: courseStatus.Draft || 0,
    },
    batches: {
      total: batchTotal,
      running,
      upcoming,
      completed,
      students,
      avgProgress: batchTotal > 0 ? Math.round(progressSum / batchTotal) : 0,
    },
    universities: {
      total: Object.values(uniStatus).reduce((s, n) => s + n, 0),
      active: uniStatus.Active || 0,
    },
    runningBatches: (runningBatches || []).map((row) => ({
      id: row.batchId || String(row._id),
      name: row.name || "—",
      course: row.courseName || "—",
      enrolled: Number(row.enrolledCount) || 0,
      capacity: Number(row.capacity) || 0,
      progress: Number(row.progress) || 0,
      schedule: row.schedule || "",
      faculty: row.faculty || "",
      status: row.status || "Running",
    })),
  };
}

async function enquiryLeadCounts() {
  const start = monthStart();
  const months = lastNMonths(6);
  const from = new Date(months[0].year, months[0].month - 1, 1);

  const [enquiryTotal, enquiryMonth, enquiryMonthly, enquiryHeard, recentEnquiries, leadByStatus] =
    await Promise.all([
      Enquiry.countDocuments({}).maxTimeMS(QUERY_MS),
      Enquiry.countDocuments({ submittedAt: { $gte: start } }).maxTimeMS(QUERY_MS),
      Enquiry.aggregate([
        { $match: { submittedAt: { $gte: from } } },
        { $group: { _id: monthKeyExpr("submittedAt"), count: { $sum: 1 } } },
      ]).option({ maxTimeMS: QUERY_MS }),
      Enquiry.aggregate([
        { $group: { _id: { $ifNull: ["$heardAbout", "Unknown"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]).option({ maxTimeMS: QUERY_MS }),
      Enquiry.find({})
        .select("fullName courseRequested serviceRequested enquiryType heardAbout submittedAt mobile")
        .sort({ submittedAt: -1 })
        .limit(6)
        .lean()
        .maxTimeMS(QUERY_MS),
      Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({
        maxTimeMS: QUERY_MS,
      }),
    ]);

  const leadStatus = countBy(leadByStatus);
  const leadTotal = Object.values(leadStatus).reduce((s, n) => s + n, 0);
  const converted = leadStatus.Converted || 0;
  const enquiryMonthMap = countBy(enquiryMonthly);

  return {
    enquiries: {
      total: enquiryTotal,
      thisMonth: enquiryMonth,
      trend: months.map((m) => ({ name: m.name, enquiries: enquiryMonthMap[m.key] || 0 })),
      sources: (enquiryHeard || []).map((row) => ({
        name: row._id || "Unknown",
        value: Number(row.count) || 0,
      })),
      recent: (recentEnquiries || []).map((row) => ({
        id: String(row._id),
        name: row.fullName || "—",
        interest: row.courseRequested || row.serviceRequested || "—",
        type: row.enquiryType || "student",
        source: row.heardAbout || "—",
        mobile: row.mobile || "",
        date: formatDateLabel(row.submittedAt),
      })),
    },
    leads: {
      total: leadTotal,
      newLeads: leadStatus.New || 0,
      contacted: leadStatus.Contacted || 0,
      qualified: leadStatus.Qualified || 0,
      converted,
      lost: leadStatus.Lost || 0,
      conversionRate: pct(converted, leadTotal),
      byStatus: ["New", "Contacted", "Qualified", "Converted", "Lost"].map((name) => ({
        name,
        value: leadStatus[name] || 0,
      })),
    },
  };
}

async function examLists() {
  const [overview, upcoming] = await Promise.all([
    getExamOverview(),
    ExamSchedule.find({
      softDelete: false,
      status: { $in: ["Scheduled", "Live"] },
    })
      .select("examPaperId courseId batchId startAt endAt status assignedCount")
      .populate("examPaperId", "title code")
      .populate("courseId", "name")
      .populate("batchId", "name")
      .sort({ startAt: 1 })
      .limit(6)
      .lean()
      .maxTimeMS(QUERY_MS),
  ]);

  return {
    overview: overview || {},
    upcoming: (upcoming || []).map((row) => ({
      id: String(row._id),
      title: row.examPaperId?.title || row.examPaperId?.code || "Exam",
      course: row.courseId?.name || "—",
      batch: row.batchId?.name || "—",
      status: row.status || "Scheduled",
      assigned: Number(row.assignedCount) || 0,
      start: formatDateTime(row.startAt),
    })),
  };
}

async function activityAndTickets() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [recent, today, total, tickets] = await Promise.all([
    ActivityLog.find({})
      .select("section action actor message createdAt")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .maxTimeMS(QUERY_MS),
    ActivityLog.countDocuments({ createdAt: { $gte: start } }).maxTimeMS(QUERY_MS),
    ActivityLog.countDocuments({}).maxTimeMS(QUERY_MS),
    SupportTicket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({
      maxTimeMS: QUERY_MS,
    }),
  ]);

  const ticketStatus = countBy(tickets);
  return {
    activity: {
      today,
      total,
      recent: (recent || []).map((row) => ({
        id: String(row._id),
        section: row.section || "",
        action: row.action || "",
        actor: row.actor || "system",
        message: row.message || `${row.action || "update"} in ${row.section || "system"}`,
        at: row.createdAt,
        time: formatDateTime(row.createdAt),
      })),
    },
    tickets: {
      open: ticketStatus.Open || 0,
      inProgress: ticketStatus["In Progress"] || 0,
      resolved: ticketStatus.Resolved || 0,
      total: Object.values(ticketStatus).reduce((s, n) => s + n, 0),
    },
  };
}

function buildHealth({ attendance, fees, admissions, exams }) {
  const marked = Number(attendance?.marked) || 0;
  const attendanceRate = marked > 0 ? Number(attendance?.percent) || 0 : null;
  const collectionRate = Number(fees?.collectionRate) || 0;
  const admissionRate = pct(admissions?.approved || 0, admissions?.total || 0);
  const examTotal = (exams?.passed || 0) + (exams?.failed || 0);
  const passRate = examTotal > 0 ? pct(exams?.passed || 0, examTotal) : null;

  const parts = [];
  if (attendanceRate != null) parts.push([attendanceRate, 0.3]);
  parts.push([collectionRate, 0.35]);
  parts.push([admissionRate, 0.25]);
  if (passRate != null) parts.push([passRate, 0.2]);

  const weightSum = parts.reduce((sum, [, w]) => sum + w, 0) || 1;
  const score = Math.round(parts.reduce((sum, [value, weight]) => sum + value * (weight / weightSum), 0));
  return {
    score: Math.max(0, Math.min(100, score)),
    grade: gradeFromScore(score),
    attendanceRate: attendanceRate == null ? 0 : attendanceRate,
    collectionRate,
    admissionRate,
    passRate: passRate == null ? 0 : passRate,
  };
}

export async function getMasterDashboardOverview() {
  const emptyStudents = {
    total: 0,
    active: 0,
    completed: 0,
    inactive: 0,
    newThisMonth: 0,
    byGender: [],
    byCourse: [],
  };
  const emptyAdmissions = {
    total: 0,
    pending: 0,
    verification: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    thisMonth: 0,
    online: 0,
    byStatus: [],
    byMode: [],
    trend: lastNMonths(6).map((m) => ({ name: m.name, admissions: 0 })),
    recent: [],
  };
  const emptyFees = {
    total: 0,
    collected: 0,
    collectedLabel: "₹0",
    pending: 0,
    pendingLabel: "₹0",
    overdue: 0,
    overdueLabel: "₹0",
    paidCount: 0,
    collectionRate: 0,
    byStatus: [],
    trend: lastNMonths(6).map((m) => ({ name: m.name, collected: 0, collectedLakhs: 0 })),
    dues: [],
  };

  const [students, admissions, fees, attendanceToday, week, catalogue, pipeline, exams, ops] =
    await Promise.all([
      safe("students", studentCounts, emptyStudents),
      safe("admissions", admissionCounts, emptyAdmissions),
      safe("fees", feeCounts, emptyFees),
      safe("attendance", () => getAttendanceOverview({}), { stats: {}, meta: {} }),
      safe("attendance-week", attendanceWeek, []),
      safe("catalogue", catalogueCounts, {
        courses: { total: 0, active: 0, inactive: 0, draft: 0 },
        batches: { total: 0, running: 0, upcoming: 0, completed: 0, students: 0, avgProgress: 0 },
        universities: { total: 0, active: 0 },
        runningBatches: [],
      }),
      safe("pipeline", enquiryLeadCounts, {
        enquiries: { total: 0, thisMonth: 0, trend: [], sources: [], recent: [] },
        leads: {
          total: 0,
          newLeads: 0,
          contacted: 0,
          qualified: 0,
          converted: 0,
          lost: 0,
          conversionRate: 0,
          byStatus: [],
        },
      }),
      safe("exams", examLists, { overview: {}, upcoming: [] }),
      safe("ops", activityAndTickets, {
        activity: { today: 0, total: 0, recent: [] },
        tickets: { open: 0, inProgress: 0, resolved: 0, total: 0 },
      }),
    ]);

  const attendance = attendanceToday?.stats || {};
  const health = buildHealth({
    attendance,
    fees,
    admissions,
    exams: exams.overview,
  });

  const kpiTrend = (admissions.trend || []).map((row, i) => ({
    name: row.name,
    admissions: row.admissions || 0,
    enquiries: pipeline.enquiries.trend?.[i]?.enquiries || 0,
    collectedLakhs: fees.trend?.[i]?.collectedLakhs || 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    health,
    kpis: {
      students,
      admissions,
      fees,
      attendance,
      courses: catalogue.courses,
      batches: catalogue.batches,
      universities: catalogue.universities,
      enquiries: {
        total: pipeline.enquiries.total,
        thisMonth: pipeline.enquiries.thisMonth,
      },
      leads: pipeline.leads,
      exams: exams.overview,
      activity: {
        today: ops.activity.today,
        total: ops.activity.total,
      },
      tickets: ops.tickets,
    },
    charts: {
      kpiTrend,
      feeTrend: fees.trend,
      attendanceWeek: week,
      feeStatus: fees.byStatus,
      coursePopularity: students.byCourse,
      admissionStatus: admissions.byStatus,
      admissionMode: admissions.byMode,
      genderSplit: students.byGender,
      enquirySources: pipeline.enquiries.sources,
      leadPipeline: pipeline.leads.byStatus,
      examResults: [
        { name: "Pass", value: exams.overview.passed || 0 },
        { name: "Fail", value: exams.overview.failed || 0 },
      ],
    },
    lists: {
      recentAdmissions: admissions.recent,
      overdueFees: fees.dues,
      recentEnquiries: pipeline.enquiries.recent,
      recentActivity: ops.activity.recent,
      upcomingExams: exams.upcoming,
      runningBatches: catalogue.runningBatches,
    },
  };
}
