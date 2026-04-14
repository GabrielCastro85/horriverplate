const path = require("path");
const { pathToFileURL } = require("url");

const prismaClient = require("../utils/db");
const {
  decimalToNumber,
  roundCurrency,
  formatCurrencyBR,
  formatMonthYearLabel,
  formatDateBR,
  formatDateBRShortYear,
  formatDateInput,
  formatDateTimeBR,
  getMonthDateRange,
  getTransactionCategoryLabel,
  getPaymentMethodLabel,
} = require("../utils/finance");
const {
  REPORT_TYPE_META,
  REPORT_SCOPE_OPTIONS,
  REPORT_TYPE_OPTIONS,
} = require("../constants/finance");
const {
  parseFinanceCompetence,
  getTrimmedString,
} = require("../helpers/financeInput.helper");
const {
  decorateMonthlyFee,
  getSaoPauloTodayDate,
  syncMonthlyCompetenceRules,
} = require("./financeAutomation.service");
const { getFinanceReportHistory } = require("./financeEventLog.service");

function normalizeFinanceReportType(value) {
  const normalized = String(value || "FULL").trim().toUpperCase();
  return REPORT_TYPE_META[normalized] ? normalized : "FULL";
}

function normalizeFinanceReportScope(value, reportType = "FULL") {
  if (reportType === "ANNUAL_SUMMARY") return "YEARLY";
  const normalized = String(value || "MONTHLY").trim().toUpperCase();
  return REPORT_SCOPE_OPTIONS.some((item) => item.value === normalized) ? normalized : "MONTHLY";
}

function parseDateParts(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function buildUtcDateFromParts(parts, hour = 3) {
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0, 0));
}

function shiftUtcDays(date, amount) {
  return new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);
}

function monthStartUtc(year, month) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1, 3, 0, 0, 0));
}

