import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    section: { type: String, required: true, index: true, trim: true },
    action: { type: String, required: true, trim: true },
    method: { type: String, default: "", trim: true },
    path: { type: String, default: "", trim: true },
    actor: { type: String, default: "system", trim: true },
    resourceId: { type: String, default: "", trim: true },
    message: { type: String, default: "", trim: true },
    statusCode: { type: Number, default: 200 },
    ip: { type: String, default: "", trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ section: 1, createdAt: -1 });

export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
