/**
 * Idempotent Excel admission import.
 *
 *   npm run import:admissions -- --dry-run
 *   npm run import:admissions -- --execute
 *
 * Default mode is --dry-run (no writes).
 * Never deletes universities, courses, admissions, students, batches, fees, or users.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import XLSX from "xlsx";
import { connectMongo } from "../db/connectMongo.js";
import { Admission, ADMISSION_MODES } from "../models/Admission.js";
import { University } from "../modules/universities/universities.model.js";
import { Course } from "../modules/courses/courses.model.js";
import { Batch } from "../modules/batches/batches.model.js";
import { Student } from "../modules/students/students.model.js";
import { ensureStudentFromAdmission } from "../modules/students/students.service.js";
import { createBatch, assignBatchStudents } from "../modules/batches/batches.service.js";
import { upsertFeeFromAdmission } from "../modules/fees/fees.service.js";

const EDITOR = "excel-import";
const IMPORT_FILE_LABEL = "studentlist_export (1).xlsx";
const TNS_STUDENT_ID_RE = /^TNS-\d{4}-\d+$/i;

const HEADER_ALIASES = {
  serial: ["serial no"],
  studentCode: ["student code"],
  userId: ["user id", "user id"],
  admissionDate: ["admission date"],
  grSr: ["g r no s r no", "gr sr number", "g r no / s r no"],
  fullName: ["full name"],
  birthDate: ["birth date"],
  gender: ["gender"],
  contactNo: ["contact no", "contact number"],
  admissionType: ["admission type"],
  className: ["class"],
  batch: ["batch"],
  admittedInClass: ["admitted in class"],
  currentAddress: ["current address"],
  countryCode: ["country code"],
  mobileNumber: ["mobile number"],
  cityDistrict: ["city district", "city /district", "city/district"],
  email: ["e mail", "email"],
  country: ["country"],
  parentsCode: ["parents code"],
  parentsId: ["parents id"],
  fatherContact: ["father contact no", "father contact number"],
  fatherOccupation: ["father occupation"],
  motherContact: ["mother contact no", "mother contact number"],
  motherOccupation: ["mother occupation"],
};

const PLACE_TO_STATE = {
  narsinghpur: "Madhya Pradesh",
  "dist narsinghpur": "Madhya Pradesh",
  kandeli: "Madhya Pradesh",
  gotegaon: "Madhya Pradesh",
};

function argFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("-")) {
    return process.argv[idx + 1];
  }
  return "";
}

function cleanCell(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dd = String(value.getUTCDate()).padStart(2, "0");
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = value.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  let s = String(value).replace(/\u00a0/g, " ").trim();
  s = s.replace(/\s+/g, " ");
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "nan" || lower === "null" || lower === "none" || lower === "n/a") return "";
  return s;
}

function normKey(value) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Approved manual course map — only used after live DB lookup.
 * Keys are normalized with the same normKey() as Excel Class values
 * (punctuation such as hyphens is stripped).
 */
const APPROVED_COURSE_ALIASES = Object.fromEntries(
  [
    ["PGDCA - Post Graduate Diploma in Computer Applications", ["MCU-PGDCA", "PGDCA"]],
    ["PGDCA", ["MCU-PGDCA", "PGDCA"]],
    ["OMC OFFICE MANAGMENT COURSE", ["TNS-OMC", "OMC Office Management Course"]],
    ["OMC OFFICE MANAGEMENT COURSE", ["TNS-OMC", "OMC Office Management Course"]],
    ["DCA - Diploma in Computer Applications", ["MCU-DCA", "DCA"]],
    ["COPA - Computer Operator and Programming Assistant", ["TNS-COPA", "COPA"]],
    ["Bachelor of Arts", ["RDVV-BA", "BA"]],
    ["Rabindranath Tagore University (RNTU)", ["RNTU-PGDCA"]],
  ].map(([excel, codes]) => [normKey(excel), codes])
);

function defaultExcelPath() {
  const named = argValue("--file");
  if (named) return path.resolve(named);
  const candidates = [
    path.resolve(process.cwd(), "data/imports/studentlist_export.xlsx"),
    path.resolve(process.cwd(), "data/imports/studentlist_export (1).xlsx"),
    path.resolve("C:/Users/dell/Downloads/studentlist_export (1).xlsx"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function readWorkbookRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  return { sheetName, matrix };
}

function headerIndexMap(headerRow) {
  const byNorm = new Map();
  headerRow.forEach((cell, idx) => {
    const key = normKey(cell);
    if (key) byNorm.set(key, idx);
  });
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      if (byNorm.has(alias)) {
        map[field] = byNorm.get(alias);
        break;
      }
    }
    if (map[field] == null) {
      for (const [norm, idx] of byNorm.entries()) {
        if (aliases.some((a) => norm === a || norm.includes(a))) {
          map[field] = idx;
          break;
        }
      }
    }
  }
  return { map, rawHeaders: headerRow.map((h) => String(h ?? "")) };
}

function rowValue(row, headerMap, field) {
  const idx = headerMap[field];
  if (idx == null) return "";
  return cleanCell(row[idx]);
}

function parseDdMmYyyy(raw) {
  const s = cleanCell(raw);
  if (!s) return { date: null, iso: "", display: "", error: "" };

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return { date: null, iso: "", display: s, error: "Invalid ISO date" };
    return { date, iso: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, display: s, error: "" };
  }

  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!dmy) return { date: null, iso: "", display: s, error: "Unrecognized date format" };

  const dd = Number(dmy[1]);
  const mm = Number(dmy[2]);
  const yyyy = Number(dmy[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return { date: null, iso: "", display: s, error: "Invalid calendar date" };
  }
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return { date: null, iso: "", display: s, error: "Invalid calendar date" };
  }
  if (date.getUTCDate() !== dd || date.getUTCMonth() + 1 !== mm) {
    return { date: null, iso: "", display: s, error: "Invalid calendar date" };
  }
  return { date, iso, display: s, error: "" };
}

function indianSessionFromDate(date) {
  if (!date) return "";
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (m >= 6) return `${y}-${y + 1}`;
  return `${y - 1}-${y}`;
}

