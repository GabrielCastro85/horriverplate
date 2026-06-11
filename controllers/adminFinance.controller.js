const { z } = require("zod");
const prisma = require("../utils/db");
const {
  decimalToNumber,
  roundCurrency,
  formatDateBR,
  formatDateBRShortYear,
  computeMonthlyFeeStatus,
  computeMonthlyFeeBalance,
  getPaymentMethodLabel,
  getTransactionCategoryLabel,
  getMonthDateRange,
  FINANCE_TRANSACTION_CATEGORY_OPTIONS,
} = require("../utils/finance");
const {
  parseClampedInteger,
  getTrimmedString,
  getOptionalTrimmedString,
  normalizeUppercaseValue,
  parseCheckbox,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseDateInput,
  parseIdParam,
  parseOptionalId,
  parseIdList,
} = require("../helpers/financeInput.helper");
const {
  decorateMonthlyFee,
  ensureMonthlyCompetence,
  syncMonthlyFeeWithRules,
  syncMonthlyFeeForPlayerCompetence,
  syncMonthlyCompetenceRules,
  recordMonthlyFeePayment,
} = require("../services/financeAutomation.service");
const { getSaoPauloTodayDate } = require("../helpers/financeStatus.helper");
const {
  normalizeParticipantType,
  normalizeBillingMode,
  normalizeChargeBehavior,
  isPlayerEligibleForMonthlyFee,
  fetchMonthlyMatchChargeUsage,
  calculateMonthlyFeeBreakdown,
  buildMonthlyFeeRuleUpdate,
} = require("../services/financeRules.service");
const { recordFinanceEvent } = require("../services/financeEventLog.service");
const {
  loadFinanceReport,
  buildFinanceReportAuditDetails,
} = require("../services/financeReports.service");
const {
  renderFinanceReportHtml,
  renderFinanceReportPdfBuffer,
} = require("../services/financePdf.service");
const {
  ensureRecurringExpensesForMonth,
} = require("../services/financeRecurringExpenses.service");
const {
  normalizeFinanceFilters,
  buildFinancePath,
  getFinanceHashByTab,
  getMonthlyFeeHash,
  ensureFinanceSettings,
  clearFinanceSettingsCache,
  buildFinancePageViewModel,
  buildFinanceRenderView,
} = require("../services/financePage.service");

const CreateCashTransactionSchema = z.object({
  type: z.string().min(1),
  category: z.string().min(1),
  amount: z.string().min(1),
});

const RecurringExpenseSchema = z.object({
  name: z.string().min(1),
  amount: z.string().min(1),
  category: z.string().min(1),
});

const CreateGuestPaymentSchema = z.object({
  guestName: z.string().min(1),
  amount: z.string().min(1),
});

function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.redirect("/login");
  }
  next();
}

function redirectToFinance(res, source = {}, hash = "") {
  return res.redirect(buildFinancePath(source, hash));
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return req.xhr || accept.includes("application/json") || getTrimmedString(req.query.format, "").toLowerCase() === "json";
}

function sendFinanceResponse(req, res, { ok = true, source = {}, hash = "", payload = {}, statusCode = 200 }) {
  if (wantsJson(req)) {
    return res.status(statusCode).json({
      ok,
      redirectUrl: buildFinancePath(source, hash),
      ...payload,
    });
  }

  return redirectToFinance(res, source, hash);
}

async function createFinanceAudit(req, action, summary, details, meta = {}) {
  await recordFinanceEvent(prisma, req, {
    action,
    summary,
    entity: meta.entity || null,
    entityId: meta.entityId || null,
    sourceTab: meta.sourceTab || null,
    metadata: details,
    writeAudit: true,
  });
}

async function loadSyncedMonthlyFee(id, settings, referenceDate = getSaoPauloTodayDate()) {
  const current = await prisma.monthlyFee.findUnique({
    where: { id },
    include: {
      player: true,
    },
  });

  if (!current) return null;

  return syncMonthlyFeeWithRules(prisma, {
    monthlyFee: current,
    settings,
    referenceDate,
  });
}

function toSortedDateList(values = []) {
  return values
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a - b);
}

function buildMonthlyFeePaymentInstallments(fee) {
  if (!fee) return [];

  const matchDates = toSortedDateList(fee.matchChargeUsage?.matchDates || []);
  const lateMatchDates = toSortedDateList(fee.matchChargeUsage?.lateMatchDates || []);
  const unitAmount = roundCurrency(decimalToNumber(fee.latePerMatchAmount || 25));
  const specialFirstMatchAmount = roundCurrency(decimalToNumber(fee.specialFirstMatchAmount || 0));
  const specialComplementAmount = roundCurrency(decimalToNumber(fee.specialMonthlyComplementAmount || 0));
  const hasSpecialFirstMatch =
    Boolean(fee.specialTransitionApplied) && specialFirstMatchAmount > 0 && specialFirstMatchAmount < unitAmount;
  const installments = [];

  const pushInstallment = (amount, date) => {
    const parsedDate = date instanceof Date ? date : new Date(date);
    const normalizedAmount = roundCurrency(amount);
    if (!normalizedAmount || Number.isNaN(parsedDate.getTime())) return;
    installments.push({
      amount: normalizedAmount,
      date: parsedDate,
    });
  };

  if (fee.specialMonthlyTransitionApplied) {
    pushInstallment(specialFirstMatchAmount, matchDates[0]);
    pushInstallment(specialComplementAmount, matchDates[1] || fee.dueDate || matchDates[0]);
    return installments;
  }

  if (fee.billingMode === "PER_MATCH") {
    if (hasSpecialFirstMatch && matchDates.length) {
      pushInstallment(specialFirstMatchAmount, matchDates[0]);
      matchDates.slice(1).forEach((date) => pushInstallment(unitAmount, date));
      return installments;
    }

    matchDates.forEach((date) => pushInstallment(unitAmount, date));
    return installments;
  }

  if (fee.billingMode === "LATE_PER_MATCH") {
    if (hasSpecialFirstMatch && matchDates[0]) {
      pushInstallment(specialFirstMatchAmount, matchDates[0]);
      lateMatchDates.forEach((date) => pushInstallment(unitAmount, date));
      return installments;
    }

    lateMatchDates.forEach((date) => pushInstallment(unitAmount, date));
  }

  return installments;
}

function resolveAutomaticMonthlyFeePaidAt(fee, fallbackDate = new Date()) {
  const installments = buildMonthlyFeePaymentInstallments(fee);
  if (!installments.length) return fallbackDate;

  let remainingPaid = roundCurrency(decimalToNumber(fee.amountPaid));

  for (const installment of installments) {
    if (remainingPaid >= installment.amount) {
      remainingPaid = roundCurrency(remainingPaid - installment.amount);
      continue;
    }

    return installment.date;
  }

  return fallbackDate;
}

async function decorateFeeForAutomaticPaidAt(fee, settings, referenceDate = getSaoPauloTodayDate()) {
  if (!fee) return null;

  const chargeUsageMap = await fetchMonthlyMatchChargeUsage({
    prisma,
    playerIds: [fee.playerId],
    month: fee.month,
    year: fee.year,
    dueDay: settings?.dueDay || 10,
  });

  return decorateMonthlyFee(
    {
      ...fee,
      matchChargeUsage: chargeUsageMap.get(fee.playerId) || null,
    },
    settings,
    referenceDate
  );
}

async function decorateFeesForAutomaticPaidAt(fees, settings, referenceDate = getSaoPauloTodayDate()) {
  if (!fees?.length) return [];

  const chargeUsageMap = await fetchMonthlyMatchChargeUsage({
    prisma,
    playerIds: [...new Set(fees.map((fee) => fee.playerId))],
    month: fees[0].month,
    year: fees[0].year,
    dueDay: settings?.dueDay || 10,
  });

  return fees.map((fee) =>
    decorateMonthlyFee(
      {
        ...fee,
        matchChargeUsage: chargeUsageMap.get(fee.playerId) || null,
      },
      settings,
      referenceDate
    )
  );
}

