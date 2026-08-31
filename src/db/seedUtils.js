export async function upsertDemoSection(Model, defaults, label) {
  const existing = await Model.findOne({
    softDelete: false,
    $or: [{ createdBy: "system-seed" }, { publishStatus: "published" }],
  })
    .sort({ displayOrder: 1, createdAt: 1 })
    .select("_id");

  if (existing) {
    await Model.findByIdAndUpdate(existing._id, { $set: defaults });
    console.log(`Updated ${label}`);
    return;
  }

  await Model.create(defaults);
  console.log(`Seeded ${label}`);
}
