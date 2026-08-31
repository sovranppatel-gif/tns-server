import mongoose from "mongoose";
import { User, USER_TYPES } from "../../models/User.js";
import { Student } from "../students/students.model.js";
import { QUESTION_TYPES } from "./exams.constants.js";

export function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

export function asObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

export function idStr(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMarks(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function optionKey(value) {
  return String(value || "").trim();
}

export function isMultiType(type) {
  return String(type) === "Multiple Choice";
}

export function normalizeSelectedAnswer(type, raw) {
  if (raw == null || raw === "") return isMultiType(type) ? [] : "";
  if (isMultiType(type)) {
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    const keys = [
      ...new Set(list.map((item) => optionKey(item)).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    return keys;
  }
  if (Array.isArray(raw)) return optionKey(raw[0]);
  return optionKey(raw);
}

export function normalizeCorrectAnswer(type, raw) {
  return normalizeSelectedAnswer(type, raw);
}

export function answersMatch(type, selected, correct) {
  const a = normalizeSelectedAnswer(type, selected);
  const b = normalizeCorrectAnswer(type, correct);
  if (isMultiType(type)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length === 0 || b.length === 0) return false;
    if (a.length !== b.length) return false;
    return a.every((key, index) => key === b[index]);
  }
  return String(a) !== "" && String(a) === String(b);
}

export function isAnswerEmpty(type, selected) {
  const value = normalizeSelectedAnswer(type, selected);
  if (isMultiType(type)) return !Array.isArray(value) || value.length === 0;
  return String(value || "").trim() === "";
}

export function stripAnswerKey(question = {}) {
  return {
    questionId: String(question.questionId || question._id || ""),
    text: question.text || "",
    type: question.type || "Single Choice",
    options: Array.isArray(question.options)
      ? question.options.map((opt) => ({
          key: opt.key,
          text: opt.text,
        }))
      : [],
    marks: toNumber(question.marks, 1),
    negativeMarks: toNumber(question.negativeMarks, 0),
  };
}

export function snapshotQuestion(question = {}, overrides = {}) {
  const type = QUESTION_TYPES.includes(question.type)
    ? question.type
    : "Single Choice";
  const questionId =
    asObjectId(overrides.questionId || question.questionId || question._id) ||
    new mongoose.Types.ObjectId();
  return {
    questionId,
    text: String(question.text || "").trim(),
    type,
    options: Array.isArray(question.options)
      ? question.options.map((opt) => ({
          key: optionKey(opt.key || opt.label),
          text: String(opt.text || "").trim(),
        }))
      : [],
    correctAnswer: normalizeCorrectAnswer(type, question.correctAnswer),
    marks: toNumber(overrides.marks ?? question.marks, 1),
    negativeMarks: toNumber(
      overrides.negativeMarks ?? question.negativeMarks,
      0
    ),
    explanation: String(question.explanation || "").trim(),
    difficulty: question.difficulty || "Medium",
    subject: String(question.subject || "").trim(),
  };
}

export function paperTotals(questions = []) {
  const list = Array.isArray(questions) ? questions : [];
  return {
    totalQuestions: list.length,
    totalMarks: roundMarks(
      list.reduce((sum, q) => sum + toNumber(q.marks, 0), 0)
    ),
  };
}

export function deriveScheduleStatus(schedule, now = new Date()) {
  if (!schedule) return "Scheduled";
  if (schedule.status === "Cancelled") return "Cancelled";
  const start = schedule.startAt ? new Date(schedule.startAt) : null;
  const end = schedule.endAt ? new Date(schedule.endAt) : null;
  if (end && now > end) return "Completed";
  if (start && end && now >= start && now <= end) return "Live";
  if (start && now < start) return "Scheduled";
  return schedule.status || "Scheduled";
}

export function extraAttemptLimit(schedule, assignment) {
  return (
    Math.max(1, toNumber(schedule?.attemptLimit, 1)) +
    Math.max(0, toNumber(assignment?.extraAttempts, 0))
  );
}

export function completedAttemptCount(attempts = []) {
  return (Array.isArray(attempts) ? attempts : []).filter(
    (row) => row?.status && row.status !== "In Progress"
  ).length;
}

export function isReexamWindowOpen(assignment, now = new Date()) {
  if (!assignment?.reexamUntil) return false;
  const until = new Date(assignment.reexamUntil);
  return !Number.isNaN(until.getTime()) && now <= until;
}

export function canStudentStartExam({
  schedule,
  assignment,
  attempts = [],
  now = new Date(),
} = {}) {
  if (!schedule || !assignment) return false;
  if (schedule.status === "Cancelled" || assignment.status === "Cancelled") {
    return false;
  }
  const used = completedAttemptCount(attempts);
  const limit = extraAttemptLimit(schedule, assignment);
  if (used >= limit) return false;
  if (!["Assigned", "Started"].includes(assignment.status)) return false;
  const derived = deriveScheduleStatus(schedule, now);
  if (derived === "Live") return true;
  return isReexamWindowOpen(assignment, now);
}

export function formatDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateLabel(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatTimeLabel(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export async function resolveErpStudent(reqStudent) {
  const email = String(reqStudent?.email || "")
    .toLowerCase()
    .trim();
  if (!email) throw httpError("Student authentication required", 401);

  const user = await User.findOne({
    type: USER_TYPES.STUDENT,
    email,
  })
    .select("_id email name erpStudentId")
    .lean()
    .maxTimeMS(5000);

  let student = null;
  if (user?.erpStudentId) {
    student = await Student.findById(user.erpStudentId)
      .select(
        "_id studentId admissionId nameEnglish contact courseId batchId universityId courseName batchName universityName universityShortName status"
      )
      .lean()
      .maxTimeMS(5000);
  }

  if (!student) {
    student = await Student.findOne({ "contact.email": email })
      .select(
        "_id studentId admissionId nameEnglish contact courseId batchId universityId courseName batchName universityName universityShortName status"
      )
      .lean()
      .maxTimeMS(5000);
  }

  if (!student) {
    throw httpError(
      "No ERP student profile is linked to this login. Contact the institute.",
      403
    );
  }

  return {
    user,
    student,
    studentId: student._id,
    email,
    name: student.nameEnglish || user?.name || reqStudent?.name || "",
  };
}

export function studentEmailOf(student) {
  return String(student?.contact?.email || "")
    .toLowerCase()
    .trim();
}

export function populateLabel(doc, field, fallbackName = "") {
  const value = doc?.[field];
  if (value && typeof value === "object") {
    return value.name || value.shortName || fallbackName || "";
  }
  return fallbackName || "";
}
