import { CaseStudyStripModel } from "../modules/caseStudy/caseStudy.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultCaseStudy = {
  sectionLabel: "Highlight",
  heading: "150% uplift in conversions for a marketplace within 90 days.",
  description:
    "By re-architecting the onboarding flow, speeding up the front-end and aligning landing messaging with real search intent, we helped a commerce brand unlock significantly better unit economics.",
  snapshotLabel: "Snapshot",
  metrics: [
    { value: "+150%", label: "Conversion rate" },
    { value: "-42%", label: "CAC" },
    { value: "90 days", label: "From kickoff to impact" },
  ],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedCaseStudyDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(CaseStudyStripModel, defaultCaseStudy, "demo case study strip");
    return;
  }

  const existing = await CaseStudyStripModel.countDocuments({ softDelete: false });
  if (existing > 0) return;
  await CaseStudyStripModel.create(defaultCaseStudy);
  console.log("Seeded demo case study strip");
}
