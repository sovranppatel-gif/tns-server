import { Router } from "express";
import mongoose from "mongoose";
import { requireStudentJwt } from "../middleware/requireStudentJwt.js";
import { Notification } from "../models/Notification.js";
import { toPublicNotification } from "../lib/studentNotifications.js";

const router = Router();

router.use(requireStudentJwt);

/**
 * GET /api/students/notifications
 */
router.get("/", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await Notification.find({ email })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const notifications = rows.map(toPublicNotification);
    const unreadCount = notifications.filter((n) => !n.read).length;

    return res.json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (err) {
    console.error("student notifications list error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load notifications" });
  }
});

/**
 * GET /api/students/notifications/unread-count
 */
router.get("/unread-count", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    const unreadCount = await Notification.countDocuments({
      email,
      read: false,
    });

    return res.json({ success: true, unreadCount });
  } catch (err) {
    console.error("student notifications unread-count error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load unread count" });
  }
});

/**
 * PATCH /api/students/notifications/mark-all-read
 */
router.patch("/mark-all-read", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid student session" });
    }

    await Notification.updateMany(
      { email, read: false },
      { $set: { read: true } }
    );

    return res.json({ success: true, message: "All notifications marked read" });
  } catch (err) {
    console.error("student notifications mark-all-read error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to mark notifications read" });
  }
});

/**
 * PATCH /api/students/notifications/:id/read
 */
router.patch("/:id/read", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid notification id" });
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: id, email },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    return res.json({
      success: true,
      notification: toPublicNotification(updated),
    });
  } catch (err) {
    console.error("student notification mark-read error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to mark notification read" });
  }
});

export default router;
