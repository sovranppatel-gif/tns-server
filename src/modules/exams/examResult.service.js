import { ExamResult } from "./examResult.model.js";
import { ExamAttempt } from "./examAttempt.model.js";
import { ExamSchedule } from "./examSchedule.model.js";
import { ExamPaper } from "./examPaper.model.js";
import { ExamAssignment } from "./examAssignment.model.js";
import { QuestionBank } from "./questionBank.model.js";
import { Student } from "../students/students.model.js";
import { User, USER_TYPES } from "../../models/User.js";
import { createStudentNotification } from "../../lib/studentNotifications.js";
import { asObjectId, httpError, idStr, studentEmailOf, toNumber } from "./exams.helpers.js";
import { toStudentResult } from "./exams.evaluation.js";

export async function getExamOverview() {
  const [
    questions,
    papers,
    schedules,
    assignments,
    attempts,
    results,
  ] = await Promise.all([
    QuestionBank.countDocuments({ softDelete: false }),
    ExamPaper.countDocuments({ softDelete: false }),
    ExamSchedule.countDocuments({ softDelete: false }),
    ExamAssignment.countDocuments(),
    ExamAttempt.countDocuments(),
    ExamResult.countDocuments(),
  ]);

  const [published, liveish, submitted, inProgress, passed, failed, avg] =
    await Promise.all([
      ExamPaper.countDocuments({ softDelete: false, status: "Published" }),
      ExamSchedule.countDocuments({
        softDelete: false,
        status: { $in: ["Scheduled", "Live"] },
      }),
      ExamAttempt.countDocuments({
        status: { $in: ["Submitted", "Auto Submitted"] },
      }),
      ExamAttempt.countDocuments({ status: "In Progress" }),
      ExamResult.countDocuments({ result: "PASS" }),
      ExamResult.countDocuments({ result: "FAIL" }),
      ExamResult.aggregate([
        { $group: { _id: null, avg: { $avg: "$percentage" } } },
      ]),
    ]);

  return {
    questions,
    papers,
    published,
    schedules,
    live: liveish,
    assignments,
    attempts,
    submitted,
    inProgress,
    passed,
    failed,
    averageScore: Math.round(toNumber(avg[0]?.avg, 0) * 10) / 10,
    results,
  };
}

