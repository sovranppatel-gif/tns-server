import mongoose from "mongoose";

export const FEE_STATUSES = ["Paid", "Partial", "Pending", "Overdue"];
export const INSTALLMENT_STATUSES = ["Paid", "Partial", "Due", "Overdue", "Pending"];

const installmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    category: { type: String, default: "Tuition", trim: true },
    amount: { type: Number, default: 0, min: 0 },
    paid: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    paidDate: { type: Date, default: null },
    status: {
      type: String,
      enum: INSTALLMENT_STATUSES,
      default: "Pending",
    },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    invoice: { type: String, default: "", trim: true },
    method: { type: String, default: "", trim: true },
    mode: { type: String, default: "", trim: true },
    amount: { type: Number, default: 0, min: 0 },
    date: { type: Date, default: Date.now },
    refundedAt: { type: Date, default: null },
    status: { type: String, default: "Success", trim: true },
    note: { type: String, default: "", trim: true },
    installmentId: { type: String, default: "", trim: true },
    proofName: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const studentFeeSchema = new mongoose.Schema(
  {
    feeId: { type: String, required: true, unique: true, trim: true },
    admissionId: { type: String, required: true, trim: true, index: true },
    admissionMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
      unique: true,
      index: true,
    },
    student: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    course: { type: String, required: true, trim: true },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    courseCode: { type: String, default: "", trim: true },
    category: { type: String, default: "Tuition", trim: true },
    totalAmount: { type: Number, default: 0, min: 0 },
    registrationFee: { type: Number, default: 0, min: 0 },
    examFee: { type: Number, default: 0, min: 0 },
    monthlyFee: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    dueAmount: { type: Number, default: 0, min: 0 },
    installmentCount: { type: Number, default: 1, min: 1 },
    currentInstallment: { type: Number, default: 0, min: 0 },
    installmentAllowed: { type: Boolean, default: true },
    status: {
      type: String,
      enum: FEE_STATUSES,
      default: "Pending",
      index: true,
    },
    nextDueDate: { type: Date, default: null },
    installments: { type: [installmentSchema], default: [] },
    payments: { type: [paymentSchema], default: [] },
    courseFees: {
      total: { type: String, default: "" },
      registration: { type: String, default: "" },
      exam: { type: String, default: "" },
      monthly: { type: String, default: "" },
      installmentAllowed: { type: Boolean, default: true },
    },
    notes: { type: String, default: "", trim: true },
    syncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

studentFeeSchema.index({ student: 1 });
studentFeeSchema.index({ email: 1 });
studentFeeSchema.index({ status: 1, updatedAt: -1 });

export const StudentFee = mongoose.model("StudentFee", studentFeeSchema);
