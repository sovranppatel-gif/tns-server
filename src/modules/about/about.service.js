import { About } from "./about.model.js";

export async function listAbout({ search = "", page = 1, limit = 10 }) {
  const query = { softDelete: false };
  if (search) {
    query.$or = [
      { sectionLabel: { $regex: search, $options: "i" } },
      { heading: { $regex: search, $options: "i" } },
      { ctaText: { $regex: search, $options: "i" } },
      { ctaHighlightText: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    About.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    About.countDocuments(query),
  ]);

  return {
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getActiveAbout() {
  const doc = await About.findOne({
    softDelete: false,
    isVisible: true,
    publishStatus: "published",
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
  return doc;
}

export async function createAbout(payload) {
  return About.create(payload);
}

export async function updateAbout(id, payload) {
  return About.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteAbout(id, updatedBy) {
  return About.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleAboutVisibility(id, updatedBy) {
  const doc = await About.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleAboutPublish(id, updatedBy) {
  const doc = await About.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
