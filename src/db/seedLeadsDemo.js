import { Lead } from "../modules/leads/leads.model.js";

export async function seedLeadsDemo() {
  const existing = await Lead.countDocuments();
  if (existing > 0) {
    console.log(`[leads] seed skipped — ${existing} lead(s) already exist`);
    return;
  }

  const rows = [
    {
      name: "Snehal Patil",
      phone: "9876511001",
      email: "snehal@example.com",
      source: "Website",
      interest: "Full Stack",
      counsellor: "Riya Sen",
      followUp: new Date("2026-07-15"),
      status: "New",
      notes: "Interested in evening batch",
      createdBy: "seed",
      updatedBy: "seed",
    },
    {
      name: "Gaurav Malhotra",
      phone: "9876511002",
      email: "gaurav@example.com",
      source: "WhatsApp",
      interest: "Data Science",
      counsellor: "Amit Shah",
      followUp: new Date("2026-07-14"),
      status: "Contacted",
      notes: "",
      createdBy: "seed",
      updatedBy: "seed",
    },
    {
      name: "Divya Krishnan",
      phone: "9876511003",
      email: "divya@example.com",
      source: "Phone",
      interest: "Cloud",
      counsellor: "Riya Sen",
      followUp: new Date("2026-07-16"),
      status: "Qualified",
      notes: "Ready for counselling call",
      createdBy: "seed",
      updatedBy: "seed",
    },
    {
      name: "Farhan Ali",
      phone: "9876511004",
      email: "farhan@example.com",
      source: "Email",
      interest: "UI/UX",
      counsellor: "Amit Shah",
      followUp: null,
      status: "Converted",
      notes: "Converted to admission",
      createdBy: "seed",
      updatedBy: "seed",
    },
    {
      name: "Ritu Agarwal",
      phone: "9876511005",
      email: "ritu@example.com",
      source: "Walk-in",
      interest: "Digital Marketing",
      counsellor: "Riya Sen",
      followUp: null,
      status: "Lost",
      notes: "Chose another institute",
      createdBy: "seed",
      updatedBy: "seed",
    },
    {
      name: "Yashwanth G",
      phone: "9876511006",
      email: "yashwanth@example.com",
      source: "Website",
      interest: "Cyber Security",
      counsellor: "Unassigned",
      followUp: new Date("2026-07-17"),
      status: "New",
      notes: "",
      createdBy: "seed",
      updatedBy: "seed",
    },
  ];

  await Lead.insertMany(rows);
  console.log(`[leads] seeded ${rows.length} demo lead(s)`);
}
