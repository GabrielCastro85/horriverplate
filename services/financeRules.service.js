const {
  decimalToNumber,
  roundCurrency,
  computeMonthlyFeeStatus,
  buildMonthlyDueDate,
  getMonthDateRange,
  getLateChargeDateRange,
} = require("../utils/finance");
const {
  PARTICIPANT_TYPE_OPTIONS,
  PARTICIPANT_TYPE_META,
  CHARGE_BEHAVIOR_OPTIONS,
  DEFAULT_LATE_PER_MATCH_AMOUNT,
  MONTHLY_FEE_BILLING_MODE_META,
  getSpecialFinanceCompetenceRule,
} = require("../constants/finance");

function normalizeParticipantType(value, fallback = "MONTHLY") {
  const raw = String(value || fallback).trim().toUpperCase();
  return PARTICIPANT_TYPE_META[raw] ? raw : fallback;
}

function normalizeChargeBehavior(value, fallback = "ASSISTED") {
  const raw = String(value || fallback).trim().toUpperCase();
  return CHARGE_BEHAVIOR_OPTIONS.some((option) => option.value === raw) ? raw : fallback;
}

function normalizeBillingMode(value, fallback = "MONTHLY") {
  const raw = String(value || fallback || "").trim().toUpperCase();
  return MONTHLY_FEE_BILLING_MODE_META[raw] ? raw : fallback;
}

function getParticipantTypeMeta(value) {
  return PARTICIPANT_TYPE_META[normalizeParticipantType(value)];
}

function getBillingModeMeta(value) {
  return MONTHLY_FEE_BILLING_MODE_META[normalizeBillingMode(value)];
}

function isPlayerEligibleForMonthlyFee(player) {
  const participantType = normalizeParticipantType(player?.financeParticipantType);
  return Boolean(
    player?.financeActive &&
      participantType !== "GUEST" &&
      (player?.isMonthlyMember || participantType === "PER_MATCH" || participantType === "SPECIAL" || participantType === "EXEMPT")
  );
}

async function fetchMonthlyMatchUsage({ prisma, playerIds, month, year }) {
  const usageMap = await fetchMonthlyMatchChargeUsage({
    prisma,
    playerIds,
    month,
    year,
  });

  return Array.from(usageMap.entries()).reduce((map, [playerId, usage]) => {
    map.set(playerId, usage.matchesPlayed || 0);
    return map;
  }, new Map());
}

async function fetchMonthlyMatchChargeUsage({
  prisma,
  playerIds,
  month,
  year,
  dueDay = 10,
}) {
  if (!playerIds?.length) return new Map();
  const { start, end } = getMonthDateRange(year, month);
  const monthlyMatches = await prisma.match.findMany({
    where: {
      playedAt: {
        gte: start,
        lt: end,
      },
    },
    select: {
      id: true,
      playedAt: true,
    },
    orderBy: [{ playedAt: "asc" }, { id: "asc" }],
  });

  if (!monthlyMatches.length) return new Map();

  const firstMatchId = monthlyMatches[0]?.id || null;
  const matchIds = monthlyMatches.map((match) => match.id);
  const { start: lateStart, end: lateEnd } = getLateChargeDateRange(year, month, dueDay);
  const hasLateWindow = lateStart < lateEnd;

  const stats = await prisma.playerStat.findMany({
    where: {
      playerId: { in: playerIds },
      present: true,
      matchId: { in: matchIds },
    },
    select: {
      playerId: true,
      matchId: true,
      match: {
        select: {
          playedAt: true,
        },
      },
    },
  });

  const usageMap = stats.reduce((map, stat) => {
    const current = map.get(stat.playerId) || {
      matchesPlayed: 0,
      lateMatchesPlayed: 0,
      firstMatchPlayed: false,
      matchesAfterFirst: 0,
      matchDates: [],
      lateMatchDates: [],
      firstMatchDate: null,
    };

    current.matchesPlayed += 1;
    if (stat.match?.playedAt) {
      current.matchDates.push(stat.match.playedAt);
    }
    if (firstMatchId && stat.matchId === firstMatchId) {
      current.firstMatchPlayed = true;
    }

    if (
      hasLateWindow &&
      stat.match?.playedAt &&
      stat.match.playedAt >= lateStart &&
      stat.match.playedAt < lateEnd
    ) {
      current.lateMatchesPlayed += 1;
      current.lateMatchDates.push(stat.match.playedAt);
    }

    map.set(stat.playerId, current);
    return map;
  }, new Map());

  for (const usage of usageMap.values()) {
    usage.matchDates = usage.matchDates.sort((a, b) => new Date(a) - new Date(b));
    usage.lateMatchDates = usage.lateMatchDates.sort((a, b) => new Date(a) - new Date(b));
    usage.firstMatchDate = usage.matchDates[0] || null;
    usage.matchesAfterFirst = Math.max(
      Number(usage.matchesPlayed || 0) - (usage.firstMatchPlayed ? 1 : 0),
      0
    );
  }

  return usageMap;
}

