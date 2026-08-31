import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createExpertiseController,
  deleteExpertiseController,
  getActiveExpertiseController,
  getExpertiseListController,
  toggleExpertisePublishController,
  toggleExpertiseVisibilityController,
  updateExpertiseController,
} from "./expertise.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getExpertiseListController);
router.get("/active", getActiveExpertiseController);

router.post("/", requireMasterAdminJwt, createExpertiseController);
router.put("/:id", requireMasterAdminJwt, updateExpertiseController);
router.delete("/:id", requireMasterAdminJwt, deleteExpertiseController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleExpertiseVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleExpertisePublishController);

export default router;
