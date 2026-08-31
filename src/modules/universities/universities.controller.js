import mongoose from "mongoose";
import {
  activateUniversity,
  createUniversity,
  deactivateUniversity,
  getUniversityById,
  listUniversities,
  updateUniversity,
} from "./universities.service.js";
import {
  normalizeUniversityPayload,
  validateUniversityPayload,
} from "./universities.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getUniversitiesController(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const data = await listUniversities({ search, status });
    return res.json({
      success: true,
      message: "Universities fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("universities list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch universities" });
  }
}

export async function getUniversityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid university id" });
    }
    const entry = await getUniversityById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "University not found" });
    }
    return res.json({ success: true, message: "University fetched", entry });
  } catch (err) {
    console.error("university get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch university" });
  }
}

export async function createUniversityController(req, res) {
  try {
    const payload = normalizeUniversityPayload(req.body);
    const validationError = validateUniversityPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const editor = getEditor(req);
    const entry = await createUniversity({
      ...payload,
      createdBy: editor,
      updatedBy: editor,
    });

    return res.status(201).json({
      success: true,
      message: "University created",
      entry,
    });
  } catch (err) {
    console.error("university create error:", err);
    if (err.statusCode === 409 || err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: err.message || "University code already exists",
      });
    }
    return res.status(500).json({ success: false, message: err.message || "Failed to create university" });
  }
}

export async function updateUniversityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid university id" });
    }

    const payload = normalizeUniversityPayload(req.body);
    const validationError = validateUniversityPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const entry = await updateUniversity(req.params.id, {
      ...payload,
      updatedBy: getEditor(req),
    });

    if (!entry) {
      return res.status(404).json({ success: false, message: "University not found" });
    }

    return res.json({ success: true, message: "University updated", entry });
  } catch (err) {
    console.error("university update error:", err);
    if (err.statusCode === 409 || err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: err.message || "University code already exists",
      });
    }
    return res.status(500).json({ success: false, message: err.message || "Failed to update university" });
  }
}

export async function deleteUniversityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid university id" });
    }

    // Soft hide only — keep record for historical student / affiliation data
    const entry = await deactivateUniversity(req.params.id, getEditor(req));
    if (!entry) {
      return res.status(404).json({ success: false, message: "University not found" });
    }

    return res.json({
      success: true,
      message: "University marked Inactive (kept in database)",
      entry,
    });
  } catch (err) {
    console.error("university deactivate error:", err);
    return res.status(500).json({ success: false, message: "Failed to deactivate university" });
  }
}

export async function activateUniversityController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid university id" });
    }

    const entry = await activateUniversity(req.params.id, getEditor(req));
    if (!entry) {
      return res.status(404).json({ success: false, message: "University not found" });
    }

    return res.json({
      success: true,
      message: "University activated",
      entry,
    });
  } catch (err) {
    console.error("university activate error:", err);
    return res.status(500).json({ success: false, message: "Failed to activate university" });
  }
}
