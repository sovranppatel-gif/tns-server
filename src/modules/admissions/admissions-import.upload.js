import multer from "multer";

const MAX_BYTES = 10 * 1024 * 1024;

export const admissionsImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const allowed = name.endsWith(".xlsx") || name.endsWith(".xls");
    cb(allowed ? null : new Error("Only XLSX or XLS files are allowed"), allowed);
  },
});

export { MAX_BYTES as ADMISSIONS_IMPORT_MAX_BYTES };
