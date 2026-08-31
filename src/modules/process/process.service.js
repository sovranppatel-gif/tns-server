import { Process } from "./process.model.js";

export async function listProcess({ search = "", page = 1, limit = 10 }) {
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
    Process.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Process.countDocuments(query),
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

export async function getActiveProcess() {
  return Process.findOne({ softDelete: false, isVisible: true, publishStatus: "published" })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
}

export async function createProcess(payload) {
  return Process.create(payload);
}

export async function updateProcess(id, payload) {
  return Process.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteProcess(id, updatedBy) {
  return Process.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleProcessVisibility(id, updatedBy) {
  const doc = await Process.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleProcessPublish(id, updatedBy) {
  const doc = await Process.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
