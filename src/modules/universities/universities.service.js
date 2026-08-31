import { University } from "./universities.model.js";

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    ...d,
    _id: String(d._id),
    id: String(d._id),
  };
}

function buildStats(rows) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "Active").length,
    inactive: rows.filter((row) => row.status === "Inactive").length,
    draft: rows.filter((row) => row.status === "Draft").length,
  };
}

export async function listUniversities({ search = "", status = "" } = {}) {
  const baseQuery = { softDelete: false };

  if (search) {
    baseQuery.$or = [
      { name: { $regex: search, $options: "i" } },
      { shortName: { $regex: search, $options: "i" } },
      { universityCode: { $regex: search, $options: "i" } },
      { registrationNumber: { $regex: search, $options: "i" } },
      { universityType: { $regex: search, $options: "i" } },
      { affiliationNumber: { $regex: search, $options: "i" } },
      { city: { $regex: search, $options: "i" } },
      { district: { $regex: search, $options: "i" } },
      { state: { $regex: search, $options: "i" } },
      { contactEmail: { $regex: search, $options: "i" } },
    ];
  }

  // Stats always include every non-deleted university (Active + Inactive + Draft)
  const listQuery = status ? { ...baseQuery, status } : baseQuery;
  const [allDocs, filteredDocs] = await Promise.all([
    // Lightweight projection for stats — avoid shipping full docs twice when status filtered
    status
      ? University.find(baseQuery).select("status").lean().maxTimeMS(5000)
      : Promise.resolve(null),
    University.find(listQuery)
      .select(
        "name shortName universityCode universityType establishedYear logo registrationNumber affiliationNumber affiliationAuthority recognitionDetails address city district state pincode contactPerson contactPhone contactEmail website status remarks createdAt updatedAt"
      )
      .sort({ name: 1 })
      .lean()
      .maxTimeMS(5000),
  ]);

  const rows = filteredDocs.map(toRow);
  const stats = buildStats(status ? (allDocs || []).map(toRow) : rows);
  return { rows, stats };
}

export async function getUniversityById(id) {
  const doc = await University.findOne({ _id: id, softDelete: false }).lean();
  return doc ? toRow(doc) : null;
}

async function assertUniqueUniversityCode(universityCode, excludeId) {
  if (!universityCode) return;
  const query = { universityCode, softDelete: false };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await University.findOne(query).select("_id").lean().maxTimeMS(5000);
  if (existing) {
    const err = new Error("University code already exists");
    err.statusCode = 409;
    throw err;
  }
}

export async function createUniversity(payload) {
  await assertUniqueUniversityCode(payload.universityCode);
  const created = await University.create(payload);
  return toRow(created);
}

export async function updateUniversity(id, payload) {
  await assertUniqueUniversityCode(payload.universityCode, id);
  const updated = await University.findOneAndUpdate(
    { _id: id, softDelete: false },
    payload,
    { new: true }
  );
  return updated ? toRow(updated) : null;
}

export async function deactivateUniversity(id, updatedBy) {
  return University.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Inactive", updatedBy },
    { new: true }
  ).then((doc) => (doc ? toRow(doc) : null));
}

export async function activateUniversity(id, updatedBy) {
  return University.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Active", updatedBy },
    { new: true }
  ).then((doc) => (doc ? toRow(doc) : null));
}
