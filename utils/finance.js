const {
  MONTH_NAMES_PT,
  MONTH_OPTIONS,
  MONTHLY_FEE_STATUS_META,
  MONTHLY_FEE_BILLING_MODE_META,
  PAYMENT_METHOD_OPTIONS,
  FINANCE_TRANSACTION_TYPE_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_LABELS,
} = require("../constants/finance");

function decimalToNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value) {
  return Math.round((decimalToNumber(value) + Number.EPSILON) * 100) / 100;
}

function parseCurrencyInput(value, fallback = 0) {
  if (value == null || value === "") return roundCurrency(fallback);
  if (typeof value === "number") return roundCurrency(value);
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundCurrency(parsed) : roundCurrency(fallback);
}

function formatCurrencyBR(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(roundCurrency(value));
}

function formatMonthYearLabel(month, year) {
  if (!month || !year) return "";
  const label = MONTH_NAMES_PT[Number(month) - 1];
  if (!label) return String(year);
  return `${label.charAt(0).toUpperCase() + label.slice(1)}/${year}`;
}

function formatDateInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateBR(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDateBRShortYear(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTimeBR(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function getMonthDateRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 3, 0, 0, 0));
  return { start, end };
}

function buildMonthlyDueDate(year, month, dueDay) {
  const y = Number(year);
  const m = Number(month);
  const maxDay = new Date(y, m, 0).getDate();
  const day = Math.max(1, Math.min(Number(dueDay) || 1, maxDay));
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0, 0));
}

function getLateChargeDateRange(year, month, dueDay) {
  const y = Number(year);
  const m = Number(month);
  const maxDay = new Date(y, m, 0).getDate();
  const startDay = Math.min(Math.max(Number(dueDay) || 1, 1) + 1, maxDay + 1);
  const start = new Date(Date.UTC(y, m - 1, startDay, 3, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 3, 0, 0, 0));
  return { start, end };
}

function computeMonthlyFeeStatus({ amountDue, amountPaid, isExempt = false, billingMode = "" }) {
  if (isExempt) return "EXEMPT";
  const due = roundCurrency(amountDue);
  const paid = roundCurrency(amountPaid);
  const normalizedBillingMode = String(billingMode || "").trim().toUpperCase();
  if ((normalizedBillingMode === "PER_MATCH" || normalizedBillingMode === "LATE_PER_MATCH") && due <= 0 && paid <= 0) {
    return "PENDING";
  }
  if (due <= 0) return "PAID";
  if (paid <= 0) return "PENDING";
  if (paid >= due) return "PAID";
  return "PARTIAL";
}

function computeMonthlyFeeBalance(monthlyFee) {
  if (!monthlyFee || monthlyFee.status === "EXEMPT") return 0;
  return roundCurrency(
    Math.max(decimalToNumber(monthlyFee.amountDue) - decimalToNumber(monthlyFee.amountPaid), 0)
  );
}

function normalizeWhatsappNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function buildWhatsappUrl(number, message) {
  const digits = normalizeWhatsappNumber(number);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || "")}`;
}

function buildFinanceWhatsappMessage({
  playerName,
  amountPending,
  month,
  year,
  pixKey,
  receiverName,
  template,
}) {
  const amount = formatCurrencyBR(amountPending);
  const monthYear = formatMonthYearLabel(month, year);
  const baseTemplate =
    template ||
    "Bom dia, {name}!\nSegue o Pix para voce pagar o valor de {amount} da mensalidade da pelada referente a {monthYear}:\n{pixKey}{receiverLine}";

  const receiverLine = receiverName ? `\nRecebedor: ${receiverName}` : "";
  return baseTemplate
    .replace(/\{name\}/g, playerName || "Jogador")
    .replace(/\{amount\}/g, amount)
    .replace(/\{monthYear\}/g, monthYear)
    .replace(/\{pixKey\}/g, pixKey || "")
    .replace(/\{receiver\}/g, receiverName || "")
    .replace(/\{receiverLine\}/g, receiverLine);
}

function getMonthlyFeeStatusMeta(status) {
  return MONTHLY_FEE_STATUS_META[status] || MONTHLY_FEE_STATUS_META.PENDING;
}

function getMonthlyFeeBillingModeMeta(mode) {
  return MONTHLY_FEE_BILLING_MODE_META[mode] || MONTHLY_FEE_BILLING_MODE_META.MONTHLY;
}

function getTransactionCategoryLabel(category) {
  return FINANCE_TRANSACTION_CATEGORY_LABELS[category] || category || "-";
}

function getPaymentMethodLabel(method) {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label || method || "-";
}

module.exports = {
  MONTH_NAMES_PT,
  MONTH_OPTIONS,
  MONTHLY_FEE_STATUS_META,
  PAYMENT_METHOD_OPTIONS,
  FINANCE_TRANSACTION_TYPE_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_OPTIONS,
  FINANCE_TRANSACTION_CATEGORY_LABELS,
  decimalToNumber,
  roundCurrency,
  parseCurrencyInput,
  formatCurrencyBR,
  formatMonthYearLabel,
  formatDateInput,
  formatDateBR,
  formatDateBRShortYear,
  formatDateTimeBR,
  getMonthDateRange,
  buildMonthlyDueDate,
  getLateChargeDateRange,
  computeMonthlyFeeStatus,
  computeMonthlyFeeBalance,
  normalizeWhatsappNumber,
  buildWhatsappUrl,
  buildFinanceWhatsappMessage,
  getMonthlyFeeStatusMeta,
  getMonthlyFeeBillingModeMeta,
  getTransactionCategoryLabel,
  getPaymentMethodLabel,
};
