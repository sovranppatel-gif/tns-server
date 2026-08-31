export const COURSE_TYPES = ["University", "ITI / SCVT", "Institute"];
export const STRUCTURE_TYPES = ["Semester", "Year", "Single Level"];
export const COURSE_CATEGORIES = [
  "Degree",
  "Diploma",
  "PG Diploma",
  "Certificate",
  "Training",
  "ITI",
  "Other",
];
export const SUBJECT_TYPES = [
  "Theory",
  "Practical",
  "Theory + Practical",
  "Project",
  "Internship",
  "Elective",
];

function normalizeString(value = "") {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMoneyNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const raw = String(value ?? "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!raw || /as\s*per/i.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

export function getTermLabel(structureType, number) {
  const n = toNumber(number, 1);
  if (structureType === "Year") return `Year ${n}`;
  if (structureType === "Single Level") return `Level ${n}`;
  return `Semester ${n}`;
}

function requiresAuthority(type) {
  return type === "University" || type === "ITI / SCVT";
}

function normalizeSubjects(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = normalizeString(item.name);
      if (!name) return null;
      const subjectType = normalizeString(item.subjectType || "Theory") || "Theory";
      return {
        name,
        code: normalizeString(item.code).toUpperCase(),
        subjectType: SUBJECT_TYPES.includes(subjectType) ? subjectType : "Theory",
        theoryHours: toNumber(item.theoryHours, 0),
        practicalHours: toNumber(item.practicalHours, 0),
        credits: toNumber(item.credits, 0),
        maxMarks: toNumber(item.maxMarks, 0),
        passingMarks: toNumber(item.passingMarks, 0),
        theoryMarks: toNumber(item.theoryMarks, 0),
        practicalMarks: toNumber(item.practicalMarks, 0),
        internalMarks: toNumber(item.internalMarks, 0),
        externalMarks: toNumber(item.externalMarks, 0),
      };
    })
    .filter(Boolean);
}

function normalizeSemesters(raw, structureType = "Semester") {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const number = toNumber(item.number, index + 1);
      if (number < 1) return null;
      const subjects = normalizeSubjects(item.subjects);
      return {
        number,
        title: normalizeString(item.title) || getTermLabel(structureType, number),
        durationMonths: toNumber(item.durationMonths, 0),
        description: normalizeString(item.description),
        subjects,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

function normalizeHighlights(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      return raw
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }
  return raw.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeInstallments(raw, allowed) {
  if (!allowed || !Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const amount = toMoneyNumber(item.amount, 0);
      const dueLabel = normalizeString(item.dueLabel);
      if (!amount && !dueLabel) return null;
      return {
        number: toNumber(item.number, index + 1) || index + 1,
        amount,
        dueLabel,
        dueDays: Math.max(0, toNumber(item.dueDays, 0)),
      };
    })
    .filter(Boolean);
}

function normalizeSemesterFees(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const termNumber = toNumber(item.termNumber, index + 1);
      if (termNumber < 1) return null;
      const tuition = toMoneyNumber(item.tuition, 0);
      const registration = toMoneyNumber(item.registration, 0);
      const exam = toMoneyNumber(item.exam, 0);
      const other = toMoneyNumber(item.other, 0);
      const computed = tuition + registration + exam + other;
      const total = toMoneyNumber(item.total, computed) || computed;
      if (!computed && !total) return null;
      return {
        termNumber,
        tuition,
        registration,
        exam,
        other,
        total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.termNumber - b.termNumber);
}

function normalizeFeeString(value) {
  return normalizeString(value);
}

function overallTotalFromTerms(semesterFees, fallback) {
  const sum = (Array.isArray(semesterFees) ? semesterFees : []).reduce(
    (acc, row) => acc + toMoneyNumber(row.total, 0),
    0
  );
  if (sum > 0) return String(sum);
  return fallback;
}

function normalizeFees(raw = {}, structureType = "Semester") {
  const src = raw && typeof raw === "object" ? raw : {};
  const installmentAllowed =
    typeof src.installmentAllowed === "boolean" ? src.installmentAllowed : true;
  const semesterFees =
    structureType === "Single Level" ? [] : normalizeSemesterFees(src.semesterFees);
  const total = overallTotalFromTerms(semesterFees, normalizeFeeString(src.total));

  return {
    total,
    registration: normalizeFeeString(src.registration),
    exam: normalizeFeeString(src.exam),
    tuition: normalizeFeeString(src.tuition),
    other: normalizeFeeString(src.other),
    installmentAllowed,
    installments: normalizeInstallments(src.installments, installmentAllowed),
    semesterFees,
  };
}

function normalizeEligibilityDetails(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    qualification: normalizeString(src.qualification),
    minimumPercentage: normalizeString(src.minimumPercentage),
    stream: normalizeString(src.stream),
    ageLimit: normalizeString(src.ageLimit),
    other: normalizeString(src.other),
  };
}