async function fetchMonthlyLateMatchUsage({ prisma, playerIds, month, year, dueDay }) {
  const usageMap = await fetchMonthlyMatchChargeUsage({
    prisma,
    playerIds,
    month,
    year,
    dueDay,
  });

  return Array.from(usageMap.entries()).reduce((map, [playerId, usage]) => {
    map.set(playerId, usage.lateMatchesPlayed || 0);
    return map;
  }, new Map());
}

function getSaoPauloDayKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));

  const year = Number(parts.find((part) => part.type === "year")?.value || 0);
  const month = Number(parts.find((part) => part.type === "month")?.value || 0);
  const day = Number(parts.find((part) => part.type === "day")?.value || 0);
  if (!year || !month || !day) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isPastDueDate(referenceDate, dueDate) {
  if (!referenceDate || !dueDate) return false;
  return getSaoPauloDayKey(dueDate) < getSaoPauloDayKey(referenceDate);
}

function resolveMonthlyFeeBillingMode({
  month,
  year,
  participantType,
  currentBillingMode,
  currentStatus,
  dueDate,
  referenceDate = new Date(),
}) {
  const normalizedParticipantType = normalizeParticipantType(participantType);
  if (normalizedParticipantType === "EXEMPT") return "EXEMPT";
  if (normalizedParticipantType === "PER_MATCH") return "PER_MATCH";

  const explicitBillingMode = normalizeBillingMode(currentBillingMode, null);
  if (explicitBillingMode === "EXEMPT") return "EXEMPT";
  if (explicitBillingMode === "PER_MATCH") return "PER_MATCH";

  const specialCompetenceRule = getSpecialFinanceCompetenceRule(month, year);
  if (
    specialCompetenceRule &&
    (normalizedParticipantType === "MONTHLY" || normalizedParticipantType === "SPECIAL")
  ) {
    return "MONTHLY";
  }

  if (explicitBillingMode === "LATE_PER_MATCH") return "LATE_PER_MATCH";

  if (isPastDueDate(referenceDate, dueDate) && currentStatus !== "PAID") {
    return "LATE_PER_MATCH";
  }

  return "MONTHLY";
}

function buildRuleLabel({
  participantType,
  billingMode,
  customAmountApplied,
  extraMatches,
  autoDiscountAmount,
  manualDiscount,
  matchesPlayed,
  lateMatchesPlayed,
  latePerMatchAmount,
}) {
  if (participantType === "EXEMPT" || billingMode === "EXEMPT") return "Isento";
  if (billingMode === "PER_MATCH" || participantType === "PER_MATCH") {
    if (matchesPlayed > 0) {
      return `${matchesPlayed} pelada(s) x ${roundCurrency(latePerMatchAmount)}`;
    }
    return "Avulso mensal";
  }
  if (billingMode === "LATE_PER_MATCH") {
    if (lateMatchesPlayed > 0) {
      return `${lateMatchesPlayed} pelada(s) x ${roundCurrency(latePerMatchAmount)}`;
    }
    return "Avulso por atraso";
  }
  if (customAmountApplied) return "Valor customizado";
  if (extraMatches > 0) return `${extraMatches} extra(s) no mes`;
  if (autoDiscountAmount > 0 || manualDiscount > 0) return "Com abatimento";
  if (participantType === "SPECIAL") return "Plano especial";
  return "Regra padrao";
}

