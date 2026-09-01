import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createBackupController,
  deleteBackupController,
  downloadBackupController,
  getBackupStatusController,
  listBackupsController,
  restoreBackupController,
} from "./backup.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);
router.get("/status", getBackupStatusController);
router.get("/", listBackupsController);
router.post("/", createBackupController);
router.get("/:id/download", downloadBackupController);
router.post("/:id/restore", restoreBackupController);
router.delete("/:id", deleteBackupController);

export default router;
