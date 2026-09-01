import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Backup } from "./backup.model.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";
import { ensureDir, getUploadRoot } from "../../lib/uploadRoot.js";
import { isVercel } from "../../lib/isVercel.js";

const SKIP_BACKUP = new Set(["otps", "backups"]);
const SKIP_RESTORE = new Set(["otps", "backups"]);

const ERP_COLLECTIONS = new Set([
  "students",
  "admissions",
  "studentfees",
  "attendances",
  "attendancelocks",
  "batches",
  "courses",
  "universities",
  "faculties",
  "facultyassignments",
  "facultytimetables",
  "facultyattendances",
  "staff",
  "staffs",
  "staffdepartments",
  "staffdesignations",
  "staffcategories",
  "staffshifts",
  "chartaccounts",
  "financialaccounts",
  "accountingtransactions",
  "financepayments",
  "expensecategories",
  "expenses",
  "incomecategories",
  "incomerecords",
  "salarystructures",
  "employeeadvances",
  "employeeloans",
  "payrollruns",
  "payrollitems",
  "financesequences",
]);

const EXAM_COLLECTIONS = new Set([
  "questionbanks",
  "exampapers",
  "examschedules",
  "examassignments",
  "examattempts",
  "examresults",
]);

const CMS_COLLECTIONS = new Set([
  "abouts",
  "expertises",
  "processes",
  "servicessections",
  "casestudystrips",
  "faqsections",
  "heroleftsections",
  "sitesettings",
]);

const CRM_COLLECTIONS = new Set(["enquiries", "leads"]);

export const BACKUP_SCOPES = {
  all: {
    id: "all",
    label: "Full database",
    hint: "Every collection except OTPs and this backup catalogue",
  },
  erp: {
    id: "erp",
    label: "ERP core",
    hint: "Students, admissions, fees, attendance, courses, faculty and staff",
  },
  exams: {
    id: "exams",
    label: "Exams",
    hint: "Question bank, papers, schedules, attempts and results",
  },
  cms: {
    id: "cms",
    label: "Website CMS",
    hint: "Public site content and settings",
  },
  crm: {
    id: "crm",
    label: "Enquiries & leads",
    hint: "CRM pipeline only",
  },
};

const COLLECTION_LABELS = {
  students: "Students",
  admissions: "Admissions",
  studentfees: "Fee accounts",
  attendances: "Attendance",
  attendancelocks: "Attendance locks",
  batches: "Batches",
  courses: "Courses",
  universities: "Universities",
  faculties: "Faculty",
  facultyassignments: "Faculty assignments",
  facultytimetables: "Timetable",
  facultyattendances: "Faculty attendance",
  staff: "Staff",
  staffs: "Staff",
  staffdepartments: "Staff departments",
  staffdesignations: "Staff designations",
  staffcategories: "Staff categories",
  staffshifts: "Staff shifts",
  questionbanks: "Question bank",
  exampapers: "Exam papers",
  examschedules: "Exam schedule",
  examassignments: "Exam assignments",
  examattempts: "Exam attempts",
  examresults: "Exam results",
  enquiries: "Enquiries",
  leads: "Leads",
  abouts: "About CMS",
  expertises: "Expertise CMS",
  processes: "Process CMS",
  servicessections: "Services CMS",
  casestudystrips: "Case study CMS",
  faqsections: "FAQ CMS",
  heroleftsections: "Hero CMS",
  sitesettings: "Site settings",
  users: "Login accounts",
  activitylogs: "Audit logs",
  notifications: "Notifications",
  supporttickets: "Support tickets",
  backups: "Backup catalogue",
  otps: "OTPs (skipped)",
};

let jobLock = false;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getDb() {
  const db = mongoose.connection?.db;
  if (!db) {
    throw httpError(503, "Database is not connected");
  }
  return db;
}

function backupRoot() {
  return ensureDir(getUploadRoot("backups"));
}

