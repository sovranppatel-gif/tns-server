import { LEAD_SOURCES, LEAD_STATUSES } from "./leads.model.js";

function normalizeString(value = "", max = 300) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizePhone(value = "") {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(-10);
}

function normalizeFollowUp(value) {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export function normalizeLeadPayload(raw = {}) {
  const source = normalizeString(raw.source, 80) || "Website";
  const followUp = normalizeFollowUp(raw.followUp);

  return {
    name: normalizeString(raw.name, 120),
    phone: normalizePhone(raw.phone),
    email: normalizeString(raw.email, 200).toLowerCase(),
    source,
    sourceOther:
      source === "Others" ? normalizeString(raw.sourceOther, 200) : "",
    interest: normalizeString(raw.interest, 150),
    counsellor: normalizeString(raw.counsellor, 120) || "Unassigned",
    followUp,
    status: normalizeString(raw.status, 40) || "New",
    notes: normalizeString(raw.notes, 2000),
    enquiryId: raw.enquiryId ? String(raw.enquiryId).trim() : null,
  };
}

export function validateLeadPayload(payload) {
  if (!payload.name) return "Lead name is required";
  if (!payload.phone || payload.phone.length !== 10) {
    return "Enter a valid 10-digit mobile number";
  }
  if (!LEAD_SOURCES.includes(payload.source)) {
    return "Please select a valid lead source";
  }
  if (payload.source === "Others" && !payload.sourceOther) {
    return "Please specify the source when Others is selected";
  }
  if (!LEAD_STATUSES.includes(payload.status)) {
    return "Please select a valid lead status";
  }
  if (payload.followUp === undefined) {
    return "Invalid follow-up date";
  }
  if (payload.email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
    if (!ok) return "Enter a valid email address";
  }
  return null;
}
