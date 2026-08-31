import mongoose from "mongoose";

const universitySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    shortName: { type: String, trim: true, required: true, uppercase: true },
    universityCode: { type: String, trim: true, uppercase: true, default: "" },
    universityType: { type: String, trim: true, default: "" },
    establishedYear: { type: String, trim: true, default: "" },
    logo: { type: String, trim: true, default: "" },

    registrationNumber: { type: String, trim: true, default: "" },
    affiliationNumber: { type: String, trim: true, default: "" },
    affiliationAuthority: { type: String, trim: true, default: "" },
    recognitionDetails: { type: String, trim: true, default: "" },

    address: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    district: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },

    contactPerson: { type: String, trim: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    contactEmail: { type: String, trim: true, lowercase: true, default: "" },
    website: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["Active", "Inactive", "Draft"],
      default: "Active",
      index: true,
    },
    remarks: { type: String, trim: true, default: "" },
    createdBy: { type: String, trim: true, default: "system" },
    updatedBy: { type: String, trim: true, default: "system" },
    softDelete: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

universitySchema.index({ softDelete: 1, name: 1 });
universitySchema.index({ softDelete: 1, shortName: 1 });
universitySchema.index({ softDelete: 1, universityCode: 1 });
universitySchema.index({ softDelete: 1, registrationNumber: 1 });

export const University = mongoose.model("University", universitySchema);
