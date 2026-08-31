import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  archiveLookupController,
  archiveStaffController,
  createLookupController,
  createStaffController,
  getStaffController,
  getStaffListController,
  getStaffMetaController,
  getStaffStatsController,
  listLookupController,
  restoreLookupController,
  restoreStaffController,
  statusLookupController,
  updateLookupController,
  updateStaffController,
  updateStaffStatusController,
  uploadStaffPhotoController,
} from "./staff.controller.js";
import { staffPhotoUpload } from "./staff.upload.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getStaffListController);
router.get("/stats/overview", getStaffStatsController);
router.get("/meta", getStaffMetaController);
router.post("/", createStaffController);
router.post("/upload-photo", (req, res, next) => {
  staffPhotoUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize = err.code === "LIMIT_FILE_SIZE" || /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize ? "Photo must be 400 KB or smaller" : err.message || "Upload failed",
      });
    }
    next();
  });
}, uploadStaffPhotoController);

function mountLookup(path, kind) {
  router.get(`/${path}`, listLookupController(kind));
  router.post(`/${path}`, createLookupController(kind));
  router.put(`/${path}/:id`, updateLookupController(kind));
  router.patch(`/${path}/:id`, updateLookupController(kind));
  router.patch(`/${path}/:id/status`, statusLookupController(kind));
  router.post(`/${path}/:id/restore`, restoreLookupController(kind));
  router.delete(`/${path}/:id`, archiveLookupController(kind));
}

mountLookup("departments", "department");
mountLookup("designations", "designation");
mountLookup("categories", "category");
mountLookup("shifts", "shift");

router.post("/:id/restore", restoreStaffController);
router.get("/:id", getStaffController);
router.put("/:id", updateStaffController);
router.patch("/:id", updateStaffController);
router.patch("/:id/status", updateStaffStatusController);
router.delete("/:id", archiveStaffController);

export default router;
