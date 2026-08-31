import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  activateUniversityController,
  createUniversityController,
  deleteUniversityController,
  getUniversitiesController,
  getUniversityController,
  updateUniversityController,
} from "./universities.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getUniversitiesController);
router.get("/:id", getUniversityController);
router.post("/", createUniversityController);
router.put("/:id", updateUniversityController);
router.patch("/:id", updateUniversityController);
router.patch("/:id/activate", activateUniversityController);
router.delete("/:id", deleteUniversityController);

export default router;
