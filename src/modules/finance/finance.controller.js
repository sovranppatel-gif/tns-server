import { ensureFinanceDefaults } from "./seedFinanceDefaults.js";
import {
  createManualJournal,
  getAccountingDashboard,
  getAccountingTransaction,
  getLedger,
  listAccountingTransactions,
  listChartAccounts,
  setChartAccountStatus,
  upsertChartAccount,
} from "./accounting.service.js";
import {
  approveExpense,
  cancelExpense,
  createExpense,
  generateRecurringExpenses,
  getExpenseById,
  getExpensesDashboard,
  listExpenseCategories,
  listExpenses,
  payExpense,
  rejectExpense,
  setExpenseCategoryStatus,
  submitExpense,
  updateExpense,
  upsertExpenseCategory,
} from "./expenses.service.js";
import {
  createIncome,
  getIncomeById,
  getIncomeDashboard,
  listIncome,
  listIncomeCategories,
  receiveIncomePayment,
  setIncomeCategoryStatus,
  updateIncome,
  upsertIncomeCategory,
} from "./income.service.js";
import {
  createAdvance,
  createLoan,
  createSalaryStructure,
  getSalaryOverview,
  getSalaryStructure,
  listAdvances,
  listFinanceEmployees,
  listLoans,
  listSalaryStructures,
  reviseSalaryStructure,
  updateSalaryStructure,
} from "./salary.service.js";
import {
  addPayrollAdjustment,
  approvePayrollItem,
  approvePayrollRun,
  cancelPayrollItem,
  generatePayroll,
  getPayrollDashboard,
  getPayrollItem,
  getPayrollRun,
  getPayslip,
  listPayrollItems,
  listPayrollRuns,
  payPayrollItem,
  updatePayrollUnits,
} from "./payroll.service.js";
import {
  getCashFlow,
  getPaymentById,
  getPaymentsDashboard,
  listFinancialAccounts,
  listPayments,
  maybeSyncFeePayments,
  refundFinancePayment,
  syncFeePaymentsIntoFinance,
  upsertFinancialAccount,
} from "./payments.service.js";
import { getFinanceMeta, getFinanceOverview } from "./overview.service.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function fail(res, err, fallback) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : err.message || fallback,
  });
}

export async function financeReady(_req, res, next) {
  try {
    await ensureFinanceDefaults();
    next();
  } catch (err) {
    return fail(res, err, "Failed to initialise finance module");
  }
}

export async function getFinanceOverviewController(_req, res) {
  try {
    const data = await getFinanceOverview();
    return res.json({ success: true, message: "Finance overview fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch finance overview");
  }
}

export async function getFinanceMetaController(_req, res) {
  try {
    const meta = await getFinanceMeta();
    return res.json({ success: true, message: "Finance options fetched", ...meta });
  } catch (err) {
    return fail(res, err, "Failed to fetch finance options");
  }
}

export async function getEmployeesController(req, res) {
  try {
    const rows = await listFinanceEmployees(req.query);
    return res.json({ success: true, message: "Employees fetched", rows });
  } catch (err) {
    return fail(res, err, "Failed to fetch employees");
  }
}

export async function uploadAttachmentController(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const url = `/uploads/finance/attachments/${req.file.filename}`;
    return res.json({
      success: true,
      message: "Uploaded",
      url,
      name: req.file.originalname,
    });
  } catch (err) {
    return fail(res, err, "Failed to upload attachment");
  }
}

