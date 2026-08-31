import { FaqSectionModel } from "./faq.model.js";

export async function listFaq({ search = "", page = 1, limit = 10 }) {
  const query = { softDelete: false };
  if (search) {
    query.$or = [
      { sectionLabel: { $regex: search, $options: "i" } },
      { heading: { $regex: search, $options: "i" } },
      { "items.question": { $regex: search, $options: "i" } },
    ];
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    FaqSectionModel.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    FaqSectionModel.countDocuments(query),
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

export async function getActiveFaq() {
  return FaqSectionModel.findOne({
    softDelete: false,
    isVisible: true,
    publishStatus: "published",
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
}

export async function createFaq(payload) {
  return FaqSectionModel.create(payload);
}

export async function updateFaq(id, payload) {
  return FaqSectionModel.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteFaq(id, updatedBy) {
  return FaqSectionModel.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleFaqVisibility(id, updatedBy) {
  const doc = await FaqSectionModel.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleFaqPublish(id, updatedBy) {
  const doc = await FaqSectionModel.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
