import path from "path";
import XLSX from "xlsx";
import { Admission } from "../../models/Admission.js";
import { bufferToDataUrl } from "../../lib/photo.js";

const REQUIRED_HEADERS = ["Student Code", "User id", "Full Name"];
const EMPTY_VALUES = new Set(["", "-", "n/a", "na", "null", "undefined", "nan"]);
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function text(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  const valueText = String(value).replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  return EMPTY_VALUES.has(valueText.toLowerCase()) ? "" : valueText;
}

function key(value) {
  return text(value).toUpperCase();
}

export function hasMeaningfulValue(value) {
  return text(value) !== "";
}

export function normalizePhone(value) {
  const original = text(value);
  if (!original) return { value: "", valid: false, original: "" };
  let digits = original.replace(/\D/g, "");
  if (digits === "91") return { value: "", valid: false, original };
  if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(-10);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(-10);
  const valid = /^[6-9]\d{9}$/.test(digits);
  return { value: valid ? digits : "", valid, original };
}

export function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function dateKey(value) {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : text(value);
}

function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeName(value) {
  return key(value);
}

function normalizeCity(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return "";
  const known = { narsinghpur: "Narsinghpur", kandeli: "Kandeli", gotegaon: "Gotegaon" };
  if (known[raw]) return known[raw];
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeGender(value) {
  const raw = text(value).toLowerCase();
  if (raw === "m" || raw === "male") return "Male";
  if (raw === "f" || raw === "female") return "Female";
  if (raw === "o" || raw === "other") return "Other";
  return "";
}

function normalizeBloodGroup(value) {
  const raw = text(value).replace(/\s+/g, " ");
  const match = raw.match(/^(A|B|AB|O)\s*(Positive|Negative|\+|-)$/i);
  if (!match) return raw;
  return `${match[1].toUpperCase()} ${match[2] === "+" ? "Positive" : match[2] === "-" ? "Negative" : match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()}`;
}

function numericValue(value) {
  const raw = text(value);
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function validAadhar(value) {
  const raw = text(value).replace(/\s+/g, "");
  return /^\d{12}$/.test(raw) ? raw : "";
}

function normalizedHeader(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true, bookFiles: true });
  if (!workbook.SheetNames.length) throw new Error("Workbook has no worksheets");
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true });
  if (!rows.length) throw new Error("Workbook is empty");
  const headers = rows[0].map(text);
  const indexes = new Map(headers.map((header, index) => [normalizedHeader(header), index]));
  const missing = REQUIRED_HEADERS.filter((header) => !indexes.has(normalizedHeader(header)));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const sheets = workbook.SheetNames.map((name) => {
    const values = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", blankrows: true, raw: true });
    return { sheetName: name, range: workbook.Sheets[name]["!ref"] || "", headers: (values[0] || []).map(text), rowCount: Math.max(0, values.length - 1) };
  });
  return { workbook, sheets, sheetName, headers, indexes, rows: rows.slice(1) };
}

function readPhotoAnchors(workbook) {
  const drawing = workbook.files?.["xl/drawings/drawing1.xml"]?.content?.toString("utf8") || "";
  const rels = workbook.files?.["xl/drawings/_rels/drawing1.xml.rels"]?.content?.toString("utf8") || "";
  const relation = new Map([...rels.matchAll(/Id="([^"]+)"[^>]+Target="\.\.\/media\/([^"]+)"/g)].map((match) => [match[1], `xl/media/${match[2]}`]));
  const unique = new Map();
  for (const match of drawing.matchAll(/<xdr:oneCellAnchor>([\s\S]*?)<\/xdr:oneCellAnchor>/g)) {
    const body = match[1];
    const anchorRow = Number(body.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1]);
    const anchorColumn = Number(body.match(/<xdr:col>(\d+)<\/xdr:col>/)?.[1]);
    const relationshipId = body.match(/r:embed="([^"]+)"/)?.[1];
    const mediaPath = relation.get(relationshipId);
    if (!Number.isInteger(anchorRow) || !mediaPath) continue;
    const imageFile = path.basename(mediaPath);
    unique.set(`${anchorRow}|${mediaPath}`, { imageFile, imageIndex: Number(imageFile.match(/image(\d+)/)?.[1] || 0), anchorRow, anchorColumn, excelRowNumber: anchorRow + 1, mediaPath });
  }
  return { totalEmbeddedImages: Object.keys(workbook.files || {}).filter((name) => name.startsWith("xl/media/")).length, items: [...unique.values()] };
}

