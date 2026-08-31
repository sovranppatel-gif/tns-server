import { ExamPaper } from "./examPaper.model.js";
import { QuestionBank } from "./questionBank.model.js";
import { University } from "../universities/universities.model.js";
import { Course } from "../courses/courses.model.js";
import { Batch } from "../batches/batches.model.js";
import { DEFAULT_EXAM_INSTRUCTIONS } from "./exams.constants.js";
import { validateQuestionPayload } from "./exams.validation.js";
import {
  asObjectId,
  httpError,
  idStr,
  paperTotals,
  snapshotQuestion,
} from "./exams.helpers.js";

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const questions = Array.isArray(d.questions) ? d.questions : [];
  return {
    ...d,
    _id: String(d._id),
    id: String(d._id),
    universityId: d.universityId ? String(d.universityId) : "",
    courseId: d.courseId ? String(d.courseId) : "",
    batchId: d.batchId ? String(d.batchId) : "",
    universityName: d.universityName || "",
    courseName: d.courseName || "",
    batchName: d.batchName || "",
    questions: questions.map((q, index) => ({
      ...q,
      questionId: String(q.questionId || ""),
      order: q.order || index + 1,
    })),
    instructions:
      Array.isArray(d.instructions) && d.instructions.length
        ? d.instructions
        : DEFAULT_EXAM_INSTRUCTIONS,
  };
}

function buildStats(rows) {
  return {
    total: rows.length,
    draft: rows.filter((row) => row.status === "Draft").length,
    published: rows.filter((row) => row.status === "Published").length,
    archived: rows.filter((row) => row.status === "Archived").length,
    questions: rows.reduce((sum, row) => sum + (row.totalQuestions || 0), 0),
    marks: rows.reduce((sum, row) => sum + (row.totalMarks || 0), 0),
  };
}

async function attachMasters(payload) {
  const next = { ...payload };
  if (payload.universityId) {
    const uni = await University.findOne({
      _id: payload.universityId,
      softDelete: false,
    })
      .select("name shortName")
      .lean();
    if (!uni) throw httpError("University not found");
    next.universityName = uni.shortName
      ? `${uni.shortName} — ${uni.name}`
      : uni.name;
  }
  if (payload.courseId) {
    const course = await Course.findOne({
      _id: payload.courseId,
      softDelete: false,
    })
      .select("name code")
      .lean();
    if (!course) throw httpError("Course not found");
    next.courseName = course.name;
    next.courseCode = course.code;
  }
  if (payload.batchId) {
    const batch = await Batch.findOne({
      _id: payload.batchId,
      softDelete: false,
    })
      .select("name batchId")
      .lean();
    if (!batch) throw httpError("Batch not found");
    next.batchName = batch.name;
  }
  return next;
}

function withTotals(payload) {
  const totals = paperTotals(payload.questions);
  return {
    ...payload,
    questions: (payload.questions || []).map((q, index) => ({
      ...q,
      order: index + 1,
    })),
    totalQuestions: totals.totalQuestions,
    totalMarks: totals.totalMarks,
  };
}

export async function listPapers({
  search = "",
  status = "",
  courseId = "",
  universityId = "",
} = {}) {
  const query = { softDelete: false };
  if (status) query.status = status;
  const courseOid = asObjectId(courseId);
  const uniOid = asObjectId(universityId);
  if (courseOid) query.courseId = courseOid;
  if (uniOid) query.universityId = uniOid;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
    ];
  }
  const docs = await ExamPaper.find(query).sort({ updatedAt: -1 }).lean().maxTimeMS(8000);
  const rows = docs.map(toRow);
  return { rows, stats: buildStats(rows) };
}

export async function getPaperById(id, { includeAnswers = true } = {}) {
  const doc = await ExamPaper.findOne({ _id: id, softDelete: false }).lean();
  if (!doc) return null;
  const row = toRow(doc);
  if (!includeAnswers) {
    row.questions = row.questions.map((q) => {
      const { correctAnswer, explanation, ...safe } = q;
      return safe;
    });
  }
  return row;
}