function normalizeCompetenceManualPlan(value) {
  const normalized = normalizeParticipantType(value, "PER_MATCH");
  return ["MONTHLY", "PER_MATCH", "EXEMPT"].includes(normalized) ? normalized : "PER_MATCH";
}

function parseCompetencePlayerPlans(body = {}) {
  return Object.entries(body || {}).reduce((map, [key, value]) => {
    const match = key.match(/^competencePlan_(\d+)$/);
    if (!match) return map;

    const playerId = parseIdParam(match[1], null);
    if (!playerId) return map;

    map.set(playerId, normalizeCompetenceManualPlan(value));
    return map;
  }, new Map());
}

function summarizeCompetencePlayerPlans(players = [], planMap = new Map()) {
  return players.reduce(
    (summary, player) => {
      const plan = normalizeCompetenceManualPlan(planMap.get(player.id) || "PER_MATCH");
      if (plan === "MONTHLY") summary.monthlyCount += 1;
      else if (plan === "EXEMPT") summary.exemptCount += 1;
      else summary.perMatchCount += 1;
      return summary;
    },
    {
      monthlyCount: 0,
      perMatchCount: 0,
      exemptCount: 0,
    }
  );
}

async function handleEnsureMonthlyCompetence(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.body);
    const redirectHash = getFinanceHashByTab(filters.tab);
    const settings = await ensureFinanceSettings();
    const eligiblePlayers = (
      await prisma.player.findMany({
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
      })
    ).filter(isPlayerEligibleForMonthlyFee);
    const useManualCompetencePlans = parseCheckbox(req.body.useManualCompetencePlans);
    const competencePlanMap = useManualCompetencePlans ? parseCompetencePlayerPlans(req.body) : new Map();

    if (!eligiblePlayers.length) {
      return redirectToFinance(res, { ...filters, error: "sem-jogadores-ativos" }, redirectHash);
    }

    const today = getSaoPauloTodayDate();
    const result = await ensureMonthlyCompetence({
      prisma,
      month: filters.month,
      year: filters.year,
      settings,
      eligiblePlayers,
      competencePlanMap,
      useManualCompetencePlans,
      dryRun: false,
      referenceDate: today,
    });

    // Atualiza mensalidades ja existentes cujo plano foi alterado na janela de geracao
    let updatedCount = 0;
    if (useManualCompetencePlans && competencePlanMap.size > 0) {
      const existingFees = await prisma.monthlyFee.findMany({
        where: { month: filters.month, year: filters.year },
        include: { player: true },
      });

      for (const fee of existingFees) {
        if (fee.status === "PAID") continue; // nao altera mensalidades ja quitadas
        if (!competencePlanMap.has(fee.playerId)) continue;

        const newPlan = normalizeParticipantType(competencePlanMap.get(fee.playerId), "PER_MATCH");
        if (!["MONTHLY", "PER_MATCH", "EXEMPT"].includes(newPlan)) continue;
        if (fee.participantType === newPlan) continue; // plano nao mudou

        const breakdown = calculateMonthlyFeeBreakdown({
          player: fee.player,
          settings,
          month: fee.month,
          year: fee.year,
          participantTypeOverride: newPlan,
          matchesPlayed: fee.matchesPlayed,
          lateMatchesPlayed: fee.lateMatchesPlayed,
          matchChargeUsage: null,
          manualDiscountAmount: fee.manualDiscountAmount || 0,
          amountPaid: fee.amountPaid || 0,
          currentStatus: fee.status,
          currentBillingMode: fee.billingMode,
          referenceDate: today,
          latePerMatchAmount: fee.latePerMatchAmount,
        });

        await prisma.monthlyFee.update({
          where: { id: fee.id },
          data: buildMonthlyFeeRuleUpdate(fee, breakdown),
        });
        updatedCount++;
      }
    }

    const planSummary = summarizeCompetencePlayerPlans(eligiblePlayers, competencePlanMap);

    await createFinanceAudit(req, "finance.monthly_competence.ensure", "Competencia mensal garantida", {
      month: filters.month,
      year: filters.year,
      eligibleCount: result.eligibleCount,
      missingCount: result.missingCount,
      createdCount: result.createdCount,
      updatedCount,
      useManualCompetencePlans,
      monthlyCount: planSummary.monthlyCount,
      perMatchCount: planSummary.perMatchCount,
      exemptCount: planSummary.exemptCount,
      sourceTab: filters.tab,
    });

    return redirectToFinance(
      res,
      { ...filters, notice: (result.createdCount > 0 || updatedCount > 0) ? "competencia-preparada" : "mensalidades-ja-existentes" },
      redirectHash
    );
  } catch (err) {
    console.error("Erro ao garantir competencia mensal:", err);
    return redirectToFinance(res, { ...req.body, error: "mensalidades" }, getFinanceHashByTab(req.body.tab));
  }
}

async function renderFinancePage(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.query);
    const financePage = await buildFinancePageViewModel(filters);
    const financeView = buildFinanceRenderView(financePage);

    res.render("admin_finance", {
      title: financePage.page.title,
      financePage,
      financeView,
    });
  } catch (err) {
    console.error("Erro ao carregar financeiro:", err);
    res.status(500).send("Erro ao carregar o financeiro.");
  }
}

async function renderFinanceReportPreview(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.query);
    const settings = await ensureFinanceSettings();
    const reportPayload = await loadFinanceReport({
      prisma,
      settings,
      params: filters,
      includeHistory: false,
    });
    const html = await renderFinanceReportHtml(reportPayload);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("Erro ao gerar previa do relatorio financeiro:", err);
    return res.status(500).send("Erro ao gerar a previa do relatorio financeiro.");
  }
}

