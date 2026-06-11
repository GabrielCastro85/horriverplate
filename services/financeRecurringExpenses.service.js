const {
  decimalToNumber,
  formatCurrencyBR,
  formatDateBR,
  formatDateInput,
  formatMonthYearLabel,
  getTransactionCategoryLabel,
  roundCurrency,
} = require("../utils/finance");

function monthKey(month, year) {
  return Number(year) * 100 + Number(month);
}

function clampDayForMonth(year, month, dayOfMonth) {
  const maxDay = new Date(Number(year), Number(month), 0).getDate();
  return Math.max(1, Math.min(Number(dayOfMonth) || 1, maxDay));
}

function buildRecurringExpenseDate(year, month, dayOfMonth) {
  const day = clampDayForMonth(year, month, dayOfMonth);
  return new Date(Date.UTC(Number(year), Number(month) - 1, day, 12, 0, 0, 0));
}

function isRecurringExpenseApplicable(rule, month, year) {
  if (!rule?.isActive) return false;

  const current = monthKey(month, year);
  const start = monthKey(rule.startMonth, rule.startYear);
  const end = rule.endMonth && rule.endYear ? monthKey(rule.endMonth, rule.endYear) : null;

  return current >= start && (!end || current <= end);
}

function buildRecurringExpenseDescription(rule, month, year) {
  const base = rule.description || rule.name || "Despesa fixa";
  return `${base} - ${formatMonthYearLabel(month, year)}`;
}

function isMissingRecurringExpenseTableError(error) {
  return error?.code === "P2021" || error?.code === "P2022";
}

function decorateRecurringExpense(rule, month, year) {
  const currentRun = (rule.runs || []).find((run) => Number(run.month) === Number(month) && Number(run.year) === Number(year)) || null;
  const latestRun = (rule.runs || [])[0] || null;
  const amount = decimalToNumber(rule.amount);
  const currentTransaction = currentRun?.cashTransaction || null;

  return {
    ...rule,
    amount,
    amountLabel: formatCurrencyBR(amount),
    categoryLabel: getTransactionCategoryLabel(rule.category),
    scheduledDate: buildRecurringExpenseDate(year, month, rule.dayOfMonth),
    scheduledDateInput: formatDateInput(buildRecurringExpenseDate(year, month, rule.dayOfMonth)),
    scheduledDateLabel: formatDateBR(buildRecurringExpenseDate(year, month, rule.dayOfMonth)),
    currentRun,
    currentTransaction,
    currentGenerated: Boolean(currentRun),
    currentGeneratedAtLabel: currentRun ? formatDateBR(currentRun.generatedAt) : "",
    currentTransactionDateLabel: currentTransaction ? formatDateBR(currentTransaction.date) : "",
    latestRun,
    latestRunLabel: latestRun ? formatMonthYearLabel(latestRun.month, latestRun.year) : "Nunca",
    applicableThisMonth: isRecurringExpenseApplicable(rule, month, year),
  };
}

async function ensureRecurringExpensesForMonth({
  prisma,
  month,
  year,
  recurringExpenseIds = null,
}) {
  const idFilter = Array.isArray(recurringExpenseIds)
    ? recurringExpenseIds.map((id) => Number(id)).filter(Number.isFinite)
    : null;

  let rules = [];
  try {
    rules = await prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        ...(idFilter?.length ? { id: { in: idFilter } } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingRecurringExpenseTableError(error)) {
      return { created: [], existing: [], errors: [], results: [], unavailable: true };
    }
    throw error;
  }

  const applicableRules = rules.filter((rule) => isRecurringExpenseApplicable(rule, month, year));
  const results = [];

  for (const rule of applicableRules) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existingRun = await tx.recurringExpenseRun.findUnique({
          where: {
            recurring_expense_month_year: {
              recurringExpenseId: rule.id,
              month: Number(month),
              year: Number(year),
            },
          },
          include: { cashTransaction: true },
        });

        if (existingRun) {
          return { status: "existing", rule, run: existingRun, transaction: existingRun.cashTransaction };
        }

        const transaction = await tx.cashTransaction.create({
          data: {
            type: "EXPENSE",
            category: rule.category,
            amount: roundCurrency(rule.amount),
            description: buildRecurringExpenseDescription(rule, month, year),
            date: buildRecurringExpenseDate(year, month, rule.dayOfMonth),
            note: rule.note || null,
            origin: "RECURRING_EXPENSE",
          },
        });

        const run = await tx.recurringExpenseRun.create({
          data: {
            recurringExpenseId: rule.id,
            month: Number(month),
            year: Number(year),
            cashTransactionId: transaction.id,
          },
        });

        return { status: "created", rule, run, transaction };
      });

      results.push(result);
    } catch (error) {
      if (error?.code === "P2002") {
        results.push({ status: "existing", rule, run: null, transaction: null });
      } else {
        results.push({ status: "error", rule, error });
      }
    }
  }

  return {
    created: results.filter((item) => item.status === "created"),
    existing: results.filter((item) => item.status === "existing"),
    errors: results.filter((item) => item.status === "error"),
    results,
  };
}

async function loadRecurringExpensesPanel({ prisma, month, year, selectedId = null }) {
  let recurringExpenses = [];

  try {
    recurringExpenses = await prisma.recurringExpense.findMany({
      include: {
        runs: {
          include: { cashTransaction: true },
          orderBy: [{ year: "desc" }, { month: "desc" }, { id: "desc" }],
          take: 18,
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    if (isMissingRecurringExpenseTableError(error)) {
      return {
        rules: [],
        selectedRecurringExpense: null,
        activeCount: 0,
        generatedThisMonthCount: 0,
        pendingThisMonthCount: 0,
        unavailable: true,
      };
    }
    throw error;
  }

  const rules = recurringExpenses.map((rule) => decorateRecurringExpense(rule, month, year));
  const selectedRecurringExpense = selectedId
    ? rules.find((rule) => Number(rule.id) === Number(selectedId)) || null
    : null;

  return {
    rules,
    selectedRecurringExpense,
    activeCount: rules.filter((rule) => rule.isActive).length,
    generatedThisMonthCount: rules.filter((rule) => rule.currentGenerated).length,
    pendingThisMonthCount: rules.filter((rule) => rule.applicableThisMonth && !rule.currentGenerated).length,
  };
}

module.exports = {
  buildRecurringExpenseDate,
  buildRecurringExpenseDescription,
  decorateRecurringExpense,
  ensureRecurringExpensesForMonth,
  isRecurringExpenseApplicable,
  loadRecurringExpensesPanel,
};
