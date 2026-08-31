import { Router } from "express";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import { getStudentDashboardController } from "./studentDashboard.controller.js";

const router = Router();
router.use(requireStudentJwt);
router.get("/", getStudentDashboardController);

export default router;