async function renderFinanceReportPdf(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.query);
    const settings = await ensureFinanceSettings();
    const reportPayload = await loadFinanceReport({
      prisma,
      settings,
      params: filters,
      includeHistory: false,
    });
    const pdfBuffer = await renderFinanceReportPdfBuffer(reportPayload);

    await createFinanceAudit(
      req,
      "finance.report.generate",
      `${reportPayload.reportMeta.label} gerado para ${reportPayload.period.label}`,
      buildFinanceReportAuditDetails(reportPayload)
    );

    const disposition = String(req.query.download || "") === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${reportPayload.filename}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    return res.end(pdfBuffer);
  } catch (err) {
    console.error("Erro ao gerar PDF financeiro:", err);
    return res.status(500).send("Erro ao gerar o PDF financeiro.");
  }
}
async function updateFinanceSettings(req, res) {
  try {
    const current = await ensureFinanceSettings();
    const filters = normalizeFinanceFilters(req.body);
    const defaultMonthlyAmount = parseMoneyInput(req.body.defaultMonthlyAmount, current.defaultMonthlyAmount);
    const dueDay = parseClampedInteger(req.body.dueDay, { fallback: current.dueDay, min: 1, max: 31 });
    const latePerMatchAmount = parseMoneyInput(req.body.latePerMatchAmount, current.latePerMatchAmount);
    const defaultIncludedMatches = parseClampedInteger(req.body.defaultIncludedMatches, {
      fallback: current.defaultIncludedMatches,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    const defaultExtraMatchAmount = parseMoneyInput(
      req.body.defaultExtraMatchAmount,
      current.defaultExtraMatchAmount
    );
    const defaultAutoDiscountAmount = parseMoneyInput(
      req.body.defaultAutoDiscountAmount,
      current.defaultAutoDiscountAmount
    );
    const chargeBehavior = normalizeChargeBehavior(req.body.chargeBehavior, current.chargeBehavior);
    const autoGenerateCompetence = parseCheckbox(req.body.autoGenerateCompetence);

    await prisma.financeSettings.update({
      where: { id: current.id },
      data: {
        defaultMonthlyAmount,
        dueDay,
        latePerMatchAmount,
        defaultIncludedMatches,
        defaultExtraMatchAmount,
        defaultAutoDiscountAmount,
        chargeBehavior,
        autoGenerateCompetence,
        pixKey: getOptionalTrimmedString(req.body.pixKey),
        pixReceiverName: getOptionalTrimmedString(req.body.pixReceiverName),
        defaultWhatsappMessage: getOptionalTrimmedString(req.body.defaultWhatsappMessage),
      },
    });

    await createFinanceAudit(req, "finance.settings.update", "Configuracoes do financeiro atualizadas", {
      defaultMonthlyAmount,
      dueDay,
      latePerMatchAmount,
      defaultIncludedMatches,
      defaultExtraMatchAmount,
      defaultAutoDiscountAmount,
      chargeBehavior,
      autoGenerateCompetence,
    });

    clearFinanceSettingsCache();
    const refreshedSettings = await ensureFinanceSettings();
    await syncMonthlyCompetenceRules({
      prisma,
      month: filters.month,
      year: filters.year,
      settings: refreshedSettings,
      referenceDate: getSaoPauloTodayDate(),
    });

    return redirectToFinance(res, { ...req.body, notice: "configuracoes-salvas" }, "#finance-settings");
  } catch (err) {
    console.error("Erro ao salvar configuracoes do financeiro:", err);
    return redirectToFinance(res, { ...req.body, error: "configuracoes" }, "#finance-settings");
  }
}

async function updateFinancePlayer(req, res) {
  try {
    const playerId = parseIdParam(req.params.id, null);
    if (!playerId) {
      return redirectToFinance(res, { ...req.body, error: "jogador-invalido" }, "#finance-members");
    }

    const participantType = normalizeParticipantType(req.body.financeParticipantType);
    const financeActive = participantType !== "GUEST";
    const isMonthlyMember = participantType !== "GUEST";
    let financeAmountOverride = parseOptionalMoneyInput(req.body.financeAmountOverride);
    let financeMatchLimit = parseOptionalId(req.body.financeMatchLimit, null);
    let financeExtraMatchAmount = parseOptionalMoneyInput(req.body.financeExtraMatchAmount);
    const financeAutoDiscountAmount = parseMoneyInput(req.body.financeAutoDiscountAmount, 0);
    const financeNotes = getOptionalTrimmedString(req.body.financeNotes);
    const filters = normalizeFinanceFilters(req.body);

    if (participantType === "MONTHLY" || participantType === "PER_MATCH") {
      financeAmountOverride = null;
      financeMatchLimit = null;
      financeExtraMatchAmount = null;
    }

    await prisma.player.update({
      where: { id: playerId },
      data: {
        financeActive,
        isMonthlyMember,
        financeParticipantType: participantType,
        financeAmountOverride,
        financeMatchLimit,
        financeExtraMatchAmount,
        financeAutoDiscountAmount,
        financeNotes,
      },
    });

    const updatedPlayer = await prisma.player.findUnique({
      where: { id: playerId },
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
    });

    const settings = await ensureFinanceSettings();
    if (updatedPlayer) {
      await syncMonthlyFeeForPlayerCompetence({
        prisma,
        player: updatedPlayer,
        settings,
        month: filters.month,
        year: filters.year,
        referenceDate: getSaoPauloTodayDate(),
      });
    }

    await createFinanceAudit(req, "finance.player.update", "Participacao financeira do jogador atualizada", {
      playerId,
      financeActive,
      isMonthlyMember,
      participantType,
      financeAmountOverride,
      financeMatchLimit,
      financeExtraMatchAmount,
      financeAutoDiscountAmount,
    });

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...req.body, notice: "jogador-salvo" },
      hash: "#finance-members",
      payload: {
        message: "Regra do participante atualizada.",
        playerId,
        participantType,
      },
    });
  } catch (err) {
    console.error("Erro ao atualizar flags do jogador no financeiro:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "jogador-salvo" },
      hash: "#finance-members",
      payload: { message: "Nao foi possivel atualizar a regra do participante." },
      statusCode: 400,
    });
  }
}

async function updateMonthlyFee(req, res) {
  try {
    const feeHash = getMonthlyFeeHash(req.body);
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-invalida" },
        hash: feeHash,
        payload: { message: "Mensalidade invalida." },
        statusCode: 400,
      });
    }

    const settings = await ensureFinanceSettings();
    const current = await loadSyncedMonthlyFee(id, settings);
    if (!current) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-nao-encontrada" },
        hash: feeHash,
        payload: { message: "Mensalidade nao encontrada." },
        statusCode: 404,
      });
    }
    const amountDue = parseMoneyInput(req.body.amountDue, current.amountDue);
    const manualDiscountAmount = parseMoneyInput(
      req.body.manualDiscountAmount,
      current.manualDiscountAmount || 0
    );
    const note = getOptionalTrimmedString(req.body.note);
    const paymentMethod = getOptionalTrimmedString(req.body.paymentMethod);
    const dueDate = parseDateInput(req.body.dueDate, null);
    const isExempt = parseCheckbox(req.body.isExempt);
    const syncAmountWithRules = parseCheckbox(req.body.syncAmountWithRules);
    const billingModeInput = normalizeBillingMode(req.body.billingMode, current.billingMode);
    const chargeUsageMap = await fetchMonthlyMatchChargeUsage({
      prisma,
      playerIds: [current.playerId],
      month: current.month,
      year: current.year,
      dueDay: settings?.dueDay || 10,
    });
    const chargeUsage = chargeUsageMap.get(current.playerId) || null;
    const recalculated = calculateMonthlyFeeBreakdown({
      player: current.player,
      settings,
      month: current.month,
      year: current.year,
      matchesPlayed: chargeUsage?.matchesPlayed ?? current.matchesPlayed ?? 0,
      lateMatchesPlayed: chargeUsage?.lateMatchesPlayed ?? current.lateMatchesPlayed ?? 0,
      matchChargeUsage: chargeUsage,
      manualDiscountAmount,
      amountPaid: current.amountPaid,
      currentStatus: current.status,
      currentBillingMode: isExempt ? "EXEMPT" : billingModeInput,
      referenceDate: getSaoPauloTodayDate(),
      latePerMatchAmount: current.latePerMatchAmount,
    });
    const participantType = isExempt ? "EXEMPT" : normalizeParticipantType(current.player.financeParticipantType);
    const billingMode = isExempt ? "EXEMPT" : recalculated.billingMode;
    const resolvedAmountDue = syncAmountWithRules ? recalculated.amountDue : amountDue;
    const status = computeMonthlyFeeStatus({
      amountDue: resolvedAmountDue,
      amountPaid: current.amountPaid,
      isExempt: participantType === "EXEMPT",
      billingMode,
    });
    const paidAt =
      status === "PAID" || status === "PARTIAL"
        ? current.paidAt || new Date()
        : status === "EXEMPT"
          ? current.paidAt
          : null;

    await prisma.monthlyFee.update({
      where: { id },
      data: {
        amountDue: resolvedAmountDue,
        dueDate,
        note,
        paymentMethod,
        status,
        paidAt,
        participantType,
        billingMode,
        manualDiscountAmount,
        baseAmount: recalculated.baseAmount,
        autoDiscountAmount: recalculated.autoDiscountAmount,
        extraAmount: recalculated.extraAmount,
        matchesPlayed: recalculated.matchesPlayed,
        lateMatchesPlayed: recalculated.lateMatchesPlayed,
        latePerMatchAmount: recalculated.latePerMatchAmount,
        customAmountApplied:
          current.player.financeAmountOverride != null || Math.abs(resolvedAmountDue - recalculated.amountDue) > 0.009,
      },
    });

    await createFinanceAudit(req, "finance.monthly_fee.update", "Mensalidade atualizada", {
      monthlyFeeId: id,
      amountDue: resolvedAmountDue,
      manualDiscountAmount,
      status,
      billingMode,
      syncAmountWithRules,
    });

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...req.body, notice: "mensalidade-atualizada", editFeeId: id },
      hash: feeHash,
      payload: {
        message: "Mensalidade atualizada.",
        monthlyFeeId: id,
      },
    });
  } catch (err) {
    console.error("Erro ao atualizar mensalidade:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "mensalidade-atualizar" },
      hash: getMonthlyFeeHash(req.body),
      payload: { message: "Nao foi possivel atualizar a mensalidade." },
      statusCode: 400,
    });
  }
}