function photoDataUrl(workbook, photo) {
  const entry = workbook.files?.[photo.mediaPath];
  if (!entry?.content) return null;
  const extension = path.extname(photo.imageFile).toLowerCase();
  const mimeType = PHOTO_EXTENSIONS.has(extension)
    ? extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : extension === ".gif"
          ? "image/gif"
          : "image/jpeg"
    : "image/jpeg";
  return bufferToDataUrl(Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content), mimeType);
}

function cell(row, indexes, header) {
  const index = indexes.get(normalizedHeader(header));
  return index == null ? "" : row[index];
}

function rowData(row, indexes, excelRowNumber) {
  const studentCode = text(cell(row, indexes, "Student Code"));
  const userId = text(cell(row, indexes, "User id"));
  const fullName = text(cell(row, indexes, "Full Name"));
  const contact = normalizePhone(cell(row, indexes, "Contact No"));
  const mobile = normalizePhone(cell(row, indexes, "Mobile Number"));
  const birthRaw = cell(row, indexes, "Birth Date");
  const admissionRaw = cell(row, indexes, "Admission Date");
  const birthDate = parseDate(birthRaw);
  const admissionDate = parseDate(admissionRaw);
  const emailRaw = text(cell(row, indexes, "E-Mail"));
  const email = normalizeEmail(emailRaw);
  return {
    excelRowNumber,
    studentCode,
    userId,
    studentId: text(cell(row, indexes, "Student ID")),
    admissionId: text(cell(row, indexes, "Admission ID")),
    fullName,
    nameKey: normalizeName(fullName),
    birthDate,
    birthDateKey: birthDate ? dateKey(birthDate) : "",
    admissionDate,
    contact,
    mobile,
    phone: contact.valid ? contact.value : mobile.value,
    email,
    emailRaw,
    gender: normalizeGender(cell(row, indexes, "Gender")),
    studentAge: numericValue(cell(row, indexes, "Student Age")),
    nationality: text(cell(row, indexes, "Nationality")),
    aadharCardNo: validAadhar(cell(row, indexes, "Aadhar Card No")),
    religion: text(cell(row, indexes, "Religion")),
    quota: text(cell(row, indexes, "Quota")),
    rollNo: text(cell(row, indexes, "Roll No.")),
    admissionType: text(cell(row, indexes, "Admission Type")),
    admittedInClass: text(cell(row, indexes, "Admitted In Class")),
    presentSchoolMedium: text(cell(row, indexes, "Present School Medium")),
    serial: cell(row, indexes, "Serial No."),
    grSr: text(cell(row, indexes, "G.R. No. / S.R. No.")),
    currentAddress: text(cell(row, indexes, "Current Address")),
    countryCode: text(cell(row, indexes, "Country Code")),
    city: normalizeCity(cell(row, indexes, "City /District")),
    country: text(cell(row, indexes, "Country")),
    parentsCode: text(cell(row, indexes, "Parents Code")),
    parentsId: text(cell(row, indexes, "Parents ID")),
    fatherContact: normalizePhone(cell(row, indexes, "Father Contact NO")),
    motherContact: normalizePhone(cell(row, indexes, "Mother Contact NO")),
    fatherOccupation: text(cell(row, indexes, "Father Occupation")),
    motherOccupation: text(cell(row, indexes, "Mother Occupation")),
    fatherName: text(cell(row, indexes, "Father Name")),
    motherName: text(cell(row, indexes, "Mother Name")),
    state: text(cell(row, indexes, "State")),
    bloodGroup: normalizeBloodGroup(cell(row, indexes, "Blood Broup")),
    deactiveReason: text(cell(row, indexes, "Deactive Reason")),
    deactiveDateTime: text(cell(row, indexes, "Deactive Date Time")),
    courseLevel: text(cell(row, indexes, "Course Level")),
    studentIdCard: text(cell(row, indexes, "Student ID Card")),
    transport: text(cell(row, indexes, "Transport")),
    previousCoachingCenterName: text(cell(row, indexes, "Previous Coaching Center Name")),
    siblingName: text(cell(row, indexes, "Sibling'S Name")),
    admissionSession: text(cell(row, indexes, "Admission Session")),
    attendanceFromMarkscardMaster: numericValue(cell(row, indexes, "Total Attendance(From Markscard Master)")),
    attendanceFromAttendanceModule: numericValue(cell(row, indexes, "Total Attendance(From Attendance Module)")),
    annualExamPercentage: numericValue(cell(row, indexes, "Annual Exam Percentage")),
    annualTotalMarks: numericValue(cell(row, indexes, "Total Marks ( Annual )")),
    annualObtainedMarks: numericValue(cell(row, indexes, "Total Obtained Marks ( Annual )")),
    excelClass: text(cell(row, indexes, "Class")),
    excelBatch: text(cell(row, indexes, "Batch")),
    raw: { birthRaw, admissionRaw },
  };
}

