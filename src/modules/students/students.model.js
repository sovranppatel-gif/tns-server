import mongoose from "mongoose";

export const STUDENT_STATUSES = [
  "Active",
  "Inactive",
  "Completed",
  "Dropped",
  "Cancelled",
  "Transferred",
  "Suspended",
];

export const STUDENT_GENDERS = ["Male", "Female", "Other"];

export const STUDENT_CATEGORIES = [
  "General",
  "OBC",
  "SC",
  "ST",
  "EWS",
  "Other",
];

export const STUDENT_DOCUMENT_TYPES = [
  "Passport Photo",
  "Aadhaar",
  "10th Marksheet",
  "12th Marksheet",
  "Graduation Marksheet",
  "Transfer Certificate",
  "Migration Certificate",
  "Caste Certificate",
  "Domicile",
  "Other",
];

const currentTermSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, default: "" },
    number: { type: Number, default: null },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    mobile: { type: String, trim: true, default: "" },
    alternateMobile: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    permanent: { type: String, trim: true, default: "" },
    correspondence: { type: String, trim: true, default: "" },
    village: { type: String, trim: true, default: "" },
    post: { type: String, trim: true, default: "" },
    tehsil: { type: String, trim: true, default: "" },
    district: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pinCode: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const guardianSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    relation: { type: String, trim: true, default: "" },
    mobile: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    documentType: { type: String, trim: true, default: "Other" },
    documentName: { type: String, trim: true, default: "" },
    documentUrl: { type: String, trim: true, default: "" },
    documentNumber: { type: String, trim: true, default: "" },
    verified: { type: Boolean, default: false },
    verifiedBy: { type: String, trim: true, default: "" },
    verifiedAt: { type: Date, default: null },
  },
  { _id: true }
);

const batchHistorySchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    batchCode: { type: String, trim: true, default: "" },
    batchName: { type: String, trim: true, default: "" },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    joiningDate: { type: Date, default: null },
    leavingDate: { type: Date, default: null },
    currentTerm: { type: currentTermSchema, default: () => ({}) },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true }
);

const studentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, trim: true },
    admissionId: { type: String, default: "", trim: true, index: true },
    admissionMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
      index: true,
    },

    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
      index: true,
    },

    session: { type: String, trim: true, default: "" },
    currentTerm: { type: currentTermSchema, default: () => ({}) },

    // Display snapshots for inactive / legacy masters — not the primary relation
    universityName: { type: String, trim: true, default: "" },
    universityShortName: { type: String, trim: true, default: "" },
    courseName: { type: String, trim: true, default: "" },
    courseCode: { type: String, trim: true, default: "" },
    courseCategory: { type: String, trim: true, default: "" },
    batchName: { type: String, trim: true, default: "" },

    nameEnglish: { type: String, required: true, trim: true },
    nameHindi: { type: String, trim: true, default: "" },
    fatherName: { type: String, trim: true, default: "" },
    motherName: { type: String, trim: true, default: "" },
    dateOfBirth: { type: String, trim: true, default: "" },
    gender: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },
    samagraId: { type: String, trim: true, default: "" },
    casteCertificateNo: { type: String, trim: true, default: "" },
    maritalStatus: { type: String, trim: true, default: "" },
    husbandName: { type: String, trim: true, default: "" },

    contact: { type: contactSchema, default: () => ({}) },
    address: { type: addressSchema, default: () => ({}) },
    guardian: { type: guardianSchema, default: () => ({}) },
    education: { type: [mongoose.Schema.Types.Mixed], default: [] },
    admissionDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

    photo: { type: String, default: "" },
    documents: { type: [documentSchema], default: [] },

    status: {
      type: String,
      enum: STUDENT_STATUSES,
      default: "Active",
      index: true,
    },
    admissionDate: { type: Date, default: Date.now },
    batchHistory: { type: [batchHistorySchema], default: [] },

    createdBy: { type: String, trim: true, default: "master-admin" },
    updatedBy: { type: String, trim: true, default: "master-admin" },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

studentSchema.index({ nameEnglish: 1 });
studentSchema.index({ "contact.mobile": 1 });
studentSchema.index({ "contact.email": 1 });
studentSchema.index({ status: 1, createdAt: -1 });
studentSchema.index({ universityId: 1, courseId: 1, batchId: 1 });
studentSchema.index(
  { admissionMongoId: 1 },
  {
    unique: true,
    name: "uniq_student_admission_mongo",
    partialFilterExpression: { admissionMongoId: { $type: "objectId" } },
  }
);
studentSchema.index(
  { admissionId: 1 },
  {
    unique: true,
    name: "uniq_student_admission_id",
    partialFilterExpression: {
      admissionId: { $type: "string", $gt: "" },
    },
  }
);

export const Student = mongoose.model("Student", studentSchema);
