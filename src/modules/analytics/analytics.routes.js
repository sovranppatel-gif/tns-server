import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { getAnalyticsOverviewController } from "./analytics.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);
router.get("/overview", getAnalyticsOverviewController);

export default router;
