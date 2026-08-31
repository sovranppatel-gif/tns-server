import mongoose from "mongoose";

const resultBreakdownSchema = new mongoose.Schema(
  {
    questionId: { type: String, trim: true, default: "" },
    text: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "" },
    options: { type: [mongoose.Schema.Types.Mixed], default: [] },
    studentAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    correctAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    marks: { type: Number, default: 0 },
    negativeMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    verdict: { type: String, trim: true, default: "unanswered" },
    explanation: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const examResultSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamSchedule",
      required: true,
      index: true,
    },
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamAttempt",
      required: true,
      unique: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    examTitle: { type: String, trim: true, default: "" },
    studentName: { type: String, trim: true, default: "" },
    admissionId: { type: String, trim: true, default: "" },
    studentCode: { type: String, trim: true, default: "" },
    courseName: { type: String, trim: true, default: "" },
    batchName: { type: String, trim: true, default: "" },
    universityName: { type: String, trim: true, default: "" },
    examDate: { type: Date, default: null },
    totalQuestions: { type: Number, default: 0 },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    unanswered: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passingPercentage: { type: Number, default: 40 },
    result: { type: String, enum: ["PASS", "FAIL"], default: "FAIL", index: true },
    timeTakenSeconds: { type: Number, default: 0 },
    submittedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    released: { type: Boolean, default: true, index: true },
    status: { type: String, trim: true, default: "Submitted" },
    breakdown: { type: [resultBreakdownSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

examResultSchema.index({ examId: 1, studentId: 1 });
examResultSchema.index({ result: 1, examId: 1 });

export const ExamResult = mongoose.model("ExamResult", examResultSchema);
