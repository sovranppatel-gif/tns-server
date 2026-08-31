import { FacultyAssignment } from "./facultyAssignment.model.js";
import { FacultyTimetable } from "./facultyTimetable.model.js";
import { Faculty } from "./faculty.model.js";
import { findFacultyDoc, loadBatch, loadCourse, loadUniversity } from "./faculty.service.js";
import { asObjectId, httpError, timeToMinutes, timesOverlap } from "./faculty.validation.js";

const QUERY_MS = 8000;

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
    assignmentId: d.assignmentId ? String(d.assignmentId) : "",
    semester: d.semester || null,
    subjectName: d.subjectName || "",
    subjectCode: d.subjectCode || "",
    day: d.day,
    startTime: d.startTime,
    endTime: d.endTime,
    room: d.room || "",
    universityName: d.universityName || "",
    courseName: d.courseName || "",
    batchName: d.batchName || "",
    status: d.status || "Active",
  };
}

async function assertNoConflict(payload, facultyMongoId, excludeId) {
  const start = timeToMinutes(payload.startTime);
  const end = timeToMinutes(payload.endTime);
  const query = {
    day: payload.day,
    status: "Active",
    softDelete: false,
  };
  if (excludeId) query._id = { $ne: excludeId };

  const rows = await FacultyTimetable.find(query).lean().maxTimeMS(QUERY_MS);
  for (const row of rows) {
    const rowStart = timeToMinutes(row.startTime);
    const rowEnd = timeToMinutes(row.endTime);
    if (rowStart == null || rowEnd == null || !timesOverlap(start, end, rowStart, rowEnd)) continue;
    if (String(row.facultyMongoId) === String(facultyMongoId)) {
      throw httpError("Faculty already has a class in this time slot", 409);
    }
    if (payload.batchId && String(row.batchId) === String(payload.batchId)) {
      throw httpError("This batch already has a class in this time slot", 409);
    }
    const room = String(payload.room || "").trim().toLowerCase();
    if (room && String(row.room || "").trim().toLowerCase() === room) {
      throw httpError("This room is already booked in this time slot", 409);
    }
  }
}

export async function listFacultyTimetable(facultyRef) {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const rows = await FacultyTimetable.find({
    facultyMongoId: faculty._id,
    softDelete: false,
  })
    .sort({ day: 1, startTime: 1 })
    .lean()
    .maxTimeMS(QUERY_MS);
  return { facultyId: faculty.facultyId, rows: rows.map(toRow) };
}

export async function listTimetable(params = {}) {
  const query = { softDelete: false };
  if (params.day) query.day = params.day;
  if (params.status) query.status = params.status;
  const faculty = params.facultyId ? await findFacultyDoc(params.facultyId) : null;
  if (params.facultyId && !faculty) throw httpError("Faculty not found", 404);
  if (faculty) query.facultyMongoId = faculty._id;
  const batchOid = asObjectId(params.batchId);
  const courseOid = asObjectId(params.courseId);
  if (batchOid) query.batchId = batchOid;
  if (courseOid) query.courseId = courseOid;

  const rows = await FacultyTimetable.find(query)
    .sort({ day: 1, startTime: 1 })
    .lean()
    .maxTimeMS(QUERY_MS);

  const facultyIds = [...new Set(rows.map((r) => String(r.facultyMongoId)))];
  const faculties = await Faculty.find({ _id: { $in: facultyIds } })
    .select("facultyId personalDetails.fullName")
    .lean()
    .maxTimeMS(QUERY_MS);
  const map = new Map(faculties.map((f) => [String(f._id), f]));

  return {
    rows: rows.map((row) => {
      const fac = map.get(String(row.facultyMongoId));
      return {
        ...toRow(row),
        facultyName: fac?.personalDetails?.fullName || "",
        facultyId: fac?.facultyId || row.facultyCode,
      };
    }),
  };
}

export async function createTimetableEntry(facultyRef, payload, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const [uni, course, batch] = await Promise.all([
    loadUniversity(payload.universityId),
    loadCourse(payload.courseId),
    loadBatch(payload.batchId),
  ]);
  if (!course) throw httpError("Course not found", 404);
  if (!batch) throw httpError("Batch not found", 404);

  await assertNoConflict(payload, faculty._id);

  const created = await FacultyTimetable.create({
    facultyMongoId: faculty._id,
    facultyCode: faculty.facultyId,
    universityId: payload.universityId || course.universityId || null,
    courseId: payload.courseId,
    batchId: payload.batchId,
    assignmentId: payload.assignmentId,
    semester: payload.semester,
    subjectName: payload.subjectName,
    subjectCode: payload.subjectCode,
    day: payload.day,
    startTime: payload.startTime,
    endTime: payload.endTime,
    room: payload.room,
    universityName: uni ? (uni.shortName ? `${uni.shortName} — ${uni.name}` : uni.name) : course.universityName || "",
    courseName: course.name || "",
    batchName: batch.name || batch.batchId || "",
    status: payload.status || "Active",
    createdBy: editor,
    updatedBy: editor,
  });
  return toRow(created);
}

export async function updateTimetableEntry(facultyRef, entryId, payload, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const oid = asObjectId(entryId);
  if (!oid) throw httpError("Invalid timetable id", 400);
  const doc = await FacultyTimetable.findOne({
    _id: oid,
    facultyMongoId: faculty._id,
    softDelete: false,
  });
  if (!doc) throw httpError("Timetable entry not found", 404);

  const next = {
    universityId: payload.universityId ?? doc.universityId,
    courseId: payload.courseId ?? doc.courseId,
    batchId: payload.batchId ?? doc.batchId,
    assignmentId: payload.assignmentId ?? doc.assignmentId,
    semester: payload.semester !== undefined ? payload.semester : doc.semester,
    subjectName: payload.subjectName || doc.subjectName,
    subjectCode: payload.subjectCode ?? doc.subjectCode,
    day: payload.day || doc.day,
    startTime: payload.startTime || doc.startTime,
    endTime: payload.endTime || doc.endTime,
    room: payload.room ?? doc.room,
    status: payload.status || doc.status,
  };
  await assertNoConflict(next, faculty._id, doc._id);
  Object.assign(doc, next, { updatedBy: editor });
  await doc.save();
  return toRow(doc);
}

export async function deleteTimetableEntry(facultyRef, entryId, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const oid = asObjectId(entryId);
  if (!oid) throw httpError("Invalid timetable id", 400);
  const doc = await FacultyTimetable.findOneAndUpdate(
    { _id: oid, facultyMongoId: faculty._id, softDelete: false },
    { $set: { softDelete: true, status: "Inactive", updatedBy: editor } },
    { new: true }
  );
  if (!doc) throw httpError("Timetable entry not found", 404);
  return toRow(doc);
}

export async function listAssignmentOptions(facultyRef) {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const rows = await FacultyAssignment.find({
    facultyMongoId: faculty._id,
    softDelete: false,
    status: "Active",
  })
    .lean()
    .maxTimeMS(QUERY_MS);
  return rows;
}
