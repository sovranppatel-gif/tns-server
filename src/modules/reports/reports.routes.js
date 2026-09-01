import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { getReportController, getReportsMetaController } from "./reports.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);
router.get("/meta", getReportsMetaController);
router.get("/", getReportController);
router.get("/:type", getReportController);

export default router;
