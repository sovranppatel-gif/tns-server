import mongoose from "mongoose";
import {
  createExpertise,
  getActiveExpertise,
  listExpertise,
  softDeleteExpertise,
  toggleExpertisePublish,
  toggleExpertiseVisibility,
  updateExpertise,
} from "./expertise.service.js";
import {
  normalizeExpertisePayload,
  validateExpertisePayload,
} from "./expertise.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getExpertiseListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listExpertise({ search, page, limit });
    return res.json({ success: true, message: "Expertise list fetched", data });
  } catch (err) {
    console.error("expertise list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch expertise list" });
  }
}

export async function getActiveExpertiseController(_req, res) {
  try {
    const row = await getActiveExpertise();
    return res.json({
      success: true,
      message: row ? "Active expertise fetched" : "No active expertise section available",
      data: row,
    });
  } catch (err) {
    console.error("expertise active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active expertise section" });
  }
}

export async function createExpertiseController(req, res) {
  try {
    const payload = normalizeExpertisePayload(req.body);
    const validationError = validateExpertisePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const editor = getEditor(req);
    const created = await createExpertise({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "Expertise section created", data: created });
  } catch (err) {
    console.error("expertise create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create expertise section" });
  }
}

export async function updateExpertiseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expertise id" });
    }
    const payload = normalizeExpertisePayload(req.body);
    const validationError = validateExpertisePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const updated = await updateExpertise(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Expertise section not found" });
    }
    return res.json({ success: true, message: "Expertise section updated", data: updated });
  } catch (err) {
    console.error("expertise update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update expertise section" });
  }
}

export async function deleteExpertiseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expertise id" });
    }
    const deleted = await softDeleteExpertise(req.params.id, getEditor(req));
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Expertise section not found" });
    }
    return res.json({ success: true, message: "Expertise section deleted" });
  } catch (err) {
    console.error("expertise delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete expertise section" });
  }
}

export async function toggleExpertiseVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expertise id" });
    }
    const updated = await toggleExpertiseVisibility(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "Expertise section not found" });
    }
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("expertise visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleExpertisePublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expertise id" });
    }
    const updated = await toggleExpertisePublish(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "Expertise section not found" });
    }
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("expertise publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
