const {
  COLLECTION_STATUS_META,
  COLLECTION_STATUS_SORT_ORDER,
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  COMPETENCE_STATE_META,
  MONTHLY_COLLECTION_FILTER_ALIASES,
  CHARGE_FILTER_ALIASES,
  COMPETENCE_STATE_THRESHOLDS,
} = require("../constants/finance");
const {
  decimalToNumber,
  roundCurrency,
  computeMonthlyFeeBalance,
} = require("../utils/finance");

function getSaoPauloDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));

  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 0),
    day: Number(parts.find((part) => part.type === "day")?.value || 0),
  };
}

function getSaoPauloDayKey(value = new Date()) {
  const parts = getSaoPauloDateParts(value);
  if (!parts.year || !parts.month || !parts.day) return "";
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getSaoPauloTodayDate() {
  const parts = getSaoPauloDateParts(new Date());
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
}

function normalizeMonthlyCollectionFilter(value) {
  const raw = String(value || "ALL").trim().toUpperCase();
  const normalized = MONTHLY_COLLECTION_FILTER_ALIASES[raw] || raw;
  return MONTHLY_COLLECTION_FILTER_OPTIONS.some((option) => option.value === normalized) ? normalized : "ALL";
}

function normalizeChargeFilter(value) {
  const raw = String(value || "ALL").trim().toUpperCase();
  const normalized = CHARGE_FILTER_ALIASES[raw] || raw;
  return CHARGE_FILTER_OPTIONS.some((option) => option.value === normalized) ? normalized : "ALL";
}

function getCollectionStatusMeta(status) {
  return COLLECTION_STATUS_META[status] || COLLECTION_STATUS_META.CURRENT;
}

function resolveCollectionStatus(monthlyFee, now = new Date()) {
  if (!monthlyFee) return "CURRENT";
  if (monthlyFee.status === "EXEMPT") return "EXEMPT";

  const paid = roundCurrency(decimalToNumber(monthlyFee.amountPaid));
  const balance =
    typeof monthlyFee.balance === "number" ? roundCurrency(monthlyFee.balance) : computeMonthlyFeeBalance(monthlyFee);

  if (monthlyFee.status === "PAID" && balance <= 0) {
    return "PAID";
  }
  if (monthlyFee.status === "PARTIAL" && paid > 0 && balance > 0) {
    return "PARTIAL";
  }
  if ((monthlyFee.billingMode === "LATE_PER_MATCH" || monthlyFee.billingMode === "PER_MATCH") && paid <= 0 && balance <= 0) {
    return "CURRENT";
  }
  if (balance <= 0) return "PAID";
  if (paid > 0 && balance > 0) return "PARTIAL";

  const dueKey = monthlyFee.dueDate ? getSaoPauloDayKey(monthlyFee.dueDate) : "";
  const todayKey = getSaoPauloDayKey(now);
  if (!dueKey) return "CURRENT";
  if (dueKey === todayKey) return "DUE_TODAY";
  if (dueKey < todayKey) return "OVERDUE";
  return "CURRENT";
}

function getChargePriorityBucket(monthlyFee, now = new Date()) {
  const balance =
    typeof monthlyFee.balance === "number" ? roundCurrency(monthlyFee.balance) : computeMonthlyFeeBalance(monthlyFee);
  if (monthlyFee.status === "EXEMPT" || balance <= 0) return 9;

  const dueKey = monthlyFee.dueDate ? getSaoPauloDayKey(monthlyFee.dueDate) : "";
  const todayKey = getSaoPauloDayKey(now);
  if (dueKey && dueKey < todayKey) return 0;
  if (dueKey && dueKey === todayKey) return 1;
  return 2;
}

function matchesMonthlyCollectionFilter(monthlyFee, filter) {
  const normalized = normalizeMonthlyCollectionFilter(filter);
  if (normalized === "ALL") return true;
  return monthlyFee.collectionStatus === normalized;
}

function matchesChargeFilter(monthlyFee, filter) {
  const normalized = normalizeChargeFilter(filter);
  if (monthlyFee.status === "EXEMPT" || roundCurrency(monthlyFee.balance) <= 0) return false;

  switch (normalized) {
    case "OVERDUE":
      return monthlyFee.chargePriorityBucket === 0;
    case "DUE_TODAY":
      return monthlyFee.chargePriorityBucket === 1;
    case "WITH_WHATSAPP":
      return Boolean(monthlyFee.player?.whatsapp);
    case "WITHOUT_WHATSAPP":
      return !monthlyFee.player?.whatsapp;
    case "PARTIAL":
      return monthlyFee.collectionStatus === "PARTIAL";
    case "HIGHEST_AMOUNT":
    case "ALL":
    default:
      return true;
  }
}

function compareFeesByName(a, b) {
  return String(a.player?.name || "").localeCompare(String(b.player?.name || ""), "pt-BR", {
    sensitivity: "base",
  });
}

function sortMonthlyFees(monthlyFees) {
  return [...monthlyFees].sort((a, b) => {
    if (a.collectionStatus !== b.collectionStatus) {
      return COLLECTION_STATUS_SORT_ORDER.indexOf(a.collectionStatus) - COLLECTION_STATUS_SORT_ORDER.indexOf(b.collectionStatus);
    }
    return compareFeesByName(a, b);
  });
}

function sortChargeFees(monthlyFees, filter, now = new Date()) {
  const normalized = normalizeChargeFilter(filter);
  return [...monthlyFees]
    .filter((fee) => matchesChargeFilter(fee, normalized))
    .sort((a, b) => {
      if (normalized === "HIGHEST_AMOUNT") {
        if (b.balance !== a.balance) return b.balance - a.balance;
        return compareFeesByName(a, b);
      }

      if (a.chargePriorityBucket !== b.chargePriorityBucket) {
        return a.chargePriorityBucket - b.chargePriorityBucket;
      }

      if (b.balance !== a.balance) {
        return b.balance - a.balance;
      }

      return compareFeesByName(a, b);
    });
}

function buildCompetencePreparation({ eligiblePlayers, monthFees }) {
  const eligibleIds = new Set(eligiblePlayers.map((player) => player.id));
  const existingIds = new Set(
    monthFees.map((fee) => fee.playerId).filter((playerId) => eligibleIds.has(playerId))
  );
  const missingPlayers = eligiblePlayers.filter((player) => !existingIds.has(player.id));

  return {
    eligiblePlayers,
    eligibleCount: eligiblePlayers.length,
    existingCount: existingIds.size,
    missingPlayers,
    missingCount: missingPlayers.length,
    prepared: missingPlayers.length === 0,
  };
}

function buildCompetenceState({ preparation, expectedPayers, pendingCount, totalPending, totalPredicted }) {
  if (preparation?.reset) {
    return {
      ...COMPETENCE_STATE_META.CLOSED,
      missingCount: 0,
    };
  }

  if (!preparation.prepared) {
    return {
      ...COMPETENCE_STATE_META.NOT_PREPARED,
      missingCount: preparation.missingCount,
    };
  }

  if (expectedPayers <= 0 && roundCurrency(totalPredicted) <= 0 && roundCurrency(totalPending) <= 0 && pendingCount <= 0) {
    return {
      ...COMPETENCE_STATE_META.CLOSED,
      missingCount: 0,
    };
  }

  if (expectedPayers > 0 && roundCurrency(totalPending) <= 0 && pendingCount <= 0) {
    return {
      ...COMPETENCE_STATE_META.CLOSED,
      missingCount: 0,
    };
  }

  const pendingRatio = totalPredicted > 0 ? totalPending / totalPredicted : 0;
  const lowPendingCount =
    pendingCount > 0 &&
    pendingCount <= Math.max(
      COMPETENCE_STATE_THRESHOLDS.minPendingCount,
      Math.ceil(expectedPayers * COMPETENCE_STATE_THRESHOLDS.pendingCountRatio)
    );
  const lowPendingAmount = totalPending > 0 && pendingRatio <= COMPETENCE_STATE_THRESHOLDS.pendingAmountRatio;

  if (lowPendingCount || lowPendingAmount) {
    return {
      ...COMPETENCE_STATE_META.NEARLY_CLOSED,
      missingCount: 0,
    };
  }

  return {
    ...COMPETENCE_STATE_META.OPEN,
    missingCount: 0,
  };
}

module.exports = {
  COLLECTION_STATUS_META,
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  COMPETENCE_STATE_META,
  getSaoPauloDateParts,
  getSaoPauloDayKey,
  getSaoPauloTodayDate,
  normalizeMonthlyCollectionFilter,
  normalizeChargeFilter,
  getCollectionStatusMeta,
  resolveCollectionStatus,
  getChargePriorityBucket,
  matchesMonthlyCollectionFilter,
  matchesChargeFilter,
  sortMonthlyFees,
  sortChargeFees,
  buildCompetencePreparation,
  buildCompetenceState,
};
