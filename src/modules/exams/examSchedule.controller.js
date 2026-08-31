import mongoose from "mongoose";
import {
  cancelSchedule,
  createSchedule,
  getScheduleById,
  listSchedules,
  releaseResults,
  updateSchedule,
} from "./examSchedule.service.js";
import {
  normalizeSchedulePayload,
  validateSchedulePayload,
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

export async function listSchedulesController(req, res) {
  try {
    const data = await listSchedules({
      search: req.query.search || "",
      status: req.query.status || "",
      examPaperId: req.query.examPaperId || "",
      universityId: req.query.universityId || "",
      courseId: req.query.courseId || "",
      batchId: req.query.batchId || "",
    });
    return res.json({ success: true, message: "Exam schedules fetched", ...data });
  } catch (err) {
    console.error("exam schedules list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam schedules" });
  }
}

export async function getScheduleController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid schedule id" });
    }
    const entry = await getScheduleById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Exam schedule not found" });
    return res.json({ success: true, message: "Exam schedule fetched", entry });
  } catch (err) {
    console.error("exam schedule get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch exam schedule" });
  }
}

export async function createScheduleController(req, res) {
  try {
    const payload = normalizeSchedulePayload(req.body);
    const validationError = validateSchedulePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    const entry = await createSchedule(payload, editor(req));
    return res.status(201).json({ success: true, message: "Exam scheduled", entry });
  } catch (err) {
    console.error("exam schedule create error:", err);
    return fail(res, err, "Failed to schedule exam");
  }
}

export async function updateScheduleController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid schedule id" });
    }
    const payload = normalizeSchedulePayload({
      examPaperId: req.body.examPaperId,
      startAt: req.body.startAt,
      endAt: req.body.endAt,
      startDate: req.body.startDate,
      startTime: req.body.startTime,
      endDate: req.body.endDate,
      endTime: req.body.endTime,
      durationMinutes: req.body.durationMinutes,
      attemptLimit: req.body.attemptLimit,
      instructions: req.body.instructions,
      resultVisibility: req.body.resultVisibility,
      studentIds: ["placeholder"],
    });
    const entry = await updateSchedule(req.params.id, payload, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Exam schedule not found" });
    return res.json({ success: true, message: "Exam schedule updated", entry });
  } catch (err) {
    console.error("exam schedule update error:", err);
    return fail(res, err, "Failed to update exam schedule");
  }
}

export async function cancelScheduleController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid schedule id" });
    }
    const entry = await cancelSchedule(req.params.id, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Exam schedule not found" });
    return res.json({ success: true, message: "Exam cancelled", entry });
  } catch (err) {
    console.error("exam schedule cancel error:", err);
    return fail(res, err, "Failed to cancel exam");
  }
}

export async function releaseResultsController(req, res) {
  try {
    if (badId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid schedule id" });
    }
    const entry = await releaseResults(req.params.id, editor(req));
    if (!entry) return res.status(404).json({ success: false, message: "Exam schedule not found" });
    return res.json({ success: true, message: "Results released", entry });
  } catch (err) {
    console.error("release results error:", err);
    return fail(res, err, "Failed to release results");
  }
}
