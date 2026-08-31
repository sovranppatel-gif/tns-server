import mongoose from "mongoose";
import {
  FACULTY_ATTENDANCE_METHODS,
  FACULTY_ATTENDANCE_STATUSES,
} from "./faculty.constants.js";

const facultyAttendanceSchema = new mongoose.Schema(
  {
    facultyMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
      index: true,
    },
    facultyCode: { type: String, default: "", trim: true, uppercase: true },
    date: { type: Date, required: true, index: true },
    checkInTime: { type: String, default: "", trim: true },
    checkOutTime: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: FACULTY_ATTENDANCE_STATUSES,
      default: "Present",
      index: true,
    },
    method: {
      type: String,
      enum: FACULTY_ATTENDANCE_METHODS,
      default: "Manual",
    },
    note: { type: String, default: "", trim: true },
    markedBy: { type: String, default: "master-admin", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

facultyAttendanceSchema.index({ facultyMongoId: 1, date: 1 }, { unique: true });

export const FacultyAttendance = mongoose.model("FacultyAttendance", facultyAttendanceSchema);