function buildDurationLabel(months, explicit = "", structureType = "Semester", termCount = 0) {
  const label = normalizeString(explicit);
  if (label) return label;
  const m = toNumber(months, 0);
  if (m <= 0) return "";
  if (structureType === "Year" && termCount) {
    return `${termCount} year${termCount === 1 ? "" : "s"}`;
  }
  if (m === 12) return "1 year";
  if (m === 6) return "6 months";
  if (m % 12 === 0) return `${m / 12} years`;
  return `${m} months`;
}

export function normalizeCoursePayload(raw = {}) {
  const type = normalizeString(raw.type || "University") || "University";
  const structureType =
    normalizeString(raw.structureType || "Semester") || "Semester";
  const semesters =
    structureType === "Single Level"
      ? normalizeSemesters(raw.semesters, structureType).slice(0, 1)
      : normalizeSemesters(raw.semesters, structureType);
  const durationMonths = toNumber(raw.durationMonths, 6);
  const semesterCount =
    structureType === "Single Level"
      ? 0
      : toNumber(raw.semesterCount, 0) || semesters.length || 0;

  return {
    name: normalizeString(raw.name),
    code: normalizeString(raw.code).toUpperCase(),
    type,
    universityId: requiresAuthority(type) && raw.universityId ? String(raw.universityId) : null,
    universityName: normalizeString(raw.universityName),
    universityShortName: normalizeString(raw.universityShortName).toUpperCase(),
    category: normalizeString(raw.category || "Diploma") || "Diploma",
    structureType,
    durationMonths,
    durationLabel: buildDurationLabel(
      durationMonths,
      raw.durationLabel,
      structureType,
      semesterCount
    ),
    semesterCount,
    semesters,
    fees: normalizeFees(raw.fees, structureType),
    eligibility: normalizeString(raw.eligibility),
    eligibilityDetails: normalizeEligibilityDetails(raw.eligibilityDetails),
    mode: normalizeString(raw.mode || "Offline") || "Offline",
    description: normalizeString(raw.description),
    highlights: normalizeHighlights(raw.highlights),
    status: normalizeString(raw.status || "Active") || "Active",
    remarks: normalizeString(raw.remarks),
  };
}

export function validateCoursePayload(payload) {
  if (!payload.name) return "Course name is required";
  if (!payload.code) return "Course code is required";
  if (!COURSE_TYPES.includes(payload.type)) {
    return "Type must be University, ITI / SCVT, or Institute";
  }
  if (!STRUCTURE_TYPES.includes(payload.structureType)) {
    return "Structure type must be Semester, Year, or Single Level";
  }
  if (payload.type === "University" && !payload.universityId) {
    return "University is required for university courses";
  }
  if (payload.type === "ITI / SCVT" && !payload.universityId) {
    return "Select an ITI / SCVT authority for this course";
  }
  if (!COURSE_CATEGORIES.includes(payload.category)) {
    return "Invalid course category";
  }
  if (!["Offline", "Online", "Hybrid"].includes(payload.mode)) {
    return "Mode must be Offline, Online, or Hybrid";
  }
  if (!["Active", "Inactive", "Draft"].includes(payload.status)) {
    return "Status must be Active, Inactive, or Draft";
  }
  if (payload.durationMonths < 0) return "Duration months cannot be negative";
  if (payload.semesterCount < 0) return "Semester count cannot be negative";
  for (const sem of payload.semesters) {
    if (!sem.number) return "Each semester/year needs a number";
    for (const subject of sem.subjects) {
      if (!subject.name) return "Each subject must have a name";
    }
  }
  return null;
}
