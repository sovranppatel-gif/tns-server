import mongoose from "mongoose";

const aboutStatSchema = new mongoose.Schema(
  {
    value: { type: String, trim: true, required: true },
    label: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const aboutSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    descriptionOne: { type: String, trim: true, required: true },
    descriptionTwo: { type: String, trim: true, default: "" },
    stats: { type: [aboutStatSchema], default: [] },
    ctaText: { type: String, trim: true, default: "" },
    ctaHighlightText: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
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

aboutSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const About = mongoose.model("About", aboutSchema);
