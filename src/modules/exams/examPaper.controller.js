import mongoose from "mongoose";
import {
  archivePaper,
  createPaper,
  getPaperById,
  listPapers,
  publishPaper,
  updatePaper,
  addQuestionFromBank,
  addInlineQuestion,
} from "./examPaper.service.js";
import {
  normalizePaperPayload,
  normalizeQuestionPayload,
  validatePaperPayload,
  validateQuestionPayload,
} from "./exams.validation.js";

function editor(req) {
  return req.masterAdmin?.email || "master-admin";
}

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

export async function listPapersController(req, res) {
  try {
    const data = await listPapers({
      search: req.query.search || "",
      status: req.query.status || "",
      courseId: req.query.courseId || "",
      universityId: req.query.universityId || "",
    });
    return res.json({ success: true, message: "Exam papers fetched", ...data });
  } catch (err) {
    console.error("exam papers list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam papers" });
  }
}

export async function getPaperController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid paper id" });
    }
    const entry = await getPaperById(req.params.id, { includeAnswers: true });
    if (!entry) return res.status(404).json({ success: false, message: "Exam paper not found" });
    return res.json({ success: true, message: "Exam paper fetched", entry });
  } catch (err) {
    console.error("exam paper get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam paper" });
  }
}

export async function createPaperController(req, res) {
  try {
    const payload = normalizePaperPayload(req.body);
    const validationError = validatePaperPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await createPaper({
      ...payload,
      createdBy: editor(req),
      updatedBy: editor(req),
    });
    return res.status(201).json({ success: true, message: "Exam paper created", entry });
  } catch (err) {
    console.error("exam paper create error:", err);
    return fail(res, err, "Failed to create exam paper");
  }
}

export async function updatePaperController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid paper id" });
    }
    const payload = normalizePaperPayload(req.body);
    const validationError = validatePaperPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await updatePaper(req.params.id, {
      ...payload,
      updatedBy: editor(req),
    });
    if (!entry) return res.status(404).json({ success: false, message: "Exam paper not found" });
    return res.json({ success: true, message: "Exam paper updated", entry });
  } catch (err) {
    console.error("exam paper update error:", err);
    return fail(res, err, "Failed to update exam paper");
  }
}

export async function publishPaperController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid paper id" });
    }
    const entry = await publishPaper(req.params.id, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Exam paper not found" });
    return res.json({ success: true, message: "Exam paper published", entry });
  } catch (err) {
    console.error("exam paper publish error:", err);
    return fail(res, err, "Failed to publish exam paper");
  }
}

export async function archivePaperController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid paper id" });
    }
    const entry = await archivePaper(req.params.id, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Exam paper not found" });
    return res.json({ success: true, message: "Exam paper archived", entry });
  } catch (err) {
    console.error("exam paper archive error:", err);
    return fail(res, err, "Failed to archive exam paper");
  }
}

export async function addBankQuestionController(req, res) {
  try {
    if (badId(req.params.id) || badId(req.body?.questionId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const entry = await addQuestionFromBank(req.params.id, req.body.questionId, {
      marks: req.body.marks,
      negativeMarks: req.body.negativeMarks,
    });
    return res.json({ success: true, message: "Question added to paper", entry });
  } catch (err) {
    console.error("add bank question error:", err);
    return fail(res, err, "Failed to add question");
  }
}

export async function addInlineQuestionController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid paper id" });
    }
    const payload = normalizeQuestionPayload(req.body);
    const validationError = validateQuestionPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await addInlineQuestion(req.params.id, {
      ...payload,
      createdBy: editor(req),
      updatedBy: editor(req),
    });
    return res.json({ success: true, message: "Question created and added to paper", entry });
  } catch (err) {
    console.error("inline question error:", err);
    return fail(res, err, "Failed to add question");
  }
}
