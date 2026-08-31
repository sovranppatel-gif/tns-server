import mongoose from "mongoose";
import { connectMongo } from "./connectMongo.js";
import { Course } from "../modules/courses/courses.model.js";
import { QuestionBank } from "../modules/exams/questionBank.model.js";
import { validateQuestionPayload } from "../modules/exams/exams.validation.js";
import {
  OMC_COMPUTER_BASIC_META as META,
  OMC_COMPUTER_BASIC_QUESTIONS as RAW_QUESTIONS,
} from "./omcComputerBasicQuestions.js";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const SEED_PREFIX = "TNS-CB-OMC-";

function seedKeyFor(n) {
  return `${SEED_PREFIX}${String(n).padStart(3, "0")}`;
}

function isNoneText(value) {
  return /^(none)$/i.test(String(value || "").trim());
}

function buildQuestionText(row) {
  const hindi = String(row.hindi || "").trim();
  const english = String(row.english || "").trim();
  if (hindi && english) return `${hindi}\n\n${english}`;
  return hindi || english;
}

function toBankQuestion(row, { courseId, universityId }) {
  const options = (row.options || []).map((text, index) => ({
    key: OPTION_KEYS[index],
    text: String(text).trim(),
  }));
  const correctIndex = Number(row.correctOption) - 1;
  const correctOption = options[correctIndex];
  const correctKey = correctOption?.key || "";
  const explanation = String(row.explanation || "").trim();

  return {
    seedKey: seedKeyFor(row.n),
    text: buildQuestionText(row),
    type: META.type,
    options,
    correctAnswer: correctKey,
    marks: META.marks,
    negativeMarks: META.negativeMarks,
    subject: META.subject,
    courseId: courseId || null,
    universityId: universityId || null,
    difficulty: row.difficulty || "Medium",
    explanation,
    status: META.status,
    sourceExam: META.exam,
    sourceDate: META.sourceDate,
    sourceInstitute: META.institute,
    createdBy: "system-seed",
    updatedBy: "system-seed",
    softDelete: false,
  };
}

function optionMatchesLabel(optionText, label) {
  const chosen = String(optionText || "").trim().toLowerCase();
  const expected = String(label || "").trim().toLowerCase();
  if (!chosen || !expected) return false;
  if (chosen === expected) return true;
  if (chosen.includes(expected) || expected.includes(chosen)) return true;
  return isNoneText(chosen) && isNoneText(expected);
}

function validateSeedArray(rows) {
  const errors = [];
  if (rows.length !== 50) {
    errors.push(`Expected 50 questions, found ${rows.length}`);
  }
  if (Number(META.marks) !== 2) errors.push("Marks per question must be 2");
  if (Number(META.negativeMarks) !== 0) errors.push("negativeMarks must be 0");

  const keys = new Set();
  const texts = new Set();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (Number(row.n) !== i + 1) {
      errors.push(`Question order mismatch at index ${i}: expected n=${i + 1}, got n=${row.n}`);
    }

    const key = seedKeyFor(row.n);
    if (keys.has(key)) errors.push(`Duplicate seed key ${key}`);
    keys.add(key);

    if (!Array.isArray(row.options) || row.options.length < 2) {
      errors.push(`Q${row.n}: needs at least 2 options`);
      continue;
    }
    if (row.n === 44 && row.options.length !== 4) {
      errors.push(`Q44 must keep 4 options (found ${row.options.length})`);
    }

    const idx = Number(row.correctOption);
    if (!Number.isInteger(idx) || idx < 1 || idx > row.options.length) {
      errors.push(`Q${row.n}: correctOption ${row.correctOption} is out of range`);
      continue;
    }
    const chosen = String(row.options[idx - 1] || "").trim();
    if (!chosen) errors.push(`Q${row.n}: correct option text is empty`);

    const label = String(row.correctLabel || "").trim();
    if (!label) errors.push(`Q${row.n}: correctLabel missing`);
    else if (!optionMatchesLabel(chosen, label)) {
      // Index is canonical for Hindi/English pairs (e.g. प्रिंट प्रिव्यू / Print Preview).
      const bilingualOk = chosen && label && chosen !== label;
      if (!bilingualOk) {
        errors.push(`Q${row.n}: correctLabel "${label}" does not match option "${chosen}"`);
      }
    }

    const text = buildQuestionText(row);
    if (!text) errors.push(`Q${row.n}: question text missing`);
    const textKey = text.replace(/\s+/g, " ").toLowerCase();
    if (texts.has(textKey)) errors.push(`Duplicate question text at Q${row.n}`);
    texts.add(textKey);
  }

  if (Number(rows.find((r) => r.n === 7)?.correctOption) !== 5) {
    errors.push("Q7 must be stored as NONE (option 5) — options are historically inaccurate");
  }
  if (Number(rows.find((r) => r.n === 29)?.correctOption) !== 5) {
    errors.push("Q29 must be stored as NONE (option 5) — question is historically ambiguous");
  }

  return errors;
}

