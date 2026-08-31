import mongoose from "mongoose";

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    code: { type: String, trim: true, default: "" },
    subjectType: {
      type: String,
      enum: [
        "Theory",
        "Practical",
        "Theory + Practical",
        "Project",
        "Internship",
        "Elective",
      ],
      default: "Theory",
    },
    theoryHours: { type: Number, default: 0 },
    practicalHours: { type: Number, default: 0 },
    credits: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 0 },
    passingMarks: { type: Number, default: 0 },
    theoryMarks: { type: Number, default: 0 },
    practicalMarks: { type: Number, default: 0 },
    internalMarks: { type: Number, default: 0 },
    externalMarks: { type: Number, default: 0 },
  },
  { _id: false }
);

const semesterSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1 },
    title: { type: String, trim: true, default: "" },
    durationMonths: { type: Number, default: 0 },
    description: { type: String, trim: true, default: "" },
    subjects: { type: [subjectSchema], default: [] },
  },
  { _id: false }
);

const installmentSchema = new mongoose.Schema(
  {
    number: { type: Number, min: 1, default: 1 },
    amount: { type: Number, default: 0 },
    dueLabel: { type: String, trim: true, default: "" },
    dueDays: { type: Number, default: 0 },
  },
  { _id: false }
);

const semesterFeeSchema = new mongoose.Schema(
  {
    termNumber: { type: Number, min: 1, default: 1 },
    tuition: { type: Number, default: 0 },
    registration: { type: Number, default: 0 },
    exam: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

const feesSchema = new mongoose.Schema(
  {
    total: { type: String, trim: true, default: "" },
    registration: { type: String, trim: true, default: "" },
    exam: { type: String, trim: true, default: "" },
    tuition: { type: String, trim: true, default: "" },
    other: { type: String, trim: true, default: "" },
    installmentAllowed: { type: Boolean, default: true },
    installments: { type: [installmentSchema], default: [] },
    semesterFees: { type: [semesterFeeSchema], default: [] },
  },
  { _id: false }
);

const eligibilityDetailsSchema = new mongoose.Schema(
  {
    qualification: { type: String, trim: true, default: "" },
    minimumPercentage: { type: String, trim: true, default: "" },
    stream: { type: String, trim: true, default: "" },
    ageLimit: { type: String, trim: true, default: "" },
    other: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    code: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: ["University", "ITI / SCVT", "Institute"],
      default: "University",
      index: true,
    },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    universityName: { type: String, trim: true, default: "" },
    universityShortName: { type: String, trim: true, uppercase: true, default: "" },
    category: {
      type: String,
      enum: [
        "Degree",
        "Diploma",
        "PG Diploma",
        "Certificate",
        "Training",
        "ITI",
        "Other",
      ],
      default: "Diploma",
    },
    structureType: {
      type: String,
      enum: ["Semester", "Year", "Single Level"],
      default: "Semester",
    },
    durationMonths: { type: Number, default: 6, min: 0 },
    durationLabel: { type: String, trim: true, default: "" },
    semesterCount: { type: Number, default: 0, min: 0 },
    semesters: { type: [semesterSchema], default: [] },
    fees: { type: feesSchema, default: () => ({}) },
    eligibility: { type: String, trim: true, default: "" },
    eligibilityDetails: { type: eligibilityDetailsSchema, default: () => ({}) },
    mode: {
      type: String,
      enum: ["Offline", "Online", "Hybrid"],
      default: "Offline",
    },
    description: { type: String, trim: true, default: "" },
    highlights: { type: [String], default: [] },
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

courseSchema.index({ softDelete: 1, name: 1 });
courseSchema.index({ softDelete: 1, code: 1 });
courseSchema.index({ softDelete: 1, type: 1, status: 1 });
courseSchema.index({ softDelete: 1, universityId: 1 });
courseSchema.index(
  { code: 1, softDelete: 1 },
  {
    unique: true,
    name: "uniq_active_course_code",
    partialFilterExpression: {
      softDelete: false,
      code: { $type: "string", $gt: "" },
    },
  }
);

export const Course = mongoose.model("Course", courseSchema);
