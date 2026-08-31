import mongoose from "mongoose";
import {
  createAbout,
  getActiveAbout,
  listAbout,
  softDeleteAbout,
  toggleAboutPublish,
  toggleAboutVisibility,
  updateAbout,
} from "./about.service.js";
import { normalizeAboutPayload, validateAboutPayload } from "./about.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getAboutListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listAbout({ search, page, limit });
    return res.json({ success: true, message: "About list fetched", data });
  } catch (err) {
    console.error("about list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch about list" });
  }
}

export async function getActiveAboutController(_req, res) {
  try {
    const row = await getActiveAbout();
    return res.json({
      success: true,
      message: row ? "Active about fetched" : "No active about section available",
      data: row,
    });
  } catch (err) {
    console.error("about active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active about section" });
  }
}

export async function createAboutController(req, res) {
  try {
    const payload = normalizeAboutPayload(req.body);
    const validationError = validateAboutPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const editor = getEditor(req);
    const created = await createAbout({
      ...payload,
      createdBy: editor,
      updatedBy: editor,
    });

    return res.status(201).json({ success: true, message: "About section created", data: created });
  } catch (err) {
    console.error("about create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create about section" });
  }
}

export async function updateAboutController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid about id" });
    }

    const payload = normalizeAboutPayload(req.body);
    const validationError = validateAboutPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const updated = await updateAbout(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) {
      return res.status(404).json({ success: false, message: "About section not found" });
    }

    return res.json({ success: true, message: "About section updated", data: updated });
  } catch (err) {
    console.error("about update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update about section" });
  }
}

export async function deleteAboutController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid about id" });
    }

    const deleted = await softDeleteAbout(req.params.id, getEditor(req));
    if (!deleted) {
      return res.status(404).json({ success: false, message: "About section not found" });
    }
    return res.json({ success: true, message: "About section deleted" });
  } catch (err) {
    console.error("about delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete about section" });
  }
}

export async function toggleAboutVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid about id" });
    }

    const updated = await toggleAboutVisibility(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "About section not found" });
    }
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("about visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleAboutPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid about id" });
    }

    const updated = await toggleAboutPublish(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "About section not found" });
    }
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("about publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}