async function ensureOmcCourse() {
  const existing = await Course.findOne({
    softDelete: false,
    $or: [
      { code: META.courseCode },
      { name: { $regex: /OMC\s*OFFICE\s*MANAGEMENT/i } },
      { name: { $regex: /OFFICE\s*MANAGEMENT\s*COURSE/i } },
    ],
  }).lean();

  if (existing) {
    const subjects = (existing.semesters || []).flatMap((sem) =>
      (sem.subjects || []).map((s) => String(s.name || "").trim())
    );
    const hasSubject = subjects.some((name) => name.toUpperCase() === META.subject);
    if (!hasSubject) {
      const semesters = Array.isArray(existing.semesters) ? [...existing.semesters] : [];
      if (!semesters.length) {
        semesters.push({
          number: 1,
          title: "OMC",
          durationMonths: existing.durationMonths || 6,
          subjects: [],
        });
      }
      semesters[0] = {
        ...semesters[0],
        subjects: [
          ...(semesters[0].subjects || []),
          {
            name: META.subject,
            code: "OMC-CB",
            subjectType: "Theory",
            maxMarks: 100,
            passingMarks: 40,
          },
        ],
      };
      await Course.updateOne({ _id: existing._id }, { $set: { semesters, updatedBy: "system-seed" } });
    }
    return existing;
  }

  const created = await Course.create({
    name: META.courseName,
    code: META.courseCode,
    type: "Institute",
    category: "Certificate",
    structureType: "Single Level",
    durationMonths: 6,
    durationLabel: "6 months",
    semesterCount: 1,
    universityName: "Thakur Niranjan Singh I.T.I. & Computer",
    universityShortName: "TNS",
    status: "Active",
    mode: "Offline",
    description:
      "Office Management Course (OMC) — computer basics, MS Office and office productivity at TNS ITI & Computer.",
    highlights: ["Computer Basic", "MS Office", "Institute certificate"],
    semesters: [
      {
        number: 1,
        title: "OMC",
        durationMonths: 6,
        subjects: [
          {
            name: META.subject,
            code: "OMC-CB",
            subjectType: "Theory",
            maxMarks: 100,
            passingMarks: 40,
          },
        ],
      },
    ],
    createdBy: "system-seed",
    updatedBy: "system-seed",
    softDelete: false,
  });

  console.log(`Created course ${created.code} — ${created.name}`);
  return created.toObject ? created.toObject() : created;
}

async function upsertQuestion(payload) {
  const { createdBy, ...setFields } = payload;
  const result = await QuestionBank.updateOne(
    { seedKey: payload.seedKey },
    {
      $set: setFields,
      $setOnInsert: { createdBy: createdBy || "system-seed" },
    },
    { upsert: true }
  );
  if (result.upsertedCount) return "inserted";
  if (result.modifiedCount) return "updated";
  return "skipped";
}

