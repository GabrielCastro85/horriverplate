const prisma = require("../utils/db");
const {
  FINANCE_TABS,
  PARTICIPANT_TYPE_META,
} = require("../constants/finance");
const {
  MONTH_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  FINANCE_TRANSACTION_TYPE_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_OPTIONS,
  decimalToNumber,
  roundCurrency,
  formatCurrencyBR,
  formatMonthYearLabel,
  formatDateInput,
  formatDateBR,
  formatDateBRShortYear,
  formatDateTimeBR,
  getMonthDateRange,
  computeMonthlyFeeBalance,
  getMonthlyFeeStatusMeta,
  getTransactionCategoryLabel,
  getPaymentMethodLabel,
} = require("../utils/finance");
const {
  getSaoPauloNowMonthYear,
  parseInteger,
  getTrimmedString,
  normalizeUppercaseValue,
  parseOptionalMoneyInput,
  parseFinanceCompetence,
  parseOptionalId,
} = require("../helpers/financeInput.helper");
const {
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  normalizeMonthlyCollectionFilter,
  normalizeChargeFilter,
  getCollectionStatusMeta,
  matchesMonthlyCollectionFilter,
  sortMonthlyFees,
  sortChargeFees,
  buildCompetencePreparation,
  buildCompetenceState,
  getSaoPauloTodayDate,
} = require("../helpers/financeStatus.helper");
const { buildFinanceAlerts } = require("../helpers/financeAlerts.helper");
const {
  buildFinanceReportSummary,
  buildFinanceSummaries,
  buildFinanceOverview,
} = require("../helpers/financeSummary.helper");
const { buildBulkChargeSummary } = require("../helpers/financeMessage.helper");
const {
  decorateMonthlyFee,
  ensureMonthlyCompetence,
  syncMonthlyCompetenceRules,
} = require("../services/financeAutomation.service");
const {
  PARTICIPANT_TYPE_OPTIONS,
  CHARGE_BEHAVIOR_OPTIONS,
  getParticipantTypeMeta,
  isPlayerEligibleForMonthlyFee,
  fetchMonthlyMatchChargeUsage,
  buildMonthlyFeeRecordFromRule,
  buildPlayerFinanceRuleSummary,
} = require("../services/financeRules.service");
const {
  buildMonthlyFeeAnalytics,
  buildPlayerRulesAnalytics,
} = require("../services/financeAnalytics.service");
const { getRecentFinanceEventLogs, getFinanceCompetenceResetMarker } = require("../services/financeEventLog.service");
const {
  REPORT_SCOPE_OPTIONS,
  REPORT_TYPE_OPTIONS,
  normalizeFinanceReportType,
  normalizeFinanceReportScope,
  loadFinanceReport,
} = require("../services/financeReports.service");

function normalizeFinanceTab(value) {
  const tab = String(value || "overview").trim().toLowerCase();
  return FINANCE_TABS.some((item) => item.key === tab) ? tab : "overview";
}

function getNowMonthYear() {
  return getSaoPauloNowMonthYear();
}

function toInt(value, fallback) {
  return parseInteger(value, fallback);
}

function normalizeFinanceFilters(input = {}) {
  const now = getNowMonthYear();
  const { month, year } = parseFinanceCompetence(input, now);
  const tab = normalizeFinanceTab(input.tab);
  const status = normalizeMonthlyCollectionFilter(input.status);
  const search = getTrimmedString(input.search, "");
  const cashType = normalizeUppercaseValue(input.cashType, "ALL");
  const chargeFilter = normalizeChargeFilter(input.chargeFilter);
  const reportType = normalizeFinanceReportType(input.reportType);
  const reportScope = normalizeFinanceReportScope(input.reportScope, reportType);
  const reportStart = getTrimmedString(input.reportStart, "");
  const reportEnd = getTrimmedString(input.reportEnd, "");
  const notice = getTrimmedString(input.notice, "");
  const error = getTrimmedString(input.error, "");
  const openDialog = getTrimmedString(input.openDialog, "");

  return {
    month,
    year,
    tab,
    status,
    search,
    cashType,
    chargeFilter,
    reportType,
    reportScope,
    reportStart,
    reportEnd,
    editFeeId: parseOptionalId(input.editFeeId, null),
    editTransactionId: parseOptionalId(input.editTransactionId, null),
    editGuestId: parseOptionalId(input.editGuestId, null),
    notice,
    error,
    openDialog,
  };
}

