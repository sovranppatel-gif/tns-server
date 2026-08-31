import mongoose from "mongoose";
import {
  createProcess,
  getActiveProcess,
  listProcess,
  softDeleteProcess,
  toggleProcessPublish,
  toggleProcessVisibility,
  updateProcess,
} from "./process.service.js";
import { normalizeProcessPayload, validateProcessPayload } from "./process.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}
function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getProcessListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listProcess({ search, page, limit });
    return res.json({ success: true, message: "Process list fetched", data });
  } catch (err) {
    console.error("process list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch process list" });
  }
}

export async function getActiveProcessController(_req, res) {
  try {
    const row = await getActiveProcess();
    return res.json({
      success: true,
      message: row ? "Active process fetched" : "No active process section available",
      data: row,
    });
  } catch (err) {
    console.error("process active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active process section" });
  }
}

export async function createProcessController(req, res) {
  try {
    const payload = normalizeProcessPayload(req.body);
    const validationError = validateProcessPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const editor = getEditor(req);
    const created = await createProcess({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "Process section created", data: created });
  } catch (err) {
    console.error("process create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create process section" });
  }
}

export async function updateProcessController(req, res) {
  try {
    if (badObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid process id" });
    const payload = normalizeProcessPayload(req.body);
    const validationError = validateProcessPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updated = await updateProcess(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) return res.status(404).json({ success: false, message: "Process section not found" });
    return res.json({ success: true, message: "Process section updated", data: updated });
  } catch (err) {
    console.error("process update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update process section" });
  }
}

export async function deleteProcessController(req, res) {
  try {
    if (badObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid process id" });
    const deleted = await softDeleteProcess(req.params.id, getEditor(req));
    if (!deleted) return res.status(404).json({ success: false, message: "Process section not found" });
    return res.json({ success: true, message: "Process section deleted" });
  } catch (err) {
    console.error("process delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete process section" });
  }
}

export async function toggleProcessVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid process id" });
    const updated = await toggleProcessVisibility(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Process section not found" });
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("process visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleProcessPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid process id" });
    const updated = await toggleProcessPublish(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Process section not found" });
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("process publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
