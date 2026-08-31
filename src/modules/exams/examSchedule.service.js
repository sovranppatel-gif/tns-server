import { ExamSchedule } from "./examSchedule.model.js";
import { ExamAssignment } from "./examAssignment.model.js";
import { ExamPaper } from "./examPaper.model.js";
import { Student } from "../students/students.model.js";
import { University } from "../universities/universities.model.js";
import { Course } from "../courses/courses.model.js";
import { Batch } from "../batches/batches.model.js";
import { createStudentNotification } from "../../lib/studentNotifications.js";
import { User, USER_TYPES } from "../../models/User.js";
import { DEFAULT_EXAM_INSTRUCTIONS } from "./exams.constants.js";
import {
  asObjectId,
  deriveScheduleStatus,
  formatDateLabel,
  formatTimeLabel,
  httpError,
  idStr,
  studentEmailOf,
  toNumber,
} from "./exams.helpers.js";

function toRow(doc, extras = {}) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const status = deriveScheduleStatus(d);
  return {
    ...d,
    ...extras,
    _id: String(d._id),
    id: String(d._id),
    examPaperId: d.examPaperId ? String(d.examPaperId) : "",
    universityId: d.universityId ? String(d.universityId) : "",
    courseId: d.courseId ? String(d.courseId) : "",
    batchId: d.batchId ? String(d.batchId) : "",
    examTitle: extras.examTitle || d.examTitle || "",
    examCode: extras.examCode || d.examCode || "",
    universityName: extras.universityName || d.universityName || "",
    courseName: extras.courseName || d.courseName || "",
    batchName: extras.batchName || d.batchName || "",
    status,
    storedStatus: d.status,
    startLabel: formatDateLabel(d.startAt),
    startTimeLabel: formatTimeLabel(d.startAt),
    endLabel: formatDateLabel(d.endAt),
    endTimeLabel: formatTimeLabel(d.endAt),
    assignedCount: toNumber(d.assignedCount, extras.assignedCount || 0),
    resultsReleased: Boolean(d.resultsReleased),
  };
}

async function hydrate(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const [paper, uni, course, batch] = await Promise.all([
    d.examPaperId
      ? ExamPaper.findById(d.examPaperId).select("title code durationMinutes totalQuestions totalMarks passingPercentage negativeMarkingEnabled subject").lean()
      : null,
    d.universityId ? University.findById(d.universityId).select("name shortName").lean() : null,
    d.courseId ? Course.findById(d.courseId).select("name code").lean() : null,
    d.batchId ? Batch.findById(d.batchId).select("name batchId").lean() : null,
  ]);
  return toRow(d, {
    examTitle: paper?.title || "",
    examCode: paper?.code || "",
    universityName: uni ? (uni.shortName ? `${uni.shortName} — ${uni.name}` : uni.name) : "",
    courseName: course?.name || "",
    batchName: batch?.name || "",
    totalQuestions: paper?.totalQuestions,
    totalMarks: paper?.totalMarks,
    passingPercentage: paper?.passingPercentage,
    paperDuration: paper?.durationMinutes,
    negativeMarkingEnabled: paper?.negativeMarkingEnabled,
    subject: paper?.subject || "",
  });
}

