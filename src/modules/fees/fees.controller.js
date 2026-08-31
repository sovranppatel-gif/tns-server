import mongoose from "mongoose";
import {
  getFeeById,
  listFees,
  recordFeePayment,
  updateFeePayment,
} from "./fees.service.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function badObjectId(id) {
  return id && !mongoose.Types.ObjectId.isValid(id) && !/^FEE-/i.test(String(id));
}

export async function getFeesController(req, res) {
  try {
    const data = await listFees();
    return res.json({
      success: true,
      message: "Fees fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("fees list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch fees" });
  }
}

export async function getFeeController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, message: "Fee id is required" });
    }
    const entry = await getFeeById(id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Fee record not found" });
    }
    return res.json({ success: true, message: "Fee fetched", entry });
  } catch (err) {
    console.error("fee get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch fee" });
  }
}

export async function recordPaymentController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id || badObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid fee id" });
    }
    const entry = await recordFeePayment(id, req.body || {}, getEditor(req));
    return res.json({
      success: true,
      message: "Payment recorded",
      entry,
    });
  } catch (err) {
    console.error("fee payment error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to record payment",
    });
  }
}

export async function updatePaymentController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const paymentId = String(req.params.paymentId || "").trim();
    if (!id || badObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid fee id" });
    }
    if (!paymentId) {
      return res.status(400).json({ success: false, message: "Payment id is required" });
    }
    const entry = await updateFeePayment(id, paymentId, req.body || {}, getEditor(req));
    return res.json({
      success: true,
      message: "Payment updated",
      entry,
    });
  } catch (err) {
    console.error("fee payment update error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to update payment",
    });
  }
}
