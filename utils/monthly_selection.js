// Seleção do mês: votação por posição feita junto com o craque do mês.
const { WEEKLY_SELECTION_SLOTS, normalizePositionGroup } = require("./weekly_selection");

// Mesma formação da seleção da semana: 1 goleiro e 2 de cada posição de linha.
const MONTHLY_SELECTION_SLOTS = WEEKLY_SELECTION_SLOTS;

function compareByScore(a, b) {
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
}

// Snapshot salvo na sessão: elegíveis do mês agrupados por posição.
function buildSelectionCandidates(ranking = []) {
  const grouped = Object.fromEntries(MONTHLY_SELECTION_SLOTS.map((slot) => [slot.key, []]));

  ranking
    .filter((row) => row.eligible)
    .forEach((row) => {
      const key = normalizePositionGroup(row.position);
      if (!grouped[key]) return;
      grouped[key].push({
        id: row.id,
        name: row.name,
        nickname: row.nickname || null,
        position: row.position || null,
        matches: row.matches,
        goals: row.goals,
        assists: row.assists,
        photos: row.photos,
        avgRating: row.avgRating,
        score: row.score,
      });
    });

  Object.values(grouped).forEach((list) => list.sort(compareByScore));
  return grouped;
}

function hasSelectionCandidates(selectionCandidates) {
  return !!selectionCandidates &&
    MONTHLY_SELECTION_SLOTS.some((slot) => (selectionCandidates[slot.key] || []).length > 0);
}

// Fotos não ficam no snapshot (podem ser base64 grandes); busca as atuais do cadastro.
async function attachSelectionPhotos(prisma, players = []) {
  const ids = Array.from(new Set(players.map((player) => Number(player.id)).filter(Number.isFinite)));
  if (!ids.length) return players;
  const rows = await prisma.player.findMany({
    where: { id: { in: ids } },
    select: { id: true, photoUrl: true },
  });
  const photoById = new Map(rows.map((row) => [row.id, row.photoUrl || null]));
  players.forEach((player) => {
    player.photoUrl = photoById.get(Number(player.id)) || null;
  });
  return players;
}

// Opções de cada posição para um eleitor (ninguém vota em si mesmo).
function getSelectionGroupsForVoter(selectionCandidates, voterId) {
  if (!hasSelectionCandidates(selectionCandidates)) return [];

  return MONTHLY_SELECTION_SLOTS.map((slot) => {
    const options = (selectionCandidates[slot.key] || []).filter(
      (candidate) => Number(candidate.id) !== Number(voterId)
    );
    return {
      ...slot,
      options,
      required: Math.min(slot.count, options.length),
    };
  }).filter((group) => group.required > 0);
}

function toIdList(value) {
  const list = Array.isArray(value) ? value : value != null && value !== "" ? [value] : [];
  return list.map((id) => Number(id)).filter(Number.isFinite);
}

// Lê os campos selection_<POS> do formulário e valida contra as opções do eleitor.
function parseSelectionFromBody(body = {}, groups = []) {
  const picks = [];
  const selectedByGroup = {};
  let error = null;

  groups.forEach((group) => {
    const ids = Array.from(new Set(toIdList(body[`selection_${group.key}`])));
    selectedByGroup[group.key] = ids;
    const validIds = new Set(group.options.map((option) => Number(option.id)));

    if (ids.some((id) => !validIds.has(id))) {
      error = error || `Seleção do mês: escolha inválida em ${group.label}.`;
      return;
    }
    if (ids.length !== group.required) {
      error = error || `Seleção do mês: escolha ${group.required} em ${group.label}.`;
      return;
    }
    ids.forEach((playerId) => picks.push({ positionGroup: group.key, playerId }));
  });

  return { picks, selectedByGroup, error };
}

// Apuração: mais votados por posição; empate decidido pelo score do mês.
async function computeMonthlySelectionResult(prisma, session) {
  const selectionCandidates = session?.selectionCandidates;
  if (!hasSelectionCandidates(selectionCandidates)) return null;

  const votes = await prisma.monthlySelectionVote.findMany({
    where: { token: { sessionId: session.id } },
    select: { tokenId: true, positionGroup: true, playerId: true },
  });

  const counts = new Map();
  votes.forEach((vote) => {
    const key = `${vote.positionGroup}:${vote.playerId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const voters = new Set(votes.map((vote) => vote.tokenId)).size;

  const groups = MONTHLY_SELECTION_SLOTS.map((slot) => {
    const ranked = (selectionCandidates[slot.key] || [])
      .map((candidate) => ({
        ...candidate,
        votes: counts.get(`${slot.key}:${candidate.id}`) || 0,
      }))
      .sort((a, b) => {
        if (b.votes !== a.votes) return b.votes - a.votes;
        return compareByScore(a, b);
      });

    return {
      ...slot,
      ranked,
      players: ranked
        .filter((candidate) => candidate.votes > 0)
        .slice(0, slot.count)
        .map((candidate, index) => ({ ...candidate, slot: index + 1 })),
    };
  });

  await attachSelectionPhotos(prisma, groups.flatMap((group) => group.ranked));
  return { groups, voters, hasVotes: votes.length > 0 };
}

// Versão compacta guardada em MonthlyAward.selection ao encerrar a votação.
function serializeSelectionResult(result) {
  if (!result?.hasVotes) return null;
  return result.groups.map((group) => ({
    key: group.key,
    label: group.label,
    players: group.players.map((player) => ({
      id: player.id,
      name: player.name,
      nickname: player.nickname,
      votes: player.votes,
      slot: player.slot,
    })),
  }));
}

module.exports = {
  MONTHLY_SELECTION_SLOTS,
  attachSelectionPhotos,
  buildSelectionCandidates,
  computeMonthlySelectionResult,
  getSelectionGroupsForVoter,
  hasSelectionCandidates,
  parseSelectionFromBody,
  serializeSelectionResult,
};
