import mongoose from "mongoose";
import { ASSIGNMENT_STATUSES } from "./exams.constants.js";

const examAssignmentSchema = new mongoose.Schema(
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
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    assignedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ASSIGNMENT_STATUSES,
      default: "Assigned",
      index: true,
    },
    extraAttempts: { type: Number, default: 0, min: 0 },
    reexamPending: { type: Boolean, default: false, index: true },
    reexamUntil: { type: Date, default: null },
    reexamAllottedAt: { type: Date, default: null },
    reexamAllottedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true, versionKey: false }
);

examAssignmentSchema.index({ examId: 1, studentId: 1 }, { unique: true });
examAssignmentSchema.index({ studentId: 1, status: 1, examId: 1 });

export const ExamAssignment = mongoose.model(
  "ExamAssignment",
  examAssignmentSchema
);
