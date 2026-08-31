import mongoose from "mongoose";

export const BATCH_STATUSES = ["Upcoming", "Running", "Completed", "Archived"];

const batchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    courseName: { type: String, default: "", trim: true },
    courseCode: { type: String, default: "", trim: true },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    universityName: { type: String, default: "", trim: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, default: null },
    currentSemester: { type: Number, default: 1, min: 1 },
    capacity: { type: Number, default: 40, min: 1 },
    enrolledCount: { type: Number, default: 0, min: 0 },
    faculty: { type: String, default: "", trim: true },
    schedule: { type: String, default: "Mon–Sat · Morning", trim: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: BATCH_STATUSES,
      default: "Running",
      index: true,
    },
    softDelete: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "system", trim: true },
    updatedBy: { type: String, default: "system", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

batchSchema.index({ softDelete: 1, courseId: 1, startDate: 1 });
batchSchema.index({ softDelete: 1, status: 1, startDate: -1 });
batchSchema.index(
  { courseId: 1, startDate: 1, name: 1 },
  { unique: true, partialFilterExpression: { softDelete: false } }
);

export const Batch = mongoose.model("Batch", batchSchema);