function calculateMonthlyFeeBreakdown({
  player,
  settings,
  month,
  year,
  participantTypeOverride = null,
  matchesPlayed = 0,
  lateMatchesPlayed = 0,
  matchChargeUsage = null,
  manualDiscountAmount = 0,
  amountPaid = 0,
  currentStatus = null,
  currentBillingMode = null,
  referenceDate = new Date(),
  latePerMatchAmount = null,
}) {
  const participantType = normalizeParticipantType(
    participantTypeOverride || player?.financeParticipantType
  );
  const monthlyBaseAmount = roundCurrency(
    player?.financeAmountOverride != null
      ? decimalToNumber(player.financeAmountOverride)
      : decimalToNumber(settings?.defaultMonthlyAmount)
  );
  const matchLimitValue =
    player?.financeMatchLimit != null ? Number(player.financeMatchLimit) : Number(settings?.defaultIncludedMatches || 0);
  const matchLimitApplied = Number.isFinite(matchLimitValue) && matchLimitValue > 0 ? matchLimitValue : null;
  const extraMatchAmount = roundCurrency(
    player?.financeExtraMatchAmount != null
      ? decimalToNumber(player.financeExtraMatchAmount)
      : decimalToNumber(settings?.defaultExtraMatchAmount)
  );
  const appliedLatePerMatchAmount = roundCurrency(
    latePerMatchAmount != null
      ? decimalToNumber(latePerMatchAmount)
      : decimalToNumber(settings?.latePerMatchAmount || DEFAULT_LATE_PER_MATCH_AMOUNT)
  );
  const autoDiscountAmount = roundCurrency(
    player?.financeAutoDiscountAmount != null
      ? decimalToNumber(player.financeAutoDiscountAmount)
      : decimalToNumber(settings?.defaultAutoDiscountAmount)
  );
  const manualDiscount = roundCurrency(manualDiscountAmount);
  const normalizedMatchesPlayed = Number(
    matchChargeUsage?.matchesPlayed ?? matchesPlayed ?? 0
  );
  const normalizedLateMatchesPlayed = Number(
    matchChargeUsage?.lateMatchesPlayed ?? lateMatchesPlayed ?? 0
  );
  const firstMatchPlayed = Boolean(matchChargeUsage?.firstMatchPlayed);
  const matchesAfterFirst = Number(
    matchChargeUsage?.matchesAfterFirst ??
      Math.max(normalizedMatchesPlayed - (firstMatchPlayed ? 1 : 0), 0)
  );
  const extraMatches = matchLimitApplied ? Math.max(normalizedMatchesPlayed - matchLimitApplied, 0) : 0;
  const monthlyExtraAmount = roundCurrency(extraMatches * extraMatchAmount);
  const customAmountApplied = player?.financeAmountOverride != null;
  const dueDate = buildMonthlyDueDate(year, month, settings?.dueDay || 10);
  const specialCompetenceRule = getSpecialFinanceCompetenceRule(month, year);
  const effectiveCurrentStatus =
    currentStatus || computeMonthlyFeeStatus({ amountDue: monthlyBaseAmount, amountPaid, isExempt: false });
  const billingMode = resolveMonthlyFeeBillingMode({
    month,
    year,
    participantType,
    currentBillingMode,
    currentStatus: effectiveCurrentStatus,
    dueDate,
    referenceDate,
  });
  const monthlyBaseWithTransition = roundCurrency(
    specialCompetenceRule && billingMode === "MONTHLY" && firstMatchPlayed
      ? Math.max(monthlyBaseAmount - specialCompetenceRule.firstMatchAmount, 0)
      : monthlyBaseAmount
  );
  const monthlyPlanAmount = roundCurrency(
    Math.max(monthlyBaseAmount + monthlyExtraAmount - autoDiscountAmount - manualDiscount, 0)
  );

  if (participantType === "EXEMPT" || billingMode === "EXEMPT") {
    return {
      participantType,
      billingMode: "EXEMPT",
      baseAmount: 0,
      autoDiscountAmount: 0,
      manualDiscountAmount: 0,
      extraAmount: 0,
      amountDue: 0,
      amountPaid: roundCurrency(amountPaid),
      status: "EXEMPT",
      dueDate,
      matchesPlayed: normalizedMatchesPlayed,
      lateMatchesPlayed: normalizedLateMatchesPlayed,
      matchLimitApplied,
      customAmountApplied,
      extraMatches: 0,
      latePerMatchAmount: appliedLatePerMatchAmount,
      ruleLabel: "Isencao integral aplicada",
    };
  }

  if (billingMode === "PER_MATCH") {
    const perMatchAccumulatedAmount = roundCurrency(
      specialCompetenceRule
        ? (firstMatchPlayed ? specialCompetenceRule.firstMatchAmount : 0) +
            matchesAfterFirst * appliedLatePerMatchAmount
        : normalizedMatchesPlayed * appliedLatePerMatchAmount
    );
    const amountDue = roundCurrency(Math.max(perMatchAccumulatedAmount - autoDiscountAmount - manualDiscount, 0));
    const status = computeMonthlyFeeStatus({
      amountDue,
      amountPaid,
      isExempt: false,
      billingMode,
    });

    return {
      participantType,
      billingMode,
      baseAmount: perMatchAccumulatedAmount,
      autoDiscountAmount,
      manualDiscountAmount: manualDiscount,
      extraAmount: 0,
      amountDue,
      amountPaid: roundCurrency(amountPaid),
      status,
      dueDate,
      matchesPlayed: normalizedMatchesPlayed,
      lateMatchesPlayed: normalizedLateMatchesPlayed,
      matchLimitApplied: null,
      customAmountApplied: false,
      extraMatches: 0,
      latePerMatchAmount: appliedLatePerMatchAmount,
      ruleLabel:
        specialCompetenceRule && firstMatchPlayed
          ? matchesAfterFirst > 0
            ? `1a pelada ${roundCurrency(specialCompetenceRule.firstMatchAmount)} + ${matchesAfterFirst} x ${roundCurrency(
                appliedLatePerMatchAmount
              )}`
            : `1a pelada ${roundCurrency(specialCompetenceRule.firstMatchAmount)}`
          : buildRuleLabel({
              participantType,
              billingMode,
              customAmountApplied: false,
              extraMatches: 0,
              autoDiscountAmount,
              manualDiscount,
              matchesPlayed: normalizedMatchesPlayed,
              lateMatchesPlayed: normalizedLateMatchesPlayed,
              latePerMatchAmount: appliedLatePerMatchAmount,
            }),
    };
  }

  if (billingMode === "LATE_PER_MATCH") {
    const lateAccumulatedAmount = roundCurrency(
      specialCompetenceRule
        ? (firstMatchPlayed ? specialCompetenceRule.firstMatchAmount : 0) +
            matchesAfterFirst * appliedLatePerMatchAmount
        : normalizedLateMatchesPlayed * appliedLatePerMatchAmount
    );
    const amountDue = roundCurrency(Math.max(lateAccumulatedAmount - autoDiscountAmount - manualDiscount, 0));
    const status = computeMonthlyFeeStatus({
      amountDue,
      amountPaid,
      isExempt: false,
      billingMode,
    });

    return {
      participantType,
      billingMode,
      baseAmount: lateAccumulatedAmount,
      autoDiscountAmount,
      manualDiscountAmount: manualDiscount,
      extraAmount: 0,
      amountDue,
      amountPaid: roundCurrency(amountPaid),
      status,
      dueDate,
      matchesPlayed: normalizedMatchesPlayed,
      lateMatchesPlayed: normalizedLateMatchesPlayed,
      matchLimitApplied: null,
      customAmountApplied,
      extraMatches: 0,
      latePerMatchAmount: appliedLatePerMatchAmount,
      ruleLabel:
        specialCompetenceRule && firstMatchPlayed
          ? matchesAfterFirst > 0
            ? `1a pelada ${roundCurrency(specialCompetenceRule.firstMatchAmount)} + ${matchesAfterFirst} x ${roundCurrency(
                appliedLatePerMatchAmount
              )}`
            : `1a pelada ${roundCurrency(specialCompetenceRule.firstMatchAmount)}`
          : buildRuleLabel({
              participantType,
              billingMode,
              customAmountApplied,
              extraMatches: 0,
              autoDiscountAmount,
              manualDiscount,
              matchesPlayed: normalizedMatchesPlayed,
              lateMatchesPlayed: normalizedLateMatchesPlayed,
              latePerMatchAmount: appliedLatePerMatchAmount,
            }),
    };
  }

  const status = computeMonthlyFeeStatus({
    amountDue: monthlyPlanAmount,
    amountPaid,
    isExempt: false,
    billingMode,
  });

  return {
    participantType,
    billingMode,
    baseAmount: monthlyBaseWithTransition,
    autoDiscountAmount,
    manualDiscountAmount: manualDiscount,
    extraAmount: monthlyExtraAmount,
    amountDue: monthlyPlanAmount,
    amountPaid: roundCurrency(amountPaid),
    status,
    dueDate,
    matchesPlayed: normalizedMatchesPlayed,
    lateMatchesPlayed: normalizedLateMatchesPlayed,
    matchLimitApplied,
    customAmountApplied,
    extraMatches,
    latePerMatchAmount: appliedLatePerMatchAmount,
    ruleLabel:
      specialCompetenceRule && firstMatchPlayed
        ? `1a pelada ${roundCurrency(specialCompetenceRule.firstMatchAmount)} + complemento ${roundCurrency(
            monthlyBaseWithTransition
          )}`
        : buildRuleLabel({
            participantType,
            billingMode,
            customAmountApplied,
            extraMatches,
            autoDiscountAmount,
            manualDiscount,
            matchesPlayed: normalizedMatchesPlayed,
            lateMatchesPlayed: normalizedLateMatchesPlayed,
            latePerMatchAmount: appliedLatePerMatchAmount,
          }),
  };
}