function isInsideBackupRoot(filepath) {
  const root = path.resolve(backupRoot());
  const resolved = path.resolve(filepath);
  const rel = path.relative(root, resolved);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function matchesScope(scope, name) {
  if (SKIP_BACKUP.has(name)) return false;
  if (scope === "all") return true;
  if (scope === "erp") {
    return (
      ERP_COLLECTIONS.has(name) ||
      name.startsWith("facult") ||
      name.startsWith("staff")
    );
  }
  if (scope === "exams") {
    return EXAM_COLLECTIONS.has(name) || name.startsWith("exam") || name === "questionbanks";
  }
  if (scope === "cms") return CMS_COLLECTIONS.has(name);
  if (scope === "crm") return CRM_COLLECTIONS.has(name);
  return false;
}

function collectionGroup(name) {
  if (SKIP_BACKUP.has(name) || name === "users" || name === "activitylogs" || name === "notifications" || name === "supporttickets") {
    return { id: "system", label: "System" };
  }
  if (CRM_COLLECTIONS.has(name)) return { id: "crm", label: "Enquiries" };
  if (CMS_COLLECTIONS.has(name)) return { id: "cms", label: "Website" };
  if (EXAM_COLLECTIONS.has(name) || name.startsWith("exam") || name === "questionbanks") {
    return { id: "exams", label: "Exams" };
  }
  if (name.startsWith("facult") || name.startsWith("staff")) {
    return { id: "people", label: "Faculty & staff" };
  }
  if (ERP_COLLECTIONS.has(name)) return { id: "erp", label: "ERP" };
  return { id: "other", label: "Other" };
}

function encodeValue(value) {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof mongoose.Types.ObjectId) return { $oid: String(value) };
  if (Buffer.isBuffer(value)) return { $binary: value.toString("base64") };

  const bsonType = value._bsontype;
  if (bsonType === "ObjectId") return { $oid: String(value) };
  if (bsonType === "Decimal128") return { $numberDecimal: String(value) };
  if (bsonType === "Long" || bsonType === "Int32" || bsonType === "Double") {
    try {
      return Number(value);
    } catch {
      return String(value);
    }
  }
  if (bsonType === "Binary" || bsonType === "UUID") {
    const raw = typeof value.value === "function" ? value.value(true) : value.buffer;
    return { $binary: Buffer.from(raw || []).toString("base64") };
  }

  if (Array.isArray(value)) return value.map(encodeValue);

  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = encodeValue(value[key]);
  }
  return out;
}

function decodeValue(value) {
  if (value == null || typeof value !== "object") return value;

  if (typeof value.$oid === "string" && Object.keys(value).length === 1) {
    return new mongoose.Types.ObjectId(value.$oid);
  }
  if (typeof value.$date === "string" && Object.keys(value).length === 1) {
    return new Date(value.$date);
  }
  if (value.$date && typeof value.$date === "object" && value.$date.$numberLong) {
    return new Date(Number(value.$date.$numberLong));
  }
  if (typeof value.$binary === "string" && Object.keys(value).length === 1) {
    return Buffer.from(value.$binary, "base64");
  }
  if (typeof value.$numberDecimal === "string" && Object.keys(value).length === 1) {
    return mongoose.Types.Decimal128.fromString(value.$numberDecimal);
  }

  if (Array.isArray(value)) return value.map(decodeValue);

  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = decodeValue(value[key]);
  }
  return out;
}

function stampParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return { y, m, d, hh, mm, ss, key: `${y}${m}${d}-${hh}${mm}${ss}` };
}

function writeUtf8(stream, chunk) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new Error("Backup stream closed"));
      return;
    }
    const ok = stream.write(chunk, "utf8");
    if (ok) resolve();
    else stream.once("drain", resolve);
  });
}

async function listLiveCollections() {
  const db = getDb();
  const listed = await db.listCollections().toArray();
  return listed
    .filter((c) => c.type !== "view" && !String(c.name || "").startsWith("system."))
    .map((c) => c.name)
    .sort();
}

async function collectionCounts(names) {
  const db = getDb();
  const rows = [];
  for (const name of names) {
    const count = await db.collection(name).estimatedDocumentCount();
    const group = collectionGroup(name);
    rows.push({
      name,
      label: COLLECTION_LABELS[name] || name,
      count,
      group: group.id,
      groupLabel: group.label,
      skipped: SKIP_BACKUP.has(name),
    });
  }
  return rows;
}

function toPublicBackup(doc, fileExists) {
  if (!doc) return null;
  const row = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const status = row.status === "Failed" ? "Failed" : fileExists ? "Ready" : "Missing";
  return {
    id: row.backupId,
    backupId: row.backupId,
    filename: row.filename,
    scope: row.scope,
    scopeLabel: BACKUP_SCOPES[row.scope]?.label || row.scope,
    createdBy: row.createdBy || "",
    bytes: row.bytes || 0,
    collectionCount: row.collectionCount || 0,
    documentCount: row.documentCount || 0,
    counts: row.counts || {},
    status,
    error: row.error || "",
    createdAt: row.createdAt,
    fileExists: Boolean(fileExists),
  };
}

