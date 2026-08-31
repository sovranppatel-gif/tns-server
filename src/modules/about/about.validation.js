function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeStats(stats) {
  if (!Array.isArray(stats)) return [];
  return stats
    .map((item) => ({
      value: normalizeString(item?.value),
      label: normalizeString(item?.label),
    }))
    .filter((item) => item.value && item.label);
}

export function normalizeAboutPayload(raw = {}) {
  return {
    sectionLabel: normalizeString(raw.sectionLabel),
    heading: normalizeString(raw.heading),
    descriptionOne: normalizeString(raw.descriptionOne),
    descriptionTwo: normalizeString(raw.descriptionTwo),
    stats: normalizeStats(raw.stats),
    ctaText: normalizeString(raw.ctaText),
    ctaHighlightText: normalizeString(raw.ctaHighlightText),
    imageUrl: normalizeString(raw.imageUrl),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateAboutPayload(payload) {
  if (!payload.sectionLabel) return "Section label is required";
  if (!payload.heading) return "Heading is required";
  if (!payload.descriptionOne) return "Description one is required";
  if (!Array.isArray(payload.stats) || payload.stats.length === 0) {
    return "At least one stat is required";
  }
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  return null;
}
