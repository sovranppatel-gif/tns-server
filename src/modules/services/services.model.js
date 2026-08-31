import mongoose from "mongoose";

const serviceItemSchema = new mongoose.Schema(
  {
    iconKey: { type: String, trim: true, default: "Code" },
    title: { type: String, trim: true, required: true },
    desc: { type: String, trim: true, required: true },
    features: { type: [String], default: [] },
  },
  { _id: false }
);

const servicesSectionSchema = new mongoose.Schema(
  {
    sectionBadgeLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    description: { type: String, trim: true, required: true },
    ctaLabel: { type: String, trim: true, default: "Explore this service" },
    items: { type: [serviceItemSchema], default: [] },
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

servicesSectionSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const ServicesSection = mongoose.model("ServicesSection", servicesSectionSchema);
