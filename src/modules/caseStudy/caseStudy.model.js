import mongoose from "mongoose";

const caseStudyMetricSchema = new mongoose.Schema(
  {
    value: { type: String, trim: true, required: true },
    label: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const caseStudyStripSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    description: { type: String, trim: true, required: true },
    snapshotLabel: { type: String, trim: true, default: "Snapshot" },
    metrics: { type: [caseStudyMetricSchema], default: [] },
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

caseStudyStripSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const CaseStudyStripModel = mongoose.model("CaseStudyStrip", caseStudyStripSchema);
