import { Router } from "express";
import mongoose from "mongoose";
import { Enquiry } from "./enquiries.model.js";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createLeadFromEnquiry,
  getLeadIdsByEnquiryIds,
} from "../leads/leads.service.js";

const router = Router();

const ENQUIRY_TYPES = new Set(["client", "student"]);

const HEARD_ABOUT_OPTIONS = new Set([
  "Google / Search",
  "Instagram",
  "Facebook",
  "YouTube",
  "WhatsApp",
  "Friend / Family",
  "College / University",
  "Advertisement",
  "Partner / Counsellor",
  "Others",
]);

function normalizePayload(raw = {}) {
  const enquiryType = ENQUIRY_TYPES.has(String(raw.enquiryType || "").trim())
    ? String(raw.enquiryType).trim()
    : "client";

  const heardAbout = String(raw.heardAbout || "").trim();
  const heardAboutOther =
    heardAbout === "Others"
      ? String(raw.heardAboutOther || "").trim().slice(0, 200)
      : "";

  return {
    source: String(raw.source || "home").trim(),
    enquiryType,
    fullName: String(raw.fullName || "").trim(),
    companyOrCollege: String(raw.companyOrCollege || "").trim(),
    workEmail: String(raw.workEmail || "").trim().toLowerCase(),
    mobile: String(raw.mobile || "").trim(),
    city: String(raw.city || "").trim(),
    state: String(raw.state || "").trim(),
    serviceRequested: String(raw.serviceRequested || "").trim(),
    projectBudget: String(raw.projectBudget || "").trim(),
    projectDetails: String(raw.projectDetails || "").trim(),
    courseRequested: String(raw.courseRequested || "").trim(),
    studentStatus: String(raw.studentStatus || "").trim(),
    trainingGoals: String(raw.trainingGoals || "").trim(),
    allowUpdates: Boolean(raw.allowUpdates),
    heardAbout,
    heardAboutOther,
  };
}

function validateSubmission(payload) {
  if (!payload.fullName || !payload.workEmail || !payload.mobile) {
    return "Full name, email, and mobile number are required";
  }

  if (payload.enquiryType === "client" && !payload.serviceRequested) {
    return "Please select the IT service you require";
  }

  if (payload.enquiryType === "student" && !payload.courseRequested) {
    return "Please select the training course you are interested in";
  }

  if (!payload.heardAbout || !HEARD_ABOUT_OPTIONS.has(payload.heardAbout)) {
    return "Please select how you heard about us";
  }

  if (payload.heardAbout === "Others" && !payload.heardAboutOther) {
    return "Please tell us where you heard about us";
  }

  return null;
}

/** Avoid double-submit duplicates (same email + mobile within a few minutes). */
async function findRecentDuplicate(payload, windowMs = 5 * 60 * 1000) {
  const email = String(payload.workEmail || "").trim().toLowerCase();
  const mobileDigits = String(payload.mobile || "").replace(/\D/g, "").slice(-10);
  if (!email || mobileDigits.length < 10) return null;

  const since = new Date(Date.now() - windowMs);
  const recent = await Enquiry.find({
    workEmail: email,
    submittedAt: { $gte: since },
  })
    .sort({ submittedAt: -1 })
    .limit(5)
    .lean();

  return (
    recent.find((row) => {
      const rowMobile = String(row.mobile || "").replace(/\D/g, "").slice(-10);
      return rowMobile === mobileDigits;
    }) || null
  );
}

async function safeAutoCreateLead(enquiry, createdBy) {
  try {
    const result = await createLeadFromEnquiry(enquiry, {
      createdBy,
      actor: createdBy,
    });
    return result;
  } catch (err) {
    console.error("[enquiries] auto lead create failed:", err.message);
    return { lead: null, created: false, reason: "error" };
  }
}

function withLeadMeta(entry, leadResult) {
  const plain = entry?.toObject ? entry.toObject() : entry;
  return {
    ...plain,
    leadId: leadResult?.lead?._id || null,
    leadCreated: Boolean(leadResult?.created),
  };
}

