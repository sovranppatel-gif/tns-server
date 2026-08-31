import mongoose from "mongoose";
import {
  getStudentFeeById,
  listStudentFees,
  submitStudentFeePayment,
} from "./fees.service.js";

export async function listMyFeesController(req, res) {
  try {
    const email = req.student?.email;
    const data = await listStudentFees(email);
    return res.json({
      success: true,
      message: "Fees fetched",
      rows: data.rows,
      details: data.details,
      stats: data.stats,
    });
  } catch (err) {
    console.error("student fees list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch fees" });
  }
}

export async function getMyFeeController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, message: "Fee id is required" });
    }
    const entry = await getStudentFeeById(req.student?.email, id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Fee record not found" });
    }
    return res.json({ success: true, message: "Fee fetched", entry });
  } catch (err) {
    console.error("student fee get error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch fee" });
  }
}

export async function submitMyFeePaymentController(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    if (
      !id ||
      (id && !mongoose.Types.ObjectId.isValid(id) && !/^FEE-/i.test(String(id)))
    ) {
      return res.status(400).json({ success: false, message: "Invalid fee id" });
    }
    const entry = await submitStudentFeePayment(
      req.student?.email,
      id,
      req.body || {}
    );
    return res.json({
      success: true,
      message: "Payment submitted for approval",
      entry,
    });
  } catch (err) {
    console.error("student fee submit error:", err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to submit payment",
    });
  }
}
