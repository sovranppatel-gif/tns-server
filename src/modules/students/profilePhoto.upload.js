import path from "path";
import multer from "multer";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp)$/i;

export const studentAvatarUpload = multer({
  storage: multer.memoryStorage(),
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