export async function listSchedules({
  search = "",
  status = "",
  examPaperId = "",
  universityId = "",
  courseId = "",
  batchId = "",
} = {}) {
  const query = { softDelete: false };
  const paperOid = asObjectId(examPaperId);
  const uniOid = asObjectId(universityId);
  const courseOid = asObjectId(courseId);
  const batchOid = asObjectId(batchId);
  if (paperOid) query.examPaperId = paperOid;
  if (uniOid) query.universityId = uniOid;
  if (courseOid) query.courseId = courseOid;
  if (batchOid) query.batchId = batchOid;

  const docs = await ExamSchedule.find(query).sort({ startAt: -1 }).lean().maxTimeMS(8000);
  let rows = [];
  for (const doc of docs) {
    rows.push(await hydrate(doc));
  }
  if (status) {
    rows = rows.filter((row) => row.status === status);
  }
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((row) =>
      [row.examTitle, row.examCode, row.courseName, row.batchName]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  const stats = {
    total: rows.length,
    scheduled: rows.filter((r) => r.status === "Scheduled").length,
    live: rows.filter((r) => r.status === "Live").length,
    completed: rows.filter((r) => r.status === "Completed").length,
    cancelled: rows.filter((r) => r.status === "Cancelled").length,
  };
  return { rows, stats };
}

export async function getScheduleById(id) {
  const doc = await ExamSchedule.findOne({ _id: id, softDelete: false }).lean();
  if (!doc) return null;
  const row = await hydrate(doc);
  const assignments = await ExamAssignment.find({ examId: doc._id })
    .populate("studentId", "studentId admissionId nameEnglish contact courseName batchName")
    .lean()
    .maxTimeMS(8000);
  return {
    ...row,
    students: assignments.map((a) => ({
      assignmentId: String(a._id),
      studentId: idStr(a.studentId?._id || a.studentId),
      studentCode: a.studentId?.studentId || "",
      admissionId: a.studentId?.admissionId || "",
      name: a.studentId?.nameEnglish || "",
      email: a.studentId?.contact?.email || "",
      status: a.status,
      assignedAt: a.assignedAt,
    })),
  };
}

async function loadAssignableStudents({ universityId, courseId, batchId, studentIds }) {
  const query = { status: { $in: ["Active", "Completed"] } };
  if (asObjectId(universityId)) query.universityId = asObjectId(universityId);
  if (asObjectId(courseId)) query.courseId = asObjectId(courseId);
  if (asObjectId(batchId)) query.batchId = asObjectId(batchId);
  if (Array.isArray(studentIds) && studentIds.length) {
    query._id = { $in: studentIds.map((id) => asObjectId(id)).filter(Boolean) };
  }
  return Student.find(query)
    .select(
      "_id studentId admissionId nameEnglish contact courseId batchId universityId courseName batchName"
    )
    .lean()
    .maxTimeMS(8000);
}

export async function createSchedule(payload, editor) {
  const paper = await ExamPaper.findOne({
    _id: payload.examPaperId,
    softDelete: false,
  }).lean();
  if (!paper) throw httpError("Exam paper not found", 404);
  if (paper.status !== "Published") {
    throw httpError("Only published exam papers can be scheduled");
  }

  const students = await loadAssignableStudents(payload);
  if (!students.length) {
    throw httpError("No students found for the selected university / course / batch");
  }

  const created = await ExamSchedule.create({
    examPaperId: payload.examPaperId,
    universityId: payload.universityId,
    courseId: payload.courseId,
    batchId: payload.batchId,
    startAt: payload.startAt,
    endAt: payload.endAt,
    durationMinutes: payload.durationMinutes || paper.durationMinutes,
    attemptLimit: payload.attemptLimit || 1,
    instructions:
      payload.instructions?.length ? payload.instructions : paper.instructions || DEFAULT_EXAM_INSTRUCTIONS,
    resultVisibility: payload.resultVisibility,
    resultsReleased: payload.resultVisibility === "Immediately",
    status: "Scheduled",
    assignedCount: students.length,
    createdBy: editor,
    updatedBy: editor,
  });

  const assignmentDocs = students.map((student) => ({
    examId: created._id,
    examPaperId: paper._id,
    batchId: payload.batchId || student.batchId || null,
    studentId: student._id,
    assignedAt: new Date(),
    status: "Assigned",
  }));

  try {
    await ExamAssignment.insertMany(assignmentDocs, { ordered: false });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }

  const assignedCount = await ExamAssignment.countDocuments({ examId: created._id });
  created.assignedCount = assignedCount;
  await created.save();

  await notifyAssignedStudents({
    schedule: created,
    paper,
    students,
  });

  return getScheduleById(created._id);
}

export async function updateSchedule(id, payload, editor) {
  const existing = await ExamSchedule.findOne({ _id: id, softDelete: false }).lean();
  if (!existing) return null;
  if (existing.status === "Cancelled") {
    throw httpError("Cancelled exams cannot be updated");
  }
  const derived = deriveScheduleStatus(existing);
  if (derived === "Completed") {
    throw httpError("Completed exams cannot be updated");
  }

  const updated = await ExamSchedule.findOneAndUpdate(
    { _id: id, softDelete: false },
    {
      startAt: payload.startAt || existing.startAt,
      endAt: payload.endAt || existing.endAt,
      durationMinutes: payload.durationMinutes || existing.durationMinutes,
      attemptLimit: payload.attemptLimit || existing.attemptLimit,
      instructions: payload.instructions?.length
        ? payload.instructions
        : existing.instructions,
      resultVisibility: payload.resultVisibility || existing.resultVisibility,
      updatedBy: editor,
    },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  return updated ? getScheduleById(updated._id) : null;
}

export async function cancelSchedule(id, editor) {
  const updated = await ExamSchedule.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Cancelled", updatedBy: editor },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  if (!updated) return null;
  await ExamAssignment.updateMany(
    { examId: updated._id, status: { $in: ["Assigned", "Started"] } },
    { status: "Cancelled" }
  );
  return getScheduleById(updated._id);
}

export async function releaseResults(id, editor) {
  const updated = await ExamSchedule.findOneAndUpdate(
    { _id: id, softDelete: false },
    { resultsReleased: true, updatedBy: editor },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  return updated ? getScheduleById(updated._id) : null;
}

async function notifyAssignedStudents({ schedule, paper, students }) {
  const dateLabel = formatDateLabel(schedule.startAt);
  const timeLabel = formatTimeLabel(schedule.startAt);
  const title = paper.title || "Online Exam Scheduled";
  await Promise.all(
    students.map(async (student) => {
      let email = studentEmailOf(student);
      if (!email) {
        const user = await User.findOne({
          type: USER_TYPES.STUDENT,
          erpStudentId: student._id,
        })
          .select("email")
          .lean();
        email = String(user?.email || "")
          .toLowerCase()
          .trim();
      }
      if (!email) return null;
      return createStudentNotification({
        email,
        type: "exam",
        title: "Online Exam Scheduled",
        body: `Your online examination "${title}" is scheduled on ${dateLabel} at ${timeLabel}.`,
        meta: {
          examId: String(schedule._id),
          examPaperId: String(paper._id),
          title,
          date: dateLabel,
          time: timeLabel,
          duration: schedule.durationMinutes,
          actionUrl: `/student/live-exams?exam=${schedule._id}&view=instructions`,
        },
      });
    })
  );
}
