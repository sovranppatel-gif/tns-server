import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  activateCourseController,
  createCourseController,
  deleteCourseController,
  getCourseController,
  getCoursesController,
  updateCourseController,
} from "./courses.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getCoursesController);
router.post("/", createCourseController);
router.patch("/:id/activate", activateCourseController);
router.get("/:id", getCourseController);
router.put("/:id", updateCourseController);
router.patch("/:id", updateCourseController);
router.delete("/:id", deleteCourseController);

export default router;
