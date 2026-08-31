const UNIVERSITY_TYPES = [
  "State University",
  "Central University",
  "Private University",
  "Deemed University",
  "Open University",
  "ITI / SCVT",
  "Other",
];

function normalizeString(value = "") {
  return String(value || "").trim();
}

export function normalizeUniversityPayload(raw = {}) {
  return {
    name: normalizeString(raw.name),
    shortName: normalizeString(raw.shortName).toUpperCase(),
    universityCode: normalizeString(raw.universityCode).toUpperCase(),
    universityType: normalizeString(raw.universityType),
    establishedYear: normalizeString(raw.establishedYear),
    logo: normalizeString(raw.logo),

    registrationNumber: normalizeString(raw.registrationNumber).toUpperCase(),
    affiliationNumber: normalizeString(raw.affiliationNumber).toUpperCase(),
    affiliationAuthority: normalizeString(raw.affiliationAuthority),
    recognitionDetails: normalizeString(raw.recognitionDetails),

    address: normalizeString(raw.address),
    city: normalizeString(raw.city),
    district: normalizeString(raw.district),
    state: normalizeString(raw.state),
    pincode: normalizeString(raw.pincode),

    contactPerson: normalizeString(raw.contactPerson),
    contactPhone: normalizeString(raw.contactPhone),
    contactEmail: normalizeString(raw.contactEmail).toLowerCase(),
    website: normalizeString(raw.website),

    status: normalizeString(raw.status || "Active") || "Active",
    remarks: normalizeString(raw.remarks),
  };
}

export function validateUniversityPayload(payload) {
  if (!payload.name) return "University name is required";
  if (!payload.shortName) return "Short name is required";
  if (!payload.universityCode) return "University code is required";
  if (!payload.universityType) return "University type is required";
  if (!UNIVERSITY_TYPES.includes(payload.universityType)) {
    return "Select a valid university type";
  }
  if (!["Active", "Inactive", "Draft"].includes(payload.status)) {
    return "Status must be Active, Inactive, or Draft";
  }

  if (payload.establishedYear) {
    if (!/^\d{4}$/.test(payload.establishedYear)) {
      return "Established year must be a valid 4-digit year";
    }
    const year = Number(payload.establishedYear);
    const max = new Date().getFullYear() + 1;
    if (year < 1800 || year > max) {
      return "Established year must be a valid 4-digit year";
    }
  }

  if (payload.pincode && !/^\d{6}$/.test(payload.pincode)) {
    return "Pincode should be 6 digits";
  }

  if (payload.contactPhone) {
    const digits = payload.contactPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return "Enter a valid contact phone number";
    }
  }

  if (payload.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contactEmail)) {
    return "Enter a valid contact email";
  }

  if (payload.website) {
    try {
      const url = new URL(
        payload.website.includes("://") ? payload.website : `https://${payload.website}`
      );
      if (!url.hostname || !/\./.test(url.hostname)) {
        return "Official website should be a valid URL";
      }
    } catch {
      return "Official website should be a valid URL";
    }
  }

  return null;
}
