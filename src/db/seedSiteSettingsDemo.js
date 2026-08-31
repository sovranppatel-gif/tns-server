import { SiteSettings } from "../models/SiteSettings.js";

export const defaultSettings = {
  key: "landing",
  companyName: "Grow Skills Tech",
  tagline: "Innovation. Technology. Growth.",
  contactPhone: "+917470834876",
  contactEmail: "growskillstech@gmail.com",
  socialLinks: {
    facebook: "https://www.facebook.com/profile.php?id=61576749813417",
    instagram: "https://www.instagram.com/scholarsmediatech/?hl=en",
    linkedin: "https://www.linkedin.com/company/scholars-mediatech-pvt-ltd/",
    twitter: "https://x.com/scholarsmediatech",
    youtube: "https://www.youtube.com/@scholarsmediatech",
  },
  legalLinks: {
    privacy: "#",
    terms: "#",
  },
  updatedBy: "system-seed",
};

export async function seedSiteSettingsDemo({ upsert = false } = {}) {
  if (upsert) {
    await SiteSettings.findOneAndUpdate(
      { key: "landing" },
      { $set: defaultSettings },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log("Updated demo landing site settings");
    return;
  }

  const existing = await SiteSettings.findOne({ key: "landing" }).lean();
  if (existing) return;

  await SiteSettings.create(defaultSettings);
  console.log("Seeded demo landing site settings");
}
