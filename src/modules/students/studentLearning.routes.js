import { Router } from "express";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";

const router = Router();
router.use(requireStudentJwt);

const KINDS = new Set([
  "assignments",
  "homework",
  "notes",
  "materials",
  "lectures",
  "live-classes",
  "certificates",
  "timetable",
  "holidays",
  "announcements",
  "messages",
]);

/**
 * Placeholder student learning APIs.
 * Faculty/admin CMS for these modules is not live yet — return empty lists
 * so the student portal stays connected instead of showing dummy data.
 */
router.get("/:kind", (req, res) => {
  const kind = String(req.params.kind || "")
    .trim()
    .toLowerCase();
  if (!KINDS.has(kind)) {
    return res.status(404).json({ success: false, message: "Unknown resource" });
  }
  return res.json({
    success: true,
    message: "No records yet",
    kind,
    rows: [],
    stats: {},
    ready: false,
  });
});

export default router;
