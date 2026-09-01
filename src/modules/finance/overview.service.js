import { Faculty } from "../faculty/faculty.model.js";
import { Staff } from "../staff/staff.model.js";
import { StudentFee } from "../fees/fees.model.js";
import { Expense, FinancePayment, IncomeRecord, PayrollItem, PayrollRun, SalaryStructure } from "./finance.models.js";
import { maybeSyncFeePayments } from "./payments.service.js";
import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";
import { money, remainingOf, toIsoDate } from "./finance.utils.js";

export async function getFinanceOverview() {
  await ensureFinanceDefaults();
  await maybeSyncFeePayments();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [
    feeAgg,
    monthFee,
    monthIncomePay,
    monthExpensePay,
    pendingPay,
    faculty,
    staff,
    structures,
    payrollMonth,
    recentFees,
    recentExpenses,
    recentIncome,
    recentSalary,
    overdueFees,
    pendingSalary,
    awaitingApproval,
    payrollGenerated,
    recurringDue,
  ] = await Promise.all([
    StudentFee.aggregate([{ $group: { _id: null, paid: { $sum: "$paidAmount" }, due: { $sum: "$dueAmount" } } }]),
    FinancePayment.aggregate([
      { $match: { sourceType: "FEE", status: { $in: ["Completed", "Partial"] }, date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    FinancePayment.aggregate([
      { $match: { direction: "IN", status: { $in: ["Completed", "Partial"] }, date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    FinancePayment.aggregate([
      { $match: { direction: "OUT", status: { $in: ["Completed", "Partial"] }, date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    FinancePayment.countDocuments({ status: "Pending" }),
    Faculty.countDocuments({ softDelete: false, status: "Active" }),
    Staff.countDocuments({ softDelete: { $ne: true }, isArchived: { $ne: true }, status: "Active" }),
    SalaryStructure.countDocuments({ status: "Active" }),
    PayrollItem.aggregate([
      { $match: { month, year, status: { $ne: "Cancelled" } } },
      {
        $group: {
          _id: null,
          net: { $sum: "$netPayable" },
          paid: { $sum: "$paidAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    FinancePayment.find({ sourceType: "FEE", status: { $in: ["Completed", "Partial"] } })
      .sort({ date: -1 })
      .limit(6)
      .lean(),
    Expense.find({ workflowStatus: { $ne: "Cancelled" } }).sort({ date: -1 }).limit(6).lean(),
    IncomeRecord.find({ status: { $ne: "Cancelled" } }).sort({ date: -1 }).limit(6).lean(),
    FinancePayment.find({ sourceType: "PAYROLL", status: { $in: ["Completed", "Partial"] } })
      .sort({ date: -1 })
      .limit(6)
      .lean(),
    StudentFee.countDocuments({ status: "Overdue" }),
    PayrollItem.countDocuments({ month, year, status: { $in: ["Approved", "Partially Paid", "Generated"] } }),
    Expense.countDocuments({ workflowStatus: "Submitted" }),
    PayrollRun.countDocuments({ month, year, status: { $ne: "Cancelled" } }),
    Expense.countDocuments({
      "recurring.enabled": true,
      "recurring.nextDueDate": { $ne: null, $lte: new Date(now.getTime() + 7 * 86400000) },
    }),
  ]);

  const monthlyIncome = monthIncomePay[0]?.total || 0;
  const monthlyExpenses = monthExpensePay[0]?.total || 0;
  const payroll = payrollMonth[0] || { net: 0, paid: 0, count: 0 };

  const alerts = [];
  if (overdueFees > 0) alerts.push({ tone: "warn", text: `${overdueFees} student fee${overdueFees === 1 ? "" : "s"} overdue` });
  if (pendingSalary > 0) alerts.push({ tone: "warn", text: `${pendingSalary} salary payment${pendingSalary === 1 ? "" : "s"} pending` });
  if (awaitingApproval > 0) alerts.push({ tone: "warn", text: `${awaitingApproval} expense${awaitingApproval === 1 ? "" : "s"} awaiting approval` });
  if (!payrollGenerated) alerts.push({ tone: "info", text: "Monthly payroll not generated yet" });
  if (recurringDue > 0) alerts.push({ tone: "info", text: `${recurringDue} recurring expense${recurringDue === 1 ? "" : "s"} due soon` });

  return {
    finance: {
      totalFeeCollected: feeAgg[0]?.paid || 0,
      pendingFees: feeAgg[0]?.due || 0,
      monthlyIncome,
      monthlyExpenses,
      netSurplus: monthlyIncome - monthlyExpenses,
      pendingPayments: pendingPay,
      thisMonthFeeCollection: monthFee[0]?.total || 0,
    },
    hr: {
      totalFaculty: faculty,
      totalStaff: staff,
      monthlyPayroll: payroll.net || 0,
      paidSalary: payroll.paid || 0,
      pendingSalary: Math.max(0, (payroll.net || 0) - (payroll.paid || 0)),
      activeSalaryStructures: structures,
    },
    alerts,
    recent: {
      feePayments: recentFees.map((p) => ({
        id: p.paymentId,
        date: toIsoDate(p.date),
        party: p.partyName,
        amount: money(p.amount),
        method: p.method,
      })),
      expenses: recentExpenses.map((e) => ({
        id: e.expenseId,
        date: toIsoDate(e.date),
        party: e.vendor || e.categoryName,
        amount: money(e.totalAmount),
        status: e.workflowStatus,
      })),
      income: recentIncome.map((e) => ({
        id: e.incomeId,
        date: toIsoDate(e.date),
        party: e.receivedFrom || e.categoryName,
        amount: money(e.totalAmount),
        status: e.status,
      })),
      salaryPayments: recentSalary.map((p) => ({
        id: p.paymentId,
        date: toIsoDate(p.date),
        party: p.partyName,
        amount: money(p.amount),
        method: p.method,
      })),
    },
  };
}

export async function getFinanceMeta() {
  await ensureFinanceDefaults();
  return {
    employeeTypes: ["FACULTY", "STAFF"],
    paymentMethods: ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Cheque", "Online Gateway", "Other"],
    salaryTypes: [
      "Monthly Fixed",
      "Per Class",
      "Per Lecture",
      "Per Hour",
      "Per Day",
      "Contract",
      "Daily Wage",
      "Hourly Wage",
    ],
  };
}

export { remainingOf };
