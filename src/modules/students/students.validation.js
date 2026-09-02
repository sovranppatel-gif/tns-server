import {
  STUDENT_CATEGORIES,
  STUDENT_DOCUMENT_TYPES,
  STUDENT_GENDERS,
  STUDENT_STATUSES,
} from "./students.model.js";

function str(value) {
  return String(value ?? "").trim();
}

function oidOrEmpty(value) {
  const raw = str(value);
  if (!raw || raw === "institute-gst") return "";
  return raw;
}

function hasKey(raw, key) {
  return Boolean(raw) && Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined;
}

function optionalOid(raw, key) {
  if (!hasKey(raw, key)) return undefined;
  return oidOrEmpty(raw[key]);
}

function parseTerm(raw = {}) {
  const type = str(raw?.currentTerm?.type || raw?.termType);
  const numRaw = raw?.currentTerm?.number ?? raw?.termNumber;
  if (numRaw === "" || numRaw == null) {
    return { type, number: null };
  }
  const n = Number(numRaw);
  if (!Number.isFinite(n) || n <= 0) return { type, number: null };
  return { type, number: Math.round(n) };
}

function parseDate(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeContact(raw = {}) {
  const nested = raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  return {
    mobile: str(nested.mobile || raw.mobile || raw.phone || raw.studentMobile),
    alternateMobile: str(nested.alternateMobile || raw.alternateMobile || raw.contactNo),
    email: str(nested.email || raw.email).toLowerCase(),
  };
}

function normalizeAddress(raw = {}) {
  const nested = raw.address && typeof raw.address === "object" ? raw.address : {};
  return {
    permanent: str(nested.permanent || raw.permanentAddress || raw.permanent),
    correspondence: str(
      nested.correspondence || raw.correspondenceAddress || raw.homeAddress || raw.correspondence
    ),
    village: str(nested.village || raw.village),
    post: str(nested.post || raw.post),
    tehsil: str(nested.tehsil || raw.tehsil),
    district: str(nested.district || raw.city || raw.district),
    state: str(nested.state || raw.state),
    pinCode: str(nested.pinCode || nested.pincode || raw.pinCode || raw.pincode),
  };
}

function normalizeGuardian(raw = {}) {
  const nested = raw.guardian && typeof raw.guardian === "object" ? raw.guardian : {};
  return {
    name: str(nested.name || raw.guardianName).toUpperCase(),
    relation: str(nested.relation || raw.relation),
    mobile: str(nested.mobile || raw.guardianMobile),
    address: str(nested.address || raw.guardianAddress),
  };
}

function normalizeDocuments(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.documents) ? raw.documents : [];
  return list
    .map((doc) => {
      const documentType = str(doc.documentType || doc.type || "Other") || "Other";
      return {
        ...(doc._id ? { _id: doc._id } : {}),
        documentType: STUDENT_DOCUMENT_TYPES.includes(documentType)
          ? documentType
          : "Other",
        documentName: str(doc.documentName || doc.name),
        documentUrl: str(doc.documentUrl || doc.url),
        documentNumber: str(doc.documentNumber || doc.number),
        verified: Boolean(doc.verified),
        verifiedBy: str(doc.verifiedBy),
        verifiedAt: parseDate(doc.verifiedAt),
      };
    })
    .filter((doc) => doc.documentUrl || doc.documentName || doc.documentNumber);
}

function optionalUpper(raw, key) {
  if (!hasKey(raw, key)) return undefined;
  return str(raw[key]).toUpperCase();
}

