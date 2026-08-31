import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { getOverviewController } from "./dashboard.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);
router.get("/overview", getOverviewController);

export default router;
