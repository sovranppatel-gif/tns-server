import { ExamSchedule } from "./examSchedule.model.js";
import { ExamAssignment } from "./examAssignment.model.js";
import { ExamAttempt } from "./examAttempt.model.js";
import { ExamResult } from "./examResult.model.js";
import { ExamPaper } from "./examPaper.model.js";
import { Student } from "../students/students.model.js";
import { DEFAULT_EXAM_INSTRUCTIONS } from "./exams.constants.js";
import { evaluateAttempt, toPublicStudentResult, toStudentResult } from "./exams.evaluation.js";
import {
  asObjectId,
  canStudentStartExam,
  completedAttemptCount,
  deriveScheduleStatus,
  extraAttemptLimit,
  formatDateLabel,
  formatTimeLabel,
  httpError,
  idStr,
  isAnswerEmpty,
  isReexamWindowOpen,
  normalizeSelectedAnswer,
  stripAnswerKey,
  toNumber,
} from "./exams.helpers.js";

function canReleaseResult(schedule, resultDoc) {
  const visibility = schedule?.resultVisibility || "Immediately";
  if (visibility === "Immediately") return true;
  if (visibility === "After Exam Ends") {
    return Boolean(schedule?.endAt && new Date() >= new Date(schedule.endAt));
  }
  if (visibility === "Manual Release") {
    return Boolean(schedule?.resultsReleased);
  }
  return Boolean(resultDoc?.released);
}

function navigatorStatus(question, answer) {
  const visited = Boolean(answer?.visited);
  const marked = Boolean(answer?.markedForReview);
  const answered = answer ? !isAnswerEmpty(question.type, answer.selectedAnswer) : false;
  if (answered && marked) return "Answered + Review";
  if (marked) return "Marked for Review";
  if (answered) return "Answered";
  if (visited) return "Visited";
  return "Not Visited";
}

function safePaper(paper) {
  return {
    id: String(paper._id),
    title: paper.title,
    code: paper.code,
    description: paper.description || "",
    subject: paper.subject || "",
    durationMinutes: paper.durationMinutes,
    passingPercentage: paper.passingPercentage,
    negativeMarkingEnabled: Boolean(paper.negativeMarkingEnabled),
    instructions:
      paper.instructions?.length ? paper.instructions : DEFAULT_EXAM_INSTRUCTIONS,
    totalQuestions: paper.totalQuestions || paper.questions?.length || 0,
    totalMarks: paper.totalMarks || 0,
    questions: (paper.questions || []).map((q, index) => ({
      ...stripAnswerKey(q),
      order: q.order || index + 1,
    })),
  };
}

function cardFrom({ assignment, schedule, paper, attempt, attempts, result, released }) {
  const now = new Date();
  const derived = deriveScheduleStatus(schedule, now);
  const allAttempts = Array.isArray(attempts)
    ? attempts
    : attempt
      ? [attempt]
      : [];
  const canStart = canStudentStartExam({
    schedule,
    assignment,
    attempts: allAttempts,
    now,
  });
  const canResume =
    Boolean(attempt?.status === "In Progress" && attempt?.expiresAt) &&
    new Date(attempt.expiresAt) > now &&
    (derived === "Live" || isReexamWindowOpen(assignment, now));
  const scheduleStatus =
    derived === "Completed" && (canStart || canResume) ? "Live" : derived;
  return {
    id: String(schedule._id),
    examId: String(schedule._id),
    examPaperId: String(paper?._id || schedule.examPaperId),
    title: paper?.title || "",
    code: paper?.code || "",
    course: paper?.courseName || "",
    batch: paper?.batchName || "",
    subject: paper?.subject || "",
    date: formatDateLabel(schedule.startAt),
    time: `${formatTimeLabel(schedule.startAt)} - ${formatTimeLabel(schedule.endAt)}`,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    durationMinutes: schedule.durationMinutes || paper?.durationMinutes,
    totalQuestions: paper?.totalQuestions || 0,
    totalMarks: paper?.totalMarks || 0,
    passingPercentage: paper?.passingPercentage || 40,
    negativeMarkingEnabled: Boolean(paper?.negativeMarkingEnabled),
    scheduleStatus,
    assignmentStatus: assignment?.status || "Assigned",
    attemptStatus: attempt?.status || "",
    attemptId: attempt?._id ? String(attempt._id) : "",
    reexamPending: Boolean(assignment?.reexamPending),
    resultAvailable: Boolean(released && result),
    result: released && result ? toPublicStudentResult(result) : null,
    canStart,
    canResume,
  };
}

