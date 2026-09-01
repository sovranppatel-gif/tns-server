import {
  UNIT_SALARY_TYPES,
} from "./finance.constants.js";
import { money, remainingOf } from "./finance.utils.js";

function resolveComponent(item, base) {
  const calcType = String(item?.calcType || "Fixed");
  const raw = Number(item?.amount) || 0;
  const resolved = calcType === "Percentage" ? money((money(base) * raw) / 100) : money(raw);
  return {
    name: String(item?.name || "").trim(),
    calcType: calcType === "Percentage" ? "Percentage" : "Fixed",
    amount: raw,
    resolvedAmount: resolved,
  };
}

export function calculateExpenseTotal({ amount = 0, taxAmount = 0 } = {}) {
  return {
    amount: money(amount),
    taxAmount: money(taxAmount),
    totalAmount: money(amount) + money(taxAmount),
  };
}

export function calculateIncomeTotal({ amount = 0, taxAmount = 0 } = {}) {
  return calculateExpenseTotal({ amount, taxAmount });
}

export function calculatePaymentBalance({ total = 0, paid = 0, refunded = 0 } = {}) {
  const tot = money(total);
  const collected = money(paid);
  const refund = money(refunded);
  const netPaid = Math.max(0, collected - refund);
  return {
    total: tot,
    paid: collected,
    refunded: refund,
    netPaid,
    outstanding: remainingOf(tot, netPaid),
  };
}

export function calculateOutstanding(total, paid) {
  return remainingOf(total, paid);
}

export function calculateSalary({
  basicSalary = 0,
  earnings = [],
  deductions = [],
} = {}) {
  const basic = money(basicSalary);
  const earningRows = (earnings || []).map((item) => resolveComponent(item, basic));
  const hasBasicLine = earningRows.some((row) => /^basic/i.test(row.name));
  if (!hasBasicLine && basic > 0) {
    earningRows.unshift({
      name: "Basic Salary",
      calcType: "Fixed",
      amount: basic,
      resolvedAmount: basic,
    });
  }

  const basicResolved = earningRows
    .filter((row) => /^basic/i.test(row.name))
    .reduce((sum, row) => sum + row.resolvedAmount, 0) || basic;

  let totalAllowances = 0;
  let totalIncentives = 0;
  let bonus = 0;
  for (const row of earningRows) {
    if (/^basic/i.test(row.name)) continue;
    if (/incentive/i.test(row.name)) totalIncentives += row.resolvedAmount;
    else if (/bonus/i.test(row.name)) bonus += row.resolvedAmount;
    else totalAllowances += row.resolvedAmount;
  }

  const deductionBase = basicResolved + totalAllowances + totalIncentives + bonus;
  const deductionRows = (deductions || []).map((item) => resolveComponent(item, deductionBase));
  const totalDeductions = deductionRows.reduce((sum, row) => sum + row.resolvedAmount, 0);
  const grossSalary = basicResolved + totalAllowances + totalIncentives + bonus;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    basicSalary: basicResolved,
    totalAllowances,
    totalIncentives,
    bonus,
    totalDeductions,
    grossSalary,
    netSalary,
    earnings: earningRows,
    deductions: deductionRows,
  };
}

export function calculatePayroll({
  salaryType = "Monthly Fixed",
  structure = {},
  unitsWorked = 0,
  adjustments = [],
  advanceRecovery = 0,
  loanRecovery = 0,
  leaveDeduction = 0,
} = {}) {
  const unitType = UNIT_SALARY_TYPES.has(salaryType);
  const rate = money(structure.unitRate || structure.basicSalary);
  const units = Math.max(0, Number(unitsWorked) || 0);

  let basicSalary = money(structure.basicSalary);
  let totalAllowances = money(structure.totalAllowances);
  let structureIncentives = money(structure.totalIncentives);
  let structureBonus = money(structure.bonus);

  if (unitType) {
    basicSalary = money(rate * units);
    totalAllowances = 0;
    structureIncentives = 0;
    structureBonus = 0;
  }

  let bonus = structureBonus;
  let incentives = structureIncentives;
  let overtime = 0;
  let reimbursement = 0;
  let otherEarnings = 0;
  let otherDeductions = 0;
  let extraLeave = money(leaveDeduction);

  for (const adj of adjustments || []) {
    const amt = money(adj.amount);
    const type = String(adj.type || "");
    if (type === "Bonus") bonus += amt;
    else if (type === "Incentive") incentives += amt;
    else if (type === "Overtime") overtime += amt;
    else if (type === "Reimbursement") reimbursement += amt;
    else if (type === "Other Earnings") otherEarnings += amt;
    else if (type === "Other Deductions") otherDeductions += amt;
    else if (type === "Leave Deduction") extraLeave += amt;
  }

  const grossSalary =
    basicSalary + totalAllowances + incentives + bonus + overtime + reimbursement + otherEarnings;
  const structureDeductions = unitType ? 0 : money(structure.totalDeductions);
  const advance = money(advanceRecovery);
  const loan = money(loanRecovery);
  const totalDeductions = structureDeductions + advance + loan + extraLeave + otherDeductions;
  const netPayable = Math.max(0, grossSalary - totalDeductions);

  return {
    salaryType,
    unitsWorked: units,
    unitRate: unitType ? rate : 0,
    basicSalary,
    totalAllowances,
    incentives,
    bonus,
    overtime,
    reimbursement,
    otherEarnings,
    otherDeductions,
    structureDeductions,
    advanceRecovery: advance,
    loanRecovery: loan,
    leaveDeduction: extraLeave,
    grossSalary,
    totalDeductions,
    netPayable,
  };
}
