/**
 * Preenche conquistas oficiais do Horriver Plate e atribui aos jogadores elegíveis
 * baseado nos agregados já salvos (gols, assistências, presenças, notas, prêmios semana/mês).
 *
 * Uso:
 *   node scripts/award_achievements.js
 *
 * Obs: regras avançadas (streaks, top da temporada, zagueiro da semana/mês, etc.)
 * não são atribuídas aqui por dependência de dados que não temos. Elas são criadas
 * como conquistas (Achievement) mas ficam não atribuídas até termos dados completos.
 */
const { PrismaClient } = require("../node_modules/@prisma/client");
const prisma = new PrismaClient();

const now = new Date();

// Lista de conquistas oficiais com slug único
const ACHIEVEMENTS = [
  // Gols
  { slug: "gols_10", name: "Pé na Forma", description: "10 gols", category: "gols" },
  { slug: "gols_25", name: "Artilheiro de Bairro", description: "25 gols", category: "gols" },
  { slug: "gols_50", name: "Matador", description: "50 gols", category: "gols" },
  { slug: "gols_75", name: "Camisa 9 de Ouro", description: "75 gols", category: "gols" },
  { slug: "gols_100", name: "Lenda do Gol", description: "100 gols", category: "gols" },
  { slug: "gols_150", name: "Canhão Humano", description: "150 gols", category: "gols" },
  { slug: "gols_250", name: "Imortal da Pelada", description: "250 gols", category: "gols" },
  { slug: "gols_500", name: "Recordista Mundial do Horriver Plate", description: "500 gols", category: "gols" },

  // Assistências
  { slug: "ast_10", name: "Garçom", description: "10 assistências", category: "assistencias" },
  { slug: "ast_25", name: "Prato Principal", description: "25 assistências", category: "assistencias" },
  { slug: "ast_50", name: "Mestre das Assistências", description: "50 assistências", category: "assistencias" },
  { slug: "ast_75", name: "Maestro", description: "75 assistências", category: "assistencias" },
  { slug: "ast_100", name: "Gênio do Último Passe", description: "100 assistências", category: "assistencias" },
  { slug: "ast_150", name: "Lenda dos Cruzamentos", description: "150 assistências", category: "assistencias" },
  { slug: "ast_200", name: "O Xavi da Pelada", description: "200 assistências", category: "assistencias" },

  // Zagueiro (apenas criamos; atribuições avançadas não incluídas aqui)
  { slug: "zag_pres_20", name: "Basalto", description: "20 jogos como zagueiro", category: "zagueiro" },
  { slug: "zag_pres_40", name: "Titular Absoluto", description: "40 jogos como zagueiro", category: "zagueiro" },
  { slug: "zag_pres_75", name: "O Xerifão", description: "75 jogos como zagueiro", category: "zagueiro" },
  { slug: "zag_pres_120", name: "Lenda da Retaguarda", description: "120 jogos como zagueiro", category: "zagueiro" },
  { slug: "zag_notas_5x7", name: "Seguro e Simples", description: "5 notas ≥ 7 como zagueiro", category: "zagueiro" },
  { slug: "zag_notas_10x8", name: "Paredão", description: "10 notas ≥ 8 como zagueiro", category: "zagueiro" },
  { slug: "zag_notas_5x9", name: "Zagueiro de Seleção", description: "5 notas ≥ 9 como zagueiro", category: "zagueiro" },
  { slug: "zag_nota_top", name: "Craque Invisível", description: "Melhor nota da pelada como zagueiro", category: "zagueiro" },
  { slug: "zag_media_75", name: "O Monstro da Defesa", description: "Média ≥ 7.5 na temporada", category: "zagueiro" },
  { slug: "zag_gol_1", name: "Subiu e Guardou", description: "1 gol como zagueiro", category: "zagueiro" },
  { slug: "zag_gol_5", name: "Zagueiro Artilheiro", description: "5 gols como zagueiro", category: "zagueiro" },
  { slug: "zag_gol_duplo", name: "Inesperado", description: "2 gols na mesma pelada (zagueiro)", category: "zagueiro" },
  { slug: "zag_vandijk", name: "Van Dijk Mode", description: "Gol + melhor da pelada como zagueiro", category: "zagueiro" },
  { slug: "zag_semana", name: "Zagueiro da Semana", description: "Craque da semana na zaga", category: "zagueiro" },
  { slug: "zag_mes", name: "Zagueiro do Mês", description: "Craque do mês na zaga", category: "zagueiro" },
  { slug: "zag_top3", name: "Xerife da Temporada", description: "Top 3 geral na temporada", category: "zagueiro" },
  { slug: "zag_3meses", name: "Domínio da Zaga", description: "3 craques do mês como zagueiro", category: "zagueiro" },
  { slug: "zag_20_sem_6", name: "O Inabalável da Defesa", description: "20 jogos seguidos sem nota < 6", category: "zagueiro" },
  { slug: "zag_10_com_7", name: "A Muralha Humana", description: "10 jogos seguidos com nota ≥ 7", category: "zagueiro" },
  { slug: "zag_beckenbauer", name: "Beckenbauer do Campos", description: "Média ≥ 7.5 + top 10 em gols/assistências atuando como zagueiro", category: "zagueiro" },

  // Presença
  { slug: "presenca_20", name: "Nunca Falta", description: "20 presenças seguidas", category: "presenca" },
  { slug: "presenca_50", name: "Vivo no Campo", description: "50 presenças", category: "presenca" },
  { slug: "presenca_100", name: "Morador da Terça", description: "100 presenças", category: "presenca" },
  { slug: "presenca_150", name: "Contrato Vitalício", description: "150 presenças", category: "presenca" },
  { slug: "presenca_200", name: "Se Me Procurar, Tô na Pelada", description: "200 presenças", category: "presenca" },

  // Notas
  { slug: "nota_media_6", name: "Regularzão", description: "Média ≥ 6.0", category: "notas" },
  { slug: "nota_media_7", name: "Batedor de Carteira", description: "Média ≥ 7.0", category: "notas" },
  { slug: "nota_10x8", name: "Craque do Jogo", description: "10 notas ≥ 8", category: "notas" },
  { slug: "nota_25x9", name: "Monstro Sagrado", description: "25 notas ≥ 9", category: "notas" },
  { slug: "nota_10", name: "Nota Messi", description: "Uma nota 10", category: "notas" },

  // Premiações semana/mês (contagem)
  { slug: "premio_craque_semana_1", name: "Craque da Semana", description: "1 vez craque da semana", category: "premios" },
  { slug: "premio_craque_semana_5", name: "Bicho Papão da Semana", description: "5 vezes craque da semana", category: "premios" },
  { slug: "premio_craque_mes_1", name: "Craque do Mês", description: "1 vez craque do mês", category: "premios" },
  { slug: "premio_craque_mes_3", name: "MVP Mensal", description: "3 vezes craque do mês", category: "premios" },
  { slug: "premio_craque_mes_10", name: "Rei das Terças", description: "10 prêmios mensais", category: "premios" },
  { slug: "premio_craque_mes_20", name: "O Messi da Resenha", description: "20 prêmios mensais", category: "premios" },
];

