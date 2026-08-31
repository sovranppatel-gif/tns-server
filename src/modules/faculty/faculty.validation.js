import mongoose from "mongoose";
import {
  ASSIGNMENT_STATUSES,
  EMPLOYMENT_TYPES,
  FACULTY_ATTENDANCE_METHODS,
  FACULTY_ATTENDANCE_STATUSES,
  FACULTY_GENDERS,
  FACULTY_PERMISSIONS,
  FACULTY_STATUSES,
  TIMETABLE_DAYS,
  TIMETABLE_STATUSES,
} from "./faculty.constants.js";

function str(value) {
  return String(value ?? "").trim();
}

function hasKey(raw, key) {
  return Boolean(raw) && Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;
}

export function asObjectId(value) {
  const raw = str(value);
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

export function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

function parseDate(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nested(raw, key) {
  return raw && typeof raw[key] === "object" && !Array.isArray(raw[key]) ? raw[key] : {};
}

export function subjectKeyOf(semester, subjectName, subjectCode) {
  const sem = Number(semester) || 0;
  const code = str(subjectCode).toUpperCase();
  const name = str(subjectName).toLowerCase();
  return `${sem}:${code || name}`;
}

export function normalizeFacultyPayload(raw = {}) {
  const personal = nested(raw, "personalDetails");
  const employment = nested(raw, "employmentDetails");
  const account = nested(raw, "accountDetails");

  const genderRaw = str(personal.gender || raw.gender);
  const statusRaw = str(raw.status);
  const empType = str(employment.employmentType || raw.employmentType);
  const perms = Array.isArray(raw.permissions)
    ? raw.permissions.map(str).filter((p) => FACULTY_PERMISSIONS.includes(p))
    : undefined;

  return {
    personalDetails: {
      fullName: str(personal.fullName || raw.fullName),
      profilePhoto: str(personal.profilePhoto || raw.profilePhoto),
      gender: FACULTY_GENDERS.includes(genderRaw) ? genderRaw : "Male",
      dateOfBirth: parseDate(personal.dateOfBirth || raw.dateOfBirth),
      fatherOrHusbandName: str(personal.fatherOrHusbandName || raw.fatherOrHusbandName),
      mobile: str(personal.mobile || raw.mobile).replace(/\D/g, "").slice(-10),
      alternateMobile: str(personal.alternateMobile || raw.alternateMobile).replace(/\D/g, "").slice(-10),
      email: str(personal.email || raw.email).toLowerCase(),
      address: str(personal.address || raw.address),
      city: str(personal.city || raw.city),
      state: str(personal.state || raw.state),
      pincode: str(personal.pincode || raw.pincode),
    },
    employmentDetails: {
      designation: str(employment.designation || raw.designation),
      department: str(employment.department || raw.department),
      qualification: str(employment.qualification || raw.qualification),
      specialization: str(employment.specialization || raw.specialization),
      experienceYears: parseNumber(employment.experienceYears ?? raw.experienceYears, 0),
      joiningDate: parseDate(employment.joiningDate || raw.joiningDate) || new Date(),
      employmentType: EMPLOYMENT_TYPES.includes(empType) ? empType : "Full Time",
    },
    accountDetails: {
      loginEnabled: Boolean(account.loginEnabled ?? raw.loginEnabled),
      username: str(account.username || raw.username).toLowerCase(),
    },
    password: str(raw.password || account.password),
    permissions: perms,
    status: FACULTY_STATUSES.includes(statusRaw) ? statusRaw : "Active",
  };
}

export function validateFacultyPayload(payload, { isCreate = false } = {}) {
  const p = payload.personalDetails || {};
  const e = payload.employmentDetails || {};
  if (!p.fullName) return "Full name is required";
  if (!p.mobile || !/^[6-9]\d{9}$/.test(p.mobile)) return "Enter a valid 10-digit mobile number";
  if (!p.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return "Enter a valid email address";
  if (!e.designation) return "Designation is required";
  if (payload.accountDetails?.loginEnabled) {
    if (isCreate && !payload.password) return "Password is required when faculty login is enabled";
    if (payload.password && payload.password.length < 6) return "Password must be at least 6 characters";
  }
  return null;
}

export function normalizeAssignmentPayload(raw = {}) {
  const semesterRaw = raw.semester ?? raw.termNumber;
  const semester =
    semesterRaw === "" || semesterRaw == null ? null : Math.round(Number(semesterRaw)) || null;
  const subjectName = str(raw.subjectName || raw.subject);
  const subjectCode = str(raw.subjectCode);
  return {
    universityId: asObjectId(raw.universityId),
    courseId: asObjectId(raw.courseId),
    batchId: asObjectId(raw.batchId),
    semester,
    subjectName,
    subjectCode,
    subjectKey: subjectKeyOf(semester, subjectName, subjectCode),
    academicYear: str(raw.academicYear),
    status: ASSIGNMENT_STATUSES.includes(str(raw.status)) ? str(raw.status) : "Active",
  };
}

export function validateAssignmentPayload(payload) {
  if (!payload.courseId) return "Course is required";
  if (!payload.subjectName) return "Subject is required";
  return null;
}

function parseTime(value) {
  const raw = str(value);
  if (!/^\d{2}:\d{2}$/.test(raw)) return "";
  const [hh, mm] = raw.split(":").map(Number);
  if (hh > 23 || mm > 59) return "";
  return raw;
}

export function timeToMinutes(value) {
  const [hh, mm] = str(value).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

export function normalizeTimetablePayload(raw = {}) {
  const day = str(raw.day);
  return {
    universityId: asObjectId(raw.universityId),
    courseId: asObjectId(raw.courseId),
    batchId: asObjectId(raw.batchId),
    assignmentId: asObjectId(raw.assignmentId),
    semester: raw.semester == null || raw.semester === "" ? null : Math.round(Number(raw.semester)) || null,
    subjectName: str(raw.subjectName || raw.subject),
    subjectCode: str(raw.subjectCode),
    day: TIMETABLE_DAYS.includes(day) ? day : "",
    startTime: parseTime(raw.startTime),
    endTime: parseTime(raw.endTime),
    room: str(raw.room),
    status: TIMETABLE_STATUSES.includes(str(raw.status)) ? str(raw.status) : "Active",
  };
}

export function validateTimetablePayload(payload) {
  if (!payload.courseId) return "Course is required";
  if (!payload.batchId) return "Batch is required";
  if (!payload.subjectName) return "Subject is required";
  if (!payload.day) return "Day is required";
  if (!payload.startTime || !payload.endTime) return "Start and end time are required";
  const start = timeToMinutes(payload.startTime);
  const end = timeToMinutes(payload.endTime);
  if (start == null || end == null || end <= start) return "End time must be after start time";
  return null;
}

export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function dayStart(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

export function normalizeAttendancePayload(raw = {}) {
  const status = str(raw.status);
  const method = str(raw.method);
  return {
    date: dayStart(raw.date),
    checkInTime: str(raw.checkInTime),
    checkOutTime: str(raw.checkOutTime),
    status: FACULTY_ATTENDANCE_STATUSES.includes(status) ? status : "Present",
    method: FACULTY_ATTENDANCE_METHODS.includes(method) ? method : "Manual",
    note: str(raw.note),
  };
}

export function hasKeyField(raw, key) {
  return hasKey(raw, key);
}
