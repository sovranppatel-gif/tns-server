import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createLeadController,
  deleteLeadController,
  getLeadController,
  getLeadsController,
  updateLeadController,
} from "./leads.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getLeadsController);
router.get("/:id", getLeadController);
router.post("/", createLeadController);
router.patch("/:id", updateLeadController);
router.put("/:id", updateLeadController);
router.delete("/:id", deleteLeadController);

export default router;
