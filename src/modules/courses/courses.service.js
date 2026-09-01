import mongoose from "mongoose";
import { Course } from "./courses.model.js";
import { University } from "../universities/universities.model.js";

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

function emptyEligibilityDetails() {
  return {
    qualification: "",
    minimumPercentage: "",
    stream: "",
    ageLimit: "",
    other: "",
  };
}

function normalizeSubjectRow(sub = {}) {
  return {
    name: sub.name || "",
    code: sub.code || "",
    subjectType: sub.subjectType || "Theory",
    theoryHours: sub.theoryHours || 0,
    practicalHours: sub.practicalHours || 0,
    credits: sub.credits || 0,
    maxMarks: sub.maxMarks || 0,
    passingMarks: sub.passingMarks || 0,
    theoryMarks: sub.theoryMarks || 0,
    practicalMarks: sub.practicalMarks || 0,
    internalMarks: sub.internalMarks || 0,
    externalMarks: sub.externalMarks || 0,
  };
}

function buildUniversityLabel(d) {
  if (d.type === "Institute") {
    const shortName = String(d.universityShortName || "TNS").trim() || "TNS";
    const name =
      String(d.universityName || "Thakur Niranjan Singh I.T.I. & Computer").trim() ||
      "Thakur Niranjan Singh I.T.I. & Computer";
    return `${shortName} — ${name}`;
  }
  const shortName = String(d.universityShortName || "").trim();
  const name = String(d.universityName || "").trim();
  if (shortName && name) return `${shortName} — ${name}`;
  return shortName || name || "—";
}

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const semesters = (Array.isArray(d.semesters) ? d.semesters : []).map((sem) => ({
    ...sem,
    subjects: (Array.isArray(sem.subjects) ? sem.subjects : []).map(normalizeSubjectRow),
  }));
  const subjectCount = semesters.reduce(
    (sum, sem) => sum + (Array.isArray(sem.subjects) ? sem.subjects.length : 0),
    0
  );
  const fees = d.fees && typeof d.fees === "object" ? d.fees : {};
  return {
    ...d,
    _id: String(d._id),
    id: String(d._id),
    universityId: d.universityId ? String(d.universityId) : null,
    type: d.type || "University",
    structureType: d.structureType || "Semester",
    eligibilityDetails: {
      ...emptyEligibilityDetails(),
      ...(d.eligibilityDetails && typeof d.eligibilityDetails === "object"
        ? d.eligibilityDetails
        : {}),
    },
    semesters,
    semesterCount: d.semesterCount || semesters.length || 0,
    subjectCount,
    durationDisplay: d.durationLabel || (d.durationMonths ? `${d.durationMonths} months` : "—"),
    universityLabel: buildUniversityLabel(d),
    fees: {
      total: fees.total || "",
      registration: fees.registration || "",
      exam: fees.exam || "",
      tuition: fees.tuition || "",
      installmentAllowed:
        typeof fees.installmentAllowed === "boolean" ? fees.installmentAllowed : true,
      installments: Array.isArray(fees.installments) ? fees.installments : [],
      semesterFees: Array.isArray(fees.semesterFees) ? fees.semesterFees : [],
    },
  };
}

function buildStats(rows) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "Active").length,
    inactive: rows.filter((row) => row.status === "Inactive").length,
    draft: rows.filter((row) => row.status === "Draft").length,
    university: rows.filter((row) => row.type === "University").length,
    iti: rows.filter((row) => row.type === "ITI / SCVT").length,
    institute: rows.filter((row) => row.type === "Institute").length,
    semesters: rows.reduce((sum, row) => sum + (row.semesterCount || 0), 0),
  };
}

async function assertUniqueCourseCode(code, excludeId) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return;
  const query = { code: normalized, softDelete: false };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Course.findOne(query).select("_id").lean().maxTimeMS(5000);
  if (existing) {
    throw httpError("Course code already exists", 409);
  }
}