function addIndex(index, value, admission) {
  const normalized = key(value);
  if (!normalized) return;
  const list = index.get(normalized) || [];
  list.push(admission);
  index.set(normalized, list);
}

function buildIndexes(admissions) {
  const indexes = { excelStudentCode: new Map(), excelUserId: new Map(), studentId: new Map(), admissionId: new Map(), phoneNameDob: new Map(), phoneName: new Map() };
  for (const admission of admissions) {
    addIndex(indexes.excelStudentCode, admission.details?.excelStudentCode, admission);
    addIndex(indexes.excelUserId, admission.details?.excelUserId, admission);
    addIndex(indexes.studentId, admission.studentId, admission);
    addIndex(indexes.admissionId, admission.admissionId, admission);
    const phone = normalizePhone(admission.phone).value || normalizePhone(admission.details?.studentMobile).value || normalizePhone(admission.details?.contactNo).value;
    const name = normalizeName(admission.applicant || admission.details?.nameEnglish);
    const dob = dateKey(admission.details?.dateOfBirth);
    if (phone && name && dob) addIndex(indexes.phoneNameDob, `${phone}|${name}|${dob}`, admission);
    if (phone && name) addIndex(indexes.phoneName, `${phone}|${name}`, admission);
  }
  return indexes;
}

export function findMatch(row, indexes) {
  const priorities = [
    ["details.excelStudentCode", row.studentCode, indexes.excelStudentCode],
    ["details.excelUserId", row.userId, indexes.excelUserId],
    ["studentId", row.studentId, indexes.studentId],
    ["admissionId", row.admissionId, indexes.admissionId],
    ["phone+name+DOB", row.phone && row.nameKey && row.birthDateKey ? `${row.phone}|${row.nameKey}|${row.birthDateKey}` : "", indexes.phoneNameDob],
    ["name+phone", row.phone && row.nameKey ? `${row.phone}|${row.nameKey}` : "", indexes.phoneName],
  ];
  for (const [method, value, index] of priorities) {
    if (!value) continue;
    const candidates = index.get(key(value)) || [];
    if (candidates.length) return { method, candidates };
  }
  return { method: "", candidates: [] };
}

function sameValue(existing, incoming, field) {
  if (field.includes("phone")) return normalizePhone(existing).value === incoming;
  if (field.includes("email")) return normalizeEmail(existing) === incoming;
  if (field.includes("date")) return dateKey(existing) === dateKey(incoming);
  return key(existing) === key(incoming);
}

function addField(set, skipped, conflicts, admission, field, value, options = {}) {
  if (!hasMeaningfulValue(value)) return;
  const existing = field.split(".").reduce((current, part) => current?.[part], admission);
  if (!hasMeaningfulValue(existing)) {
    set[field] = value;
    return;
  }
  if (sameValue(existing, value, field)) {
    skipped.push(field);
    return;
  }
  conflicts.push({ field, existingValue: existing, excelValue: value, reason: "Existing meaningful value differs" });
  if (options.allowConflictUpdate) set[field] = value;
}

