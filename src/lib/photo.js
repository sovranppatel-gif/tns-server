import fs from "fs";
import path from "path";

const PHOTO_PREFIXES = ["jpeg", "jpg", "png", "webp", "gif"];

export function isBase64Photo(value) {
  return typeof value === "string" && new RegExp(`^data:image/(?:${PHOTO_PREFIXES.join("|")});base64,[A-Za-z0-9+/=]+$`, "i").test(value.trim());
}

export function isHttpPhoto(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

export function isLegacyUploadPath(value) {
  return typeof value === "string" && /^\/uploads\//i.test(value.trim());
}

export function photoType(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "empty";
  if (isBase64Photo(normalized)) return "base64";
  if (isHttpPhoto(normalized)) return "http-url";
  if (isLegacyUploadPath(normalized)) return "legacy-upload-path";
  return "invalid";
}

export function bufferToDataUrl(buffer, mimeType = "image/jpeg") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  const mime = /^image\/(?:jpeg|png|webp|gif)$/i.test(mimeType) ? mimeType.toLowerCase() : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function fileToDataUrl(filePath, mimeType) {
  const extension = path.extname(filePath).toLowerCase();
  const inferred = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : "image/jpeg";
  return bufferToDataUrl(fs.readFileSync(filePath), mimeType || inferred);
}

export function normalizePhotoValue(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "";
}

export function bestPhoto(...values) {
  const ranked = { base64: 4, "http-url": 3, "legacy-upload-path": 2, invalid: 1, empty: 0 };
  return values
    .map(normalizePhotoValue)
    .sort((left, right) => ranked[photoType(right)] - ranked[photoType(left)])[0] || "";
}

export function photoSummary(value) {
  const normalized = normalizePhotoValue(value);
  return { type: photoType(normalized), prefix: normalized.slice(0, normalized.startsWith("data:") ? normalized.indexOf(",") + 1 : 80), length: normalized.length };
}