async function recalculateMonthlyFee(req, res) {
  try {
    const feeHash = getMonthlyFeeHash(req.body);
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-invalida" },
        hash: feeHash,
        payload: { message: "Mensalidade invalida." },
        statusCode: 400,
      });
    }

    const settings = await ensureFinanceSettings();
    const current = await loadSyncedMonthlyFee(id, settings);
    if (!current) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-nao-encontrada" },
        hash: feeHash,
        payload: { message: "Mensalidade nao encontrada." },
        statusCode: 404,
      });
    }
    const chargeUsageMap = await fetchMonthlyMatchChargeUsage({
      prisma,
      playerIds: [current.playerId],
      month: current.month,
      year: current.year,
      dueDay: settings?.dueDay || 10,
    });
    const manualDiscountAmount = parseMoneyInput(
      req.body.manualDiscountAmount,
      current.manualDiscountAmount || 0
    );
    const chargeUsage = chargeUsageMap.get(current.playerId) || null;
    const breakdown = calculateMonthlyFeeBreakdown({
      player: current.player,
      settings,
      month: current.month,
      year: current.year,
      matchesPlayed: chargeUsage?.matchesPlayed || 0,
      lateMatchesPlayed: chargeUsage?.lateMatchesPlayed || 0,
      matchChargeUsage: chargeUsage,
      manualDiscountAmount,
      amountPaid: current.amountPaid,
      currentStatus: current.status,
      currentBillingMode:
        current.player.financeParticipantType === "PER_MATCH"
          ? "PER_MATCH"
          : current.player.financeParticipantType === "EXEMPT"
            ? "EXEMPT"
            : null,
      referenceDate: getSaoPauloTodayDate(),
      latePerMatchAmount: current.latePerMatchAmount,
    });
    const paidAt =
      breakdown.status === "PAID" || breakdown.status === "PARTIAL"
        ? current.paidAt || new Date()
        : breakdown.status === "EXEMPT"
          ? current.paidAt
          : null;

    await prisma.monthlyFee.update({
      where: { id },
      data: {
        amountDue: breakdown.amountDue,
        status: breakdown.status,
        billingMode: breakdown.billingMode,
        dueDate: breakdown.dueDate,
        paidAt,
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
      },
    });

    await createFinanceAudit(req, "finance.monthly_fee.recalculate", "Mensalidade recalculada pelas regras atuais", {
      monthlyFeeId: id,
      amountDue: breakdown.amountDue,
      participantType: breakdown.participantType,
      billingMode: breakdown.billingMode,
      matchesPlayed: breakdown.matchesPlayed,
      lateMatchesPlayed: breakdown.lateMatchesPlayed,
      extraAmount: breakdown.extraAmount,
      manualDiscountAmount: breakdown.manualDiscountAmount,
    });

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...req.body, notice: "mensalidade-atualizada", editFeeId: id },
      hash: feeHash,
      payload: {
        message: "Regra do jogador reaplicada nesta mensalidade.",
        monthlyFeeId: id,
      },
    });
  } catch (err) {
    console.error("Erro ao recalcular mensalidade:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "mensalidade-atualizar", editFeeId: req.params.id },
      hash: getMonthlyFeeHash(req.body),
      payload: { message: "Nao foi possivel reaplicar as regras desta mensalidade." },
      statusCode: 400,
    });
  }
}
async function payMonthlyFee(req, res) {
  try {
    const feeHash = getMonthlyFeeHash(req.body);
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-invalida" },
        hash: feeHash,
        payload: { message: "Mensalidade invalida." },
        statusCode: 400,
      });
    }

    const settings = await ensureFinanceSettings();
    const current = await loadSyncedMonthlyFee(id, settings);
    if (!current) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "mensalidade-nao-encontrada" },
        hash: feeHash,
        payload: { message: "Mensalidade nao encontrada." },
        statusCode: 404,
      });
    }

    const remaining = computeMonthlyFeeBalance(current);
    const requestedAmount =
      req.body.paymentScope === "remaining"
        ? remaining
        : parseMoneyInput(req.body.paymentAmount, remaining);
    const paymentAmount = roundCurrency(Math.min(Math.max(requestedAmount, 0), Math.max(remaining, 0)));

    if (paymentAmount <= 0) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...req.body, error: "pagamento-invalido", editFeeId: id },
        hash: feeHash,
        payload: { message: "Informe um valor de pagamento valido." },
        statusCode: 400,
      });
    }

    const paymentMethod = getTrimmedString(req.body.paymentMethod, "PIX") || "PIX";
    const requestedPaidAt = parseDateInput(req.body.paidAt, null);
    const paymentNote = getOptionalTrimmedString(req.body.note) || current.note;
    const feeForPaidAt = requestedPaidAt
      ? current
      : await decorateFeeForAutomaticPaidAt(current, settings, getSaoPauloTodayDate());
    const paidAt = requestedPaidAt || resolveAutomaticMonthlyFeePaidAt(feeForPaidAt, getSaoPauloTodayDate());
    const paymentResult = await prisma.$transaction((tx) =>
      recordMonthlyFeePayment(tx, {
        monthlyFeeId: id,
        paymentAmount,
        paymentMethod,
        paidAt,
        note: paymentNote,
      })
    );

    await createFinanceAudit(req, "finance.monthly_fee.pay", "Pagamento registrado na mensalidade", {
      monthlyFeeId: id,
      paymentAmount: paymentResult.paymentAmount,
      paymentMethod,
      status: paymentResult.status,
    });

    const updatedFeeRaw = wantsJson(req)
      ? await prisma.monthlyFee.findUnique({
          where: { id },
          include: {
            player: true,
          },
        })
      : null;
    const updatedFee = updatedFeeRaw
      ? decorateMonthlyFee(updatedFeeRaw, settings, getSaoPauloTodayDate())
      : null;

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...req.body, notice: "pagamento-registrado", editFeeId: id },
      hash: feeHash,
      payload: {
        message: paymentResult.status === "PAID" ? "Mensalidade quitada." : "Pagamento parcial registrado.",
        monthlyFeeId: id,
        paymentAmount: paymentResult.paymentAmount,
        status: paymentResult.status,
        updatedFee: updatedFee
          ? {
              id: updatedFee.id,
              amountDue: decimalToNumber(updatedFee.amountDue),
              amountPaid: decimalToNumber(updatedFee.amountPaid),
              balance: updatedFee.balance,
              status: updatedFee.collectionStatus,
              statusLabel: updatedFee.collectionStatusMeta.label,
              statusTone: updatedFee.collectionStatusMeta.tone,
              paidAt: formatDateBRShortYear(updatedFee.paidAt),
              paymentMethodLabel: getPaymentMethodLabel(updatedFee.paymentMethod),
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Erro ao registrar pagamento da mensalidade:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "pagamento", editFeeId: req.params.id },
      hash: getMonthlyFeeHash(req.body),
      payload: { message: "Nao foi possivel registrar o pagamento." },
      statusCode: 400,
    });
  }
}

