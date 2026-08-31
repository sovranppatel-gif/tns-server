import { Process } from "../modules/process/process.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultProcess = {
  sectionLabel: "How we work",
  heading: "A calm, transparent delivery process.",
  description:
    "No chaos, no guessing. You always know what is being shipped this week, what is blocked and what the expected impact looks like.",
  steps: [
    {
      label: "01",
      title: "Discovery & alignment",
      desc: "Understand your product, market, constraints and success metrics in a structured workshop.",
    },
    {
      label: "02",
      title: "Experience & architecture",
      desc: "Translate strategy into information architecture, user journeys and a scalable design system.",
    },
    {
      label: "03",
      title: "Build, test & launch",
      desc: "Ship in iterative sprints with QA, performance checks and stakeholder reviews baked into the cadence.",
    },
    {
      label: "04",
      title: "Measure & optimise",
      desc: "Track real-world usage, identify friction and continuously refine to unlock compounding ROI.",
    },
  ],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedProcessDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(Process, defaultProcess, "demo process section");
    return;
  }

  const existing = await Process.countDocuments({ softDelete: false });
  if (existing > 0) return;
  await Process.create(defaultProcess);
  console.log("Seeded demo process section");
}
