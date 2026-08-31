import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import {
  getAttendanceController,
  getAttendanceOverviewController,
  getAttendanceReportController,
  getStudentAttendanceHistoryController,
  getStudentMyAttendanceController,
  markBulkAttendanceController,
  markOneAttendanceController,
  searchAttendanceController,
  lockAttendanceController,
  unlockAttendanceController,
  updateAttendanceController,
} from "./attendance.controller.js";

const router = Router();

/** Student portal — own attendance (must be before master-admin guard) */
router.get("/mine", requireStudentJwt, getStudentMyAttendanceController);

router.use(requireMasterAdminJwt);

router.get("/overview", getAttendanceOverviewController);
router.get("/search", searchAttendanceController);
router.get("/report", getAttendanceReportController);
router.get("/student/:studentId", getStudentAttendanceHistoryController);
router.get("/", getAttendanceController);
router.post("/", markOneAttendanceController);
router.post("/bulk", markBulkAttendanceController);
router.post("/lock", lockAttendanceController);
router.post("/unlock", unlockAttendanceController);
router.patch("/:id", updateAttendanceController);
router.put("/:id", updateAttendanceController);

export default router;
