const { decimalToNumber, roundCurrency, computeMonthlyFeeBalance } = require("../utils/finance");

function buildSmartPaymentInsights(monthlyFee) {
  if (!monthlyFee) {
    return {
      progressPercent: 0,
      quickAmounts: [],
      balance: 0,
      paid: 0,
      amountDue: 0,
      recommendedAmount: 0,
      remainingLabel: "Sem saldo pendente",
    };
  }

  const amountDue = roundCurrency(decimalToNumber(monthlyFee.amountDue));
  const paid = roundCurrency(decimalToNumber(monthlyFee.amountPaid));
  const balance =
    typeof monthlyFee.balance === "number" ? roundCurrency(monthlyFee.balance) : computeMonthlyFeeBalance(monthlyFee);
  const progressPercent = amountDue > 0 ? Math.min(100, Math.round((Math.min(paid, amountDue) / amountDue) * 100)) : 100;

  if (monthlyFee.status === "EXEMPT" || balance <= 0) {
    return {
      progressPercent,
      quickAmounts: [],
      balance,
      paid,
      amountDue,
      recommendedAmount: 0,
      remainingLabel: "Mensalidade sem saldo pendente",
    };
  }

  const candidates = [
    balance,
    roundCurrency(balance / 2),
    roundCurrency(Math.max(balance * 0.4, 15)),
  ]
    .filter((value) => value > 0 && value < balance)
    .concat(balance);

  const quickAmounts = Array.from(new Set(candidates.map((value) => value.toFixed(2))))
    .map((value) => Number(value))
    .sort((a, b) => a - b);

  return {
    progressPercent,
    quickAmounts,
    balance,
    paid,
    amountDue,
    recommendedAmount: quickAmounts[0] || balance,
    remainingLabel:
      paid > 0 && balance > 0
        ? "Pagamento parcial registrado; o sistema sugere atalhos para fechar o saldo."
        : "Use os atalhos para registrar um parcial de forma mais rapida ou quitar o saldo total.",
  };
}

function buildRulesInsights(players = []) {
  const counters = players.reduce(
    (acc, player) => {
      acc[player.financeParticipantType || "MONTHLY"] = (acc[player.financeParticipantType || "MONTHLY"] || 0) + 1;
      if (player.financeAmountOverride != null) acc.overrides += 1;
      if (player.financeAutoDiscountAmount && Number(player.financeAutoDiscountAmount) > 0) acc.autoDiscounts += 1;
      if (player.financeMatchLimit) acc.matchLimits += 1;
      return acc;
    },
    { MONTHLY: 0, PER_MATCH: 0, GUEST: 0, EXEMPT: 0, SPECIAL: 0, overrides: 0, autoDiscounts: 0, matchLimits: 0 }
  );

  return [
    `${counters.MONTHLY} mensalista(s) padrao configurado(s) no financeiro.`,
    `${counters.PER_MATCH} jogador(es) no modo avulso mensal por presenca.`,
    `${counters.SPECIAL} participante(s) especial(is) com regra diferenciada.`,
    `${counters.overrides} jogador(es) com valor customizado e ${counters.matchLimits} com limite de peladas ativo.`,
  ];
}

module.exports = {
  buildSmartPaymentInsights,
  buildRulesInsights,
};