// Mapas de critérios simples que conseguimos calcular com os agregados atuais
const GOAL_THRESHOLDS = [
  { slug: "gols_10", min: 10 },
  { slug: "gols_25", min: 25 },
  { slug: "gols_50", min: 50 },
  { slug: "gols_75", min: 75 },
  { slug: "gols_100", min: 100 },
  { slug: "gols_150", min: 150 },
  { slug: "gols_250", min: 250 },
  { slug: "gols_500", min: 500 },
];

const ASSIST_THRESHOLDS = [
  { slug: "ast_10", min: 10 },
  { slug: "ast_25", min: 25 },
  { slug: "ast_50", min: 50 },
  { slug: "ast_75", min: 75 },
  { slug: "ast_100", min: 100 },
  { slug: "ast_150", min: 150 },
  { slug: "ast_200", min: 200 },
];

const PRESENCE_THRESHOLDS = [
  { slug: "presenca_20", min: 20 },
  { slug: "presenca_50", min: 50 },
  { slug: "presenca_100", min: 100 },
  { slug: "presenca_150", min: 150 },
  { slug: "presenca_200", min: 200 },
];

const NOTE_ACH = [
  { slug: "nota_media_6", minAvg: 6.0 },
  { slug: "nota_media_7", minAvg: 7.0 },
  { slug: "nota_10x8", count8: 10 },
  { slug: "nota_25x9", count9: 25 },
  { slug: "nota_10", has10: true },
];

