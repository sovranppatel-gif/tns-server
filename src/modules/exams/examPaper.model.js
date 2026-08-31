import mongoose from "mongoose";
import { PAPER_STATUSES, QUESTION_TYPES } from "./exams.constants.js";

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    text: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const paperQuestionSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    text: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: QUESTION_TYPES,
      default: "Single Choice",
    },
    options: { type: [optionSchema], default: [] },
    correctAnswer: { type: mongoose.Schema.Types.Mixed, required: true },
    marks: { type: Number, default: 1, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    explanation: { type: String, trim: true, default: "" },
    difficulty: { type: String, trim: true, default: "Medium" },
    subject: { type: String, trim: true, default: "" },
    order: { type: Number, default: 1 },
  },
  { _id: false }
);

const examPaperSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true, default: "" },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    universityName: { type: String, trim: true, default: "" },
    courseName: { type: String, trim: true, default: "" },
    courseCode: { type: String, trim: true, default: "" },
    batchName: { type: String, trim: true, default: "" },
    subject: { type: String, trim: true, default: "" },
    durationMinutes: { type: Number, default: 60, min: 1 },
    passingPercentage: { type: Number, default: 40, min: 0, max: 100 },
    negativeMarkingEnabled: { type: Boolean, default: false },
    instructions: { type: [String], default: [] },
    questions: { type: [paperQuestionSchema], default: [] },
    totalQuestions: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    version: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: PAPER_STATUSES,
      default: "Draft",
      index: true,
    },
    publishedAt: { type: Date, default: null },
    createdBy: { type: String, trim: true, default: "master-admin" },
    updatedBy: { type: String, trim: true, default: "master-admin" },
    softDelete: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

examPaperSchema.index({ softDelete: 1, code: 1 });
examPaperSchema.index({ softDelete: 1, courseId: 1, status: 1 });
examPaperSchema.index(
  { code: 1, softDelete: 1 },
  {
    unique: true,
    name: "uniq_active_exam_paper_code",
    partialFilterExpression: { softDelete: false },
  }
);

export const ExamPaper = mongoose.model("ExamPaper", examPaperSchema);
