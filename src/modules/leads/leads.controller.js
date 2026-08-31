import mongoose from "mongoose";
import {
  createLead,
  deleteLead,
  getLeadById,
  listLeads,
  updateLead,
} from "./leads.service.js";
import {
  normalizeLeadPayload,
  validateLeadPayload,
} from "./leads.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getLeadsController(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const data = await listLeads({ search, status });
    return res.json({
      success: true,
      message: "Leads fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("[leads] list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch leads" });
  }
}

export async function getLeadController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }
    const entry = await getLeadById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    return res.json({ success: true, message: "Lead fetched", entry });
  } catch (err) {
    console.error("[leads] get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch lead" });
  }
}

export async function createLeadController(req, res) {
  try {
    const payload = normalizeLeadPayload(req.body);
    const validationError = validateLeadPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const editor = getEditor(req);
    const entry = await createLead({
      ...payload,
      createdBy: editor,
      updatedBy: editor,
    });

    return res.status(201).json({
      success: true,
      message: "Lead created",
      entry,
    });
  } catch (err) {
    console.error("[leads] create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create lead" });
  }
}

export async function updateLeadController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const payload = normalizeLeadPayload(req.body);
    const validationError = validateLeadPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const entry = await updateLead(req.params.id, {
      ...payload,
      updatedBy: getEditor(req),
    });

    if (!entry) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    return res.json({ success: true, message: "Lead updated", entry });
  } catch (err) {
    console.error("[leads] update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update lead" });
  }
}

export async function deleteLeadController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const entry = await deleteLead(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    return res.json({
      success: true,
      message: "Lead deleted",
      entry,
    });
  } catch (err) {
    console.error("[leads] delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete lead" });
  }
}
