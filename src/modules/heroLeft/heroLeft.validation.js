function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeBullets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => normalizeString(s)).filter(Boolean);
}

function normalizeAvatarUrls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => normalizeString(s))
    .filter(Boolean)
    .slice(0, 3);
}

export function normalizeHeroLeftPayload(raw = {}) {
  return {
    sectionLabel: normalizeString(raw.sectionLabel),
    badgeLabel: normalizeString(raw.badgeLabel),
    headlineLine1: normalizeString(raw.headlineLine1),
    headlineLine2: normalizeString(raw.headlineLine2),
    bodyParagraph1: normalizeString(raw.bodyParagraph1),
    highlightPhrase: normalizeString(raw.highlightPhrase),
    bodyParagraph2: normalizeString(raw.bodyParagraph2),
    bulletPoints: normalizeBullets(raw.bulletPoints),
    primaryCtaLabel: normalizeString(raw.primaryCtaLabel),
    primaryCtaHref: normalizeString(raw.primaryCtaHref || "#top") || "#top",
    secondaryCtaLabel: normalizeString(raw.secondaryCtaLabel),
    secondaryCtaPath: normalizeString(raw.secondaryCtaPath || "/building-creativity") || "/building-creativity",
    socialProofText: normalizeString(raw.socialProofText),
    socialProofAvatarUrls: normalizeAvatarUrls(raw.socialProofAvatarUrls),
    isVisible: raw.isVisible === undefined ? true : Boolean(raw.isVisible),
    publishStatus: normalizeString(raw.publishStatus || "draft").toLowerCase(),
    displayOrder: Number.isFinite(Number(raw.displayOrder)) ? Number(raw.displayOrder) : 1,
    softDelete: Boolean(raw.softDelete),
  };
}

export function validateHeroLeftPayload(payload) {
  if (!payload.sectionLabel) return "Section label is required";
  if (!payload.badgeLabel) return "Badge label is required";
  if (!payload.headlineLine1) return "Headline line 1 is required";
  if (!payload.headlineLine2) return "Headline line 2 is required";
  if (!payload.bodyParagraph1) return "Body paragraph 1 is required";
  if (!payload.bodyParagraph2) return "Body paragraph 2 is required";
  if (!Array.isArray(payload.bulletPoints) || payload.bulletPoints.length === 0) {
    return "At least one bullet point is required";
  }
  if (!payload.primaryCtaLabel) return "Primary CTA label is required";
  if (!payload.secondaryCtaLabel) return "Secondary CTA label is required";
  if (!payload.socialProofText) return "Social proof text is required";
  if (!["draft", "published"].includes(payload.publishStatus)) {
    return "Publish status must be draft or published";
  }
  if (!Number.isFinite(payload.displayOrder) || payload.displayOrder < 0) {
    return "Display order must be a valid non-negative number";
  }
  for (const u of payload.socialProofAvatarUrls) {
    if (u.length > 2048) return "Avatar URL is too long";
  }
  return null;
}
