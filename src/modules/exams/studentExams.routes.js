import { Router } from "express";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import {
  getMyExamController,
  getMyResultController,
  listMyExamsController,
  saveMyAnswerController,
  startMyExamController,
  submitMyExamController,
} from "./studentExams.controller.js";

const router = Router();
router.use(requireStudentJwt);

router.get("/", listMyExamsController);
router.get("/:id", getMyExamController);
router.post("/:id/start", startMyExamController);
router.put("/:id/answer", saveMyAnswerController);
router.patch("/:id/answer", saveMyAnswerController);
router.put("/:id/answers", saveMyAnswerController);
router.post("/:id/submit", submitMyExamController);
router.get("/:id/result", getMyResultController);

export default router;
