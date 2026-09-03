import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Admission } from "../models/Admission.js";
import { Student } from "../modules/students/students.model.js";
import { connectMongo } from "../db/connectMongo.js";
import { fileToDataUrl, photoType } from "../lib/photo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "uploads", "students", "avatars");
const LEGACY_PREFIX = "/uploads/students/avatars/";
const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve("backups", `photo-migration-backup-${timestamp}.json`);

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function linkedKeys(row) {
  return [row._id, row.admissionMongoId, row.admissionId, row.studentMongoId, row.studentId, row.details?.studentMongoId]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function classify(value) {
  return photoType(value);
}

function fileFor(value) {
  if (!value.startsWith(LEGACY_PREFIX)) return null;
  const filename = path.basename(value.slice(LEGACY_PREFIX.length));
  if (!filename || filename !== value.slice(LEGACY_PREFIX.length) || filename.includes("..")) return null;
  const filePath = path.join(ROOT, filename);
  return fs.existsSync(filePath) ? filePath : undefined;
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

async function run() {
  await connectMongo();
  const [admissions, students] = await Promise.all([
    Admission.find().select("_id admissionId studentId studentMongoId details").lean(),
    Student.find().select("_id studentId admissionId admissionMongoId photo").lean(),
  ]);
  const admissionByKey = new Map(admissions.flatMap((row) => linkedKeys(row).map((key) => [key, row])));
  const studentByKey = new Map(students.flatMap((row) => linkedKeys(row).map((key) => [key, row])));
  const report = {
    admissionsScanned: admissions.length,
    studentsScanned: students.length,
    fieldFormats: { admissionPhotoPreview: {}, studentPhoto: {} },
    legacyPathsFound: 0,
    filesFoundLocally: 0,
    filesMissingLocally: 0,
    admissionsMigrated: 0,
    studentsMigrated: 0,
    alreadyBase64: 0,
    alreadyHttpUrls: 0,
    emptyPhotos: 0,
    mismatches: [],
    missingFiles: [],
    updates: [],
  };

  const candidates = [];
  for (const admission of admissions) {
    const value = valueOf(admission.details?.photoPreview);
    increment(report.fieldFormats.admissionPhotoPreview, classify(value));
    candidates.push({ kind: "admission", row: admission, field: "details.photoPreview", value });
  }
  for (const student of students) {
    const value = valueOf(student.photo);
    increment(report.fieldFormats.studentPhoto, classify(value));
    candidates.push({ kind: "student", row: student, field: "photo", value });
  }

  const seenValues = new Set();
  const queueUpdate = (kind, row, field, value, dataUrl, linkedId = null) => {
    const key = `${kind}:${String(row._id)}:${field}`;
    if (seenValues.has(key)) return;
    seenValues.add(key);
    report.updates.push({ kind, id: String(row._id), field, oldValue: value, newValue: dataUrl, linkedId });
  };
  for (const candidate of candidates) {
    if (!candidate.value) {
      report.emptyPhotos += 1;
      continue;
    }
    if (classify(candidate.value) === "base64") {
      report.alreadyBase64 += 1;
      continue;
    }
    if (classify(candidate.value) === "http-url") {
      report.alreadyHttpUrls += 1;
      continue;
    }
    if (!classify(candidate.value).includes("legacy")) continue;
    report.legacyPathsFound += 1;
    const filePath = fileFor(candidate.value);
    if (!filePath) {
      report.filesMissingLocally += 1;
      report.missingFiles.push({ kind: candidate.kind, id: String(candidate.row._id), filename: path.basename(candidate.value) });
      continue;
    }
    report.filesFoundLocally += 1;
    const dataUrl = fileToDataUrl(filePath);
    const linked = candidate.kind === "admission"
      ? studentByKey.get(String(candidate.row._id).toLowerCase()) || studentByKey.get(String(candidate.row.admissionId || "").toLowerCase())
      : admissionByKey.get(String(candidate.row.admissionMongoId || "").toLowerCase()) || admissionByKey.get(String(candidate.row.admissionId || "").toLowerCase());
    if (linked) {
      const linkedValue = candidate.kind === "admission" ? valueOf(linked.photo) : valueOf(linked.details?.photoPreview);
      if (linkedValue && linkedValue !== candidate.value && classify(linkedValue) !== "empty") {
        report.mismatches.push({ kind: candidate.kind, id: String(candidate.row._id), field: candidate.field, linkedId: String(linked._id), linkedType: candidate.kind === "admission" ? "student" : "admission", valueType: classify(candidate.value), linkedValueType: classify(linkedValue) });
        continue;
      }
    }
    queueUpdate(candidate.kind, candidate.row, candidate.field, candidate.value, dataUrl, linked ? String(linked._id) : null);
    if (linked) {
      const linkedValue = candidate.kind === "admission" ? valueOf(linked.photo) : valueOf(linked.details?.photoPreview);
      if (!linkedValue || linkedValue === candidate.value) {
        queueUpdate(
          candidate.kind === "admission" ? "student" : "admission",
          linked,
          candidate.kind === "admission" ? "photo" : "details.photoPreview",
          linkedValue,
          dataUrl,
          String(candidate.row._id),
        );
      }
    }
  }

  for (const update of report.updates) {
    if (update.kind === "admission") report.admissionsMigrated += 1;
    else report.studentsMigrated += 1;
  }

  console.log("PHOTO MIGRATION REPORT");
  console.log(JSON.stringify({ ...report, mismatchCount: report.mismatches.length, updates: report.updates.map(({ kind, id, field, linkedId }) => ({ kind, id, field, linkedId })) }, null, 2));
  if (dryRun) {
    console.log("DRY RUN: no database writes performed");
    await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect());
    return;
  }
  if (!report.updates.length) {
    console.log("No records require migration");
    await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect());
    return;
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), records: report.updates }, null, 2));
  if (!fs.existsSync(backupPath)) throw new Error("Backup creation failed; no database writes performed");
  for (const update of report.updates) {
    if (update.kind === "admission") await Admission.updateOne({ _id: update.id, "details.photoPreview": update.oldValue }, { $set: { "details.photoPreview": update.newValue } });
    else await Student.updateOne({ _id: update.id, photo: update.oldValue }, { $set: { photo: update.newValue } });
  }
  console.log(`Backup written: ${backupPath}`);
  console.log(`Applied updates: ${report.updates.length}`);
  await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect());
}

run().catch(async (error) => {
  console.error(`Photo migration failed: ${error.message}`);
  try { await import("mongoose").then(({ default: mongoose }) => mongoose.disconnect()); } catch {}
  process.exitCode = 1;
});
