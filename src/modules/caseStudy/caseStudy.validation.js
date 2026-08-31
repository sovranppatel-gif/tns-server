function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics)) return [];
  return metrics
    .map((m) => ({
      value: normalizeString(m?.value),
      label: normalizeString(m?.label),
    }))
    .filter((m) => m.value && m.label);
}

export function normalizeCaseStudyPayload(raw = {}) {
  return {
    sectionLabel: normalizeString(raw.sectionLabel),
    heading: normalizeString(raw.heading),
    description: normalizeString(raw.description),
    snapshotLabel: normalizeString(raw.snapshotLabel || "Snapshot"),
    metrics: normalizeMetrics(raw.metrics),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateCaseStudyPayload(payload) {
  if (!payload.sectionLabel) return "Section label is required";
  if (!payload.heading) return "Heading is required";
  if (!payload.description) return "Description is required";
  if (!Array.isArray(payload.metrics) || payload.metrics.length === 0) {
    return "At least one metric is required";
  }
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  return null;
}
