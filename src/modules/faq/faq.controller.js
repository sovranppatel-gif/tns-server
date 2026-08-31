import mongoose from "mongoose";
import {
  createFaq,
  getActiveFaq,
  listFaq,
  softDeleteFaq,
  toggleFaqPublish,
  toggleFaqVisibility,
  updateFaq,
} from "./faq.service.js";
import { normalizeFaqPayload, validateFaqPayload } from "./faq.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getFaqListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listFaq({ search, page, limit });
    return res.json({ success: true, message: "FAQ list fetched", data });
  } catch (err) {
    console.error("faq list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch FAQ list" });
  }
}

export async function getActiveFaqController(_req, res) {
  try {
    const row = await getActiveFaq();
    return res.json({
      success: true,
      message: row ? "Active FAQ section fetched" : "No active FAQ section available",
      data: row,
    });
  } catch (err) {
    console.error("faq active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active FAQ section" });
  }
}

export async function createFaqController(req, res) {
  try {
    const payload = normalizeFaqPayload(req.body);
    const validationError = validateFaqPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const editor = getEditor(req);
    const created = await createFaq({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "FAQ section created", data: created });
  } catch (err) {
    console.error("faq create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create FAQ section" });
  }
}

export async function updateFaqController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid FAQ id" });
    }
    const payload = normalizeFaqPayload(req.body);
    const validationError = validateFaqPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updated = await updateFaq(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) return res.status(404).json({ success: false, message: "FAQ section not found" });
    return res.json({ success: true, message: "FAQ section updated", data: updated });
  } catch (err) {
    console.error("faq update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update FAQ section" });
  }
}

export async function deleteFaqController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid FAQ id" });
    }
    const deleted = await softDeleteFaq(req.params.id, getEditor(req));
    if (!deleted) return res.status(404).json({ success: false, message: "FAQ section not found" });
    return res.json({ success: true, message: "FAQ section deleted" });
  } catch (err) {
    console.error("faq delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete FAQ section" });
  }
}

export async function toggleFaqVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid FAQ id" });
    }
    const updated = await toggleFaqVisibility(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "FAQ section not found" });
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("faq visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleFaqPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid FAQ id" });
    }
    const updated = await toggleFaqPublish(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "FAQ section not found" });
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("faq publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