async function handleBulkCharge(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.body);
    const redirectHash = getFinanceHashByTab(filters.tab || "charge");
    const selectedIds = parseIdList(req.body.feeIds);

    if (!selectedIds.length) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...filters, error: "charge-bulk-empty" },
        hash: redirectHash,
        payload: { message: "Selecione pelo menos uma cobranca para a acao em lote." },
        statusCode: 400,
      });
    }

    const fees = await prisma.monthlyFee.findMany({
      where: {
        id: {
          in: selectedIds,
        },
        month: filters.month,
        year: filters.year,
      },
      include: {
        player: true,
      },
      orderBy: {
        player: {
          name: "asc",
        },
      },
    });

    const settings = await ensureFinanceSettings();
    const syncedFees = [];
    for (const fee of fees) {
      const synced = await syncMonthlyFeeWithRules(prisma, {
        monthlyFee: fee,
        settings,
        referenceDate: getSaoPauloTodayDate(),
      });
      syncedFees.push(synced || fee);
    }

    const payableFees = syncedFees.filter((fee) => fee.status !== "EXEMPT" && computeMonthlyFeeBalance(fee) > 0);
    if (!payableFees.length) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...filters, error: "charge-bulk-empty" },
        hash: redirectHash,
        payload: { message: "As cobrancas selecionadas ja estavam sem saldo pendente." },
        statusCode: 400,
      });
    }

    const requestedPaidAt = parseDateInput(req.body.paidAt, null);
    const paymentMethod = getTrimmedString(req.body.paymentMethod, "PIX") || "PIX";
    const note = getOptionalTrimmedString(req.body.note) || "Quitacao em lote pela aba de cobranca";
    const payableFeesForPayment = requestedPaidAt
      ? payableFees
      : await decorateFeesForAutomaticPaidAt(payableFees, settings, getSaoPauloTodayDate());

    let totalAmount = 0;
    await prisma.$transaction(async (tx) => {
      for (const fee of payableFeesForPayment) {
        const paidAt = requestedPaidAt || resolveAutomaticMonthlyFeePaidAt(fee, getSaoPauloTodayDate());
        const paymentResult = await recordMonthlyFeePayment(tx, {
          monthlyFeeId: fee.id,
          monthlyFee: fee,
          paymentAmount: computeMonthlyFeeBalance(fee),
          paymentMethod,
          paidAt,
          note,
        });
        totalAmount += paymentResult.paymentAmount;
      }
    });

    await createFinanceAudit(req, "finance.charge.bulk_paid", "Cobranca em lote marcada como paga", {
      monthlyFeeIds: payableFees.map((fee) => fee.id),
      count: payableFees.length,
      totalAmount: roundCurrency(totalAmount),
      paymentMethod,
    });

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...filters, notice: "charge-bulk-paid" },
      hash: redirectHash,
      payload: {
        message: `${payableFees.length} mensalidade(s) marcadas como pagas.`,
        count: payableFees.length,
        totalAmount: roundCurrency(totalAmount),
      },
    });
  } catch (err) {
    console.error("Erro ao processar pagamento em lote na cobranca:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "charge-bulk-pay" },
      hash: getFinanceHashByTab(req.body.tab || "charge"),
      payload: { message: "Nao foi possivel concluir o pagamento em lote." },
      statusCode: 400,
    });
  }
}

async function handleBulkMonthlyStatus(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.body);
    const redirectHash = getFinanceHashByTab(filters.tab || "monthly");
    const selectedIds = parseIdList(req.body.feeIds);
    const bulkAction = normalizeUppercaseValue(req.body.bulkAction, "PAID");

    console.debug("[finance][bulk-monthly-status] request", {
      month: filters.month,
      year: filters.year,
      bulkAction,
      selectedIds,
      selectedCount: selectedIds.length,
      wantsJson: wantsJson(req),
    });

    if (!selectedIds.length) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...filters, error: "charge-bulk-empty" },
        hash: redirectHash,
        payload: { message: "Selecione pelo menos uma mensalidade para a acao em lote." },
        statusCode: 400,
      });
    }

    const fees = await prisma.monthlyFee.findMany({
      where: {
        id: { in: selectedIds },
        month: filters.month,
        year: filters.year,
      },
      include: {
        player: true,
        transactions: {
          select: {
            id: true,
            amount: true,
          },
        },
      },
      orderBy: {
        player: { name: "asc" },
      },
    });

    const settings = await ensureFinanceSettings();
    const syncedFees = [];
    for (const fee of fees) {
      const synced = await syncMonthlyFeeWithRules(prisma, {
        monthlyFee: fee,
        settings,
        referenceDate: getSaoPauloTodayDate(),
      });
      syncedFees.push(synced || fee);
    }

    if (bulkAction === "PENDING") {
      const reversibleFees = syncedFees.filter(
        (fee) =>
          fee.status !== "EXEMPT" &&
          (decimalToNumber(fee.amountPaid) > 0 || (fee.transactions?.length || 0) > 0) &&
          decimalToNumber(fee.amountDue) > 0
      );

      if (!reversibleFees.length) {
        return sendFinanceResponse(req, res, {
          ok: false,
          source: { ...filters, error: "charge-bulk-empty" },
          hash: redirectHash,
          payload: { message: "Nenhuma mensalidade selecionada podia voltar para pendente." },
          statusCode: 400,
        });
      }

      const resetIds = reversibleFees.map((fee) => fee.id);
      const deletedTransactionsCount = reversibleFees.reduce(
        (sum, fee) => sum + (fee.transactions?.length || 0),
        0
      );
      const deletedTransactionsAmount = roundCurrency(
        reversibleFees.reduce(
          (sum, fee) =>
            sum +
            (fee.transactions || []).reduce(
              (innerSum, transaction) => innerSum + decimalToNumber(transaction.amount),
              0
            ),
          0
        )
      );

      await prisma.$transaction(async (tx) => {
        await tx.cashTransaction.deleteMany({
          where: {
            monthlyFeeId: { in: resetIds },
          },
        });

        for (const fee of reversibleFees) {
          await tx.monthlyFee.update({
            where: { id: fee.id },
            data: {
              amountPaid: 0,
              status: computeMonthlyFeeStatus({
                amountDue: fee.amountDue,
                amountPaid: 0,
                isExempt: fee.status === "EXEMPT" || fee.participantType === "EXEMPT",
                billingMode: fee.billingMode,
              }),
              paidAt: null,
              paymentMethod: null,
            },
          });
        }
      });

      await createFinanceAudit(req, "finance.monthly_fee.bulk_pending", "Mensalidades retornadas para pendente", {
        monthlyFeeIds: resetIds,
        count: resetIds.length,
        deletedTransactionsCount,
        deletedTransactionsAmount,
      });

      return sendFinanceResponse(req, res, {
        ok: true,
        source: { ...filters, notice: "charge-bulk-pending" },
        hash: redirectHash,
        payload: {
          message: `${resetIds.length} mensalidade(s) voltaram para pendente.`,
          count: resetIds.length,
          processedFeeIds: resetIds,
        },
      });
    }

    const payableFees = syncedFees.filter((fee) => fee.status !== "EXEMPT" && computeMonthlyFeeBalance(fee) > 0);
    if (!payableFees.length) {
      return sendFinanceResponse(req, res, {
        ok: false,
        source: { ...filters, error: "charge-bulk-empty" },
        hash: redirectHash,
        payload: { message: "As mensalidades selecionadas ja estavam sem saldo pendente." },
        statusCode: 400,
      });
    }

    const requestedPaidAt = parseDateInput(req.body.paidAt, null);
    const paymentMethod = getTrimmedString(req.body.paymentMethod, "PIX") || "PIX";
    const note = getOptionalTrimmedString(req.body.note) || "Quitacao em lote pela aba de mensalidades";
    const payableFeesForPayment = requestedPaidAt
      ? payableFees
      : await decorateFeesForAutomaticPaidAt(payableFees, settings, getSaoPauloTodayDate());

    let totalAmount = 0;
    await prisma.$transaction(async (tx) => {
      for (const fee of payableFeesForPayment) {
        const paidAt = requestedPaidAt || resolveAutomaticMonthlyFeePaidAt(fee, getSaoPauloTodayDate());
        const paymentResult = await recordMonthlyFeePayment(tx, {
          monthlyFeeId: fee.id,
          monthlyFee: fee,
          paymentAmount: computeMonthlyFeeBalance(fee),
          paymentMethod,
          paidAt,
          note,
        });
        totalAmount += paymentResult.paymentAmount;
      }
    });

    await createFinanceAudit(req, "finance.monthly_fee.bulk_paid", "Mensalidades marcadas como pagas em lote", {
      monthlyFeeIds: payableFees.map((fee) => fee.id),
      count: payableFees.length,
      totalAmount: roundCurrency(totalAmount),
      paymentMethod,
    });

    return sendFinanceResponse(req, res, {
      ok: true,
      source: { ...filters, notice: "charge-bulk-paid" },
      hash: redirectHash,
      payload: {
        message: `${payableFees.length} mensalidade(s) marcadas como pagas.`,
        count: payableFees.length,
        totalAmount: roundCurrency(totalAmount),
        processedFeeIds: payableFees.map((fee) => fee.id),
      },
    });
  } catch (err) {
    console.error("Erro ao processar status em lote das mensalidades:", err);
    return sendFinanceResponse(req, res, {
      ok: false,
      source: { ...req.body, error: "charge-bulk-pay" },
      hash: getFinanceHashByTab(req.body.tab || "monthly"),
      payload: { message: "Nao foi possivel concluir a acao em lote das mensalidades." },
      statusCode: 400,
    });
  }
}

