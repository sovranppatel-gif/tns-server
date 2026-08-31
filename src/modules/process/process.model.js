import mongoose from "mongoose";

const processStepSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, required: true },
    title: { type: String, trim: true, required: true },
    desc: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const processSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    description: { type: String, trim: true, required: true },
    steps: { type: [processStepSchema], default: [] },
    isVisible: { type: Boolean, default: true },
    publishStatus: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    displayOrder: { type: Number, default: 1, index: true },
    createdBy: { type: String, trim: true, default: "system" },
    updatedBy: { type: String, trim: true, default: "system" },
    softDelete: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

processSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const Process = mongoose.model("Process", processSchema);
