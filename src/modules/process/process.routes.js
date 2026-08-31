import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createProcessController,
  deleteProcessController,
  getActiveProcessController,
  getProcessListController,
  toggleProcessPublishController,
  toggleProcessVisibilityController,
  updateProcessController,
} from "./process.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getProcessListController);
router.get("/active", getActiveProcessController);
router.post("/", requireMasterAdminJwt, createProcessController);
router.put("/:id", requireMasterAdminJwt, updateProcessController);
router.delete("/:id", requireMasterAdminJwt, deleteProcessController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleProcessVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleProcessPublishController);

export default router;
