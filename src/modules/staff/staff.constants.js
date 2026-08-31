export const STAFF_STATUSES = ["Active", "On Leave", "Inactive"];

export const STAFF_GENDERS = ["Male", "Female", "Other"];

export const STAFF_EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Contract", "Temporary"];

export const STAFF_SHIFTS = [
  "Morning",
  "Afternoon",
  "Evening",
  "Full Day",
  "Rotational",
  "Custom",
];

export const STAFF_WEEKLY_OFFS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Rotational",
];

export const STAFF_CATEGORIES = [
  "Administration",
  "Accounts & Finance",
  "Admissions & Counseling",
  "Reception & Front Desk",
  "Operations",
  "IT & Technical Support",
  "Security",
  "Transport",
  "Facilities & Maintenance",
  "Housekeeping",
];

export const STAFF_DESIGNATIONS = [
  "Receptionist",
  "Accountant",
  "Accounts Executive",
  "Admission Counselor",
  "Office Executive",
  "Office Assistant",
  "Administrator",
  "Data Entry Operator",
  "IT Support Executive",
  "Security Guard",
  "Driver",
  "Housekeeping Staff",
  "Peon",
  "Maintenance Staff",
];

export const STAFF_DEPARTMENTS = [
  "Administration",
  "Accounts",
  "Admissions",
  "Reception",
  "Operations",
  "IT Support",
  "Security",
  "Transport",
  "Maintenance",
  "Housekeeping",
];

export const DEFAULT_STAFF_SHIFTS = [
  {
    name: "Morning",
    startTime: "09:00",
    endTime: "13:00",
    breakMinutes: 0,
    description: "Morning duty window",
  },
  {
    name: "Afternoon",
    startTime: "13:00",
    endTime: "17:00",
    breakMinutes: 0,
    description: "Afternoon duty window",
  },
  {
    name: "Evening",
    startTime: "17:00",
    endTime: "21:00",
    breakMinutes: 0,
    description: "Evening duty window",
  },
  {
    name: "Full Day",
    startTime: "09:30",
    endTime: "17:30",
    breakMinutes: 30,
    description: "Standard office hours",
  },
  {
    name: "Rotational",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    description: "Rotating duty roster",
  },
];

export const STAFF_ID_PREFIX = "TNS-STF-";

export function dutyMinutes(start, end) {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function dutyDurationLabel(start, end, breakMinutes = 0) {
  const mins = dutyMinutes(start, end) - (Number(breakMinutes) || 0);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!m) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
}

export function workingHoursValue(start, end, breakMinutes = 0) {
  const mins = dutyMinutes(start, end) - (Number(breakMinutes) || 0);
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  return Math.round((mins / 60) * 100) / 100;
}
