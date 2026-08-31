import path from "path";
import { randomBytes } from "crypto";
import multer from "multer";
import { ensureDir, getUploadRoot } from "../../lib/uploadRoot.js";

const MAX_BYTES = 400 * 1024; // 400 KB
const uploadRoot = getUploadRoot("admissions", "education");

const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALLOWED_MIME =
  /^(application\/pdf|image\/(jpeg|png|gif|webp))$/i;

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
    const safeExt = ALLOWED_EXT.includes(ext) ? ext : ".bin";
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${safeExt}`);
  },
});

export const educationDocumentUpload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = ALLOWED_MIME.test(file.mimetype || "");
    const extOk = ALLOWED_EXT.includes(ext);
    if (mimeOk && extOk) cb(null, true);
    else cb(new Error("Only PDF or image files (JPG, PNG, WEBP, GIF) are allowed"));
  },
});

export { MAX_BYTES as EDUCATION_DOC_MAX_BYTES };