export function normalizeStudentPayload(raw = {}) {
  const currentTerm = parseTerm(raw);
  const gender = hasKey(raw, "gender") ? str(raw.gender) : undefined;
  const maritalStatus = hasKey(raw, "maritalStatus") ? str(raw.maritalStatus) : undefined;
  const statusRaw = hasKey(raw, "status") ? str(raw.status) : undefined;

  const payload = {
    admissionId: hasKey(raw, "admissionId") ? str(raw.admissionId) : undefined,
    admissionMongoId: optionalOid(raw, "admissionMongoId") ?? optionalOid(raw, "admission_id"),
    universityId: optionalOid(raw, "universityId"),
    courseId: optionalOid(raw, "courseId"),
    batchId: optionalOid(raw, "batchId"),
    session: hasKey(raw, "session") ? str(raw.session) : undefined,
    currentTerm:
      hasKey(raw, "currentTerm") || hasKey(raw, "termType") || hasKey(raw, "termNumber")
        ? currentTerm
        : undefined,
    nameEnglish:
      hasKey(raw, "nameEnglish") || hasKey(raw, "applicant") || hasKey(raw, "name")
        ? str(raw.nameEnglish || raw.applicant || raw.name).toUpperCase()
        : undefined,
    nameHindi: hasKey(raw, "nameHindi") ? str(raw.nameHindi) : undefined,
    fatherName: optionalUpper(raw, "fatherName"),
    motherName: optionalUpper(raw, "motherName"),
    dateOfBirth: hasKey(raw, "dateOfBirth") ? str(raw.dateOfBirth) : undefined,
    gender,
    category: hasKey(raw, "category") ? str(raw.category) : undefined,
    samagraId: hasKey(raw, "samagraId") ? str(raw.samagraId) : undefined,
    casteCertificateNo: hasKey(raw, "casteCertificateNo") ? str(raw.casteCertificateNo) : undefined,
    maritalStatus,
    husbandName:
      gender === "Female" && maritalStatus === "Married"
        ? str(raw.husbandName).toUpperCase()
        : hasKey(raw, "husbandName")
          ? str(raw.husbandName).toUpperCase()
          : undefined,
    status:
      statusRaw && STUDENT_STATUSES.includes(statusRaw)
        ? statusRaw
        : statusRaw
          ? "Active"
          : undefined,
  };

  const hasContact =
    hasKey(raw, "contact") ||
    hasKey(raw, "mobile") ||
    hasKey(raw, "phone") ||
    hasKey(raw, "email") ||
    hasKey(raw, "studentMobile") ||
    hasKey(raw, "alternateMobile");
  if (hasContact) payload.contact = normalizeContact(raw);

  const hasAddress =
    hasKey(raw, "address") ||
    hasKey(raw, "permanentAddress") ||
    hasKey(raw, "village") ||
    hasKey(raw, "district") ||
    hasKey(raw, "state");
  if (hasAddress) payload.address = normalizeAddress(raw);

  const hasGuardian =
    hasKey(raw, "guardian") || hasKey(raw, "guardianName") || hasKey(raw, "guardianMobile");
  if (hasGuardian) payload.guardian = normalizeGuardian(raw);

  if (Array.isArray(raw.education)) payload.education = raw.education;
  if (raw.admissionDetails && typeof raw.admissionDetails === "object") {
    payload.admissionDetails = raw.admissionDetails;
  }
  if (hasKey(raw, "photo") || hasKey(raw, "photoPreview")) {
    payload.photo = typeof raw.photo === "string" ? raw.photo : str(raw.photoPreview);
  }
  if (Array.isArray(raw.documents)) payload.documents = normalizeDocuments(raw.documents);

  const admissionDate = parseDate(raw.admissionDate);
  if (admissionDate) payload.admissionDate = admissionDate;

  const joiningDate = parseDate(raw.joiningDate);
  if (joiningDate) payload.joiningDate = joiningDate;

  return payload;
}

export function validateStudentPayload(payload, { isCreate = false } = {}) {
  if (isCreate && !payload.nameEnglish) return "Student name is required";
  if (payload.gender && !STUDENT_GENDERS.includes(payload.gender) && payload.gender !== "") {
    return "Select a valid gender";
  }
  if (payload.category && !STUDENT_CATEGORIES.includes(payload.category) && payload.category !== "") {
    return "Select a valid category";
  }
  if (payload.status && !STUDENT_STATUSES.includes(payload.status)) {
    return "Select a valid student status";
  }
  if (payload.contact?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact.email)) {
    return "Enter a valid email address";
  }
  return null;
}

export function normalizeStatus(value) {
  const status = str(value);
  return STUDENT_STATUSES.includes(status) ? status : "";
}

export function normalizeBatchAssignPayload(raw = {}) {
  return {
    universityId: oidOrEmpty(raw.universityId),
    courseId: oidOrEmpty(raw.courseId),
    batchId: oidOrEmpty(raw.batchId),
    session: str(raw.session),
    joiningDate: parseDate(raw.joiningDate) || new Date(),
    currentTerm: parseTerm(raw),
  };
}
