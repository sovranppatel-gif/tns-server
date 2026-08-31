import { Router } from "express";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import {
  getMyFeeController,
  listMyFeesController,
  submitMyFeePaymentController,
} from "./studentFees.controller.js";

const router = Router();

router.use(requireStudentJwt);

router.get("/", listMyFeesController);
router.get("/:id", getMyFeeController);
router.post("/:id/payments", submitMyFeePaymentController);

export default router;