function buildFinanceRedirectQuery(source = {}) {
  const filters = normalizeFinanceFilters(source);
  const params = new URLSearchParams();
  params.set("month", String(filters.month));
  params.set("year", String(filters.year));
  params.set("tab", filters.tab);
  if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.cashType && filters.cashType !== "ALL") params.set("cashType", filters.cashType);
  if (filters.chargeFilter && filters.chargeFilter !== "ALL") params.set("chargeFilter", filters.chargeFilter);
  if (filters.reportType && filters.reportType !== "FULL") params.set("reportType", filters.reportType);
  if (filters.reportScope && filters.reportScope !== "MONTHLY") params.set("reportScope", filters.reportScope);
  if (filters.reportStart) params.set("reportStart", filters.reportStart);
  if (filters.reportEnd) params.set("reportEnd", filters.reportEnd);
  if (filters.notice) params.set("notice", filters.notice);
  if (filters.error) params.set("error", filters.error);
  if (filters.openDialog) params.set("openDialog", filters.openDialog);
  if (filters.editFeeId) params.set("editFeeId", String(filters.editFeeId));
  if (filters.editTransactionId) params.set("editTransactionId", String(filters.editTransactionId));
  if (filters.editGuestId) params.set("editGuestId", String(filters.editGuestId));
  return params.toString();
}

function buildFinancePath(source = {}, hash = "") {
  const query = buildFinanceRedirectQuery(source);
  return `/admin/finance${query ? `?${query}` : ""}${hash}`;
}

function getFinanceHashByTab(tab) {
  switch (normalizeFinanceTab(tab)) {
    case "monthly":
      return "#finance-fees";
    case "charge":
      return "#finance-charge";
    case "cash":
      return "#finance-cash";
    case "guests":
      return "#finance-guests";
    case "reports":
      return "#finance-reports";
    case "settings":
      return "#finance-settings";
    case "overview":
    default:
      return "#finance-overview";
  }
}

function getMonthlyFeeHash(source = {}) {
  return normalizeFinanceTab(source.tab) === "charge" ? "#finance-charge" : "#finance-fees";
}

const FINANCE_NOTICE_MESSAGES = {
  "configuracoes-salvas": "Configuracoes financeiras salvas.",
  "jogador-salvo": "Participacao financeira do jogador atualizada.",
  "mensalidades-geradas": "Mensalidades do mes geradas com sucesso.",
  "competencia-preparada": "Competencia preparada com as mensalidades faltantes.",
  "mensalidades-ja-existentes": "Nenhuma nova mensalidade foi criada; os registros ja existiam.",
  "mensalidade-atualizada": "Mensalidade atualizada.",
  "mensalidade-excluida": "Mensalidade excluida com os lancamentos automaticos vinculados.",
  "pagamento-registrado": "Pagamento registrado e lancado no caixa.",
  "mensalidade-isenta": "Mensalidade marcada como isenta.",
  "charge-bulk-paid": "Mensalidades selecionadas marcadas como pagas em lote.",
  "charge-bulk-pending": "Mensalidades selecionadas voltaram para pendente.",
  "caixa-criado": "Lancamento criado no caixa.",
  "caixa-atualizado": "Lancamento manual atualizado.",
  "caixa-excluido": "Lancamento manual excluido.",
  "convidado-criado": "Convidado registrado e lancado no caixa.",
  "convidado-atualizado": "Convidado atualizado.",
  "convidado-excluido": "Convidado excluido.",
  "competencia-resetada": "Os dados financeiros da competencia selecionada foram resetados.",
};

const FINANCE_ERROR_MESSAGES = {
  configuracoes: "Nao foi possivel salvar as configuracoes agora.",
  "jogador-invalido": "Jogador invalido para este ajuste.",
  "jogador-salvo": "Nao foi possivel atualizar a regra financeira deste jogador.",
  "sem-jogadores-ativos": "Nenhum jogador esta ativo no financeiro para gerar mensalidades.",
  mensalidades: "Nao foi possivel gerar as mensalidades.",
  "mensalidade-invalida": "Mensalidade invalida.",
  "mensalidade-nao-encontrada": "Mensalidade nao encontrada.",
  "mensalidade-atualizar": "Nao foi possivel atualizar a mensalidade.",
  "mensalidade-excluir": "Nao foi possivel excluir essa mensalidade.",
  "pagamento-invalido": "Informe um valor de pagamento valido.",
  pagamento: "Nao foi possivel registrar o pagamento.",
  "mensalidade-isenta": "Nao foi possivel marcar a mensalidade como isenta.",
  "charge-bulk-empty": "Selecione pelo menos uma cobranca pendente para a acao em lote.",
  "charge-bulk-pay": "Nao foi possivel concluir a marcacao em lote das cobrancas.",
  "categoria-caixa": "Escolha uma categoria compativel com o tipo de lancamento.",
  "valor-caixa": "Informe um valor valido para o caixa.",
  "caixa-criado": "Nao foi possivel criar o lancamento no caixa.",
  "caixa-invalido": "Lancamento invalido.",
  "caixa-bloqueado": "Esse lancamento e automatico; edite pela origem dele.",
  "caixa-atualizado": "Nao foi possivel atualizar o lancamento.",
  "caixa-excluir": "Nao foi possivel excluir esse lancamento.",
  convidado: "Preencha nome e valor do convidado.",
  "convidado-invalido": "Convidado invalido.",
  "convidado-nao-encontrado": "Convidado nao encontrado.",
  "convidado-atualizado": "Nao foi possivel atualizar o convidado.",
  "convidado-excluir": "Nao foi possivel excluir o convidado.",
  "competencia-resetar": "Nao foi possivel resetar os dados financeiros desta competencia.",
};

