const MONTH_NAMES_PT = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const MONTH_OPTIONS = MONTH_NAMES_PT.map((label, index) => ({
  value: index + 1,
  label: label.charAt(0).toUpperCase() + label.slice(1),
}));

const FINANCE_TABS = [
  {
    key: "overview",
    label: "Visao Geral",
    description: "Dashboard rapido da competencia e do caixa.",
  },
  {
    key: "monthly",
    label: "Mensalidades",
    description: "Controle do mes e edicao das cobrancas.",
  },
  {
    key: "charge",
    label: "Cobranca",
    description: "Pendencias prontas para acao.",
  },
  {
    key: "cash",
    label: "Caixa",
    description: "Extrato e lancamentos do periodo.",
  },
  {
    key: "guests",
    label: "Convidados",
    description: "Entradas avulsas integradas ao caixa.",
  },
  {
    key: "reports",
    label: "Relatorios",
    description: "Prestacao de contas e exportacoes.",
  },
  {
    key: "settings",
    label: "Configuracoes",
    description: "Pix, cobranca padrao e elegibilidade.",
  },
];

const MONTHLY_FEE_STATUS_META = {
  PENDING: { key: "PENDING", label: "Pendente", tone: "warning" },
  PAID: { key: "PAID", label: "Pago", tone: "ok" },
  PARTIAL: { key: "PARTIAL", label: "Parcial", tone: "info" },
  EXEMPT: { key: "EXEMPT", label: "Isento", tone: "pending" },
};

const DEFAULT_LATE_PER_MATCH_AMOUNT = 25;

const MONTHLY_FEE_BILLING_MODE_META = {
  MONTHLY: { key: "MONTHLY", label: "Mensal do mes", tone: "ok" },
  PER_MATCH: { key: "PER_MATCH", label: "Avulso mensal", tone: "info" },
  LATE_PER_MATCH: { key: "LATE_PER_MATCH", label: "Virou avulso", tone: "warning" },
  EXEMPT: { key: "EXEMPT", label: "Isento", tone: "pending" },
};

const PAYMENT_METHOD_OPTIONS = [
  { value: "PIX", label: "Pix" },
  { value: "CASH", label: "Dinheiro" },
  { value: "TRANSFER", label: "Transferencia" },
  { value: "CARD", label: "Cartao" },
  { value: "OTHER", label: "Outro" },
];

const FINANCE_TRANSACTION_TYPE_OPTIONS = [
  { value: "INCOME", label: "Entrada" },
  { value: "EXPENSE", label: "Saida" },
];

const FINANCE_TRANSACTION_CATEGORY_OPTIONS = {
  INCOME: [
    { value: "MONTHLY_FEE", label: "Mensalidade" },
    { value: "GUEST", label: "Convidado" },
    { value: "EXTRA", label: "Extra" },
    { value: "SPONSORSHIP", label: "Patrocinio" },
    { value: "OTHER_INCOME", label: "Outros" },
  ],
  EXPENSE: [
    { value: "COURT", label: "Quadra" },
    { value: "BALL", label: "Bola" },
    { value: "BIB", label: "Colete" },
    { value: "REFEREE", label: "Arbitragem" },
    { value: "DRINK", label: "Bebida" },
    { value: "MAINTENANCE", label: "Manutencao" },
    { value: "PRIZE", label: "Premiacao" },
    { value: "OTHER_EXPENSE", label: "Outros" },
  ],
};

const FINANCE_TRANSACTION_CATEGORY_LABELS = Object.fromEntries(
  Object.values(FINANCE_TRANSACTION_CATEGORY_OPTIONS)
    .flat()
    .map((item) => [item.value, item.label])
);

const COLLECTION_STATUS_META = {
  CURRENT: { key: "CURRENT", label: "Em dia", tone: "pending" },
  DUE_TODAY: { key: "DUE_TODAY", label: "Vence hoje", tone: "warning" },
  OVERDUE: { key: "OVERDUE", label: "Atrasado", tone: "danger" },
  PAID: { key: "PAID", label: "Pago", tone: "ok" },
  PARTIAL: { key: "PARTIAL", label: "Parcial", tone: "info" },
  EXEMPT: { key: "EXEMPT", label: "Isento", tone: "pending" },
};

