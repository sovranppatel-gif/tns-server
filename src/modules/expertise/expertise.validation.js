function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      iconKey: normalizeString(item?.iconKey || "Code"),
      title: normalizeString(item?.title),
      desc: normalizeString(item?.desc),
    }))
    .filter((item) => item.title && item.desc);
}

export function normalizeExpertisePayload(raw = {}) {
  return {
    sectionLabel: normalizeString(raw.sectionLabel),
    heading: normalizeString(raw.heading),
    description: normalizeString(raw.description),
    items: normalizeItems(raw.items),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateExpertisePayload(payload) {
  if (!payload.sectionLabel) return "Section label is required";
  if (!payload.heading) return "Heading is required";
  if (!payload.description) return "Description is required";
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return "At least one expertise item is required";
  }
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  return null;
}