export async function getAccountingDashboardController(req, res) {
  try {
    const stats = await getAccountingDashboard(req.query);
    return res.json({ success: true, message: "Accounting dashboard fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch accounting dashboard");
  }
}

export async function listAccountsController(req, res) {
  try {
    const rows = await listChartAccounts(req.query);
    return res.json({ success: true, message: "Accounts fetched", rows });
  } catch (err) {
    return fail(res, err, "Failed to fetch accounts");
  }
}

export async function upsertAccountController(req, res) {
  try {
    const entry = await upsertChartAccount(req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Account saved", entry });
  } catch (err) {
    return fail(res, err, "Failed to save account");
  }
}

export async function statusAccountController(req, res) {
  try {
    const entry = await setChartAccountStatus(req.params.id, req.body?.status, getEditor(req));
    return res.json({ success: true, message: "Account status updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update account");
  }
}

export async function getLedgerController(req, res) {
  try {
    const data = await getLedger(req.query);
    return res.json({ success: true, message: "Ledger fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch ledger");
  }
}

export async function listAccountingTxController(req, res) {
  try {
    const data = await listAccountingTransactions(req.query);
    return res.json({ success: true, message: "Transactions fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch transactions");
  }
}

export async function getAccountingTxController(req, res) {
  try {
    const entry = await getAccountingTransaction(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Transaction not found" });
    return res.json({ success: true, message: "Transaction fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch transaction");
  }
}

export async function createJournalController(req, res) {
  try {
    const entry = await createManualJournal(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Journal posted", entry });
  } catch (err) {
    return fail(res, err, "Failed to post journal");
  }
}

export async function getExpensesDashboardController(req, res) {
  try {
    const stats = await getExpensesDashboard(req.query);
    return res.json({ success: true, message: "Expense dashboard fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch expense dashboard");
  }
}

export async function listExpenseCategoriesController(_req, res) {
  try {
    const rows = await listExpenseCategories();
    return res.json({ success: true, message: "Categories fetched", rows });
  } catch (err) {
    return fail(res, err, "Failed to fetch categories");
  }
}

export async function upsertExpenseCategoryController(req, res) {
  try {
    const entry = await upsertExpenseCategory(req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Category saved", entry });
  } catch (err) {
    return fail(res, err, "Failed to save category");
  }
}

export async function statusExpenseCategoryController(req, res) {
  try {
    const entry = await setExpenseCategoryStatus(req.params.id, req.body?.status, getEditor(req));
    return res.json({ success: true, message: "Category updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update category");
  }
}

export async function listExpensesController(req, res) {
  try {
    const data = await listExpenses(req.query);
    return res.json({ success: true, message: "Expenses fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch expenses");
  }
}

export async function getExpenseController(req, res) {
  try {
    const entry = await getExpenseById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Expense not found" });
    return res.json({ success: true, message: "Expense fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch expense");
  }
}

export async function createExpenseController(req, res) {
  try {
    const entry = await createExpense(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Expense created", entry });
  } catch (err) {
    return fail(res, err, "Failed to create expense");
  }
}

export async function updateExpenseController(req, res) {
  try {
    const entry = await updateExpense(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Expense updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update expense");
  }
}

export async function submitExpenseController(req, res) {
  try {
    const entry = await submitExpense(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Expense submitted", entry });
  } catch (err) {
    return fail(res, err, "Failed to submit expense");
  }
}

export async function approveExpenseController(req, res) {
  try {
    const entry = await approveExpense(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Expense approved", entry });
  } catch (err) {
    return fail(res, err, "Failed to approve expense");
  }
}

export async function rejectExpenseController(req, res) {
  try {
    const entry = await rejectExpense(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Expense rejected", entry });
  } catch (err) {
    return fail(res, err, "Failed to reject expense");
  }
}

export async function cancelExpenseController(req, res) {
  try {
    const entry = await cancelExpense(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Expense cancelled", entry });
  } catch (err) {
    return fail(res, err, "Failed to cancel expense");
  }
}

export async function payExpenseController(req, res) {
  try {
    const entry = await payExpense(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Expense payment recorded", entry });
  } catch (err) {
    return fail(res, err, "Failed to record expense payment");
  }
}

export async function generateRecurringController(req, res) {
  try {
    const data = await generateRecurringExpenses(getEditor(req));
    return res.json({ success: true, message: "Recurring expenses generated", ...data });
  } catch (err) {
    return fail(res, err, "Failed to generate recurring expenses");
  }
}

export async function getIncomeDashboardController(req, res) {
  try {
    const stats = await getIncomeDashboard(req.query);
    return res.json({ success: true, message: "Income dashboard fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch income dashboard");
  }
}

export async function listIncomeCategoriesController(_req, res) {
  try {
    const rows = await listIncomeCategories();
    return res.json({ success: true, message: "Categories fetched", rows });
  } catch (err) {
    return fail(res, err, "Failed to fetch categories");
  }
}

export async function upsertIncomeCategoryController(req, res) {
  try {
    const entry = await upsertIncomeCategory(req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Category saved", entry });
  } catch (err) {
    return fail(res, err, "Failed to save category");
  }
}

export async function statusIncomeCategoryController(req, res) {
  try {
    const entry = await setIncomeCategoryStatus(req.params.id, req.body?.status, getEditor(req));
    return res.json({ success: true, message: "Category updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update category");
  }
}

export async function listIncomeController(req, res) {
  try {
    const data = await listIncome(req.query);
    return res.json({ success: true, message: "Income fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch income");
  }
}

export async function getIncomeController(req, res) {
  try {
    const entry = await getIncomeById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Income not found" });
    return res.json({ success: true, message: "Income fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch income");
  }
}

export async function createIncomeController(req, res) {
  try {
    const entry = await createIncome(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Income created", entry });
  } catch (err) {
    return fail(res, err, "Failed to create income");
  }
}

export async function updateIncomeController(req, res) {
  try {
    const entry = await updateIncome(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Income updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update income");
  }
}

export async function receiveIncomeController(req, res) {
  try {
    const entry = await receiveIncomePayment(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Income received", entry });
  } catch (err) {
    return fail(res, err, "Failed to receive income");
  }
}

export async function getSalaryOverviewController(_req, res) {
  try {
    const stats = await getSalaryOverview();
    return res.json({ success: true, message: "Salary overview fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch salary overview");
  }
}

export async function listSalaryController(req, res) {
  try {
    const data = await listSalaryStructures(req.query);
    return res.json({ success: true, message: "Salary structures fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch salary structures");
  }
}

export async function getSalaryController(req, res) {
  try {
    const entry = await getSalaryStructure(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Salary structure not found" });
    return res.json({ success: true, message: "Salary structure fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch salary structure");
  }
}

export async function createSalaryController(req, res) {
  try {
    const entry = await createSalaryStructure(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Salary structure created", entry });
  } catch (err) {
    return fail(res, err, "Failed to create salary structure");
  }
}

export async function updateSalaryController(req, res) {
  try {
    const entry = await updateSalaryStructure(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Salary structure updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update salary structure");
  }
}

export async function reviseSalaryController(req, res) {
  try {
    const entry = await reviseSalaryStructure(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Salary revised", entry });
  } catch (err) {
    return fail(res, err, "Failed to revise salary");
  }
}

export async function listAdvancesController(req, res) {
  try {
    const data = await listAdvances(req.query);
    return res.json({ success: true, message: "Advances fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch advances");
  }
}

export async function createAdvanceController(req, res) {
  try {
    const entry = await createAdvance(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Advance created", entry });
  } catch (err) {
    return fail(res, err, "Failed to create advance");
  }
}

export async function listLoansController(req, res) {
  try {
    const data = await listLoans(req.query);
    return res.json({ success: true, message: "Loans fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch loans");
  }
}

export async function createLoanController(req, res) {
  try {
    const entry = await createLoan(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Loan created", entry });
  } catch (err) {
    return fail(res, err, "Failed to create loan");
  }
}

export async function getPayrollDashboardController(req, res) {
  try {
    const stats = await getPayrollDashboard(req.query);
    return res.json({ success: true, message: "Payroll dashboard fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch payroll dashboard");
  }
}

export async function generatePayrollController(req, res) {
  try {
    const data = await generatePayroll(req.body || {}, getEditor(req));
    return res.status(201).json({ success: true, message: "Payroll generated", ...data });
  } catch (err) {
    return fail(res, err, "Failed to generate payroll");
  }
}

export async function listPayrollRunsController(req, res) {
  try {
    const data = await listPayrollRuns(req.query);
    return res.json({ success: true, message: "Payroll runs fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch payroll runs");
  }
}

export async function listPayrollItemsController(req, res) {
  try {
    const data = await listPayrollItems(req.query);
    return res.json({ success: true, message: "Payroll fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch payroll");
  }
}

export async function getPayrollController(req, res) {
  try {
    const run = await getPayrollRun(req.params.id);
    if (run) return res.json({ success: true, message: "Payroll run fetched", entry: run, kind: "run" });
    const item = await getPayrollItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Payroll not found" });
    return res.json({ success: true, message: "Payroll item fetched", entry: item, kind: "item" });
  } catch (err) {
    return fail(res, err, "Failed to fetch payroll");
  }
}

export async function approvePayrollController(req, res) {
  try {
    const run = await getPayrollRun(req.params.id);
    if (run) {
      const entry = await approvePayrollRun(req.params.id, getEditor(req));
      return res.json({ success: true, message: "Payroll run approved", entry });
    }
    const entry = await approvePayrollItem(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Payroll approved", entry });
  } catch (err) {
    return fail(res, err, "Failed to approve payroll");
  }
}

export async function payPayrollController(req, res) {
  try {
    const entry = await payPayrollItem(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Salary payment recorded", entry });
  } catch (err) {
    return fail(res, err, "Failed to record salary payment");
  }
}

export async function adjustPayrollController(req, res) {
  try {
    const entry = await addPayrollAdjustment(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Adjustment added", entry });
  } catch (err) {
    return fail(res, err, "Failed to add adjustment");
  }
}

export async function unitsPayrollController(req, res) {
  try {
    const entry = await updatePayrollUnits(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Units updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update units");
  }
}

export async function cancelPayrollController(req, res) {
  try {
    const entry = await cancelPayrollItem(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Payroll cancelled", entry });
  } catch (err) {
    return fail(res, err, "Failed to cancel payroll");
  }
}

export async function payslipController(req, res) {
  try {
    const entry = await getPayslip(req.params.id);
    return res.json({ success: true, message: "Payslip fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch payslip");
  }
}

export async function getPaymentsDashboardController(req, res) {
  try {
    await maybeSyncFeePayments();
    const stats = await getPaymentsDashboard(req.query);
    return res.json({ success: true, message: "Payments dashboard fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch payments dashboard");
  }
}

export async function listPaymentsController(req, res) {
  try {
    const data = await listPayments(req.query);
    return res.json({ success: true, message: "Payments fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch payments");
  }
}

export async function getPaymentController(req, res) {
  try {
    const entry = await getPaymentById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.json({ success: true, message: "Payment fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch payment");
  }
}

export async function refundPaymentController(req, res) {
  try {
    const data = await refundFinancePayment(req.params.id, req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Refund recorded", ...data });
  } catch (err) {
    return fail(res, err, "Failed to record refund");
  }
}

export async function syncFeesController(_req, res) {
  try {
    const data = await syncFeePaymentsIntoFinance();
    return res.json({ success: true, message: "Fee payments synced", ...data });
  } catch (err) {
    return fail(res, err, "Failed to sync fee payments");
  }
}

export async function listBooksController(_req, res) {
  try {
    const rows = await listFinancialAccounts();
    return res.json({ success: true, message: "Financial accounts fetched", rows });
  } catch (err) {
    return fail(res, err, "Failed to fetch financial accounts");
  }
}

export async function upsertBookController(req, res) {
  try {
    const entry = await upsertFinancialAccount(req.body || {}, getEditor(req));
    return res.json({ success: true, message: "Financial account saved", entry });
  } catch (err) {
    return fail(res, err, "Failed to save financial account");
  }
}

export async function getCashFlowController(req, res) {
  try {
    const data = await getCashFlow(req.query);
    return res.json({ success: true, message: "Cash flow fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch cash flow");
  }
}
