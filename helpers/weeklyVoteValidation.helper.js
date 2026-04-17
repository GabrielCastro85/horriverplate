"use strict";

const WEEKLY_VOTE_INVALID_CODES = {
  EXCESSO_NOTA_MINIMA: {
    code: "EXCESSO_NOTA_MINIMA",
    reason: "Excesso de nota 1",
    adminTitle: "Padrao suspeito detectado",
    playfulLine: "Comissao da resenha acionada. Esse voto saiu da apuracao.",
  },
  REPETICAO_EXCESSIVA: {
    code: "REPETICAO_EXCESSIVA",
    reason: "Repeticao excessiva de nota 1",
    adminTitle: "Distribuicao suspeita de notas",
    playfulLine: "Tentativa de baguncar o craque? Aqui nao passa.",
  },
};

const DEFAULT_WEEKLY_VOTE_RULES = {
  repetitionThreshold: 0.7,
  minimumRatingThreshold: 0.7,
  lowRatingValues: [1],
};

function normalizeVoteRatings(ratingsInput = []) {
  return ratingsInput
    .map((item) => {
      if (typeof item === "number") return item;
      if (item && typeof item === "object" && Object.prototype.hasOwnProperty.call(item, "rating")) {
        return item.rating;
      }
      return null;
    })
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
}

function percentageFrom(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function analyzeWeeklyVoteRatings(ratingsInput = [], options = {}) {
  const rules = { ...DEFAULT_WEEKLY_VOTE_RULES, ...options };
  const ratings = normalizeVoteRatings(ratingsInput);
  const totalRatings = ratings.length;
  const frequencyMap = new Map();

  ratings.forEach((rating) => {
    frequencyMap.set(rating, (frequencyMap.get(rating) || 0) + 1);
  });

  const sortedFrequencies = [...frequencyMap.entries()]
    .map(([rating, count]) => ({ rating, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.rating - b.rating;
    });

  const mostRepeated = sortedFrequencies[0] || { rating: null, count: 0 };
  const lowRatingSet = new Set(rules.lowRatingValues || [1]);
  const lowRatingCount = ratings.filter((rating) => lowRatingSet.has(rating)).length;

  return {
    totalRatings,
    ratings,
    frequencies: sortedFrequencies,
    lowRatingValues: [...lowRatingSet].sort((a, b) => a - b),
    maxRepeatedRating: mostRepeated.rating,
    maxRepeatedCount: mostRepeated.count,
    maxRepeatedRatio: totalRatings ? mostRepeated.count / totalRatings : 0,
    maxRepeatedPercentage: percentageFrom(mostRepeated.count, totalRatings),
    lowRatingCount,
    lowRatingRatio: totalRatings ? lowRatingCount / totalRatings : 0,
    lowRatingPercentage: percentageFrom(lowRatingCount, totalRatings),
    minimumRatingCount: lowRatingCount,
    minimumRatingRatio: totalRatings ? lowRatingCount / totalRatings : 0,
    minimumRatingPercentage: percentageFrom(lowRatingCount, totalRatings),
  };
}

function resolveInvalidPayload(code, analysis) {
  const meta = WEEKLY_VOTE_INVALID_CODES[code];

  return {
    isInvalid: true,
    invalidCode: meta?.code || code || null,
    invalidReason: meta?.reason || "Voto anulado por padrao suspeito",
    analysis,
  };
}

function detectSuspiciousVotePattern(ratingsInput = [], options = {}) {
  const rules = { ...DEFAULT_WEEKLY_VOTE_RULES, ...options };
  const analysis = analyzeWeeklyVoteRatings(ratingsInput, rules);

  if (!analysis.totalRatings) {
    return {
      isInvalid: false,
      invalidCode: null,
      invalidReason: null,
      analysis,
    };
  }

  if (analysis.lowRatingRatio >= rules.minimumRatingThreshold) {
    return resolveInvalidPayload("EXCESSO_NOTA_MINIMA", analysis);
  }

  const lowRatingSet = new Set(rules.lowRatingValues || [1]);
  if (
    analysis.maxRepeatedRatio >= rules.repetitionThreshold &&
    lowRatingSet.has(analysis.maxRepeatedRating)
  ) {
    return resolveInvalidPayload("REPETICAO_EXCESSIVA", analysis);
  }

  return {
    isInvalid: false,
    invalidCode: null,
    invalidReason: null,
    analysis,
  };
}

function decorateWeeklyVoteBallot(ballot, options = {}) {
  const hasRatingsLoaded = Array.isArray(ballot?.ratings);
  const detection = detectSuspiciousVotePattern(hasRatingsLoaded ? ballot.ratings : [], options);
  const storedMeta = ballot?.invalidCode ? WEEKLY_VOTE_INVALID_CODES[ballot.invalidCode] : null;
  const detectedCode = hasRatingsLoaded
    ? detection.invalidCode || ballot?.invalidCode || null
    : ballot?.invalidCode || null;
  const detectedMeta = detectedCode ? WEEKLY_VOTE_INVALID_CODES[detectedCode] : null;
  const wasValidatedManually = Boolean(ballot?.validatedManually);
  const isInvalid = wasValidatedManually
    ? false
    : hasRatingsLoaded
      ? Boolean(detection.isInvalid)
      : Boolean(ballot?.isInvalid);
  const activeCode = isInvalid ? detectedCode : null;
  const activeMeta = activeCode ? WEEKLY_VOTE_INVALID_CODES[activeCode] : null;
  const detectedReason = hasRatingsLoaded
    ? detection.invalidReason || detectedMeta?.reason || storedMeta?.reason || null
    : ballot?.invalidReason || detectedMeta?.reason || storedMeta?.reason || null;

  return {
    ...ballot,
    voteValidation: {
      isInvalid,
      wasValidatedManually,
      validatedManuallyAt: ballot?.validatedManuallyAt || null,
      invalidCode: activeCode || null,
      invalidReason: isInvalid
        ? hasRatingsLoaded
          ? detection.invalidReason || activeMeta?.reason || storedMeta?.reason
          : ballot?.invalidReason || storedMeta?.reason || activeMeta?.reason || detection.invalidReason
        : null,
      detectedInvalidCode: detectedCode,
      detectedInvalidReason: detectedReason,
      badgeLabel: wasValidatedManually
        ? "Validado manualmente"
        : isInvalid
          ? "Voto anulado"
          : "Voto valido",
      adminTitle: wasValidatedManually
        ? "Voto liberado pelo admin"
        : isInvalid
          ? activeMeta?.adminTitle || "Padrao suspeito detectado"
          : "Voto valido",
      playfulLine: wasValidatedManually
        ? "O alerta automatico foi revisado e esse voto voltou para a apuracao."
        : isInvalid
          ? activeMeta?.playfulLine || "Comissao da resenha acionada."
          : null,
      statusText: isInvalid ? "Desconsiderado na apuracao" : "Considerado na apuracao",
      ...detection.analysis,
    },
  };
}

function isWeeklyVoteBallotValid(ballot, options = {}) {
  return !decorateWeeklyVoteBallot(ballot, options).voteValidation.isInvalid;
}

module.exports = {
  WEEKLY_VOTE_INVALID_CODES,
  DEFAULT_WEEKLY_VOTE_RULES,
  analyzeWeeklyVoteRatings,
  detectSuspiciousVotePattern,
  decorateWeeklyVoteBallot,
  isWeeklyVoteBallotValid,
};