function buildMonthlyFeeRecordFromRule({
  player,
  settings,
  month,
  year,
  participantTypeOverride = null,
  matchesPlayed = 0,
  lateMatchesPlayed = 0,
  matchChargeUsage = null,
  referenceDate = new Date(),
}) {
  const breakdown = calculateMonthlyFeeBreakdown({
    player,
    settings,
    month,
    year,
    participantTypeOverride,
    matchesPlayed,
    lateMatchesPlayed,
    matchChargeUsage,
    manualDiscountAmount: 0,
    amountPaid: 0,
    referenceDate,
  });

  return {
    playerId: player.id,
    month,
    year,
    amountDue: breakdown.amountDue,
    amountPaid: 0,
    status: breakdown.status,
    billingMode: breakdown.billingMode,
    dueDate: breakdown.dueDate,
    participantType: breakdown.participantType,
    baseAmount: breakdown.baseAmount,
    autoDiscountAmount: breakdown.autoDiscountAmount,
    manualDiscountAmount: breakdown.manualDiscountAmount,
    extraAmount: breakdown.extraAmount,
    matchesPlayed: breakdown.matchesPlayed,
    lateMatchesPlayed: breakdown.lateMatchesPlayed,
    matchLimitApplied: breakdown.matchLimitApplied,
    latePerMatchAmount: breakdown.latePerMatchAmount,
    customAmountApplied: breakdown.customAmountApplied,
  };
}

