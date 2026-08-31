import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createQuestionController,
  deleteQuestionController,
  getQuestionController,
  getQuestionMetaController,
  listQuestionsController,
  updateQuestionController,
} from "./questionBank.controller.js";

const router = Router();
router.use(requireMasterAdminJwt);

router.get("/", listQuestionsController);
router.get("/meta", getQuestionMetaController);
router.post("/", createQuestionController);
router.get("/:id", getQuestionController);
router.put("/:id", updateQuestionController);
router.patch("/:id", updateQuestionController);
router.delete("/:id", deleteQuestionController);

export default router;
