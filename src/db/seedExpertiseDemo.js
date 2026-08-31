import { Expertise } from "../modules/expertise/expertise.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultExpertise = {
  sectionLabel: "What we are good at",
  heading: "Product, design & growth under one roof.",
  description:
    "Every engagement is led by senior talent across strategy, design and engineering - so decisions are coherent, fast and impact-driven, instead of being spread across disconnected vendors.",
  items: [
    {
      iconKey: "Target",
      title: "Product-grade engineering",
      desc: "Modern, maintainable codebases with performance budgets, CI and observability baked-in from day one.",
    },
    {
      iconKey: "Palette",
      title: "Interface & experience design",
      desc: "Interfaces that feel clean, confident and premium - always designed around business KPIs & real user journeys.",
    },
    {
      iconKey: "TrendingUp",
      title: "Acquisition & growth",
      desc: "SEO foundations, landing page experiments and analytics that tie every experiment back to revenue.",
    },
    {
      iconKey: "Smartphone",
      title: "Multi-device reality",
      desc: "From mobile-first web to native apps, we make sure your brand feels consistent and high-end everywhere.",
    },
  ],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedExpertiseDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(Expertise, defaultExpertise, "demo expertise section");
    return;
  }

  const existing = await Expertise.countDocuments({ softDelete: false });
  if (existing > 0) return;

  await Expertise.create(defaultExpertise);
  console.log("Seeded demo expertise section");
}
