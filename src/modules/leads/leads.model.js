import mongoose from "mongoose";

export const LEAD_STATUSES = Object.freeze([
  "New",
  "Contacted",
  "Qualified",
  "Converted",
  "Lost",
]);

export const LEAD_SOURCES = Object.freeze([
  "Website",
  "WhatsApp",
  "Phone",
  "Email",
  "Walk-in",
  "Instagram",
  "Facebook",
  "YouTube",
  "Friend / Family",
  "College / University",
  "Advertisement",
  "Partner / Counsellor",
  "Others",
]);

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: "Website",
      trim: true,
      index: true,
    },
    sourceOther: { type: String, default: "", trim: true },
    interest: { type: String, default: "", trim: true },
    counsellor: { type: String, default: "Unassigned", trim: true },
    followUp: { type: Date, default: null },
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: "New",
      trim: true,
      index: true,
    },
    notes: { type: String, default: "", trim: true },
    enquiryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Enquiry",
      default: null,
    },
    createdBy: { type: String, trim: true, default: "system" },
    updatedBy: { type: String, trim: true, default: "system" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

leadSchema.index({ createdAt: -1 });
leadSchema.index({ status: 1, followUp: 1 });
leadSchema.index({ phone: 1 });
leadSchema.index(
  { enquiryId: 1 },
  {
    unique: true,
    partialFilterExpression: { enquiryId: { $type: "objectId" } },
  }
);

export const Lead = mongoose.model("Lead", leadSchema);
