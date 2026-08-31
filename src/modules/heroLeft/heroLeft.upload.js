import path from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { ensureDir, getUploadRoot } from "../../lib/uploadRoot.js";

const uploadRoot = getUploadRoot("hero-left");

function ensureUploadDir() {
  ensureDir(uploadRoot);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${safeExt}`);
  },
});

export const heroLeftAvatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF or WebP images are allowed"));
  },
});
