import mongoose from "mongoose";
import {
  getStudentExam,
  getStudentResult,
  listStudentExams,
  saveStudentAnswer,
  startStudentExam,
  submitStudentExam,
} from "./studentExams.service.js";
import { resolveErpStudent } from "./exams.helpers.js";

function badId(id) {
  return !mongoose.Types.ObjectId.isValid(id);
}

function fail(res, err, fallback) {
  const status = err.status || err.statusCode || 500;
  console.error(fallback, err);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : err.message || fallback,
  });
}

export async function listMyExamsController(req, res) {
  try {
    const { studentId } = await resolveErpStudent(req.student);
    const data = await listStudentExams(studentId);
    return res.json({ success: true, message: "Student exams fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch exams");
  }
}

export async function getMyExamController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    const { studentId } = await resolveErpStudent(req.student);
    const entry = await getStudentExam(studentId, req.params.id);
    return res.json({ success: true, message: "Exam fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch exam");
  }
}

export async function startMyExamController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    const identity = await resolveErpStudent(req.student);
    const data = await startStudentExam(identity.studentId, req.params.id, {
      name: identity.name,
    });
    return res.json({ success: true, message: data.resumed ? "Exam resumed" : "Exam started", ...data });
  } catch (err) {
    return fail(res, err, "Failed to start exam");
  }
}

export async function saveMyAnswerController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    const { studentId } = await resolveErpStudent(req.student);
    const data = await saveStudentAnswer(studentId, req.params.id, req.body || {});
    return res.json({
      success: true,
      message: data.submitted ? "Exam submitted" : "Answer saved",
      ...data,
    });
  } catch (err) {
    return fail(res, err, "Failed to save answer");
  }
}

export async function submitMyExamController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    const { studentId } = await resolveErpStudent(req.student);
    const data = await submitStudentExam(studentId, req.params.id);
    return res.json({
      success: true,
      message: data.pendingRelease ? data.message : "Exam submitted",
      ...data,
    });
  } catch (err) {
    return fail(res, err, "Failed to submit exam");
  }
}

export async function getMyResultController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    const { studentId } = await resolveErpStudent(req.student);
    const entry = await getStudentResult(studentId, req.params.id);
    return res.json({ success: true, message: "Result fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch result");
  }
}
