import mongoose from "mongoose";
import {
  ATTEMPT_STATUSES,
  PAPER_STATUSES,
  QUESTION_DIFFICULTIES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  RESULT_VISIBILITY,
  SCHEDULE_STATUSES,
  defaultOptionsForType,
} from "./exams.constants.js";
import {
  isMultiType,
  normalizeCorrectAnswer,
  optionKey,
  toNumber,
} from "./exams.helpers.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function asId(value) {
  const raw = String(value || "").trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return raw;
}

function normalizeOptions(type, raw) {
  const fallback = defaultOptionsForType(type);
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const options = raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const key =
        optionKey(item.key || item.label) ||
        fallback[index]?.key ||
        String.fromCharCode(65 + index);
      const text = normalizeString(item.text);
      return { key, text };
    })
    .filter(Boolean);
  if (type === "True / False" || type === "Yes / No") {
    return fallback.map((opt) => {
      const found = options.find((row) => row.key === opt.key);
      return { key: opt.key, text: found?.text || opt.text };
    });
  }
  return options.length ? options : fallback;
}

export function normalizeQuestionPayload(raw = {}) {
  const type = QUESTION_TYPES.includes(raw.type) ? raw.type : "Single Choice";
  const options = normalizeOptions(type, raw.options);
  return {
    text: normalizeString(raw.text),
    type,
    options,
    correctAnswer: normalizeCorrectAnswer(type, raw.correctAnswer),
    marks: Math.max(0, toNumber(raw.marks, 1)),
    negativeMarks: Math.max(0, toNumber(raw.negativeMarks, 0)),
    subject: normalizeString(raw.subject),
    courseId: asId(raw.courseId),
    universityId: asId(raw.universityId),
    difficulty: QUESTION_DIFFICULTIES.includes(raw.difficulty)
      ? raw.difficulty
      : "Medium",
    explanation: normalizeString(raw.explanation),
    status: QUESTION_STATUSES.includes(raw.status) ? raw.status : "Active",
  };
}

export function validateQuestionPayload(payload, { requireStatus = true } = {}) {
  if (!payload.text) return "Question text is required";
  if (!QUESTION_TYPES.includes(payload.type)) return "Invalid question type";
  if (!payload.options.length) return "Options are required";
  if (payload.type === "Single Choice" || payload.type === "Multiple Choice") {
    const filled = payload.options.filter((opt) => opt.text);
    if (filled.length < 2) return "At least two options are required";
  }
  const keys = new Set(payload.options.map((opt) => opt.key));
  const correct = payload.correctAnswer;
  if (isMultiType(payload.type)) {
    if (!Array.isArray(correct) || correct.length === 0) {
      return "Select at least one correct answer";
    }
    if (correct.some((key) => !keys.has(key))) {
      return "Correct answers must match option keys";
    }
  } else if (!correct || !keys.has(String(correct))) {
    return "A valid correct answer is required";
  }
  if (payload.marks <= 0) return "Marks must be greater than 0";
  if (payload.negativeMarks < 0) return "Negative marks cannot be below 0";
  if (!QUESTION_DIFFICULTIES.includes(payload.difficulty)) {
    return "Invalid difficulty";
  }
  // Paper snapshots do not store Question Bank status (Active / Inactive / Draft).
  if (requireStatus || payload.status) {
    if (!QUESTION_STATUSES.includes(payload.status)) return "Invalid status";
  }
  return null;
}

function normalizePaperQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const type = QUESTION_TYPES.includes(item.type)
        ? item.type
        : "Single Choice";
      return {
        questionId: asId(item.questionId) || new mongoose.Types.ObjectId(),
        text: normalizeString(item.text),
        type,
        options: normalizeOptions(type, item.options),
        correctAnswer: normalizeCorrectAnswer(type, item.correctAnswer),
        marks: Math.max(0, toNumber(item.marks, 1)),
        negativeMarks: Math.max(0, toNumber(item.negativeMarks, 0)),
        explanation: normalizeString(item.explanation),
        difficulty: QUESTION_DIFFICULTIES.includes(item.difficulty)
          ? item.difficulty
          : "Medium",
        subject: normalizeString(item.subject),
        order: toNumber(item.order, index + 1) || index + 1,
      };
    })
    .filter((item) => item && item.text);
}

