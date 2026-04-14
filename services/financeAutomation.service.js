const {
  decimalToNumber,
  roundCurrency,
  computeMonthlyFeeBalance,
  buildFinanceWhatsappMessage,
  buildWhatsappUrl,
  formatCurrencyBR,
  formatMonthYearLabel,
  computeMonthlyFeeStatus,
  formatDateInput,
} = require("../utils/finance");
const {
  COLLECTION_STATUS_META,
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  COMPETENCE_STATE_META,
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
} = require("../helpers/financeStatus.helper");
const { buildFinanceAlerts } = require("../helpers/financeAlerts.helper");
const { buildFinanceReportSummary } = require("../helpers/financeSummary.helper");
const { buildBulkChargeSummary } = require("../helpers/financeMessage.helper");
const {
  PARTICIPANT_TYPE_OPTIONS,
  CHARGE_BEHAVIOR_OPTIONS,
  normalizeParticipantType,
  normalizeBillingMode,
  getParticipantTypeMeta,
  getBillingModeMeta,
  isPlayerEligibleForMonthlyFee,
  fetchMonthlyMatchUsage,
  fetchMonthlyLateMatchUsage,
  calculateMonthlyFeeBreakdown,
  buildMonthlyFeeRecordFromRule,
  buildMonthlyFeeRuleUpdate,
} = require("./financeRules.service");

function buildRuleSnapshot(monthlyFee) {
  const items = [];
  const participantType = normalizeParticipantType(monthlyFee.participantType || monthlyFee.player?.financeParticipantType);
  const billingMode = normalizeBillingMode(
    monthlyFee.billingMode,
    participantType === "EXEMPT" ? "EXEMPT" : participantType === "PER_MATCH" ? "PER_MATCH" : "MONTHLY"
  );

  if (billingMode === "PER_MATCH") {
    const matchesPlayed = Number(monthlyFee.matchesPlayed || 0);
    items.push("Avulso mensal");
    items.push(`${matchesPlayed} pelada(s) x ${formatCurrencyBR(monthlyFee.latePerMatchAmount || 25)}`);
    if (decimalToNumber(monthlyFee.manualDiscountAmount) > 0) items.push("Abat. manual");
    if (decimalToNumber(monthlyFee.autoDiscountAmount) > 0) items.push("Abat. auto");
    return items;
  }

  if (billingMode === "LATE_PER_MATCH") {
    const lateMatchesPlayed = Number(monthlyFee.lateMatchesPlayed || 0);
    items.push("Avulso por atraso");
    items.push(`${lateMatchesPlayed} pelada(s) x ${formatCurrencyBR(monthlyFee.latePerMatchAmount || 25)}`);
    if (Number(monthlyFee.matchesPlayed || 0) > 0) items.push(`${monthlyFee.matchesPlayed} no mes`);
    if (decimalToNumber(monthlyFee.manualDiscountAmount) > 0) items.push("Abat. manual");
    if (decimalToNumber(monthlyFee.autoDiscountAmount) > 0) items.push("Abat. auto");
    return items;
  }

  items.push(getParticipantTypeMeta(participantType).label);

  if (monthlyFee.customAmountApplied) items.push("Valor customizado");
  if (decimalToNumber(monthlyFee.extraAmount) > 0) items.push(`Extras ${monthlyFee.extraMatches || 0}`);
  if (decimalToNumber(monthlyFee.autoDiscountAmount) > 0) items.push("Abat. auto");
  if (decimalToNumber(monthlyFee.manualDiscountAmount) > 0) items.push("Abat. manual");
  if (Number(monthlyFee.matchesPlayed || 0) > 0) items.push(`${monthlyFee.matchesPlayed} pelada(s)`);

  return items;
}

