import mongoose from "mongoose";

const enquirySchema = new mongoose.Schema(
  {
    source: { type: String, default: "home", trim: true },
    enquiryType: {
      type: String,
      enum: ["client", "student"],
      default: "client",
      trim: true,
    },
    fullName: { type: String, required: true, trim: true },
    companyOrCollege: { type: String, default: "", trim: true },
    workEmail: { type: String, required: true, trim: true, lowercase: true },
    mobile: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    serviceRequested: { type: String, default: "", trim: true },
    projectBudget: { type: String, default: "", trim: true },
    projectDetails: { type: String, default: "", trim: true },
    courseRequested: { type: String, default: "", trim: true },
    studentStatus: { type: String, default: "", trim: true },
    trainingGoals: { type: String, default: "", trim: true },
    allowUpdates: { type: Boolean, default: false },
    heardAbout: { type: String, default: "", trim: true },
    heardAboutOther: { type: String, default: "", trim: true },
    submittedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

enquirySchema.index({ submittedAt: -1 });
enquirySchema.index({ workEmail: 1, submittedAt: -1 });
enquirySchema.index({ enquiryType: 1, submittedAt: -1 });

// Keep legacy Mongo collection so existing landing enquiries stay available
export const Enquiry = mongoose.model(
  "Enquiry",
  enquirySchema,
  "communityjoinsubmissions"
);

/** @deprecated Use Enquiry */
export const CommunityJoinSubmission = Enquiry;
