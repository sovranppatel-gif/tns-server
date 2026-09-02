import mongoose from "mongoose";

const PROFILE_CHANGE_STATUSES = ["Pending", "Approved", "Rejected"];

const studentProfileChangeRequestSchema = new mongoose.Schema(
  {
    studentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studentEmail: { type: String, default: "", trim: true, lowercase: true },
    studentName: { type: String, default: "", trim: true },
    proposed: { type: mongoose.Schema.Types.Mixed, default: {} },
    currentSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: PROFILE_CHANGE_STATUSES,
      default: "Pending",
      index: true,
    },
    adminNote: { type: String, default: "", trim: true },
    reviewedBy: { type: String, default: "", trim: true },
    reviewedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

studentProfileChangeRequestSchema.index({ studentUserId: 1, status: 1 });
studentProfileChangeRequestSchema.index({ createdAt: -1 });

export { PROFILE_CHANGE_STATUSES };

export const StudentProfileChangeRequest = mongoose.model(
  "StudentProfileChangeRequest",
  studentProfileChangeRequestSchema
);