function decorateMonthlyFee(monthlyFee, settings, now = new Date()) {
  const balance = computeMonthlyFeeBalance(monthlyFee);
  const collectionStatus = resolveCollectionStatus({ ...monthlyFee, balance }, now);
  const whatsappMessage =
    monthlyFee.status !== "EXEMPT" && balance > 0
      ? buildFinanceWhatsappMessage({
          playerName: monthlyFee.player?.name,
          amountPending: balance,
          month: monthlyFee.month,
          year: monthlyFee.year,
          pixKey: settings?.pixKey,
          receiverName: settings?.pixReceiverName,
          template: settings?.defaultWhatsappMessage,
        })
      : "";
  const whatsappUrl = whatsappMessage ? buildWhatsappUrl(monthlyFee.player?.whatsapp, whatsappMessage) : null;
  const participantType = normalizeParticipantType(monthlyFee.participantType || monthlyFee.player?.financeParticipantType);
  const billingMode = normalizeBillingMode(
    monthlyFee.billingMode,
    participantType === "EXEMPT" ? "EXEMPT" : participantType === "PER_MATCH" ? "PER_MATCH" : "MONTHLY"
  );

  return {
    ...monthlyFee,
    balance,
    collectionStatus,
    collectionStatusMeta: getCollectionStatusMeta(collectionStatus),
    chargePriorityBucket: getChargePriorityBucket({ ...monthlyFee, balance }, now),
    whatsappMessage,
    whatsappUrl,
    participantType,
    participantTypeMeta: getParticipantTypeMeta(participantType),
    billingMode,
    billingModeMeta: getBillingModeMeta(billingMode),
    isLatePerMatch: billingMode === "LATE_PER_MATCH",
    extraMatches:
      monthlyFee.matchLimitApplied && Number(monthlyFee.matchesPlayed || 0) > Number(monthlyFee.matchLimitApplied || 0)
        ? Number(monthlyFee.matchesPlayed || 0) - Number(monthlyFee.matchLimitApplied || 0)
        : 0,
    ruleSnapshot: buildRuleSnapshot(monthlyFee),
  };
}

function sameCurrency(a, b) {
  return roundCurrency(a) === roundCurrency(b);
}

function sameInteger(a, b) {
  return Number(a || 0) === Number(b || 0);
}

function sameDate(a, b) {
  return formatDateInput(a) === formatDateInput(b);
}

function hasRuleDrivenFeeChanged(current, nextData) {
  return !(
    sameCurrency(current.amountDue, nextData.amountDue) &&
    current.status === nextData.status &&
    current.billingMode === nextData.billingMode &&
    sameDate(current.dueDate, nextData.dueDate) &&
    current.participantType === nextData.participantType &&
    sameCurrency(current.baseAmount, nextData.baseAmount) &&
    sameCurrency(current.autoDiscountAmount, nextData.autoDiscountAmount) &&
    sameCurrency(current.manualDiscountAmount, nextData.manualDiscountAmount) &&
    sameCurrency(current.extraAmount, nextData.extraAmount) &&
    sameInteger(current.matchesPlayed, nextData.matchesPlayed) &&
    sameInteger(current.lateMatchesPlayed, nextData.lateMatchesPlayed) &&
    sameInteger(current.matchLimitApplied, nextData.matchLimitApplied) &&
    sameCurrency(current.latePerMatchAmount, nextData.latePerMatchAmount)
  );
}

function buildRuleDrivenUpdate(current, settings, options = {}) {
  const breakdown = calculateMonthlyFeeBreakdown({
    player: current.player,
    settings,
    month: current.month,
    year: current.year,
    matchesPlayed: options.matchesPlayed ?? current.matchesPlayed ?? 0,
    lateMatchesPlayed: options.lateMatchesPlayed ?? current.lateMatchesPlayed ?? 0,
    manualDiscountAmount: current.manualDiscountAmount || 0,
    amountPaid: current.amountPaid || 0,
    currentStatus: current.status,
    currentBillingMode: current.billingMode,
    referenceDate: options.referenceDate || new Date(),
    latePerMatchAmount: current.latePerMatchAmount,
  });

  return buildMonthlyFeeRuleUpdate(current, breakdown);
}