function normalizePhone(raw) {
  const s = cleanCell(raw);
  if (!s) return { phone: "", invalid: false, original: "" };
  const compact = s.replace(/\s+/g, "");
  if (compact === "91-" || compact === "-" || compact === "91") {
    return { phone: "", invalid: true, original: s };
  }
  let digits = compact.replace(/\D/g, "");
  if (!digits) return { phone: "", invalid: true, original: s };
  if (digits.startsWith("91") && digits.length >= 12) digits = digits.slice(-10);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(-10);
  if (/^[6-9]\d{9}$/.test(digits)) return { phone: digits, invalid: false, original: s };
  return { phone: "", invalid: true, original: s };
}

function normalizeEmail(raw) {
  const s = cleanCell(raw).toLowerCase();
  if (!s) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  return "";
}

function placeholderEmail(studentCode, excelRow) {
  const local = (studentCode || `row${excelRow}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${local || `row${excelRow}`}@import.tns.local`;
}

function normalizeGender(raw) {
  const s = cleanCell(raw);
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "male" || lower === "m") return "Male";
  if (lower === "female" || lower === "f") return "Female";
  if (lower === "other" || lower === "o") return "Other";
  return "";
}

function normalizeMode(raw) {
  const s = cleanCell(raw);
  if (!s) return { mode: "", unmapped: false, empty: true };
  const compact = s.toLowerCase().replace(/[\s_\-]/g, "");
  if (compact === "online") return { mode: "Online", unmapped: false, empty: false };
  if (compact === "offline") return { mode: "Offline", unmapped: false, empty: false };
  if (compact === "walkin" || compact === "walkinin") return { mode: "Walk-in", unmapped: false, empty: false };
  if (ADMISSION_MODES.includes(s)) return { mode: s, unmapped: false, empty: false };
  return { mode: "", unmapped: true, empty: false, original: s };
}

function isInstituteCourse(course) {
  if (!course) return false;
  return String(course.type || "") === "Institute" || !course.universityId;
}

function academicStructure(course) {
  if (!course) return { termType: "", count: 0 };
  const structureType = String(course.structureType || "").trim();
  if (structureType === "Single Level") return { termType: "", count: 0 };
  const fromList = Array.isArray(course.semesters) ? course.semesters.length : 0;
  const count = Number(course.semesterCount) || fromList || 0;
  if (count <= 0) return { termType: "", count: 0 };
  const termType = structureType === "Year" ? "Year" : "Semester";
  return { termType, count };
}

function courseDisplayLabel(course) {
  const name = String(course?.name || "").trim();
  const code = String(course?.code || "").trim();
  if (!name) return code;
  return code ? `${name} — ${code}` : name;
}

function termFromExcel({ admittedInClass, batchName, course }) {
  const structure = academicStructure(course);
  const text = `${admittedInClass} ${batchName}`
    .replace(/\d{1,2}:\d{2}(?:\s*(?:AM|PM))?/gi, " ")
    .toUpperCase();
  let number = null;
  let typeHint = "";

  const yearMatch = text.match(/\b(I{1,3}|IV|V|[1-5])\s*YEAR\b/);
  const semMatch =
    text.match(/\bSEM(?:ESTER)?\s*(I{1,3}|IV|V|[1-6])\b/) ||
    text.match(/\b(I{1,3}|IV|V|[1-6])\s*SEM(?:ESTER)?\b/);

  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  const parseToken = (tok) => roman[tok] || Number(tok) || null;

  if (yearMatch) {
    typeHint = "Year";
    number = parseToken(yearMatch[1]);
  } else if (semMatch) {
    typeHint = "Semester";
    number = parseToken(semMatch[1] || semMatch[2]);
  }

  if (structure.count <= 0) {
    return { termType: "", termNumber: null, evidenced: Boolean(number), issue: "" };
  }
  if (!number) {
    return {
      termType: structure.termType,
      termNumber: 1,
      evidenced: false,
      assumed: true,
      issue: "",
    };
  }
  if (number < 1 || number > structure.count) {
    return {
      termType: structure.termType,
      termNumber: null,
      evidenced: true,
      issue: `Term ${number} is outside course range 1–${structure.count}`,
    };
  }
  return {
    termType: typeHint && typeHint !== structure.termType ? structure.termType : structure.termType,
    termNumber: number,
    evidenced: true,
    issue: "",
  };
}

function scheduleFromBatchName(name) {
  const s = cleanCell(name);
  const m = s.match(/(\d{1,2}:\d{2}\s*TO\s*\d{1,2}:\d{2}\s*(AM|PM)?)/i);
  if (m) return m[1].replace(/\s+/g, " ").trim();
  return "";
}

