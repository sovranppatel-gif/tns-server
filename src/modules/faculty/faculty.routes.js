import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createAssignmentController,
  createFacultyController,
  createTimetableController,
  deleteAssignmentController,
  deleteFacultyController,
  deleteTimetableController,
  getAllAssignmentsController,
  getAssignmentsController,
  getFacultiesController,
  getFacultyAttendanceController,
  getFacultyController,
  getFacultyExamsController,
  getFacultyMetaController,
  getFacultyStatsController,
  getFacultyStudentsController,
  getFacultyTimetableController,
  getTimetableController,
  updateAssignmentController,
  updateAssignmentStatusController,
  updateFacultyController,
  updateFacultyStatusController,
  updateTimetableController,
  uploadFacultyPhotoController,
  upsertFacultyAttendanceController,
} from "./faculty.controller.js";
import { facultyPhotoUpload } from "./faculty.upload.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getFacultiesController);
router.get("/stats/overview", getFacultyStatsController);
router.get("/meta", getFacultyMetaController);
router.get("/assignments", getAllAssignmentsController);
router.get("/timetable", getTimetableController);
router.post("/", createFacultyController);
router.post("/upload-photo", (req, res, next) => {
  facultyPhotoUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize = err.code === "LIMIT_FILE_SIZE" || /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize ? "Photo must be 400 KB or smaller" : err.message || "Upload failed",
      });
    }
    next();
  });
}, uploadFacultyPhotoController);

router.get("/:id", getFacultyController);
router.put("/:id", updateFacultyController);
router.patch("/:id", updateFacultyController);
router.patch("/:id/status", updateFacultyStatusController);
router.delete("/:id", deleteFacultyController);

router.get("/:facultyId/assignments", getAssignmentsController);
router.post("/:facultyId/assignments", createAssignmentController);
router.put("/:facultyId/assignments/:assignmentId", updateAssignmentController);
router.patch("/:facultyId/assignments/:assignmentId/status", updateAssignmentStatusController);
router.delete("/:facultyId/assignments/:assignmentId", deleteAssignmentController);

router.get("/:facultyId/students", getFacultyStudentsController);
router.get("/:facultyId/exams", getFacultyExamsController);

router.get("/:facultyId/timetable", getFacultyTimetableController);
router.post("/:facultyId/timetable", createTimetableController);
router.put("/:facultyId/timetable/:entryId", updateTimetableController);
router.delete("/:facultyId/timetable/:entryId", deleteTimetableController);

router.get("/:facultyId/attendance", getFacultyAttendanceController);
router.post("/:facultyId/attendance", upsertFacultyAttendanceController);

export default router;