async function deleteMonthlyFee(req, res) {
  try {
    const feeHash = getMonthlyFeeHash(req.body);
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "mensalidade-excluir" }, feeHash);
    }

    const current = await prisma.monthlyFee.findUnique({
      where: { id },
      include: {
        player: true,
        transactions: {
          select: {
            id: true,
            amount: true,
          },
        },
      },
    });
    if (!current) {
      return redirectToFinance(res, { ...req.body, error: "mensalidade-nao-encontrada" }, feeHash);
    }

    const linkedTransactionsCount = current.transactions.length;
    const linkedTransactionsAmount = current.transactions.reduce(
      (sum, transaction) => sum + decimalToNumber(transaction.amount),
      0
    );

    await prisma.$transaction(async (tx) => {
      await tx.cashTransaction.deleteMany({ where: { monthlyFeeId: id } });
      await tx.monthlyFee.delete({ where: { id } });
    });

    await createFinanceAudit(req, "finance.monthly_fee.delete", "Mensalidade excluida", {
      monthlyFeeId: id,
      playerId: current.playerId,
      playerName: current.player?.name || null,
      month: current.month,
      year: current.year,
      linkedTransactionsCount,
      linkedTransactionsAmount,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: "mensalidade-excluida", editFeeId: "" },
      feeHash
    );
  } catch (err) {
    console.error("Erro ao excluir mensalidade:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "mensalidade-excluir", editFeeId: req.params.id },
      getMonthlyFeeHash(req.body)
    );
  }
}
async function exemptMonthlyFee(req, res) {
  try {
    const feeHash = getMonthlyFeeHash(req.body);
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "mensalidade-invalida" }, feeHash);
    }

    await prisma.monthlyFee.update({
      where: { id },
      data: {
        status: "EXEMPT",
        billingMode: "EXEMPT",
        note: getOptionalTrimmedString(req.body.note) || undefined,
      },
    });

    await createFinanceAudit(req, "finance.monthly_fee.exempt", "Mensalidade marcada como isenta", {
      monthlyFeeId: id,
    });

    return redirectToFinance(res, { ...req.body, notice: "mensalidade-isenta", editFeeId: id }, feeHash);
  } catch (err) {
    console.error("Erro ao marcar mensalidade como isenta:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "mensalidade-isenta", editFeeId: req.params.id },
      getMonthlyFeeHash(req.body)
    );
  }
}

async function createCashTransaction(req, res) {
  try {
    if (!CreateCashTransactionSchema.safeParse(req.body).success) {
      return redirectToFinance(res, { ...req.body, error: "categoria-caixa" }, "#finance-cash");
    }

    const type = normalizeUppercaseValue(req.body.type, "EXPENSE");
    const category = normalizeUppercaseValue(req.body.category, "");
    const allowedCategories = (FINANCE_TRANSACTION_CATEGORY_OPTIONS[type] || []).map((item) => item.value);
    if (!allowedCategories.includes(category)) {
      return redirectToFinance(res, { ...req.body, error: "categoria-caixa" }, "#finance-cash");
    }

    const amount = parseMoneyInput(req.body.amount, 0);
    if (amount <= 0) {
      return redirectToFinance(res, { ...req.body, error: "valor-caixa" }, "#finance-cash");
    }

    await prisma.cashTransaction.create({
      data: {
        type,
        category,
        amount,
        description: getTrimmedString(req.body.description, "") || "Lancamento manual",
        date: parseDateInput(req.body.date, new Date()),
        note: getOptionalTrimmedString(req.body.note),
        origin: "MANUAL",
      },
    });

    await createFinanceAudit(req, "finance.cash.create", "Lancamento manual criado no caixa", {
      type,
      category,
      amount,
    });

    return redirectToFinance(res, { ...req.body, notice: "caixa-criado" }, "#finance-cash");
  } catch (err) {
    console.error("Erro ao criar lancamento manual:", err);
    return redirectToFinance(res, { ...req.body, error: "caixa-criado" }, "#finance-cash");
  }
}

async function updateCashTransaction(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "caixa-invalido" }, "#finance-cash");
    }

    const current = await prisma.cashTransaction.findUnique({ where: { id } });
    if (!current || current.origin !== "MANUAL") {
      return redirectToFinance(res, { ...req.body, error: "caixa-bloqueado" }, "#finance-cash");
    }

    const type = normalizeUppercaseValue(req.body.type, current.type);
    const category = normalizeUppercaseValue(req.body.category, current.category);
    const allowedCategories = (FINANCE_TRANSACTION_CATEGORY_OPTIONS[type] || []).map((item) => item.value);
    if (!allowedCategories.includes(category)) {
      return redirectToFinance(
        res,
        { ...req.body, error: "categoria-caixa", editTransactionId: id },
        "#finance-cash"
      );
    }

    const amount = parseMoneyInput(req.body.amount, current.amount);
    await prisma.cashTransaction.update({
      where: { id },
      data: {
        type,
        category,
        amount,
        description: getTrimmedString(req.body.description ?? current.description, "") || current.description,
        date: parseDateInput(req.body.date, current.date),
        note: getOptionalTrimmedString(req.body.note),
      },
    });

    await createFinanceAudit(req, "finance.cash.update", "Lancamento manual atualizado", {
      cashTransactionId: id,
      type,
      category,
      amount,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: "caixa-atualizado", editTransactionId: id },
      "#finance-cash"
    );
  } catch (err) {
    console.error("Erro ao atualizar lancamento manual:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "caixa-atualizado", editTransactionId: req.params.id },
      "#finance-cash"
    );
  }
}

async function deleteCashTransaction(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    const current = await prisma.cashTransaction.findUnique({ where: { id } });
    if (!current || current.origin !== "MANUAL") {
      return redirectToFinance(res, { ...req.body, error: "caixa-excluir" }, "#finance-cash");
    }

    await prisma.cashTransaction.delete({ where: { id } });

    await createFinanceAudit(req, "finance.cash.delete", "Lancamento manual excluido", {
      cashTransactionId: id,
    });

    return redirectToFinance(res, { ...req.body, notice: "caixa-excluido" }, "#finance-cash");
  } catch (err) {
    console.error("Erro ao excluir lancamento manual:", err);
    return redirectToFinance(res, { ...req.body, error: "caixa-excluir" }, "#finance-cash");
  }
}