async function syncMonthlyFeeWithRules(prismaOrTx, { monthlyFee, settings, referenceDate = new Date(), matchesPlayed, lateMatchesPlayed }) {
  const current =
    monthlyFee.player
      ? monthlyFee
      : await prismaOrTx.monthlyFee.findUnique({
          where: { id: monthlyFee.id },
          include: { player: true },
        });

  if (!current) return null;

  const updateData = buildRuleDrivenUpdate(current, settings, {
    referenceDate,
    matchesPlayed,
    lateMatchesPlayed,
  });

  if (!hasRuleDrivenFeeChanged(current, updateData)) {
    return current;
  }

  return prismaOrTx.monthlyFee.update({
    where: { id: current.id },
    data: updateData,
    include: { player: true },
  });
}

async function syncMonthlyCompetenceRules({
  prisma,
  month,
  year,
  settings,
  monthlyFees = null,
  referenceDate = new Date(),
}) {
  const fees =
    monthlyFees ||
    (await prisma.monthlyFee.findMany({
      where: { month, year },
      include: { player: true },
    }));

  if (!fees.length) {
    return { updatedCount: 0, fees: [] };
  }

  const playerIds = fees.map((fee) => fee.playerId);
  const [usageMap, lateUsageMap] = await Promise.all([
    fetchMonthlyMatchUsage({ prisma, playerIds, month, year }),
    fetchMonthlyLateMatchUsage({
      prisma,
      playerIds,
      month,
      year,
      dueDay: settings?.dueDay || 10,
    }),
  ]);

  let updatedCount = 0;
  const syncedFees = [];

  for (const fee of fees) {
    const nextData = buildRuleDrivenUpdate(fee, settings, {
      referenceDate,
      matchesPlayed: usageMap.get(fee.playerId) || 0,
      lateMatchesPlayed: lateUsageMap.get(fee.playerId) || 0,
    });
    const changed = hasRuleDrivenFeeChanged(fee, nextData);
    const synced = changed
      ? await prisma.monthlyFee.update({
          where: { id: fee.id },
          data: nextData,
          include: { player: true },
        })
      : fee;

    if (changed) updatedCount += 1;
    syncedFees.push(synced);
  }

  return {
    updatedCount,
    fees: syncedFees,
  };
}

async function syncMonthlyFeeForPlayerCompetence({
  prisma,
  player,
  settings,
  month,
  year,
  referenceDate = new Date(),
}) {
  if (!player || !isPlayerEligibleForMonthlyFee(player)) {
    return null;
  }

  const [usageMap, lateUsageMap, current] = await Promise.all([
    fetchMonthlyMatchUsage({ prisma, playerIds: [player.id], month, year }),
    fetchMonthlyLateMatchUsage({
      prisma,
      playerIds: [player.id],
      month,
      year,
      dueDay: settings?.dueDay || 10,
    }),
    prisma.monthlyFee.findUnique({
      where: {
        player_month_year: {
          playerId: player.id,
          month,
          year,
        },
      },
      include: { player: true },
    }),
  ]);

  const matchesPlayed = usageMap.get(player.id) || 0;
  const lateMatchesPlayed = lateUsageMap.get(player.id) || 0;

  if (!current) {
    return prisma.monthlyFee.create({
      data: buildMonthlyFeeRecordFromRule({
        player,
        settings,
        month,
        year,
        matchesPlayed,
        lateMatchesPlayed,
        referenceDate,
      }),
      include: { player: true },
    });
  }

  return syncMonthlyFeeWithRules(prisma, {
    monthlyFee: current,
    settings,
    referenceDate,
    matchesPlayed,
    lateMatchesPlayed,
  });
}