const COLLECTION_STATUS_SORT_ORDER = ["OVERDUE", "DUE_TODAY", "CURRENT", "PARTIAL", "PAID", "EXEMPT"];

const MONTHLY_COLLECTION_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos" },
  { value: "OVERDUE", label: "Atrasados" },
  { value: "DUE_TODAY", label: "Vence hoje" },
  { value: "CURRENT", label: "Em dia" },
  { value: "PAID", label: "Pagos" },
  { value: "PARTIAL", label: "Parciais" },
  { value: "EXEMPT", label: "Isentos" },
];

const CHARGE_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos os pendentes" },
  { value: "OVERDUE", label: "Vencidos" },
  { value: "DUE_TODAY", label: "Vence hoje" },
  { value: "WITH_WHATSAPP", label: "Com WhatsApp" },
  { value: "WITHOUT_WHATSAPP", label: "Sem WhatsApp" },
  { value: "PARTIAL", label: "Parciais" },
  { value: "HIGHEST_AMOUNT", label: "Maior valor" },
];

const MONTHLY_COLLECTION_FILTER_ALIASES = {
  PENDING: "CURRENT",
  EM_DIA: "CURRENT",
  VENCE_HOJE: "DUE_TODAY",
  ATRASADO: "OVERDUE",
  ATRASADOS: "OVERDUE",
  PAGO: "PAID",
  PAGOS: "PAID",
  PARCIAL: "PARTIAL",
  PARCIAIS: "PARTIAL",
  ISENTO: "EXEMPT",
  ISENTOS: "EXEMPT",
};

const CHARGE_FILTER_ALIASES = {
  VENCIDOS: "OVERDUE",
  COM_WHATSAPP: "WITH_WHATSAPP",
  SEM_WHATSAPP: "WITHOUT_WHATSAPP",
  MAIOR_VALOR: "HIGHEST_AMOUNT",
  PARCIAIS: "PARTIAL",
};

const COMPETENCE_STATE_META = {
  OPEN: { key: "OPEN", label: "Aberta", tone: "warning" },
  NEARLY_CLOSED: { key: "NEARLY_CLOSED", label: "Quase fechada", tone: "info" },
  CLOSED: { key: "CLOSED", label: "Fechada", tone: "ok" },
  NOT_PREPARED: { key: "NOT_PREPARED", label: "Nao preparada", tone: "warning" },
};

const COMPETENCE_STATE_THRESHOLDS = {
  minPendingCount: 2,
  pendingCountRatio: 0.15,
  pendingAmountRatio: 0.12,
};

const PARTICIPANT_TYPE_OPTIONS = [
  { value: "MONTHLY", label: "Mensalista", description: "Segue a regra padrao da mensalidade." },
  { value: "PER_MATCH", label: "Avulso mensal", description: "Cobra R$ 25,00 por pelada em cada presenca do mes." },
  { value: "SPECIAL", label: "Especial", description: "Permite valor customizado e ajustes diferenciados." },
  { value: "EXEMPT", label: "Isento", description: "Gera mensalidade isenta para manter o controle." },
  { value: "GUEST", label: "Convidado", description: "Fica fora da geracao mensal e entra como avulso." },
];

const PARTICIPANT_TYPE_META = {
  MONTHLY: { key: "MONTHLY", label: "Mensalista", tone: "ok" },
  PER_MATCH: { key: "PER_MATCH", label: "Avulso mensal", tone: "info" },
  GUEST: { key: "GUEST", label: "Convidado", tone: "pending" },
  EXEMPT: { key: "EXEMPT", label: "Isento", tone: "warning" },
  SPECIAL: { key: "SPECIAL", label: "Especial", tone: "info" },
};

const CHARGE_BEHAVIOR_OPTIONS = [
  { value: "ASSISTED", label: "Assistida", description: "Sugere cobranca e automacoes, mas pede confirmacao." },
  { value: "AUTOMATIC", label: "Automatica", description: "Mantem sugestoes e pode preparar competencia automaticamente." },
  { value: "MANUAL_ONLY", label: "Manual", description: "Mantem o modulo sob confirmacao manual e evita acao em massa agressiva." },
];