function fileExistsSafe(filepath) {
  try {
    return Boolean(filepath) && fs.existsSync(filepath);
  } catch {
    return false;
  }
}

async function findBackupOrThrow(backupId) {
  const row = await Backup.findOne({ backupId: String(backupId || "").trim() });
  if (!row) throw httpError(404, "Backup not found");
  return row;
}

export async function getBackupStatus() {
  const db = getDb();
  const names = await listLiveCollections();
  const collections = await collectionCounts(names);
  const included = collections.filter((c) => !c.skipped);
  const documents = included.reduce((sum, c) => sum + (c.count || 0), 0);

  const latest = await Backup.findOne({ status: "Ready" }).sort({ createdAt: -1 }).lean();
  const latestExists = latest ? fileExistsSafe(latest.filepath) : false;

  return {
    database: db.databaseName,
    ephemeralStorage: Boolean(isVercel),
    storageHint: isVercel
      ? "Files are stored in temporary disk on this host and may disappear after idle."
      : "Snapshots are stored on the server under uploads/backups.",
    scopes: Object.values(BACKUP_SCOPES),
    collections,
    totals: {
      collections: included.length,
      documents,
    },
    lastBackup: latest ? toPublicBackup(latest, latestExists) : null,
  };
}

export async function listBackups() {
  const rows = await Backup.find({}).sort({ createdAt: -1 }).limit(80).lean();
  return rows.map((row) => toPublicBackup(row, fileExistsSafe(row.filepath)));
}

export async function createBackup({ scope = "all", actor = "master-admin" } = {}) {
  const normalized = BACKUP_SCOPES[scope] ? scope : "all";
  if (jobLock) {
    throw httpError(409, "Another backup or restore is already running. Wait for it to finish.");
  }

  jobLock = true;
  const stamp = stampParts();
  const backupId = `BK-${stamp.key}`;
  const filename = `tns-backup-${normalized}-${stamp.key}.json`;
  const filepath = path.join(backupRoot(), filename);

  const record = await Backup.create({
    backupId,
    filename,
    filepath,
    scope: normalized,
    createdBy: actor,
    status: "Ready",
  });

  try {
    const names = (await listLiveCollections()).filter((name) => matchesScope(normalized, name));
    if (!names.length) {
      throw httpError(400, "No collections matched this backup scope.");
    }

    const stream = fs.createWriteStream(filepath, { encoding: "utf8" });
    stream.on("error", (streamErr) => {
      console.error("backup write error:", streamErr);
    });
    const counts = {};
    let documentCount = 0;

    const meta = {
      backupId,
      scope: normalized,
      scopeLabel: BACKUP_SCOPES[normalized].label,
      createdAt: new Date().toISOString(),
      createdBy: actor,
      database: getDb().databaseName,
      institute: "TNS ITI & Computer",
    };

    await writeUtf8(stream, `{"meta":${JSON.stringify(meta)},"collections":{`);

    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (i > 0) await writeUtf8(stream, ",");
      await writeUtf8(stream, `${JSON.stringify(name)}:[`);

      const cursor = getDb().collection(name).find({}).batchSize(200);
      let first = true;
      let n = 0;
      try {
        for await (const doc of cursor) {
          const encoded = encodeValue(doc);
          await writeUtf8(stream, `${first ? "" : ","}${JSON.stringify(encoded)}`);
          first = false;
          n += 1;
        }
      } finally {
        await cursor.close().catch(() => {});
      }

      await writeUtf8(stream, "]");
      counts[name] = n;
      documentCount += n;
    }

    await writeUtf8(stream, "}}");
    await new Promise((resolve, reject) => {
      stream.end((err) => (err ? reject(err) : resolve()));
    });

    const bytes = fs.statSync(filepath).size;
    record.bytes = bytes;
    record.counts = counts;
    record.collectionCount = names.length;
    record.documentCount = documentCount;
    record.status = "Ready";
    record.error = "";
    await record.save();

    await createActivityLog({
      section: "Backup",
      action: "create",
      message: `Created ${BACKUP_SCOPES[normalized].label.toLowerCase()} backup ${backupId} (${documentCount} documents)`,
      actor,
      resourceId: backupId,
      path: "/master-admin/backup",
      meta: { scope: normalized, bytes, collections: names.length, documents: documentCount },
    }).catch(() => {});

    return toPublicBackup(record, true);
  } catch (err) {
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch {
      /* ignore */
    }
    record.status = "Failed";
    record.error = err.message || "Backup failed";
    await record.save().catch(() => {});
    throw err.status ? err : httpError(500, err.message || "Backup failed");
  } finally {
    jobLock = false;
  }
}