const FINANCE_STATUS_TONE_CLASSES = {
  ok: "finance-status--ok",
  warning: "finance-status--warning",
  info: "finance-status--info",
  pending: "finance-status--pending",
  danger: "finance-status--danger",
};

function escapeFinanceAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function buildFinanceRenderView(financePage) {
  const vm = financePage;
  const filters = vm.filters;
  const monthReferenceLabel = formatMonthYearLabel(filters.month, filters.year);
  const selectedFee = vm.monthly.selectedFee;
  const selectedTransaction = vm.cash.selectedTransaction;
  const selectedFeeBalance = selectedFee ? computeMonthlyFeeBalance(selectedFee) : 0;
  const selectedFeeMeta = selectedFee ? getCollectionStatusMeta(selectedFee.collectionStatus) : null;
  const selectedTransactionCategories = selectedTransaction
    ? (vm.cash.categoryOptions[selectedTransaction.type] || [])
    : (vm.cash.categoryOptions.EXPENSE || []);
  const selectedTransactionIsManual = selectedTransaction?.origin === "MANUAL";
  const activeTabMeta = vm.navigation.tabs.find((item) => item.active) || vm.navigation.tabs[0];
  const currentDateInputValue = formatDateInput(getSaoPauloTodayDate());
  const noticeText = filters.notice
    ? FINANCE_NOTICE_MESSAGES[filters.notice] || "Acao concluida."
    : "";
  const errorText = filters.error
    ? FINANCE_ERROR_MESSAGES[filters.error] || "Algo deu errado."
    : "";

  function stateFields(extra = {}, options = {}) {
    const omit = new Set(options.omit || []);
    const fields = {
      month: filters.month,
      year: filters.year,
      tab: filters.tab,
      status: filters.status,
      search: filters.search,
      cashType: filters.cashType,
      chargeFilter: filters.chargeFilter,
      reportType: filters.reportType,
      reportScope: filters.reportScope,
      reportStart: filters.reportStart,
      reportEnd: filters.reportEnd,
      ...extra,
    };

    return Object.entries(fields)
      .filter(([name, value]) => !omit.has(name) && value !== null && value !== undefined && value !== "")
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeFinanceAttr(name)}" value="${escapeFinanceAttr(value)}">`
      )
      .join("");
  }

  function financeStatusClass(meta) {
    return FINANCE_STATUS_TONE_CLASSES[meta?.tone] || "finance-status--pending";
  }

  function buildFinanceQuery(extra = {}) {
    const params = new URLSearchParams();
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(extra, key);
    const monthValue = hasOwn("month") ? extra.month : filters.month;
    const yearValue = hasOwn("year") ? extra.year : filters.year;
    const tabValue = hasOwn("tab") ? extra.tab : filters.tab;
    const statusValue = hasOwn("status") ? extra.status : filters.status;
    const searchValue = hasOwn("search") ? extra.search : filters.search;
    const cashTypeValue = hasOwn("cashType") ? extra.cashType : filters.cashType;
    const chargeFilterValue = hasOwn("chargeFilter") ? extra.chargeFilter : filters.chargeFilter;
    const reportTypeValue = hasOwn("reportType") ? extra.reportType : filters.reportType;
    const reportScopeValue = hasOwn("reportScope") ? extra.reportScope : filters.reportScope;
    const reportStartValue = hasOwn("reportStart") ? extra.reportStart : filters.reportStart;
    const reportEndValue = hasOwn("reportEnd") ? extra.reportEnd : filters.reportEnd;

    params.set("month", String(monthValue));
    params.set("year", String(yearValue));
    params.set("tab", String(tabValue || "overview"));
    if (statusValue && statusValue !== "ALL") params.set("status", String(statusValue));
    if (searchValue) params.set("search", String(searchValue));
    if (cashTypeValue && cashTypeValue !== "ALL") params.set("cashType", String(cashTypeValue));
    if (chargeFilterValue && chargeFilterValue !== "ALL") params.set("chargeFilter", String(chargeFilterValue));
    if (reportTypeValue && reportTypeValue !== "FULL") params.set("reportType", String(reportTypeValue));
    if (reportScopeValue && reportScopeValue !== "MONTHLY") params.set("reportScope", String(reportScopeValue));
    if (reportStartValue) params.set("reportStart", String(reportStartValue));
    if (reportEndValue) params.set("reportEnd", String(reportEndValue));

    Object.entries(extra).forEach(([key, value]) => {
      if (
        ["month", "year", "tab", "status", "search", "cashType", "chargeFilter", "reportType", "reportScope", "reportStart", "reportEnd"].includes(
          key
        )
      ) {
        return;
      }
      if (value !== null && value !== undefined && value !== "") {
        params.set(key, String(value));
      }
    });

    return `/admin/finance?${params.toString()}`;
  }

  return {
    vm,
    page: vm.page,
    filters,
    helpers: vm.helpers,
    navigation: vm.navigation,
    summaries: vm.summaries,
    alerts: vm.alerts,
    overview: vm.overview,
    monthly: vm.monthly,
    charge: vm.charge,
    cash: vm.cash,
    guests: vm.guests,
    reports: vm.reports,
    settings: vm.settings,
    automation: {
      ...vm.automation,
      alerts: vm.alerts,
    },
    ui: {
      noticeText,
      errorText,
      monthReferenceLabel,
      selectedFeeBalance,
      selectedFeeMeta,
      selectedTransactionCategories,
      selectedTransactionIsManual,
      activeTabMeta,
      currentDateInputValue,
    },
    actions: {
      escapeAttr: escapeFinanceAttr,
      stateFields,
      financeStatusClass,
      buildFinanceQuery,
    },
  };
}


