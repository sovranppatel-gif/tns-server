import {
  DEFAULT_STAFF_SHIFTS,
  STAFF_CATEGORIES,
  STAFF_DEPARTMENTS,
  STAFF_DESIGNATIONS,
  workingHoursValue,
} from "./staff.constants.js";
import {
  StaffCategory,
  StaffDepartment,
  StaffDesignation,
  StaffShift,
} from "./staffLookups.model.js";
import { Staff } from "./staff.model.js";
import { httpError } from "./staff.validation.js";

const QUERY_MS = 8000;

const LOOKUPS = {
  department: StaffDepartment,
  designation: StaffDesignation,
  category: StaffCategory,
  shift: StaffShift,
};

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toLookupRow(doc, extra = {}) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: String(d._id),
    name: d.name || "",
    description: d.description || "",
    status: d.status || "Active",
    isArchived: Boolean(d.isArchived),
    archivedAt: d.archivedAt || null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...extra,
  };
}

function staffCountMatch(field, name) {
  return {
    $or: [{ isArchived: { $ne: true } }, { isArchived: { $exists: false } }],
    softDelete: { $ne: true },
    [field]: name,
  };
}

export async function countStaffByField(field, names) {
  const unique = [...new Set((names || []).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await Staff.aggregate([
    {
      $match: {
        $or: [{ isArchived: { $ne: true } }, { isArchived: { $exists: false } }],
        softDelete: { $ne: true },
        [field]: { $in: unique },
      },
    },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]).option({ maxTimeMS: QUERY_MS });
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

export async function findLookup(kind, id) {
  const Model = LOOKUPS[kind];
  if (!Model) throw httpError("Unknown lookup type", 400);
  const raw = String(id || "").trim();
  if (!raw) return null;
  return Model.findById(raw).maxTimeMS(QUERY_MS);
}

export async function listLookups(kind, params = {}) {
  const Model = LOOKUPS[kind];
  if (!Model) throw httpError("Unknown lookup type", 400);
  await ensureDefaultLookups();
  const archived = String(params.archived || "") === "1" || params.archived === true;
  const query = archived ? { isArchived: true } : { isArchived: { $ne: true } };
  const status = String(params.status || "").trim();
  if (status) query.status = status;
  const search = String(params.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    query.$or = [{ name: rx }, { description: rx }, { code: rx }, { department: rx }];
  }
  const docs = await Model.find(query).sort({ name: 1 }).lean().maxTimeMS(QUERY_MS);
  const names = docs.map((d) => d.name);
  const field =
    kind === "department"
      ? "employmentDetails.department"
      : kind === "designation"
        ? "employmentDetails.designation"
        : kind === "category"
          ? "employmentDetails.staffCategory"
          : "employmentDetails.shift";
  const counts = await countStaffByField(field, names);
  return docs.map((d) => {
    const extra =
      kind === "department"
        ? { code: d.code || "" }
        : kind === "designation"
          ? { department: d.department || "" }
          : kind === "shift"
            ? {
                startTime: d.startTime || "",
                endTime: d.endTime || "",
                breakMinutes: Number(d.breakMinutes) || 0,
                workingHours: Number(d.workingHours) || 0,
                timingLabel:
                  d.startTime && d.endTime ? `${d.startTime} – ${d.endTime}` : "—",
              }
            : {};
    return {
      ...toLookupRow(d, extra),
      staffCount: counts[d.name] || 0,
    };
  });
}

export async function createLookup(kind, payload, editor = "master-admin") {
  const Model = LOOKUPS[kind];
  if (!Model) throw httpError("Unknown lookup type", 400);
  const nameRx = new RegExp(`^${escapeRegex(payload.name)}$`, "i");
  const existing = await Model.findOne({ name: nameRx, isArchived: { $ne: true } })
    .select("_id name")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (existing) throw httpError("A record with this name already exists", 409);

  const doc = {
    ...payload,
    createdBy: editor,
    updatedBy: editor,
    isArchived: false,
  };
  if (kind === "shift") {
    doc.workingHours = workingHoursValue(payload.startTime, payload.endTime, payload.breakMinutes);
  }
  const created = await Model.create(doc);
  return (await listLookups(kind)).find((row) => row._id === String(created._id));
}

export async function updateLookup(kind, id, payload, editor = "master-admin") {
  const doc = await findLookup(kind, id);
  if (!doc) throw httpError("Record not found", 404);
  if (payload.name && payload.name !== doc.name) {
    const Model = LOOKUPS[kind];
    const nameRx = new RegExp(`^${escapeRegex(payload.name)}$`, "i");
    const existing = await Model.findOne({
      _id: { $ne: doc._id },
      name: nameRx,
      isArchived: { $ne: true },
    })
      .select("_id")
      .lean()
      .maxTimeMS(QUERY_MS);
    if (existing) throw httpError("A record with this name already exists", 409);
  }
  Object.assign(doc, payload, { updatedBy: editor });
  if (kind === "shift") {
    doc.workingHours = workingHoursValue(doc.startTime, doc.endTime, doc.breakMinutes);
  }
  await doc.save();
  const rows = await listLookups(kind, { archived: doc.isArchived ? "1" : "" });
  return rows.find((row) => row._id === String(doc._id)) || toLookupRow(doc);
}

export async function setLookupStatus(kind, id, status, editor = "master-admin") {
  const doc = await findLookup(kind, id);
  if (!doc) throw httpError("Record not found", 404);
  doc.status = status === "Inactive" ? "Inactive" : "Active";
  doc.updatedBy = editor;
  await doc.save();
  return updateLookup(kind, id, {}, editor);
}

export async function archiveLookup(kind, id, editor = "master-admin") {
  const doc = await findLookup(kind, id);
  if (!doc) throw httpError("Record not found", 404);
  doc.isArchived = true;
  doc.archivedAt = new Date();
  doc.archivedBy = editor;
  doc.updatedBy = editor;
  await doc.save();
  return toLookupRow(doc);
}

export async function restoreLookup(kind, id, editor = "master-admin") {
  const doc = await findLookup(kind, id);
  if (!doc) throw httpError("Record not found", 404);
  const Model = LOOKUPS[kind];
  const nameRx = new RegExp(`^${escapeRegex(doc.name)}$`, "i");
  const clash = await Model.findOne({
    _id: { $ne: doc._id },
    name: nameRx,
    isArchived: { $ne: true },
  })
    .select("_id")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (clash) throw httpError("An active record with this name already exists", 409);
  doc.isArchived = false;
  doc.archivedAt = null;
  doc.archivedBy = "";
  doc.updatedBy = editor;
  await doc.save();
  return updateLookup(kind, id, {}, editor);
}

export async function ensureDefaultLookups() {
  const [deptCount, desigCount, catCount, shiftCount] = await Promise.all([
    StaffDepartment.countDocuments(),
    StaffDesignation.countDocuments(),
    StaffCategory.countDocuments(),
    StaffShift.countDocuments(),
  ]);

  if (!deptCount) {
    await StaffDepartment.insertMany(
      STAFF_DEPARTMENTS.map((name) => ({
        name,
        code: name.replace(/[^A-Za-z]/g, "").slice(0, 8).toUpperCase(),
        description: `${name} department`,
        status: "Active",
        createdBy: "seed",
        updatedBy: "seed",
      }))
    );
  }
  if (!desigCount) {
    await StaffDesignation.insertMany(
      STAFF_DESIGNATIONS.map((name) => ({
        name,
        department: "",
        description: name,
        status: "Active",
        createdBy: "seed",
        updatedBy: "seed",
      }))
    );
  }
  if (!catCount) {
    await StaffCategory.insertMany(
      STAFF_CATEGORIES.map((name) => ({
        name,
        description: name,
        status: "Active",
        createdBy: "seed",
        updatedBy: "seed",
      }))
    );
  }
  if (!shiftCount) {
    await StaffShift.insertMany(
      DEFAULT_STAFF_SHIFTS.map((row) => ({
        ...row,
        breakMinutes: row.breakMinutes || 0,
        workingHours: workingHoursValue(row.startTime, row.endTime, row.breakMinutes),
        status: "Active",
        createdBy: "seed",
        updatedBy: "seed",
      }))
    );
  }
}

export async function activeLookupOptions() {
  await ensureDefaultLookups();
  const [departments, designations, categories, shifts] = await Promise.all([
    StaffDepartment.find({ isArchived: { $ne: true }, status: "Active" }).sort({ name: 1 }).lean(),
    StaffDesignation.find({ isArchived: { $ne: true }, status: "Active" }).sort({ name: 1 }).lean(),
    StaffCategory.find({ isArchived: { $ne: true }, status: "Active" }).sort({ name: 1 }).lean(),
    StaffShift.find({ isArchived: { $ne: true }, status: "Active" }).sort({ name: 1 }).lean(),
  ]);
  return {
    departments: departments.map((d) => ({
      _id: String(d._id),
      name: d.name,
      code: d.code || "",
    })),
    designations: designations.map((d) => ({
      _id: String(d._id),
      name: d.name,
      department: d.department || "",
    })),
    categories: categories.map((d) => ({
      _id: String(d._id),
      name: d.name,
    })),
    shifts: shifts.map((d) => ({
      _id: String(d._id),
      name: d.name,
      startTime: d.startTime || "",
      endTime: d.endTime || "",
      breakMinutes: Number(d.breakMinutes) || 0,
      workingHours: Number(d.workingHours) || 0,
    })),
  };
}

export { staffCountMatch };
