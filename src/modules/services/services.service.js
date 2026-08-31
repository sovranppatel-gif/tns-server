import { ServicesSection } from "./services.model.js";

export async function listServices({ search = "", page = 1, limit = 10 }) {
  const query = { softDelete: false };
  if (search) {
    query.$or = [
      { sectionBadgeLabel: { $regex: search, $options: "i" } },
      { heading: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    ServicesSection.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    ServicesSection.countDocuments(query),
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

export async function getActiveServices() {
  return ServicesSection.findOne({
    softDelete: false,
    isVisible: true,
    publishStatus: "published",
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
}

export async function createServices(payload) {
  return ServicesSection.create(payload);
}

export async function updateServices(id, payload) {
  return ServicesSection.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteServices(id, updatedBy) {
  return ServicesSection.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleServicesVisibility(id, updatedBy) {
  const doc = await ServicesSection.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleServicesPublish(id, updatedBy) {
  const doc = await ServicesSection.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
