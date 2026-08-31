import mongoose from "mongoose";
import {
  STAFF_EMPLOYMENT_TYPES,
  STAFF_GENDERS,
  STAFF_STATUSES,
  STAFF_WEEKLY_OFFS,
  dutyMinutes,
} from "./staff.constants.js";

function str(value) {
  return String(value ?? "").trim();
}

function nested(raw, key) {
  return raw && typeof raw[key] === "object" && !Array.isArray(raw[key]) ? raw[key] : {};
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

function parseTime(value) {
  const raw = str(value);
  if (!raw) return "";
  if (!/^\d{2}:\d{2}$/.test(raw)) return "";
  const [hh, mm] = raw.split(":").map(Number);
  if (hh > 23 || mm > 59) return "";
  return raw;
}

function digits(value, len = 10) {
  return str(value).replace(/\D/g, "").slice(-len);
}

export function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

export function asObjectId(value) {
  const raw = str(value);
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

export function normalizeStaffPayload(raw = {}) {
  const personal = nested(raw, "personalDetails");
  const employment = nested(raw, "employmentDetails");
  const emergency = nested(raw, "emergencyContact");

  const genderRaw = str(personal.gender || raw.gender);
  const statusRaw = str(raw.status);
  const empType = str(employment.employmentType || raw.employmentType);
  const weeklyOff = str(employment.weeklyOff || raw.weeklyOff);

  return {
    personalDetails: {
      fullName: str(personal.fullName || raw.fullName),
      profilePhoto: str(personal.profilePhoto || raw.profilePhoto),
      gender: STAFF_GENDERS.includes(genderRaw) ? genderRaw : "Male",
      dateOfBirth: parseDate(personal.dateOfBirth || raw.dateOfBirth),
      fatherOrHusbandName: str(personal.fatherOrHusbandName || raw.fatherOrHusbandName),
      mobile: digits(personal.mobile || raw.mobile),
      alternateMobile: digits(personal.alternateMobile || raw.alternateMobile),
      email: str(personal.email || raw.email).toLowerCase(),
      address: str(personal.address || raw.address),
      city: str(personal.city || raw.city),
      state: str(personal.state || raw.state),
      pincode: str(personal.pincode || raw.pincode),
    },
    employmentDetails: {
      designation: str(employment.designation || raw.designation),
      designationId: str(employment.designationId || raw.designationId),
      department: str(employment.department || raw.department),
      departmentId: str(employment.departmentId || raw.departmentId),
      staffCategory: str(employment.staffCategory || raw.staffCategory) || "Administration",
      staffCategoryId: str(employment.staffCategoryId || raw.staffCategoryId),
      shift: str(employment.shift || raw.shift) || "Full Day",
      shiftId: str(employment.shiftId || raw.shiftId),
      dutyStart: parseTime(employment.dutyStart || raw.dutyStart),
      dutyEnd: parseTime(employment.dutyEnd || raw.dutyEnd),
      weeklyOff: STAFF_WEEKLY_OFFS.includes(weeklyOff) ? weeklyOff : weeklyOff || "Sunday",
      reportingTo: str(employment.reportingTo || raw.reportingTo),
      qualification: str(employment.qualification || raw.qualification),
      experienceYears: Math.max(0, parseNumber(employment.experienceYears ?? raw.experienceYears, 0)),
      joiningDate: parseDate(employment.joiningDate || raw.joiningDate) || new Date(),
      employmentType: STAFF_EMPLOYMENT_TYPES.includes(empType) ? empType : "Full Time",
      monthlySalary: Math.max(0, parseNumber(employment.monthlySalary ?? raw.monthlySalary, 0)),
    },
    emergencyContact: {
      name: str(emergency.name || raw.emergencyName),
      relation: str(emergency.relation || raw.emergencyRelation),
      phone: digits(emergency.phone || raw.emergencyPhone),
    },
    notes: str(raw.notes),
    status: STAFF_STATUSES.includes(statusRaw) ? statusRaw : "Active",
  };
}

export function validateStaffPayload(payload) {
  const p = payload.personalDetails || {};
  const e = payload.employmentDetails || {};
  if (!p.fullName) return "Full name is required";
  if (!p.mobile || !/^[6-9]\d{9}$/.test(p.mobile)) return "Enter a valid 10-digit mobile number";
  if (p.alternateMobile && !/^[6-9]\d{9}$/.test(p.alternateMobile)) {
    return "Enter a valid alternate mobile number";
  }
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return "Enter a valid email address";
  if (!e.designation) return "Designation is required";
  if (e.monthlySalary < 0) return "Salary cannot be negative";
  if (e.dutyStart && e.dutyEnd && dutyMinutes(e.dutyStart, e.dutyEnd) <= 0) {
    return "Duty hours must be greater than zero";
  }
  if (payload.emergencyContact?.phone && !/^[6-9]\d{9}$/.test(payload.emergencyContact.phone)) {
    return "Enter a valid emergency contact number";
  }
  return null;
}

export function normalizeLookupPayload(raw = {}, kind = "generic") {
  const name = str(raw.name);
  const base = {
    name,
    description: str(raw.description),
    status: raw.status === "Inactive" ? "Inactive" : "Active",
  };
  if (kind === "department") {
    return { ...base, code: str(raw.code).toUpperCase() };
  }
  if (kind === "designation") {
    return { ...base, department: str(raw.department) };
  }
  if (kind === "shift") {
    const startTime = parseTime(raw.startTime);
    const endTime = parseTime(raw.endTime);
    const breakMinutes = Math.max(0, parseNumber(raw.breakMinutes ?? raw.breakDuration, 0));
    return {
      ...base,
      startTime,
      endTime,
      breakMinutes,
    };
  }
  return base;
}

export function validateLookupPayload(payload, kind = "generic") {
  if (!payload.name) return "Name is required";
  if (kind === "shift" && payload.startTime && payload.endTime && dutyMinutes(payload.startTime, payload.endTime) <= 0) {
    return "Shift end time must create a valid working window";
  }
  return null;
}
