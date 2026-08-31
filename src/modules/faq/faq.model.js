import mongoose from "mongoose";

const faqItemSchema = new mongoose.Schema(
  {
    question: { type: String, trim: true, required: true },
    answer: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const faqSectionSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    heading: { type: String, trim: true, required: true },
    items: { type: [faqItemSchema], default: [] },
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

faqSectionSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const FaqSectionModel = mongoose.model("FaqSection", faqSectionSchema);