export async function listAdminResults({
  examId = "",
  universityId = "",
  courseId = "",
  batchId = "",
  student = "",
  result = "",
  from = "",
  to = "",
} = {}) {
  const query = {};
  if (asObjectId(examId)) query.examId = asObjectId(examId);

  let examIds = null;
  if (asObjectId(universityId) || asObjectId(courseId) || asObjectId(batchId)) {
    const scheduleQuery = { softDelete: false };
    if (asObjectId(universityId)) scheduleQuery.universityId = asObjectId(universityId);
    if (asObjectId(courseId)) scheduleQuery.courseId = asObjectId(courseId);
    if (asObjectId(batchId)) scheduleQuery.batchId = asObjectId(batchId);
    const schedules = await ExamSchedule.find(scheduleQuery).select("_id").lean();
    examIds = schedules.map((s) => s._id);
    query.examId = { $in: examIds };
  }
  if (result) query.result = String(result).toUpperCase();
  if (from || to) {
    query.submittedAt = {};
    if (from) query.submittedAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query.submittedAt.$lte = end;
    }
  }
  if (student) {
    const rx = new RegExp(String(student).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matched = await Student.find({
      $or: [{ nameEnglish: rx }, { studentId: rx }, { admissionId: rx }],
    })
      .select("_id")
      .lean();
    query.studentId = { $in: matched.map((s) => s._id) };
  }

  const docs = await ExamResult.find(query).sort({ submittedAt: -1 }).lean().maxTimeMS(8000);
  const studentIds = [...new Set(docs.map((d) => String(d.studentId)))];
  const resultExamIds = [...new Set(docs.map((d) => String(d.examId)).filter(Boolean))];
  const [students, assignments, activeAttempts] = await Promise.all([
    Student.find({ _id: { $in: studentIds } })
      .select("studentId admissionId nameEnglish contact courseName batchName")
      .lean(),
    resultExamIds.length
      ? ExamAssignment.find({ examId: { $in: resultExamIds } }).lean()
      : Promise.resolve([]),
    resultExamIds.length
      ? ExamAttempt.find({
          examId: { $in: resultExamIds },
          status: "In Progress",
        })
          .select("examId studentId")
          .lean()
      : Promise.resolve([]),
  ]);
  const studentMap = new Map(students.map((s) => [String(s._id), s]));
  const assignmentMap = new Map(
    assignments.map((a) => [`${String(a.examId)}:${String(a.studentId)}`, a])
  );
  const activeSet = new Set(
    activeAttempts.map((a) => `${String(a.examId)}:${String(a.studentId)}`)
  );

  const rows = docs.map((d) => {
    const stu = studentMap.get(String(d.studentId));
    const assignKey = `${String(d.examId)}:${String(d.studentId)}`;
    const assignment = assignmentMap.get(assignKey);
    return {
      ...toStudentResult(d, { includeBreakdown: false }),
      studentName: d.studentName || stu?.nameEnglish || "",
      admissionId: d.admissionId || stu?.admissionId || "",
      studentCode: d.studentCode || stu?.studentId || "",
      courseName: d.courseName || stu?.courseName || "",
      batchName: d.batchName || stu?.batchName || "",
      startedAt: d.startedAt,
      submittedAt: d.submittedAt,
      score: `${d.obtainedMarks}/${d.totalMarks}`,
      extraAttempts: toNumber(assignment?.extraAttempts, 0),
      reexamPending: Boolean(assignment?.reexamPending),
      reexamUntil: assignment?.reexamUntil || null,
      hasActiveAttempt: activeSet.has(assignKey),
      canAllotReexam:
        Boolean(assignment) &&
        assignment.status !== "Cancelled" &&
        !activeSet.has(assignKey),
    };
  });

  const stats = {
    totalExams: await ExamSchedule.countDocuments({ softDelete: false }),
    totalAttempts: rows.length,
    submitted: rows.length,
    inProgress: await ExamAttempt.countDocuments({ status: "In Progress" }),
    passed: rows.filter((r) => r.result === "PASS").length,
    failed: rows.filter((r) => r.result === "FAIL").length,
    averageScore:
      rows.length === 0
        ? 0
        : Math.round(
            (rows.reduce((sum, r) => sum + toNumber(r.percentage, 0), 0) /
              rows.length) *
              10
          ) / 10,
  };

  return { rows, stats };
}

export async function getAdminResultById(id) {
  const doc = await ExamResult.findById(id).lean();
  if (!doc) return null;
  const [student, attempt, schedule, paper] = await Promise.all([
    Student.findById(doc.studentId)
      .select("studentId admissionId nameEnglish contact courseName batchName universityName")
      .lean(),
    ExamAttempt.findById(doc.attemptId).lean(),
    ExamSchedule.findById(doc.examId).lean(),
    doc.examId
      ? ExamPaper.findById(
          (await ExamSchedule.findById(doc.examId).select("examPaperId").lean())
            ?.examPaperId
        ).lean()
      : null,
  ]);

  return {
    ...toStudentResult(doc, { includeBreakdown: true }),
    studentName: doc.studentName || student?.nameEnglish || "",
    admissionId: doc.admissionId || student?.admissionId || "",
    studentCode: doc.studentCode || student?.studentId || "",
    email: student?.contact?.email || "",
    courseName: doc.courseName || student?.courseName || paper?.courseName || "",
    batchName: doc.batchName || student?.batchName || "",
    universityName: doc.universityName || student?.universityName || "",
    examTitle: doc.examTitle || paper?.title || "",
    startedAt: doc.startedAt || attempt?.startedAt,
    submittedAt: doc.submittedAt || attempt?.submittedAt,
    attempt: attempt
      ? {
          id: String(attempt._id),
          status: attempt.status,
          attemptNumber: attempt.attemptNumber,
          startedAt: attempt.startedAt,
          expiresAt: attempt.expiresAt,
          submittedAt: attempt.submittedAt,
        }
      : null,
    schedule: schedule
      ? {
          id: String(schedule._id),
          startAt: schedule.startAt,
          endAt: schedule.endAt,
          resultVisibility: schedule.resultVisibility,
          resultsReleased: schedule.resultsReleased,
        }
      : null,
  };
}

