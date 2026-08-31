import { ServicesSection } from "../modules/services/services.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultServices = {
  sectionBadgeLabel: "Services",
  heading: "Everything you need to go from idea to impact.",
  description:
    "We can own the full journey or plug into existing teams for specific streams like growth, design or engineering.",
  ctaLabel: "Explore this service",
  items: [
    {
      iconKey: "TrendingUp",
      title: "Digital marketing ecosystems",
      desc: "From SEO foundations to performance campaigns and CRO - everything connected to revenue.",
      features: [
        "Search & content strategy",
        "Landing page optimisation",
        "Performance marketing setups",
        "Analytics instrumentation",
      ],
    },
    {
      iconKey: "Code",
      title: "Web & web-app development",
      desc: "Robust, fast experiences on modern stacks with clean architecture and maintainable code.",
      features: [
        "Marketing & product websites",
        "Custom dashboards & portals",
        "API & third-party integrations",
        "Performance & security checks",
      ],
    },
    {
      iconKey: "Smartphone",
      title: "Mobile experiences",
      desc: "Native-feeling mobile apps and PWAs tailored to your business and user context.",
      features: [
        "iOS / Android applications",
        "React Native / hybrid apps",
        "App store optimisation",
        "Usage analytics & funnels",
      ],
    },
    {
      iconKey: "Palette",
      title: "Brand & product design",
      desc: "Interfaces and visual systems that feel premium, timeless and conversion-focused.",
      features: [
        "Design systems & UI libraries",
        "UX research & flows",
        "Interaction & motion design",
        "Brand identity refresh",
      ],
    },
  ],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedServicesDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(ServicesSection, defaultServices, "demo services section");
    return;
  }

  const existing = await ServicesSection.countDocuments({ softDelete: false });
  if (existing > 0) return;
  await ServicesSection.create(defaultServices);
  console.log("Seeded demo services section");
}
