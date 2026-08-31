import { CaseStudyStripModel } from "./caseStudy.model.js";

export async function listCaseStudy({ search = "", page = 1, limit = 10 }) {
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
    CaseStudyStripModel.find(query).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    CaseStudyStripModel.countDocuments(query),
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

export async function getActiveCaseStudy() {
  return CaseStudyStripModel.findOne({
    softDelete: false,
    isVisible: true,
    publishStatus: "published",
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
}

export async function createCaseStudy(payload) {
  return CaseStudyStripModel.create(payload);
}

export async function updateCaseStudy(id, payload) {
  return CaseStudyStripModel.findOneAndUpdate({ _id: id, softDelete: false }, payload, { new: true });
}

export async function softDeleteCaseStudy(id, updatedBy) {
  return CaseStudyStripModel.findOneAndUpdate(
    { _id: id, softDelete: false },
    { softDelete: true, updatedBy },
    { new: true }
  );
}

export async function toggleCaseStudyVisibility(id, updatedBy) {
  const doc = await CaseStudyStripModel.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.isVisible = !doc.isVisible;
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}

export async function toggleCaseStudyPublish(id, updatedBy) {
  const doc = await CaseStudyStripModel.findOne({ _id: id, softDelete: false });
  if (!doc) return null;
  doc.publishStatus = doc.publishStatus === "published" ? "draft" : "published";
  doc.updatedBy = updatedBy;
  await doc.save();
  return doc;
}
