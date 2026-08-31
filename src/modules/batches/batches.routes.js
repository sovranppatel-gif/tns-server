import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  getBatchesController,
  getBatchController,
  createBatchController,
  updateBatchController,
  deleteBatchController,
  syncBatchesController,
  seedBatchRosterController,
  getBatchStudentsController,
  assignBatchStudentsController,
  removeBatchStudentsController,
} from "./batches.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getBatchesController);
router.post("/sync", syncBatchesController);
router.post("/seed-roster", seedBatchRosterController);
router.post("/", createBatchController);
router.get("/:id/students", getBatchStudentsController);
router.post("/:id/students", assignBatchStudentsController);
router.delete("/:id/students", removeBatchStudentsController);
router.get("/:id", getBatchController);
router.patch("/:id", updateBatchController);
router.delete("/:id", deleteBatchController);

export default router;
