import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { listActivityLogs } from "./activityLog.service.js";

const router = Router();

router.get("/", requireMasterAdminJwt, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const section = String(req.query.section || "").trim();
    const action = String(req.query.action || "").trim();
    const search = String(req.query.search || "").trim();

    const data = await listActivityLogs({ section, action, search, page, limit });
    return res.json({ success: true, message: "Activity logs fetched", data });
  } catch (err) {
    console.error("activity logs list error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch activity logs" });
  }
});

export default router;
