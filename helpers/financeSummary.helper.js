const { formatCurrencyBR, formatMonthYearLabel } = require("../utils/finance");

function buildFinanceReportSummary({
  month,
  year,
  totalReceivedFromFees,
  totalExpensesMonth,
  cashBalance,
  paidCount,
  pendingCount,
  guestCount,
}) {
  return `Na competencia ${formatMonthYearLabel(month, year)}, foram arrecadados ${formatCurrencyBR(
    totalReceivedFromFees
  )} de mensalidades, registrados ${formatCurrencyBR(
    totalExpensesMonth
  )} em saidas e o saldo final foi ${formatCurrencyBR(cashBalance)}. Houve ${paidCount} mensalista(s) com pagamento total, ${pendingCount} pendencia(s) e ${guestCount} convidado(s) avulso(s).`;
}

function buildFinanceExecutiveSummary({
  monthLabel,
  totalPredicted,
  totalReceived,
  totalPending,
  paidCount,
  partialCount,
  pendingCount,
}) {
  return `${monthLabel}: previsto ${formatCurrencyBR(totalPredicted)}, recebido ${formatCurrencyBR(
    totalReceived
  )}, pendente ${formatCurrencyBR(totalPending)}, ${paidCount} pago(s), ${partialCount} parcial(is) e ${pendingCount} em aberto.`;
}

function buildFinanceSummaries({
  totalPredicted,
  totalPredictedBase,
  totalReceivedMonth,
  totalReceivedFromFees,
  receivedPercentage,
  totalPending,
  payersCount,
  delinquentCount,
  paidCount,
  partialCount,
  exemptCount,
  overdueCount,
  dueTodayCount,
  totalExpensesMonth,
  currentMonthNet,
  cashBalance,
  activeFinancePlayers,
  guestsCount,
  expectedPayers,
  pendingWithWhatsappCount,
  pendingWithoutWhatsappCount,
  automaticIncomeTotal,
  manualExpenseTotal,
  projectedMissingAmount,
  participantTypeCounts,
  chargeBehavior,
  autoGenerateCompetence,
}) {
  return {
    totalPredicted,
    totalPredictedBase,
    totalReceivedMonth,
    totalReceivedFromFees,
    receivedPercentage,
    totalPending,
    payersCount,
    delinquentCount,
    paidCount,
    partialCount,
    exemptCount,
    overdueCount,
    dueTodayCount,
    totalExpensesMonth,
    currentMonthNet,
    cashBalance,
    activeFinancePlayers,
    guestsCount,
    expectedPayers,
    pendingWithWhatsappCount,
    pendingWithoutWhatsappCount,
    automaticIncomeTotal,
    manualExpenseTotal,
    projectedMissingAmount,
    participantTypeCounts,
    chargeBehavior,
    autoGenerateCompetence,
  };
}

function buildFinanceOverview({
  monthLabel,
  pendingFees,
  transactionPreviewSource,
  receivedPercentage,
  delinquentCount,
  paidCount,
  partialCount,
  exemptCount,
  rulesInsights,
}) {
  return {
    monthReferenceLabel: monthLabel,
    pendingPreview: pendingFees.slice(0, 5),
    transactionPreview: transactionPreviewSource.slice(0, 5),
    quickStats: {
      paidPercentage: receivedPercentage,
      pendingCount: delinquentCount,
      paidCount,
      partialCount,
      exemptCount,
    },
    rulesInsights,
  };
}

module.exports = {
  buildFinanceReportSummary,
  buildFinanceExecutiveSummary,
  buildFinanceSummaries,
  buildFinanceOverview,
};
