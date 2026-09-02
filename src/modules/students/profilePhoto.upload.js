import path from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { ensureDir, getUploadRoot } from "../../lib/uploadRoot.js";

const MAX_BYTES = 2 * 1024 * 1024;
const uploadRoot = getUploadRoot("students", "avatars");
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp)$/i;

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
    const safeExt = ALLOWED_EXT.includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${safeExt}`);
  },
});

export const studentAvatarUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = ALLOWED_MIME.test(file.mimetype || "");
    const extOk = ALLOWED_EXT.includes(ext);
    if (mimeOk && extOk) cb(null, true);
    else cb(new Error("Only JPG, PNG, WEBP or GIF photos are allowed"));
  },
});

export { MAX_BYTES as STUDENT_AVATAR_MAX_BYTES };
