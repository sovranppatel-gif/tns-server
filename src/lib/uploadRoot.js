import fs from "fs";
import os from "os";
import path from "path";
import { isVercel } from "./isVercel.js";

/** Vercel’s filesystem is read-only except `/tmp`. */
export function getUploadRoot(...segments) {
  const base = isVercel
    ? path.join(os.tmpdir(), "tns-uploads")
    : path.join(process.cwd(), "uploads");
  return path.join(base, ...segments);
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
