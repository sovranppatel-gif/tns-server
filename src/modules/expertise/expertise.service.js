import { Expertise } from "./expertise.model.js";

export async function listExpertise({ search = "", page = 1, limit = 10 }) {
  const query = { softDelete: false };
  if (search) {
    query.$or = [
      { sectionLabel: { $regex: search, $options: "i" } },
      { heading: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    Expertise.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Expertise.countDocuments(query),
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

export async function getActiveExpertise() {
  return Expertise.findOne({
    softDelete: false,
    isVisible: true,
    publishStatus: "published",
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
}

export async function createExpertise(payload) {
  return Expertise.create(payload);
}

export async function updateExpertise(id, payload) {
  return Expertise.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteExpertise(id, updatedBy) {
  return Expertise.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleExpertiseVisibility(id, updatedBy) {
  const doc = await Expertise.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleExpertisePublish(id, updatedBy) {
  const doc = await Expertise.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
