const prisma = require("./db");

const WEEKLY_SELECTION_SLOTS = [
  { key: "GOL", label: "Goleiro", count: 1 },
  { key: "ZAG", label: "Zagueiros", count: 2 },
  { key: "MEI", label: "Meias", count: 2 },
  { key: "ATA", label: "Atacantes", count: 2 },
];

function normalizePositionGroup(position = "") {
  const value = String(position || "").toLowerCase();
  if (value.includes("gol")) return "GOL";
  if (value.includes("zag")) return "ZAG";
  if (value.includes("vol") || value.includes("mei")) return "MEI";
  if (value.includes("ata") || value.includes("pont")) return "ATA";
  return "OUTRO";
}

function normalizeGuestKey(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `guest-${Date.now()}`;
}

function collectGuestsFromLineup(lineup) {
  const guests = new Map();
  const groups = [
    ...(Array.isArray(lineup?.teams) ? lineup.teams : []).flatMap((team) => Array.isArray(team?.players) ? team.players : []),
    ...(Array.isArray(lineup?.bench) ? lineup.bench : []),
  ];

  groups.forEach((entry, index) => {
    const isGuest = entry?.guest === true || entry?.isGuest === true || String(entry?.id || "").startsWith("guest-");
    if (!isGuest) return;

    const name = String(entry?.name || "Convidado").trim();
    const position = String(entry?.position || entry?.pos || "Outros").trim();
    const guestKey = normalizeGuestKey(entry?.id, `${name}-${position}-${index}`);
    if (guests.has(guestKey)) return;

    guests.set(guestKey, {
      guestKey,
      name,
      nickname: entry?.nickname || null,
      position,
      photoUrl: entry?.photoUrl || null,
      strength: Number.isFinite(Number(entry?.strength)) ? Math.round(Number(entry.strength)) : 60,
    });
  });

  return Array.from(guests.values());
}

async function syncMatchGuestsFromLatestLineup(matchId, tx = prisma) {
  const latestLineup = await tx.lineupDraw.findFirst({
    where: { matchId },
    orderBy: { createdAt: "desc" },
  });

  const guests = collectGuestsFromLineup(latestLineup?.result || null);
  if (!guests.length) return [];

  await Promise.all(
    guests.map((guest) =>
      tx.matchGuest.upsert({
        where: {
          matchId_guestKey: {
            matchId,
            guestKey: guest.guestKey,
          },
        },
        update: {
          name: guest.name,
          nickname: guest.nickname,
          position: guest.position,
          photoUrl: guest.photoUrl,
          strength: guest.strength,
        },
        create: {
          matchId,
          ...guest,
        },
      })
    )
  );

  return tx.matchGuest.findMany({
    where: { matchId },
    orderBy: { name: "asc" },
  });
}

function compareSelectionCandidates(a, b) {
  if (b.finalRating !== a.finalRating) return b.finalRating - a.finalRating;
  if ((b.votesCount || 0) !== (a.votesCount || 0)) return (b.votesCount || 0) - (a.votesCount || 0);
  if ((b.goals || 0) !== (a.goals || 0)) return (b.goals || 0) - (a.goals || 0);
  if ((b.assists || 0) !== (a.assists || 0)) return (b.assists || 0) - (a.assists || 0);
  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
}

function buildWeeklySelection({ playerScores = [], guestScores = [] } = {}) {
  const grouped = new Map(WEEKLY_SELECTION_SLOTS.map((slot) => [slot.key, []]));

  [...playerScores, ...guestScores].forEach((candidate) => {
    const key = normalizePositionGroup(candidate.position || candidate.player?.position || candidate.matchGuest?.position);
    if (!grouped.has(key)) return;
    grouped.get(key).push({
      ...candidate,
      positionGroup: key,
      name: candidate.name || candidate.player?.name || candidate.matchGuest?.name || "Jogador",
    });
  });

  return WEEKLY_SELECTION_SLOTS.map((slot) => ({
    ...slot,
    players: [...(grouped.get(slot.key) || [])]
      .sort(compareSelectionCandidates)
      .slice(0, slot.count)
      .map((candidate, index) => ({ ...candidate, slot: index + 1 })),
  }));
}

async function persistWeeklySelection(matchId, selection, tx = prisma) {
  await tx.weeklySelectionEntry.deleteMany({ where: { matchId } });

  const entries = selection.flatMap((group) =>
    (group.players || []).map((candidate) => ({
      matchId,
      positionGroup: group.key,
      slot: candidate.slot,
      playerId: candidate.type === "player" ? candidate.id : null,
      matchGuestId: candidate.type === "guest" ? candidate.id : null,
      finalRating: Number(candidate.finalRating || 0),
      votesCount: Number(candidate.votesCount || 0),
      goals: Number(candidate.goals || 0),
      assists: Number(candidate.assists || 0),
      saves: candidate.saves == null ? null : Number(candidate.saves),
    }))
  );

  if (entries.length) {
    await tx.weeklySelectionEntry.createMany({ data: entries });
  }

  return entries;
}

module.exports = {
  WEEKLY_SELECTION_SLOTS,
  buildWeeklySelection,
  collectGuestsFromLineup,
  normalizePositionGroup,
  persistWeeklySelection,
  syncMatchGuestsFromLatestLineup,
};
