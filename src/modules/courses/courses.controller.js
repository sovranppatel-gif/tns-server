import mongoose from "mongoose";
import {
  activateCourse,
  createCourse,
  deactivateCourse,
  getCourseById,
  listCourses,
  updateCourse,
} from "./courses.service.js";
import {
  normalizeCoursePayload,
  validateCoursePayload,
} from "./courses.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function getCoursesController(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const type = String(req.query.type || "").trim();
    const universityId = String(req.query.universityId || "").trim();
    const data = await listCourses({ search, status, type, universityId });
    return res.json({
      success: true,
      message: "Courses fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("courses list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch courses" });
  }
}

export async function getCourseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid course id" });
    }
    const entry = await getCourseById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }
    return res.json({ success: true, message: "Course fetched", entry });
  } catch (err) {
    console.error("course get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch course" });
  }
}

export async function createCourseController(req, res) {
  try {
    const payload = normalizeCoursePayload(req.body);
    const validationError = validateCoursePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const editor = getEditor(req);
    const entry = await createCourse({
      ...payload,
      createdBy: editor,
      updatedBy: editor,
    });

    return res.status(201).json({
      success: true,
      message: "Course created",
      entry,
    });
  } catch (err) {
    console.error("course create error:", err);
    if (err.statusCode === 409 || err.status === 409 || err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Course code already exists",
      });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Invalid course data" });
    }
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message:
        status >= 500 ? "Failed to create course" : err.message || "Failed to create course",
    });
  }
}

export async function updateCourseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid course id" });
    }

    const payload = normalizeCoursePayload(req.body);
    const validationError = validateCoursePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const entry = await updateCourse(req.params.id, {
      ...payload,
      updatedBy: getEditor(req),
    });

    if (!entry) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    return res.json({ success: true, message: "Course updated", entry });
  } catch (err) {
    console.error("course update error:", err);
    if (err.statusCode === 409 || err.status === 409 || err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Course code already exists",
      });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Invalid course data" });
    }
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message:
        status >= 500 ? "Failed to update course" : err.message || "Failed to update course",
    });
  }
}

export async function deleteCourseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid course id" });
    }

    const entry = await deactivateCourse(req.params.id, getEditor(req));
    if (!entry) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    return res.json({
      success: true,
      message: "Course marked Inactive (kept in database)",
      entry,
    });
  } catch (err) {
    console.error("course deactivate error:", err);
    return res.status(500).json({ success: false, message: "Failed to deactivate course" });
  }
}

export async function activateCourseController(req, res) {
  try {
    if (badObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid course id" });
    }

    const entry = await activateCourse(req.params.id, getEditor(req));
    if (!entry) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    return res.json({
      success: true,
      message: "Course activated",
      entry,
    });
  } catch (err) {
    console.error("course activate error:", err);
    return res.status(500).json({ success: false, message: "Failed to activate course" });
  }
}
