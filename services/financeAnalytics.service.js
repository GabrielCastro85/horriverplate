const {
  decimalToNumber,
  roundCurrency,
  formatCurrencyBR,
  computeMonthlyFeeBalance,
} = require("../utils/finance");
const { buildSmartPaymentInsights, buildRulesInsights } = require("../helpers/financeInsights.helper");

function buildMonthlyFeeAnalytics(fee) {
  const smartPayment = buildSmartPaymentInsights(fee);
  const breakdownItems = [];

  if (fee?.billingMode === "PER_MATCH") {
    breakdownItems.push({
      label: "Avulso mensal",
      value: `${Number(fee?.matchesPlayed || 0)} x ${formatCurrencyBR(fee?.latePerMatchAmount || 25)}`,
    });
  } else if (fee?.billingMode === "LATE_PER_MATCH") {
    breakdownItems.push({
      label: "Avulso por atraso",
      value: `${Number(fee?.lateMatchesPlayed || 0)} x ${formatCurrencyBR(fee?.latePerMatchAmount || 25)}`,
    });
  } else if (fee?.baseAmount != null) {
    breakdownItems.push({ label: "Base", value: formatCurrencyBR(fee.baseAmount) });
  }
  if (decimalToNumber(fee?.extraAmount) > 0) {
    breakdownItems.push({ label: "Extras", value: formatCurrencyBR(fee.extraAmount) });
  }
  if (decimalToNumber(fee?.autoDiscountAmount) > 0) {
    breakdownItems.push({ label: "Abat. auto", value: `- ${formatCurrencyBR(fee.autoDiscountAmount)}` });
  }
  if (decimalToNumber(fee?.manualDiscountAmount) > 0) {
    breakdownItems.push({ label: "Abat. manual", value: `- ${formatCurrencyBR(fee.manualDiscountAmount)}` });
  }

  const amountDue = roundCurrency(decimalToNumber(fee?.amountDue));
  const paid = roundCurrency(decimalToNumber(fee?.amountPaid));
  const balance = roundCurrency(
    typeof fee?.balance === "number" ? fee.balance : computeMonthlyFeeBalance(fee)
  );

  return {
    amountDue,
    paid,
    balance,
    progressPercent: smartPayment.progressPercent,
    quickAmounts: smartPayment.quickAmounts,
    recommendedAmount: smartPayment.recommendedAmount,
    remainingLabel: smartPayment.remainingLabel,
    breakdownItems,
    hasAdvancedBreakdown:
      breakdownItems.length > 1 ||
      Number(fee?.matchesPlayed || 0) > 0 ||
      Number(fee?.lateMatchesPlayed || 0) > 0,
  };
}

function buildPlayerRulesAnalytics(players) {
  return {
    insights: buildRulesInsights(players),
    counts: players.reduce(
      (acc, player) => {
        const type = player.financeParticipantType || "MONTHLY";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      { MONTHLY: 0, PER_MATCH: 0, SPECIAL: 0, EXEMPT: 0, GUEST: 0 }
    ),
  };
}

module.exports = {
  buildMonthlyFeeAnalytics,
  buildPlayerRulesAnalytics,
};
