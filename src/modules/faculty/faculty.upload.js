import path from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { ensureDir, getUploadRoot } from "../../lib/uploadRoot.js";

const MAX_BYTES = 400 * 1024;
const uploadRoot = getUploadRoot("faculty");
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

export const facultyPhotoUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = ALLOWED_MIME.test(file.mimetype || "");
    const extOk = ALLOWED_EXT.includes(ext);
    if (mimeOk && extOk) cb(null, true);
    else cb(new Error("Only image files (JPG, PNG, WEBP, GIF) are allowed"));
  },
});

export { MAX_BYTES as FACULTY_PHOTO_MAX_BYTES };
