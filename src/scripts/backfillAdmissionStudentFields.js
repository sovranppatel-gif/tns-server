import mongoose from "mongoose";
import { connectMongo } from "../db/connectMongo.js";
import { Admission } from "../models/Admission.js";
import { Student } from "../modules/students/students.model.js";

const PROFILE_FIELDS = [
  "nameEnglish",
  "nameHindi",
  "fatherName",
  "motherName",
  "dateOfBirth",
  "gender",
  "category",
  "studentMobile",
  "contactNo",
  "email",
  "permanentAddress",
  "homeAddress",
  "village",
  "post",
  "tehsil",
  "district",
  "state",
  "pinCode",
  "guardianName",
  "relation",
  "guardianMobile",
  "guardianAddress",
  "education",
  "documents",
];

function key(value) {
  return value == null ? "" : String(value).trim().toLowerCase();
}

function addIndex(map, value, student) {
  const normalized = key(value);
  if (normalized && !map.has(normalized)) map.set(normalized, student);
}

function studentIndexes(students) {
  const indexes = new Map();
  for (const student of students) {
    addIndex(indexes, student._id, student);
    addIndex(indexes, student.studentId, student);
    addIndex(indexes, student.admissionId, student);
    addIndex(indexes, student.admissionMongoId, student);
    addIndex(indexes, student.contact?.email, student);
  }
  return indexes;
}

function findStudent(admission, indexes) {
  const candidates = [
    admission.studentMongoId,
    admission.studentId,
    admission.admissionId,
    admission._id,
    admission.email,
  ];
  return candidates.map((candidate) => indexes.get(key(candidate))).find(Boolean) || null;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function buildUpdate(admission, student) {
  const existing = admission.details && typeof admission.details === "object" ? admission.details : {};
  const set = {};
  const studentFields = {
    ...student,
    studentMobile: student.contact?.mobile,
    contactNo: student.contact?.alternateMobile || student.contact?.mobile,
    email: student.contact?.email,
    permanentAddress: student.address?.permanent,
    homeAddress: student.address?.correspondence,
    village: student.address?.village,
    post: student.address?.post,
    tehsil: student.address?.tehsil,
    district: student.address?.district,
    state: student.address?.state,
    pinCode: student.address?.pinCode,
    guardianName: student.guardian?.name,
    relation: student.guardian?.relation,
    guardianMobile: student.guardian?.mobile,
    guardianAddress: student.guardian?.address,
  };

  for (const field of PROFILE_FIELDS) {
    if (!hasValue(existing[field]) && hasValue(studentFields[field])) {
      set[`details.${field}`] = studentFields[field];
    }
  }
  if (!hasValue(existing.photoPreview) && hasValue(student.photo)) {
    set["details.photoPreview"] = student.photo;
  }
  if (!admission.studentId && student.studentId) set.studentId = student.studentId;
  if (!admission.studentMongoId && student._id) set.studentMongoId = student._id;
  if (!hasValue(existing.studentId) && student.studentId) set["details.studentId"] = student.studentId;
  if (!hasValue(existing.studentMongoId) && student._id) set["details.studentMongoId"] = String(student._id);

  return set;
}

async function run() {
  await connectMongo();
  const [admissions, students] = await Promise.all([
    Admission.find().select("_id admissionId email studentId studentMongoId details").lean(),
    Student.find()
      .select("_id studentId admissionId admissionMongoId nameEnglish nameHindi fatherName motherName dateOfBirth gender category contact address guardian photo documents education")
      .lean(),
  ]);
  const indexes = studentIndexes(students);
  const operations = [];
  let matched = 0;
  let changed = 0;

  for (const admission of admissions) {
    const student = findStudent(admission, indexes);
    if (!student) continue;
    matched += 1;
    const $set = buildUpdate(admission, student);
    if (Object.keys($set).length) {
      changed += 1;
      operations.push({ updateOne: { filter: { _id: admission._id }, update: { $set } } });
    }
  }

  if (operations.length) await Admission.bulkWrite(operations, { ordered: false });
  console.log(`Admission student backfill complete: ${admissions.length} admissions, ${matched} matched, ${changed} updated.`);
}

run()
  .catch((error) => {
    console.error("Admission student backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
