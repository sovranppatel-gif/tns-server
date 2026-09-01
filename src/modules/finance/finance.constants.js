export const EMPLOYEE_TYPES = ["FACULTY", "STAFF"];

export const PAYMENT_DIRECTIONS = ["IN", "OUT"];

export const PAYMENT_SOURCE_TYPES = [
  "FEE",
  "EXPENSE",
  "PAYROLL",
  "INCOME",
  "REFUND",
  "ADVANCE",
  "LOAN",
  "OTHER",
];

export const PAYMENT_ACTIONS = [
  "collect",
  "pay",
  "refund",
  "receive",
  "advance",
  "loan",
  "adjust",
];

export const PAYMENT_METHODS = [
  "Cash",
  "UPI",
  "Bank Transfer",
  "Credit Card",
  "Debit Card",
  "Cheque",
  "Online Gateway",
  "Other",
];

export const PAYMENT_STATUSES = [
  "Pending",
  "Completed",
  "Partial",
  "Failed",
  "Cancelled",
  "Refunded",
];

export const PARTY_TYPES = ["STUDENT", "FACULTY", "STAFF", "VENDOR", "OTHER"];

export const ACCOUNT_TYPES = ["Asset", "Liability", "Income", "Expense", "Equity"];

export const FINANCIAL_ACCOUNT_TYPES = ["Cash", "Bank", "UPI", "Petty Cash"];

export const EXPENSE_PAYMENT_STATUSES = ["Paid", "Pending", "Partially Paid", "Cancelled"];

export const EXPENSE_WORKFLOW = [
  "Draft",
  "Submitted",
  "Approved",
  "Payment Pending",
  "Paid",
  "Rejected",
  "Cancelled",
];

export const EXPENSE_FREQUENCIES = ["Monthly", "Quarterly", "Yearly"];

export const INCOME_STATUSES = ["Received", "Pending", "Partial", "Cancelled"];

export const SALARY_TYPES = [
  "Monthly Fixed",
  "Per Class",
  "Per Lecture",
  "Per Hour",
  "Per Day",
  "Contract",
  "Daily Wage",
  "Hourly Wage",
];

export const PAYMENT_FREQUENCIES = [
  "Monthly",
  "Weekly",
  "Daily",
  "Hourly",
  "Per Class",
  "Per Lecture",
];

export const COMPONENT_CALC_TYPES = ["Fixed", "Percentage"];

export const SALARY_STRUCTURE_STATUSES = ["Draft", "Active", "Superseded"];

export const ADVANCE_RECOVERY_METHODS = ["Full", "Installments"];

export const ADVANCE_STATUSES = ["Active", "Closed", "Cancelled"];

export const LOAN_STATUSES = ["Active", "Closed", "Cancelled"];

export const PAYROLL_STATUSES = [
  "Draft",
  "Generated",
  "Reviewed",
  "Approved",
  "Partially Paid",
  "Paid",
  "Cancelled",
];

export const PAYROLL_ADJUSTMENT_TYPES = [
  "Bonus",
  "Incentive",
  "Overtime",
  "Reimbursement",
  "Other Earnings",
  "Other Deductions",
  "Leave Deduction",
];

export const UNIT_SALARY_TYPES = new Set([
  "Per Class",
  "Per Lecture",
  "Per Hour",
  "Per Day",
  "Daily Wage",
  "Hourly Wage",
]);

export const DEFAULT_EARNING_NAMES = [
  "Basic Salary",
  "House Allowance",
  "Travel Allowance",
  "Medical Allowance",
  "Food Allowance",
  "Special Allowance",
  "Bonus",
  "Incentive",
  "Other Allowance",
];

export const DEFAULT_DEDUCTION_NAMES = [
  "Advance Recovery",
  "Loan Recovery",
  "Unpaid Leave Deduction",
  "Late Attendance Deduction",
  "Tax",
  "Other Deduction",
];

