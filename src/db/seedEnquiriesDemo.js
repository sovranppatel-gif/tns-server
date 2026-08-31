import { Enquiry } from "../modules/enquiries/enquiries.model.js";

export async function seedEnquiriesDemo() {
  const existing = await Enquiry.countDocuments();
  if (existing > 0) return;

  await Enquiry.create({
    source: "home",
    enquiryType: "client",
    fullName: "Rahul Verma",
    companyOrCollege: "Verma Digital Solutions",
    workEmail: "rahul.verma.demo@growskillstech.com",
    mobile: "+91 98765 43210",
    city: "Bhopal",
    state: "Madhya Pradesh",
    serviceRequested: "Web Application & SaaS Development",
    projectBudget: "₹50,000 – ₹2,00,000",
    projectDetails:
      "Need a client portal with role-based dashboards and payment integration for our agency workflow.",
    allowUpdates: true,
    submittedAt: new Date(),
  });

  await Enquiry.create({
    source: "home",
    enquiryType: "student",
    fullName: "Priya Sharma",
    companyOrCollege: "Rajiv Gandhi Proudyogiki Vishwavidyalaya",
    workEmail: "priya.sharma.demo@growskillstech.com",
    mobile: "+91 91234 56789",
    city: "Indore",
    state: "Madhya Pradesh",
    courseRequested: "Full-Stack MERN Development (React, Node, MongoDB)",
    studentStatus: "College Student (Pursuing Degree)",
    trainingGoals:
      "Looking for industrial internship and placement support in full-stack development.",
    allowUpdates: true,
    submittedAt: new Date(),
  });

  console.log("Seeded demo enquiries");
}

/** @deprecated Use seedEnquiriesDemo */
export const seedCommunityJoinDemo = seedEnquiriesDemo;
