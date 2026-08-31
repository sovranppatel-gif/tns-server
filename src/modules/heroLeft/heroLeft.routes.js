import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import {
  createHeroLeftController,
  deleteHeroLeftController,
  getActiveHeroLeftController,
  getHeroLeftListController,
  toggleHeroLeftPublishController,
  toggleHeroLeftVisibilityController,
  updateHeroLeftController,
  uploadHeroLeftAvatarController,
} from "./heroLeft.controller.js";
import { heroLeftAvatarUpload } from "./heroLeft.upload.js";

const router = Router();

router.get("/", requireMasterAdminJwt, getHeroLeftListController);
router.get("/active", getActiveHeroLeftController);

router.post(
  "/upload-avatar",
  requireMasterAdminJwt,
  (req, res, next) => {
    heroLeftAvatarUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || "Upload failed",
        });
      }
      next();
    });
  },
  uploadHeroLeftAvatarController
);

router.post("/", requireMasterAdminJwt, createHeroLeftController);
router.put("/:id", requireMasterAdminJwt, updateHeroLeftController);
router.delete("/:id", requireMasterAdminJwt, deleteHeroLeftController);
router.patch("/toggle/:id", requireMasterAdminJwt, toggleHeroLeftVisibilityController);
router.patch("/publish/:id", requireMasterAdminJwt, toggleHeroLeftPublishController);

export default router;