function parseOptionalCurrencyInput(value) {
  return parseOptionalMoneyInput(value);
}

async function ensureFinanceSettings() {
  const existing = await prisma.financeSettings.findFirst({
    orderBy: { id: "asc" },
  });

  if (existing) return existing;

  return prisma.financeSettings.create({
    data: {
      defaultMonthlyAmount: 50,
      dueDay: 10,
      latePerMatchAmount: 25,
      defaultIncludedMatches: 0,
      defaultExtraMatchAmount: 0,
      defaultAutoDiscountAmount: 0,
      chargeBehavior: "ASSISTED",
      autoGenerateCompetence: false,
      defaultWhatsappMessage:
        "Bom dia, {name}!\nSegue o Pix para vocÃª pagar o valor de {amount} da mensalidade da pelada referente a {monthYear}:\n{pixKey}{receiverLine}",
    },
  });
}


function buildYearOptions(years = []) {
  const now = getNowMonthYear();
  const uniqueYears = new Set([now.year - 1, now.year, now.year + 1, ...years.filter(Boolean).map(Number)]);
  return Array.from(uniqueYears)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
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

function shouldDisplayMonthlyFeeInMonthlyTab(monthlyFee) {
  if (!monthlyFee) return false;

  const amountDue = roundCurrency(decimalToNumber(monthlyFee.amountDue));
  const amountPaid = roundCurrency(decimalToNumber(monthlyFee.amountPaid));
  const balance =
    typeof monthlyFee.balance === "number"
      ? roundCurrency(monthlyFee.balance)
      : computeMonthlyFeeBalance(monthlyFee);

  return amountDue > 0 || amountPaid > 0 || balance > 0;
}

function toSortedDateList(values = []) {
  return values
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a - b);
}

function buildFeePaymentInstallments(fee) {
  if (!fee) return [];

  const matchDates = toSortedDateList(fee.matchChargeUsage?.matchDates || []);
  const lateMatchDates = toSortedDateList(fee.matchChargeUsage?.lateMatchDates || []);
  const unitAmount = roundCurrency(decimalToNumber(fee.latePerMatchAmount || 25));
  const specialFirstMatchAmount = roundCurrency(decimalToNumber(fee.specialFirstMatchAmount || 0));
  const specialComplementAmount = roundCurrency(decimalToNumber(fee.specialMonthlyComplementAmount || 0));
  const hasSpecialFirstMatch =
    Boolean(fee.specialTransitionApplied) && specialFirstMatchAmount > 0 && specialFirstMatchAmount < unitAmount;
  const installments = [];

  const pushInstallment = (amount, date, label) => {
    const parsedDate = date instanceof Date ? date : new Date(date);
    const normalizedAmount = roundCurrency(amount);
    if (!normalizedAmount || Number.isNaN(parsedDate.getTime())) return;
    installments.push({
      amount: normalizedAmount,
      date: parsedDate,
      label,
    });
  };

  if (fee.specialMonthlyTransitionApplied) {
    pushInstallment(specialFirstMatchAmount, matchDates[0], "1a pelada");
    pushInstallment(
      specialComplementAmount,
      matchDates[1] || fee.dueDate || matchDates[0],
      matchDates[1] ? "Complemento apos a 2a pelada" : "Complemento mensal"
    );
    return installments;
  }

  if (fee.billingMode === "PER_MATCH") {
    if (hasSpecialFirstMatch && matchDates.length) {
      pushInstallment(specialFirstMatchAmount, matchDates[0], "1a pelada");
      matchDates.slice(1).forEach((date, index) => {
        pushInstallment(unitAmount, date, `Pelada ${index + 2}`);
      });
      return installments;
    }

    matchDates.forEach((date, index) => {
      pushInstallment(unitAmount, date, `Pelada ${index + 1}`);
    });
    return installments;
  }

  if (fee.billingMode === "LATE_PER_MATCH") {
    if (hasSpecialFirstMatch && matchDates[0]) {
      pushInstallment(specialFirstMatchAmount, matchDates[0], "1a pelada");
      lateMatchDates.forEach((date, index) => {
        pushInstallment(unitAmount, date, `Pelada por atraso ${index + 1}`);
      });
      return installments;
    }

    lateMatchDates.forEach((date, index) => {
      pushInstallment(unitAmount, date, `Pelada por atraso ${index + 1}`);
    });
  }

  return installments;
}