router.post("/", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const validationError = validateSubmission(payload);

    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const duplicate = await findRecentDuplicate(payload);
    if (duplicate) {
      console.log(
        `[enquiries] duplicate submit ignored id=${duplicate._id} email=${duplicate.workEmail}`
      );
      const leadMap = await getLeadIdsByEnquiryIds([duplicate._id]);
      return res.status(200).json({
        success: true,
        message: "Enquiry already received",
        entry: {
          ...duplicate,
          leadId: leadMap.get(String(duplicate._id)) || null,
          leadCreated: false,
          duplicate: true,
        },
      });
    }

    const created = await Enquiry.create(payload);
    console.log(
      `[enquiries] saved id=${created._id} email=${created.workEmail} type=${created.enquiryType}`
    );

    const leadResult = await safeAutoCreateLead(created, "public-enquiry");

    return res.status(201).json({
      success: true,
      message: "Enquiry submitted successfully",
      entry: withLeadMeta(created, leadResult),
    });
  } catch (err) {
    console.error("enquiry create error:", err);
    return res.status(500).json({ success: false, message: "Failed to submit enquiry" });
  }
});

router.get("/", requireMasterAdminJwt, async (_req, res) => {
  try {
    const rows = await Enquiry.find().sort({ submittedAt: -1 }).lean();
    const leadMap = await getLeadIdsByEnquiryIds(rows.map((r) => r._id));
    const enriched = rows.map((row) => ({
      ...row,
      leadId: leadMap.get(String(row._id)) || null,
    }));
    return res.json({ success: true, rows: enriched });
  } catch (err) {
    console.error("enquiry list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
});

router.post("/admin", requireMasterAdminJwt, async (req, res) => {
  try {
    const raw = req.body || {};
    const payload = normalizePayload({
      ...raw,
      allowUpdates: raw.allowUpdates ?? false,
    });

    const validationError = validateSubmission(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const submittedAt =
      raw.submittedAt != null && String(raw.submittedAt).trim()
        ? new Date(raw.submittedAt)
        : new Date();
    if (Number.isNaN(submittedAt.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid submitted date" });
    }

    const editor = req.masterAdmin?.email || "master-admin";
    const created = await Enquiry.create({
      ...payload,
      submittedAt,
    });

    const leadResult = await safeAutoCreateLead(created, editor);

    return res.status(201).json({
      success: true,
      message: "Enquiry created",
      entry: withLeadMeta(created, leadResult),
    });
  } catch (err) {
    console.error("enquiry admin create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create enquiry" });
  }
});

/**
 * POST /api/enquiries/:id/convert-to-lead
 * Manual convert for older enquiries that were never promoted to a lead.
 */
router.post("/:id/convert-to-lead", requireMasterAdminJwt, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const enquiry = await Enquiry.findById(id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    const editor = req.masterAdmin?.email || "master-admin";
    const result = await createLeadFromEnquiry(enquiry, {
      createdBy: editor,
      actor: editor,
    });

    if (!result.lead && result.reason === "invalid_phone") {
      return res.status(400).json({
        success: false,
        message: "Cannot convert — enquiry needs a valid 10-digit mobile number",
      });
    }

    if (!result.lead) {
      return res.status(500).json({
        success: false,
        message: "Unable to convert enquiry to lead",
      });
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created
        ? "Enquiry converted to lead"
        : "Lead already exists for this enquiry",
      entry: result.lead,
      created: result.created,
      leadId: result.lead._id,
    });
  } catch (err) {
    console.error("enquiry convert-to-lead error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to convert enquiry to lead" });
  }
});

router.patch("/:id", requireMasterAdminJwt, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const payload = normalizePayload(req.body || {});
    const validationError = validateSubmission(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const update = { ...payload };
    const raw = req.body || {};
    if (raw.submittedAt != null && String(raw.submittedAt).trim()) {
      const d = new Date(raw.submittedAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid submitted date" });
      }
      update.submittedAt = d;
    }

    const updated = await Enquiry.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: "after", runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    return res.json({ success: true, message: "Enquiry updated", entry: updated });
  } catch (err) {
    console.error("enquiry update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update enquiry" });
  }
});

router.delete("/:id", requireMasterAdminJwt, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const deleted = await Enquiry.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    return res.json({ success: true, message: "Enquiry deleted" });
  } catch (err) {
    console.error("enquiry delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete enquiry" });
  }
});

export default router;
