import mongoose from "mongoose";
import { ASSIGNMENT_STATUSES } from "./faculty.constants.js";

const facultyAssignmentSchema = new mongoose.Schema(
  {
    facultyMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
      index: true,
    },
    facultyCode: { type: String, default: "", trim: true, uppercase: true, index: true },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
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
      default: null,
      index: true,
    },
    semester: { type: Number, default: null, min: 1 },
    subjectName: { type: String, required: true, trim: true },
    subjectCode: { type: String, default: "", trim: true },
    subjectKey: { type: String, required: true, trim: true },
    academicYear: { type: String, default: "", trim: true },
    universityName: { type: String, default: "", trim: true },
    courseName: { type: String, default: "", trim: true },
    batchName: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ASSIGNMENT_STATUSES,
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

facultyAssignmentSchema.index(
  {
    facultyMongoId: 1,
    courseId: 1,
    batchId: 1,
    semester: 1,
    subjectKey: 1,
    softDelete: 1,
  },
  {
    unique: true,
    name: "uniq_faculty_assignment",
    partialFilterExpression: { softDelete: false },
  }
);

export const FacultyAssignment = mongoose.model("FacultyAssignment", facultyAssignmentSchema);