async function loadStudentExamContext(studentId, examId) {
  const schedule = await ExamSchedule.findOne({
    _id: examId,
    softDelete: false,
  }).lean();
  if (!schedule) throw httpError("Exam not found", 404);

  const assignment = await ExamAssignment.findOne({
    examId: schedule._id,
    studentId,
  }).lean();
  if (!assignment) {
    throw httpError("You are not assigned to this exam", 403);
  }

  const paper = await ExamPaper.findById(schedule.examPaperId).lean();
  if (!paper || paper.softDelete) throw httpError("Exam paper not found", 404);

  const attempts = await ExamAttempt.find({
    examId: schedule._id,
    studentId,
  })
    .sort({ attemptNumber: -1 })
    .lean();

  const activeAttempt = attempts.find((row) => row.status === "In Progress") || null;
  const latestResult = await ExamResult.findOne({
    examId: schedule._id,
    studentId,
  })
    .sort({ createdAt: -1 })
    .lean();

  return { schedule, assignment, paper, attempts, activeAttempt, latestResult };
}

export async function listStudentExams(studentId) {
  const assignments = await ExamAssignment.find({
    studentId,
    status: { $ne: "Cancelled" },
  })
    .sort({ createdAt: -1 })
    .lean()
    .maxTimeMS(8000);

  const examIds = assignments.map((a) => a.examId);
  const [schedules, papers, attempts, results] = await Promise.all([
    ExamSchedule.find({ _id: { $in: examIds }, softDelete: false }).lean(),
    ExamPaper.find({
      _id: { $in: assignments.map((a) => a.examPaperId).filter(Boolean) },
    }).lean(),
    ExamAttempt.find({ studentId, examId: { $in: examIds } }).lean(),
    ExamResult.find({ studentId, examId: { $in: examIds } }).lean(),
  ]);

  const scheduleMap = new Map(schedules.map((s) => [String(s._id), s]));
  const paperMap = new Map(papers.map((p) => [String(p._id), p]));
  const attemptsByExam = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.examId);
    if (!attemptsByExam.has(key)) attemptsByExam.set(key, []);
    attemptsByExam.get(key).push(attempt);
  }
  const resultMap = new Map();
  for (const result of results) {
    const key = String(result.examId);
    const current = resultMap.get(key);
    const nextTime = new Date(result.submittedAt || result.createdAt || 0).getTime();
    const currentTime = current
      ? new Date(current.submittedAt || current.createdAt || 0).getTime()
      : 0;
    if (!current || nextTime >= currentTime) resultMap.set(key, result);
  }

  const upcoming = [];
  const live = [];
  const completed = [];
  const resultRows = [];

  for (const assignment of assignments) {
    const schedule = scheduleMap.get(String(assignment.examId));
    if (!schedule || schedule.status === "Cancelled") continue;
    const paper =
      paperMap.get(String(assignment.examPaperId || schedule.examPaperId)) ||
      null;
    const examAttempts = attemptsByExam.get(String(schedule._id)) || [];
    const attempt = examAttempts.reduce((latest, row) => {
      if (!latest) return row;
      return (row.attemptNumber || 0) > (latest.attemptNumber || 0) ? row : latest;
    }, null);
    const result = resultMap.get(String(schedule._id));
    const released = canReleaseResult(schedule, result);
    const card = cardFrom({
      assignment,
      schedule,
      paper,
      attempt,
      attempts: examAttempts,
      result,
      released,
    });
    if (card.scheduleStatus === "Live") live.push(card);
    else if (card.scheduleStatus === "Scheduled") upcoming.push(card);
    else completed.push(card);
    if (result && released) resultRows.push(card);
  }

  return { upcoming, live, completed, results: resultRows };
}

