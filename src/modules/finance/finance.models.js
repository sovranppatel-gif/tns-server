import mongoose from "mongoose";
import {
  ACCOUNT_TYPES,
  ADVANCE_RECOVERY_METHODS,
  ADVANCE_STATUSES,
  EMPLOYEE_TYPES,
  EXPENSE_FREQUENCIES,
  EXPENSE_PAYMENT_STATUSES,
  EXPENSE_WORKFLOW,
  FINANCIAL_ACCOUNT_TYPES,
  INCOME_STATUSES,
  LOAN_STATUSES,
  PARTY_TYPES,
  PAYMENT_ACTIONS,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_SOURCE_TYPES,
  PAYMENT_STATUSES,
  PAYMENT_FREQUENCIES,
  PAYROLL_ADJUSTMENT_TYPES,
  PAYROLL_STATUSES,
  SALARY_STRUCTURE_STATUSES,
  SALARY_TYPES,
  COMPONENT_CALC_TYPES,
} from "./finance.constants.js";

const sequenceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

export const FinanceSequence = mongoose.model("FinanceSequence", sequenceSchema);

const chartAccountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true, index: true },
    parentCode: { type: String, default: "", trim: true, uppercase: true },
    description: { type: String, default: "", trim: true },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active", index: true },
    system: { type: Boolean, default: false },
    createdBy: { type: String, default: "system", trim: true },
    updatedBy: { type: String, default: "system", trim: true },
  },
  { timestamps: true, versionKey: false }
);

chartAccountSchema.index({ type: 1, name: 1 });

export const ChartAccount = mongoose.model("ChartAccount", chartAccountSchema);

const financialAccountSchema = new mongoose.Schema(
  {
    accountCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: FINANCIAL_ACCOUNT_TYPES, required: true, index: true },
    chartCode: { type: String, default: "", trim: true },
    bankName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
    ifsc: { type: String, default: "", trim: true, uppercase: true },
    openingBalance: { type: Number, default: 0, min: 0 },
    currentBalance: { type: Number, default: 0 },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active", index: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "system", trim: true },
    updatedBy: { type: String, default: "system", trim: true },
  },
  { timestamps: true, versionKey: false }
);

export const FinancialAccount = mongoose.model("FinancialAccount", financialAccountSchema);

const ledgerLineSchema = new mongoose.Schema(
  {
    accountCode: { type: String, required: true, trim: true },
    accountName: { type: String, default: "", trim: true },
    accountType: { type: String, enum: ACCOUNT_TYPES, default: "Asset" },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const accountingTransactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: true, index: true },
    description: { type: String, default: "", trim: true },
    referenceNumber: { type: String, default: "", trim: true, index: true },
    sourceType: { type: String, enum: PAYMENT_SOURCE_TYPES, required: true, index: true },
    sourceId: { type: String, required: true, trim: true, index: true },
    action: { type: String, enum: PAYMENT_ACTIONS, required: true, index: true },
    paymentId: { type: String, default: "", trim: true, index: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: "University", default: null },
    lines: { type: [ledgerLineSchema], default: [] },
    debitTotal: { type: Number, default: 0, min: 0 },
    creditTotal: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["Posted", "Reversed"], default: "Posted", index: true },
    reversedBy: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

accountingTransactionSchema.index({ sourceType: 1, sourceId: 1, action: 1 }, { unique: true });
accountingTransactionSchema.index({ date: -1, transactionId: -1 });

export const AccountingTransaction = mongoose.model("AccountingTransaction", accountingTransactionSchema);

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: true, index: true },
    direction: { type: String, enum: PAYMENT_DIRECTIONS, required: true, index: true },
    sourceType: { type: String, enum: PAYMENT_SOURCE_TYPES, required: true, index: true },
    sourceId: { type: String, required: true, trim: true, index: true },
    action: { type: String, enum: PAYMENT_ACTIONS, default: "collect", index: true },
    partyType: { type: String, enum: PARTY_TYPES, default: "OTHER" },
    partyId: { type: String, default: "", trim: true },
    partyName: { type: String, default: "", trim: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, default: "Cash", index: true },
    financialAccountCode: { type: String, default: "CASH", trim: true, uppercase: true, index: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: "University", default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: "Completed", index: true },
    referenceNumber: { type: String, default: "", trim: true, index: true },
    notes: { type: String, default: "", trim: true },
    refundOf: { type: String, default: "", trim: true },
    refundReason: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

paymentSchema.index({ sourceType: 1, sourceId: 1, action: 1 }, { unique: true });
paymentSchema.index({ date: -1 });
paymentSchema.index({ partyName: 1 });

export const FinancePayment = mongoose.model("FinancePayment", paymentSchema);

const expenseCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    accountCode: { type: String, default: "5990", trim: true },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active", index: true },
    system: { type: Boolean, default: false },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

export const ExpenseCategory = mongoose.model("ExpenseCategory", expenseCategorySchema);

const approvalSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    by: { type: String, default: "", trim: true },
    at: { type: Date, default: Date.now },
    remarks: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    expenseId: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseCategory", default: null },
    categoryName: { type: String, required: true, trim: true, index: true },
    accountCode: { type: String, default: "5990", trim: true },
    description: { type: String, default: "", trim: true },
    amount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    vendor: { type: String, default: "", trim: true },
    paymentStatus: {
      type: String,
      enum: EXPENSE_PAYMENT_STATUSES,
      default: "Pending",
      index: true,
    },
    workflowStatus: {
      type: String,
      enum: EXPENSE_WORKFLOW,
      default: "Draft",
      index: true,
    },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "Cash" },
    financialAccountCode: { type: String, default: "", trim: true, uppercase: true },
    invoiceNumber: { type: String, default: "", trim: true },
    referenceNumber: { type: String, default: "", trim: true },
    attachmentUrl: { type: String, default: "", trim: true },
    attachmentName: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: "University", default: null },
    universityName: { type: String, default: "", trim: true },
    reimbursable: { type: Boolean, default: false },
    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: [...EXPENSE_FREQUENCIES, ""], default: "" },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      nextDueDate: { type: Date, default: null },
      templateId: { type: String, default: "", trim: true },
    },
    approvalHistory: { type: [approvalSchema], default: [] },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
    approvedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true, versionKey: false }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ vendor: 1 });
expenseSchema.index({ "recurring.enabled": 1, "recurring.nextDueDate": 1 });

export const Expense = mongoose.model("Expense", expenseSchema);

const incomeCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    accountCode: { type: String, default: "4090", trim: true },
    system: { type: Boolean, default: false },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active", index: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

export const IncomeCategory = mongoose.model("IncomeCategory", incomeCategorySchema);

const incomeSchema = new mongoose.Schema(
  {
    incomeId: { type: String, required: true, unique: true, trim: true },
    date: { type: Date, required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "IncomeCategory", default: null },
    categoryName: { type: String, required: true, trim: true, index: true },
    accountCode: { type: String, default: "4090", trim: true },
    source: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    amount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    receivedAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: INCOME_STATUSES, default: "Pending", index: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "Cash" },
    financialAccountCode: { type: String, default: "", trim: true, uppercase: true },
    receivedFrom: { type: String, default: "", trim: true },
    referenceNumber: { type: String, default: "", trim: true },
    attachmentUrl: { type: String, default: "", trim: true },
    attachmentName: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: "University", default: null },
    universityName: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

incomeSchema.index({ date: -1 });
incomeSchema.index({ receivedFrom: 1 });

export const IncomeRecord = mongoose.model("IncomeRecord", incomeSchema);

const salaryComponentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    calcType: { type: String, enum: COMPONENT_CALC_TYPES, default: "Fixed" },
    amount: { type: Number, default: 0, min: 0 },
    resolvedAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const salaryStructureSchema = new mongoose.Schema(
  {
    structureId: { type: String, required: true, unique: true, trim: true },
    employeeType: { type: String, enum: EMPLOYEE_TYPES, required: true, index: true },
    employeeMongoId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    employeeCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    employeeName: { type: String, required: true, trim: true },
    department: { type: String, default: "", trim: true, index: true },
    designation: { type: String, default: "", trim: true, index: true },
    employmentType: { type: String, default: "", trim: true },
    salaryType: { type: String, enum: SALARY_TYPES, default: "Monthly Fixed", index: true },
    paymentFrequency: { type: String, enum: PAYMENT_FREQUENCIES, default: "Monthly" },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null },
    earnings: { type: [salaryComponentSchema], default: [] },
    deductions: { type: [salaryComponentSchema], default: [] },
    basicSalary: { type: Number, default: 0, min: 0 },
    unitRate: { type: Number, default: 0, min: 0 },
    totalAllowances: { type: Number, default: 0, min: 0 },
    totalIncentives: { type: Number, default: 0, min: 0 },
    bonus: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    grossSalary: { type: Number, default: 0, min: 0 },
    netSalary: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: SALARY_STRUCTURE_STATUSES, default: "Active", index: true },
    revisedFrom: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

salaryStructureSchema.index({ employeeType: 1, employeeMongoId: 1, effectiveFrom: -1 });
salaryStructureSchema.index({ status: 1, employeeName: 1 });

export const SalaryStructure = mongoose.model("SalaryStructure", salaryStructureSchema);

