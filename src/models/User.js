import mongoose from "mongoose";

export const USER_TYPES = Object.freeze({
  MASTER_ADMIN: "master-admin",
  STUDENT: "student",
  FACULTY: "faculty",
});

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    // bcrypt hash of the password. Plain passwords are never stored.
    passwordHash: {
      type: String,
      required: true,
    },
    // Discriminator field. Add more values here as new user roles appear.
    type: {
      type: String,
      required: true,
      enum: Object.values(USER_TYPES),
      index: true,
    },
    // Student phone (E.164 without +, e.g. 9198XXXXXXXX)
    phone: {
      type: String,
      default: null,
      trim: true,
      sparse: true,
    },
    promoCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    // How the student heard about Grow Skills Tech (signup)
    heardAbout: {
      type: String,
      default: null,
      trim: true,
    },
    // Free-text source when heardAbout === "Others"
    heardAboutOther: {
      type: String,
      default: null,
      trim: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    // ERP Faculty document — set when faculty login is enabled
    erpFacultyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      default: null,
    },
    // True until the student sets a password via email OTP (Forgot password)
    mustResetPassword: {
      type: Boolean,
      default: false,
    },
    // Student portal profile (optional; used when type === student)
    profile: {
      dob: { type: String, default: "", trim: true },
      gender: { type: String, default: "", trim: true },
      bloodGroup: { type: String, default: "", trim: true },
      avatar: { type: String, default: "", trim: true },
      batch: { type: String, default: "", trim: true },
      course: { type: String, default: "", trim: true },
      semester: { type: String, default: "", trim: true },
      rollNo: { type: String, default: "", trim: true },
      enrollmentDate: { type: String, default: "", trim: true },
      trainer: { type: String, default: "", trim: true },
      trainerEmail: { type: String, default: "", trim: true },
      address: {
        line1: { type: String, default: "", trim: true },
        line2: { type: String, default: "", trim: true },
        city: { type: String, default: "", trim: true },
        state: { type: String, default: "", trim: true },
        pincode: { type: String, default: "", trim: true },
      },
      parent: {
        name: { type: String, default: "", trim: true },
        relation: { type: String, default: "", trim: true },
        phone: { type: String, default: "", trim: true },
        email: { type: String, default: "", trim: true },
      },
      emergency: {
        name: { type: String, default: "", trim: true },
        relation: { type: String, default: "", trim: true },
        phone: { type: String, default: "", trim: true },
      },
      education: [
        {
          level: { type: String, default: "", trim: true },
          institute: { type: String, default: "", trim: true },
          year: { type: String, default: "", trim: true },
          percentage: { type: String, default: "", trim: true },
        },
      ],
      skills: [{ type: String, trim: true }],
      achievements: [{ type: String, trim: true }],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// One account per (type, email) pair. This lets us reuse an email across
// different user types in the future while keeping each tuple unique.
userSchema.index({ type: 1, email: 1 }, { unique: true });
userSchema.index(
  { type: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } }
);
userSchema.index(
  { erpStudentId: 1 },
  {
    unique: true,
    partialFilterExpression: { erpStudentId: { $type: "objectId" } },
  }
);
userSchema.index(
  { erpFacultyId: 1 },
  {
    unique: true,
    partialFilterExpression: { erpFacultyId: { $type: "objectId" } },
  }
);

export const User = mongoose.model("User", userSchema);