function buildMonthlyFeeRuleUpdate(currentMonthlyFee, breakdown) {
  return {
    amountDue: breakdown.amountDue,
    status: breakdown.status,
    billingMode: breakdown.billingMode,
    dueDate: breakdown.dueDate,
    participantType: breakdown.participantType,
    baseAmount: breakdown.baseAmount,
    autoDiscountAmount: breakdown.autoDiscountAmount,
    manualDiscountAmount: breakdown.manualDiscountAmount,
    extraAmount: breakdown.extraAmount,
    matchesPlayed: breakdown.matchesPlayed,
    lateMatchesPlayed: breakdown.lateMatchesPlayed,
    matchLimitApplied: breakdown.matchLimitApplied,
    latePerMatchAmount: breakdown.latePerMatchAmount,
    customAmountApplied: Boolean(currentMonthlyFee?.customAmountApplied || breakdown.customAmountApplied),
  };
}

function buildPlayerFinanceRuleSummary(player, settings) {
  const participantType = normalizeParticipantType(player.financeParticipantType);
  const amountLabel =
    participantType === "PER_MATCH"
      ? roundCurrency(settings?.latePerMatchAmount || DEFAULT_LATE_PER_MATCH_AMOUNT)
      : player.financeAmountOverride != null
      ? roundCurrency(player.financeAmountOverride)
      : roundCurrency(settings.defaultMonthlyAmount);

  return {
    participantType,
    participantTypeMeta: getParticipantTypeMeta(participantType),
    amountLabel,
    hasOverride: player.financeAmountOverride != null,
    autoDiscountAmount: roundCurrency(player.financeAutoDiscountAmount),
    matchLimit: player.financeMatchLimit,
    extraMatchAmount:
      player.financeExtraMatchAmount != null ? roundCurrency(player.financeExtraMatchAmount) : roundCurrency(settings.defaultExtraMatchAmount),
    latePerMatchAmount: roundCurrency(settings?.latePerMatchAmount || DEFAULT_LATE_PER_MATCH_AMOUNT),
  };
}

module.exports = {
  PARTICIPANT_TYPE_OPTIONS,
  CHARGE_BEHAVIOR_OPTIONS,
  normalizeParticipantType,
  normalizeChargeBehavior,
  normalizeBillingMode,
  getParticipantTypeMeta,
  getBillingModeMeta,
  isPlayerEligibleForMonthlyFee,
  fetchMonthlyMatchUsage,
  fetchMonthlyMatchChargeUsage,
  fetchMonthlyLateMatchUsage,
  resolveMonthlyFeeBillingMode,
  calculateMonthlyFeeBreakdown,
  buildMonthlyFeeRecordFromRule,
  buildMonthlyFeeRuleUpdate,
  buildPlayerFinanceRuleSummary,
};
