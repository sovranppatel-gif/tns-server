import mongoose from "mongoose";
import { ATTEMPT_STATUSES } from "./exams.constants.js";

const attemptAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    answeredAt: { type: Date, default: Date.now },
    visited: { type: Boolean, default: true },
    markedForReview: { type: Boolean, default: false },
  },
  { _id: false }
);

const examAttemptSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamSchedule",
      required: true,
      index: true,
    },
    examPaperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamPaper",
      default: null,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    attemptNumber: { type: Number, default: 1, min: 1 },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    answers: { type: [attemptAnswerSchema], default: [] },
    currentIndex: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ATTEMPT_STATUSES,
      default: "In Progress",
      index: true,
    },
  },
  { timestamps: true, versionKey: false }
);

examAttemptSchema.index({ examId: 1, studentId: 1, attemptNumber: 1 });
examAttemptSchema.index({ examId: 1, studentId: 1, status: 1 });
examAttemptSchema.index(
  { examId: 1, studentId: 1, status: 1 },
  {
    unique: true,
    name: "uniq_active_exam_attempt",
    partialFilterExpression: { status: "In Progress" },
  }
);

export const ExamAttempt = mongoose.model("ExamAttempt", examAttemptSchema);
