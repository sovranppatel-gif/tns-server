import mongoose from "mongoose";
import {
  EMPLOYMENT_TYPES,
  FACULTY_GENDERS,
  FACULTY_PERMISSIONS,
  FACULTY_STATUSES,
} from "./faculty.constants.js";

const personalDetailsSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    profilePhoto: { type: String, default: "", trim: true },
    gender: { type: String, enum: FACULTY_GENDERS, default: "Male", trim: true },
    dateOfBirth: { type: Date, default: null },
    fatherOrHusbandName: { type: String, default: "", trim: true },
    mobile: { type: String, required: true, trim: true, index: true },
    alternateMobile: { type: String, default: "", trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
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
    department: { type: String, default: "", trim: true, index: true },
    qualification: { type: String, default: "", trim: true },
    specialization: { type: String, default: "", trim: true },
    experienceYears: { type: Number, default: 0, min: 0 },
    joiningDate: { type: Date, default: Date.now },
    employmentType: {
      type: String,
      enum: EMPLOYMENT_TYPES,
      default: "Full Time",
      trim: true,
    },
  },
  { _id: false }
);

const accountDetailsSchema = new mongoose.Schema(
  {
    loginEnabled: { type: Boolean, default: false },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    username: { type: String, default: "", trim: true, lowercase: true },
  },
  { _id: false }
);

const facultySchema = new mongoose.Schema(
  {
    facultyId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    personalDetails: { type: personalDetailsSchema, required: true },
    employmentDetails: { type: employmentDetailsSchema, required: true },
    accountDetails: { type: accountDetailsSchema, default: () => ({}) },
    permissions: {
      type: [{ type: String, enum: FACULTY_PERMISSIONS }],
      default: [],
    },
    status: {
      type: String,
      enum: FACULTY_STATUSES,
      default: "Active",
      index: true,
    },
    softDelete: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

facultySchema.index({ softDelete: 1, status: 1, createdAt: -1 });
facultySchema.index({ "personalDetails.fullName": 1 });
facultySchema.index({ "employmentDetails.designation": 1, "employmentDetails.department": 1 });
facultySchema.index(
  { "accountDetails.userId": 1 },
  { unique: true, partialFilterExpression: { "accountDetails.userId": { $type: "objectId" } } }
);

export const Faculty = mongoose.model("Faculty", facultySchema);