export async function createPaper(payload) {
  await assertUniqueCode(payload.code);
  const withMeta = withTotals(await attachMasters(payload));
  if (!withMeta.instructions.length) {
    withMeta.instructions = DEFAULT_EXAM_INSTRUCTIONS;
  }
  const created = await ExamPaper.create(withMeta);
  return toRow(created);
}

export async function updatePaper(id, payload) {
  const existing = await ExamPaper.findOne({ _id: id, softDelete: false }).lean();
  if (!existing) return null;
  if (existing.status === "Published" || existing.status === "Archived") {
    throw httpError("Published or archived papers cannot be edited. Archive and create a new paper.");
  }
  await assertUniqueCode(payload.code, id);
  const withMeta = withTotals(await attachMasters(payload));
  const updated = await ExamPaper.findOneAndUpdate(
    { _id: id, softDelete: false, status: "Draft" },
    { ...withMeta, status: "Draft" },
    { returnDocument: "after", runValidators: true, maxTimeMS: 8000 }
  );
  return updated ? toRow(updated) : null;
}

export async function publishPaper(id, updatedBy) {
  const existing = await ExamPaper.findOne({ _id: id, softDelete: false }).lean();
  if (!existing) return null;
  if (!existing.questions?.length) {
    throw httpError("Add at least one question before publishing");
  }
  for (const question of existing.questions) {
    const error = validateQuestionPayload(question, { requireStatus: false });
    if (error) throw httpError(error);
  }
  const version = existing.status === "Published" ? existing.version : (existing.version || 1);
  const updated = await ExamPaper.findOneAndUpdate(
    { _id: id, softDelete: false },
    {
      status: "Published",
      publishedAt: existing.publishedAt || new Date(),
      version,
      updatedBy,
    },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  return updated ? toRow(updated) : null;
}

export async function archivePaper(id, updatedBy) {
  const updated = await ExamPaper.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Archived", updatedBy },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  return updated ? toRow(updated) : null;
}

export async function addQuestionFromBank(paperId, questionId, overrides = {}) {
  const paper = await ExamPaper.findOne({ _id: paperId, softDelete: false, status: "Draft" });
  if (!paper) throw httpError("Draft exam paper not found", 404);
  const question = await QuestionBank.findOne({
    _id: questionId,
    softDelete: false,
  }).lean();
  if (!question) throw httpError("Question not found", 404);
  if (paper.questions.some((q) => String(q.questionId) === String(question._id))) {
    throw httpError("Question is already in this paper", 409);
  }
  paper.questions.push(
    snapshotQuestion(question, {
      marks: overrides.marks,
      negativeMarks: overrides.negativeMarks,
    })
  );
  const totals = paperTotals(paper.questions);
  paper.totalQuestions = totals.totalQuestions;
  paper.totalMarks = totals.totalMarks;
  await paper.save();
  return toRow(paper);
}

export async function addInlineQuestion(paperId, questionPayload) {
  const paper = await ExamPaper.findOne({ _id: paperId, softDelete: false, status: "Draft" });
  if (!paper) throw httpError("Draft exam paper not found", 404);
  const created = await QuestionBank.create({
    ...questionPayload,
    status: questionPayload.status || "Active",
  });
  paper.questions.push(snapshotQuestion(created.toObject()));
  const totals = paperTotals(paper.questions);
  paper.totalQuestions = totals.totalQuestions;
  paper.totalMarks = totals.totalMarks;
  await paper.save();
  return toRow(paper);
}

async function assertUniqueCode(code, excludeId) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return;
  const query = { code: normalized, softDelete: false };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await ExamPaper.findOne(query).select("_id").lean();
  if (existing) throw httpError("Exam code already exists", 409);
}

export { idStr };
