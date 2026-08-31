import mongoose from "mongoose";
import {
  STAFF_EMPLOYMENT_TYPES,
  STAFF_GENDERS,
  STAFF_STATUSES,
} from "./staff.constants.js";

const personalDetailsSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    profilePhoto: { type: String, default: "", trim: true },
    gender: { type: String, enum: STAFF_GENDERS, default: "Male", trim: true },
    dateOfBirth: { type: Date, default: null },
    fatherOrHusbandName: { type: String, default: "", trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    alternateMobile: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true, index: true },
    address: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const employmentDetailsSchema = new mongoose.Schema(
  {
    designation: { type: String, required: true, trim: true, index: true },
    designationId: { type: String, default: "", trim: true },
    department: { type: String, default: "", trim: true, index: true },
    departmentId: { type: String, default: "", trim: true },
    staffCategory: { type: String, default: "Administration", trim: true, index: true },
    staffCategoryId: { type: String, default: "", trim: true },
    employmentType: {
      type: String,
      enum: STAFF_EMPLOYMENT_TYPES,
      default: "Full Time",
      trim: true,
    },
    joiningDate: { type: Date, default: Date.now },
    reportingTo: { type: String, default: "", trim: true },
    shift: { type: String, default: "Full Day", trim: true },
    shiftId: { type: String, default: "", trim: true },
    dutyStart: { type: String, default: "", trim: true },
    dutyEnd: { type: String, default: "", trim: true },
    weeklyOff: { type: String, default: "Sunday", trim: true },
    qualification: { type: String, default: "", trim: true },
    experienceYears: { type: Number, default: 0, min: 0 },
    monthlySalary: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    relation: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const staffSchema = new mongoose.Schema(
  {
    staffId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    personalDetails: { type: personalDetailsSchema, required: true },
    employmentDetails: { type: employmentDetailsSchema, required: true },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
    notes: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: STAFF_STATUSES,
      default: "Active",
      index: true,
    },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: String, default: "", trim: true },
    softDelete: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

staffSchema.index({ isArchived: 1, status: 1, createdAt: -1 });
staffSchema.index({ softDelete: 1, status: 1, createdAt: -1 });
staffSchema.index({ "personalDetails.fullName": 1 });
staffSchema.index({
  "employmentDetails.designation": 1,
  "employmentDetails.department": 1,
  "employmentDetails.staffCategory": 1,
});

export const Staff = mongoose.model("Staff", staffSchema);