const REPORT_TYPE_META = {
  FULL: {
    key: "FULL",
    label: "PDF completo",
    title: "Prestacao de Contas",
    description: "Visao completa com resumo executivo, mensalidades, convidados, extrato e rankings.",
    filenameBase: "prestacao-contas-completa",
    sections: {
      executive: true,
      insights: true,
      monthly: true,
      guests: true,
      cash: true,
      expenses: true,
      rankings: true,
      annual: false,
    },
  },
  SUMMARY: {
    key: "SUMMARY",
    label: "PDF resumido",
    title: "Prestacao de Contas Resumida",
    description: "Resumo executivo com indicadores, insights e os principais destaques do periodo.",
    filenameBase: "prestacao-contas-resumida",
    sections: {
      executive: true,
      insights: true,
      monthly: false,
      guests: false,
      cash: false,
      expenses: true,
      rankings: true,
      annual: false,
    },
  },
  CASH: {
    key: "CASH",
    label: "PDF do caixa",
    title: "Extrato Financeiro",
    description: "Extrato detalhado do periodo com entradas, saidas, categorias e saldo acumulado.",
    filenameBase: "financeiro-caixa",
    sections: {
      executive: true,
      insights: true,
      monthly: false,
      guests: false,
      cash: true,
      expenses: true,
      rankings: false,
      annual: false,
    },
  },
  PENDING: {
    key: "PENDING",
    label: "PDF de pendentes",
    title: "Pendencias Financeiras",
    description: "Recorte das mensalidades em aberto, com saldo, vencimento e prioridade de cobranca.",
    filenameBase: "financeiro-pendentes",
    sections: {
      executive: true,
      insights: true,
      monthly: true,
      guests: false,
      cash: false,
      expenses: false,
      rankings: true,
      annual: false,
    },
  },
  GUESTS: {
    key: "GUESTS",
    label: "PDF de convidados",
    title: "Convidados do Periodo",
    description: "Entradas avulsas registradas no periodo com vinculo ao caixa e referencia da pelada.",
    filenameBase: "financeiro-convidados",
    sections: {
      executive: true,
      insights: true,
      monthly: false,
      guests: true,
      cash: false,
      expenses: false,
      rankings: false,
      annual: false,
    },
  },
  ANNUAL_SUMMARY: {
    key: "ANNUAL_SUMMARY",
    label: "PDF anual resumido",
    title: "Resumo Financeiro Anual",
    description: "Panorama consolidado do ano com totais, tendencias e distribuicao mensal.",
    filenameBase: "financeiro-anual-resumido",
    sections: {
      executive: true,
      insights: true,
      monthly: false,
      guests: false,
      cash: false,
      expenses: true,
      rankings: true,
      annual: true,
    },
  },
};

const REPORT_SCOPE_OPTIONS = [
  { value: "MONTHLY", label: "Competencia mensal" },
  { value: "CUSTOM", label: "Intervalo personalizado" },
  { value: "YEARLY", label: "Ano consolidado" },
];

const REPORT_TYPE_OPTIONS = Object.values(REPORT_TYPE_META).map((item) => ({
  value: item.key,
  label: item.label,
}));

module.exports = {
  MONTH_NAMES_PT,
  MONTH_OPTIONS,
  FINANCE_TABS,
  MONTHLY_FEE_STATUS_META,
  DEFAULT_LATE_PER_MATCH_AMOUNT,
  MONTHLY_FEE_BILLING_MODE_META,
  PAYMENT_METHOD_OPTIONS,
  FINANCE_TRANSACTION_TYPE_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_LABELS,
  COLLECTION_STATUS_META,
  COLLECTION_STATUS_SORT_ORDER,
  MONTHLY_COLLECTION_FILTER_OPTIONS,
  CHARGE_FILTER_OPTIONS,
  MONTHLY_COLLECTION_FILTER_ALIASES,
  CHARGE_FILTER_ALIASES,
  COMPETENCE_STATE_META,
  COMPETENCE_STATE_THRESHOLDS,
  PARTICIPANT_TYPE_OPTIONS,
  PARTICIPANT_TYPE_META,
  CHARGE_BEHAVIOR_OPTIONS,
  REPORT_TYPE_META,
  REPORT_SCOPE_OPTIONS,
  REPORT_TYPE_OPTIONS,
};
