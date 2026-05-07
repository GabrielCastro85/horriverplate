// Shared admin formatting helpers — used by routes/admin.js and routes/admin/reports.js
const { formatDateBR } = require("./finance");

function formatMonthYearBR(month, year) {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${year}`;
}

function formatPlayerLabel(player, fallbackId = null) {
  if (!player) return fallbackId != null ? `#${fallbackId}` : "jogador desconhecido";
  const nick = player.nickname ? ` (${player.nickname})` : "";
  return `${player.name}${nick}`;
}

function formatMatchLabel(match, fallbackId = null) {
  if (!match) return fallbackId != null ? `#${fallbackId}` : "pelada desconhecida";
  const date = formatDateBR(match.playedAt) || "sem data";
  const desc = match.description ? ` - ${match.description}` : "";
  return `${date}${desc}`;
}

function formatPositionShort(position = "") {
  const raw = String(position || "").trim().toUpperCase();
  if (!raw) return "-";
  if (raw.includes("GOL")) return "GOL";
  if (raw.includes("ZAG") || raw.includes("DEF")) return "ZAG";
  if (raw.includes("VOL") || raw.includes("MEI")) return "MEI";
  if (raw.includes("ATA")) return "ATA";
  return raw.slice(0, 3);
}

function formatNumberBR(value, digits = 0) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

module.exports = {
  formatMonthYearBR,
  formatPlayerLabel,
  formatMatchLabel,
  formatPositionShort,
  formatNumberBR,
};