export function normalizePaperPayload(raw = {}) {
  const questions = normalizePaperQuestions(raw.questions);
  return {
    title: normalizeString(raw.title),
    code: normalizeString(raw.code).toUpperCase(),
    description: normalizeString(raw.description),
    universityId: asId(raw.universityId),
    courseId: asId(raw.courseId),
    batchId: asId(raw.batchId),
    subject: normalizeString(raw.subject),
    durationMinutes: Math.max(1, toNumber(raw.durationMinutes, 60)),
    passingPercentage: Math.min(100, Math.max(0, toNumber(raw.passingPercentage, 40))),
    negativeMarkingEnabled: Boolean(raw.negativeMarkingEnabled),
    instructions: Array.isArray(raw.instructions)
      ? raw.instructions.map((row) => normalizeString(row)).filter(Boolean)
      : typeof raw.instructions === "string"
        ? String(raw.instructions)
            .split("\n")
            .map((row) => row.replace(/^\d+\.\s*/, "").trim())
            .filter(Boolean)
        : [],
    questions,
    status: PAPER_STATUSES.includes(raw.status) ? raw.status : "Draft",
  };
}

export function validatePaperPayload(payload, { publishing = false } = {}) {
  if (!payload.title) return "Exam title is required";
  if (!payload.code) return "Exam code is required";
  if (payload.durationMinutes < 1) return "Duration must be at least 1 minute";
  if (publishing || payload.status === "Published") {
    if (!payload.questions.length) return "Add at least one question before publishing";
    for (const question of payload.questions) {
      const error = validateQuestionPayload(question, { requireStatus: false });
      if (error) return error;
    }
  }
  return null;
}

function combineDateTime(dateValue, timeValue) {
  const datePart = normalizeString(dateValue);
  const timePart = normalizeString(timeValue) || "00:00";
  if (!datePart) return null;
  const iso = datePart.includes("T") ? datePart : `${datePart}T${timePart}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeSchedulePayload(raw = {}) {
  const startAt =
    raw.startAt != null
      ? new Date(raw.startAt)
      : combineDateTime(raw.startDate, raw.startTime);
  const endAt =
    raw.endAt != null
      ? new Date(raw.endAt)
      : combineDateTime(raw.endDate, raw.endTime);
  return {
    examPaperId: asId(raw.examPaperId || raw.examId),
    universityId: asId(raw.universityId),
    courseId: asId(raw.courseId),
    batchId: asId(raw.batchId),
    studentIds: Array.isArray(raw.studentIds)
      ? raw.studentIds.map((id) => asId(id)).filter(Boolean)
      : [],
    startAt,
    endAt,
    durationMinutes: Math.max(1, toNumber(raw.durationMinutes, 60)),
    attemptLimit: Math.max(1, toNumber(raw.attemptLimit, 1)),
    instructions: Array.isArray(raw.instructions)
      ? raw.instructions.map((row) => normalizeString(row)).filter(Boolean)
      : [],
    resultVisibility: RESULT_VISIBILITY.includes(raw.resultVisibility)
      ? raw.resultVisibility
      : "Immediately",
    status: SCHEDULE_STATUSES.includes(raw.status) ? raw.status : "Scheduled",
  };
}

export function validateSchedulePayload(payload) {
  if (!payload.examPaperId) return "Exam paper is required";
  if (!payload.startAt || Number.isNaN(payload.startAt.getTime())) {
    return "Start date and time are required";
  }
  if (!payload.endAt || Number.isNaN(payload.endAt.getTime())) {
    return "End date and time are required";
  }
  if (payload.endAt <= payload.startAt) {
    return "End time must be after start time";
  }
  if (!payload.studentIds.length && !payload.batchId) {
    return "Select a batch or at least one student";
  }
  return null;
}

export { ATTEMPT_STATUSES };
