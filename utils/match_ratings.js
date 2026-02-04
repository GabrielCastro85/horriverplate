const prisma = require("./db");

function normalizePosition(pos) {
  const p = (pos || "").toLowerCase();
  if (p.includes("gol")) return "GOL";
  if (p.includes("zag")) return "ZAG";
  if (p.includes("vol")) return "VOL";
  if (p.includes("mei")) return "MEI";
  if (p.includes("ata") || p.includes("pont")) return "ATA";
  return "OUTRO";
}

function starsFromRank(rankIndex, totalPlayers) {
  if (totalPlayers <= 1) return 5;
  const t = rankIndex / (totalPlayers - 1);
  const stars = 5 - 4 * t;
  return Math.round(stars * 2) / 2;
}

async function computeMatchRatingsAndAwards(matchId) {
  const [ballots, playerStats] = await Promise.all([
    prisma.voteBallot.findMany({
      where: {
        token: {
          session: {
            matchId,
          },
        },
      },
      include: {
        rankings: true,
        ratings: true,
        token: {
          include: {
            session: true,
            player: true,
          },
        },
      },
    }),
    prisma.playerStat.findMany({
      where: { matchId, present: true },
      include: { player: true },
    }),
  ]);

  if (!playerStats.length) {
    return { error: "noStats" };
  }

  const scores = new Map();
  playerStats.forEach((stat) => {
    scores.set(stat.playerId, {
      player: stat.player,
      statId: stat.id,
      goals: stat.goals || 0,
      assists: stat.assists || 0,
      appearedInPhoto: !!stat.appearedInPhoto,
      votesCount: 0,
      voteRating: 0,
      statsRating: 0,
      finalRating: 0,
    });
  });

  // Vote rating (0..10)
  const ratingSum = new Map();
  const ratingCount = new Map();
  let totalRatings = 0;

  ballots.forEach((vote) => {
    (vote.ratings || []).forEach((r) => {
      if (!scores.has(r.playerId)) return;
      ratingSum.set(r.playerId, (ratingSum.get(r.playerId) || 0) + r.rating);
      ratingCount.set(r.playerId, (ratingCount.get(r.playerId) || 0) + 1);
      totalRatings += 1;
    });
  });

  const hasRatings = totalRatings > 0;
  if (hasRatings) {
    scores.forEach((score, playerId) => {
      const vCount = ratingCount.get(playerId) || 0;
      const avg = vCount ? (ratingSum.get(playerId) || 0) / vCount : 0;
      score.votesCount = vCount;
      score.voteRating = Number(Math.max(0, Math.min(10, avg * 2)).toFixed(2));
    });
  } else {
    // Fallback: ranking-based votes (0..10) using smoothed stars
    const sumStars = new Map();
    const votesCount = new Map();
    let globalStarsSum = 0;
    let globalEvaluations = 0;

    ballots.forEach((vote) => {
      const grouped = vote.rankings.reduce((acc, r) => {
        const key = normalizePosition(r.position);
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {});

      Object.values(grouped).forEach((ranks) => {
        ranks.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        const total = ranks.length;
        ranks.forEach((rank, idx) => {
          const index = typeof rank.rank === "number" ? Math.max(0, rank.rank - 1) : idx;
          const stars = starsFromRank(index, total);
          if (!scores.has(rank.playerId)) return;
          sumStars.set(rank.playerId, (sumStars.get(rank.playerId) || 0) + stars);
          votesCount.set(rank.playerId, (votesCount.get(rank.playerId) || 0) + 1);
          globalStarsSum += stars;
          globalEvaluations += 1;
        });
      });
    });

    const m = globalEvaluations > 0 ? globalStarsSum / globalEvaluations : 2.5;
    const C = 3;

    scores.forEach((score, playerId) => {
      const vCount = votesCount.get(playerId) || 0;
      const R = vCount ? (sumStars.get(playerId) || 0) / vCount : 0;
      let finalStars;
      if (vCount > 0) {
        finalStars = (R * vCount + m * C) / (vCount + C);
      } else {
        finalStars = m || 2.5;
      }
      score.votesCount = vCount;
      score.voteRating = Number((finalStars * 2).toFixed(2));
    });
  }

  // Stats rating (0..10) normalized by position
  const maxGoals = Math.max(0, ...playerStats.map((s) => s.goals || 0));
  const maxAssists = Math.max(0, ...playerStats.map((s) => s.assists || 0));

  playerStats.forEach((stat) => {
    const entry = scores.get(stat.playerId);
    if (!entry) return;
    const posGroup = normalizePosition(stat.player.position);

    let gW = 0.6;
    let aW = 0.3;
    let photoBonus = stat.appearedInPhoto ? 0.1 : 0;

    if (posGroup === "GOL") {
      gW = 0.2;
      aW = 0.3;
      photoBonus = stat.appearedInPhoto ? 0.5 : 0;
    } else if (posGroup === "ZAG") {
      gW = 0.3;
      aW = 0.4;
      photoBonus = stat.appearedInPhoto ? 0.3 : 0;
    } else if (posGroup === "MEI" || posGroup === "VOL") {
      gW = 0.4;
      aW = 0.4;
      photoBonus = stat.appearedInPhoto ? 0.2 : 0;
    }

    const goalsRel = maxGoals > 0 ? (stat.goals || 0) / maxGoals : 0;
    const assistsRel = maxAssists > 0 ? (stat.assists || 0) / maxAssists : 0;

    let score0to1 = goalsRel * gW + assistsRel * aW + photoBonus;
    if (score0to1 > 1) score0to1 = 1;
    const statsRating = Number((score0to1 * 10).toFixed(2));

    entry.statsRating = statsRating;
  });

  scores.forEach((entry) => {
    const finalRating = 0.7 * entry.voteRating + 0.3 * entry.statsRating;
    entry.finalRating = Number(finalRating.toFixed(2));
  });

  const pickBest = (playerIds) => {
    let best = null;
    playerIds.forEach((pid) => {
      const s = scores.get(pid);
      if (!s) return;
      if (!best) {
        best = s;
        return;
      }
      if (s.finalRating > best.finalRating) {
        best = s;
        return;
      }
      const currentGa = (s.goals || 0) + (s.assists || 0);
      const bestGa = (best.goals || 0) + (best.assists || 0);
      if (s.finalRating === best.finalRating && currentGa > bestGa) {
        best = s;
        return;
      }
      if (
        s.finalRating === best.finalRating &&
        currentGa === bestGa &&
        s.votesCount > best.votesCount
      ) {
        best = s;
      }
    });
    return best;
  };

  const groupedIds = {
    GOL: [],
    ZAG: [],
    MEI: [],
    VOL: [],
    ATA: [],
    OUTRO: [],
  };

  playerStats.forEach((stat) => {
    const key = normalizePosition(stat.player.position);
    groupedIds[key] = groupedIds[key] || [];
    groupedIds[key].push(stat.playerId);
  });

  const awards = {
    craque: pickBest(Array.from(scores.keys())),
    melhor_goleiro: pickBest(groupedIds.GOL || []),
    melhor_zagueiro: pickBest(groupedIds.ZAG || []),
    melhor_meia: pickBest([...(groupedIds.MEI || []), ...(groupedIds.VOL || [])]),
    melhor_atacante: pickBest(groupedIds.ATA || []),
  };

  return { publicVotes: ballots, playerStats, scores, awards };
}

module.exports = {
  computeMatchRatingsAndAwards,
};
