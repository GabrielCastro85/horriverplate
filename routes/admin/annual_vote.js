const express = require("express");
const crypto = require("crypto");
const prisma = require("../../utils/db");
const { deleteCache } = require("../../utils/page_cache");
const {
  ANNUAL_POSITIONS,
  ANNUAL_VOTE_MIN_MATCHES,
  buildAnnualCandidates,
  buildSeasonAwards,
  computeAnnualRanking,
  computeAnnualStatLeaders,
  computeAnnualVoteResult,
  getAnnualVoteStatus,
  hasAnnualCandidates,
  suggestCandidateIds,
} = require("../../utils/annual_vote");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

const BRT_OFFSET = "-03:00";

function parseLocalDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}:00${BRT_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Valor no formato de <input type="datetime-local">, no horário de Brasília.
function toLocalInputValue(date) {
  return new Date(date)
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
    .slice(0, 16)
    .replace(" ", "T");
}

function adminUrl(year, params = "") {
  return `/admin/annual-vote?year=${year}${params ? `&${params}` : ""}`;
}

// ==============================
// Votação dos melhores do ano (painel separado)
// ==============================
router.get("/annual-vote", requireAdmin, async (req, res) => {
  try {
    const currentYear = Number(new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
    const year = Number(req.query.year) || currentYear;

    const session = await prisma.annualVoteSession.findUnique({
      where: { year },
      include: {
        tokens: {
          include: { player: { select: { id: true, name: true, whatsapp: true } } },
        },
      },
    });

    const tokens = session
      ? [...session.tokens].sort((a, b) => a.player.name.localeCompare(b.player.name, "pt-BR"))
      : [];
    const usedCount = tokens.filter((token) => token.usedAt).length;
    const status = getAnnualVoteStatus(session);
    const canEditCandidates = usedCount === 0;

    // A lista só é recalculada enquanto ainda pode mudar: são muitas peladas para somar.
    const ranking = canEditCandidates ? await computeAnnualRanking(prisma, year) : [];
    const selectedIds = session
      ? ANNUAL_POSITIONS.flatMap((position) => (session.candidates[position.key] || []).map((row) => row.id))
      : suggestCandidateIds(ranking);

    // O resultado fica em segredo até o encerramento, inclusive no painel.
    let result = null;
    let statLeaders = [];
    let publishedCount = 0;
    if (session && status === "closed") {
      [result, statLeaders, publishedCount] = await Promise.all([
        computeAnnualVoteResult(prisma, session),
        computeAnnualStatLeaders(prisma, year, session.expiresAt),
        prisma.seasonAward.count({ where: { year } }),
      ]);
    }

    res.render("admin_annual_vote", {
      title: "Melhores do ano",
      year,
      session,
      tokens,
      usedCount,
      status,
      canEditCandidates,
      ranking,
      selectedIds,
      positions: ANNUAL_POSITIONS,
      minMatches: ANNUAL_VOTE_MIN_MATCHES,
      opensAtValue: session ? toLocalInputValue(session.opensAt) : `${year}-11-25T00:00`,
      expiresAtValue: session ? toLocalInputValue(session.expiresAt) : `${year}-11-27T23:59`,
      result,
      statLeaders,
      publishedCount,
      voteBaseUrl: `${req.protocol}://${req.get("host")}`,
      annualVoteError: req.query.annualVoteError || null,
      annualVoteNotice: req.query.annualVoteNotice || null,
    });
  } catch (err) {
    console.error("Erro ao carregar votação anual:", err);
    res.status(500).send("Erro ao carregar votação anual.");
  }
});

// ==============================
// Gerar ou atualizar a lista e os links
// ==============================
router.post("/annual-vote-session", requireAdmin, async (req, res) => {
  const year = Number(req.body.year);
  if (!Number.isInteger(year)) return res.redirect("/admin/annual-vote?annualVoteError=invalidYear");

  try {
    const opensAt = parseLocalDateTime(req.body.opensAt);
    const expiresAt = parseLocalDateTime(req.body.expiresAt);
    if (!opensAt || !expiresAt || expiresAt <= opensAt) {
      return res.redirect(adminUrl(year, "annualVoteError=invalidDates"));
    }

    const rawIds = req.body.candidateIds;
    const selectedIds = (Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [])
      .map(Number)
      .filter(Number.isFinite);

    const ranking = await computeAnnualRanking(prisma, year);
    const { candidates, overLimit } = buildAnnualCandidates(ranking, selectedIds);
    if (overLimit) return res.redirect(adminUrl(year, `annualVoteError=overLimit&position=${overLimit.key}`));
    if (!hasAnnualCandidates(candidates)) return res.redirect(adminUrl(year, "annualVoteError=noCandidates"));

    const voterIds = ranking.map((row) => row.id);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.annualVoteSession.findUnique({ where: { year } });
      if (existing) {
        const votes = await tx.annualVoteToken.count({
          where: { sessionId: existing.id, usedAt: { not: null } },
        });
        if (votes) throw new Error("HAS_VOTES");
      }

      const data = { candidates, opensAt, expiresAt, createdByAdminId: req.admin?.id ?? null };
      const session = await tx.annualVoteSession.upsert({
        where: { year },
        update: data,
        create: { year, ...data },
      });

      // Links já enviados continuam valendo; só entra quem ainda não tinha link.
      await tx.annualVoteToken.createMany({
        data: voterIds.map((playerId) => ({
          token: crypto.randomBytes(16).toString("hex"),
          sessionId: session.id,
          playerId,
        })),
        skipDuplicates: true,
      });
    });

    return res.redirect(adminUrl(year, "annualVoteNotice=created"));
  } catch (err) {
    if (err.message === "HAS_VOTES") return res.redirect(adminUrl(year, "annualVoteError=hasVotes"));
    console.error("Erro ao gerar votação anual:", err);
    return res.redirect(adminUrl(year, "annualVoteError=server"));
  }
});

