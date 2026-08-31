import mongoose from "mongoose";
import {
  createHeroLeft,
  getActiveHeroLeft,
  listHeroLeft,
  softDeleteHeroLeft,
  toggleHeroLeftPublish,
  toggleHeroLeftVisibility,
  updateHeroLeft,
} from "./heroLeft.service.js";
import { normalizeHeroLeftPayload, validateHeroLeftPayload } from "./heroLeft.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getHeroLeftListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const search = String(req.query.search || "").trim();
    const data = await listHeroLeft({ search, page, limit });
    return res.json({ success: true, message: "Hero left list fetched", data });
  } catch (err) {
    console.error("hero left list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch hero left list" });
  }
}

export async function getActiveHeroLeftController(_req, res) {
  try {
    const row = await getActiveHeroLeft();
    return res.json({
      success: true,
      message: row ? "Active hero left fetched" : "No active hero left section available",
      data: row,
    });
  } catch (err) {
    console.error("hero left active error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch active hero left section" });
  }
}

export async function createHeroLeftController(req, res) {
  try {
    const payload = normalizeHeroLeftPayload(req.body);
    const validationError = validateHeroLeftPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const editor = getEditor(req);
    const created = await createHeroLeft({ ...payload, createdBy: editor, updatedBy: editor });
    return res.status(201).json({ success: true, message: "Hero left section created", data: created });
  } catch (err) {
    console.error("hero left create error:", err);
    return res.status(500).json({ success: false, message: "Failed to create hero left section" });
  }
}

export async function updateHeroLeftController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid hero left id" });
    }
    const payload = normalizeHeroLeftPayload(req.body);
    const validationError = validateHeroLeftPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const updated = await updateHeroLeft(req.params.id, { ...payload, updatedBy: getEditor(req) });
    if (!updated) {
      return res.status(404).json({ success: false, message: "Hero left section not found" });
    }
    return res.json({ success: true, message: "Hero left section updated", data: updated });
  } catch (err) {
    console.error("hero left update error:", err);
    return res.status(500).json({ success: false, message: "Failed to update hero left section" });
  }
}

export async function deleteHeroLeftController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid hero left id" });
    }
    const deleted = await softDeleteHeroLeft(req.params.id, getEditor(req));
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Hero left section not found" });
    }
    return res.json({ success: true, message: "Hero left section deleted" });
  } catch (err) {
    console.error("hero left delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete hero left section" });
  }
}

export async function toggleHeroLeftVisibilityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid hero left id" });
    }
    const updated = await toggleHeroLeftVisibility(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "Hero left section not found" });
    }
    return res.json({ success: true, message: "Visibility updated", data: updated });
  } catch (err) {
    console.error("hero left visibility error:", err);
    return res.status(500).json({ success: false, message: "Failed to update visibility" });
  }
}

export async function toggleHeroLeftPublishController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid hero left id" });
    }
    const updated = await toggleHeroLeftPublish(req.params.id, getEditor(req));
    if (!updated) {
      return res.status(404).json({ success: false, message: "Hero left section not found" });
    }
    return res.json({ success: true, message: "Publish status updated", data: updated });
  } catch (err) {
    console.error("hero left publish error:", err);
    return res.status(500).json({ success: false, message: "Failed to update publish status" });
  }
}

export async function uploadHeroLeftAvatarController(req, res) {
  try {
    if (!req.file?.filename) {
      return res.status(400).json({ success: false, message: "No image file received" });
    }
    const url = `/uploads/hero-left/${req.file.filename}`;
    return res.status(201).json({
      success: true,
      message: "Image uploaded",
      data: { url },
    });
  } catch (err) {
    console.error("hero left upload error:", err);
    return res.status(500).json({ success: false, message: "Failed to upload image" });
  }
}