const WEEKLY_THRESH = [
  { slug: "premio_craque_semana_1", min: 1 },
  { slug: "premio_craque_semana_5", min: 5 },
];

const MONTHLY_THRESH = [
  { slug: "premio_craque_mes_1", min: 1 },
  { slug: "premio_craque_mes_3", min: 3 },
  { slug: "premio_craque_mes_10", min: 10 },
  { slug: "premio_craque_mes_20", min: 20 },
];

async function upsertAchievements() {
  for (const ach of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { slug: ach.slug },
      update: {
        name: ach.name,
        description: ach.description,
        category: ach.category,
      },
      create: {
        slug: ach.slug,
        name: ach.name,
        description: ach.description,
        category: ach.category,
      },
    });
  }
}

async function assignSimpleAchievements() {
  // Carrega jogadores com stats (para notas) e totais
  const players = await prisma.player.findMany({
    include: {
      stats: {
        where: { rating: { not: null } },
        select: { rating: true },
      },
    },
  });

  // Contagem de prêmios semana/mês
  const weekly = await prisma.weeklyAward.groupBy({
    by: ["bestPlayerId"],
    _count: { bestPlayerId: true },
    where: { bestPlayerId: { not: null } },
  });
  const weeklyMap = new Map(weekly.map((w) => [w.bestPlayerId, w._count.bestPlayerId]));

  const monthly = await prisma.monthlyAward.groupBy({
    by: ["craqueId"],
    _count: { craqueId: true },
    where: { craqueId: { not: null } },
  });
  const monthlyMap = new Map(monthly.map((m) => [m.craqueId, m._count.craqueId]));

  for (const p of players) {
    const toAssign = new Set();

    // Gols
    GOAL_THRESHOLDS.forEach((t) => {
      if ((p.totalGoals || 0) >= t.min) toAssign.add(t.slug);
    });

    // Assistências
    ASSIST_THRESHOLDS.forEach((t) => {
      if ((p.totalAssists || 0) >= t.min) toAssign.add(t.slug);
    });

    // Presença (usa totalMatches)
    PRESENCE_THRESHOLDS.forEach((t) => {
      if ((p.totalMatches || 0) >= t.min) toAssign.add(t.slug);
    });

    // Notas
    const ratings = p.stats.map((s) => s.rating).filter((r) => r != null);
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const count8 = ratings.filter((r) => r >= 8).length;
    const count9 = ratings.filter((r) => r >= 9).length;
    const has10 = ratings.some((r) => r >= 10);

    if (avg >= 6) toAssign.add("nota_media_6");
    if (avg >= 7) toAssign.add("nota_media_7");
    if (count8 >= 10) toAssign.add("nota_10x8");
    if (count9 >= 25) toAssign.add("nota_25x9");
    if (has10) toAssign.add("nota_10");

    // Premiações semana/mês
    const wCount = weeklyMap.get(p.id) || 0;
    WEEKLY_THRESH.forEach((t) => {
      if (wCount >= t.min) toAssign.add(t.slug);
    });

    const mCount = monthlyMap.get(p.id) || 0;
    MONTHLY_THRESH.forEach((t) => {
      if (mCount >= t.min) toAssign.add(t.slug);
    });

    // Insere PlayerAchievement faltantes
    for (const slug of toAssign) {
      const achievement = await prisma.achievement.findUnique({ where: { slug } });
      if (!achievement) continue;
      await prisma.playerAchievement.upsert({
        where: {
          playerId_achievementId: {
            playerId: p.id,
            achievementId: achievement.id,
          },
        },
        update: {},
        create: {
          playerId: p.id,
          achievementId: achievement.id,
          unlockedAt: now,
        },
      });
    }
  }
}

async function main() {
  await upsertAchievements();
  await assignSimpleAchievements();
  console.log("Conquistas criadas e atribuídas (regras simples) concluídas.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