export const CHART_ACCOUNTS = [
  { code: "1000", name: "Cash", type: "Asset", parentCode: "", description: "Main cash on hand" },
  { code: "1010", name: "Bank", type: "Asset", parentCode: "", description: "Bank current account" },
  { code: "1020", name: "UPI", type: "Asset", parentCode: "", description: "UPI / digital wallet" },
  { code: "1030", name: "Petty Cash", type: "Asset", parentCode: "", description: "Petty cash float" },
  { code: "1200", name: "Student Receivables", type: "Asset", parentCode: "", description: "Outstanding student fees" },
  { code: "1210", name: "Other Receivables", type: "Asset", parentCode: "", description: "Other outstanding income" },
  { code: "2000", name: "Salary Payable", type: "Liability", parentCode: "", description: "Unpaid salary liability" },
  { code: "2010", name: "Vendor Payable", type: "Liability", parentCode: "", description: "Unpaid vendor bills" },
  { code: "2020", name: "Other Payables", type: "Liability", parentCode: "", description: "Other outstanding payables" },
  { code: "4000", name: "Student Fees", type: "Income", parentCode: "", description: "Fee collection income" },
  { code: "4010", name: "Admission Income", type: "Income", parentCode: "", description: "Admission charges" },
  { code: "4020", name: "Examination Income", type: "Income", parentCode: "", description: "Examination charges" },
  { code: "4030", name: "Certificate Income", type: "Income", parentCode: "", description: "Certificate charges" },
  { code: "4090", name: "Other Income", type: "Income", parentCode: "", description: "Miscellaneous income" },
  { code: "5000", name: "Faculty Salary", type: "Expense", parentCode: "", description: "Faculty payroll expense" },
  { code: "5010", name: "Staff Salary", type: "Expense", parentCode: "", description: "Staff payroll expense" },
  { code: "5100", name: "Rent", type: "Expense", parentCode: "", description: "Premises rent" },
  { code: "5110", name: "Electricity", type: "Expense", parentCode: "", description: "Electricity bills" },
  { code: "5120", name: "Water", type: "Expense", parentCode: "", description: "Water bills" },
  { code: "5130", name: "Internet", type: "Expense", parentCode: "", description: "Internet / broadband" },
  { code: "5200", name: "Marketing", type: "Expense", parentCode: "", description: "Marketing spend" },
  { code: "5210", name: "Advertisement", type: "Expense", parentCode: "", description: "Advertisement spend" },
  { code: "5300", name: "Office Supplies", type: "Expense", parentCode: "", description: "Office supplies" },
  { code: "5310", name: "Travel", type: "Expense", parentCode: "", description: "Travel expense" },
  { code: "5320", name: "Transportation", type: "Expense", parentCode: "", description: "Transport expense" },
  { code: "5330", name: "Maintenance", type: "Expense", parentCode: "", description: "Repairs and maintenance" },
  { code: "5340", name: "Software", type: "Expense", parentCode: "", description: "Software subscriptions" },
  { code: "5350", name: "Equipment", type: "Expense", parentCode: "", description: "Equipment purchases" },
  { code: "5360", name: "Events", type: "Expense", parentCode: "", description: "Events and functions" },
  { code: "5370", name: "Training", type: "Expense", parentCode: "", description: "Training expense" },
  { code: "5380", name: "Food", type: "Expense", parentCode: "", description: "Food and refreshments" },
  { code: "5990", name: "Miscellaneous", type: "Expense", parentCode: "", description: "Other expenses" },
];

export const FINANCIAL_ACCOUNTS = [
  { accountCode: "CASH", name: "Main Cash", type: "Cash", chartCode: "1000" },
  { accountCode: "BANK", name: "Bank Account", type: "Bank", chartCode: "1010" },
  { accountCode: "UPI", name: "UPI Account", type: "UPI", chartCode: "1020" },
  { accountCode: "PETTY", name: "Petty Cash", type: "Petty Cash", chartCode: "1030" },
];

export const EXPENSE_CATEGORIES = [
  { name: "Salary", accountCode: "5000" },
  { name: "Rent", accountCode: "5100" },
  { name: "Electricity", accountCode: "5110" },
  { name: "Water", accountCode: "5120" },
  { name: "Internet", accountCode: "5130" },
  { name: "Marketing", accountCode: "5200" },
  { name: "Advertisement", accountCode: "5210" },
  { name: "Office Supplies", accountCode: "5300" },
  { name: "Travel", accountCode: "5310" },
  { name: "Transportation", accountCode: "5320" },
  { name: "Maintenance", accountCode: "5330" },
  { name: "Software", accountCode: "5340" },
  { name: "Equipment", accountCode: "5350" },
  { name: "Events", accountCode: "5360" },
  { name: "Training", accountCode: "5370" },
  { name: "Food", accountCode: "5380" },
  { name: "Miscellaneous", accountCode: "5990" },
];

export const INCOME_CATEGORIES = [
  { name: "Student Fees", accountCode: "4000", system: true },
  { name: "Admission Charges", accountCode: "4010" },
  { name: "Examination Charges", accountCode: "4020" },
  { name: "Certificate Charges", accountCode: "4030" },
  { name: "Registration Charges", accountCode: "4010" },
  { name: "Training", accountCode: "4090" },
  { name: "Events", accountCode: "4090" },
  { name: "Donations", accountCode: "4090" },
  { name: "Sponsorship", accountCode: "4090" },
  { name: "Consultancy", accountCode: "4090" },
  { name: "Other Income", accountCode: "4090" },
];

export const METHOD_TO_ACCOUNT = {
  Cash: "CASH",
  UPI: "UPI",
  "Bank Transfer": "BANK",
  "Credit Card": "BANK",
  "Debit Card": "BANK",
  Cheque: "BANK",
  "Online Gateway": "BANK",
  Other: "CASH",
};

export const INCOME_ACCOUNT_BY_SOURCE = {
  FEE: "4000",
  INCOME: "4090",
  REFUND: "4000",
};