function buildMonthlyPairsBetween(start, endExclusive) {
  const pairs = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12, 0, 0, 0));
  const last = new Date(endExclusive.getTime() - 1);
  const limit = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1, 12, 0, 0, 0));

  while (cursor <= limit) {
    pairs.push({
      month: cursor.getUTCMonth() + 1,
      year: cursor.getUTCFullYear(),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return pairs;
}

function buildReportPeriod(params) {
  const reportType = normalizeFinanceReportType(params.reportType);
  const scope = normalizeFinanceReportScope(params.reportScope, reportType);

  if (scope === "CUSTOM") {
    const startParts = parseDateParts(params.reportStart);
    const endParts = parseDateParts(params.reportEnd);
    const startInput = buildUtcDateFromParts(startParts, 3);
    const endInput = buildUtcDateFromParts(endParts, 3);

    if (startInput && endInput && startInput <= endInput) {
      const start = startInput;
      const end = shiftUtcDays(endInput, 1);

      return {
        scope,
        start,
        end,
        label: `${formatDateBR(start)} a ${formatDateBR(shiftUtcDays(end, -1))}`,
        shortLabel: `${formatDateBR(start)}-${formatDateBR(shiftUtcDays(end, -1))}`,
        month: params.month,
        year: params.year,
      };
    }
  }

  if (scope === "YEARLY") {
    const start = monthStartUtc(params.year, 1);
    const end = monthStartUtc(Number(params.year) + 1, 1);
    return {
      scope,
      start,
      end,
      label: `Ano de ${params.year}`,
      shortLabel: String(params.year),
      month: params.month,
      year: params.year,
    };
  }

  const { start, end } = getMonthDateRange(params.year, params.month);
  return {
    scope: "MONTHLY",
    start,
    end,
    label: formatMonthYearLabel(params.month, params.year),
    shortLabel: formatMonthYearLabel(params.month, params.year),
    month: params.month,
    year: params.year,
  };
}

function buildComparisonPeriod(period) {
  if (period.scope === "YEARLY") {
    return buildReportPeriod({
      reportType: "ANNUAL_SUMMARY",
      reportScope: "YEARLY",
      year: period.year - 1,
      month: 1,
    });
  }

  if (period.scope === "CUSTOM") {
    const duration = period.end.getTime() - period.start.getTime();
    const end = new Date(period.start.getTime());
    const start = new Date(end.getTime() - duration);
    return {
      scope: "CUSTOM",
      start,
      end,
      label: `${formatDateBR(start)} a ${formatDateBR(shiftUtcDays(end, -1))}`,
      shortLabel: `${formatDateBR(start)}-${formatDateBR(shiftUtcDays(end, -1))}`,
      month: start.getUTCMonth() + 1,
      year: start.getUTCFullYear(),
    };
  }

  const previousMonth = period.month === 1 ? 12 : period.month - 1;
  const previousYear = period.month === 1 ? period.year - 1 : period.year;
  return buildReportPeriod({
    reportType: "FULL",
    reportScope: "MONTHLY",
    month: previousMonth,
    year: previousYear,
  });
}

function buildFeeWhereForPeriod(period) {
  const pairs = buildMonthlyPairsBetween(period.start, period.end);
  if (pairs.length === 1) {
    return pairs[0];
  }

  return {
    OR: pairs.map((pair) => ({
      month: pair.month,
      year: pair.year,
    })),
  };
}

function buildCashOriginLabel(transaction) {
  if (transaction.origin === "MONTHLY_FEE") {
    const playerName = transaction.player?.name || transaction.monthlyFee?.player?.name || "Participante";
    const monthLabel = transaction.monthlyFee
      ? formatMonthYearLabel(transaction.monthlyFee.month, transaction.monthlyFee.year)
      : null;
    return monthLabel ? `${playerName} - ${monthLabel}` : `${playerName} - Mensalidade`;
  }

  if (transaction.origin === "GUEST_PAYMENT") {
    const guestName = transaction.guestPayment?.guestName || "Convidado";
    return `Convidado - ${guestName}`;
  }

  return `Lancamento manual - ${transaction.description}`;
}

function getTransactionOriginMode(transaction) {
  return transaction.origin === "MANUAL" ? "Manual" : "Automatico";
}

function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function aggregateExpenseDistribution(transactions) {
  const expenses = transactions.filter((transaction) => transaction.type === "EXPENSE");
  const total = expenses.reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0);

  const byCategory = new Map();
  expenses.forEach((transaction) => {
    const key = transaction.category || "OTHER_EXPENSE";
    const current = byCategory.get(key) || 0;
    byCategory.set(key, roundCurrency(current + decimalToNumber(transaction.amount)));
  });

  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      label: getTransactionCategoryLabel(category),
      amount,
      amountLabel: formatCurrencyBR(amount),
      percentage: total > 0 ? (amount / total) * 100 : 0,
      percentageLabel: formatPercent(total > 0 ? (amount / total) * 100 : 0),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function aggregateFeeContributors(monthlyFees) {
  const map = new Map();

  monthlyFees.forEach((fee) => {
    const key = fee.playerId;
    const current = map.get(key) || {
      playerId: fee.playerId,
      playerName: fee.player?.name || "Participante",
      nickname: fee.player?.nickname || "",
      position: fee.player?.position || "",
      totalDue: 0,
      totalPaid: 0,
      totalBalance: 0,
      pendingCompetences: 0,
    };

    current.totalDue = roundCurrency(current.totalDue + decimalToNumber(fee.amountDue));
    current.totalPaid = roundCurrency(current.totalPaid + decimalToNumber(fee.amountPaid));
    current.totalBalance = roundCurrency(current.totalBalance + roundCurrency(fee.balance || 0));
    if (roundCurrency(fee.balance || 0) > 0) current.pendingCompetences += 1;
    map.set(key, current);
  });

  return Array.from(map.values());
}

function buildCashRows(cashTransactions, startingBalance) {
  let runningBalance = roundCurrency(startingBalance);
  return cashTransactions
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id)
    .map((transaction) => {
      const amount = decimalToNumber(transaction.amount);
      runningBalance = roundCurrency(
        transaction.type === "INCOME" ? runningBalance + amount : runningBalance - amount
      );

      return {
        id: transaction.id,
        date: transaction.date,
        dateLabel: formatDateBR(transaction.date),
        type: transaction.type,
        typeLabel: transaction.type === "INCOME" ? "Entrada" : "Saida",
        category: transaction.category,
        categoryLabel: getTransactionCategoryLabel(transaction.category),
        description: transaction.description,
        originLabel: buildCashOriginLabel(transaction),
        originModeLabel: getTransactionOriginMode(transaction),
        amount,
        amountLabel: formatCurrencyBR(amount),
        balanceAfter: runningBalance,
        balanceAfterLabel: formatCurrencyBR(runningBalance),
      };
    });
}

function buildMonthlyRows(monthlyFees) {
  return monthlyFees.map((fee) => ({
    id: fee.id,
    playerName: fee.player?.name || "Participante",
    playerSubtitle: fee.player?.nickname
      ? `${fee.player.position || "-"} - ${fee.player.nickname}`
      : fee.player?.position || "-",
    status: fee.collectionStatus,
    statusLabel: fee.collectionStatusMeta.label,
    due: decimalToNumber(fee.amountDue),
    dueLabel: formatCurrencyBR(fee.amountDue),
    paid: decimalToNumber(fee.amountPaid),
    paidLabel: formatCurrencyBR(fee.amountPaid),
    balance: fee.balance,
    balanceLabel: formatCurrencyBR(fee.balance),
    dueDate: fee.dueDate,
    dueDateLabel: formatDateBRShortYear(fee.dueDate) || "-",
    paidAt: fee.paidAt,
    paidAtLabel: formatDateBRShortYear(fee.paidAt) || "-",
    paymentMethodLabel: getPaymentMethodLabel(fee.paymentMethod),
  }));
}

function buildGuestRows(guestPayments) {
  return guestPayments.map((guest) => ({
    id: guest.id,
    guestName: guest.guestName,
    date: guest.date,
    dateLabel: formatDateBR(guest.date),
    amount: decimalToNumber(guest.amount),
    amountLabel: formatCurrencyBR(guest.amount),
    note: guest.note || "-",
    matchLabel: guest.match?.description || (guest.match?.playedAt ? formatDateBR(guest.match.playedAt) : "-"),
    cashReference: guest.cashTransaction ? `Lancamento #${guest.cashTransaction.id}` : "-",
  }));
}

function buildAnnualBreakdown(period, monthlyFees, cashTransactions, guestRows) {
  if (period.scope !== "YEARLY") return [];

  const map = new Map();
  for (let month = 1; month <= 12; month += 1) {
    map.set(month, {
      month,
      label: formatMonthYearLabel(month, period.year).split("/")[0],
      monthlyIncome: 0,
      expenses: 0,
      guestIncome: 0,
      pending: 0,
    });
  }

  monthlyFees.forEach((fee) => {
    const current = map.get(fee.month);
    if (!current) return;
    current.monthlyIncome = roundCurrency(current.monthlyIncome + decimalToNumber(fee.amountPaid));
    current.pending = roundCurrency(current.pending + fee.balance);
  });

  cashTransactions.forEach((transaction) => {
    const month = new Date(transaction.date).getUTCMonth() + 1;
    const current = map.get(month);
    if (!current) return;
    if (transaction.type === "EXPENSE") {
      current.expenses = roundCurrency(current.expenses + decimalToNumber(transaction.amount));
    }
  });

  guestRows.forEach((guest) => {
    const month = new Date(guest.date).getUTCMonth() + 1;
    const current = map.get(month);
    if (!current) return;
    current.guestIncome = roundCurrency(current.guestIncome + guest.amount);
  });

  return Array.from(map.values()).map((row) => ({
    ...row,
    monthlyIncomeLabel: formatCurrencyBR(row.monthlyIncome),
    guestIncomeLabel: formatCurrencyBR(row.guestIncome),
    expensesLabel: formatCurrencyBR(row.expenses),
    pendingLabel: formatCurrencyBR(row.pending),
    netLabel: formatCurrencyBR(roundCurrency(row.monthlyIncome + row.guestIncome - row.expenses)),
  }));
}

function buildInsights({ period, summary, previousSummary, expenseDistribution }) {
  const insights = [];
  insights.push({
    title: "Receita e despesas do periodo",
    text: `Na competencia ${period.label}, foram arrecadados ${formatCurrencyBR(summary.totalIncome)} e registrados ${formatCurrencyBR(summary.totalExpenses)} em despesas.`,
  });

  insights.push({
    title: "Saldo e adimplencia",
    text: `O saldo final do periodo ficou em ${formatCurrencyBR(summary.netResult)}, com adimplencia de ${formatPercent(summary.paidPercentage)} e pendencia total de ${formatCurrencyBR(summary.totalPending)}.`,
  });

  if (expenseDistribution.length) {
    const mainExpense = expenseDistribution[0];
    insights.push({
      title: "Principal categoria de gasto",
      text: `${mainExpense.label} liderou as saidas do periodo, somando ${mainExpense.amountLabel} (${mainExpense.percentageLabel} das despesas).`,
    });
  }

  if (previousSummary) {
    const delta = roundCurrency(summary.netResult - previousSummary.netResult);
    const direction = delta >= 0 ? "melhorou" : "piorou";
    insights.push({
      title: "Comparacao com o periodo anterior",
      text: `Em relacao a ${previousSummary.periodLabel}, o resultado do periodo ${direction} ${formatCurrencyBR(Math.abs(delta))}.`,
    });
  }

  return insights.slice(0, 4);
}

function buildNarratives({ period, summary, expenseDistribution }) {
  const intro = `Segue a prestacao de contas de ${period.label}, com resumo de arrecadacao, despesas, pendencias e saldo do periodo.`;
  const detailed = `Na competencia ${period.label}, o financeiro registrou ${formatCurrencyBR(
    summary.totalIncome
  )} em entradas, ${formatCurrencyBR(summary.totalExpenses)} em despesas e ${formatCurrencyBR(
    summary.netResult
  )} de saldo. Houve ${summary.paidCount} mensalidade(s) quitada(s), ${summary.pendingCount} pendencia(s) e ${summary.guestCount} convidado(s) lancado(s).`;
  const mainExpense = expenseDistribution[0];
  const short = intro;
  const whatsapp = `${intro}\n\nSaldo: ${formatCurrencyBR(summary.netResult)}\nPendentes: ${formatCurrencyBR(summary.totalPending)}\nAdimplencia: ${formatPercent(summary.paidPercentage)}`;
  const caption = mainExpense
    ? `Prestacao de contas de ${period.label}: saldo ${formatCurrencyBR(summary.netResult)} e destaque de gasto em ${mainExpense.label.toLowerCase()}.`
    : `Prestacao de contas de ${period.label}: saldo ${formatCurrencyBR(summary.netResult)} e visao executiva pronta para compartilhamento.`;

  return {
    short,
    detailed,
    whatsapp,
    caption,
  };
}

async function loadPeriodCollections({ prisma = prismaClient, settings, period }) {
  const feeWhere = buildFeeWhereForPeriod(period);
  const monthlyPairs = buildMonthlyPairsBetween(period.start, period.end);

  for (const pair of monthlyPairs) {
    await syncMonthlyCompetenceRules({
      prisma,
      month: pair.month,
      year: pair.year,
      settings,
      referenceDate: getSaoPauloTodayDate(),
    });
  }

  const [monthlyFeesRaw, cashTransactionsRaw, guestPaymentsRaw, transactionsBeforeStart] = await Promise.all([
    prisma.monthlyFee.findMany({
      where: feeWhere,
      include: {
        player: true,
      },
      orderBy: [
        { year: "asc" },
        { month: "asc" },
        { player: { name: "asc" } },
      ],
    }),
    prisma.cashTransaction.findMany({
      where: {
        date: {
          gte: period.start,
          lt: period.end,
        },
      },
      include: {
        player: true,
        monthlyFee: {
          include: {
            player: true,
          },
        },
        guestPayment: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    prisma.guestPayment.findMany({
      where: {
        date: {
          gte: period.start,
          lt: period.end,
        },
      },
      include: {
        match: true,
        cashTransaction: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    prisma.cashTransaction.findMany({
      where: {
        date: {
          lt: period.start,
        },
      },
      select: {
        type: true,
        amount: true,
      },
    }),
  ]);

  const today = getSaoPauloTodayDate();
  const monthlyFees = monthlyFeesRaw.map((fee) => decorateMonthlyFee(fee, settings, today));
  const guestRows = buildGuestRows(guestPaymentsRaw);
  const startingBalance = transactionsBeforeStart.reduce((sum, transaction) => {
    const amount = decimalToNumber(transaction.amount);
    return transaction.type === "INCOME" ? sum + amount : sum - amount;
  }, 0);
  const cashRows = buildCashRows(cashTransactionsRaw, startingBalance);
  const monthlyRows = buildMonthlyRows(monthlyFees);
  const expenseDistribution = aggregateExpenseDistribution(cashTransactionsRaw);
  const groupedPlayers = aggregateFeeContributors(monthlyFees);

  const totalIncome = roundCurrency(
    cashTransactionsRaw
      .filter((transaction) => transaction.type === "INCOME")
      .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0)
  );
  const totalExpenses = roundCurrency(
    cashTransactionsRaw
      .filter((transaction) => transaction.type === "EXPENSE")
      .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0)
  );
  const totalPending = roundCurrency(
    monthlyFees.reduce((sum, fee) => sum + roundCurrency(fee.balance || 0), 0)
  );
  const paidCount = monthlyFees.filter((fee) => fee.collectionStatus === "PAID").length;
  const pendingCount = monthlyFees.filter((fee) => roundCurrency(fee.balance || 0) > 0).length;
  const partialCount = monthlyFees.filter((fee) => fee.collectionStatus === "PARTIAL").length;
  const guestCount = guestPaymentsRaw.length;
  const totalMonthlyPaid = roundCurrency(
    monthlyFees.reduce((sum, fee) => sum + decimalToNumber(fee.amountPaid), 0)
  );
  const totalMonthlyDue = roundCurrency(
    monthlyFees
      .filter((fee) => fee.status !== "EXEMPT")
      .reduce((sum, fee) => sum + decimalToNumber(fee.amountDue), 0)
  );
  const paidPercentage = totalMonthlyDue > 0 ? (totalMonthlyPaid / totalMonthlyDue) * 100 : 0;
  const guestIncome = roundCurrency(
    guestPaymentsRaw.reduce((sum, guest) => sum + decimalToNumber(guest.amount), 0)
  );
  const netResult = roundCurrency(totalIncome - totalExpenses);

  const topContributors = groupedPlayers
    .filter((item) => item.totalPaid > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid || a.playerName.localeCompare(b.playerName, "pt-BR"))
    .slice(0, 5)
    .map((item) => ({
      ...item,
      totalPaidLabel: formatCurrencyBR(item.totalPaid),
      totalDueLabel: formatCurrencyBR(item.totalDue),
      totalBalanceLabel: formatCurrencyBR(item.totalBalance),
    }));

  const followUpRanking = groupedPlayers
    .filter((item) => item.totalBalance > 0)
    .sort(
      (a, b) =>
        b.pendingCompetences - a.pendingCompetences ||
        b.totalBalance - a.totalBalance ||
        a.playerName.localeCompare(b.playerName, "pt-BR")
    )
    .slice(0, 5)
    .map((item) => ({
      ...item,
      totalPaidLabel: formatCurrencyBR(item.totalPaid),
      totalDueLabel: formatCurrencyBR(item.totalDue),
      totalBalanceLabel: formatCurrencyBR(item.totalBalance),
    }));

  return {
    period,
    monthlyFees,
    monthlyRows,
    guestRows,
    cashRows,
    expenseDistribution,
    annualBreakdown: buildAnnualBreakdown(period, monthlyFees, cashTransactionsRaw, guestRows),
    summary: {
      periodLabel: period.label,
      totalIncome,
      totalIncomeLabel: formatCurrencyBR(totalIncome),
      totalExpenses,
      totalExpensesLabel: formatCurrencyBR(totalExpenses),
      netResult,
      netResultLabel: formatCurrencyBR(netResult),
      totalPending,
      totalPendingLabel: formatCurrencyBR(totalPending),
      paidCount,
      pendingCount,
      partialCount,
      guestCount,
      guestIncome,
      guestIncomeLabel: formatCurrencyBR(guestIncome),
      totalMonthlyPaid,
      totalMonthlyPaidLabel: formatCurrencyBR(totalMonthlyPaid),
      totalMonthlyDue,
      totalMonthlyDueLabel: formatCurrencyBR(totalMonthlyDue),
      paidPercentage,
      paidPercentageLabel: formatPercent(paidPercentage),
      mainExpenseCategory: expenseDistribution[0] || null,
    },
    rankings: {
      topContributors,
      followUpRanking,
    },
  };
}

function buildPreviewTables(reportMeta, currentData) {
  const monthlyRows =
    reportMeta.key === "PENDING"
      ? currentData.monthlyRows.filter((row) => row.balance > 0).slice(0, 8)
      : currentData.monthlyRows.slice(0, 8);
  const guestRows = currentData.guestRows.slice(0, 8);
  const cashRows = currentData.cashRows
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id)
    .slice(0, 8);

  return {
    monthlyRows,
    guestRows,
    cashRows,
  };
}

function buildExportOptions(params) {
  const query = new URLSearchParams();
  query.set("month", String(params.month));
  query.set("year", String(params.year));
  query.set("reportScope", params.reportScope);
  query.set("reportStart", params.reportStart || "");
  query.set("reportEnd", params.reportEnd || "");

  return Object.values(REPORT_TYPE_META).map((meta) => {
    const hrefParams = new URLSearchParams(query.toString());
    hrefParams.set("reportType", meta.key);
    if (meta.key === "ANNUAL_SUMMARY") {
      hrefParams.set("reportScope", "YEARLY");
    }

    return {
      key: meta.key,
      label: meta.label,
      title: meta.title,
      description: meta.description,
      href: `/admin/finance/reports/pdf?${hrefParams.toString()}&download=1`,
      previewHref: `/admin/finance/reports/preview?${hrefParams.toString()}`,
    };
  });
}

function buildFinanceReportFilename(reportMeta, period) {
  const stampBase = period.scope === "YEARLY"
    ? `${period.year}`
    : period.scope === "CUSTOM"
      ? `${formatDateInput(period.start)}-${formatDateInput(shiftUtcDays(period.end, -1))}`
      : `${period.year}-${String(period.month).padStart(2, "0")}`;

  return `${reportMeta.filenameBase}-${stampBase}.pdf`;
}

function normalizeFinanceReportParams(params = {}) {
  const reportType = normalizeFinanceReportType(params.reportType);
  const reportScope = normalizeFinanceReportScope(params.reportScope, reportType);
  const { month, year } = parseFinanceCompetence(params);
  return {
    month,
    year,
    reportType,
    reportScope,
    reportStart: getTrimmedString(params.reportStart, ""),
    reportEnd: getTrimmedString(params.reportEnd, ""),
  };
}

async function buildFinanceReportDataset({
  prisma = prismaClient,
  settings,
  normalizedParams,
  includeHistory = false,
  historyLimit = 8,
}) {
  const reportMeta = REPORT_TYPE_META[normalizedParams.reportType];
  const period = buildReportPeriod(normalizedParams);
  const comparisonPeriod = buildComparisonPeriod(period);

  const [currentData, previousData, history] = await Promise.all([
    loadPeriodCollections({ prisma, settings, period }),
    loadPeriodCollections({ prisma, settings, period: comparisonPeriod }),
    includeHistory ? getFinanceReportHistory(prisma, historyLimit) : Promise.resolve([]),
  ]);

  return {
    normalizedParams,
    reportMeta,
    period,
    comparisonPeriod,
    currentData,
    previousData,
    history,
  };
}

function buildFinanceReportDocument({ reportMeta, period, currentData, previousData, insights, narratives, filename, settings }) {
  const logoUrl = pathToFileURL(path.resolve(__dirname, "..", "public", "img", "LogoHPFC.svg")).href;

  return {
    templateKey: "finance_report",
    filename,
    data: {
      generatedAt: formatDateTimeBR(new Date()),
      generatedAtIso: new Date().toISOString(),
      logoUrl,
      report: reportMeta,
      period,
      responsibleName: settings?.pixReceiverName || "",
      executiveSummary: currentData.summary,
      insights,
      narratives,
      expenseDistribution: currentData.expenseDistribution,
      rankings: currentData.rankings,
      annualBreakdown: currentData.annualBreakdown,
      monthlyRows:
        reportMeta.key === "PENDING"
          ? currentData.monthlyRows.filter((row) => row.balance > 0)
          : currentData.monthlyRows,
      guestRows: currentData.guestRows,
      cashRows: currentData.cashRows,
      previousPeriodSummary: previousData?.summary || null,
      sections: reportMeta.sections,
    },
  };
}

function buildFinanceReportResult({ normalizedParams, reportMeta, period, comparisonPeriod, currentData, previousData, history, settings }) {
  const insights = buildInsights({
    period,
    summary: currentData.summary,
    previousSummary: previousData?.summary,
    expenseDistribution: currentData.expenseDistribution,
  });
  const narratives = buildNarratives({
    period,
    summary: currentData.summary,
    expenseDistribution: currentData.expenseDistribution,
  });
  const previewTables = buildPreviewTables(reportMeta, currentData);
  const exportOptions = buildExportOptions(normalizedParams);
  const comparison = previousData?.summary
    ? {
        periodLabel: previousData.summary.periodLabel,
        previousNetResult: previousData.summary.netResult,
        previousNetResultLabel: previousData.summary.netResultLabel,
        deltaNet: roundCurrency(currentData.summary.netResult - previousData.summary.netResult),
        deltaNetLabel: formatCurrencyBR(Math.abs(roundCurrency(currentData.summary.netResult - previousData.summary.netResult))),
      }
    : null;

  const filteredMonthlyRows =
    reportMeta.key === "PENDING"
      ? currentData.monthlyRows.filter((row) => row.balance > 0)
      : currentData.monthlyRows;
  const filteredCashRows = currentData.cashRows;
  const filteredGuestRows = currentData.guestRows;
  const filename = buildFinanceReportFilename(reportMeta, period);
  const pdf = buildFinanceReportDocument({
    reportMeta,
    period,
    currentData,
    previousData,
    insights,
    narratives,
    filename,
    settings,
  });

  return {
    params: normalizedParams,
    reportMeta,
    period,
    comparisonPeriod,
    executiveSummary: currentData.summary,
    insights,
    narratives,
    exportOptions,
    history,
    comparison,
    preview: previewTables,
    distribution: currentData.expenseDistribution,
    rankings: currentData.rankings,
    annualBreakdown: currentData.annualBreakdown,
    filename,
    pdf,
    pdfData: pdf.data,
    reportTables: {
      monthlyRows: filteredMonthlyRows,
      guestRows: filteredGuestRows,
      cashRows: filteredCashRows,
    },
  };
}

async function loadFinanceReport({ prisma = prismaClient, settings, params, includeHistory = false, historyLimit = 8 }) {
  const normalizedParams = normalizeFinanceReportParams(params);
  const dataset = await buildFinanceReportDataset({
    prisma,
    settings,
    normalizedParams,
    includeHistory,
    historyLimit,
  });

  return buildFinanceReportResult({
    ...dataset,
    settings,
  });
}

function buildFinanceReportAuditDetails(reportPayload) {
  return {
    reportType: reportPayload.reportMeta.key,
    reportLabel: reportPayload.reportMeta.label,
    periodLabel: reportPayload.period.label,
    month: reportPayload.period.month,
    year: reportPayload.period.year,
    reportScope: reportPayload.period.scope,
    reportStart: formatDateInput(reportPayload.period.start),
    reportEnd: formatDateInput(shiftUtcDays(reportPayload.period.end, -1)),
    filename: reportPayload.filename,
  };
}

module.exports = {
  REPORT_SCOPE_OPTIONS,
  REPORT_TYPE_OPTIONS,
  REPORT_TYPE_META,
  normalizeFinanceReportType,
  normalizeFinanceReportScope,
  buildReportPeriod,
  normalizeFinanceReportParams,
  buildFinanceReportDataset,
  buildFinanceReportDocument,
  buildFinanceReportResult,
  loadFinanceReport,
  buildFinanceReportPayload: loadFinanceReport,
  buildFinanceReportAuditDetails,
  getFinanceReportHistory,
};
