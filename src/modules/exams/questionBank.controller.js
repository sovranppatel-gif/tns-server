import mongoose from "mongoose";
import {
  createQuestion,
  deactivateQuestion,
  getQuestionBankMeta,
  getQuestionById,
  listQuestions,
  updateQuestion,
} from "./questionBank.service.js";
import {
  normalizeQuestionPayload,
  validateQuestionPayload,
} from "./exams.validation.js";

function editor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

export async function listQuestionsController(req, res) {
  try {
    const data = await listQuestions({
      search: req.query.search || "",
      type: req.query.type || "",
      subject: req.query.subject || "",
      courseId: req.query.courseId || "",
      difficulty: req.query.difficulty || "",
      status: req.query.status || "",
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({
      success: true,
      message: "Questions fetched",
      ...data,
    });
  } catch (err) {
    console.error("question bank list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch questions" });
  }
}

export async function getQuestionMetaController(_req, res) {
  try {
    const meta = await getQuestionBankMeta();
    return res.json({ success: true, message: "Question meta fetched", ...meta });
  } catch (err) {
    console.error("question bank meta error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch question options" });
  }
}

export async function getQuestionController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid question id" });
    }
    const entry = await getQuestionById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Question not found" });
    return res.json({ success: true, message: "Question fetched", entry });
  } catch (err) {
    console.error("question get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch question" });
  }
}

export async function createQuestionController(req, res) {
  try {
    const payload = normalizeQuestionPayload(req.body);
    const validationError = validateQuestionPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await createQuestion({
      ...payload,
      createdBy: editor(req),
      updatedBy: editor(req),
    });
    return res.status(201).json({
      success: true,
      message: "Question created",
      entry,
    });
  } catch (err) {
    console.error("question create error:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.status >= 500 || !err.status ? "Failed to create question" : err.message,
    });
  }
}

export async function updateQuestionController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid question id" });
    }
    const payload = normalizeQuestionPayload(req.body);
    const validationError = validateQuestionPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await updateQuestion(req.params.id, {
      ...payload,
      updatedBy: editor(req),
    });
    if (!entry) return res.status(404).json({ success: false, message: "Question not found" });
    return res.json({ success: true, message: "Question updated", entry });
  } catch (err) {
    console.error("question update error:", err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.status >= 500 || !err.status ? "Failed to update question" : err.message,
    });
  }
}

export async function deleteQuestionController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid question id" });
    }
    const entry = await deactivateQuestion(req.params.id, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Question not found" });
    return res.json({
      success: true,
      message: "Question deactivated",
      entry,
    });
  } catch (err) {
    console.error("question delete error:", err);
    return res.status(500).json({ success: false, message: "Failed to deactivate question" });
  }
}
