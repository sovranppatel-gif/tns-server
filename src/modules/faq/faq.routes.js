import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createFaqController,
  deleteFaqController,
  getActiveFaqController,
  getFaqListController,
  toggleFaqPublishController,
  toggleFaqVisibilityController,
  updateFaqController,
} from "./faq.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getFaqListController);
router.get("/active", getActiveFaqController);
router.post("/", requireMasterAdminJwt, createFaqController);
router.put("/:id", requireMasterAdminJwt, updateFaqController);
router.delete("/:id", requireMasterAdminJwt, deleteFaqController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleFaqVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleFaqPublishController);

export default router;
