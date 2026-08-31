import { About } from "../modules/about/about.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultAbout = {
  sectionLabel: "About Scholars Mediatech",
  heading: "A product-minded partner, not just another agency.",
  descriptionOne:
    "We blend strategy, design and engineering to help ambitious brands launch and scale digital experiences that feel sharp, fast and effortless to use. Every project is handled by a compact senior team - no unnecessary layers, no copy-paste templates.",
  descriptionTwo:
    "From early-stage startups to established enterprises, we plug into your teams as a long-term product & growth partner, shipping improvements in tight feedback loops instead of one-off campaigns.",
  stats: [
    { value: "5+", label: "Years building digital products" },
    { value: "30+", label: "Industries & categories" },
    { value: "End-to-end", label: "Strategy, design, build & grow" },
  ],
  ctaText: "Priority slots available for",
  ctaHighlightText: "Q2 2026 product launches",
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  imageUrl: "",
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedAboutDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(About, defaultAbout, "demo about section");
    return;
  }

  const existing = await About.countDocuments({ softDelete: false });
  if (existing > 0) return;

  await About.create(defaultAbout);
  console.log("Seeded demo about section");
}
