import { Router } from "express";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import { SupportTicket } from "./supportTicket.model.js";

const router = Router();
router.use(requireStudentJwt);

function toPublicTicket(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    id: String(d._id),
    ticketId: d.ticketId,
    subject: d.subject,
    message: d.message,
    status: d.status,
    date: d.createdAt
      ? new Date(d.createdAt).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "",
    createdAt: d.createdAt,
  };
}

router.get("/tickets", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    const rows = await SupportTicket.find({ email })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .maxTimeMS(5000);
    return res.json({
      success: true,
      rows: rows.map(toPublicTicket),
    });
  } catch (err) {
    console.error("student tickets list error:", err);
    return res.status(500).json({ success: false, message: "Failed to load tickets" });
  }
});

router.post("/tickets", async (req, res) => {
  try {
    const email = String(req.student?.email || "")
      .toLowerCase()
      .trim();
    const subject = String(req.body?.subject || "").trim().slice(0, 160);
    const message = String(req.body?.message || "").trim().slice(0, 4000);
    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required",
      });
    }

    const ticketId = `TNS-TKT-${Date.now().toString(36).toUpperCase()}`;
    const doc = await SupportTicket.create({
      ticketId,
      email,
      studentName: req.student?.name || "",
      subject,
      message,
      status: "Open",
    });

    return res.status(201).json({
      success: true,
      message: "Ticket submitted",
      entry: toPublicTicket(doc),
    });
  } catch (err) {
    console.error("student ticket create error:", err);
    return res.status(500).json({ success: false, message: "Failed to submit ticket" });
  }
});

export default router;
