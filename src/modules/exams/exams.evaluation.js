import {
  answersMatch,
  isAnswerEmpty,
  normalizeSelectedAnswer,
  paperTotals,
  roundMarks,
  toNumber,
} from "./exams.helpers.js";

export function evaluateAttempt({ paper, answers = [], startedAt, submittedAt }) {
  const questions = Array.isArray(paper?.questions) ? paper.questions : [];
  const totals = paperTotals(questions);
  const answerMap = new Map(
    (Array.isArray(answers) ? answers : []).map((row) => [
      String(row.questionId),
      row,
    ])
  );

  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  let obtainedMarks = 0;
  const breakdown = [];

  for (const question of questions) {
    const questionId = String(question.questionId || question._id || "");
    const saved = answerMap.get(questionId);
    const selected = saved?.selectedAnswer;
    const empty = isAnswerEmpty(question.type, selected);
    let verdict = "unanswered";
    let questionMarks = 0;

    if (empty) {
      unanswered += 1;
    } else if (answersMatch(question.type, selected, question.correctAnswer)) {
      correct += 1;
      questionMarks = toNumber(question.marks, 0);
      verdict = "correct";
    } else {
      wrong += 1;
      verdict = "wrong";
      if (paper?.negativeMarkingEnabled) {
        questionMarks = -Math.abs(toNumber(question.negativeMarks, 0));
      }
    }

    obtainedMarks += questionMarks;
    breakdown.push({
      questionId,
      text: question.text || "",
      type: question.type,
      options: question.options || [],
      studentAnswer: empty
        ? question.type === "Multiple Choice"
          ? []
          : ""
        : normalizeSelectedAnswer(question.type, selected),
      correctAnswer: question.correctAnswer,
      marks: toNumber(question.marks, 0),
      negativeMarks: toNumber(question.negativeMarks, 0),
      obtainedMarks: roundMarks(questionMarks),
      verdict,
      explanation: question.explanation || "",
    });
  }

  obtainedMarks = roundMarks(Math.max(0, obtainedMarks));
  const totalMarks = totals.totalMarks;
  const percentage =
    totalMarks > 0 ? roundMarks((obtainedMarks / totalMarks) * 100) : 0;
  const passingPercentage = toNumber(paper?.passingPercentage, 40);
  const result = percentage >= passingPercentage ? "PASS" : "FAIL";

  const start = startedAt ? new Date(startedAt) : null;
  const end = submittedAt ? new Date(submittedAt) : new Date();
  const timeTakenSeconds =
    start && !Number.isNaN(start.getTime())
      ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
      : 0;

  return {
    totalQuestions: totals.totalQuestions,
    attempted: correct + wrong,
    correct,
    wrong,
    unanswered,
    totalMarks,
    obtainedMarks,
    percentage,
    passingPercentage,
    result,
    timeTakenSeconds,
    breakdown,
  };
}

export function toStudentResult(resultDoc, { includeBreakdown = false } = {}) {
  if (!resultDoc) return null;
  const d = resultDoc.toObject ? resultDoc.toObject() : resultDoc;
  const payload = {
    id: String(d._id),
    examId: String(d.examId),
    attemptId: String(d.attemptId),
    studentId: String(d.studentId),
    examTitle: d.examTitle || "",
    studentName: d.studentName || "",
    courseName: d.courseName || "",
    batchName: d.batchName || "",
    examDate: d.examDate || d.createdAt,
    totalQuestions: d.totalQuestions,
    attempted: d.attempted,
    correct: d.correct,
    wrong: d.wrong,
    unanswered: d.unanswered,
    totalMarks: d.totalMarks,
    obtainedMarks: d.obtainedMarks,
    percentage: d.percentage,
    passingPercentage: d.passingPercentage,
    result: d.result,
    timeTakenSeconds: d.timeTakenSeconds,
    status: d.status || "Submitted",
    submittedAt: d.submittedAt,
    released: d.released !== false,
  };
  if (includeBreakdown) {
    payload.breakdown = Array.isArray(d.breakdown) ? d.breakdown : [];
  }
  return payload;
}

export function toPublicStudentResult(resultDoc) {
  const full = toStudentResult(resultDoc, { includeBreakdown: false });
  if (!full) return null;
  return full;
}
