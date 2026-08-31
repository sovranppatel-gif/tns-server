import mongoose from "mongoose";
import { TIMETABLE_DAYS, TIMETABLE_STATUSES } from "./faculty.constants.js";

const facultyTimetableSchema = new mongoose.Schema(
  {
    facultyMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
      index: true,
    },
    facultyCode: { type: String, default: "", trim: true, uppercase: true },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FacultyAssignment",
      default: null,
    },
    semester: { type: Number, default: null },
    subjectName: { type: String, required: true, trim: true },
    subjectCode: { type: String, default: "", trim: true },
    day: { type: String, enum: TIMETABLE_DAYS, required: true, index: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    room: { type: String, default: "", trim: true, index: true },
    universityName: { type: String, default: "", trim: true },
    courseName: { type: String, default: "", trim: true },
    batchName: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: TIMETABLE_STATUSES,
      default: "Active",
      index: true,
    },
    softDelete: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

facultyTimetableSchema.index({ facultyMongoId: 1, day: 1, startTime: 1, softDelete: 1 });
facultyTimetableSchema.index({ batchId: 1, day: 1, startTime: 1, softDelete: 1 });
facultyTimetableSchema.index({ room: 1, day: 1, startTime: 1, softDelete: 1 });

export const FacultyTimetable = mongoose.model("FacultyTimetable", facultyTimetableSchema);
