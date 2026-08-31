import mongoose from "mongoose";
import { Admission } from "../models/Admission.js";
import { Course } from "../modules/courses/courses.model.js";
import { Batch } from "../modules/batches/batches.model.js";
import {
  Attendance,
  ATTENDANCE_STATUSES,
} from "../modules/attendance/attendance.model.js";
import { syncFeesFromAdmissions } from "../modules/fees/fees.service.js";
import { syncBatchesAndAttendance } from "../modules/batches/batches.service.js";
import { maxAttendanceNumericSeq } from "../modules/attendance/attendanceIds.js";

export const BATCH_ROSTER_SEED_TAG = "batch-roster-v1";
const TARGET_MIN = 20;
const TARGET_MAX = 25;
const TARGET_PER_BATCH = 22;

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan",
  "Krishna", "Ishaan", "Shaurya", "Atharv", "Kabir", "Dhruv", "Rudra", "Kartik",
  "Ananya", "Aadhya", "Diya", "Pari", "Anika", "Navya", "Myra", "Sara",
  "Kiara", "Aarohi", "Ira", "Prisha", "Riya", "Saanvi", "Meera", "Isha",
  "Rohan", "Amit", "Rahul", "Nikhil", "Suresh", "Vikram", "Deepak", "Manish",
  "Priya", "Neha", "Pooja", "Kavita", "Sneha", "Divya", "Shreya", "Anjali",
  "Harsh", "Yash", "Om", "Laksh", "Dev", "Raj", "Kunal", "Siddharth",
  "Tanvi", "Khushi", "Nisha", "Ritika", "Swati", "Pallavi", "Jyoti", "Komal",
  "Abhay", "Gaurav", "Mohit", "Pranav", "Varun", "Akash", "Naveen", "Sanjay",
  "Trisha", "Aditi", "Simran", "Jiya", "Mahika", "Rhea", "Tanya", "Urmi",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Patel", "Singh", "Gupta", "Kumar", "Yadav", "Joshi",
  "Mehta", "Shah", "Reddy", "Nair", "Iyer", "Chopra", "Malhotra", "Kapoor",
  "Agarwal", "Jain", "Bansal", "Saxena", "Mishra", "Tiwari", "Pandey", "Dubey",
  "Chauhan", "Rathore", "Thakur", "Rawat", "Bisht", "Negi", "Khan", "Ansari",
  "Das", "Bose", "Banerjee", "Chatterjee", "Mukherjee", "Ghosh", "Sen", "Roy",
  "Pillai", "Menon", "Krishnan", "Rao", "Naidu", "Deshmukh", "Kulkarni", "Patil",
  "Jadhav", "More", "Chavan", "Gaikwad", "Bhatt", "Trivedi", "Dave", "Parekh",
];

const CITIES = [
  "Jabalpur", "Bhopal", "Indore", "Gwalior", "Rewa", "Sagar", "Satna", "Ujjain",
];

