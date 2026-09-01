import { Router } from "express";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { financeAttachmentUpload } from "./finance.upload.js";
import {
  adjustPayrollController,
  approveExpenseController,
  approvePayrollController,
  cancelExpenseController,
  cancelPayrollController,
  createAdvanceController,
  createExpenseController,
  createIncomeController,
  createJournalController,
  createLoanController,
  createSalaryController,
  financeReady,
  generatePayrollController,
  generateRecurringController,
  getAccountingDashboardController,
  getAccountingTxController,
  getCashFlowController,
  getEmployeesController,
  getExpenseController,
  getExpensesDashboardController,
  getFinanceMetaController,
  getFinanceOverviewController,
  getIncomeController,
  getIncomeDashboardController,
  getLedgerController,
  getPaymentController,
  getPaymentsDashboardController,
  getPayrollController,
  getPayrollDashboardController,
  getSalaryController,
  getSalaryOverviewController,
  listAccountingTxController,
  listAccountsController,
  listAdvancesController,
  listBooksController,
  listExpenseCategoriesController,
  listExpensesController,
  listIncomeCategoriesController,
  listIncomeController,
  listLoansController,
  listPaymentsController,
  listPayrollItemsController,
  listPayrollRunsController,
  listSalaryController,
  payExpenseController,
  payPayrollController,
  payslipController,
  receiveIncomeController,
  refundPaymentController,
  rejectExpenseController,
  reviseSalaryController,
  statusAccountController,
  statusExpenseCategoryController,
  statusIncomeCategoryController,
  submitExpenseController,
  syncFeesController,
  unitsPayrollController,
  updateExpenseController,
  updateIncomeController,
  updateSalaryController,
  uploadAttachmentController,
  upsertAccountController,
  upsertBookController,
  upsertExpenseCategoryController,
  upsertIncomeCategoryController,
} from "./finance.controller.js";

function withUpload(req, res, next) {
  financeAttachmentUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize = err.code === "LIMIT_FILE_SIZE" || /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize ? "File must be 2 MB or smaller" : err.message || "Upload failed",
      });
    }
    next();
  });
}

const financeRouter = Router();
financeRouter.use(requireMasterAdminJwt, financeReady);
financeRouter.get("/overview", getFinanceOverviewController);
financeRouter.get("/meta", getFinanceMetaController);
financeRouter.get("/employees", getEmployeesController);
financeRouter.post("/upload", withUpload, uploadAttachmentController);

const accountingRouter = Router();
accountingRouter.use(requireMasterAdminJwt, financeReady);
accountingRouter.get("/dashboard", getAccountingDashboardController);
accountingRouter.get("/accounts", listAccountsController);
accountingRouter.post("/accounts", upsertAccountController);
accountingRouter.patch("/accounts/:id/status", statusAccountController);
accountingRouter.get("/ledger", getLedgerController);
accountingRouter.get("/transactions", listAccountingTxController);
accountingRouter.get("/transactions/:id", getAccountingTxController);
accountingRouter.post("/journals", createJournalController);
accountingRouter.get("/cash-flow", getCashFlowController);
accountingRouter.get("/books", listBooksController);
accountingRouter.post("/books", upsertBookController);

const expensesRouter = Router();
expensesRouter.use(requireMasterAdminJwt, financeReady);
expensesRouter.get("/dashboard", getExpensesDashboardController);
expensesRouter.get("/categories", listExpenseCategoriesController);
expensesRouter.post("/categories", upsertExpenseCategoryController);
expensesRouter.patch("/categories/:id/status", statusExpenseCategoryController);
expensesRouter.post("/recurring/generate", generateRecurringController);
expensesRouter.get("/", listExpensesController);
expensesRouter.post("/", createExpenseController);
expensesRouter.get("/:id", getExpenseController);
expensesRouter.put("/:id", updateExpenseController);
expensesRouter.patch("/:id", updateExpenseController);
expensesRouter.post("/:id/submit", submitExpenseController);
expensesRouter.post("/:id/approve", approveExpenseController);
expensesRouter.post("/:id/reject", rejectExpenseController);
expensesRouter.post("/:id/cancel", cancelExpenseController);
expensesRouter.post("/:id/pay", payExpenseController);

const incomeRouter = Router();
incomeRouter.use(requireMasterAdminJwt, financeReady);
incomeRouter.get("/dashboard", getIncomeDashboardController);
incomeRouter.get("/categories", listIncomeCategoriesController);
incomeRouter.post("/categories", upsertIncomeCategoryController);
incomeRouter.patch("/categories/:id/status", statusIncomeCategoryController);
incomeRouter.get("/", listIncomeController);
incomeRouter.post("/", createIncomeController);
incomeRouter.get("/:id", getIncomeController);
incomeRouter.put("/:id", updateIncomeController);
incomeRouter.patch("/:id", updateIncomeController);
incomeRouter.post("/:id/receive-payment", receiveIncomeController);

const salaryRouter = Router();
salaryRouter.use(requireMasterAdminJwt, financeReady);
salaryRouter.get("/overview", getSalaryOverviewController);
salaryRouter.get("/", listSalaryController);
salaryRouter.post("/", createSalaryController);
salaryRouter.get("/:id", getSalaryController);
salaryRouter.put("/:id", updateSalaryController);
salaryRouter.patch("/:id", updateSalaryController);
salaryRouter.post("/:id/revise", reviseSalaryController);

const advancesRouter = Router();
advancesRouter.use(requireMasterAdminJwt, financeReady);
advancesRouter.get("/", listAdvancesController);
advancesRouter.post("/", createAdvanceController);

const loansRouter = Router();
loansRouter.use(requireMasterAdminJwt, financeReady);
loansRouter.get("/", listLoansController);
loansRouter.post("/", createLoanController);

const payrollRouter = Router();
payrollRouter.use(requireMasterAdminJwt, financeReady);
payrollRouter.get("/dashboard", getPayrollDashboardController);
payrollRouter.post("/generate", generatePayrollController);
payrollRouter.get("/runs", listPayrollRunsController);
payrollRouter.get("/", listPayrollItemsController);
payrollRouter.get("/:id/payslip", payslipController);
payrollRouter.get("/:id", getPayrollController);
payrollRouter.post("/:id/approve", approvePayrollController);
payrollRouter.post("/:id/pay", payPayrollController);
payrollRouter.post("/:id/adjust", adjustPayrollController);
payrollRouter.post("/:id/units", unitsPayrollController);
payrollRouter.post("/:id/cancel", cancelPayrollController);

const paymentsRouter = Router();
paymentsRouter.use(requireMasterAdminJwt, financeReady);
paymentsRouter.get("/dashboard", getPaymentsDashboardController);
paymentsRouter.get("/cash-flow", getCashFlowController);
paymentsRouter.get("/accounts", listBooksController);
paymentsRouter.post("/accounts", upsertBookController);
paymentsRouter.post("/sync-fees", syncFeesController);
paymentsRouter.get("/", listPaymentsController);
paymentsRouter.get("/:id", getPaymentController);
paymentsRouter.post("/:id/refund", refundPaymentController);

export {
  accountingRouter,
  advancesRouter,
  expensesRouter,
  financeRouter,
  incomeRouter,
  loansRouter,
  paymentsRouter,
  payrollRouter,
  salaryRouter,
};
