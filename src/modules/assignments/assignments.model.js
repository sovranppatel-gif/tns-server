import mongoose from "mongoose";

export const ASSIGNMENT_TYPES = ["THEORY", "PRACTICAL", "FILE_SUBMISSION", "LAB", "PROJECT", "QUIZ", "VIDEO", "LINK", "IMAGE"];
export const ASSIGNMENT_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "CLOSED", "ARCHIVED"];
export const STUDENT_ASSIGNMENT_STATUSES = ["ASSIGNED", "VIEWED", "IN_PROGRESS", "SUBMITTED", "LATE_SUBMITTED", "UNDER_REVIEW", "RESUBMISSION_REQUIRED", "EVALUATED", "MISSED", "CANCELLED"];
export const EVALUATION_TYPES = ["MARKS", "PERCENTAGE", "GRADE", "PASS_FAIL"];

const submissionRulesSchema = new mongoose.Schema({
  types: { type: [String], default: [] },
  maxFiles: { type: Number, default: 1, min: 1 },
  maxFileSizeMb: { type: Number, default: 20, min: 1 },
  allowedExtensions: { type: [String], default: [] },
  allowSubmission: { type: Boolean, default: true },
  allowMultipleSubmissions: { type: Boolean, default: false },
  allowEditBeforeDeadline: { type: Boolean, default: true },
  allowResubmission: { type: Boolean, default: false },
  allowLateSubmission: { type: Boolean, default: false },
}, { _id: false });

const lateRulesSchema = new mongoose.Schema({
  gracePeriodHours: { type: Number, default: 0, min: 0 },
  penaltyType: { type: String, enum: ["NONE", "FIXED_MARKS", "PERCENTAGE"], default: "NONE" },
  penaltyValue: { type: Number, default: 0, min: 0 },
  closeAfterDays: { type: Number, default: null, min: 0 },
}, { _id: false });

const rubricSchema = new mongoose.Schema({
  criteria: [{
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    maximumMarks: { type: Number, required: true, min: 0 },
    weight: { type: Number, default: 0, min: 0 },
  }],
}, { _id: false });

const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: "", trim: true },
  instructions: { type: String, default: "", trim: true },
  assignmentType: { type: String, enum: ASSIGNMENT_TYPES, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  subjectName: { type: String, default: "", trim: true },
  subjectCode: { type: String, default: "", trim: true },
  topic: { type: String, default: "", trim: true },
  priority: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], default: "MEDIUM" },
  totalMarks: { type: Number, required: true, min: 0 },
  passingMarks: { type: Number, required: true, min: 0 },
  gradingType: { type: String, enum: EVALUATION_TYPES, default: "MARKS" },
  submissionRules: { type: submissionRulesSchema, default: () => ({}) },
  lateSubmissionRules: { type: lateRulesSchema, default: () => ({}) },
  rubric: { type: rubricSchema, default: null },
  attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  publishAt: { type: Date, default: null, index: true },
  dueAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ASSIGNMENT_STATUSES, default: "DRAFT", index: true },
  autoAssignNewStudents: { type: Boolean, default: false },
  createdBy: { type: String, required: true, trim: true },
  updatedBy: { type: String, default: "", trim: true },
  softDelete: { type: Boolean, default: false, index: true },
}, { timestamps: true, versionKey: false });
assignmentSchema.index({ softDelete: 1, status: 1, createdAt: -1 });

const targetSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  targetType: { type: String, enum: ["BATCH", "STUDENT", "GROUP"], required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null, index: true },
  assignedAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false });
targetSchema.index({ assignmentId: 1, targetType: 1, batchId: 1, studentId: 1 }, { unique: true });

const studentAssignmentSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null, index: true },
  status: { type: String, enum: STUDENT_ASSIGNMENT_STATUSES, default: "ASSIGNED", index: true },
  assignedAt: { type: Date, default: Date.now },
  availableAt: { type: Date, default: null },
  dueAt: { type: Date, required: true, index: true },
  firstViewedAt: { type: Date, default: null },
  lastViewedAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  isLate: { type: Boolean, default: false },
  lateDuration: { type: Number, default: 0, min: 0 },
  submissionCount: { type: Number, default: 0, min: 0 },
  latestSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: "AssignmentSubmission", default: null },
  marksObtained: { type: Number, default: null, min: 0 },
  percentage: { type: Number, default: null, min: 0, max: 100 },
  grade: { type: String, default: "" },
  feedback: { type: String, default: "" },
  evaluatedBy: { type: String, default: "" },
  evaluatedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
studentAssignmentSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });
studentAssignmentSchema.index({ studentId: 1, status: 1, dueAt: 1 });

const submissionSchema = new mongoose.Schema({
  studentAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentAssignment", required: true, index: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  submissionNumber: { type: Number, required: true, min: 1 },
  textAnswer: { type: String, default: "" },
  files: { type: [mongoose.Schema.Types.Mixed], default: [] },
  links: { type: [String], default: [] },
  submittedAt: { type: Date, default: Date.now },
  submissionStatus: { type: String, enum: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "EVALUATED"], default: "SUBMITTED" },
  isLate: { type: Boolean, default: false },
  lateDuration: { type: Number, default: 0, min: 0 },
  submittedBy: { type: String, default: "" },
}, { timestamps: true, versionKey: false });
submissionSchema.index({ studentAssignmentId: 1, submissionNumber: 1 }, { unique: true });

export const Assignment = mongoose.model("Assignment", assignmentSchema);
export const AssignmentTarget = mongoose.model("AssignmentTarget", targetSchema);
export const StudentAssignment = mongoose.model("StudentAssignment", studentAssignmentSchema);
export const AssignmentSubmission = mongoose.model("AssignmentSubmission", submissionSchema);