function buildFeePaymentTiming(fee, fallbackDate = new Date()) {
  const installments = buildFeePaymentInstallments(fee);
  const fallbackInput = formatDateInput(fallbackDate);

  if (!installments.length) {
    return {
      paymentDateOptions: [],
      suggestedPaidAtInput: fallbackInput,
    };
  }

  let remainingPaid = roundCurrency(decimalToNumber(fee.amountPaid));
  let nextInstallment = installments[0];

  for (const installment of installments) {
    if (remainingPaid >= installment.amount) {
      remainingPaid = roundCurrency(remainingPaid - installment.amount);
      nextInstallment = null;
      continue;
    }

    nextInstallment = installment;
    break;
  }

  const paymentDateOptions = installments.map((installment) => ({
    value: formatDateInput(installment.date),
    label: `${formatDateBRShortYear(installment.date)} - ${installment.label}`,
    amountLabel: formatCurrencyBR(installment.amount),
  }));

  return {
    paymentDateOptions,
    suggestedPaidAtInput: nextInstallment ? formatDateInput(nextInstallment.date) : fallbackInput,
  };
}

function enrichDecoratedFeeWithPaymentTiming(fee, fallbackDate = new Date()) {
  return {
    ...fee,
    ...buildFeePaymentTiming(fee, fallbackDate),
  };
}

