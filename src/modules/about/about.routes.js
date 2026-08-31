import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createAboutController,
  deleteAboutController,
  getAboutListController,
  getActiveAboutController,
  toggleAboutPublishController,
  toggleAboutVisibilityController,
  updateAboutController,
} from "./about.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getAboutListController);
router.get("/active", getActiveAboutController);

router.post("/", requireMasterAdminJwt, createAboutController);
router.put("/:id", requireMasterAdminJwt, updateAboutController);
router.delete("/:id", requireMasterAdminJwt, deleteAboutController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleAboutVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleAboutPublishController);

export default router;