function buildPlan(row, admission, fileName, importedAt) {
  const set = {};
  const skippedFields = [];
  const conflicts = [];
  const invalidData = [];
  const details = admission.details || {};

  if (row.raw.admissionRaw && !row.admissionDate) invalidData.push({ field: "admissionDate", value: text(row.raw.admissionRaw), reason: "Invalid date" });
  if (row.raw.birthRaw && !row.birthDate) invalidData.push({ field: "details.dateOfBirth", value: text(row.raw.birthRaw), reason: "Invalid date" });
  if (row.emailRaw && !row.email) invalidData.push({ field: "email", value: row.emailRaw, reason: "Invalid email" });
  for (const item of [["Contact No", row.contact], ["Mobile Number", row.mobile], ["Father Contact NO", row.fatherContact], ["Mother Contact NO", row.motherContact]]) {
    if (item[1]?.original && !item[1].valid) invalidData.push({ field: item[0], value: item[1].original, reason: "Invalid phone" });
  }

  addField(set, skippedFields, conflicts, admission, "applicant", row.fullName);
  addField(set, skippedFields, conflicts, admission, "details.nameEnglish", row.fullName);
  addField(set, skippedFields, conflicts, admission, "details.fatherName", row.fatherName);
  addField(set, skippedFields, conflicts, admission, "details.motherName", row.motherName);
  if (row.birthDate) addField(set, skippedFields, conflicts, admission, "details.dateOfBirth", row.birthDateKey);
  if (["Male", "Female", "Other"].includes(row.gender)) addField(set, skippedFields, conflicts, admission, "details.gender", row.gender);
  if (row.admissionDate) addField(set, skippedFields, conflicts, admission, "admissionDate", row.admissionDate);
  if (row.grSr && !row.grSr.includes("@")) addField(set, skippedFields, conflicts, admission, "details.grSr", row.grSr);
  addField(set, skippedFields, conflicts, admission, "details.rollNo", row.rollNo);
  if (row.phone) addField(set, skippedFields, conflicts, admission, "phone", row.phone);
  if (row.phone) addField(set, skippedFields, conflicts, admission, "details.contactNo", row.phone);
  if (row.mobile.value) addField(set, skippedFields, conflicts, admission, "details.studentMobile", row.mobile.value);
  addField(set, skippedFields, conflicts, admission, "details.countryCode", row.countryCode);
  if (row.email) { addField(set, skippedFields, conflicts, admission, "email", row.email); addField(set, skippedFields, conflicts, admission, "details.email", row.email); }
  addField(set, skippedFields, conflicts, admission, "details.permanentAddress", row.currentAddress);
  addField(set, skippedFields, conflicts, admission, "details.homeAddress", row.currentAddress);
  addField(set, skippedFields, conflicts, admission, "details.district", row.city);
  addField(set, skippedFields, conflicts, admission, "city", row.city);
  addField(set, skippedFields, conflicts, admission, "details.country", row.country);
  addField(set, skippedFields, conflicts, admission, "details.state", row.state);
  addField(set, skippedFields, conflicts, admission, "details.studentAge", row.studentAge);
  addField(set, skippedFields, conflicts, admission, "details.nationality", row.nationality);
  addField(set, skippedFields, conflicts, admission, "details.aadharCardNo", row.aadharCardNo);
  addField(set, skippedFields, conflicts, admission, "details.religion", row.religion);
  addField(set, skippedFields, conflicts, admission, "details.quota", row.quota);
  addField(set, skippedFields, conflicts, admission, "details.admissionType", row.admissionType);
  addField(set, skippedFields, conflicts, admission, "details.admittedInClass", row.admittedInClass);
  addField(set, skippedFields, conflicts, admission, "details.presentSchoolMedium", row.presentSchoolMedium);
  if (row.fatherContact.value) addField(set, skippedFields, conflicts, admission, "details.fatherContact", row.fatherContact.value);
  if (row.motherContact.value) addField(set, skippedFields, conflicts, admission, "details.motherContact", row.motherContact.value);
  addField(set, skippedFields, conflicts, admission, "details.fatherOccupation", row.fatherOccupation);
  addField(set, skippedFields, conflicts, admission, "details.motherOccupation", row.motherOccupation);
  addField(set, skippedFields, conflicts, admission, "details.bloodGroup", row.bloodGroup);
  addField(set, skippedFields, conflicts, admission, "details.deactiveReason", row.deactiveReason);
  addField(set, skippedFields, conflicts, admission, "details.courseLevel", row.courseLevel);
  addField(set, skippedFields, conflicts, admission, "details.studentIdCard", row.studentIdCard);
  addField(set, skippedFields, conflicts, admission, "details.transport", row.transport);
  addField(set, skippedFields, conflicts, admission, "details.previousCoachingCenterName", row.previousCoachingCenterName);
  addField(set, skippedFields, conflicts, admission, "details.siblingName", row.siblingName);
  addField(set, skippedFields, conflicts, admission, "details.admissionSession", row.admissionSession);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.attendanceFromMarkscardMaster", row.attendanceFromMarkscardMaster);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.attendanceFromAttendanceModule", row.attendanceFromAttendanceModule);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.annualExamPercentage", row.annualExamPercentage);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.annualTotalMarks", row.annualTotalMarks);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.annualObtainedMarks", row.annualObtainedMarks);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.serial", row.serial);
  addField(set, skippedFields, conflicts, admission, "details.excelStudentCode", row.studentCode);
  addField(set, skippedFields, conflicts, admission, "details.excelUserId", row.userId);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.parentsCode", row.parentsCode);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.parentsId", row.parentsId);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.excelClass", row.excelClass);
  addField(set, skippedFields, conflicts, admission, "details.importMeta.excelBatch", row.excelBatch);

  set["details.importSource"] = fileName;
  set["details.importedAt"] = importedAt;
  set["details.importMeta.lastImportSource"] = fileName;
  set["details.importMeta.lastImportRow"] = row.excelRowNumber;
  return { set, skippedFields, conflicts, invalidData };
}

