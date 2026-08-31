import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createCaseStudyController,
  deleteCaseStudyController,
  getActiveCaseStudyController,
  getCaseStudyListController,
  toggleCaseStudyPublishController,
  toggleCaseStudyVisibilityController,
  updateCaseStudyController,
} from "./caseStudy.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getCaseStudyListController);
router.get("/active", getActiveCaseStudyController);
router.post("/", requireMasterAdminJwt, createCaseStudyController);
router.put("/:id", requireMasterAdminJwt, updateCaseStudyController);
router.delete("/:id", requireMasterAdminJwt, deleteCaseStudyController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleCaseStudyVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleCaseStudyPublishController);

export default router;
