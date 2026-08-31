import { FaqSectionModel } from "../modules/faq/faq.model.js";
import { upsertDemoSection } from "./seedUtils.js";

export const defaultFaq = {
  sectionLabel: "Questions",
  heading: "A few things teams often ask us.",
  items: [
    {
      question: "What is a typical project timeline?",
      answer:
        "Smaller marketing sites can be delivered in 3-5 weeks. Product builds and complex platforms usually run between 8-16 weeks depending on scope.",
    },
    {
      question: "Do you only work with Indian companies?",
      answer:
        "No - while a lot of our clients are India-first businesses, we also work with teams in the Middle East, Europe and South-East Asia across time zones.",
    },
    {
      question: "Can you work with our in-house dev or marketing team?",
      answer:
        "Absolutely. Many engagements are hybrid - we own UX/UI and architecture while your teams manage engineering or growth, or vice-versa.",
    },
    {
      question: "How do we get started?",
      answer:
        "Share a short brief using the form above or email us. We usually respond within 24 hours with a rough scope, ballpark and next steps.",
    },
  ],
  isVisible: true,
  publishStatus: "published",
  displayOrder: 1,
  createdBy: "system-seed",
  updatedBy: "system-seed",
  softDelete: false,
};

export async function seedFaqDemo({ upsert = false } = {}) {
  if (upsert) {
    await upsertDemoSection(FaqSectionModel, defaultFaq, "demo FAQ section");
    return;
  }

  const existing = await FaqSectionModel.countDocuments({ softDelete: false });
  if (existing > 0) return;
  await FaqSectionModel.create(defaultFaq);
  console.log("Seeded demo FAQ section");
}