function parseRecurringExpenseForm(body = {}, current = null) {
  const expenseCategories = (FINANCE_TRANSACTION_CATEGORY_OPTIONS.EXPENSE || []).map((item) => item.value);
  const name = getTrimmedString(body.name ?? current?.name, "");
  const amount = parseMoneyInput(body.amount ?? current?.amount, current?.amount || 0);
  const category = normalizeUppercaseValue(body.category ?? current?.category, current?.category || "COURT");
  const dayOfMonth = parseClampedInteger(body.dayOfMonth ?? current?.dayOfMonth, {
    fallback: current?.dayOfMonth || 1,
    min: 1,
    max: 31,
  });
  const startMonth = parseClampedInteger(body.startMonth ?? current?.startMonth, {
    fallback: current?.startMonth || body.month,
    min: 1,
    max: 12,
  });
  const startYear = parseClampedInteger(body.startYear ?? current?.startYear, {
    fallback: current?.startYear || body.year,
    min: 2020,
    max: 2100,
  });
  const rawEndMonth = parseOptionalId(body.endMonth, null);
  const rawEndYear = parseOptionalId(body.endYear, null);
  const endMonth = rawEndMonth ? Math.max(1, Math.min(rawEndMonth, 12)) : null;
  const endYear = rawEndYear ? Math.max(2020, Math.min(rawEndYear, 2100)) : null;
  const hasEnd = Boolean(endMonth && endYear);
  const startKey = startYear * 100 + startMonth;
  const endKey = hasEnd ? endYear * 100 + endMonth : null;

  if (!name || amount <= 0) {
    return { ok: false, error: "despesa-fixa-dados" };
  }

  if (!expenseCategories.includes(category)) {
    return { ok: false, error: "despesa-fixa-categoria" };
  }

  if (hasEnd && endKey < startKey) {
    return { ok: false, error: "despesa-fixa-periodo" };
  }

  return {
    ok: true,
    data: {
      name,
      amount,
      category,
      dayOfMonth,
      startMonth,
      startYear,
      endMonth: hasEnd ? endMonth : null,
      endYear: hasEnd ? endYear : null,
      description: getOptionalTrimmedString(body.description) || name,
      note: getOptionalTrimmedString(body.note),
      isActive: parseCheckbox(body.isActive),
    },
  };
}

async function createRecurringExpense(req, res) {
  try {
    if (!RecurringExpenseSchema.safeParse(req.body).success) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-dados", tab: "cash" }, "#finance-recurring");
    }

    const parsed = parseRecurringExpenseForm(req.body);
    if (!parsed.ok) {
      return redirectToFinance(res, { ...req.body, error: parsed.error, tab: "cash" }, "#finance-recurring");
    }

    const recurringExpense = await prisma.recurringExpense.create({
      data: {
        ...parsed.data,
        createdByAdminId: req.admin?.id || null,
      },
    });

    await createFinanceAudit(req, "finance.recurring.create", "Despesa fixa criada", {
      recurringExpenseId: recurringExpense.id,
      name: recurringExpense.name,
      amount: parsed.data.amount,
      category: parsed.data.category,
    });

    return redirectToFinance(res, { ...req.body, notice: "despesa-fixa-criada", tab: "cash" }, "#finance-recurring");
  } catch (err) {
    console.error("Erro ao criar despesa fixa:", err);
    return redirectToFinance(res, { ...req.body, error: "despesa-fixa-criar", tab: "cash" }, "#finance-recurring");
  }
}

async function updateRecurringExpense(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const current = await prisma.recurringExpense.findUnique({ where: { id } });
    if (!current) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const parsed = parseRecurringExpenseForm(req.body, current);
    if (!parsed.ok) {
      return redirectToFinance(
        res,
        { ...req.body, error: parsed.error, tab: "cash", editRecurringExpenseId: id },
        "#finance-recurring"
      );
    }

    await prisma.recurringExpense.update({
      where: { id },
      data: parsed.data,
    });

    await createFinanceAudit(req, "finance.recurring.update", "Despesa fixa atualizada", {
      recurringExpenseId: id,
      name: parsed.data.name,
      amount: parsed.data.amount,
      category: parsed.data.category,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: "despesa-fixa-atualizada", tab: "cash", editRecurringExpenseId: id },
      "#finance-recurring"
    );
  } catch (err) {
    console.error("Erro ao atualizar despesa fixa:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "despesa-fixa-atualizar", tab: "cash", editRecurringExpenseId: req.params.id },
      "#finance-recurring"
    );
  }
}

async function toggleRecurringExpense(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    const current = id ? await prisma.recurringExpense.findUnique({ where: { id } }) : null;
    if (!current) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const nextActive = !current.isActive;
    await prisma.recurringExpense.update({
      where: { id },
      data: { isActive: nextActive },
    });

    await createFinanceAudit(req, "finance.recurring.toggle", nextActive ? "Despesa fixa ativada" : "Despesa fixa pausada", {
      recurringExpenseId: id,
      isActive: nextActive,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: nextActive ? "despesa-fixa-ativada" : "despesa-fixa-pausada", tab: "cash" },
      "#finance-recurring"
    );
  } catch (err) {
    console.error("Erro ao alternar despesa fixa:", err);
    return redirectToFinance(res, { ...req.body, error: "despesa-fixa-atualizar", tab: "cash" }, "#finance-recurring");
  }
}

async function generateRecurringExpenseNow(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    const filters = normalizeFinanceFilters(req.body);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const result = await ensureRecurringExpensesForMonth({
      prisma,
      month: filters.month,
      year: filters.year,
      recurringExpenseIds: [id],
    });

    if (result.errors.length) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-gerar", tab: "cash" }, "#finance-recurring");
    }

    await createFinanceAudit(req, "finance.recurring.generate", "Despesa fixa gerada manualmente", {
      recurringExpenseId: id,
      month: filters.month,
      year: filters.year,
      createdCount: result.created.length,
      existingCount: result.existing.length,
    });

    return redirectToFinance(
      res,
      {
        ...req.body,
        notice: result.created.length ? "despesa-fixa-gerada" : "despesa-fixa-ja-gerada",
        tab: "cash",
      },
      "#finance-recurring"
    );
  } catch (err) {
    console.error("Erro ao gerar despesa fixa:", err);
    return redirectToFinance(res, { ...req.body, error: "despesa-fixa-gerar", tab: "cash" }, "#finance-recurring");
  }
}

async function deleteRecurringExpense(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const current = await prisma.recurringExpense.findUnique({
      where: { id },
      include: { runs: true },
    });
    if (!current) {
      return redirectToFinance(res, { ...req.body, error: "despesa-fixa-invalida", tab: "cash" }, "#finance-recurring");
    }

    const transactionIds = current.runs.map((run) => run.cashTransactionId).filter(Boolean);
    await prisma.$transaction(async (tx) => {
      if (transactionIds.length) {
        await tx.cashTransaction.deleteMany({ where: { id: { in: transactionIds } } });
      }
      await tx.recurringExpense.delete({ where: { id } });
    });

    await createFinanceAudit(req, "finance.recurring.delete", "Despesa fixa excluida", {
      recurringExpenseId: id,
      deletedGeneratedTransactions: transactionIds.length,
    });

    return redirectToFinance(res, { ...req.body, notice: "despesa-fixa-excluida", tab: "cash" }, "#finance-recurring");
  } catch (err) {
    console.error("Erro ao excluir despesa fixa:", err);
    return redirectToFinance(res, { ...req.body, error: "despesa-fixa-excluir", tab: "cash" }, "#finance-recurring");
  }
}