export async function enrichResultStudentMeta(resultId) {
  const doc = await ExamResult.findById(resultId);
  if (!doc) return;
  const student = await Student.findById(doc.studentId)
    .select("studentId admissionId nameEnglish courseName batchName universityName")
    .lean();
  if (!student) return;
  doc.studentName = student.nameEnglish || doc.studentName;
  doc.admissionId = student.admissionId || "";
  doc.studentCode = student.studentId || "";
  doc.courseName = student.courseName || doc.courseName;
  doc.batchName = student.batchName || doc.batchName;
  doc.universityName = student.universityName || doc.universityName;
  await doc.save();
}

export async function allotReexam(resultId, editor = "master-admin") {
  const result = await ExamResult.findById(resultId).lean();
  if (!result) return null;

  const [schedule, assignment, activeAttempt, student] = await Promise.all([
    ExamSchedule.findById(result.examId).lean(),
    ExamAssignment.findOne({ examId: result.examId, studentId: result.studentId }),
    ExamAttempt.findOne({
      examId: result.examId,
      studentId: result.studentId,
      status: "In Progress",
    }).lean(),
    Student.findById(result.studentId)
      .select("nameEnglish contact studentId admissionId")
      .lean(),
  ]);

  if (!schedule || schedule.softDelete) throw httpError("Exam schedule not found", 404);
  if (schedule.status === "Cancelled") throw httpError("This exam has been cancelled");
  if (!assignment) throw httpError("Student is not assigned to this exam", 404);
  if (assignment.status === "Cancelled") throw httpError("This assignment was cancelled");
  if (activeAttempt) {
    throw httpError("Student already has an in-progress attempt");
  }

  const paper = schedule.examPaperId
    ? await ExamPaper.findById(schedule.examPaperId).select("title").lean()
    : null;

  const used = await ExamAttempt.countDocuments({
    examId: result.examId,
    studentId: result.studentId,
    status: { $ne: "In Progress" },
  });
  const baseLimit = Math.max(1, toNumber(schedule.attemptLimit, 1));
  let extraAttempts = Math.max(0, toNumber(assignment.extraAttempts, 0));
  if (used >= baseLimit + extraAttempts) {
    extraAttempts += 1;
  }

  const reexamUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assignment.extraAttempts = extraAttempts;
  assignment.reexamPending = true;
  assignment.reexamUntil = reexamUntil;
  assignment.reexamAllottedAt = new Date();
  assignment.reexamAllottedBy = editor || "master-admin";
  assignment.status = "Assigned";
  await assignment.save();

  const title = result.examTitle || paper?.title || "Online Exam";
  let email = studentEmailOf(student);
  if (!email) {
    const user = await User.findOne({
      type: USER_TYPES.STUDENT,
      erpStudentId: result.studentId,
    })
      .select("email")
      .lean();
    email = String(user?.email || "").toLowerCase().trim();
  }
  if (email) {
    await createStudentNotification({
      email,
      type: "exam",
      title: "Re-exam allotted",
      body: `You have been allotted a re-exam for "${title}". Open Live Exams and attempt it again within 24 hours.`,
      meta: {
        examId: String(schedule._id),
        title,
        reexam: true,
        actionUrl: `/student/live-exams?exam=${schedule._id}&view=instructions`,
      },
    });
  }

  return {
    examId: String(result.examId),
    studentId: String(result.studentId),
    studentName: result.studentName || student?.nameEnglish || "",
    extraAttempts,
    reexamPending: true,
    reexamUntil,
    message: `Re-exam allotted for ${result.studentName || student?.nameEnglish || "student"}. They can attempt again within 24 hours.`,
  };
}

export { httpError, idStr };
