import mongoose from "mongoose";
import {
  createCaseStudy,
  getActiveCaseStudy,
  listCaseStudy,
  softDeleteCaseStudy,
  toggleCaseStudyPublish,
  toggleCaseStudyVisibility,
  updateCaseStudy,
} from "./caseStudy.service.js";
import { normalizeCaseStudyPayload, validateCaseStudyPayload } from "./caseStudy.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getCaseStudyListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listCaseStudy({ search, page, limit });
    return res.json({ success: true, message: "Case study list fetched", data });
  } catch (err) {
    console.error("case study list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch case study list" });
  }
}

export async function getActiveCaseStudyController(_req, res) {
  try {
    const row = await getActiveCaseStudy();
    return res.json({
      success: true,
      message: row ? "Active case study strip fetched" : "No active case study strip available",
      data: row,
    });
  } catch (err) {
    console.error("case study active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active case study strip" });
  }
}

export async function createCaseStudyController(req, res) {
  try {
    const payload = normalizeCaseStudyPayload(req.body);
    const validationError = validateCaseStudyPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const editor = getEditor(req);
    const created = await createCaseStudy({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "Case study strip created", data: created });
  } catch (err) {
    console.error("case study create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create case study strip" });
  }
}

export async function updateCaseStudyController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid case study id" });
    }
    const payload = normalizeCaseStudyPayload(req.body);
    const validationError = validateCaseStudyPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updated = await updateCaseStudy(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) return res.status(404).json({ success: false, message: "Case study strip not found" });
    return res.json({ success: true, message: "Case study strip updated", data: updated });
  } catch (err) {
    console.error("case study update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update case study strip" });
  }
}

export async function deleteCaseStudyController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid case study id" });
    }
    const deleted = await softDeleteCaseStudy(req.params.id, getEditor(req));
    if (!deleted) return res.status(404).json({ success: false, message: "Case study strip not found" });
    return res.json({ success: true, message: "Case study strip deleted" });
  } catch (err) {
    console.error("case study delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete case study strip" });
  }
}

export async function toggleCaseStudyVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid case study id" });
    }
    const updated = await toggleCaseStudyVisibility(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Case study strip not found" });
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("case study visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleCaseStudyPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid case study id" });
    }
    const updated = await toggleCaseStudyPublish(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Case study strip not found" });
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("case study publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
