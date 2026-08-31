function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.map((f) => normalizeString(typeof f === "string" ? f : f?.text)).filter(Boolean);
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      iconKey: normalizeString(item?.iconKey || "Code"),
      title: normalizeString(item?.title),
      desc: normalizeString(item?.desc),
      features: normalizeFeatures(item?.features),
    }))
    .filter((item) => item.title && item.desc);
}

export function normalizeServicesPayload(raw = {}) {
  return {
    sectionBadgeLabel: normalizeString(raw.sectionBadgeLabel),
    heading: normalizeString(raw.heading),
    description: normalizeString(raw.description),
    ctaLabel: normalizeString(raw.ctaLabel || "Explore this service"),
    items: normalizeItems(raw.items),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateServicesPayload(payload) {
  if (!payload.sectionBadgeLabel) return "Section badge label is required";
  if (!payload.heading) return "Heading is required";
  if (!payload.description) return "Description is required";
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return "At least one service item is required";
  }
  for (const item of payload.items) {
    if (!item.features?.length) return "Each service item needs at least one feature";
  }
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  return null;
}