export async function planAdmissionEnrichment(buffer, fileName) {
  const workbook = readRows(buffer);
  const admissions = await Admission.find().select("_id admissionId applicant email phone studentId details admissionDate city").lean().maxTimeMS(15000);
  const indexes = buildIndexes(admissions);
  const importedAt = new Date();
  const rows = workbook.rows.map((raw, index) => rowData(raw, workbook.indexes, index + 2));
  const plans = rows.map((row) => {
    const match = findMatch(row, indexes);
    return { row, match };
  });
  const targetCounts = new Map();
  for (const plan of plans) {
    if (plan.match.candidates.length === 1) {
      const id = String(plan.match.candidates[0]._id);
      targetCounts.set(id, (targetCounts.get(id) || 0) + 1);
    }
  }
  const report = { success: true, dryRun: true, fileName, sheetName: workbook.sheetName, sheets: workbook.sheets, headers: workbook.headers, totalRows: rows.length, matchedRows: [], unmatchedRows: [], ambiguousMatches: [], duplicateExcelRows: [], duplicateExcelTargets: [], invalidDataRows: [], conflicts: [], unmappedPhotos: [], photoReport: { totalEmbeddedImages: 0, successfullyMappedImages: 0, successfullyImportedImages: 0, unmappedImages: 0, skippedImages: 0, imageMappingDetails: [] }, summary: { totalRows: rows.length, matched: 0, eligibleForUpdate: 0, unchanged: 0, updated: 0, unmatched: 0, ambiguous: 0, duplicates: 0, conflicts: 0, invalidRows: 0 } };
  const operations = [];
  for (const plan of plans) {
    const { row, match } = plan;
    if (!match.candidates.length) { report.unmatchedRows.push({ excelRowNumber: row.excelRowNumber, studentCode: row.studentCode, fullName: row.fullName, reason: "No existing admission matched" }); continue; }
    if (match.candidates.length > 1) { report.ambiguousMatches.push({ excelRowNumber: row.excelRowNumber, studentCode: row.studentCode, fullName: row.fullName, candidates: match.candidates.map((a) => ({ admissionMongoId: String(a._id), admissionId: a.admissionId, studentId: a.studentId })), reason: "Multiple admissions matched" }); continue; }
    const admission = match.candidates[0];
    const identity = { excelRowNumber: row.excelRowNumber, admissionMongoId: String(admission._id), admissionId: admission.admissionId, studentId: admission.studentId, matchMethod: match.method };
    if ((targetCounts.get(String(admission._id)) || 0) > 1) { const duplicate = { ...identity, reason: "Multiple Excel rows target the same admission" }; report.duplicateExcelRows.push(duplicate); report.duplicateExcelTargets.push(duplicate); continue; }
    const planResult = buildPlan(row, admission, fileName, importedAt);
    report.summary.matched += 1;
    report.summary.conflicts += planResult.conflicts.length;
    report.summary.invalidRows += planResult.invalidData.length ? 1 : 0;
    report.conflicts.push(...planResult.conflicts.map((conflict) => ({ ...identity, ...conflict })));
    report.invalidDataRows.push(...planResult.invalidData.map((invalid) => ({ ...identity, ...invalid })));
    const fieldsToUpdate = Object.keys(planResult.set);
    const matched = { ...identity, fieldsToUpdate, skippedFields: planResult.skippedFields };
    report.matchedRows.push(matched);
    if (fieldsToUpdate.length) { report.summary.eligibleForUpdate += 1; operations.push({ updateOne: { filter: { _id: admission._id }, update: { $set: planResult.set } } }); } else report.summary.unchanged += 1;
  }
  const photoAnchors = readPhotoAnchors(workbook.workbook);
  report.photoReport.totalEmbeddedImages = photoAnchors.totalEmbeddedImages;
  const safeRows = new Map(report.matchedRows.filter((item) => item.fieldsToUpdate).map((item) => [item.excelRowNumber, item]));
  const photos = [];
  for (const photo of photoAnchors.items) {
    const target = safeRows.get(photo.excelRowNumber);
    const mapping = { ...photo, matchedStudentCode: target?.studentCode || "", matchedAdmissionMongoId: target?.admissionMongoId || "" };
    if (!target) { report.unmappedPhotos.push({ ...mapping, reason: "No uniquely matched admission row" }); continue; }
    report.photoReport.successfullyMappedImages += 1;
    report.photoReport.imageMappingDetails.push(mapping);
    photos.push({ photo, admissionMongoId: target.admissionMongoId });
  }
  report.photoReport.unmappedImages = report.unmappedPhotos.length;
  report.photoReport.skippedImages = report.unmappedPhotos.length;
  report.summary.unmatched = report.unmatchedRows.length;
  report.summary.ambiguous = report.ambiguousMatches.length;
  report.summary.duplicates = report.duplicateExcelRows.length;
  report.summary.updated = report.summary.eligibleForUpdate;
  return { report, operations, photos, workbook: workbook.workbook };
}