// ==============================
// Ajustar o prazo (não mexe em candidatos nem em votos)
// ==============================
router.post("/annual-vote/:id/dates", requireAdmin, async (req, res) => {
  const year = Number(req.body.year);
  try {
    const opensAt = parseLocalDateTime(req.body.opensAt);
    const expiresAt = parseLocalDateTime(req.body.expiresAt);
    if (!opensAt || !expiresAt || expiresAt <= opensAt) {
      return res.redirect(adminUrl(year, "annualVoteError=invalidDates"));
    }
    await prisma.annualVoteSession.update({
      where: { id: Number(req.params.id) },
      data: { opensAt, expiresAt },
    });
    return res.redirect(adminUrl(year, "annualVoteNotice=dates"));
  } catch (err) {
    console.error("Erro ao ajustar prazo da votação anual:", err);
    return res.redirect(adminUrl(year, "annualVoteError=server"));
  }
});

// ==============================
// Publicar vencedores na premiação da temporada
// ==============================
router.post("/annual-vote/:id/publish", requireAdmin, async (req, res) => {
  try {
    const session = await prisma.annualVoteSession.findUnique({ where: { id: Number(req.params.id) } });
    if (!session) return res.redirect("/admin/annual-vote");
    if (getAnnualVoteStatus(session) !== "closed") {
      return res.redirect(adminUrl(session.year, "annualVoteError=notClosed"));
    }

    const [result, statLeaders] = await Promise.all([
      computeAnnualVoteResult(prisma, session),
      computeAnnualStatLeaders(prisma, session.year, session.expiresAt),
    ]);
    const awards = buildSeasonAwards(result, statLeaders);

    await prisma.$transaction(
      awards.map(({ category, playerId }) =>
        prisma.seasonAward.upsert({
          where: { year_category: { year: session.year, category } },
          update: { playerId },
          create: { year: session.year, category, playerId },
        })
      )
    );

    deleteCache("home");
    return res.redirect(adminUrl(session.year, "annualVoteNotice=published"));
  } catch (err) {
    console.error("Erro ao publicar melhores do ano:", err);
    return res.redirect("/admin/annual-vote?annualVoteError=server");
  }
});

module.exports = router;
