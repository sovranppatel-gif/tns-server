import { QuestionBank } from "./questionBank.model.js";
import { Course } from "../courses/courses.model.js";
import { asObjectId, httpError, idStr, toNumber } from "./exams.helpers.js";
import { QUESTION_DIFFICULTIES, QUESTION_STATUSES, QUESTION_TYPES } from "./exams.constants.js";

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    ...d,
    _id: String(d._id),
    id: String(d._id),
    courseId: d.courseId ? String(d.courseId) : "",
    universityId: d.universityId ? String(d.universityId) : "",
    courseName: d.courseName || "",
  };
}

function buildStats(rows) {
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "Active").length,
    draft: rows.filter((row) => row.status === "Draft").length,
    inactive: rows.filter((row) => row.status === "Inactive").length,
    easy: rows.filter((row) => row.difficulty === "Easy").length,
    medium: rows.filter((row) => row.difficulty === "Medium").length,
    hard: rows.filter((row) => row.difficulty === "Hard").length,
  };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listQuestions({
  search = "",
  type = "",
  subject = "",
  courseId = "",
  difficulty = "",
  status = "",
  page = 1,
  limit = 20,
} = {}) {
  const query = { softDelete: false };
  if (type) query.type = type;
  if (subject) query.subject = subject;
  if (difficulty) query.difficulty = difficulty;
  if (status) query.status = status;
  const courseOid = asObjectId(courseId);
  if (courseOid) query.courseId = courseOid;
  if (String(search || "").trim()) {
    const rx = new RegExp(escapeRegex(String(search).trim()), "i");
    query.$or = [{ text: rx }, { subject: rx }, { explanation: rx }, { seedKey: rx }];
  }

  const pageNum = Math.max(1, toNumber(page, 1));
  const limitNum = Math.min(100, Math.max(1, toNumber(limit, 20)));
  const skip = (pageNum - 1) * limitNum;

  const [docs, total] = await Promise.all([
    QuestionBank.find(query)
      .populate("courseId", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .maxTimeMS(8000),
    QuestionBank.countDocuments(query).maxTimeMS(8000),
  ]);

  const rows = docs.map((doc) =>
    toRow({
      ...doc,
      courseName: doc.courseId?.name || "",
      courseId: doc.courseId?._id || doc.courseId,
    })
  );

  const allForStats = await QuestionBank.find({ softDelete: false })
    .select("status difficulty")
    .lean()
    .maxTimeMS(8000);

  return {
    rows,
    stats: buildStats(allForStats.map(toRow)),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

export async function getQuestionById(id) {
  const doc = await QuestionBank.findOne({ _id: id, softDelete: false })
    .populate("courseId", "name code")
    .lean();
  if (!doc) return null;
  return toRow({
    ...doc,
    courseName: doc.courseId?.name || "",
    courseId: doc.courseId?._id || doc.courseId,
  });
}

export async function createQuestion(payload) {
  const created = await QuestionBank.create(payload);
  return toRow(created);
}

export async function updateQuestion(id, payload) {
  const updated = await QuestionBank.findOneAndUpdate(
    { _id: id, softDelete: false },
    payload,
    { returnDocument: "after", runValidators: true, maxTimeMS: 5000 }
  );
  return updated ? toRow(updated) : null;
}

export async function deactivateQuestion(id, updatedBy) {
  const updated = await QuestionBank.findOneAndUpdate(
    { _id: id, softDelete: false },
    { status: "Inactive", updatedBy },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  return updated ? toRow(updated) : null;
}

export async function getQuestionBankMeta() {
  const [subjects, courses] = await Promise.all([
    QuestionBank.distinct("subject", { softDelete: false }),
    Course.find({ softDelete: false, status: "Active" })
      .select("name code semesters")
      .lean()
      .maxTimeMS(8000),
  ]);

  const courseSubjects = [];
  for (const course of courses) {
    for (const sem of course.semesters || []) {
      for (const sub of sem.subjects || []) {
        if (sub.name) courseSubjects.push(sub.name);
      }
    }
  }

  return {
    types: QUESTION_TYPES,
    difficulties: QUESTION_DIFFICULTIES,
    statuses: QUESTION_STATUSES,
    subjects: [...new Set([...(subjects || []), ...courseSubjects].filter(Boolean))].sort(),
    courses: courses.map((c) => ({
      id: idStr(c._id),
      name: c.name,
      code: c.code,
      subjects: (c.semesters || []).flatMap((sem) =>
        (sem.subjects || []).map((s) => s.name).filter(Boolean)
      ),
    })),
  };
}

export async function assertQuestionExists(id) {
  const doc = await QuestionBank.findOne({ _id: id, softDelete: false }).lean();
  if (!doc) throw httpError("Question not found", 404);
  return doc;
}
