import { FacultyAttendance } from "./facultyAttendance.model.js";
import { findFacultyDoc } from "./faculty.service.js";
import { dayStart, httpError } from "./faculty.validation.js";

const QUERY_MS = 8000;

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const date = d.date instanceof Date ? d.date : new Date(d.date);
  return {
    _id: String(d._id),
    id: String(d._id),
    facultyMongoId: String(d.facultyMongoId),
    facultyCode: d.facultyCode || "",
    date: date.toISOString(),
    dateLabel: date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    checkInTime: d.checkInTime || "",
    checkOutTime: d.checkOutTime || "",
    status: d.status || "Present",
    method: d.method || "Manual",
    note: d.note || "",
  };
}

function monthRange(value) {
  const d = value ? new Date(value) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

function buildStats(rows) {
  const counts = { Present: 0, Absent: 0, Late: 0, Leave: 0 };
  for (const row of rows) {
    if (counts[row.status] != null) counts[row.status] += 1;
  }
  const marked = rows.length;
  const presentLike = counts.Present + counts.Late;
  return {
    marked,
    present: counts.Present,
    absent: counts.Absent,
    late: counts.Late,
    leave: counts.Leave,
    percent: marked > 0 ? Math.round((presentLike / marked) * 1000) / 10 : 0,
  };
}

export async function listFacultyAttendance(facultyRef, params = {}) {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const { start, end } = monthRange(params.month || params.date);
  const rows = await FacultyAttendance.find({
    facultyMongoId: faculty._id,
    date: { $gte: start, $lt: end },
  })
    .sort({ date: -1 })
    .lean()
    .maxTimeMS(QUERY_MS);

  const today = dayStart();
  const todayRow = rows.find((r) => dayStart(r.date).getTime() === today.getTime()) || null;

  return {
    facultyId: faculty.facultyId,
    today: todayRow ? toRow(todayRow) : null,
    rows: rows.map(toRow),
    stats: buildStats(rows),
    month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
  };
}

export async function upsertFacultyAttendance(facultyRef, payload, editor = "master-admin") {
  const faculty = await findFacultyDoc(facultyRef);
  if (!faculty) throw httpError("Faculty not found", 404);
  const date = dayStart(payload.date);
  const doc = await FacultyAttendance.findOneAndUpdate(
    { facultyMongoId: faculty._id, date },
    {
      $set: {
        facultyCode: faculty.facultyId,
        checkInTime: payload.checkInTime,
        checkOutTime: payload.checkOutTime,
        status: payload.status,
        method: payload.method,
        note: payload.note,
        markedBy: editor,
      },
      $setOnInsert: {
        facultyMongoId: faculty._id,
        date,
      },
    },
    { new: true, upsert: true }
  );
  return toRow(doc);
}