export async function executeAdmissionEnrichment(buffer, fileName, dryRun = true) {
  const planned = await planAdmissionEnrichment(buffer, fileName);
  planned.report.dryRun = dryRun;
  if (!dryRun && planned.operations.length) {
    const result = await Admission.bulkWrite(planned.operations, { ordered: false });
    planned.report.mongoResult = { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, acknowledged: result.acknowledged };
  }
  if (!dryRun && planned.photos.length) {
    const photoOperations = [];
    for (const { photo, admissionMongoId } of planned.photos) {
      try {
        const url = photoDataUrl(planned.workbook, photo);
        if (!url) throw new Error("Embedded media bytes unavailable");
        photoOperations.push({ updateOne: { filter: { _id: admissionMongoId }, update: { $set: { "details.photoPreview": url, "details.importMeta.photoImportSource": fileName, "details.importMeta.photoImportedAt": new Date() } } } });
        planned.report.photoReport.successfullyImportedImages += 1;
        const detail = report.photoReport.imageMappingDetails.find((item) => item.imageFile === photo.imageFile && item.excelRowNumber === photo.excelRowNumber);
        if (detail) detail.importedUrl = url;
      } catch (error) {
        planned.report.photoReport.skippedImages += 1;
        planned.report.unmappedPhotos.push({ ...photo, reason: error.message });
      }
    }
    if (photoOperations.length) {
      const result = await Admission.bulkWrite(photoOperations, { ordered: false });
      planned.report.photoMongoResult = { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, acknowledged: result.acknowledged };
    }
  }
  return planned.report;
}

export const admissionEnrichmentTestables = {
  normalizeName,
  normalizeEmail,
  normalizePhone,
  parseDate,
  buildIndexes,
  buildPlan,
};