async function nextAdmissionId() {
  const year = new Date().getFullYear();
  const prefix = `ADM-${year}-`;
  const latest = await Admission.findOne({ admissionId: new RegExp(`^${prefix}`) })
    .sort({ admissionId: -1 })
    .select("admissionId")
    .lean();
  let seq = 1;
  if (latest?.admissionId) {
    const n = parseInt(latest.admissionId.slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function resolveCourse(excelClass, courses) {
  const raw = cleanCell(excelClass);
  if (!raw) {
    return { course: null, status: "UNRESOLVED COURSE", reason: "Class is empty" };
  }
  const exactCode = courses.find(
    (c) => String(c.code || "").trim().toUpperCase() === raw.toUpperCase()
  );
  if (exactCode) return { course: exactCode, status: "RESOLVED", reason: "Exact Course.code" };

  const exactName = courses.find((c) => String(c.name || "").trim() === raw);
  if (exactName) return { course: exactName, status: "RESOLVED", reason: "Exact Course.name" };

  const ciName = courses.find(
    (c) => String(c.name || "").trim().toLowerCase() === raw.toLowerCase()
  );
  if (ciName) return { course: ciName, status: "RESOLVED", reason: "Case-insensitive Course.name" };

  const delimited = courses.filter((c) => {
    const name = String(c.name || "").trim();
    const code = String(c.code || "").trim();
    const delim = /^\s*[-–—:]\s+/;
    if (name && raw.toLowerCase().startsWith(name.toLowerCase()) && delim.test(raw.slice(name.length))) {
      return true;
    }
    if (code && raw.toUpperCase().startsWith(code.toUpperCase()) && delim.test(raw.slice(code.length))) {
      return true;
    }
    return false;
  });
  if (delimited.length === 1) {
    return {
      course: delimited[0],
      status: "RESOLVED",
      reason: "Exact Course.name/code prefix before delimiter",
    };
  }
  if (delimited.length > 1) {
    return {
      course: null,
      status: "UNRESOLVED COURSE",
      reason: `Ambiguous prefix match: ${delimited.map((c) => c.code || c.name).join(", ")}`,
    };
  }

  const aliasKeys = APPROVED_COURSE_ALIASES[normKey(raw)];
  if (aliasKeys) {
    for (const key of aliasKeys) {
      const hit = courses.find(
        (c) =>
          String(c.code || "").toUpperCase() === String(key).toUpperCase() ||
          String(c.name || "").toLowerCase() === String(key).toLowerCase()
      );
      if (hit) return { course: hit, status: "RESOLVED", reason: "Approved manual mapping table" };
    }
    return {
      course: null,
      status: "UNRESOLVED COURSE",
      reason: `Alias defined (${aliasKeys.join(", ")}) but course is not in the database`,
    };
  }

  return { course: null, status: "UNRESOLVED COURSE", reason: "No unique exact/approved match" };
}

function resolveUniversity(course) {
  if (!course) return { universityId: null, university: null, status: "SKIPPED" };
  if (isInstituteCourse(course)) {
    return {
      universityId: null,
      university: null,
      status: "INSTITUTE_NULL",
      note: "Institute course — universityId left null",
    };
  }
  if (!course.universityId) {
    return {
      universityId: null,
      university: null,
      status: "UNRESOLVED UNIVERSITY",
      note: "University/ITI course is missing universityId",
    };
  }
  return {
    universityId: course.universityId,
    university: null,
    status: "FROM_COURSE",
  };
}

function resolveBatch(excelBatch, course, batches) {
  const raw = cleanCell(excelBatch);
  if (!course) {
    return { batch: null, status: "SKIPPED", reason: "Course unresolved" };
  }
  if (!raw) {
    return { batch: null, status: "UNRESOLVED BATCH", reason: "Batch is empty" };
  }
  const sameCourse = batches.filter(
    (b) => String(b.courseId) === String(course._id) && b.softDelete !== true
  );
  const byId = sameCourse.find(
    (b) => String(b.batchId || "").toUpperCase() === raw.toUpperCase()
  );
  if (byId) return { batch: byId, status: "RESOLVED", reason: "Exact Batch.batchId on same course" };

  const byName = sameCourse.find((b) => String(b.name || "").trim() === raw);
  if (byName) return { batch: byName, status: "RESOLVED", reason: "Exact Batch.name on same course" };

  const byNorm = sameCourse.find((b) => normKey(b.name) === normKey(raw));
  if (byNorm) return { batch: byNorm, status: "RESOLVED", reason: "Normalized Batch.name on same course" };

  return {
    batch: null,
    status: "WOULD_CREATE_BATCH",
    reason: "No existing batch on this course matches Excel name",
    proposedName: raw,
  };
}

async function loadMasters() {
  const [universities, courses, batches, admissions, students] = await Promise.all([
    University.find({ softDelete: { $ne: true } }).lean(),
    Course.find({ softDelete: { $ne: true } }).lean(),
    Batch.find({ softDelete: { $ne: true } }).lean(),
    Admission.find()
      .select(
        "admissionId applicant email phone course courseId universityId status studentId studentMongoId details.excelStudentCode details.batchId"
      )
      .lean(),
    Student.find().select("studentId admissionId admissionMongoId nameEnglish contact courseId batchId").lean(),
  ]);
  const uniById = new Map(universities.map((u) => [String(u._id), u]));
  for (const course of courses) {
    if (course.universityId) {
      course._university = uniById.get(String(course.universityId)) || null;
    }
  }
  return { universities, courses, batches, admissions, students, uniById };
}

function findDuplicate(row, { admissions, students }) {
  const code = row.studentCode;
  if (code) {
    const byCode = admissions.find(
      (a) => String(a.details?.excelStudentCode || "").trim() === code
    );
    if (byCode) return { type: "DUPLICATE / ALREADY IMPORTED", admission: byCode, via: "details.excelStudentCode" };
  }
  if (TNS_STUDENT_ID_RE.test(code)) {
    const bySid = students.find((s) => String(s.studentId).toUpperCase() === code.toUpperCase());
    if (bySid) return { type: "DUPLICATE / ALREADY IMPORTED", student: bySid, via: "Student.studentId" };
  }
  const email = row.email;
  const name = row.applicant;
  if (email && name) {
    const byEmailName = admissions.find(
      (a) =>
        String(a.email || "").toLowerCase() === email &&
        String(a.applicant || "").trim().toUpperCase() === name
    );
    if (byEmailName) return { type: "DUPLICATE / ALREADY IMPORTED", admission: byEmailName, via: "email + name" };
  }
  const phone = row.phone;
  if (phone && name) {
    const byPhoneName = admissions.find((a) => {
      const digits = String(a.phone || "").replace(/\D/g, "").slice(-10);
      return digits === phone && String(a.applicant || "").trim().toUpperCase() === name;
    });
    if (byPhoneName) return { type: "DUPLICATE / ALREADY IMPORTED", admission: byPhoneName, via: "phone + name" };
  }
  return null;
}

function planRow(excelRowNumber, rawRow, headerMap, masters) {
  const issues = [];
  const studentCode = rowValue(rawRow, headerMap, "studentCode");
  const userId = rowValue(rawRow, headerMap, "userId");
  const fullName = rowValue(rawRow, headerMap, "fullName");
  const applicant = fullName ? fullName.toUpperCase() : "";
  const className = rowValue(rawRow, headerMap, "className");
  const batchName = rowValue(rawRow, headerMap, "batch");
  const admittedInClass = rowValue(rawRow, headerMap, "admittedInClass");
  const admissionType = rowValue(rawRow, headerMap, "admissionType");
  const currentAddress = rowValue(rawRow, headerMap, "currentAddress");
  const cityDistrict = rowValue(rawRow, headerMap, "cityDistrict");
  const country = rowValue(rawRow, headerMap, "country");
  const countryCode = rowValue(rawRow, headerMap, "countryCode");
  const parentsCode = rowValue(rawRow, headerMap, "parentsCode");
  const parentsId = rowValue(rawRow, headerMap, "parentsId");
  const fatherOccupation = rowValue(rawRow, headerMap, "fatherOccupation");
  const motherOccupation = rowValue(rawRow, headerMap, "motherOccupation");
  const grSr = rowValue(rawRow, headerMap, "grSr");
  const serial = rowValue(rawRow, headerMap, "serial");

  const isEmpty = !fullName && !studentCode && !className && !batchName;
  if (isEmpty) {
    return {
      excelRow: excelRowNumber,
      serial,
      applicant: "",
      action: "SKIPPED",
      status: "EMPTY ROW",
      reasons: ["Empty row"],
    };
  }

  const admissionDateParsed = parseDdMmYyyy(rowValue(rawRow, headerMap, "admissionDate"));
  const dobParsed = parseDdMmYyyy(rowValue(rawRow, headerMap, "birthDate"));
  const gender = normalizeGender(rowValue(rawRow, headerMap, "gender"));
  const rawGender = rowValue(rawRow, headerMap, "gender");
  const contact = normalizePhone(rowValue(rawRow, headerMap, "contactNo"));
  const mobile = normalizePhone(rowValue(rawRow, headerMap, "mobileNumber"));
  const fatherContact = normalizePhone(rowValue(rawRow, headerMap, "fatherContact"));
  const motherContact = normalizePhone(rowValue(rawRow, headerMap, "motherContact"));
  const parsedEmail = normalizeEmail(rowValue(rawRow, headerMap, "email"));
  const rawEmail = rowValue(rawRow, headerMap, "email");
  const emailPlaceholder = !parsedEmail;
  const email = parsedEmail || placeholderEmail(studentCode, excelRowNumber);
  const modeInfo = normalizeMode(admissionType);

  const phone = contact.phone || mobile.phone;
  const studentMobile = mobile.phone || contact.phone;

  if (!applicant) issues.push("Missing required field: Full Name");
  if (!phone) issues.push("Missing/invalid phone (Contact No / Mobile Number)");
  if (admissionDateParsed.error) issues.push(`Invalid admission date: ${admissionDateParsed.error}`);
  if (rowValue(rawRow, headerMap, "birthDate") && dobParsed.error) {
    issues.push(`Invalid birth date: ${dobParsed.error}`);
  }
  if (rawGender && !gender) issues.push(`Gender "${rawGender}" is not Male/Female/Other`);
  if (modeInfo.unmapped) issues.push(`Admission Type "${modeInfo.original}" is not Online/Offline/Walk-in`);

  const courseHit = resolveCourse(className, masters.courses);
  if (!courseHit.course) issues.push(`${courseHit.status}: ${className || "(empty)"} — ${courseHit.reason}`);

  const uniHit = resolveUniversity(courseHit.course);
  if (uniHit.status === "UNRESOLVED UNIVERSITY") issues.push(uniHit.note);

  let universityDoc = null;
  if (uniHit.universityId) {
    universityDoc = masters.uniById.get(String(uniHit.universityId)) || null;
    if (!universityDoc) issues.push("University id on course was not found");
  }

  const termHit = courseHit.course
    ? termFromExcel({ admittedInClass, batchName, course: courseHit.course })
    : { termType: "", termNumber: null, evidenced: false, issue: "" };
  if (termHit.issue) issues.push(termHit.issue);

  const session = admissionDateParsed.date ? indianSessionFromDate(admissionDateParsed.date) : "";
  if (courseHit.course && !session) issues.push("Session could not be derived (admission date missing/invalid)");

  const batchHit = resolveBatch(batchName, courseHit.course, masters.batches);

  const officeRegistrationNo =
    grSr && !normalizeEmail(grSr) && !grSr.includes("@") ? grSr : "";

  const duplicate = findDuplicate(
    { studentCode, email, applicant, phone },
    masters
  );

  const mode = modeInfo.mode || (modeInfo.empty ? "Offline" : "");
  const cityPlace = cityDistrict;
  const state = PLACE_TO_STATE[normKey(cityPlace)] || "";

  const guardianMobile = fatherContact.phone || motherContact.phone || "";
  const relation = fatherContact.phone ? "Father" : motherContact.phone ? "Mother" : "";

  const ready =
    issues.length === 0 &&
    Boolean(courseHit.course) &&
    Boolean(applicant) &&
    Boolean(email) &&
    Boolean(phone) &&
    Boolean(admissionDateParsed.date) &&
    Boolean(session) &&
    (!academicStructure(courseHit.course).count || termHit.termNumber) &&
    (uniHit.status !== "UNRESOLVED UNIVERSITY") &&
    !modeInfo.unmapped &&
    batchHit.status !== "SKIPPED";

  let action = "IMPORT";
  if (duplicate) action = "DUPLICATE / ALREADY IMPORTED";
  else if (!courseHit.course) action = "SKIPPED";
  else if (issues.length) action = "SKIPPED";
  else if (batchHit.status === "UNRESOLVED BATCH" && !batchName) action = "SKIPPED";

  return {
    excelRow: excelRowNumber,
    serial,
    studentCode,
    userId,
    applicant,
    email,
    emailPlaceholder,
    phone,
    studentMobile,
    className,
    batchName,
    admittedInClass,
    gender,
    mode,
    modeNote: [
      modeInfo.empty ? "Admission Type empty — using master-admin form default Offline" : "",
      emailPlaceholder
        ? `Email missing in Excel — placeholder ${email} (edit later)`
        : "",
      termHit.assumed ? `Term assumed as ${termHit.termType} 1 from course structure` : "",
    ]
      .filter(Boolean)
      .join("; "),
    session,
    termType: termHit.termType || "",
    termNumber: termHit.termNumber,
    admissionDate: admissionDateParsed.date,
    admissionDateIso: admissionDateParsed.iso,
    dateOfBirth: dobParsed.iso,
    currentAddress,
    cityDistrict,
    state,
    country,
    countryCode,
    officeRegistrationNo,
    guardianMobile,
    relation,
    fatherContact: fatherContact.phone,
    motherContact: motherContact.phone,
    fatherOccupation,
    motherOccupation,
    parentsCode,
    parentsId,
    course: courseHit.course
      ? {
          _id: String(courseHit.course._id),
          name: courseHit.course.name,
          code: courseHit.course.code,
          type: courseHit.course.type,
          universityId: courseHit.course.universityId ? String(courseHit.course.universityId) : null,
          universityName: courseHit.course.universityName || courseHit.course._university?.name || "",
          universityShortName:
            courseHit.course.universityShortName || courseHit.course._university?.shortName || "",
          fee: courseHit.course.fees?.total || "",
          label: courseDisplayLabel(courseHit.course),
        }
      : null,
    courseStatus: courseHit.status,
    courseReason: courseHit.reason,
    universityStatus: uniHit.status,
    universityId: uniHit.universityId ? String(uniHit.universityId) : null,
    universityName:
      universityDoc?.name ||
      courseHit.course?.universityName ||
      (isInstituteCourse(courseHit.course)
        ? "Thakur Niranjan Singh I.T.I. & Computer"
        : ""),
    universityShortName:
      universityDoc?.shortName ||
      courseHit.course?.universityShortName ||
      (isInstituteCourse(courseHit.course) ? "TNS" : ""),
    batch: batchHit.batch
      ? {
          _id: String(batchHit.batch._id),
          batchId: batchHit.batch.batchId,
          name: batchHit.batch.name,
          capacity: batchHit.batch.capacity,
          enrolledCount: batchHit.batch.enrolledCount,
        }
      : null,
    batchStatus: batchHit.status,
    batchReason: batchHit.reason,
    proposedBatchName: batchHit.proposedName || batchName,
    duplicate,
    issues,
    action: duplicate ? "DUPLICATE / ALREADY IMPORTED" : ready ? "IMPORT" : "SKIPPED",
    ready: Boolean(ready && !duplicate),
  };
}

function summarize(plans) {
  const courseMap = new Map();
  const batchMap = new Map();
  for (const p of plans) {
    const ck = p.className || "(empty)";
    if (!courseMap.has(ck)) {
      courseMap.set(ck, {
        excel: ck,
        matchedName: p.course?.name || "",
        code: p.course?.code || "",
        id: p.course?._id || "",
        type: p.course?.type || "",
        university: p.universityName || "",
        status: p.courseStatus,
        rows: 0,
      });
    }
    courseMap.get(ck).rows += 1;

    const bk = `${p.className || ""}||${p.batchName || ""}`;
    if (!batchMap.has(bk)) {
      batchMap.set(bk, {
        excelBatch: p.batchName || "",
        excelClass: p.className || "",
        course: p.course?.name || "",
        matchedName: p.batch?.name || p.proposedBatchName || "",
        batchId: p.batch?.batchId || "",
        mongoId: p.batch?._id || "",
        capacity: p.batch?.capacity ?? "",
        enrolledCount: p.batch?.enrolledCount ?? "",
        status: p.batchStatus,
        rows: 0,
      });
    }
    batchMap.get(bk).rows += 1;
  }

  return {
    total: plans.length,
    empty: plans.filter((p) => p.status === "EMPTY ROW").length,
    ready: plans.filter((p) => p.ready).length,
    skipped: plans.filter((p) => p.action === "SKIPPED").length,
    duplicates: plans.filter((p) => p.action === "DUPLICATE / ALREADY IMPORTED").length,
    unresolvedCourses: plans.filter((p) => p.courseStatus === "UNRESOLVED COURSE").length,
    unresolvedBatches: plans.filter(
      (p) => p.batchStatus === "UNRESOLVED BATCH" || p.batchStatus === "WOULD_CREATE_BATCH"
    ).length,
    wouldCreateBatches: [...new Set(plans.filter((p) => p.batchStatus === "WOULD_CREATE_BATCH").map((p) => p.proposedBatchName))],
    invalidDates: plans.filter((p) => p.issues.some((i) => /date/i.test(i))).length,
    invalidPhones: plans.filter((p) => p.issues.some((i) => /phone/i.test(i))).length,
    missingRequired: plans.filter((p) => p.issues.some((i) => /Missing required/i.test(i))).length,
    termSessionIssues: plans.filter((p) => p.issues.some((i) => /term|session/i.test(i))).length,
    courseMap: [...courseMap.values()],
    batchMap: [...batchMap.values()],
  };
}

function printDryRun(summary, plans, unmappedColumns) {
  const lines = [];
  const p = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  p("================================================");
  p("EXCEL ADMISSION IMPORT — DRY RUN REPORT");
  p("================================================");
  p("");
  p(`Total Excel Rows: ${summary.total}`);
  p(`Empty Rows: ${summary.empty}`);
  p(`Valid Rows (non-empty): ${summary.total - summary.empty}`);
  p(`Rows Ready for Import: ${summary.ready}`);
  p(`Skipped Rows: ${summary.skipped}`);
  p(`Resolved Courses (row-level): ${plans.filter((x) => x.course).length}`);
  p(`Unresolved Courses (row-level): ${summary.unresolvedCourses}`);
  p(`Resolved Universities via Course: ${plans.filter((x) => x.course && x.universityStatus !== "UNRESOLVED UNIVERSITY").length}`);
  p(`Resolved Batches (existing): ${plans.filter((x) => x.batch).length}`);
  p(`Unresolved / new Batches: ${summary.unresolvedBatches}`);
  p(`Potential Duplicates: ${summary.duplicates}`);
  p(`Invalid Dates: ${summary.invalidDates}`);
  p(`Invalid Phone Numbers: ${summary.invalidPhones}`);
  p(`Missing Required Fields: ${summary.missingRequired}`);
  p(`Term/Session Issues: ${summary.termSessionIssues}`);
  p("");
  p("Unmapped Excel Columns:");
  for (const col of unmappedColumns) p(`- ${col.name}: ${col.reason}`);
  p("");
  p("================================================");
  p("COURSE MAPPING");
  p("================================================");
  for (const c of summary.courseMap) {
    p(`${c.excel}`);
    p(`        ↓`);
    p(`Matched Course Name: ${c.matchedName || "(none)"}`);
    p(`        ↓`);
    p(`Course Code: ${c.code || "(none)"}`);
    p(`        ↓`);
    p(`Course ID: ${c.id || "(none)"}`);
    p(`        ↓`);
    p(`Course Type: ${c.type || "(none)"}`);
    p(`        ↓`);
    p(`University: ${c.university || "(none)"}`);
    p(`Status: ${c.status}  Rows: ${c.rows}`);
    p("");
  }
  p("================================================");
  p("BATCH MAPPING");
  p("================================================");
  for (const b of summary.batchMap) {
    p(`Excel Batch: ${b.excelBatch || "(empty)"}`);
    p(`        ↓`);
    p(`Course: ${b.course || b.excelClass || "(none)"}`);
    p(`        ↓`);
    p(`Matched Batch Name: ${b.matchedName || "(none)"}`);
    p(`        ↓`);
    p(`Batch ID: ${b.batchId || "(none — would create if course resolved)"}`);
    p(`        ↓`);
    p(`Batch MongoDB ID: ${b.mongoId || "(none)"}`);
    p(`        ↓`);
    p(`Capacity: ${b.capacity === "" ? "(n/a)" : b.capacity}`);
    p(`        ↓`);
    p(`Current Enrollment: ${b.enrolledCount === "" ? "(n/a)" : b.enrolledCount}`);
    p(`Status: ${b.status}  Rows: ${b.rows}`);
    p("");
  }
  p("================================================");
  p("ROW ACTIONS (skipped / duplicate)");
  p("================================================");
  for (const row of plans.filter((x) => x.action !== "IMPORT")) {
    p(`Row ${row.excelRow}  ${row.applicant || "(no name)"}  ${row.action}`);
    for (const reason of row.issues || row.reasons || []) p(`  - ${reason}`);
    if (row.duplicate) p(`  - Existing via ${row.duplicate.via}`);
  }
  return lines.join("\n");
}

async function findOrCreateBatch(plan, ctx, execute) {
  const batchCache = ctx.batchCache;
  const key = `${plan.course._id}::${normKey(plan.batchName)}`;
  if (batchCache.has(key)) return batchCache.get(key);
  if (plan.batch) {
    const existing = await Batch.findById(plan.batch._id);
    batchCache.set(key, existing);
    return existing;
  }
  if (!execute) return null;
  if (!plan.batchName) return null;

  const created = await createBatch(
    {
      name: plan.batchName,
      courseId: plan.course._id,
      universityId: plan.universityId,
      startDate: ctx.batchStartDates?.get(key) || plan.admissionDate,
      schedule: scheduleFromBatchName(plan.batchName) || "Mon–Sat · Morning",
      currentSemester: plan.termNumber || 1,
      capacity: 40,
    },
    EDITOR
  );
  const doc = await Batch.findById(created._id);
  batchCache.set(key, doc);
  return doc;
}

function buildDetails(plan, admissionId) {
  return {
    registrationNo: admissionId,
    nameEnglish: plan.applicant,
    nameHindi: "",
    fatherName: "",
    motherName: "",
    dateOfBirth: plan.dateOfBirth || "",
    gender: plan.gender || "",
    category: "",
    samagraId: "",
    casteCertificateNo: "",
    maritalStatus: "",
    husbandName: "",
    education: [],
    permanentAddress: plan.currentAddress || "",
    village: "",
    post: "",
    tehsil: "",
    pinCode: "",
    contactNo: plan.phone,
    homeAddress: plan.currentAddress || "",
    officeRegistrationNo: plan.officeRegistrationNo || "",
    totalFee: plan.course?.fee || "",
    courseId: plan.course._id,
    universityId: plan.universityId || "",
    universityName: plan.universityName,
    universityNameSnapshot: plan.universityName,
    universityShortName: plan.universityShortName,
    courseNameSnapshot: plan.course.name,
    courseCodeSnapshot: plan.course.code,
    termType: plan.termType || "",
    termNumber: plan.termNumber || "",
    session: plan.session,
    officeDate: "",
    applicantDate: "",
    photoPreview: "",
    institutionName: "ग्रो स्किल्स टेक",
    guardianName: "",
    guardianAddress: plan.currentAddress || "",
    relation: plan.relation,
    guardianMobile: plan.guardianMobile,
    studentMobile: plan.studentMobile,
    district: plan.cityDistrict,
    excelStudentCode: plan.studentCode,
    excelUserId: plan.userId,
    importSource: IMPORT_FILE_LABEL,
    importExcelRow: plan.excelRow,
    emailPlaceholder: Boolean(plan.emailPlaceholder),
    importMeta: {
      serial: plan.serial,
      excelClass: plan.className,
      excelBatch: plan.batchName,
      country: plan.country,
      countryCode: plan.countryCode,
      parentsCode: plan.parentsCode,
      parentsId: plan.parentsId,
      fatherOccupation: plan.fatherOccupation,
      motherOccupation: plan.motherOccupation,
      fatherContact: plan.fatherContact,
      motherContact: plan.motherContact,
      grSr: plan.officeRegistrationNo,
      emailPlaceholder: Boolean(plan.emailPlaceholder),
    },
  };
}

async function executePlan(plan, ctx) {
  const result = {
    excelRow: plan.excelRow,
    student: plan.applicant,
    course: plan.course?.label || plan.className,
    university: plan.universityName,
    admissionStatus: "Approved",
    admission: "",
    studentRecord: "",
    batch: plan.batchName,
    batchAssigned: false,
    error: "",
    action: "",
  };

  try {
    if (plan.duplicate?.admission) {
      result.action = "DUPLICATE / ALREADY IMPORTED";
      result.admission = plan.duplicate.admission.admissionId;
      const admission = await Admission.findById(plan.duplicate.admission._id);
      if (admission?.status === "Approved") {
        const student = await ensureStudentFromAdmission(admission._id, EDITOR);
        result.studentRecord = student?.studentId || admission.studentId || "";
        if (plan.batchName && plan.course) {
          const batchDoc = await findOrCreateBatch(plan, ctx, true);
          if (batchDoc) {
            const capacity = Number(batchDoc.capacity) || 20;
            const enrolled = Number(batchDoc.enrolledCount) || 0;
            const already =
              String(admission.details?.batchMongoId || "") === String(batchDoc._id) ||
              String(admission.details?.batchId || "") === String(batchDoc.batchId);
            if (already) {
              result.batchAssigned = true;
              result.action = "DUPLICATE — already in batch";
            } else if (enrolled >= capacity) {
              result.error = "BATCH CAPACITY EXCEEDED";
            } else {
              await assignBatchStudents(batchDoc._id, [admission._id], EDITOR);
              result.batchAssigned = true;
              result.action = "DUPLICATE — student/batch synced";
            }
          }
        }
      }
      ctx.counts.duplicates += 1;
      return result;
    }

    const admissionId = await nextAdmissionId();
    const details = buildDetails(plan, admissionId);
    const created = await Admission.create({
      admissionId,
      applicant: plan.applicant,
      email: plan.email,
      phone: plan.phone,
      course: plan.course.label,
      courseId: plan.course._id,
      universityId: plan.universityId || null,
      termType: plan.termType || "",
      termNumber: plan.termNumber,
      session: plan.session,
      mode: plan.mode || "Offline",
      counsellor: "",
      fee: plan.course.fee || "",
      status: "Approved",
      city: plan.cityDistrict || "",
      state: plan.state || "",
      college: plan.universityName || "",
      studentStatus: "Active",
      notes: `Imported from ${IMPORT_FILE_LABEL} row ${plan.excelRow}`,
      details,
      admissionDate: plan.admissionDate,
      createdBy: EDITOR,
    });
    result.admission = created.admissionId;
    result.action = "CREATED";
    ctx.counts.created += 1;

    try {
      await upsertFeeFromAdmission(created);
    } catch (feeErr) {
      console.error("fee sync failed:", created.admissionId, feeErr?.message || feeErr);
    }

    const student = await ensureStudentFromAdmission(created._id, EDITOR);
    if (!student) {
      result.error = "Admission created but Student conversion failed";
      ctx.counts.studentFailed += 1;
      return result;
    }
    result.studentRecord = student.studentId || student.id || "";
    ctx.counts.studentsCreated += 1;

    if (plan.studentCode && TNS_STUDENT_ID_RE.test(plan.studentCode)) {
      result.error = `Excel Student Code ${plan.studentCode} was not applied; kept generated ${result.studentRecord}`;
    }
    ctx.idMap.push({
      excelRow: plan.excelRow,
      excelStudentCode: plan.studentCode,
      generatedStudentId: result.studentRecord,
      admissionId: created.admissionId,
    });

    if (plan.batchName) {
      const batchDoc = await findOrCreateBatch(plan, ctx, true);
      if (!batchDoc) {
        result.error = (result.error ? `${result.error}; ` : "") + "Batch could not be created/resolved";
      } else {
        const fresh = await Batch.findById(batchDoc._id);
        const capacity = Number(fresh.capacity) || 20;
        const enrolled = Number(fresh.enrolledCount) || 0;
        if (enrolled >= capacity) {
          result.error = (result.error ? `${result.error}; ` : "") + "BATCH CAPACITY EXCEEDED";
          ctx.counts.capacity += 1;
        } else {
          await assignBatchStudents(fresh._id, [created._id], EDITOR);
          result.batchAssigned = true;
          ctx.counts.batchAssigned += 1;
        }
      }
    }
    return result;
  } catch (err) {
    result.action = "FAILED";
    result.error = err?.message || String(err);
    ctx.counts.failed += 1;
    return result;
  }
}

function unmappedColumnReport() {
  return [
    {
      name: "User id",
      reason: "Equals Student Code (stu_*) — not User._id or Student.studentId",
      action: "SOURCE ONLY — stored in details.excelUserId / importMeta",
    },
    {
      name: "Student Code",
      reason: "Format stu_* is incompatible with TNS-{year}-#####",
      action: "Keep generated Student.studentId; store original in details.excelStudentCode",
    },
    {
      name: "G.R. No. / S.R. No.",
      reason: "No dedicated GR/SR field; almost all rows empty",
      action: "Map valid values to details.officeRegistrationNo; do not replace admissionId",
    },
    {
      name: "Admission Type",
      reason: "All 126 cells empty; cannot map to mode from Excel",
      action: "Use existing master-admin form default Offline; log as empty source column",
    },
    {
      name: "Admitted In Class",
      reason: "All 126 cells empty",
      action: "Term taken from Batch text only when SEM I / YEAR evidence exists",
    },
    {
      name: "Country Code",
      reason: "No schema field",
      action: "SOURCE ONLY / UNMAPPED — stored in details.importMeta.countryCode",
    },
    {
      name: "Country",
      reason: "No schema field",
      action: "SOURCE ONLY / UNMAPPED — stored in details.importMeta.country",
    },
    {
      name: "Parents Code / Parents ID",
      reason: "No Parent collection",
      action: "SOURCE ONLY / UNMAPPED — stored in details.importMeta",
    },
    {
      name: "Father Occupation / Mother Occupation",
      reason: "No occupation fields",
      action: "SOURCE ONLY / UNMAPPED",
    },
    {
      name: "Father Contact NO / Mother Contact NO",
      reason: "No parent-specific phone fields; invalid 91- treated as missing",
      action: "Valid number → details.guardianMobile (Father preferred)",
    },
  ];
}

async function main() {
  const execute = argFlag("--execute");
  const filePath = defaultExcelPath();
  const reportDir = path.resolve(process.cwd(), "data/imports/reports");
  fs.mkdirSync(reportDir, { recursive: true });

  console.log(`Excel: ${filePath}`);
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"}`);

  const { sheetName, matrix } = readWorkbookRows(filePath);
  if (!matrix.length) throw new Error("Workbook is empty");
  const headerRow = matrix[0];
  const { map: headerMap, rawHeaders } = headerIndexMap(headerRow);
  const missingHeaders = Object.keys(HEADER_ALIASES).filter((k) => headerMap[k] == null);
  if (missingHeaders.length) {
    console.warn("Unmatched logical headers:", missingHeaders.join(", "));
  }

  await connectMongo();
  const masters = await loadMasters();

  const dataRows = matrix.slice(1);
  const plans = [];
  dataRows.forEach((raw, i) => {
    const excelRowNumber = i + 2;
    plans.push(planRow(excelRowNumber, raw, headerMap, masters));
  });

  const summary = summarize(plans);
  const unmapped = unmappedColumnReport();
  const dryText = printDryRun(summary, plans, unmapped);

  const dryJson = {
    sheetName,
    filePath,
    rawHeaders,
    headerMap,
    summary,
    unmappedColumns: unmapped,
    uniqueClasses: summary.courseMap,
    uniqueBatches: summary.batchMap,
    rows: plans.map((p) => ({
      excelRow: p.excelRow,
      serial: p.serial,
      applicant: p.applicant,
      studentCode: p.studentCode,
      email: p.email || "",
      phone: p.phone || "",
      className: p.className,
      batchName: p.batchName,
      action: p.action,
      ready: p.ready,
      issues: p.issues,
      course: p.course,
      universityId: p.universityId,
      universityName: p.universityName,
      session: p.session,
      termType: p.termType,
      termNumber: p.termNumber,
      admissionDateIso: p.admissionDateIso,
      mode: p.mode,
      modeNote: p.modeNote,
    })),
  };
  const dryPath = path.join(reportDir, "admission-import-dry-run.json");
  fs.writeFileSync(dryPath, JSON.stringify(dryJson, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "admission-import-dry-run.txt"), dryText, "utf8");
  console.log(`\nDry-run JSON: ${dryPath}`);

  if (!execute) {
    await mongoose.disconnect();
    return;
  }

  console.log("\n--- EXECUTE IMPORT ---\n");
  const batchStartDates = new Map();
  for (const plan of plans) {
    if (!plan.course || !plan.batchName || !plan.admissionDate) continue;
    const key = `${plan.course._id}::${normKey(plan.batchName)}`;
    const prev = batchStartDates.get(key);
    if (!prev || plan.admissionDate < prev) batchStartDates.set(key, plan.admissionDate);
  }
  const ctx = {
    batchCache: new Map(),
    batchStartDates,
    idMap: [],
    counts: {
      created: 0,
      duplicates: 0,
      studentsCreated: 0,
      studentFailed: 0,
      batchAssigned: 0,
      capacity: 0,
      failed: 0,
    },
  };

  const results = [];
  for (const plan of plans) {
    if (plan.status === "EMPTY ROW") {
      results.push({
        excelRow: plan.excelRow,
        student: "",
        action: "EMPTY ROW",
        error: "Empty row",
      });
      continue;
    }
    if (plan.action === "SKIPPED" && !plan.duplicate) {
      results.push({
        excelRow: plan.excelRow,
        student: plan.applicant,
        course: plan.className,
        action: "SKIPPED",
        error: (plan.issues || []).join("; "),
        batchAssigned: false,
      });
      continue;
    }
    const rowResult = await executePlan(plan, ctx);
    results.push(rowResult);
    const tag = rowResult.error ? "FAILED/WARN" : rowResult.action;
    console.log(
      `Row ${rowResult.excelRow} ${rowResult.student}: ${tag} admission=${rowResult.admission || "-"} student=${rowResult.studentRecord || "-"} batch=${rowResult.batchAssigned}`
    );
    if (rowResult.error) console.log(`  ${rowResult.error}`);
  }

  const approvedImported = await Admission.countDocuments({
    status: "Approved",
    "details.importSource": IMPORT_FILE_LABEL,
  });
  const studentsFromImport = await Student.countDocuments({
    admissionId: { $in: ctx.idMap.map((x) => x.admissionId) },
  });

  const finalReport = {
    totalExcelRecords: plans.length,
    successfullyProcessed: plans.length,
    approvedAdmissionsCreated: ctx.counts.created,
    admissionsUpdated: 0,
    duplicateAdmissionsSkipped: ctx.counts.duplicates,
    studentsCreated: ctx.counts.studentsCreated,
    existingStudentsLinked: ctx.counts.duplicates,
    studentsSuccessfullyBatchAssigned: ctx.counts.batchAssigned,
    unresolvedCourses: summary.unresolvedCourses,
    unresolvedBatches: summary.wouldCreateBatches.length,
    batchCapacityIssues: ctx.counts.capacity,
    invalidDates: summary.invalidDates,
    invalidPhoneNumbers: summary.invalidPhones,
    missingRequiredData: summary.missingRequired,
    failedRecords: ctx.counts.failed,
    unmappedExcelColumns: unmapped.length,
    approvedImportedNow: approvedImported,
    studentsFromThisRun: studentsFromImport,
    studentCodeMap: ctx.idMap,
    results,
  };

  const execPath = path.join(reportDir, "admission-import-execute.json");
  fs.writeFileSync(execPath, JSON.stringify(finalReport, null, 2), "utf8");

  console.log("\n================================================");
  console.log("FINAL EXCEL IMPORT REPORT");
  console.log("================================================");
  console.log(`Total Excel Records: ${finalReport.totalExcelRecords}`);
  console.log(`Successfully Processed: ${finalReport.successfullyProcessed}`);
  console.log(`Approved Admissions Created: ${finalReport.approvedAdmissionsCreated}`);
  console.log(`Admissions Updated: ${finalReport.admissionsUpdated}`);
  console.log(`Duplicate Admissions Skipped: ${finalReport.duplicateAdmissionsSkipped}`);
  console.log(`Students Created: ${finalReport.studentsCreated}`);
  console.log(`Existing Students Linked: ${finalReport.existingStudentsLinked}`);
  console.log(`Students Successfully Batch Assigned: ${finalReport.studentsSuccessfullyBatchAssigned}`);
  console.log(`Unresolved Courses: ${finalReport.unresolvedCourses}`);
  console.log(`Unresolved Batches (unique names needing create): ${finalReport.unresolvedBatches}`);
  console.log(`Batch Capacity Issues: ${finalReport.batchCapacityIssues}`);
  console.log(`Invalid Dates: ${finalReport.invalidDates}`);
  console.log(`Invalid Phone Numbers: ${finalReport.invalidPhoneNumbers}`);
  console.log(`Missing Required Data: ${finalReport.missingRequiredData}`);
  console.log(`Failed Records: ${finalReport.failedRecords}`);
  console.log(`Unmapped Excel Columns: ${finalReport.unmappedExcelColumns}`);
  console.log(`Execute JSON: ${execPath}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Import failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
