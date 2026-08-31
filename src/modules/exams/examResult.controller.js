import mongoose from "mongoose";
import {
  allotReexam,
  getAdminResultById,
  getExamOverview,
  listAdminResults,
} from "./examResult.service.js";

function badId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

function fail(res, err, fallback) {
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : err.message || fallback,
  });
}

export async function getOverviewController(_req, res) {
  try {
    const stats = await getExamOverview();
    return res.json({ success: true, message: "Exam overview fetched", stats });
  } catch (err) {
    console.error("exam overview error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam overview" });
  }
}

export async function listResultsController(req, res) {
  try {
    const data = await listAdminResults({
      examId: req.query.examId || req.query.exam || "",
      universityId: req.query.universityId || "",
      courseId: req.query.courseId || "",
      batchId: req.query.batchId || "",
      student: req.query.student || "",
      result: req.query.result || "",
      from: req.query.from || req.query.date || "",
      to: req.query.to || "",
    });
    return res.json({ success: true, message: "Exam results fetched", ...data });
  } catch (err) {
    console.error("exam results list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam results" });
  }
}

export async function getResultController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid result id" });
    }
    const entry = await getAdminResultById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Result not found" });
    return res.json({ success: true, message: "Exam result fetched", entry });
  } catch (err) {
    console.error("exam result get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam result" });
  }
}

export async function allotReexamController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid result id" });
    }
    const editor = req.masterAdmin?.email || "master-admin";
    const entry = await allotReexam(req.params.id, editor);
    if (!entry) return res.status(404).json({ success: false, message: "Result not found" });
    return res.json({ success: true, message: entry.message, entry });
  } catch (err) {
    console.error("allot reexam error:", err);
    return fail(res, err, "Failed to allot re-exam");
  }
}