async function attachUniversityMeta(payload, { existing = null } = {}) {
  if (payload.type === "Institute") {
    return {
      ...payload,
      universityId: null,
      universityName: "Thakur Niranjan Singh I.T.I. & Computer",
      universityShortName: "TNS",
    };
  }

  if (!payload.universityId) {
    return {
      ...payload,
      universityId: null,
      universityName: "",
      universityShortName: "",
    };
  }

  if (!mongoose.Types.ObjectId.isValid(payload.universityId)) {
    throw httpError("Invalid university id");
  }

  const uni = await University.findOne({
    _id: payload.universityId,
    softDelete: false,
  })
    .select("name shortName universityType status")
    .maxTimeMS(5000)
    .lean();

  if (!uni) {
    throw httpError("University not found");
  }

  const sameAsExisting =
    existing?.universityId && String(existing.universityId) === String(uni._id);

  if (uni.status !== "Active" && !sameAsExisting) {
    throw httpError("Cannot link a course to an inactive university");
  }

  if (payload.type === "ITI / SCVT" && uni.universityType !== "ITI / SCVT") {
    throw httpError("Select an ITI / SCVT authority for this course");
  }

  if (payload.type === "University" && uni.universityType === "ITI / SCVT") {
    throw httpError("Select a university, not an ITI / SCVT authority");
  }

  return {
    ...payload,
    universityId: uni._id,
    universityName: uni.name,
    universityShortName: uni.shortName,
  };
}

export async function listCourses({
  search = "",
  status = "",
  type = "",
  universityId = "",
} = {}) {
  const query = { softDelete: false };

  if (status) query.status = status;
  if (type) query.type = type;

  if (universityId && mongoose.Types.ObjectId.isValid(universityId)) {
    const uni = await University.findOne({
      _id: universityId,
      softDelete: false,
    })
      .select("shortName name")
      .lean()
      .maxTimeMS(5000);

    const isInstituteAuthority =
      /^(GST|TNS)$/i.test(String(uni?.shortName || "")) ||
      /grow\s*skills/i.test(String(uni?.name || "")) ||
      /thakur\s*niranjan/i.test(String(uni?.name || ""));

    if (isInstituteAuthority) {
      query.$or = [
        { universityId },
        { type: "Institute" },
        { universityShortName: { $in: ["GST", "TNS"] } },
        { universityId: null },
      ];
    } else {
      query.universityId = universityId;
    }
  }

  if (search) {
    const searchOr = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
      { universityName: { $regex: search, $options: "i" } },
      { universityShortName: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
      { type: { $regex: search, $options: "i" } },
      { structureType: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }

  const docs = await Course.find(query).sort({ name: 1 }).lean().maxTimeMS(8000);
  const rows = docs.map(toRow);
  return { rows, stats: buildStats(rows) };
}

export async function getCourseById(id) {
  const doc = await Course.findOne({ _id: id, softDelete: false }).lean();
  return doc ? toRow(doc) : null;
}

export async function createCourse(payload) {
  await assertUniqueCourseCode(payload.code);
  const withMeta = await attachUniversityMeta(payload);
  const created = await Course.create(withMeta);
  return toRow(created);
}

export async function updateCourse(id, payload) {
  const existing = await Course.findOne({ _id: id, softDelete: false })
    .maxTimeMS(5000)
    .lean();
  if (!existing) return null;

  await assertUniqueCourseCode(payload.code, id);
  const withMeta = await attachUniversityMeta(payload, { existing });
  const updated = await Course.findOneAndUpdate(
    { _id: id, softDelete: false },
    withMeta,
    { returnDocument: "after", maxTimeMS: 5000, runValidators: true }
  );

  return updated ? toRow(updated) : null;
}

export async function deactivateCourse(id, updatedBy) {
  const existing = await Course.findOne({ _id: id, softDelete: false })
    .maxTimeMS(5000)
    .lean();
  if (!existing) return null;

  const updated = await Course.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Inactive", updatedBy },
    { returnDocument: "after", maxTimeMS: 5000 }
  );

  return updated ? toRow(updated) : null;
}

export async function activateCourse(id, updatedBy) {
  const existing = await Course.findOne({ _id: id, softDelete: false })
    .maxTimeMS(5000)
    .lean();
  if (!existing) return null;

  const updated = await Course.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Active", updatedBy },
    { returnDocument: "after", maxTimeMS: 5000 }
  );

  return updated ? toRow(updated) : null;
}
