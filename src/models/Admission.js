import mongoose from "mongoose";

export const ADMISSION_MODES = ["Online", "Offline", "Walk-in"];
export const ADMISSION_STATUSES = [
  "Pending",
  "Verification",
  "Approved",
  "Rejected",
  "Cancelled",
];

const admissionSchema = new mongoose.Schema(
  {
    admissionId: { type: String, required: true, unique: true, trim: true },
    applicant: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    course: { type: String, required: true, trim: true },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      default: null,
      index: true,
    },
    termType: { type: String, default: "", trim: true },
    termNumber: { type: Number, default: null },
    session: { type: String, default: "", trim: true },
    mode: {
      type: String,
      enum: ADMISSION_MODES,
      default: "Online",
      trim: true,
    },
    counsellor: { type: String, default: "", trim: true },
    fee: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ADMISSION_STATUSES,
      default: "Pending",
      trim: true,
    },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    college: { type: String, default: "", trim: true },
    studentStatus: { type: String, default: "", trim: true },
    studentId: { type: String, default: "", trim: true, index: true },
    studentMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },
    notes: { type: String, default: "", trim: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    admissionDate: { type: Date, default: Date.now },
    createdBy: { type: String, default: "master-admin", trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

admissionSchema.index({ admissionDate: -1 });
admissionSchema.index({ status: 1, admissionDate: -1 });
admissionSchema.index({ email: 1 });
admissionSchema.index({ course: 1 });
admissionSchema.index({ courseId: 1, universityId: 1 });

export const Admission = mongoose.model("Admission", admissionSchema);
