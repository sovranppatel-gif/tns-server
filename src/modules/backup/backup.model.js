import mongoose from "mongoose";

const backupSchema = new mongoose.Schema(
  {
    backupId: { type: String, required: true, unique: true, index: true, trim: true },
    filename: { type: String, required: true, trim: true },
    filepath: { type: String, required: true, trim: true },
    scope: { type: String, required: true, default: "all", trim: true },
    createdBy: { type: String, default: "", trim: true },
    bytes: { type: Number, default: 0 },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    collectionCount: { type: Number, default: 0 },
    documentCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Ready", "Failed"],
      default: "Ready",
      index: true,
    },
    error: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

backupSchema.index({ createdAt: -1 });

export const Backup = mongoose.model("Backup", backupSchema);
