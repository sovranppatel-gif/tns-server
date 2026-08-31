import mongoose from "mongoose";
import {
  createServices,
  getActiveServices,
  listServices,
  softDeleteServices,
  toggleServicesPublish,
  toggleServicesVisibility,
  updateServices,
} from "./services.service.js";
import { normalizeServicesPayload, validateServicesPayload } from "./services.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getServicesListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listServices({ search, page, limit });
    return res.json({ success: true, message: "Services list fetched", data });
  } catch (err) {
    console.error("services list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch services list" });
  }
}

export async function getActiveServicesController(_req, res) {
  try {
    const row = await getActiveServices();
    return res.json({
      success: true,
      message: row ? "Active services section fetched" : "No active services section available",
      data: row,
    });
  } catch (err) {
    console.error("services active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active services section" });
  }
}

export async function createServicesController(req, res) {
  try {
    const payload = normalizeServicesPayload(req.body);
    const validationError = validateServicesPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const editor = getEditor(req);
    const created = await createServices({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "Services section created", data: created });
  } catch (err) {
    console.error("services create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create services section" });
  }
}

export async function updateServicesController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid services id" });
    }
    const payload = normalizeServicesPayload(req.body);
    const validationError = validateServicesPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updated = await updateServices(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) return res.status(404).json({ success: false, message: "Services section not found" });
    return res.json({ success: true, message: "Services section updated", data: updated });
  } catch (err) {
    console.error("services update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update services section" });
  }
}

export async function deleteServicesController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid services id" });
    }
    const deleted = await softDeleteServices(req.params.id, getEditor(req));
    if (!deleted) return res.status(404).json({ success: false, message: "Services section not found" });
    return res.json({ success: true, message: "Services section deleted" });
  } catch (err) {
    console.error("services delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete services section" });
  }
}

export async function toggleServicesVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid services id" });
    }
    const updated = await toggleServicesVisibility(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Services section not found" });
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("services visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleServicesPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid services id" });
    }
    const updated = await toggleServicesPublish(req.params.id, getEditor(req));
    if (!updated) return res.status(404).json({ success: false, message: "Services section not found" });
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("services publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
