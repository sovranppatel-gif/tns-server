import { FacultyAssignment } from "./facultyAssignment.model.js";
import { Faculty } from "./faculty.model.js";
import { findFacultyDoc, loadBatch, loadCourse, loadUniversity } from "./faculty.service.js";
import { asObjectId, httpError } from "./faculty.validation.js";

const QUERY_MS = 8000;

function universityLabel(uni, course) {
  if (uni) {
    return uni.shortName ? `${uni.shortName} — ${uni.name}` : uni.name;
  }
  return course?.universityName || course?.universityShortName || "Institute";
}

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    _id: String(d._id),
    id: String(d._id),
    facultyMongoId: String(d.facultyMongoId),
    facultyCode: d.facultyCode || "",
    universityId: d.universityId ? String(d.universityId) : "",
    courseId: d.courseId ? String(d.courseId) : "",
    batchId: d.batchId ? String(d.batchId) : "",
    semester: d.semester || null,
    subjectName: d.subjectName || "",
    subjectCode: d.subjectCode || "",
    subjectKey: d.subjectKey || "",
    academicYear: d.academicYear || "",
    universityName: d.universityName || "",
    courseName: d.courseName || "",
    batchName: d.batchName || "",
    status: d.status || "Active",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function hydrateSnapshots(payload) {
  const [uni, course, batch] = await Promise.all([
    loadUniversity(payload.universityId),
    loadCourse(payload.courseId),
    loadBatch(payload.batchId),
  ]);
  if (!course) throw httpError("Course not found", 404);
  if (payload.batchId && !batch) throw httpError("Batch not found", 404);
  if (batch && String(batch.courseId) !== String(course._id)) {
    throw httpError("Selected batch does not belong to this course", 400);
  }
  return {
    universityName: universityLabel(uni, course),
    courseName: course.name || course.code || "",
    batchName: batch ? batch.name || batch.batchId : "",
    universityId: payload.universityId || course.universityId || null,
  };
}

function duplicateQuery(facultyMongoId, payload, excludeId) {
  const query = {
    facultyMongoId,
    courseId: payload.courseId,
    subjectKey: payload.subjectKey,
    softDelete: false,
  };
  if (payload.batchId) query.batchId = payload.batchId;
  else query.$or = [{ batchId: null }, { batchId: { $exists: false } }];
  if (payload.semester) query.semester = payload.semester;
  else query.$and = [...(query.$and || []), { $or: [{ semester: null }, { semester: { $exists: false } }] }];
  if (excludeId) query._id = { $ne: excludeId };
  return query;
}

export async function listAssignments(facultyRef) {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const rows = await FacultyAssignment.find({
    facultyMongoId: faculty._id,
    softDelete: false,
  })
    .sort({ createdAt: -1 })
    .lean()
    .maxTimeMS(QUERY_MS);
  return { facultyId: faculty.facultyId, rows: rows.map(toRow) };
}

export async function listAllAssignments(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));
  const query = { softDelete: false };
  const status = String(params.status || "").trim();
  if (status) query.status = status;
  const uniOid = asObjectId(params.universityId);
  const courseOid = asObjectId(params.courseId);
  if (uniOid) query.universityId = uniOid;
  if (courseOid) query.courseId = courseOid;
  const search = String(params.search || "").trim();
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { facultyCode: rx },
      { courseName: rx },
      { subjectName: rx },
      { batchName: rx },
      { universityName: rx },
    ];
  }

  const [rows, total] = await Promise.all([
    FacultyAssignment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .maxTimeMS(QUERY_MS),
    FacultyAssignment.countDocuments(query).maxTimeMS(QUERY_MS),
  ]);

  const facultyIds = [...new Set(rows.map((r) => String(r.facultyMongoId)))];
  const faculties = await Faculty.find({
    _id: { $in: facultyIds },
  })
    .select("facultyId personalDetails.fullName employmentDetails.designation")
    .lean()
    .maxTimeMS(QUERY_MS);
  const facultyMap = new Map(faculties.map((f) => [String(f._id), f]));

  return {
    rows: rows.map((row) => {
      const fac = facultyMap.get(String(row.facultyMongoId));
      return {
        ...toRow(row),
        facultyName: fac?.personalDetails?.fullName || "",
        designation: fac?.employmentDetails?.designation || "",
        facultyId: fac?.facultyId || row.facultyCode,
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
    },
  };
}

export async function createAssignment(facultyRef, payload, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const snap = await hydrateSnapshots(payload);
  const dup = await FacultyAssignment.findOne(
    duplicateQuery(faculty._id, payload)
  )
    .select("_id")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (dup) throw httpError("This assignment already exists for the faculty", 409);

  const created = await FacultyAssignment.create({
    facultyMongoId: faculty._id,
    facultyCode: faculty.facultyId,
    universityId: snap.universityId,
    courseId: payload.courseId,
    batchId: payload.batchId,
    semester: payload.semester,
    subjectName: payload.subjectName,
    subjectCode: payload.subjectCode,
    subjectKey: payload.subjectKey,
    academicYear: payload.academicYear,
    universityName: snap.universityName,
    courseName: snap.courseName,
    batchName: snap.batchName,
    status: payload.status || "Active",
    createdBy: editor,
    updatedBy: editor,
  });
  return toRow(created);
}

export async function updateAssignment(facultyRef, assignmentId, payload, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const oid = asObjectId(assignmentId);
  if (!oid) throw httpError("Invalid assignment id", 400);
  const doc = await FacultyAssignment.findOne({
    _id: oid,
    facultyMongoId: faculty._id,
    softDelete: false,
  });
  if (!doc) throw httpError("Assignment not found", 404);

  const next = {
    universityId: payload.universityId ?? doc.universityId,
    courseId: payload.courseId ?? doc.courseId,
    batchId: payload.batchId ?? doc.batchId,
    semester: payload.semester !== undefined ? payload.semester : doc.semester,
    subjectName: payload.subjectName || doc.subjectName,
    subjectCode: payload.subjectCode ?? doc.subjectCode,
    subjectKey: payload.subjectKey || doc.subjectKey,
    academicYear: payload.academicYear ?? doc.academicYear,
    status: payload.status || doc.status,
  };
  const snap = await hydrateSnapshots(next);
  const dup = await FacultyAssignment.findOne(duplicateQuery(faculty._id, next, doc._id))
    .select("_id")
    .lean()
    .maxTimeMS(QUERY_MS);
  if (dup) throw httpError("This assignment already exists for the faculty", 409);

  Object.assign(doc, next, snap, { updatedBy: editor });
  await doc.save();
  return toRow(doc);
}

export async function updateAssignmentStatus(facultyRef, assignmentId, status, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const oid = asObjectId(assignmentId);
  if (!oid) throw httpError("Invalid assignment id", 400);
  const doc = await FacultyAssignment.findOneAndUpdate(
    { _id: oid, facultyMongoId: faculty._id, softDelete: false },
    { $set: { status, updatedBy: editor } },
    { new: true }
  );
  if (!doc) throw httpError("Assignment not found", 404);
  return toRow(doc);
}

export async function deleteAssignment(facultyRef, assignmentId, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const oid = asObjectId(assignmentId);
  if (!oid) throw httpError("Invalid assignment id", 400);
  const doc = await FacultyAssignment.findOneAndUpdate(
    { _id: oid, facultyMongoId: faculty._id, softDelete: false },
    { $set: { softDelete: true, status: "Inactive", updatedBy: editor } },
    { new: true }
  );
  if (!doc) throw httpError("Assignment not found", 404);
  return toRow(doc);
}
