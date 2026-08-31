import mongoose from "mongoose";
import {
  QUESTION_DIFFICULTIES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
} from "./exams.constants.js";

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    text: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const questionBankSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: QUESTION_TYPES,
      default: "Single Choice",
      index: true,
    },
    options: { type: [optionSchema], default: [] },
    correctAnswer: { type: mongoose.Schema.Types.Mixed, required: true },
    marks: { type: Number, default: 1, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    subject: { type: String, trim: true, default: "", index: true },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    difficulty: {
      type: String,
      enum: QUESTION_DIFFICULTIES,
      default: "Medium",
      index: true,
    },
    explanation: { type: String, trim: true, default: "" },
    seedKey: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    sourceExam: { type: String, trim: true, default: "" },
    sourceDate: { type: String, trim: true, default: "" },
    sourceInstitute: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: QUESTION_STATUSES,
      default: "Active",
      index: true,
    },
    createdBy: { type: String, trim: true, default: "master-admin" },
    updatedBy: { type: String, trim: true, default: "master-admin" },
    softDelete: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

questionBankSchema.index({ softDelete: 1, courseId: 1, status: 1 });
questionBankSchema.index({ softDelete: 1, subject: 1, type: 1 });
questionBankSchema.index({ softDelete: 1, difficulty: 1, status: 1 });
questionBankSchema.index(
  { seedKey: 1 },
  {
    unique: true,
    name: "uniq_question_seed_key",
    partialFilterExpression: {
      seedKey: { $type: "string", $gt: "" },
    },
  }
);

export const QuestionBank = mongoose.model("QuestionBank", questionBankSchema);
