import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createServicesController,
  deleteServicesController,
  getActiveServicesController,
  getServicesListController,
  toggleServicesPublishController,
  toggleServicesVisibilityController,
  updateServicesController,
} from "./services.controller.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getServicesListController);
router.get("/active", getActiveServicesController);
router.post("/", requireMasterAdminJwt, createServicesController);
router.put("/:id", requireMasterAdminJwt, updateServicesController);
router.delete("/:id", requireMasterAdminJwt, deleteServicesController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleServicesVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleServicesPublishController);

export default router;
