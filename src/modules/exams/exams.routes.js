import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  addBankQuestionController,
  addInlineQuestionController,
  archivePaperController,
  createPaperController,
  getPaperController,
  listPapersController,
  publishPaperController,
  updatePaperController,
} from "./examPaper.controller.js";
import {
  cancelScheduleController,
  createScheduleController,
  getScheduleController,
  listSchedulesController,
  releaseResultsController,
  updateScheduleController,
} from "./examSchedule.controller.js";
import {
  allotReexamController,
  getOverviewController,
  getResultController,
  listResultsController,
} from "./examResult.controller.js";

const router = Router();
router.use(requireMasterAdminJwt);

router.get("/overview", getOverviewController);

router.get("/papers", listPapersController);
router.post("/papers", createPaperController);
router.get("/papers/:id", getPaperController);
router.put("/papers/:id", updatePaperController);
router.patch("/papers/:id", updatePaperController);
router.post("/papers/:id/publish", publishPaperController);
router.post("/papers/:id/archive", archivePaperController);
router.post("/papers/:id/questions/bank", addBankQuestionController);
router.post("/papers/:id/questions", addInlineQuestionController);

router.get("/schedules", listSchedulesController);
router.post("/schedules", createScheduleController);
router.get("/schedules/:id", getScheduleController);
router.put("/schedules/:id", updateScheduleController);
router.patch("/schedules/:id", updateScheduleController);
router.post("/schedules/:id/cancel", cancelScheduleController);
router.post("/schedules/:id/release-results", releaseResultsController);

router.get("/results", listResultsController);
router.get("/results/:id", getResultController);
router.post("/results/:id/reexam", allotReexamController);

export default router;
