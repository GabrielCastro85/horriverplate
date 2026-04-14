const { formatDateTimeBR, formatMonthYearLabel } = require("../utils/finance");
const { REPORT_TYPE_META } = require("../constants/finance");

function normalizeString(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function inferFinanceEntity(action, explicitEntity) {
  if (explicitEntity) return normalizeString(explicitEntity, "finance");

  const parts = String(action || "finance.event").split(".");
  return normalizeString(parts[1], "finance");
}

function inferFinanceEntityId(explicitEntityId, metadata) {
  if (explicitEntityId != null && explicitEntityId !== "") {
    return String(explicitEntityId);
  }

  if (!metadata || typeof metadata !== "object") return null;

  return [
    metadata.id,
    metadata.monthlyFeeId,
    metadata.guestPaymentId,
    metadata.cashTransactionId,
    metadata.playerId,
    metadata.reportId,
  ]
    .find((value) => value != null && value !== "")
    ?.toString() || null;
}

function buildFinanceLogMetadata({
  summary = null,
  metadata = null,
  method = null,
  path = null,
  sourceTab = null,
}) {
  return {
    summary: normalizeString(summary, null),
    metadata: metadata || null,
    method: normalizeString(method, null),
    path: normalizeString(path, null),
    sourceTab: normalizeString(sourceTab, null),
  };
}

function buildFinanceLogInput(req, input = {}) {
  const action = normalizeString(input.action, "finance.event");
  const sourceTab = normalizeString(input.sourceTab, null)
    || normalizeString(req?.body?.tab, null)
    || normalizeString(req?.query?.tab, null);
  const metadata = input.metadata ?? input.payload ?? input.details ?? null;
  const entity = inferFinanceEntity(action, input.entity);
  const entityId = inferFinanceEntityId(input.entityId, metadata);

  return {
    action,
    entity,
    entityId,
    sourceTab,
    summary: normalizeString(input.summary, null),
    metadata,
    method: normalizeString(input.method, null) || normalizeString(req?.method, null),
    path: normalizeString(input.path, null) || normalizeString(req?.originalUrl, null),
    adminId: req?.admin?.id || input.createdById || null,
    adminEmail: req?.admin?.email || normalizeString(input.createdByEmail, null),
    writeAudit: input.writeAudit !== false,
  };
}

async function recordFinanceEvent(prisma, req, input = {}) {
  const event = buildFinanceLogInput(req, input);
  const payload = buildFinanceLogMetadata({
    summary: event.summary,
    metadata: event.metadata,
    method: event.method,
    path: event.path,
    sourceTab: event.sourceTab,
  });

  try {
    const operations = [
      prisma.financeEventLog.create({
        data: {
          action: event.action,
          entity: event.entity,
          entityId: event.entityId,
          sourceTab: event.sourceTab,
          adminId: event.adminId,
          adminEmail: event.adminEmail,
          payload,
        },
      }),
    ];

    if (event.writeAudit) {
      operations.push(
        prisma.auditLog.create({
          data: {
            adminId: event.adminId,
            adminEmail: event.adminEmail,
            method: event.method || "UNKNOWN",
            path: event.path || "/admin/finance",
            action: event.action,
            summary: event.summary,
            details: event.metadata,
          },
        })
      );
    }

    await Promise.all(operations);
    return event;
  } catch (error) {
    console.warn("Finance event log error:", error);
    return null;
  }
}

function mapFinanceEventRow(row) {
  return {
    ...row,
    summary: row.payload?.summary || null,
    metadata: row.payload?.metadata || null,
    method: row.payload?.method || null,
    path: row.payload?.path || null,
    sourceTab: row.sourceTab || row.payload?.sourceTab || null,
  };
}

async function getRecentFinanceEventLogs(prisma, limit = 8) {
  const rows = await prisma.financeEventLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows.map(mapFinanceEventRow);
}

async function getFinanceCompetenceResetMarker(prisma, { month, year, limit = 50 } = {}) {
  const targetMonth = Number(month || 0);
  const targetYear = Number(year || 0);
  if (!targetMonth || !targetYear) return null;

  const rows = await prisma.financeEventLog.findMany({
    where: {
      action: "finance.competence.reset",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  const match = rows.find((row) => {
    const metadata = row.payload?.metadata || null;
    return Number(metadata?.month || 0) === targetMonth && Number(metadata?.year || 0) === targetYear;
  });

  return match ? mapFinanceEventRow(match) : null;
}

function buildFinanceReportHistoryDescription(event) {
  const reportType = event.metadata?.reportType;
  const reportLabel = REPORT_TYPE_META[reportType]?.label || event.metadata?.reportLabel || "Relatorio";
  const periodLabel = event.metadata?.periodLabel
    || (event.metadata?.month && event.metadata?.year
      ? formatMonthYearLabel(event.metadata.month, event.metadata.year)
      : "Periodo");

  return event.summary || `${reportLabel} - ${periodLabel}`;
}

async function getFinanceReportHistory(prisma, limit = 8) {
  const rows = await prisma.financeEventLog.findMany({
    where: {
      action: {
        startsWith: "finance.report.",
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows.map((row) => {
    const event = mapFinanceEventRow(row);
    return {
      id: event.id,
      action: event.action,
      createdAt: event.createdAt,
      createdAtLabel: formatDateTimeBR(event.createdAt),
      typeLabel: REPORT_TYPE_META[event.metadata?.reportType]?.label || "Relatorio",
      periodLabel: event.metadata?.periodLabel || "-",
      description: buildFinanceReportHistoryDescription(event),
      params: event.metadata || {},
    };
  });
}

module.exports = {
  buildFinanceLogInput,
  recordFinanceEvent,
  createFinanceEventLog: recordFinanceEvent,
  getRecentFinanceEventLogs,
  getFinanceCompetenceResetMarker,
  getFinanceReportHistory,
};
