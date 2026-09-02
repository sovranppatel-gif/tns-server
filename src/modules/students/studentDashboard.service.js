import { Admission } from "../../models/Admission.js";
import { Attendance } from "../attendance/attendance.model.js";
import { StudentFee } from "../fees/fees.model.js";
import {
  loadStudentUser,
  toPublicStudent,
  avatarFromName,
} from "../../lib/studentPublicProfile.js";

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function raceMs(fn, ms, fallback) {
  return Promise.race([
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        console.error("student dashboard partial error:", err?.message || err);
        return fallback;
      }),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function statusKey(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function nextFeeDue(docs) {
  const pending = [];
  for (const fee of Array.isArray(docs) ? docs : []) {
    for (const ins of fee.installments || []) {
      const due = Math.max(0, safeNum(ins.amount) - safeNum(ins.paid));
      if (String(ins.status || "") === "Paid" || due <= 0) continue;
      pending.push({
        amount: due,
        installment: ins.label || "Installment",
        dueDate: ins.dueDate
          ? new Date(ins.dueDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "",
        dueDateRaw: ins.dueDate ? new Date(ins.dueDate).toISOString() : null,
        course: fee.course || "",
      });
    }
  }
  pending.sort((a, b) => {
    const ta = a.dueDateRaw ? new Date(a.dueDateRaw).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.dueDateRaw ? new Date(b.dueDateRaw).getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
  return pending[0] || null;
}

async function attendanceSummary(email) {
  const docs = await Attendance.find({ email })
    .select("status")
    .lean()
    .maxTimeMS(2500)
    .limit(800);

  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  for (const doc of docs) {
    const status = statusKey(doc.status);
    if (status === "present") presentDays += 1;
    else if (status === "absent") absentDays += 1;
    else if (status === "late") lateDays += 1;
  }
  const totalMarked = presentDays + absentDays + lateDays;
  return {
    attendancePercent: totalMarked > 0 ? Math.round(((presentDays + lateDays) / totalMarked) * 100) : 0,
    presentDays,
    absentDays,
    lateDays,
  };
}

async function feeSummary(email) {
  const docs = await StudentFee.find({ email })
    .select("course paidAmount dueAmount installments")
    .sort({ updatedAt: -1 })
    .lean()
    .maxTimeMS(2500)
    .limit(8);

  let collected = 0;
  let pending = 0;
  for (const row of docs) {
    collected += safeNum(row.paidAmount);
    pending += safeNum(row.dueAmount);
  }
  return {
    details: docs,
    stats: { collectedRaw: collected, pendingRaw: pending },
  };
}

export async function getStudentDashboard(reqStudent) {
  const email = String(reqStudent?.email || "")
    .toLowerCase()
    .trim();
  if (!email) {
    const err = new Error("Student authentication required");
    err.status = 401;
    throw err;
  }

  const rawUser = await loadStudentUser(email, reqStudent?.sub);
  if (!rawUser || rawUser.isActive === false) {
    const err = new Error("Account not found");
    err.status = 401;
    throw err;
  }

  const lookupEmail = String(rawUser.email || email)
    .toLowerCase()
    .trim();
  const profile = toPublicStudent(rawUser);
  const [attendance, fees, admissions] = await Promise.all([
    raceMs(
      () => attendanceSummary(lookupEmail),
      2800,
      { attendancePercent: 0, presentDays: 0, absentDays: 0, lateDays: 0 }
    ),
    raceMs(() => feeSummary(lookupEmail), 2800, {
      details: [],
      stats: { pendingRaw: 0, collectedRaw: 0 },
    }),
    raceMs(
      () =>
        Admission.find({ email: lookupEmail, status: "Approved" })
          .select("course studentStatus")
          .sort({ admissionDate: -1 })
          .limit(6)
          .lean()
          .maxTimeMS(2500),
      2800,
      []
    ),
  ]);

  const feePending = safeNum(fees?.stats?.pendingRaw);
  const feePaid = safeNum(fees?.stats?.collectedRaw);
  const feeTotal = feePending + feePaid;
  const courses = Array.isArray(admissions) ? admissions : [];

  if (!profile.course && courses[0]?.course) profile.course = courses[0].course;
  if (!profile.avatar) profile.avatar = avatarFromName(profile.name);

  const feeDue = nextFeeDue(fees.details);
  const upcomingEvents = feeDue
    ? [
        {
          id: "fee-due",
          title: `Fee due${feeDue.course ? ` · ${feeDue.course}` : ""}`,
          date: feeDue.dueDate,
          time: feeDue.installment,
        },
      ]
    : [];

  return {
    profile,
    stats: {
      overallCompletion:
        feeTotal > 0
          ? Math.round((feePaid / feeTotal) * 100)
          : attendance.attendancePercent || 0,
      attendancePercent: safeNum(attendance.attendancePercent),
      currentGpa: "",
      lastExamPercent: 0,
      presentDays: safeNum(attendance.presentDays),
      absentDays: safeNum(attendance.absentDays),
      lateDays: safeNum(attendance.lateDays),
      assignmentsPending: 0,
      assignmentsCompleted: 0,
      totalCourses: courses.length,
      completedCourses: courses.filter((row) =>
        /completed/i.test(String(row.studentStatus || ""))
      ).length,
      certificatesEarned: 0,
      feePending,
      feePaid,
      todaysClasses: 0,
      liveExams: 0,
      upcomingExams: 0,
      unreadNotifications: 0,
    },
    highlights: {
      nextClass: null,
      nextAssignment: null,
      nextExam: null,
      feeDue,
    },
    activities: [],
    upcomingEvents,
  };
}
