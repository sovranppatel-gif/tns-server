import mongoose from "mongoose";

const socialLinksSchema = new mongoose.Schema(
  {
    facebook: { type: String, trim: true, default: "" },
    instagram: { type: String, trim: true, default: "" },
    linkedin: { type: String, trim: true, default: "" },
    twitter: { type: String, trim: true, default: "" },
    youtube: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const legalLinksSchema = new mongoose.Schema(
  {
    privacy: { type: String, trim: true, default: "#" },
    terms: { type: String, trim: true, default: "#" },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "landing" },
    companyName: { type: String, trim: true, default: "Scholars Mediatech" },
    tagline: {
      type: String,
      trim: true,
      default: "Building Your Creativity-Connect your community",
    },
    contactPhone: { type: String, trim: true, default: "+91 91718 91705" },
    contactEmail: { type: String, trim: true, default: "hello@scholarsmediatech.com" },
    socialLinks: { type: socialLinksSchema, default: () => ({}) },
    legalLinks: { type: legalLinksSchema, default: () => ({}) },
    updatedBy: { type: String, trim: true, default: "system" },
  },
  { timestamps: true }
);

export const SiteSettings = mongoose.model("SiteSettings", siteSettingsSchema);
