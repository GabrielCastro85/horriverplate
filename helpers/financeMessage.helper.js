const { formatCurrencyBR } = require("../utils/finance");

function buildBulkChargeSummary(monthlyFees) {
  const chargeableFees = monthlyFees.filter((fee) => fee.whatsappUrl);
  const withoutWhatsappCount = monthlyFees.filter((fee) => !fee.whatsappUrl).length;
  const allLines = monthlyFees
    .filter((fee) => fee.whatsappMessage)
    .map(
      (fee, index) =>
        `${index + 1}. ${fee.player?.name || "Jogador"} - ${formatCurrencyBR(fee.balance)}\n${fee.whatsappMessage}`
    );
  const whatsappLines = chargeableFees.map(
    (fee) => `${fee.player?.name || "Jogador"}: ${fee.whatsappUrl}`
  );

  return {
    totalCount: monthlyFees.length,
    chargeableCount: chargeableFees.length,
    withoutWhatsappCount,
    messageBundle: allLines.join("\n\n----------------\n\n"),
    linkBundle: whatsappLines.join("\n"),
  };
}

function buildFinanceShareText({ monthLabel, reportTypeLabel }) {
  return `Segue a prestacao de contas da competencia ${monthLabel}, com o recorte ${reportTypeLabel.toLowerCase()} para acompanhamento de arrecadacao, despesas, pendencias e saldo do periodo.`;
}

module.exports = {
  buildBulkChargeSummary,
  buildFinanceShareText,
};
