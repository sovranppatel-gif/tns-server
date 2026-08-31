import mongoose from "mongoose";
import { RESULT_VISIBILITY, SCHEDULE_STATUSES } from "./exams.constants.js";

const examScheduleSchema = new mongoose.Schema(
  {
    examPaperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamPaper",
      required: true,
      index: true,
    },
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
      index: true,
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 60, min: 1 },
    attemptLimit: { type: Number, default: 1, min: 1 },
    instructions: { type: [String], default: [] },
    resultVisibility: {
      type: String,
      enum: RESULT_VISIBILITY,
      default: "Immediately",
    },
    resultsReleased: { type: Boolean, default: false },
    status: {
      type: String,
      enum: SCHEDULE_STATUSES,
      default: "Scheduled",
      index: true,
    },
    assignedCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: String, trim: true, default: "master-admin" },
    updatedBy: { type: String, trim: true, default: "master-admin" },
    softDelete: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

examScheduleSchema.index({ examPaperId: 1, batchId: 1, startAt: 1 });
examScheduleSchema.index({ softDelete: 1, status: 1, startAt: 1, endAt: 1 });

export const ExamSchedule = mongoose.model("ExamSchedule", examScheduleSchema);
