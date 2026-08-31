function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => ({
      label: normalizeString(step?.label),
      title: normalizeString(step?.title),
      desc: normalizeString(step?.desc),
    }))
    .filter((step) => step.label && step.title && step.desc);
}

export function normalizeProcessPayload(raw = {}) {
  return {
    sectionLabel: normalizeString(raw.sectionLabel),
    heading: normalizeString(raw.heading),
    description: normalizeString(raw.description),
    steps: normalizeSteps(raw.steps),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateProcessPayload(payload) {
  if (!payload.sectionLabel) return "Section label is required";
  if (!payload.heading) return "Heading is required";
  if (!payload.description) return "Description is required";
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    return "At least one process step is required";
  }
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  return null;
}
