import mongoose from "mongoose";

export const ATTENDANCE_STATUSES = [
  "Present",
  "Absent",
  "Late",
  "Leave",
  "Holiday",
];

export const MANUAL_ATTENDANCE_STATUSES = [
  "Present",
  "Absent",
  "Late",
  "Leave",
];

export const ATTENDANCE_METHODS = [
  "Manual",
  "Biometric",
  "QR",
  "Online",
];

/**
 * Attendance % = Present / Total × 100.
 * Set true to count Late as present (legacy admin overview behaviour).
 */
export const COUNT_LATE_AS_PRESENT = false;

const termSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, default: "Semester" },
    number: { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    attendanceId: { type: String, required: true, unique: true, trim: true },

    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },
    studentCode: { type: String, default: "", trim: true, index: true },

    admissionId: { type: String, default: "", trim: true, index: true },
    admissionMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
      index: true,
    },

    student: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },

    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      required: true,
      index: true,
    },
    universityName: { type: String, default: "", trim: true },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    courseName: { type: String, default: "", trim: true },
    courseCode: { type: String, default: "", trim: true },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
      index: true,
    },
    batchName: { type: String, default: "", trim: true },
    batchCode: { type: String, default: "", trim: true },

    term: { type: termSchema, default: () => ({ type: "Semester", number: 1 }) },
    semester: { type: Number, required: true, min: 1, index: true },
    semesterTitle: { type: String, default: "", trim: true },

    date: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      default: "Present",
      index: true,
    },
    method: {
      type: String,
      enum: ATTENDANCE_METHODS,
      default: "Manual",
    },
    remarks: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },

    markedBy: { type: String, default: "master-admin", trim: true },
    markedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: "", trim: true },

    isLocked: { type: Boolean, default: false, index: true },
    lockedBy: { type: String, default: "", trim: true },
    lockedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attendanceSchema.pre("save", function syncTermAndRemarks() {
  if (this.semester && (!this.term || !this.term.number)) {
    this.term = {
      type: this.term?.type || "Semester",
      number: this.semester,
    };
  }
  if (this.term?.number && !this.semester) {
    this.semester = this.term.number;
  }
  if (this.term?.number && this.semester && this.term.number !== this.semester) {
    this.semester = this.term.number;
  }
  const remarks = String(this.remarks || "").trim();
  const note = String(this.note || "").trim();
  if (remarks && remarks !== note) this.note = remarks;
  else if (!remarks && note) this.remarks = note;
  if (this.isNew && !this.markedAt) this.markedAt = new Date();
});

attendanceSchema.index(
  { studentId: 1, date: 1, "term.number": 1 },
  {
    unique: true,
    name: "uniq_student_date_term",
    partialFilterExpression: { studentId: { $type: "objectId" } },
  }
);
attendanceSchema.index(
  { admissionMongoId: 1, courseId: 1, semester: 1, date: 1 },
  {
    unique: true,
    name: "uniq_legacy_admission_day_term",
    partialFilterExpression: { admissionMongoId: { $type: "objectId" } },
  }
);
attendanceSchema.index({ email: 1, date: 1 });
attendanceSchema.index({ universityId: 1, courseId: 1, batchId: 1, date: 1 });
attendanceSchema.index({ universityId: 1, courseId: 1, semester: 1, date: 1 });
attendanceSchema.index({ student: "text", email: "text", admissionId: "text", studentCode: "text" });

const attendanceLockSchema = new mongoose.Schema(
  {
    universityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "University",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      index: true,
    },
    term: { type: termSchema, default: () => ({ type: "Semester", number: 1 }) },
    date: { type: Date, required: true, index: true },
    isLocked: { type: Boolean, default: true, index: true },
    lockedBy: { type: String, default: "", trim: true },
    lockedAt: { type: Date, default: Date.now },
    unlockedBy: { type: String, default: "", trim: true },
    unlockedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attendanceLockSchema.index(
  { batchId: 1, date: 1, "term.number": 1 },
  { unique: true, name: "uniq_attendance_lock_batch_date_term" }
);

export const Attendance = mongoose.model("Attendance", attendanceSchema);
export const AttendanceLock = mongoose.model("AttendanceLock", attendanceLockSchema);