const employeeAdvanceSchema = new mongoose.Schema(
  {
    advanceId: { type: String, required: true, unique: true, trim: true },
    employeeType: { type: String, enum: EMPLOYEE_TYPES, required: true, index: true },
    employeeMongoId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    employeeName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, index: true },
    reason: { type: String, default: "", trim: true },
    recoveryMethod: { type: String, enum: ADVANCE_RECOVERY_METHODS, default: "Installments" },
    monthlyRecoveryAmount: { type: Number, default: 0, min: 0 },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    remainingAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ADVANCE_STATUSES, default: "Active", index: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

export const EmployeeAdvance = mongoose.model("EmployeeAdvance", employeeAdvanceSchema);

const employeeLoanSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true, unique: true, trim: true },
    employeeType: { type: String, enum: EMPLOYEE_TYPES, required: true, index: true },
    employeeMongoId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    employeeName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    issueDate: { type: Date, required: true, index: true },
    emiAmount: { type: Number, default: 0, min: 0 },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    remainingAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: LOAN_STATUSES, default: "Active", index: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
  },
  { timestamps: true, versionKey: false }
);

export const EmployeeLoan = mongoose.model("EmployeeLoan", employeeLoanSchema);

const payrollAdjustmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: PAYROLL_ADJUSTMENT_TYPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "master-admin", trim: true },
    date: { type: Date, default: Date.now },
  },
  { _id: true }
);

const payrollRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true, trim: true },
    month: { type: Number, required: true, min: 1, max: 12, index: true },
    year: { type: Number, required: true, index: true },
    employeeType: { type: String, enum: ["ALL", ...EMPLOYEE_TYPES], default: "ALL", index: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: "University", default: null },
    universityName: { type: String, default: "", trim: true },
    status: { type: String, enum: PAYROLL_STATUSES, default: "Generated", index: true },
    totals: {
      employees: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
    },
    generatedBy: { type: String, default: "master-admin", trim: true },
    approvedBy: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true, versionKey: false }
);

payrollRunSchema.index({ year: 1, month: 1, employeeType: 1 });

export const PayrollRun = mongoose.model("PayrollRun", payrollRunSchema);

const payrollItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true, trim: true },
    runMongoId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
    runId: { type: String, required: true, trim: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12, index: true },
    year: { type: Number, required: true, index: true },
    employeeType: { type: String, enum: EMPLOYEE_TYPES, required: true, index: true },
    employeeMongoId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    snapshot: {
      name: { type: String, default: "", trim: true },
      department: { type: String, default: "", trim: true },
      designation: { type: String, default: "", trim: true },
      employmentType: { type: String, default: "", trim: true },
      salaryType: { type: String, default: "", trim: true },
      structureId: { type: String, default: "", trim: true },
    },
    basicSalary: { type: Number, default: 0, min: 0 },
    totalAllowances: { type: Number, default: 0, min: 0 },
    incentives: { type: Number, default: 0, min: 0 },
    bonus: { type: Number, default: 0, min: 0 },
    overtime: { type: Number, default: 0, min: 0 },
    reimbursement: { type: Number, default: 0, min: 0 },
    otherEarnings: { type: Number, default: 0, min: 0 },
    structureDeductions: { type: Number, default: 0, min: 0 },
    otherDeductions: { type: Number, default: 0, min: 0 },
    advanceRecovery: { type: Number, default: 0, min: 0 },
    loanRecovery: { type: Number, default: 0, min: 0 },
    leaveDeduction: { type: Number, default: 0, min: 0 },
    grossSalary: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    netPayable: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    unitsWorked: { type: Number, default: 0, min: 0 },
    unitRate: { type: Number, default: 0, min: 0 },
    attendanceSummary: {
      present: { type: Number, default: 0 },
      absent: { type: Number, default: 0 },
      leave: { type: Number, default: 0 },
      late: { type: Number, default: 0 },
      note: { type: String, default: "", trim: true },
    },
    adjustments: { type: [payrollAdjustmentSchema], default: [] },
    status: { type: String, enum: PAYROLL_STATUSES, default: "Generated", index: true },
    paymentMethod: { type: String, default: "", trim: true },
    paidAt: { type: Date, default: null },
    createdBy: { type: String, default: "master-admin", trim: true },
    updatedBy: { type: String, default: "master-admin", trim: true },
    approvedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true, versionKey: false }
);

payrollItemSchema.index(
  { employeeType: 1, employeeMongoId: 1, month: 1, year: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["Draft", "Generated", "Reviewed", "Approved", "Partially Paid", "Paid"] },
    },
  }
);
payrollItemSchema.index({ runMongoId: 1, status: 1 });

export const PayrollItem = mongoose.model("PayrollItem", payrollItemSchema);