export async function downloadBackupFile(backupId) {
  const row = await findBackupOrThrow(backupId);
  if (row.status === "Failed") {
    throw httpError(409, "This backup failed and has no file to download.");
  }
  if (!row.filepath || !isInsideBackupRoot(row.filepath) || !fileExistsSafe(row.filepath)) {
    throw httpError(404, "Backup file is missing on disk. Create a new snapshot.");
  }
  return {
    filepath: row.filepath,
    filename: row.filename,
    bytes: row.bytes || 0,
  };
}

export async function deleteBackup(backupId, actor = "master-admin") {
  const row = await findBackupOrThrow(backupId);
  if (row.filepath && isInsideBackupRoot(row.filepath) && fileExistsSafe(row.filepath)) {
    try {
      fs.unlinkSync(row.filepath);
    } catch {
      /* still drop metadata */
    }
  }
  await Backup.deleteOne({ _id: row._id });
  await createActivityLog({
    section: "Backup",
    action: "delete",
    message: `Deleted backup ${row.backupId}`,
    actor,
    resourceId: row.backupId,
    path: "/master-admin/backup",
  }).catch(() => {});
  return { backupId: row.backupId };
}

async function insertInChunks(collection, docs, chunkSize = 400) {
  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    await collection.insertMany(chunk, { ordered: false });
  }
}

export async function restoreBackup(backupId, { confirm, includeUsers = false, actor = "master-admin" } = {}) {
  if (String(confirm || "").trim() !== "RESTORE") {
    throw httpError(400, 'Type RESTORE in the confirm field to restore a backup.');
  }
  if (jobLock) {
    throw httpError(409, "Another backup or restore is already running. Wait for it to finish.");
  }

  const row = await findBackupOrThrow(backupId);
  if (row.status === "Failed") {
    throw httpError(409, "Cannot restore a failed backup.");
  }
  if (!row.filepath || !isInsideBackupRoot(row.filepath) || !fileExistsSafe(row.filepath)) {
    throw httpError(404, "Backup file is missing on disk.");
  }

  jobLock = true;
  try {
    const raw = fs.readFileSync(row.filepath, "utf8");
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw httpError(400, "Backup file is not valid JSON.");
    }

    const collections = payload?.collections && typeof payload.collections === "object" ? payload.collections : null;
    if (!collections) {
      throw httpError(400, "Backup file has no collections to restore.");
    }

    const db = getDb();
    const restored = {};
    const skipped = [];

    for (const name of Object.keys(collections)) {
      if (SKIP_RESTORE.has(name) || name.startsWith("system.")) {
        skipped.push(name);
        continue;
      }
      if (name === "users" && !includeUsers) {
        skipped.push(name);
        continue;
      }

      const docs = Array.isArray(collections[name]) ? collections[name].map(decodeValue) : [];
      const col = db.collection(name);
      await col.deleteMany({});
      if (docs.length) {
        await insertInChunks(col, docs);
      }
      restored[name] = docs.length;
    }

    const documentCount = Object.values(restored).reduce((sum, n) => sum + n, 0);
    await createActivityLog({
      section: "Backup",
      action: "restore",
      message: `Restored backup ${row.backupId} (${documentCount} documents${includeUsers ? ", including users" : ""})`,
      actor,
      resourceId: row.backupId,
      path: "/master-admin/backup",
      meta: { includeUsers: Boolean(includeUsers), collections: Object.keys(restored).length, documents: documentCount },
    }).catch(() => {});

    return {
      backupId: row.backupId,
      restored,
      skipped,
      collectionCount: Object.keys(restored).length,
      documentCount,
      includeUsers: Boolean(includeUsers),
    };
  } finally {
    jobLock = false;
  }
}