const VERIFY_KEYS = [
  [1, "C", "Tab"],
  [5, "B", "Ctrl + E"],
  [7, "E", "NONE"],
  [10, "C", "="],
  [15, "B", "Ctrl + C"],
  [20, "B", "एनिमेशन"],
  [26, "C", "बूटिंग"],
  [29, "E", "NONE"],
  [31, "A", "Central Processing Unit"],
  [37, "C", "स्टोरेज डिवाइस"],
  [40, "C", "पेस्ट करने के लिए"],
  [45, "B", "माइक्रोसॉफ्ट"],
  [50, "D", "उपरोक्त सभी"],
];

export async function seedQuestionBankOmcComputerBasic() {
  const errors = validateSeedArray(RAW_QUESTIONS);
  if (errors.length) {
    throw new Error(`Question bank seed validation failed:\n- ${errors.join("\n- ")}`);
  }

  const course = await ensureOmcCourse();
  const courseId = course._id;
  const universityId = course.universityId || null;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let seedErrors = 0;

  for (const row of RAW_QUESTIONS) {
    const payload = toBankQuestion(row, { courseId, universityId });
    const validationError = validateQuestionPayload(payload);
    if (validationError) {
      seedErrors += 1;
      console.error(`Q${row.n} (${payload.seedKey}): ${validationError}`);
      continue;
    }
    try {
      const result = await upsertQuestion(payload);
      if (result === "inserted") inserted += 1;
      else if (result === "updated") updated += 1;
      else skipped += 1;
    } catch (err) {
      seedErrors += 1;
      console.error(`Q${row.n} (${payload.seedKey}) failed:`, err.message);
    }
  }

  const stored = await QuestionBank.find({
    seedKey: { $regex: `^${SEED_PREFIX}` },
    softDelete: false,
  })
    .select("seedKey text options correctAnswer marks")
    .lean();

  console.log("\nQuestion Bank Seed");
  console.log("------------------");
  console.log(`Subject: ${META.subject}`);
  console.log(`Course: ${META.exam}`);
  console.log(`Questions: ${RAW_QUESTIONS.length}`);
  console.log(`Marks/question: ${META.marks}`);
  console.log(`Total marks: ${RAW_QUESTIONS.length * META.marks}`);
  console.log("");
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${seedErrors}`);
  console.log(`Stored with ${SEED_PREFIX}*: ${stored.length}`);

  let verifyFailed = 0;
  for (const [n, key, snippet] of VERIFY_KEYS) {
    const doc = stored.find((q) => q.seedKey === seedKeyFor(n));
    const option = doc?.options?.find((o) => o.key === doc.correctAnswer);
    const ok =
      doc &&
      doc.correctAnswer === key &&
      Number(doc.marks) === 2 &&
      String(option?.text || "").includes(snippet);
    if (!ok) {
      verifyFailed += 1;
      console.error(
        `VERIFY FAIL Q${n}: expected key=${key} containing "${snippet}", got key=${doc?.correctAnswer} text="${option?.text || ""}"`
      );
    } else {
      console.log(`VERIFY OK  Q${String(n).padStart(2, "0")}  ${key}  ${option.text}`);
    }
  }

  if (verifyFailed) {
    throw new Error(`${verifyFailed} post-seed verifications failed`);
  }

  return { inserted, updated, skipped, errors: seedErrors, stored: stored.length };
}

async function runStandalone() {
  await connectMongo();
  try {
    await seedQuestionBankOmcComputerBasic();
    console.log("\nQuestion bank seed completed.");
  } finally {
    await mongoose.disconnect();
  }
}

const isMain =
  process.argv[1] &&
  String(process.argv[1]).replace(/\\/g, "/").endsWith("seedQuestionBankOmcComputerBasic.js");

if (isMain) {
  runStandalone().catch((err) => {
    console.error("Question bank seed failed:", err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}
