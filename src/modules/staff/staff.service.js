import mongoose from "mongoose";
import { emitSectionUpdate } from "../../lib/socket.js";
import {
  STAFF_EMPLOYMENT_TYPES,
  STAFF_ID_PREFIX,
  STAFF_SHIFTS,
  dutyDurationLabel,
} from "./staff.constants.js";
import { Staff } from "./staff.model.js";
import { activeLookupOptions } from "./staffLookups.service.js";
import { httpError } from "./staff.validation.js";

const QUERY_MS = 8000;

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toIsoDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatSalary(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function liveStaffQuery(extra = {}) {
  return {
    $and: [
      extra,
      { $or: [{ isArchived: { $ne: true } }, { isArchived: { $exists: false } }] },
      { $or: [{ softDelete: { $ne: true } }, { softDelete: { $exists: false } }] },
    ],
  };
}

function archivedStaffQuery(extra = {}) {
  const { $or: searchOr, ...rest } = extra;
  const parts = [rest, { $or: [{ isArchived: true }, { softDelete: true }] }];
  if (searchOr) parts.push({ $or: searchOr });
  return { $and: parts.filter((part) => Object.keys(part).length) };
}

async function nextStaffId() {
  const rows = await Staff.aggregate([
    { $match: { staffId: { $regex: `^${STAFF_ID_PREFIX}\\d+$` } } },
    {
      $project: {
        n: {
          $convert: {
            input: { $substrBytes: ["$staffId", STAFF_ID_PREFIX.length, 8] },
            to: "int",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]).option({ maxTimeMS: QUERY_MS });
  const seq = (Number(rows[0]?.n) || 0) + 1;
  return `${STAFF_ID_PREFIX}${String(seq).padStart(4, "0")}`;
}

export async function findStaffDoc(id, { includeArchived = true } = {}) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  const byId =
    mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw
      ? { _id: raw }
      : { staffId: raw.toUpperCase() };
  const query = includeArchived ? byId : liveStaffQuery(byId);
  return Staff.findOne(query).maxTimeMS(QUERY_MS);
}

function toListRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const personal = d.personalDetails || {};
  const employment = d.employmentDetails || {};
  const emergency = d.emergencyContact || {};
  const dutyHours = dutyDurationLabel(employment.dutyStart, employment.dutyEnd);
  return {
    _id: String(d._id),
    id: d.staffId || String(d._id),
    staffId: d.staffId,
    fullName: personal.fullName || "",
    profilePhoto: personal.profilePhoto || "",
    gender: personal.gender || "",
    mobile: personal.mobile || "",
    alternateMobile: personal.alternateMobile || "",
    email: personal.email || "",
    designation: employment.designation || "",
    department: employment.department || "",
    staffCategory: employment.staffCategory || "",
    shift: employment.shift || "",
    dutyStart: employment.dutyStart || "",
    dutyEnd: employment.dutyEnd || "",
    dutyLabel: [employment.dutyStart, employment.dutyEnd].filter(Boolean).join(" – ") || "—",
    dutyHours: dutyHours || "—",
    weeklyOff: employment.weeklyOff || "",
    reportingTo: employment.reportingTo || "",
    qualification: employment.qualification || "",
    experienceYears: Number(employment.experienceYears) || 0,
    employmentType: employment.employmentType || "",
    monthlySalary: Number(employment.monthlySalary) || 0,
    monthlySalaryLabel: formatSalary(employment.monthlySalary),
    joiningDate: toIsoDate(employment.joiningDate),
    joiningDateLabel: formatDateLabel(employment.joiningDate),
    emergencyName: emergency.name || "",
    emergencyPhone: emergency.phone || "",
    notes: d.notes || "",
    status: d.status || "Active",
    isArchived: Boolean(d.isArchived || d.softDelete),
    archivedAt: d.archivedAt || null,
    archivedBy: d.archivedBy || "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function toDetailRow(doc) {
  const base = toListRow(doc);
  const d = doc?.toObject ? doc.toObject() : doc;
  const personal = d.personalDetails || {};
  const employment = d.employmentDetails || {};
  const emergency = d.emergencyContact || {};
  return {
    ...base,
    personalDetails: {
      ...personal,
      dateOfBirth: toIsoDate(personal.dateOfBirth),
      dateOfBirthLabel: formatDateLabel(personal.dateOfBirth),
    },
    employmentDetails: {
      ...employment,
      staffId: d.staffId,
      joiningDate: toIsoDate(employment.joiningDate),
      joiningDateLabel: formatDateLabel(employment.joiningDate),
      monthlySalaryLabel: formatSalary(employment.monthlySalary),
      dutyHours: base.dutyHours,
    },
    emergencyContact: {
      name: emergency.name || "",
      relation: emergency.relation || "",
      phone: emergency.phone || "",
    },
  };
}

async function groupCount(field) {
  const rows = await Staff.aggregate([
    { $match: liveStaffQuery() },
    { $group: { _id: `$${field}`, value: { $sum: 1 } } },
    { $sort: { value: -1 } },
  ]).option({ maxTimeMS: QUERY_MS });
  return rows
    .filter((r) => r._id)
    .map((r) => ({ name: r._id, value: r.value }));
}

export async function getStaffStats() {
  const start = monthStart();
  const live = liveStaffQuery();
  const [
    total,
    active,
    onLeave,
    inactive,
    newThisMonth,
    fullTime,
    byDepartment,
    byEmploymentType,
    byShift,
  ] = await Promise.all([
    Staff.countDocuments(live).maxTimeMS(QUERY_MS),
    Staff.countDocuments(liveStaffQuery({ status: "Active" })).maxTimeMS(QUERY_MS),
    Staff.countDocuments(liveStaffQuery({ status: "On Leave" })).maxTimeMS(QUERY_MS),
    Staff.countDocuments(liveStaffQuery({ status: "Inactive" })).maxTimeMS(QUERY_MS),
    Staff.countDocuments(liveStaffQuery({ createdAt: { $gte: start } })).maxTimeMS(QUERY_MS),
    Staff.countDocuments(
      liveStaffQuery({ "employmentDetails.employmentType": "Full Time" })
    ).maxTimeMS(QUERY_MS),
    groupCount("employmentDetails.department"),
    groupCount("employmentDetails.employmentType"),
    groupCount("employmentDetails.shift"),
  ]);
  return {
    total,
    active,
    onLeave,
    inactive,
    newThisMonth,
    fullTime,
    departments: byDepartment.length,
    byDepartment,
    byEmploymentType:
      STAFF_EMPLOYMENT_TYPES.map((name) => ({
        name,
        value: byEmploymentType.find((r) => r.name === name)?.value || 0,
      })),
    byShift: STAFF_SHIFTS.filter((name) => name !== "Custom").map((name) => ({
      name,
      value: byShift.find((r) => r.name === name)?.value || 0,
    })).concat(byShift.filter((r) => !STAFF_SHIFTS.includes(r.name) || r.name === "Custom")),
  };
}

export async function getStaffMeta() {
  const options = await activeLookupOptions();
  return {
    ...options,
    employmentTypes: STAFF_EMPLOYMENT_TYPES,
    weeklyOffs: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Rotational",
    ],
    statuses: ["Active", "On Leave", "Inactive"],
    shifts: [...options.shifts, { _id: "custom", name: "Custom", startTime: "", endTime: "" }],
  };
}

export async function listStaff(params = {}) {
  const isExport =
    String(params.export || "").trim() === "1" ||
    String(params.export || "").toLowerCase() === "true";
  const archived =
    String(params.archived || "").trim() === "1" ||
    String(params.archived || "").toLowerCase() === "true";
  const page = Math.max(1, Number(params.page) || 1);
  const maxLimit = isExport ? 2000 : 50;
  const limit = Math.min(maxLimit, Math.max(1, Number(params.limit) || (isExport ? 2000 : 10)));

  const filters = {};
  const status = String(params.status || "").trim();
  const designation = String(params.designation || "").trim();
  const department = String(params.department || "").trim();
  const staffCategory = String(params.staffCategory || params.category || "").trim();
  const shift = String(params.shift || "").trim();
  const employmentType = String(params.employmentType || "").trim();

  if (status) filters.status = status;
  if (designation) filters["employmentDetails.designation"] = designation;
  if (department) filters["employmentDetails.department"] = department;
  if (staffCategory) filters["employmentDetails.staffCategory"] = staffCategory;
  if (shift) filters["employmentDetails.shift"] = shift;
  if (employmentType) filters["employmentDetails.employmentType"] = employmentType;

  const search = String(params.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filters.$or = [
      { staffId: rx },
      { "personalDetails.fullName": rx },
      { "personalDetails.mobile": rx },
      { "personalDetails.alternateMobile": rx },
      { "personalDetails.email": rx },
      { "employmentDetails.designation": rx },
      { "employmentDetails.department": rx },
      { "employmentDetails.reportingTo": rx },
    ];
  }

  const query = archived ? archivedStaffQuery(filters) : liveStaffQuery(filters);

  const [docs, total, stats] = await Promise.all([
    Staff.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .maxTimeMS(QUERY_MS),
    Staff.countDocuments(query).maxTimeMS(QUERY_MS),
    isExport || archived ? Promise.resolve(null) : getStaffStats(),
  ]);

  return {
    rows: docs.map(toListRow),
    stats: stats || {},
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
    },
  };
}

export async function getStaffById(id) {
  const doc = await findStaffDoc(id, { includeArchived: true });
  if (!doc) return null;
  return toDetailRow(doc);
}

async function assertUniqueEmail(email, excludeId) {
  const value = String(email || "").toLowerCase().trim();
  if (!value) return;
  const existing = await Staff.findOne(
    liveStaffQuery({
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      "personalDetails.email": value,
    })
  )
    .select("_id staffId")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (existing) throw httpError("A staff member with this email already exists", 409);
}

export async function createStaff(payload, editor = "master-admin") {
  await assertUniqueEmail(payload.personalDetails.email);

  const staffId = await nextStaffId();
  const doc = await Staff.create({
    staffId,
    personalDetails: payload.personalDetails,
    employmentDetails: payload.employmentDetails,
    emergencyContact: payload.emergencyContact || {},
    notes: payload.notes || "",
    status: payload.status || "Active",
    isArchived: false,
    softDelete: false,
    createdBy: editor,
    updatedBy: editor,
  });

  emitSectionUpdate({ section: "staff", action: "create", resourceId: String(doc._id) });
  return toDetailRow(doc);
}

export async function updateStaff(id, payload, editor = "master-admin") {
  const doc = await findStaffDoc(id, { includeArchived: true });
  if (!doc) throw httpError("Staff not found", 404);
  if (doc.isArchived || doc.softDelete) {
    throw httpError("Restore this staff record before editing", 400);
  }

  if (payload.personalDetails) {
    await assertUniqueEmail(payload.personalDetails.email, doc._id);
    doc.personalDetails = {
      ...(doc.personalDetails.toObject?.() || doc.personalDetails),
      ...payload.personalDetails,
    };
  }
  if (payload.employmentDetails) {
    doc.employmentDetails = {
      ...(doc.employmentDetails.toObject?.() || doc.employmentDetails),
      ...payload.employmentDetails,
    };
  }
  if (payload.emergencyContact) {
    doc.emergencyContact = {
      ...(doc.emergencyContact?.toObject?.() || doc.emergencyContact || {}),
      ...payload.emergencyContact,
    };
  }
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.status) doc.status = payload.status;
  doc.updatedBy = editor;
  await doc.save();

  emitSectionUpdate({ section: "staff", action: "update", resourceId: String(doc._id) });
  return toDetailRow(doc);
}

export async function updateStaffStatus(id, status, editor = "master-admin") {
  const doc = await findStaffDoc(id, { includeArchived: true });
  if (!doc) throw httpError("Staff not found", 404);
  if (doc.isArchived || doc.softDelete) {
    throw httpError("Restore this staff record before changing status", 400);
  }
  doc.status = status;
  doc.updatedBy = editor;
  await doc.save();
  emitSectionUpdate({ section: "staff", action: "status", resourceId: String(doc._id) });
  return toListRow(doc);
}

export async function archiveStaff(id, editor = "master-admin") {
  const doc = await findStaffDoc(id, { includeArchived: true });
  if (!doc) throw httpError("Staff not found", 404);
  doc.isArchived = true;
  doc.softDelete = true;
  doc.archivedAt = new Date();
  doc.archivedBy = editor;
  doc.updatedBy = editor;
  await doc.save();
  emitSectionUpdate({ section: "staff", action: "archive", resourceId: String(doc._id) });
  return toListRow(doc);
}

export async function restoreStaff(id, editor = "master-admin") {
  const doc = await findStaffDoc(id, { includeArchived: true });
  if (!doc) throw httpError("Staff not found", 404);
  doc.isArchived = false;
  doc.softDelete = false;
  doc.archivedAt = null;
  doc.archivedBy = "";
  doc.updatedBy = editor;
  await doc.save();
  emitSectionUpdate({ section: "staff", action: "restore", resourceId: String(doc._id) });
  return toListRow(doc);
}

export async function deleteStaff(id, editor = "master-admin") {
  return archiveStaff(id, editor);
}