async function buildFinancePageViewModel(filters) {
  const settings = await ensureFinanceSettings();
  const today = getSaoPauloTodayDate();
  const { start, end } = getMonthDateRange(filters.year, filters.month);

  const basePlayers = await prisma.player.findMany({
    select: {
      id: true,
      name: true,
      nickname: true,
      position: true,
      whatsapp: true,
      financeActive: true,
      isMonthlyMember: true,
      financeParticipantType: true,
      financeAmountOverride: true,
      financeMatchLimit: true,
      financeExtraMatchAmount: true,
      financeAutoDiscountAmount: true,
      financeNotes: true,
    },
    orderBy: { name: "asc" },
  });

  const eligibleBasePlayers = basePlayers.filter(isPlayerEligibleForMonthlyFee);
  if ((settings.autoGenerateCompetence || settings.chargeBehavior === "AUTOMATIC") && eligibleBasePlayers.length) {
    await ensureMonthlyCompetence({
      prisma,
      month: filters.month,
      year: filters.year,
      settings,
      eligiblePlayers: eligibleBasePlayers,
      dryRun: false,
      referenceDate: today,
    });
  }

  await syncMonthlyCompetenceRules({
    prisma,
    month: filters.month,
    year: filters.year,
    settings,
    referenceDate: today,
  });

  const [recentMatches, monthFeesRaw, monthTransactionsRaw, guestPayments, allTransactions, recentFinanceEvents, competenceResetMarker] =
    await Promise.all([
      prisma.match.findMany({
        select: { id: true, playedAt: true, description: true },
        orderBy: { playedAt: "desc" },
        take: 24,
      }),
      prisma.monthlyFee.findMany({
        where: {
          month: filters.month,
          year: filters.year,
        },
        include: {
          player: true,
          transactions: {
            orderBy: [{ date: "desc" }, { id: "desc" }],
          },
        },
        orderBy: [{ status: "asc" }, { player: { name: "asc" } }],
      }),
      prisma.cashTransaction.findMany({
        where: {
          date: {
            gte: start,
            lt: end,
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
        orderBy: [{ date: "desc" }, { id: "desc" }],
      }),
      prisma.guestPayment.findMany({
        where: {
          date: {
            gte: start,
            lt: end,
          },
        },
        include: {
          match: true,
          cashTransaction: true,
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      }),
      prisma.cashTransaction.findMany({
        select: {
          type: true,
          amount: true,
        },
      }),
      getRecentFinanceEventLogs(prisma, 8),
      getFinanceCompetenceResetMarker(prisma, {
        month: filters.month,
        year: filters.year,
      }),
    ]);

  const matchChargeUsageMap = await fetchMonthlyMatchChargeUsage({
    prisma,
    playerIds: basePlayers.map((player) => player.id),
    month: filters.month,
    year: filters.year,
    dueDay: settings?.dueDay || 10,
  });

  const allPlayers = basePlayers.map((player) => ({
    ...player,
    currentMonthMatches: matchChargeUsageMap.get(player.id)?.matchesPlayed || 0,
    financeRuleSummary: buildPlayerFinanceRuleSummary(player, settings),
    participantTypeMeta: getParticipantTypeMeta(player.financeParticipantType),
  }));

  const eligiblePlayers = allPlayers.filter(isPlayerEligibleForMonthlyFee);
  const competencePreparation = buildCompetencePreparation({
    eligiblePlayers,
    monthFees: monthFeesRaw,
  });
  const projectedMissingAmount = roundCurrency(
    competencePreparation.missingPlayers.reduce((sum, player) => {
      const projected = buildMonthlyFeeRecordFromRule({
        player,
        settings,
        month: filters.month,
        year: filters.year,
        matchesPlayed: matchChargeUsageMap.get(player.id)?.matchesPlayed || 0,
        lateMatchesPlayed: matchChargeUsageMap.get(player.id)?.lateMatchesPlayed || 0,
        matchChargeUsage: matchChargeUsageMap.get(player.id) || null,
      });
      return sum + decimalToNumber(projected.amountDue);
    }, 0)
  );
  const competenceWasReset =
    Boolean(competenceResetMarker) &&
    monthFeesRaw.length === 0 &&
    guestPayments.length === 0 &&
    monthTransactionsRaw.length === 0;
  const effectivePreparation = competenceWasReset
    ? {
        ...competencePreparation,
        missingPlayers: [],
        missingCount: 0,
        prepared: true,
        reset: true,
      }
    : competencePreparation;
  const effectiveProjectedMissingAmount = competenceWasReset ? 0 : projectedMissingAmount;

  const feeMatchesSearch = (fee) => {
    if (!filters.search) return true;
    const haystack = `${fee.player?.name || ""} ${fee.player?.nickname || ""}`.toLowerCase();
    return haystack.includes(filters.search.toLowerCase());
  };

  const monthFeesDecorated = sortMonthlyFees(
    monthFeesRaw
      .map((fee) =>
        decorateMonthlyFee(
          {
            ...fee,
            matchChargeUsage: matchChargeUsageMap.get(fee.playerId) || null,
          },
          settings,
          today
        )
      )
      .map((fee) => enrichDecoratedFeeWithPaymentTiming(fee, today))
      .map((fee) => ({
        ...fee,
        analytics: buildMonthlyFeeAnalytics(fee),
      }))
  );
  const visibleMonthFeesBase = monthFeesDecorated.filter(shouldDisplayMonthlyFeeInMonthlyTab);
  const hiddenMonthFees = monthFeesDecorated.filter((fee) => !shouldDisplayMonthlyFeeInMonthlyTab(fee));
  const hiddenNoChargeFees = hiddenMonthFees.filter((fee) => fee.collectionStatus === "NO_CHARGE");
  const monthlyStatusOptions = MONTHLY_COLLECTION_FILTER_OPTIONS.filter(
    (option) => option.value !== "NO_CHARGE" && option.value !== "EXEMPT"
  );
  const monthlyActiveStatus = ["NO_CHARGE", "EXEMPT"].includes(filters.status) ? "ALL" : filters.status;
  const allPendingFees = sortChargeFees(
    monthFeesDecorated.filter((fee) => fee.status !== "EXEMPT" && fee.balance > 0),
    "ALL",
    today
  );
  const monthFees = visibleMonthFeesBase.filter(
    (fee) => matchesMonthlyCollectionFilter(fee, monthlyActiveStatus) && feeMatchesSearch(fee)
  );
  const chargeFees = sortChargeFees(
    monthFeesDecorated.filter((fee) => fee.status !== "EXEMPT" && feeMatchesSearch(fee)),
    filters.chargeFilter,
    today
  );

  const totalPredictedBase = monthFeesRaw
    .filter((fee) => fee.status !== "EXEMPT")
    .reduce((sum, fee) => sum + decimalToNumber(fee.amountDue), 0);
  const totalPredicted = roundCurrency(totalPredictedBase + effectiveProjectedMissingAmount);
  const totalReceivedFromFees = monthFeesRaw.reduce((sum, fee) => sum + decimalToNumber(fee.amountPaid), 0);
  const totalPendingExisting = monthFeesRaw.reduce((sum, fee) => sum + computeMonthlyFeeBalance(fee), 0);
  const totalPending = roundCurrency(totalPendingExisting + effectiveProjectedMissingAmount);
  const payersCount = monthFeesRaw.filter((fee) => decimalToNumber(fee.amountPaid) > 0).length;
  const paidCount = monthFeesDecorated.filter((fee) => fee.collectionStatus === "PAID").length;
  const partialCount = monthFeesDecorated.filter((fee) => fee.collectionStatus === "PARTIAL").length;
  const noChargeCount = monthFeesDecorated.filter((fee) => fee.collectionStatus === "NO_CHARGE").length;
  const exemptCount = monthFeesRaw.filter((fee) => fee.status === "EXEMPT").length;
  const overdueFees = allPendingFees.filter((fee) => fee.chargePriorityBucket === 0);
  const dueTodayFees = allPendingFees.filter((fee) => fee.chargePriorityBucket === 1);
  const delinquentCount = allPendingFees.length + effectivePreparation.missingCount;

  const monthTransactionsAll = monthTransactionsRaw.map((transaction) => ({
    ...transaction,
    originLabel: buildCashOriginLabel(transaction),
  }));
  const monthTransactions = monthTransactionsAll.filter(
    (transaction) => filters.cashType === "ALL" || transaction.type === filters.cashType
  );
  const totalExpensesMonth = monthTransactionsAll
    .filter((transaction) => transaction.type === "EXPENSE")
    .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0);
  const totalReceivedMonth = monthTransactionsAll
    .filter((transaction) => transaction.type === "INCOME")
    .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0);
  const receivedPercentage = totalPredicted > 0 ? Math.min(100, (totalReceivedFromFees / totalPredicted) * 100) : 0;
  const currentMonthNet = totalReceivedMonth - totalExpensesMonth;
  const cashBalance = allTransactions.reduce((sum, transaction) => {
    const amount = decimalToNumber(transaction.amount);
    return transaction.type === "INCOME" ? sum + amount : sum - amount;
  }, 0);
  const automaticIncomeTotal = monthTransactionsAll
    .filter((transaction) => transaction.type === "INCOME" && transaction.origin !== "MANUAL")
    .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0);
  const manualExpenseTotal = monthTransactionsAll
    .filter((transaction) => transaction.type === "EXPENSE" && transaction.origin === "MANUAL")
    .reduce((sum, transaction) => sum + decimalToNumber(transaction.amount), 0);
  const expectedPayers = competenceWasReset ? 0 : Math.max(eligiblePlayers.length - exemptCount, 0);
  const competenceState = buildCompetenceState({
    preparation: effectivePreparation,
    expectedPayers,
    pendingCount: delinquentCount,
    totalPending,
    totalPredicted,
  });
  const pendingWithWhatsappCount = allPendingFees.filter((fee) => fee.player?.whatsapp).length;
  const pendingWithoutWhatsappCount = allPendingFees.filter((fee) => !fee.player?.whatsapp).length;
  const reportSummary = buildFinanceReportSummary({
    month: filters.month,
    year: filters.year,
    totalReceivedFromFees,
    totalExpensesMonth,
    cashBalance,
    paidCount,
    pendingCount: delinquentCount,
    guestCount: guestPayments.length,
  });
  const alerts = buildFinanceAlerts({
    monthLabel: formatMonthYearLabel(filters.month, filters.year),
    preparation: effectivePreparation,
    competenceState,
    overdueCount: overdueFees.length,
    overdueAmount: overdueFees.reduce((sum, fee) => sum + fee.balance, 0),
    dueTodayCount: dueTodayFees.length,
    partialCount,
    guestCount: guestPayments.length,
  }).map((alert) => ({
    ...alert,
    href:
      alert.actionType === "link"
        ? buildFinancePath(
            {
              month: filters.month,
              year: filters.year,
              tab: alert.actionQuery?.tab || "overview",
              status: alert.actionQuery?.status || "ALL",
              search: alert.actionQuery?.search || "",
              cashType: alert.actionQuery?.cashType || "ALL",
              chargeFilter: alert.actionQuery?.chargeFilter || "ALL",
            },
            alert.actionHash || getFinanceHashByTab(alert.actionQuery?.tab || "overview")
          )
        : null,
  }));
  const bulkChargeSummary = buildBulkChargeSummary(allPendingFees);

  const selectedFee = filters.editFeeId
    ? monthFeesDecorated.find((fee) => fee.id === filters.editFeeId) || null
    : null;

  const selectedTransaction = filters.editTransactionId
    ? await prisma.cashTransaction.findUnique({
        where: { id: filters.editTransactionId },
        include: {
          player: true,
          monthlyFee: {
            include: { player: true },
          },
          guestPayment: true,
        },
      })
    : null;

  const selectedGuest = filters.editGuestId
    ? await prisma.guestPayment.findUnique({
        where: { id: filters.editGuestId },
        include: {
          match: true,
          cashTransaction: true,
        },
      })
    : null;

  let feeHistory = [];
  if (selectedFee?.playerId) {
    feeHistory = await prisma.monthlyFee.findMany({
      where: { playerId: selectedFee.playerId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 12,
    });
    feeHistory = feeHistory.map((item) => {
      const decorated = decorateMonthlyFee({ ...item, player: selectedFee.player }, settings, today);
      return {
        ...decorated,
        analytics: buildMonthlyFeeAnalytics(decorated),
      };
    });
  }

  const rulesAnalytics = buildPlayerRulesAnalytics(allPlayers);

  const financeTabs = FINANCE_TABS.map((tab) => {
    let badge = "";
    switch (tab.key) {
      case "overview":
        badge = formatMonthYearLabel(filters.month, filters.year);
        break;
      case "monthly":
        badge = `${monthFeesDecorated.length} registros`;
        break;
      case "charge":
        badge = allPendingFees.length ? `${allPendingFees.length} pendente(s)` : "Em dia";
        break;
      case "cash":
        badge = `${monthTransactionsAll.length} lanc.`;
        break;
      case "guests":
        badge = `${guestPayments.length} convidados`;
        break;
      case "reports":
        badge = "Prestação";
        break;
      case "settings":
        badge = `${allPlayers.length} atletas`;
        break;
      default:
        badge = "";
    }

    return {
      ...tab,
      badge,
      href: buildFinancePath({
        month: filters.month,
        year: filters.year,
        tab: tab.key,
        status: filters.status,
        search: filters.search,
        cashType: filters.cashType,
        chargeFilter: filters.chargeFilter,
        reportType: filters.reportType,
        reportScope: filters.reportScope,
        reportStart: filters.reportStart,
        reportEnd: filters.reportEnd,
      }),
      active: filters.tab === tab.key,
    };
  });

  const dataYears = buildYearOptions([
    ...monthFeesRaw.map((fee) => fee.year),
      ...guestPayments.map((guest) => guest.year).filter(Boolean),
      ...recentMatches.map((match) => new Date(match.playedAt).getFullYear()),
  ]);

  const reports = filters.tab === "reports"
    ? await loadFinanceReport({
        prisma,
        settings,
        params: filters,
        includeHistory: true,
        historyLimit: 8,
      })
    : null;

  const helpers = {
    decimalToNumber,
    formatCurrencyBR,
    formatMonthYearLabel,
    formatDateInput,
    formatDateBR,
    formatDateBRShortYear,
    formatDateTimeBR,
    getTransactionCategoryLabel,
    getPaymentMethodLabel,
    computeMonthlyFeeBalance,
    getMonthlyFeeStatusMeta,
    getCollectionStatusMeta,
  };

  const monthLabel = formatMonthYearLabel(filters.month, filters.year);
  const summaries = buildFinanceSummaries({
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
    noChargeCount,
    exemptCount,
    overdueCount: overdueFees.length,
    dueTodayCount: dueTodayFees.length,
    totalExpensesMonth,
    currentMonthNet,
    cashBalance,
    activeFinancePlayers: eligiblePlayers.length,
    guestsCount: guestPayments.length,
    expectedPayers,
    pendingWithWhatsappCount,
    pendingWithoutWhatsappCount,
    automaticIncomeTotal,
    manualExpenseTotal,
    projectedMissingAmount: effectiveProjectedMissingAmount,
    participantTypeCounts: rulesAnalytics.counts,
    chargeBehavior: settings.chargeBehavior,
    autoGenerateCompetence: settings.autoGenerateCompetence,
  });
  const overview = buildFinanceOverview({
    monthLabel,
    pendingFees: allPendingFees,
    transactionPreviewSource: monthTransactionsAll,
    receivedPercentage,
    delinquentCount,
    paidCount,
    partialCount,
    exemptCount,
    rulesInsights: rulesAnalytics.insights,
  });

  return {
    page: {
      title: "Financeiro",
      activeTab: filters.tab,
      monthReferenceLabel: monthLabel,
    },
    filters,
    helpers,
    navigation: {
      tabs: financeTabs,
      monthOptions: MONTH_OPTIONS,
      yearOptions: dataYears,
    },
    summaries,
    alerts,
    overview,
    monthly: {
      fees: monthFees,
      allFees: monthFeesRaw,
      selectedFee,
      feeHistory,
      statusOptions: monthlyStatusOptions,
      activeStatus: monthlyActiveStatus,
      hiddenCount: hiddenMonthFees.length,
      hiddenNoChargeCount: hiddenNoChargeFees.length,
    },
    charge: {
      pendingFees: chargeFees,
      allPendingFees,
      filterOptions: CHARGE_FILTER_OPTIONS,
    },
    cash: {
      transactions: monthTransactions,
      allTransactions: monthTransactionsAll,
      selectedTransaction,
      typeOptions: FINANCE_TRANSACTION_TYPE_OPTIONS,
      categoryOptions: FINANCE_TRANSACTION_CATEGORY_OPTIONS,
    },
    guests: {
      payments: guestPayments,
      selectedGuest,
    },
    reports: {
      payload: reports,
      scopeOptions: REPORT_SCOPE_OPTIONS,
      typeOptions: REPORT_TYPE_OPTIONS,
    },
    settings: {
      values: settings,
      players: {
        all: allPlayers,
        eligible: eligiblePlayers,
      },
      recentMatches,
      paymentMethodOptions: PAYMENT_METHOD_OPTIONS,
      participantTypeOptions: PARTICIPANT_TYPE_OPTIONS,
      participantTypeMetaMap: PARTICIPANT_TYPE_META,
      chargeBehaviorOptions: CHARGE_BEHAVIOR_OPTIONS,
      recentEvents: recentFinanceEvents,
    },
    automation: {
      preparation: effectivePreparation,
      competenceState,
      reportSummary,
      bulkChargeSummary,
      competenceReset: {
        active: competenceWasReset,
        resetAt: competenceResetMarker?.createdAt || null,
      },
    },
  };
}


module.exports = {
  FINANCE_TABS,
  normalizeFinanceTab,
  getNowMonthYear,
  toInt,
  normalizeFinanceFilters,
  buildFinanceRedirectQuery,
  buildFinancePath,
  getFinanceHashByTab,
  getMonthlyFeeHash,
  parseOptionalCurrencyInput,
  ensureFinanceSettings,
  buildFinancePageViewModel,
  buildFinanceRenderView,
  loadFinancePageData: buildFinancePageViewModel,
};
