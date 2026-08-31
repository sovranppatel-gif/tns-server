import mongoose from "mongoose";
import {
  listStudents,
  getStudentById,
  getStudentStats,
  getStudentMeta,
  createStudent,
  createStudentFromAdmission,
  updateStudent,
  updateStudentStatus,
  assignStudentBatch,
  syncStudentsFromAdmissions,
} from "./students.service.js";
import {
  normalizeStudentPayload,
  validateStudentPayload,
  normalizeStatus,
  normalizeBatchAssignPayload,
} from "./students.validation.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function isStudentRef(id) {
  const raw = String(id || "").trim();
  if (!raw) return true;
  if (mongoose.Types.ObjectId.isValid(raw)) return false;
  if (/^TNS-\d{4}-\d+$/i.test(raw)) return false;
  return true;
}

export async function getStudentsController(req, res) {
  try {
    const data = await listStudents({
      search: req.query.search || "",
      status: req.query.status || "",
      universityId: req.query.universityId || "",
      courseId: req.query.courseId || "",
      batchId: req.query.batchId || "",
      session: req.query.session || "",
      gender: req.query.gender || "",
      category: req.query.category || "",
      termType: req.query.termType || "",
      termNumber: req.query.termNumber || "",
    });
    return res.json({
      success: true,
      message: "Students fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("students list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch students" });
  }
}

export async function getStudentStatsController(_req, res) {
  try {
    const stats = await getStudentStats();
    return res.json({ success: true, message: "Student stats fetched", stats });
  } catch (err) {
    console.error("students stats error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch student stats" });
  }
}

export async function getStudentMetaController(_req, res) {
  try {
    const meta = await getStudentMeta();
    return res.json({ success: true, message: "Student meta fetched", ...meta });
  } catch (err) {
    console.error("students meta error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch student options" });
  }
}

export async function getStudentController(req, res) {
  try {
    if (isStudentRef(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid student id" });
    }
    const entry = await getStudentById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    return res.json({ success: true, message: "Student fetched", entry });
  } catch (err) {
    console.error("student get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch student" });
  }
}

export async function createStudentController(req, res) {
  try {
    const payload = normalizeStudentPayload(req.body || {});
    const validationError = validateStudentPayload(payload, { isCreate: true });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await createStudent(payload, getEditor(req));
    return res.status(201).json({
      success: true,
      message: "Student created",
      entry,
    });
  } catch (err) {
    console.error("student create error:", err);
    const status = err.status || err.statusCode || (err.code === 11000 ? 409 : 500);
    return res.status(status).json({
      success: false,
      message:
        err.code === 11000
          ? "Student or admission already exists"
          : err.message || "Failed to create student",
    });
  }
}

export async function createFromAdmissionController(req, res) {
  try {
    const ref =
      req.body?.admissionMongoId ||
      req.body?.admissionId ||
      req.params.id ||
      "";
    if (!String(ref).trim()) {
      return res.status(400).json({ success: false, message: "Admission is required" });
    }
    const payload = normalizeStudentPayload(req.body || {});
    const entry = await createStudentFromAdmission(ref, payload, getEditor(req));
    return res.status(201).json({
      success: true,
      message: "Student created from admission",
      entry,
    });
  } catch (err) {
    console.error("student from admission error:", err);
    const status = err.status || err.statusCode || (err.code === 11000 ? 409 : 500);
    return res.status(status).json({
      success: false,
      message:
        err.code === 11000
          ? "A student already exists for this admission"
          : err.message || "Failed to create student from admission",
    });
  }
}

export async function updateStudentController(req, res) {
  try {
    if (isStudentRef(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid student id" });
    }
    const payload = normalizeStudentPayload(req.body || {});
    const validationError = validateStudentPayload(payload, { isCreate: false });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await updateStudent(req.params.id, payload, getEditor(req));
    return res.json({ success: true, message: "Student updated", entry });
  } catch (err) {
    console.error("student update error:", err);
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to update student",
    });
  }
}

export async function updateStudentStatusController(req, res) {
  try {
    if (isStudentRef(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid student id" });
    }
    const status = normalizeStatus(req.body?.status);
    if (!status) {
      return res.status(400).json({ success: false, message: "Valid status is required" });
    }
    const entry = await updateStudentStatus(req.params.id, status, getEditor(req));
    return res.json({ success: true, message: `Student marked ${status}`, entry });
  } catch (err) {
    console.error("student status error:", err);
    const code = err.status || err.statusCode || 500;
    return res.status(code).json({
      success: false,
      message: err.message || "Failed to update student status",
    });
  }
}

export async function assignStudentBatchController(req, res) {
  try {
    if (isStudentRef(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid student id" });
    }
    const payload = normalizeBatchAssignPayload(req.body || {});
    const entry = await assignStudentBatch(req.params.id, payload, getEditor(req));
    return res.json({ success: true, message: "Batch assigned", entry });
  } catch (err) {
    console.error("student batch assign error:", err);
    const code = err.status || err.statusCode || 500;
    return res.status(code).json({
      success: false,
      message: err.message || "Failed to assign batch",
    });
  }
}

export async function syncStudentsController(req, res) {
  try {
    const data = await syncStudentsFromAdmissions(getEditor(req));
    return res.json({
      success: true,
      message: `Synced students: ${data.created} created, ${data.linked} linked, ${data.skipped} already linked`,
      ...data,
    });
  } catch (err) {
    console.error("students sync error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to sync students from admissions",
    });
  }
}