function dayStart(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function pick(arr, i) {
  return arr[i % arr.length];
}

function studentName(batchIndex, studentIndex) {
  const first = pick(FIRST_NAMES, batchIndex * 31 + studentIndex * 7 + 3);
  const last = pick(LAST_NAMES, batchIndex * 17 + studentIndex * 11 + 5);
  // Ensure uniqueness within batch by suffix when collisions happen
  const base = `${first} ${last}`.toUpperCase();
  return studentIndex > 40 ? `${base} ${studentIndex}` : base;
}

function emailFor(name, batchId, index) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  const batchSlug = String(batchId || "bat").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slug}.${batchSlug}.${index + 1}@demo.growskillstech.in`;
}

function phoneFor(batchIndex, studentIndex) {
  const n = 7000000000 + batchIndex * 1000 + studentIndex;
  return String(n).slice(0, 10);
}

function pickStatus(dayIndex, studentIndex) {
  const roll = (dayIndex * 11 + studentIndex * 5) % 12;
  if (roll === 0) return "Absent";
  if (roll === 1) return "Late";
  if (roll === 2) return "Leave";
  return "Present";
}

function feeAmountFor(course, index) {
  const fromCourse = String(course?.fees?.total || "")
    .replace(/[₹,\s]/g, "")
    .trim();
  const n = Number(fromCourse);
  if (Number.isFinite(n) && n > 0) return n;
  const defaults = [12000, 15000, 18000, 22000, 25000, 30000];
  return defaults[index % defaults.length];
}

async function nextAdmissionSeq() {
  const year = new Date().getFullYear();
  const prefix = `ADM-${year}-`;
  const latest = await Admission.findOne({ admissionId: new RegExp(`^${prefix}`) })
    .sort({ admissionId: -1 })
    .select("admissionId")
    .lean();
  let seq = 1;
  if (latest?.admissionId) {
    const part = latest.admissionId.slice(prefix.length);
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return { year, prefix, seq };
}

async function nextAttendanceSeq() {
  return (await maxAttendanceNumericSeq()) + 1;
}

/**
 * Seed 20–25 Approved students per batch with fees + last-7-day attendance.
 * Idempotent via details.seedTag + details.seedBatchId.
 */
export async function seedBatchStudentsRoster({
  editor = "system-seed",
  perBatch = TARGET_PER_BATCH,
} = {}) {
  // Ensure batches exist first
  await syncBatchesAndAttendance(editor).catch(() => null);

  const batches = await Batch.find({ softDelete: false })
    .sort({ batchId: 1 })
    .lean()
    .maxTimeMS(15000);

  if (!batches.length) {
    return {
      batches: 0,
      admissionsCreated: 0,
      feesSynced: 0,
      attendanceUpserts: 0,
      message: "No batches found",
    };
  }

  const courseIds = [
    ...new Set(batches.map((b) => String(b.courseId)).filter(Boolean)),
  ];
  const courses = await Course.find({
    _id: { $in: courseIds.map((id) => new mongoose.Types.ObjectId(id)) },
    softDelete: false,
  })
    .lean()
    .maxTimeMS(10000);
  const courseById = new Map(courses.map((c) => [String(c._id), c]));

  const target = Math.min(
    TARGET_MAX,
    Math.max(TARGET_MIN, Number(perBatch) || TARGET_PER_BATCH)
  );

  let admissionSeq = await nextAdmissionSeq();
  let admissionsCreated = 0;
  let attendanceUpserts = 0;
  let batchesFilled = 0;

  const today = dayStart(new Date());
  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    last7.push(d);
  }

  let attSeq = await nextAttendanceSeq();
  const attendanceDocs = [];

  for (let bIdx = 0; bIdx < batches.length; bIdx += 1) {
    const batch = batches[bIdx];
    const course = courseById.get(String(batch.courseId));
    if (!course) continue;

    const existingCount = await Admission.countDocuments({
      status: "Approved",
      "details.seedTag": BATCH_ROSTER_SEED_TAG,
      "details.seedBatchId": batch.batchId,
    }).maxTimeMS(8000);

    const need = Math.max(0, target - existingCount);
    if (need === 0) {
      batchesFilled += 1;
      // Still refresh enrolled count
      const enrolled = await Admission.countDocuments({
        status: "Approved",
        $or: [
          { "details.seedBatchId": batch.batchId },
          { "details.courseId": String(batch.courseId) },
          { "details.courseId": batch.courseId },
          { course: new RegExp(`^${String(batch.courseName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        ],
      }).maxTimeMS(8000);
      await Batch.updateOne(
        { _id: batch._id },
        { $set: { enrolledCount: enrolled, updatedBy: editor } }
      );
      continue;
    }

    const toInsert = [];
    for (let s = 0; s < need; s += 1) {
      const studentIndex = existingCount + s;
      const name = studentName(bIdx, studentIndex);
      const email = emailFor(name, batch.batchId, studentIndex);
      const phone = phoneFor(bIdx, studentIndex);
      const totalFee = feeAmountFor(course, studentIndex);
      const paidAtAdmission = Math.round(totalFee * (0.15 + (studentIndex % 4) * 0.05));
      const admissionId = `${admissionSeq.prefix}${String(admissionSeq.seq).padStart(4, "0")}`;
      admissionSeq.seq += 1;

      const city = pick(CITIES, bIdx + studentIndex);
      const gender = studentIndex % 3 === 0 ? "Female" : "Male";

      toInsert.push({
        admissionId,
        applicant: name,
        email,
        phone,
        course: batch.courseName || course.name,
        mode: studentIndex % 5 === 0 ? "Online" : "Offline",
        counsellor: pick(["Anita Verma", "Ravi Sharma", "Neha Patel", "Amit Joshi"], studentIndex),
        fee: `₹${paidAtAdmission.toLocaleString("en-IN")}`,
        status: "Approved",
        city,
        state: "Madhya Pradesh",
        college: batch.universityName || course.universityName || "Grow Skills Tech",
        studentStatus: "Enrolled",
        notes: `Seeded for ${batch.batchId}`,
        admissionDate: batch.startDate || new Date("2026-08-01T00:00:00.000Z"),
        createdBy: editor,
        details: {
          seedTag: BATCH_ROSTER_SEED_TAG,
          seedBatchId: batch.batchId,
          nameEnglish: name,
          nameHindi: "",
          fatherName: `${pick(FIRST_NAMES, studentIndex + 9)} ${pick(LAST_NAMES, studentIndex + 3)}`.toUpperCase(),
          motherName: `${pick(FIRST_NAMES, studentIndex + 15)} ${pick(LAST_NAMES, studentIndex + 3)}`.toUpperCase(),
          gender,
          category: pick(["GEN", "OBC", "SC", "ST"], studentIndex),
          dateOfBirth: `200${2 + (studentIndex % 5)}-0${1 + (studentIndex % 9)}-1${studentIndex % 9}`,
          contactNo: phone,
          studentMobile: phone,
          permanentAddress: `${12 + studentIndex}, Demo Nagar, ${city}`,
          village: city,
          pinCode: `48200${studentIndex % 10}`,
          session: "2026-2027",
          universityId: batch.universityId ? String(batch.universityId) : "",
          universityName: batch.universityName || "",
          courseId: String(batch.courseId),
          courseCode: batch.courseCode || course.code || "",
          courseName: batch.courseName || course.name,
          totalFee: `₹${totalFee.toLocaleString("en-IN")}`,
          monthlyFee: `₹${Math.round(totalFee / 6).toLocaleString("en-IN")}`,
          currentSemester: batch.currentSemester || 1,
          semester: batch.currentSemester || 1,
          payment: {
            amount: paidAtAdmission,
            method: pick(["UPI", "Cash", "Card", "Bank Transfer"], studentIndex),
            mode: "Offline",
            note: "Registration / first installment at admission",
            date: batch.startDate || new Date("2026-08-01"),
          },
        },
      });
    }

    if (toInsert.length) {
      const inserted = await Admission.insertMany(toInsert, { ordered: false });
      admissionsCreated += inserted.length;
      batchesFilled += 1;

      const semester = Number(batch.currentSemester) || 1;
      const semesterTitle = `Semester ${semester}`;
      const startDate = dayStart(batch.startDate || new Date("2026-08-01"));
      const days = last7.filter((d) => d >= startDate);
      const useDays =
        days.length > 0
          ? days
          : Array.from({ length: 7 }, (_, i) => {
              const d = new Date(startDate);
              d.setDate(d.getDate() + i);
              d.setHours(0, 0, 0, 0);
              return d;
            });

      for (let sIdx = 0; sIdx < inserted.length; sIdx += 1) {
        const adm = inserted[sIdx];
        const uniId = batch.universityId;
        if (!uniId) continue;
        for (let dayIndex = 0; dayIndex < useDays.length; dayIndex += 1) {
          const status = pickStatus(dayIndex, existingCount + sIdx);
          if (!ATTENDANCE_STATUSES.includes(status)) continue;
          attendanceDocs.push({
            attendanceId: `ATT-${attSeq}`,
            admissionId: adm.admissionId,
            admissionMongoId: adm._id,
            student: adm.applicant,
            email: adm.email,
            phone: adm.phone,
            universityId: uniId,
            universityName: batch.universityName || "",
            courseId: batch.courseId,
            courseName: batch.courseName || "",
            courseCode: batch.courseCode || "",
            semester,
            semesterTitle,
            date: useDays[dayIndex],
            status,
            method: "Manual",
            note: "Seeded batch roster attendance",
            markedBy: editor,
          });
          attSeq += 1;
        }
      }

      const enrolled = existingCount + inserted.length;
      await Batch.updateOne(
        { _id: batch._id },
        {
          $set: {
            enrolledCount: enrolled,
            capacity: Math.max(40, enrolled + 5),
            updatedBy: editor,
          },
        }
      );
    }
  }

  // Bulk attendance (ignore duplicates)
  if (attendanceDocs.length) {
    const chunk = 200;
    for (let i = 0; i < attendanceDocs.length; i += chunk) {
      const slice = attendanceDocs.slice(i, i + chunk);
      try {
        const res = await Attendance.insertMany(slice, { ordered: false });
        attendanceUpserts += res.length;
      } catch (err) {
        // Duplicate key errors still insert the rest when ordered:false
        const n = err?.insertedDocs?.length || err?.result?.nInserted || 0;
        attendanceUpserts += n;
        if (!err?.writeErrors && !err?.code) throw err;
      }
    }
  }

  // Create fee ledgers + installments for any missing admissions
  let feesSynced = 0;
  try {
    const feeResult = await syncFeesFromAdmissions({ force: true });
    feesSynced = feeResult?.created || 0;
  } catch (err) {
    console.error("[batch-roster] fee sync failed:", err?.message || err);
  }

  return {
    batches: batches.length,
    batchesFilled,
    targetPerBatch: target,
    admissionsCreated,
    feesSynced,
    attendanceUpserts,
    message: `Seeded ${admissionsCreated} students across ${batches.length} batches (target ${target}/batch)`,
  };
}
