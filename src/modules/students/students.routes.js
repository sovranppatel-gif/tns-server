import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { educationDocumentUpload } from "../admissions/admissions.upload.js";
import { studentAvatarUpload } from "./profilePhoto.upload.js";
import { bufferToDataUrl } from "../../lib/photo.js";
import {
  getStudentsController,
  getStudentController,
  getStudentStatsController,
  getStudentMetaController,
  createStudentController,
  createFromAdmissionController,
  updateStudentController,
  updateStudentStatusController,
  assignStudentBatchController,
  syncStudentsController,
} from "./students.controller.js";
import {
  approveProfileChangeController,
  listProfileChangesController,
  rejectProfileChangeController,
} from "./profileChange.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getStudentsController);
router.get("/stats", getStudentStatsController);
router.get("/meta", getStudentMetaController);
router.get("/profile-changes", listProfileChangesController);
router.post("/profile-changes/:id/approve", approveProfileChangeController);
router.post("/profile-changes/:id/reject", rejectProfileChangeController);
router.post("/sync-from-admissions", syncStudentsController);
router.post("/from-admission", createFromAdmissionController);
router.post("/", createStudentController);

router.post("/upload-photo", (req, res, next) => {
  studentAvatarUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize =
        err.code === "LIMIT_FILE_SIZE" ||
        /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize
          ? "Photo must be 2 MB or smaller"
          : err.message || "Upload failed",
      });
    }
    next();
  });
}, (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ success: false, message: "No photo file received" });
  }
  return res.status(201).json({
    success: true,
    message: "Photo uploaded",
    data: {
      url: bufferToDataUrl(req.file.buffer, req.file.mimetype),
      name: req.file.originalname || "photo",
      size: req.file.size,
      mimeType: req.file.mimetype,
    },
  });
});

router.post("/upload-document", (req, res, next) => {
  educationDocumentUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize =
        err.code === "LIMIT_FILE_SIZE" ||
        /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize
          ? "Document must be 400 KB or smaller"
          : err.message || "Upload failed",
      });
    }
    next();
  });
}, (req, res) => {
  if (!req.file?.filename) {
    return res.status(400).json({ success: false, message: "No document file received" });
  }
  return res.status(201).json({
    success: true,
    message: "Document uploaded",
    data: {
      url: `/uploads/admissions/education/${req.file.filename}`,
      name: req.file.originalname || req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
    },
  });
});

router.get("/:id", getStudentController);
router.put("/:id", updateStudentController);
router.patch("/:id", updateStudentController);
router.patch("/:id/status", updateStudentStatusController);
router.patch("/:id/batch", assignStudentBatchController);

export default router;
