import {
  approveProfileChange,
  listProfileChanges,
  rejectProfileChange,
} from "./profileChange.service.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

export async function listProfileChangesController(req, res) {
  try {
    const data = await listProfileChanges({
      status: req.query.status || "",
      search: req.query.search || "",
    });
    return res.json({
      success: true,
      message: "Profile change requests fetched",
      rows: data.rows,
      stats: data.stats,
    });
  } catch (err) {
    console.error("profile-changes list error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile requests",
    });
  }
}

export async function approveProfileChangeController(req, res) {
  try {
    const entry = await approveProfileChange(req.params.id, getEditor(req));
    return res.json({
      success: true,
      message: "Profile update approved",
      entry,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email or mobile is already used by another student",
      });
    }
    console.error("profile-changes approve error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to approve profile request",
    });
  }
}

export async function rejectProfileChangeController(req, res) {
  try {
    const entry = await rejectProfileChange(
      req.params.id,
      getEditor(req),
      req.body?.adminNote || req.body?.note || ""
    );
    return res.json({
      success: true,
      message: "Profile update rejected",
      entry,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("profile-changes reject error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to reject profile request",
    });
  }
}
