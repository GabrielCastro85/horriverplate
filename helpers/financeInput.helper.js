const { parseCurrencyInput } = require("../utils/finance");

function getSaoPauloNowMonthYear(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));

  return {
    month: Number(parts.find((part) => part.type === "month")?.value || 1),
    year: Number(parts.find((part) => part.type === "year")?.value || new Date().getFullYear()),
  };
}

function parseInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseClampedInteger(
  value,
  { fallback = null, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}
) {
  const parsed = parseInteger(value, fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getSafeString(value, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function getTrimmedString(value, fallback = "") {
  return getSafeString(value, fallback).trim();
}

function getOptionalTrimmedString(value) {
  const trimmed = getTrimmedString(value, "");
  return trimmed || null;
}

function normalizeUppercaseValue(value, fallback = "") {
  const normalized = getTrimmedString(value, fallback);
  return normalized ? normalized.toUpperCase() : fallback;
}

function parseCheckbox(value) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function parseMoneyInput(value, fallback = 0) {
  return parseCurrencyInput(value, fallback);
}

function parseOptionalMoneyInput(value) {
  if (value == null || value === "") return null;
  return parseCurrencyInput(value, 0);
}

function parseDateInput(value, fallback = null, { hour = 12 } = {}) {
  const raw = getTrimmedString(value, "");
  if (!raw) return fallback;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return fallback;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return fallback;
  }

  return parsed;
}

function parseOptionalInteger(
  value,
  { fallback = null, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}
) {
  const raw = getTrimmedString(value, "");
  if (!raw) return fallback;
  return parseClampedInteger(raw, { fallback, min, max });
}

function parseIdParam(value, fallback = null) {
  return parseInteger(value, fallback);
}

function parseOptionalId(value, fallback = null) {
  return parseOptionalInteger(value, { fallback, min: 0, max: Number.MAX_SAFE_INTEGER });
}

function parseIdList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => parseIdParam(item, null)).filter(Boolean);
}

function parseFinanceCompetence(input = {}, fallback = getSaoPauloNowMonthYear()) {
  return {
    month: parseClampedInteger(input.month, { fallback: fallback.month, min: 1, max: 12 }),
    year: parseClampedInteger(input.year, { fallback: fallback.year, min: 2024, max: 2100 }),
  };
}

module.exports = {
  getSaoPauloNowMonthYear,
  parseInteger,
  parseClampedInteger,
  getSafeString,
  getTrimmedString,
  getOptionalTrimmedString,
  normalizeUppercaseValue,
  parseCheckbox,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseDateInput,
  parseOptionalInteger,
  parseIdParam,
  parseOptionalId,
  parseIdList,
  parseFinanceCompetence,
};
