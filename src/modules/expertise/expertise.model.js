import mongoose from "mongoose";

const expertiseItemSchema = new mongoose.Schema(
  {
    iconKey: { type: String, trim: true, default: "Code" },
    title: { type: String, trim: true, required: true },
    desc: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const expertiseSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    description: { type: String, trim: true, required: true },
    items: { type: [expertiseItemSchema], default: [] },
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

expertiseSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const Expertise = mongoose.model("Expertise", expertiseSchema);
