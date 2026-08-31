import { Router } from "express";
import { SiteSettings } from "../models/SiteSettings.js";
import { requireMasterAdminJwt } from "../middleware/requireMasterAdminJwt.js";

const router = Router();

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizePayload(raw = {}) {
  return {
    companyName: normalizeString(raw.companyName),
    tagline: normalizeString(raw.tagline),
    contactPhone: normalizeString(raw.contactPhone),
    contactEmail: normalizeString(raw.contactEmail),
    socialLinks: {
      facebook: normalizeString(raw.socialLinks?.facebook),
      instagram: normalizeString(raw.socialLinks?.instagram),
      linkedin: normalizeString(raw.socialLinks?.linkedin),
      twitter: normalizeString(raw.socialLinks?.twitter),
      youtube: normalizeString(raw.socialLinks?.youtube),
    },
    legalLinks: {
      privacy: normalizeString(raw.legalLinks?.privacy) || "#",
      terms: normalizeString(raw.legalLinks?.terms) || "#",
    },
  };
}

async function getOrCreateLandingSettings() {
  let doc = await SiteSettings.findOne({ key: "landing" });
  if (!doc) {
    doc = await SiteSettings.create({ key: "landing" });
  }
  return doc;
}

router.get("/landing", async (_req, res) => {
  try {
    const doc = await getOrCreateLandingSettings();
    return res.json({ success: true, settings: doc.toObject() });
  } catch (err) {
    console.error("site settings fetch error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch settings" });
  }
});

router.put("/landing", requireMasterAdminJwt, async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const updated = await SiteSettings.findOneAndUpdate(
      { key: "landing" },
      { ...payload, updatedBy: req.masterAdmin?.email || "master-admin" },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, message: "Settings updated successfully", settings: updated });
  } catch (err) {
    console.error("site settings update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update settings" });
  }
});

export default router;
