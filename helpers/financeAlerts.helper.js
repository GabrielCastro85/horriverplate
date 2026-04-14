const { formatCurrencyBR } = require("../utils/finance");

function buildFinanceAlerts({
  monthLabel,
  preparation,
  competenceState,
  overdueCount,
  overdueAmount,
  dueTodayCount,
  partialCount,
  guestCount,
}) {
  const alerts = [];

  if (!preparation.prepared) {
    alerts.push({
      id: "competence-not-prepared",
      priority: 100,
      tone: "warning",
      title: `Competencia de ${monthLabel} ainda nao preparada`,
      description:
        preparation.missingCount > 0
          ? `${preparation.missingCount} mensalidade(s) ainda nao foram geradas para os participantes elegiveis.`
          : "Esta competencia ainda nao foi preparada para cobranca.",
      actionType: "ensure_competence",
      actionLabel: "Gerar mensalidades",
      actionTab: "monthly",
    });
  }

  if (overdueCount > 0) {
    alerts.push({
      id: "overdue-fees",
      priority: 90,
      tone: "danger",
      title: `${overdueCount} mensalidade(s) vencida(s)`,
      description: `${formatCurrencyBR(overdueAmount)} em atraso pedindo acao de cobranca.`,
      actionType: "link",
      actionLabel: "Ver pendentes",
      actionQuery: { tab: "charge", chargeFilter: "OVERDUE" },
      actionHash: "#finance-charge",
    });
  }

  if (dueTodayCount > 0) {
    alerts.push({
      id: "due-today-fees",
      priority: 80,
      tone: "warning",
      title: `${dueTodayCount} mensalidade(s) vencem hoje`,
      description: "O momento ideal para agir sem deixar o mes virar atraso.",
      actionType: "link",
      actionLabel: "Abrir cobranca",
      actionQuery: { tab: "charge", chargeFilter: "DUE_TODAY" },
      actionHash: "#finance-charge",
    });
  }

  if (partialCount > 0) {
    alerts.push({
      id: "partial-fees",
      priority: 70,
      tone: "info",
      title: `${partialCount} pagamento(s) parcial(is)`,
      description: "Esses registros merecem revisao para fechamento da competencia.",
      actionType: "link",
      actionLabel: "Ver parciais",
      actionQuery: { tab: "charge", chargeFilter: "PARTIAL" },
      actionHash: "#finance-charge",
    });
  }

  if (guestCount > 0) {
    alerts.push({
      id: "guest-payments",
      priority: 50,
      tone: competenceState.key === "CLOSED" ? "ok" : "pending",
      title: `${guestCount} convidado(s) registrado(s) no mes`,
      description: "Os avulsos deste periodo ja entraram no caixa e podem compor a prestacao de contas.",
      actionType: "link",
      actionLabel: "Ver convidados",
      actionQuery: { tab: "guests" },
      actionHash: "#finance-guests",
    });
  }

  return alerts.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

module.exports = {
  buildFinanceAlerts,
};