async function ensureMonthlyCompetence({
  prisma,
  month,
  year,
  settings,
  eligiblePlayers,
  dryRun = false,
  referenceDate = new Date(),
}) {
  const eligible =
    eligiblePlayers ||
    (await prisma.player.findMany({
      where: {
        financeActive: true,
      },
      select: {
        id: true,
        name: true,
        financeActive: true,
        isMonthlyMember: true,
        financeParticipantType: true,
        financeAmountOverride: true,
        financeMatchLimit: true,
        financeExtraMatchAmount: true,
        financeAutoDiscountAmount: true,
      },
      orderBy: { name: "asc" },
    })).filter(isPlayerEligibleForMonthlyFee);

  const existingFees = await prisma.monthlyFee.findMany({
    where: {
      month,
      year,
      playerId: {
        in: eligible.map((player) => player.id),
      },
    },
    select: {
      id: true,
      playerId: true,
      status: true,
    },
  });

  const preparation = buildCompetencePreparation({
    eligiblePlayers: eligible,
    monthFees: existingFees,
  });

  if (dryRun || preparation.missingCount <= 0) {
    return {
      ...preparation,
      createdCount: 0,
    };
  }

  const [usageMap, lateUsageMap] = await Promise.all([
    fetchMonthlyMatchUsage({
      prisma,
      playerIds: preparation.missingPlayers.map((player) => player.id),
      month,
      year,
    }),
    fetchMonthlyLateMatchUsage({
      prisma,
      playerIds: preparation.missingPlayers.map((player) => player.id),
      month,
      year,
      dueDay: settings?.dueDay || 10,
    }),
  ]);

  const rows = preparation.missingPlayers.map((player) =>
    buildMonthlyFeeRecordFromRule({
      player,
      settings,
      month,
      year,
      matchesPlayed: usageMap.get(player.id) || 0,
      lateMatchesPlayed: lateUsageMap.get(player.id) || 0,
      referenceDate,
    })
  );

  const result = await prisma.monthlyFee.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    ...preparation,
    createdCount: result.count,
  };
}

async function recordMonthlyFeePayment(tx, { monthlyFeeId, monthlyFee, paymentAmount, paymentMethod, paidAt, note }) {
  const current =
    monthlyFee ||
    (await tx.monthlyFee.findUnique({
      where: { id: monthlyFeeId },
      include: { player: true },
    }));

  if (!current) {
    throw new Error("Monthly fee not found for payment");
  }

  const remaining = computeMonthlyFeeBalance(current);
  const safeAmount = roundCurrency(Math.min(Math.max(paymentAmount, 0), Math.max(remaining, 0)));
  if (safeAmount <= 0) {
    throw new Error("Payment amount must be positive");
  }

  const newAmountPaid = roundCurrency(decimalToNumber(current.amountPaid) + safeAmount);
  const status = computeMonthlyFeeStatus({
    amountDue: current.amountDue,
    amountPaid: newAmountPaid,
    isExempt: current.status === "EXEMPT" || current.participantType === "EXEMPT",
    billingMode: current.billingMode,
  });
  const monthLabel = formatMonthYearLabel(current.month, current.year);

  await tx.monthlyFee.update({
    where: { id: current.id },
    data: {
      amountPaid: newAmountPaid,
      status,
      paidAt,
      paymentMethod,
      note: note || current.note,
    },
  });

  await tx.cashTransaction.create({
    data: {
      type: "INCOME",
      category: "MONTHLY_FEE",
      amount: safeAmount,
      description: `Mensalidade ${monthLabel} - ${current.player.name}`,
      date: paidAt,
      note: note || null,
      origin: "MONTHLY_FEE",
      playerId: current.playerId,
      monthlyFeeId: current.id,
    },
  });

  return {
    monthlyFeeId: current.id,
    paymentAmount: safeAmount,
    status,
    paymentMethod,
    paidAt,
  };
}

module.exports = {
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  COLLECTION_STATUS_META,
  COMPETENCE_STATE_META,
  PARTICIPANT_TYPE_OPTIONS,
  CHARGE_BEHAVIOR_OPTIONS,
  getSaoPauloTodayDate,
  normalizeMonthlyCollectionFilter,
  normalizeChargeFilter,
  getCollectionStatusMeta,
  resolveCollectionStatus,
  decorateMonthlyFee,
  matchesMonthlyCollectionFilter,
  matchesChargeFilter,
  sortMonthlyFees,
  sortChargeFees,
  buildCompetencePreparation,
  buildCompetenceState,
  buildFinanceAlerts,
  buildFinanceReportSummary,
  buildBulkChargeSummary,
  ensureMonthlyCompetence,
  syncMonthlyFeeWithRules,
  syncMonthlyCompetenceRules,
  syncMonthlyFeeForPlayerCompetence,
  recordMonthlyFeePayment,
};