export async function getStudentExam(studentId, examId) {
  const ctx = await loadStudentExamContext(studentId, examId);
  const released = canReleaseResult(ctx.schedule, ctx.latestResult);
  return {
    ...cardFrom({
      assignment: ctx.assignment,
      schedule: ctx.schedule,
      paper: ctx.paper,
      attempt: ctx.activeAttempt || ctx.attempts[0],
      attempts: ctx.attempts,
      result: ctx.latestResult,
      released,
    }),
    instructions:
      ctx.schedule.instructions?.length
        ? ctx.schedule.instructions
        : ctx.paper.instructions?.length
          ? ctx.paper.instructions
          : DEFAULT_EXAM_INSTRUCTIONS,
    attemptLimit: extraAttemptLimit(ctx.schedule, ctx.assignment),
    attemptsUsed: completedAttemptCount(ctx.attempts),
  };
}

function remainingMs(expiresAt) {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function isDuplicateKey(err) {
  return Number(err?.code) === 11000 || Number(err?.cause?.code) === 11000;
}

function safeAttemptPayload(paper, attempt) {
  const answerMap = new Map(
    (attempt.answers || []).map((row) => [String(row.questionId), row])
  );
  const questions = (paper.questions || []).map((q, index) => {
    const safe = stripAnswerKey(q);
    const saved = answerMap.get(String(q.questionId));
    return {
      ...safe,
      order: q.order || index + 1,
      selectedAnswer: saved
        ? normalizeSelectedAnswer(q.type, saved.selectedAnswer)
        : q.type === "Multiple Choice"
          ? []
          : "",
      visited: Boolean(saved?.visited),
      markedForReview: Boolean(saved?.markedForReview),
      navigatorStatus: navigatorStatus(q, saved),
    };
  });
  const answered = questions.filter((q) =>
    q.type === "Multiple Choice" ? q.selectedAnswer.length : q.selectedAnswer
  ).length;
  return {
    attemptId: String(attempt._id),
    examId: String(attempt.examId),
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    remainingMs: remainingMs(attempt.expiresAt),
    currentIndex: attempt.currentIndex || 0,
    answered,
    totalQuestions: questions.length,
    paper: {
      ...safePaper(paper),
      questions,
    },
  };
}

export async function startStudentExam(studentId, examId, studentMeta = {}) {
  const ctx = await loadStudentExamContext(studentId, examId);
  if (ctx.paper.status !== "Published") {
    throw httpError("This exam is not published");
  }
  if (ctx.schedule.status === "Cancelled") {
    throw httpError("This exam has been cancelled");
  }
  const now = new Date();
  const status = deriveScheduleStatus(ctx.schedule, now);
  const reexamOpen = isReexamWindowOpen(ctx.assignment, now);
  if (status === "Scheduled" && !reexamOpen) {
    throw httpError("This exam has not started yet");
  }
  if (status === "Completed" && !reexamOpen) {
    throw httpError("This exam has ended");
  }
  if (status !== "Live" && !reexamOpen) {
    throw httpError("This exam is not available");
  }

  if (ctx.activeAttempt) {
    if (new Date(ctx.activeAttempt.expiresAt) <= now) {
      return submitStudentExam(studentId, examId, { auto: true });
    }
    return {
      resumed: true,
      studentName: studentMeta.name || "",
      ...safeAttemptPayload(ctx.paper, ctx.activeAttempt),
    };
  }

  const used = completedAttemptCount(ctx.attempts);
  const limit = extraAttemptLimit(ctx.schedule, ctx.assignment);
  if (used >= limit) {
    throw httpError("Attempt limit reached for this exam");
  }
  if (!["Assigned", "Started"].includes(ctx.assignment.status)) {
    throw httpError("This exam is not available for a new attempt");
  }

  const durationMinutes = ctx.schedule.durationMinutes || ctx.paper.durationMinutes || 60;
  const startedAt = now;
  const fromDuration = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
  const windowEnd = new Date(ctx.schedule.endAt);
  let expiresAt;
  if (reexamOpen && status !== "Live") {
    expiresAt = fromDuration;
  } else {
    expiresAt = fromDuration < windowEnd ? fromDuration : windowEnd;
  }

  let created;
  try {
    created = await ExamAttempt.create({
      examId: ctx.schedule._id,
      examPaperId: ctx.paper._id,
      studentId,
      attemptNumber: used + 1,
      startedAt,
      expiresAt,
      answers: [],
      status: "In Progress",
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existing = await ExamAttempt.findOne({
      examId: ctx.schedule._id,
      studentId,
      status: "In Progress",
    }).lean();
    if (!existing) throw err;
    if (new Date(existing.expiresAt) <= new Date()) {
      return submitStudentExam(studentId, examId, { auto: true });
    }
    return {
      resumed: true,
      studentName: studentMeta.name || "",
      ...safeAttemptPayload(ctx.paper, existing),
    };
  }

  await ExamAssignment.updateOne(
    { _id: ctx.assignment._id },
    { status: "Started", reexamPending: false }
  );

  return {
    resumed: false,
    studentName: studentMeta.name || "",
    ...safeAttemptPayload(ctx.paper, created.toObject()),
  };
}

export async function saveStudentAnswer(studentId, examId, payload = {}) {
  const ctx = await loadStudentExamContext(studentId, examId);
  if (!ctx.activeAttempt) {
    throw httpError("No active attempt. Start the exam first.", 409);
  }
  const now = new Date();
  if (new Date(ctx.activeAttempt.expiresAt) <= now) {
    return submitStudentExam(studentId, examId, { auto: true });
  }

  const paperQuestions = ctx.paper.questions || [];
  const updates = Array.isArray(payload.answers)
    ? payload.answers
    : payload.questionId
      ? [payload]
      : [];
  if (!updates.length && payload.currentIndex == null) {
    throw httpError("Answer payload is required");
  }

  const answers = [...(ctx.activeAttempt.answers || [])];
  for (const item of updates) {
    const questionId = String(item.questionId || "");
    const question = paperQuestions.find(
      (q) => String(q.questionId) === questionId
    );
    if (!question) continue;
    const selectedAnswer = Object.prototype.hasOwnProperty.call(item, "selectedAnswer")
      ? normalizeSelectedAnswer(question.type, item.selectedAnswer)
      : undefined;
    const idx = answers.findIndex((row) => String(row.questionId) === questionId);
    const next = {
      questionId: asObjectId(questionId),
      selectedAnswer:
        selectedAnswer !== undefined
          ? selectedAnswer
          : idx >= 0
            ? answers[idx].selectedAnswer
            : question.type === "Multiple Choice"
              ? []
              : "",
      answeredAt: now,
      visited: item.visited !== false,
      markedForReview: Boolean(
        item.markedForReview ?? (idx >= 0 ? answers[idx].markedForReview : false)
      ),
    };
    if (idx >= 0) answers[idx] = next;
    else answers.push(next);
  }

  const patch = { answers };
  if (payload.currentIndex != null) {
    patch.currentIndex = Math.max(0, toNumber(payload.currentIndex, 0));
  }

  const updated = await ExamAttempt.findOneAndUpdate(
    { _id: ctx.activeAttempt._id, studentId, status: "In Progress" },
    patch,
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  if (!updated) throw httpError("Unable to save answers", 409);
  return {
    saved: true,
    remainingMs: remainingMs(updated.expiresAt),
    expiresAt: updated.expiresAt,
    answers: (updated.answers || []).map((row) => ({
      questionId: String(row.questionId),
      selectedAnswer: row.selectedAnswer,
      markedForReview: Boolean(row.markedForReview),
      visited: Boolean(row.visited),
    })),
  };
}

export async function submitStudentExam(studentId, examId, { auto = false } = {}) {
  const ctx = await loadStudentExamContext(studentId, examId);
  const attempt =
    ctx.activeAttempt ||
    ctx.attempts.find((row) => row.status === "In Progress");
  if (!attempt) {
    if (ctx.latestResult) {
      const released = canReleaseResult(ctx.schedule, ctx.latestResult);
      if (!released) {
        return {
          submitted: true,
          pendingRelease: true,
          message: "Result will be available according to the exam schedule.",
        };
      }
      return { submitted: true, result: toPublicStudentResult(ctx.latestResult) };
    }
    throw httpError("No in-progress attempt to submit", 409);
  }

  if (["Submitted", "Auto Submitted", "Expired"].includes(attempt.status)) {
    throw httpError("This attempt is already submitted", 409);
  }

  const now = new Date();
  const expired = new Date(attempt.expiresAt) <= now;
  const status = auto || expired ? "Auto Submitted" : "Submitted";
  const evaluated = evaluateAttempt({
    paper: ctx.paper,
    answers: attempt.answers || [],
    startedAt: attempt.startedAt,
    submittedAt: now,
  });

  const released = canReleaseResult(
    { ...ctx.schedule, endAt: ctx.schedule.endAt, resultsReleased: ctx.schedule.resultsReleased },
    { released: ctx.schedule.resultVisibility === "Immediately" }
  );

  const student = await Student.findById(studentId)
    .select("studentId admissionId nameEnglish courseName batchName universityName")
    .lean();

  const resultDoc = await ExamResult.findOneAndUpdate(
    { attemptId: attempt._id },
    {
      examId: ctx.schedule._id,
      attemptId: attempt._id,
      studentId,
      examTitle: ctx.paper.title,
      studentName: student?.nameEnglish || "",
      admissionId: student?.admissionId || "",
      studentCode: student?.studentId || "",
      courseName: student?.courseName || ctx.paper.courseName || "",
      batchName: student?.batchName || ctx.paper.batchName || "",
      universityName: student?.universityName || "",
      totalQuestions: evaluated.totalQuestions,
      attempted: evaluated.attempted,
      correct: evaluated.correct,
      wrong: evaluated.wrong,
      unanswered: evaluated.unanswered,
      totalMarks: evaluated.totalMarks,
      obtainedMarks: evaluated.obtainedMarks,
      percentage: evaluated.percentage,
      passingPercentage: evaluated.passingPercentage,
      result: evaluated.result,
      timeTakenSeconds: evaluated.timeTakenSeconds,
      submittedAt: now,
      startedAt: attempt.startedAt,
      examDate: ctx.schedule.startAt,
      released,
      status,
      breakdown: evaluated.breakdown,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  await ExamAttempt.updateOne(
    { _id: attempt._id },
    { status, submittedAt: now }
  );
  await ExamAssignment.updateOne(
    { examId: ctx.schedule._id, studentId },
    { status: expired && auto ? "Expired" : "Submitted" }
  );

  if (!released) {
    return {
      submitted: true,
      pendingRelease: true,
      auto: Boolean(auto || expired),
      message:
        ctx.schedule.resultVisibility === "Manual Release"
          ? "Exam submitted. Result will be released by the institute."
          : "Exam submitted. Result will be available after the exam ends.",
    };
  }

  return {
    submitted: true,
    auto: Boolean(auto || expired),
    result: toPublicStudentResult(resultDoc),
  };
}

export async function getStudentResult(studentId, examId) {
  const ctx = await loadStudentExamContext(studentId, examId);
  if (ctx.activeAttempt && new Date(ctx.activeAttempt.expiresAt) <= new Date()) {
    const submitted = await submitStudentExam(studentId, examId, { auto: true });
    if (submitted.result) return submitted.result;
  }
  if (!ctx.latestResult) throw httpError("Result not found", 404);
  if (!canReleaseResult(ctx.schedule, ctx.latestResult)) {
    throw httpError("Result is not available yet", 403);
  }
  return toPublicStudentResult(ctx.latestResult);
}

export { toStudentResult, canReleaseResult };
