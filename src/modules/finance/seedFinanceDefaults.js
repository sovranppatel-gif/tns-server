import {
  CHART_ACCOUNTS,
  EXPENSE_CATEGORIES,
  FINANCIAL_ACCOUNTS,
  INCOME_CATEGORIES,
} from "./finance.constants.js";
import {
  ChartAccount,
  ExpenseCategory,
  FinancialAccount,
  IncomeCategory,
} from "./finance.models.js";

let seeded = false;
let seeding = null;

export async function ensureFinanceDefaults() {
  if (seeded) return;
  if (seeding) return seeding;
  seeding = (async () => {
    const [accounts, books, expenseCats, incomeCats] = await Promise.all([
      ChartAccount.countDocuments(),
      FinancialAccount.countDocuments(),
      ExpenseCategory.countDocuments(),
      IncomeCategory.countDocuments(),
    ]);

    if (!accounts) {
      await ChartAccount.insertMany(
        CHART_ACCOUNTS.map((row) => ({ ...row, system: true, status: "Active" }))
      );
    } else {
      for (const row of CHART_ACCOUNTS) {
        await ChartAccount.updateOne(
          { code: row.code },
          { $setOnInsert: { ...row, system: true, status: "Active" } },
          { upsert: true }
        );
      }
    }

    if (!books) {
      await FinancialAccount.insertMany(
        FINANCIAL_ACCOUNTS.map((row) => ({
          ...row,
          openingBalance: 0,
          currentBalance: 0,
          status: "Active",
        }))
      );
    }

    if (!expenseCats) {
      await ExpenseCategory.insertMany(
        EXPENSE_CATEGORIES.map((row) => ({ ...row, system: true, status: "Active" }))
      );
    } else {
      for (const row of EXPENSE_CATEGORIES) {
        await ExpenseCategory.updateOne(
          { name: row.name },
          { $setOnInsert: { ...row, system: true, status: "Active" } },
          { upsert: true }
        );
      }
    }

    if (!incomeCats) {
      await IncomeCategory.insertMany(
        INCOME_CATEGORIES.map((row) => ({ ...row, status: "Active" }))
      );
    } else {
      for (const row of INCOME_CATEGORIES) {
        await IncomeCategory.updateOne(
          { name: row.name },
          { $setOnInsert: { ...row, status: "Active" } },
          { upsert: true }
        );
      }
    }

    seeded = true;
  })();
  try {
    await seeding;
  } finally {
    seeding = null;
  }
}
