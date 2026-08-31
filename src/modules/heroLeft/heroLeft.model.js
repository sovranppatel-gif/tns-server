import mongoose from "mongoose";

const heroLeftSchema = new mongoose.Schema(
  {
    sectionLabel: { type: String, trim: true, required: true },
    badgeLabel: { type: String, trim: true, required: true },
    headlineLine1: { type: String, trim: true, required: true },
    headlineLine2: { type: String, trim: true, required: true },
    bodyParagraph1: { type: String, trim: true, required: true },
    highlightPhrase: { type: String, trim: true, default: "" },
    bodyParagraph2: { type: String, trim: true, required: true },
    bulletPoints: { type: [String], default: [] },
    primaryCtaLabel: { type: String, trim: true, required: true },
    primaryCtaHref: { type: String, trim: true, default: "#top" },
    secondaryCtaLabel: { type: String, trim: true, required: true },
    secondaryCtaPath: { type: String, trim: true, default: "/building-creativity" },
    socialProofText: { type: String, trim: true, required: true },
    /** Up to 3 avatar image URLs (e.g. `/uploads/hero-left/...`); empty slots use gradient placeholders on site */
    socialProofAvatarUrls: { type: [String], default: [] },
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

heroLeftSchema.index({ softDelete: 1, displayOrder: 1, createdAt: -1 });

export const HeroLeftSection = mongoose.model("HeroLeftSection", heroLeftSchema);
