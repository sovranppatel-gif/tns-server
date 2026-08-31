import { HeroLeftSection } from "../modules/heroLeft/heroLeft.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultHeroLeft = {
  sectionLabel: "Landing hero (left column)",
  badgeLabel: "Join us our team",
  headlineLine1: "Build Skills",
  headlineLine2: "Build Solutions",
  bodyParagraph1:
    "At Grow Skills Tech Pvt. Ltd., we don't just build software—we create scalable digital solutions that help businesses grow. Our team combines innovative technology, modern design, and industry expertise to deliver reliable, secure, and high-performance applications.",
  highlightPhrase: "Grow Skills Tech Pvt. Ltd.",
  bodyParagraph2:
    "From startups to enterprises, we transform ideas into powerful digital products that improve efficiency, automate processes, and accelerate business growth.",
  bulletPoints: [
    "Custom Web Application Development tailored to your business needs.",
    "Modern Android & iOS Mobile App Development with seamless user experience.",
    "End-to-end Software Development, from planning and UI/UX to deployment and maintenance.",
    "Professional IT Consulting & Digital Transformation solutions for businesses.",
    "Secure, scalable, and cloud-ready architectures using the latest technologies.",
    "Ongoing Software Maintenance, Support & Performance Optimization.",
    "Professional IT & Software Development Training to prepare students and professionals for industry careers.",
  ],
  primaryCtaLabel: "Book Discovery Call",
  primaryCtaHref: "#top",
  secondaryCtaLabel: "Join Our Team",
  secondaryCtaPath: "/building-creativity",
  socialProofText: "Trusted by founders & marketing teams across India and beyond.",
  socialProofAvatarUrls: [],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedHeroLeftDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(HeroLeftSection, defaultHeroLeft, "demo hero left section");
    return;
  }

  const existing = await HeroLeftSection.countDocuments({ softDelete: false });
  if (existing > 0) return;

  await HeroLeftSection.create(defaultHeroLeft);
  console.log("Seeded demo hero left section");
}