async function createGuestPayment(req, res) {
  try {
    if (!CreateGuestPaymentSchema.safeParse(req.body).success) {
      return redirectToFinance(res, { ...req.body, error: "convidado" }, "#finance-guests");
    }

    const amount = parseMoneyInput(req.body.amount, 0);
    const guestName = getOptionalTrimmedString(req.body.guestName);
    if (amount <= 0) {
      return redirectToFinance(res, { ...req.body, error: "convidado" }, "#finance-guests");
    }

    const guestDate = parseDateInput(req.body.date, new Date());
    const month = parseOptionalId(req.body.referenceMonth, null);
    const year = parseOptionalId(req.body.referenceYear, null);
    const matchId = parseOptionalId(req.body.matchId, null);

    const guest = await prisma.guestPayment.create({
      data: {
        guestName,
        date: guestDate,
        amount,
        note: getOptionalTrimmedString(req.body.note),
        month,
        year,
        matchId,
      },
    });

    await prisma.cashTransaction.create({
      data: {
        type: "INCOME",
        category: "GUEST",
        amount,
        description: `Convidado - ${guest.guestName}`,
        date: guestDate,
        note: getOptionalTrimmedString(req.body.note),
        origin: "GUEST_PAYMENT",
        guestPaymentId: guest.id,
      },
    });

    await createFinanceAudit(req, "finance.guest.create", "Pagamento de convidado registrado", {
      guestPaymentId: guest.id,
      amount,
      matchId,
    });

    return redirectToFinance(res, { ...req.body, notice: "convidado-criado" }, "#finance-guests");
  } catch (err) {
    console.error("Erro ao registrar convidado:", err);
    return redirectToFinance(res, { ...req.body, error: "convidado" }, "#finance-guests");
  }
}

async function updateGuestPayment(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "convidado-invalido" }, "#finance-guests");
    }

    const current = await prisma.guestPayment.findUnique({
      where: { id },
      include: { cashTransaction: true },
    });
    if (!current) {
      return redirectToFinance(res, { ...req.body, error: "convidado-nao-encontrado" }, "#finance-guests");
    }

    const amount = parseMoneyInput(req.body.amount, current.amount);
    const guestDate = parseDateInput(req.body.date, current.date);
    const month = parseOptionalId(req.body.referenceMonth, null);
    const year = parseOptionalId(req.body.referenceYear, null);
    const matchId = parseOptionalId(req.body.matchId, null);
    const guestName = getTrimmedString(req.body.guestName ?? current.guestName, "") || current.guestName;
    const note = getOptionalTrimmedString(req.body.note);

    await prisma.$transaction(async (tx) => {
      await tx.guestPayment.update({
        where: { id },
        data: {
          guestName,
          date: guestDate,
          amount,
          note,
          month,
          year,
          matchId,
        },
      });

      if (current.cashTransaction) {
        await tx.cashTransaction.update({
          where: { id: current.cashTransaction.id },
          data: {
            amount,
            date: guestDate,
            description: `Convidado - ${guestName}`,
            note,
          },
        });
      }
    });

    await createFinanceAudit(req, "finance.guest.update", "Pagamento de convidado atualizado", {
      guestPaymentId: id,
      amount,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: "convidado-atualizado", editGuestId: id },
      "#finance-guests"
    );
  } catch (err) {
    console.error("Erro ao atualizar convidado:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "convidado-atualizado", editGuestId: req.params.id },
      "#finance-guests"
    );
  }
}

async function deleteGuestPayment(req, res) {
  try {
    const id = parseIdParam(req.params.id, null);
    if (!id) {
      return redirectToFinance(res, { ...req.body, error: "convidado-excluir" }, "#finance-guests");
    }

    await prisma.$transaction(async (tx) => {
      await tx.cashTransaction.deleteMany({ where: { guestPaymentId: id } });
      await tx.guestPayment.delete({ where: { id } });
    });

    await createFinanceAudit(req, "finance.guest.delete", "Pagamento de convidado excluido", {
      guestPaymentId: id,
    });

    return redirectToFinance(res, { ...req.body, notice: "convidado-excluido" }, "#finance-guests");
  } catch (err) {
    console.error("Erro ao excluir convidado:", err);
    return redirectToFinance(res, { ...req.body, error: "convidado-excluir" }, "#finance-guests");
  }
}

async function exportFinanceCsv(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.query);
    const { start, end } = getMonthDateRange(filters.year, filters.month);

    const transactions = await prisma.cashTransaction.findMany({
      where: { date: { gte: start, lt: end } },
      include: {
        player: { select: { name: true } },
        monthlyFee: { select: { month: true, year: true } },
        guestPayment: { select: { guestName: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    const header = ["Data", "Tipo", "Categoria", "Valor (R$)", "Descricao", "Nota"];
    const rows = transactions.map((tx) => [
      formatDateBR(tx.date),
      tx.type === "INCOME" ? "Entrada" : "Saida",
      getTransactionCategoryLabel(tx.category),
      decimalToNumber(tx.amount).toFixed(2).replace(".", ","),
      tx.description || "",
      tx.note || "",
    ]);

    const escape = (cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");

    const mm = String(filters.month).padStart(2, "0");
    const filename = `financeiro-${mm}-${filters.year}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("﻿" + csv);
  } catch (err) {
    console.error("Erro ao exportar CSV financeiro:", err);
    res.status(500).send("Erro ao gerar o CSV financeiro.");
  }
}

async function resetFinanceCompetence(req, res) {
  try {
    const filters = normalizeFinanceFilters(req.body);
    const { start, end } = getMonthDateRange(filters.year, filters.month);

    const [monthlyFees, guestPayments, manualTransactions] = await Promise.all([
      prisma.monthlyFee.findMany({
        where: { month: filters.month, year: filters.year },
        select: { id: true, playerId: true },
      }),
      prisma.guestPayment.findMany({
        where: { month: filters.month, year: filters.year },
        select: { id: true, guestName: true },
      }),
      prisma.cashTransaction.findMany({
        where: {
          origin: "MANUAL",
          date: {
            gte: start,
            lt: end,
          },
        },
        select: { id: true },
      }),
    ]);

    const monthlyFeeIds = monthlyFees.map((item) => item.id);
    const guestPaymentIds = guestPayments.map((item) => item.id);
    const manualTransactionIds = manualTransactions.map((item) => item.id);

    await prisma.$transaction(async (tx) => {
      if (monthlyFeeIds.length) {
        await tx.cashTransaction.deleteMany({
          where: { monthlyFeeId: { in: monthlyFeeIds } },
        });
      }

      if (guestPaymentIds.length) {
        await tx.cashTransaction.deleteMany({
          where: { guestPaymentId: { in: guestPaymentIds } },
        });
      }

      if (manualTransactionIds.length) {
        await tx.cashTransaction.deleteMany({
          where: { id: { in: manualTransactionIds } },
        });
      }

      if (guestPaymentIds.length) {
        await tx.guestPayment.deleteMany({
          where: { id: { in: guestPaymentIds } },
        });
      }

      if (monthlyFeeIds.length) {
        await tx.monthlyFee.deleteMany({
          where: { id: { in: monthlyFeeIds } },
        });
      }
    });

    await createFinanceAudit(req, "finance.competence.reset", "Dados da competencia resetados", {
      month: filters.month,
      year: filters.year,
      deletedMonthlyFees: monthlyFeeIds.length,
      deletedGuestPayments: guestPaymentIds.length,
      deletedManualTransactions: manualTransactionIds.length,
    });

    return redirectToFinance(
      res,
      { ...req.body, notice: "competencia-resetada" },
      "#finance-settings"
    );
  } catch (err) {
    console.error("Erro ao resetar competencia financeira:", err);
    return redirectToFinance(
      res,
      { ...req.body, error: "competencia-resetar" },
      "#finance-settings"
    );
  }
}

module.exports = {
  requireAdmin,
  renderFinancePage,
  renderFinanceReportPreview,
  renderFinanceReportPdf,
  exportFinanceCsv,
  updateFinanceSettings,
  updateFinancePlayer,
  handleEnsureMonthlyCompetence,
  updateMonthlyFee,
  recalculateMonthlyFee,
  payMonthlyFee,
  handleBulkMonthlyStatus,
  handleBulkCharge,
  deleteMonthlyFee,
  exemptMonthlyFee,
  createCashTransaction,
  updateCashTransaction,
  deleteCashTransaction,
  createRecurringExpense,
  updateRecurringExpense,
  toggleRecurringExpense,
  generateRecurringExpenseNow,
  deleteRecurringExpense,
  createGuestPayment,
  updateGuestPayment,
  deleteGuestPayment,
  resetFinanceCompetence,
};
