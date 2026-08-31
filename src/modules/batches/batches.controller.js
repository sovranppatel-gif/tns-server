import {
  listBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  syncBatchesAndAttendance,
  getBatchStudents,
  assignBatchStudents,
  removeBatchStudents,
} from "./batches.service.js";
import { seedBatchStudentsRoster } from "../../db/seedBatchStudentsDemo.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

export async function getBatchesController(req, res) {
  try {
    const data = await listBatches({
      search: req.query.search || "",
      status: req.query.status || "",
      universityId: req.query.universityId || "",
      courseId: req.query.courseId || "",
    });
    return res.json({
      success: true,
      message: "Batches fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("batches list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch batches" });
  }
}

export async function getBatchController(req, res) {
  try {
    const entry = await getBatchById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }
    return res.json({ success: true, message: "Batch fetched", entry });
  } catch (err) {
    console.error("batch get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch batch" });
  }
}

export async function createBatchController(req, res) {
  try {
    const entry = await createBatch(req.body || {}, getEditor(req));
    return res.status(201).json({
      success: true,
      message: "Batch created",
      entry,
    });
  } catch (err) {
    console.error("batch create error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to create batch",
    });
  }
}

export async function updateBatchController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, message: "Batch id is required" });
    }
    const entry = await updateBatch(id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Batch updated", entry });
  } catch (err) {
    console.error("batch update error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to update batch",
    });
  }
}

export async function deleteBatchController(req, res) {
  try {
    const entry = await deleteBatch(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Batch archived", entry });
  } catch (err) {
    console.error("batch delete error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to delete batch",
    });
  }
}

export async function getBatchStudentsController(req, res) {
  try {
    const data = await getBatchStudents(req.params.id);
    return res.json({
      success: true,
      message: "Batch students fetched",
      ...data,
    });
  } catch (err) {
    console.error("batch students get error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to fetch batch students",
    });
  }
}

export async function assignBatchStudentsController(req, res) {
  try {
    const data = await assignBatchStudents(
      req.params.id,
      req.body?.admissionIds || [],
      getEditor(req)
    );
    return res.json({
      success: true,
      message: "Students assigned to batch",
      ...data,
    });
  } catch (err) {
    console.error("batch students assign error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to assign students",
    });
  }
}

export async function removeBatchStudentsController(req, res) {
  try {
    const data = await removeBatchStudents(
      req.params.id,
      req.body?.admissionIds || [],
      getEditor(req)
    );
    return res.json({
      success: true,
      message: "Students removed from batch",
      ...data,
    });
  } catch (err) {
    console.error("batch students remove error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to remove students",
    });
  }
}

export async function syncBatchesController(req, res) {
  try {
    const data = await syncBatchesAndAttendance(getEditor(req));
    return res.json({
      success: true,
      message: `Synced ${data.batchesCreated} new batches, updated ${data.batchesUpdated}, attendance rows ${data.attendanceUpserts}`,
      ...data,
    });
  } catch (err) {
    console.error("batches sync error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to sync batches",
    });
  }
}

export async function seedBatchRosterController(req, res) {
  try {
    const perBatch = Number(req.body?.perBatch) || 22;
    const data = await seedBatchStudentsRoster({
      editor: getEditor(req),
      perBatch,
    });
    return res.json({
      success: true,
      message: data.message,
      ...data,
    });
  } catch (err) {
    console.error("batch roster seed error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to seed batch students",
    });
  }
}
