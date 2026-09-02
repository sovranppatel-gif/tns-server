import mongoose from "mongoose";
import { Assignment, AssignmentSubmission, AssignmentTarget, StudentAssignment } from "./assignments.model.js";
import { Course } from "../courses/courses.model.js";
import { Batch } from "../batches/batches.model.js";
import { Student } from "../students/students.model.js";
import { User, USER_TYPES } from "../../models/User.js";
import { createStudentNotification } from "../../lib/studentNotifications.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";

const ACTIVE_STUDENT_STATUSES = ["Active"];
function error(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function oid(value, name) { if (!mongoose.isValidObjectId(value)) throw error(`${name} is invalid`); return new mongoose.Types.ObjectId(value); }
function paging(query) { const page = Math.max(1, Number(query.page) || 1); const limit = Math.min(100, Math.max(1, Number(query.limit) || 20)); return { page, limit, skip: (page - 1) * limit }; }

export function validateAssignmentInput(body, { partial = false } = {}) {
  if (!partial && !String(body.title || "").trim()) throw error("Assignment title is required");
  if (!partial && !body.courseId) throw error("Course is required");
  if (!partial && !body.dueAt) throw error("Due date is required");
  if (body.totalMarks != null && Number(body.totalMarks) < 0) throw error("Total marks must be valid");
  if (body.passingMarks != null && Number(body.passingMarks) < 0) throw error("Passing marks must be valid");
  if (body.totalMarks != null && body.passingMarks != null && Number(body.passingMarks) > Number(body.totalMarks)) throw error("Passing marks cannot exceed total marks");
  if (body.publishAt && body.dueAt && new Date(body.dueAt) <= new Date(body.publishAt)) throw error("Due date must be after publish date");
  if (body.submissionRules?.types && !body.submissionRules.types.length) throw error("At least one submission type is required");
  return body;
}

function assignmentPayload(body, actor, existing = {}) {
  const value = { ...existing, ...body, createdBy: existing.createdBy || actor, updatedBy: actor };
  for (const field of ["courseId"]) if (value[field]) value[field] = oid(value[field], field);
  if (value.publishAt) value.publishAt = new Date(value.publishAt);
  if (value.dueAt) value.dueAt = new Date(value.dueAt);
  value.totalMarks = Number(value.totalMarks ?? 0);
  value.passingMarks = Number(value.passingMarks ?? 0);
  return value;
}

export async function listAssignments(query = {}) {
  const { page, limit, skip } = paging(query);
  const filter = { softDelete: false };
  if (query.status) filter.status = query.status;
  if (query.courseId) filter.courseId = oid(query.courseId, "courseId");
  if (query.search) filter.title = { $regex: String(query.search).trim(), $options: "i" };
  const [rows, total] = await Promise.all([
    Assignment.find(filter).populate("courseId", "name code").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Assignment.countDocuments(filter),
  ]);
  const ids = rows.map((row) => row._id);
  const counts = await StudentAssignment.aggregate([{ $match: { assignmentId: { $in: ids } } }, { $group: { _id: "$assignmentId", total: { $sum: 1 }, submitted: { $sum: { $cond: [{ $in: ["$status", ["SUBMITTED", "LATE_SUBMITTED", "UNDER_REVIEW", "EVALUATED"]] }, 1, 0] } }, evaluated: { $sum: { $cond: [{ $eq: ["$status", "EVALUATED"] }, 1, 0] } } } }]);
  const byId = new Map(counts.map((row) => [String(row._id), row]));
  return { rows: rows.map((row) => ({ ...row, stats: byId.get(String(row._id)) || { total: 0, submitted: 0, evaluated: 0 } })), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getAssignment(id) {
  const assignment = await Assignment.findOne({ _id: oid(id, "assignmentId"), softDelete: false }).populate("courseId", "name code").lean();
  if (!assignment) throw error("Assignment not found", 404);
  const [targets, students] = await Promise.all([AssignmentTarget.find({ assignmentId: assignment._id }).populate("batchId", "batchId name").lean(), StudentAssignment.find({ assignmentId: assignment._id }).populate("studentId", "studentId nameEnglish contact batchId").sort({ createdAt: 1 }).lean()]);
  return { ...assignment, targets, students };
}

async function eligibleStudents(targets, courseId) {
  const ids = new Map();
  for (const target of targets) {
    let filter = { status: { $in: ACTIVE_STUDENT_STATUSES }, courseId };
    if (target.targetType === "BATCH") filter.batchId = target.batchId;
    if (target.targetType === "STUDENT") filter._id = target.studentId;
    const rows = await Student.find(filter).select("_id courseId batchId contact nameEnglish").lean();
    rows.forEach((student) => ids.set(String(student._id), student));
  }
  return [...ids.values()];
}

export async function createAssignment(body, actor) {
  validateAssignmentInput(body);
  const courseId = oid(body.courseId, "courseId");
  if (!(await Course.exists({ _id: courseId, softDelete: false }))) throw error("Course not found", 404);
  const targets = Array.isArray(body.targets) ? body.targets : [];
  if (!targets.length) throw error("At least one assignment target is required");
  const assignment = await Assignment.create(assignmentPayload(body, actor));
  const targetDocs = targets.map((target) => ({ assignmentId: assignment._id, targetType: target.targetType || "BATCH", courseId, batchId: target.batchId ? oid(target.batchId, "batchId") : null, studentId: target.studentId ? oid(target.studentId, "studentId") : null }));
  try { await AssignmentTarget.insertMany(targetDocs, { ordered: true }); } catch (e) { await Assignment.deleteOne({ _id: assignment._id }); throw error(e.code === 11000 ? "Duplicate assignment target" : e.message); }
  await createActivityLog({ action: "assignment.created", section: "Assignments", actor, message: `Created assignment ${assignment.title}`, path: "/api/assignments", resourceId: String(assignment._id) });
  if (assignment.status === "ACTIVE") await publishAssignment(assignment._id, actor);
  return getAssignment(assignment._id);
}

export async function updateAssignment(id, body, actor) {
  validateAssignmentInput(body, { partial: true });
  const assignment = await Assignment.findOneAndUpdate({ _id: oid(id, "assignmentId"), softDelete: false }, { $set: assignmentPayload(body, actor) }, { new: true, runValidators: true });
  if (!assignment) throw error("Assignment not found", 404);
  return getAssignment(assignment._id);
}

export async function publishAssignment(id, actor) {
  const assignment = await Assignment.findOne({ _id: oid(id, "assignmentId"), softDelete: false });
  if (!assignment) throw error("Assignment not found", 404);
  const targets = await AssignmentTarget.find({ assignmentId: assignment._id }).lean();
  if (!targets.length) throw error("At least one assignment target is required");
  const students = await eligibleStudents(targets, assignment.courseId);
  const operations = students.map((student) => ({ updateOne: { filter: { assignmentId: assignment._id, studentId: student._id }, update: { $setOnInsert: { assignmentId: assignment._id, studentId: student._id, courseId: assignment.courseId, batchId: student.batchId, dueAt: assignment.dueAt, availableAt: assignment.publishAt || new Date(), status: "ASSIGNED" } }, upsert: true } }));
  if (operations.length) await StudentAssignment.bulkWrite(operations, { ordered: false });
  assignment.status = assignment.publishAt && assignment.publishAt > new Date() ? "SCHEDULED" : "ACTIVE";
  assignment.updatedBy = actor;
  await assignment.save();
  const users = await User.find({ type: USER_TYPES.STUDENT, erpStudentId: { $in: students.map((s) => s._id) } }).select("_id email erpStudentId").lean();
  await Promise.all(users.filter((u) => u.email).map((u) => createStudentNotification({ email: u.email, userId: u._id, type: "assignment", title: "New assignment available", body: `${assignment.title} has been assigned to you.`, meta: { assignmentId: String(assignment._id) } })));
  return { assignment: await getAssignment(assignment._id), assignedCount: students.length };
}

export async function deleteAssignment(id, actor) { const result = await Assignment.findOneAndUpdate({ _id: oid(id, "assignmentId"), softDelete: false }, { $set: { softDelete: true, status: "ARCHIVED", updatedBy: actor } }, { new: true }); if (!result) throw error("Assignment not found", 404); return result; }

async function studentForRequest(req) { const sub = String(req.student?.sub || ""); const userId = sub.startsWith("student:") ? sub.slice(8) : null; const user = userId && mongoose.isValidObjectId(userId) ? await User.findOne({ _id: userId, type: USER_TYPES.STUDENT }).lean() : await User.findOne({ type: USER_TYPES.STUDENT, email: String(req.student?.email || "").toLowerCase() }).lean(); const student = user?.erpStudentId ? await Student.findById(user.erpStudentId).lean() : await Student.findOne({ "contact.email": String(req.student?.email || "").toLowerCase() }).lean(); if (!student) throw error("Student profile not found", 404); return student; }
export async function listStudentAssignments(req) { const student = await studentForRequest(req); return StudentAssignment.find({ studentId: student._id }).populate({ path: "assignmentId", match: { softDelete: false }, populate: { path: "courseId", select: "name code" } }).sort({ dueAt: 1 }).lean(); }
export async function getStudentAssignment(req, id) { const student = await studentForRequest(req); const row = await StudentAssignment.findOne({ _id: oid(id, "studentAssignmentId"), studentId: student._id }).populate({ path: "assignmentId", populate: { path: "courseId", select: "name code" } }); if (!row || !row.assignmentId || row.assignmentId.softDelete) throw error("Assignment not found", 404); if (!row.firstViewedAt) row.firstViewedAt = new Date(); row.lastViewedAt = new Date(); if (row.status === "ASSIGNED") row.status = "VIEWED"; await row.save(); return row.toObject(); }
export async function submitStudentAssignment(req, id, body) { const row = await StudentAssignment.findOne({ _id: oid(id, "studentAssignmentId") }); if (!row) throw error("Assignment not found", 404); const student = await studentForRequest(req); if (String(row.studentId) !== String(student._id)) throw error("You cannot submit this assignment", 403); const assignment = await Assignment.findById(row.assignmentId); if (!assignment || assignment.status === "CLOSED" || assignment.status === "ARCHIVED") throw error("Assignment is closed", 409); const now = new Date(); const late = now > row.dueAt; if (late && !assignment.submissionRules.allowLateSubmission) throw error("Submission deadline has passed", 409); if (!assignment.submissionRules.allowMultipleSubmissions && row.submissionCount > 0) throw error("Multiple submissions are not allowed", 409); const submission = await AssignmentSubmission.create({ studentAssignmentId: row._id, assignmentId: row.assignmentId, studentId: student._id, submissionNumber: row.submissionCount + 1, textAnswer: String(body.textAnswer || ""), files: Array.isArray(body.files) ? body.files : [], links: Array.isArray(body.links) ? body.links : [], submittedAt: now, isLate: late, lateDuration: late ? now - row.dueAt : 0, submittedBy: String(req.student?.email || "") }); row.submissionCount += 1; row.latestSubmissionId = submission._id; row.submittedAt = now; row.isLate = late; row.lateDuration = late ? now - row.dueAt : 0; row.status = late ? "LATE_SUBMITTED" : "SUBMITTED"; await row.save(); return { studentAssignment: row.toObject(), submission: submission.toObject() }; }
export async function evaluateSubmission(id, body, actor) { const row = await StudentAssignment.findOne({ _id: oid(id, "studentAssignmentId") }); if (!row) throw error("Student assignment not found", 404); const marks = Number(body.marksObtained); const assignment = await Assignment.findById(row.assignmentId); if (!Number.isFinite(marks) || marks < 0 || marks > assignment.totalMarks) throw error("Marks cannot exceed total marks"); row.marksObtained = marks; row.percentage = assignment.totalMarks ? Math.round((marks / assignment.totalMarks) * 10000) / 100 : 0; row.feedback = String(body.feedback || ""); row.evaluatedBy = actor; row.evaluatedAt = new Date(); row.status = "EVALUATED"; await row.save(); return row.toObject(); }
export async function analytics() { const [assignmentCount, studentCount, status] = await Promise.all([Assignment.countDocuments({ softDelete: false }), StudentAssignment.countDocuments(), StudentAssignment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])]); return { totalAssignments: assignmentCount, totalAssigned: studentCount, statuses: Object.fromEntries(status.map((s) => [s._id, s.count])) }; }
