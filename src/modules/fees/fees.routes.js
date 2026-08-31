import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  getFeeController,
  getFeesController,
  recordPaymentController,
  updatePaymentController,
} from "./fees.controller.js";

const router = Router();

router.use(requireMasterAdminJwt);

router.get("/", getFeesController);
router.get("/:id", getFeeController);
router.post("/:id/payments", recordPaymentController);
router.patch("/:id/payments/:paymentId", updatePaymentController);

export default router;
