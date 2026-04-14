    ; 
  const {
    formatCurrencyBR,
    formatMonthYearLabel,
    formatDateInput,
    formatDateBR,
    formatDateTimeBR,
    getTransactionCategoryLabel,
    getPaymentMethodLabel,
    computeMonthlyFeeBalance,
  } = helpers;

  const noticeMessages = {
    "configuracoes-salvas": "Configurações financeiras salvas.",
    "jogador-salvo": "Participação financeira do jogador atualizada.",
    "mensalidades-geradas": "Mensalidades do mês geradas com sucesso.",
    "mensalidades-ja-existentes": "Nenhuma nova mensalidade foi criada; os registros já existiam.",
    "mensalidade-atualizada": "Mensalidade atualizada.",
    "pagamento-registrado": "Pagamento registrado e lançado no caixa.",
    "mensalidade-isenta": "Mensalidade marcada como isenta.",
    "caixa-criado": "Lançamento criado no caixa.",
    "caixa-atualizado": "Lançamento manual atualizado.",
    "caixa-excluido": "Lançamento manual excluído.",
    "convidado-criado": "Convidado registrado e lançado no caixa.",
    "convidado-atualizado": "Convidado atualizado.",
    "convidado-excluido": "Convidado excluído.",
  };

  const errorMessages = {
    configuracoes: "Não foi possível salvar as configurações agora.",
    "sem-jogadores-ativos": "Nenhum jogador está ativo no financeiro para gerar mensalidades.",
    mensalidades: "Não foi possível gerar as mensalidades.",
    "mensalidade-invalida": "Mensalidade inválida.",
    "mensalidade-nao-encontrada": "Mensalidade não encontrada.",
    "mensalidade-atualizar": "Não foi possível atualizar a mensalidade.",
    "pagamento-invalido": "Informe um valor de pagamento válido.",
    pagamento: "Não foi possível registrar o pagamento.",
    "mensalidade-isenta": "Não foi possível marcar a mensalidade como isenta.",
    categoria-caixa: "Escolha uma categoria compatível com o tipo de lançamento.",
    "valor-caixa": "Informe um valor válido para o caixa.",
    "caixa-criado": "Não foi possível criar o lançamento no caixa.",
    "caixa-invalido": "Lançamento inválido.",
    "caixa-bloqueado": "Esse lançamento é automático; edite pela origem dele.",
    "caixa-atualizado": "Não foi possível atualizar o lançamento.",
    "caixa-excluir": "Não foi possível excluir esse lançamento.",
    convidado: "Preencha nome e valor do convidado.",
    "convidado-invalido": "Convidado inválido.",
    "convidado-nao-encontrado": "Convidado não encontrado.",
    "convidado-atualizado": "Não foi possível atualizar o convidado.",
    "convidado-excluir": "Não foi possível excluir o convidado.",
  };

  const noticeText = filters.notice ? noticeMessages[filters.notice] || "Ação concluída." : "";
  const errorText = filters.error ? errorMessages[filters.error] || "Algo deu errado." : "";
  const toneClasses = {
    ok: "finance-status--ok",
    warning: "finance-status--warning",
    info: "finance-status--info",
    pending: "finance-status--pending",
  };
  const monthReferenceLabel = formatMonthYearLabel(filters.month, filters.year);

  function escapeAttr(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function stateFields(extra = {}) {
    const fields = {
      month: filters.month,
      year: filters.year,
      status: filters.status,
      search: filters.search,
      cashType: filters.cashType,
      ...extra,
    };

    return Object.entries(fields)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([name, value]) => `<input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(value)}">`)
      .join("");
  }

  function financeStatusClass(meta) {
    return toneClasses[meta?.tone] || "finance-status--pending";
  }

  function buildFinanceQuery(extra = {}) {
    const params = new URLSearchParams();
    params.set("month", String(filters.month));
    params.set("year", String(filters.year));
    if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
    if (filters.search) params.set("search", filters.search);
    if (filters.cashType && filters.cashType !== "ALL") params.set("cashType", filters.cashType);
    Object.entries(extra).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    });
    return `/admin/finance?${params.toString()}`;
  }

    ; __line = 102
    ; __append("\n\n<style>\n  .finance-shell { display:flex; flex-direction:column; gap:1.5rem; }\n  .finance-panel { position:relative; overflow:hidden; border-radius:1.7rem; border:1px solid rgba(255,255,255,0.08); background:radial-gradient(circle at top left, rgba(255,122,26,0.08), transparent 28%), linear-gradient(180deg, rgba(20,20,24,0.76), rgba(8,8,12,0.9)); box-shadow:0 16px 40px rgba(0,0,0,0.26); }\n  .finance-panel::before { content:\"\"; position:absolute; inset:0 0 auto 0; height:1px; background:linear-gradient(90deg, rgba(255,122,26,0), rgba(255,122,26,0.42), rgba(255,122,26,0)); opacity:0.72; }\n  .finance-chip { display:inline-flex; align-items:center; gap:0.45rem; padding:0.3rem 0.7rem; border-radius:999px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:rgba(226,232,240,0.82); font-size:11px; line-height:1; }\n  .finance-chip--accent { border-color:rgba(255,122,26,0.26); background:rgba(255,122,26,0.12); color:#ffb685; }\n  .finance-card { border-radius:1.4rem; border:1px solid rgba(255,255,255,0.08); background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.14)), rgba(255,255,255,0.02); }\n  .finance-summary-card { border-radius:1.35rem; border:1px solid rgba(255,255,255,0.08); background:linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.16)), rgba(0,0,0,0.18); }\n  .finance-table { width:100%; border-collapse:collapse; }\n  .finance-table thead th { padding:0.85rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.08); color:rgba(226,232,240,0.64); font-size:11px; letter-spacing:0.16em; text-transform:uppercase; text-align:left; font-weight:600; }\n  .finance-table tbody td { padding:0.9rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); vertical-align:top; font-size:14px; color:rgba(248,250,252,0.9); }\n  .finance-table tbody tr:last-child td { border-bottom:0; }\n  .finance-row-muted { font-size:12px; color:rgba(203,213,225,0.72); }\n  .finance-status { display:inline-flex; align-items:center; gap:0.4rem; padding:0.25rem 0.6rem; border-radius:999px; border:1px solid rgba(255,255,255,0.12); font-size:11px; line-height:1; white-space:nowrap; }\n  .finance-status::before { content:\"\"; width:0.45rem; height:0.45rem; border-radius:999px; background:currentColor; opacity:0.85; }\n  .finance-status--ok { color:#86efac; border-color:rgba(16,185,129,0.4); background:rgba(16,185,129,0.12); }\n  .finance-status--warning { color:#fcd34d; border-color:rgba(245,158,11,0.4); background:rgba(245,158,11,0.12); }\n  .finance-status--info { color:#93c5fd; border-color:rgba(59,130,246,0.36); background:rgba(59,130,246,0.12); }\n  .finance-status--pending { color:#cbd5e1; border-color:rgba(148,163,184,0.34); background:rgba(148,163,184,0.08); }\n  .finance-inline-actions { display:flex; flex-wrap:wrap; gap:0.45rem; }\n  .finance-scroll { overflow-x:auto; }\n  .finance-input, .finance-select, .finance-textarea { width:100%; border-radius:0.95rem; border:1px solid rgba(148,163,184,0.18); background:rgba(5,5,9,0.58); padding:0.75rem 0.95rem; color:#f8fafc; }\n  .finance-textarea { min-height:120px; resize:vertical; }\n  .finance-label { display:flex; flex-direction:column; gap:0.45rem; font-size:13px; color:rgba(203,213,225,0.82); }\n  .finance-subtle { font-size:12px; color:rgba(203,213,225,0.66); }\n  .finance-empty { border-radius:1rem; border:1px dashed rgba(148,163,184,0.2); padding:1rem; color:rgba(203,213,225,0.72); font-size:13px; }\n  .finance-alert { border-radius:1rem; padding:0.85rem 1rem; font-size:13px; }\n  .finance-alert--ok { border:1px solid rgba(16,185,129,0.35); background:rgba(16,185,129,0.1); color:#bbf7d0; }\n  .finance-alert--error { border:1px solid rgba(239,68,68,0.35); background:rgba(239,68,68,0.1); color:#fecaca; }\n  .finance-anchor-nav { display:flex; flex-wrap:wrap; gap:0.6rem; }\n  .finance-stat-card { border-radius:1.2rem; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); padding:0.95rem; }\n  .finance-aside-list { display:flex; flex-direction:column; gap:0.75rem; }\n  .finance-aside-item { border-radius:1rem; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); padding:0.85rem 0.95rem; }\n</style>\n\n<div class=\"finance-shell\">\n  <header class=\"finance-panel p-5 md:p-6 space-y-5\">\n    <div class=\"flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4\">\n      <div class=\"space-y-3\">\n        <span class=\"finance-chip finance-chip--accent\">Financeiro</span>\n        <div class=\"space-y-2\">\n          <h1 class=\"font-title text-3xl md:text-4xl text-horriver-light\">Caixa da pelada</h1>\n          <p class=\"max-w-3xl text-sm leading-relaxed text-horriver-gray/82\">Controle mensalidades, convidados, livro-caixa e cobrança por WhatsApp em um fluxo único, preparado para crescer com o site.</p>\n        </div>\n      </div>\n      <div class=\"flex flex-wrap items-center gap-2 text-xs\">\n        <a href=\"/admin\" class=\"px-3 py-1 rounded-full border border-horriver-border text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Voltar ao painel</a>\n      </div>\n    </div>\n\n    ")
    ; __line = 154
    ;  if (noticeText) { 
    ; __append("<div class=\"finance-alert finance-alert--ok\">")
    ; __append(escapeFn( noticeText ))
    ; __append("</div>")
    ;  } 
    ; __append("\n    ")
    ; __line = 155
    ;  if (errorText) { 
    ; __append("<div class=\"finance-alert finance-alert--error\">")
    ; __append(escapeFn( errorText ))
    ; __append("</div>")
    ;  } 
    ; __append("\n\n    <div class=\"finance-anchor-nav text-xs\">\n      <a href=\"#finance-settings\" class=\"finance-chip\">Configurações</a>\n      <a href=\"#finance-fees\" class=\"finance-chip\">Mensalidades</a>\n      <a href=\"#finance-cash\" class=\"finance-chip\">Caixa</a>\n      <a href=\"#finance-guests\" class=\"finance-chip\">Convidados</a>\n    </div>\n\n    <form method=\"GET\" action=\"/admin/finance\" class=\"finance-card p-4 md:p-5 space-y-4\">\n      <div class=\"flex flex-wrap gap-2 text-[11px]\">\n        <span class=\"finance-chip finance-chip--accent\">Filtro ativo</span>\n        <span class=\"finance-chip\">")
    ; __line = 167
    ; __append(escapeFn( monthReferenceLabel ))
    ; __append("</span>\n        <span class=\"finance-chip\">")
    ; __line = 168
    ; __append(escapeFn( filters.status === "ALL" ? "Todos os status" : filters.status ))
    ; __append("</span>\n        <span class=\"finance-chip\">")
    ; __line = 169
    ; __append(escapeFn( filters.cashType === "ALL" ? "Todas as movimentações" : filters.cashType === "INCOME" ? "Somente entradas" : "Somente saídas" ))
    ; __append("</span>\n      </div>\n\n      <div class=\"grid grid-cols-1 md:grid-cols-[0.8fr,0.8fr,0.9fr,0.95fr,0.85fr,auto] gap-3 items-end\">\n        <label class=\"finance-label\">Mês\n          <select name=\"month\" class=\"finance-select\">\n            ")
    ; __line = 175
    ;  monthOptions.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( Number(option.value) === Number(filters.month) ? "selected" : "" ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n          </select>\n        </label>\n        <label class=\"finance-label\">Ano\n          <select name=\"year\" class=\"finance-select\">\n            ")
    ; __line = 180
    ;  yearOptions.forEach((year) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( year ))
    ; __append("\" ")
    ; __append(escapeFn( Number(year) === Number(filters.year) ? "selected" : "" ))
    ; __append(">")
    ; __append(escapeFn( year ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n          </select>\n        </label>\n        <label class=\"finance-label\">Status da mensalidade\n          <select name=\"status\" class=\"finance-select\">\n            <option value=\"ALL\" ")
    ; __line = 185
    ; __append(escapeFn( filters.status === "ALL" ? "selected" : "" ))
    ; __append(">Todos</option>\n            <option value=\"PENDING\" ")
    ; __line = 186
    ; __append(escapeFn( filters.status === "PENDING" ? "selected" : "" ))
    ; __append(">Pendente</option>\n            <option value=\"PARTIAL\" ")
    ; __line = 187
    ; __append(escapeFn( filters.status === "PARTIAL" ? "selected" : "" ))
    ; __append(">Parcial</option>\n            <option value=\"PAID\" ")
    ; __line = 188
    ; __append(escapeFn( filters.status === "PAID" ? "selected" : "" ))
    ; __append(">Pago</option>\n            <option value=\"EXEMPT\" ")
    ; __line = 189
    ; __append(escapeFn( filters.status === "EXEMPT" ? "selected" : "" ))
    ; __append(">Isento</option>\n          </select>\n        </label>\n        <label class=\"finance-label\">Tipo de movimentação\n          <select name=\"cashType\" class=\"finance-select\">\n            <option value=\"ALL\" ")
    ; __line = 194
    ; __append(escapeFn( filters.cashType === "ALL" ? "selected" : "" ))
    ; __append(">Todas</option>\n            <option value=\"INCOME\" ")
    ; __line = 195
    ; __append(escapeFn( filters.cashType === "INCOME" ? "selected" : "" ))
    ; __append(">Entradas</option>\n            <option value=\"EXPENSE\" ")
    ; __line = 196
    ; __append(escapeFn( filters.cashType === "EXPENSE" ? "selected" : "" ))
    ; __append(">Saídas</option>\n          </select>\n        </label>\n        <label class=\"finance-label\">Buscar participante\n          <input type=\"search\" name=\"search\" value=\"")
    ; __line = 200
    ; __append(escapeFn( filters.search ))
    ; __append("\" placeholder=\"Nome ou apelido\" class=\"finance-input\" />\n        </label>\n        <div class=\"flex items-center gap-2\">\n          <button type=\"submit\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">Aplicar</button>\n          <a href=\"/admin/finance\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full border border-horriver-border text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Limpar</a>\n        </div>\n      </div>\n    </form>\n  </header>\n\n  <section class=\"grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3\">\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Previsto no mês</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 211
    ; __append(escapeFn( formatCurrencyBR(summary.totalPredicted) ))
    ; __append("</strong><p class=\"finance-subtle\">Mensalidades não isentas da competência.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Recebido no mês</span><strong class=\"block text-2xl text-horriver-orange font-semibold\">")
    ; __line = 212
    ; __append(escapeFn( formatCurrencyBR(summary.totalReceivedMonth) ))
    ; __append("</strong><p class=\"finance-subtle\">Entradas registradas no caixa no período.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Pendente</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 213
    ; __append(escapeFn( formatCurrencyBR(summary.totalPending) ))
    ; __append("</strong><p class=\"finance-subtle\">")
    ; __append(escapeFn( summary.delinquentCount ))
    ; __append(" participante(s) ainda em aberto.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Saldo atual do caixa</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 214
    ; __append(escapeFn( formatCurrencyBR(summary.cashBalance) ))
    ; __append("</strong><p class=\"finance-subtle\">Receitas menos despesas acumuladas.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Pagantes</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 215
    ; __append(escapeFn( summary.payersCount ))
    ; __append("</strong><p class=\"finance-subtle\">Mensalidades com algum pagamento no mês.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Gastos no mês</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 216
    ; __append(escapeFn( formatCurrencyBR(summary.totalExpensesMonth) ))
    ; __append("</strong><p class=\"finance-subtle\">Saídas lançadas no livro-caixa.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Ativos no financeiro</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 217
    ; __append(escapeFn( summary.activeFinancePlayers ))
    ; __append("</strong><p class=\"finance-subtle\">Mensalistas prontos para a próxima geração.</p></div>\n    <div class=\"finance-summary-card p-4 space-y-2\"><span class=\"text-[10px] uppercase tracking-[0.16em] text-horriver-gray/72\">Convidados no mês</span><strong class=\"block text-2xl text-horriver-light font-semibold\">")
    ; __line = 218
    ; __append(escapeFn( summary.guestsCount ))
    ; __append("</strong><p class=\"finance-subtle\">Registros avulsos vinculados ao caixa.</p></div>\n  </section>\n\n  <section id=\"finance-settings\" class=\"grid grid-cols-1 xl:grid-cols-[0.95fr,1.05fr] gap-4\">\n    <div class=\"finance-panel p-5 md:p-6 space-y-4\">\n      <div class=\"flex items-center justify-between gap-3\">\n        <div>\n          <h2 class=\"font-title text-2xl text-horriver-light\">Configurações</h2>\n          <p class=\"finance-subtle\">Base do financeiro usada na geração das mensalidades e na cobrança via WhatsApp.</p>\n        </div>\n        <span class=\"finance-chip\">Pix + mensagens</span>\n      </div>\n\n      <form method=\"POST\" action=\"/admin/finance/settings\" class=\"grid grid-cols-1 md:grid-cols-2 gap-3\">\n        ")
    ; __line = 232
    ; __append( stateFields() )
    ; __append("\n        <label class=\"finance-label\">Valor padrão da mensalidade<input type=\"text\" name=\"defaultMonthlyAmount\" value=\"")
    ; __line = 233
    ; __append(escapeFn( decimalToNumber(settings.defaultMonthlyAmount).toFixed(2).replace('.', ',') ))
    ; __append("\" class=\"finance-input\" /></label>\n        <label class=\"finance-label\">Dia do vencimento<input type=\"number\" name=\"dueDay\" min=\"1\" max=\"31\" value=\"")
    ; __line = 234
    ; __append(escapeFn( settings.dueDay ))
    ; __append("\" class=\"finance-input\" /></label>\n        <label class=\"finance-label md:col-span-2\">Chave Pix<input type=\"text\" name=\"pixKey\" value=\"")
    ; __line = 235
    ; __append(escapeFn( settings.pixKey || '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"exemplo@pix.com.br\" /></label>\n        <label class=\"finance-label md:col-span-2\">Nome do recebedor<input type=\"text\" name=\"pixReceiverName\" value=\"")
    ; __line = 236
    ; __append(escapeFn( settings.pixReceiverName || '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"Quem recebe o pagamento\" /></label>\n        <label class=\"finance-label md:col-span-2\">Mensagem padrão de cobrança no WhatsApp<textarea name=\"defaultWhatsappMessage\" class=\"finance-textarea\" placeholder=\"Use {name}, {amount}, {monthYear}, {pixKey}, {receiver}, {receiverLine}\">")
    ; __line = 237
    ; __append(escapeFn( settings.defaultWhatsappMessage || '' ))
    ; __append("</textarea><span class=\"finance-subtle\">Tokens disponíveis: <code>{name}</code>, <code>{amount}</code>, <code>{monthYear}</code>, <code>{pixKey}</code>, <code>{receiver}</code> e <code>{receiverLine}</code>.</span></label>\n        <div class=\"md:col-span-2 flex justify-end\"><button type=\"submit\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">Salvar configurações</button></div>\n      </form>\n    </div>\n\n    <div id=\"finance-members\" class=\"finance-panel p-5 md:p-6 space-y-4\">\n      <div class=\"flex items-center justify-between gap-3\">\n        <div>\n          <h2 class=\"font-title text-2xl text-horriver-light\">Participantes do financeiro</h2>\n          <p class=\"finance-subtle\">Defina quem entra nas próximas cobranças mensais.</p>\n        </div>\n        <span class=\"finance-chip\">")
    ; __line = 248
    ; __append(escapeFn( allPlayers.length ))
    ; __append(" jogadores</span>\n      </div>\n\n      <div class=\"finance-scroll max-h-[32rem]\">\n        <table class=\"finance-table\">\n          <thead><tr><th>Jogador</th><th>Posição</th><th>WhatsApp</th><th>Financeiro</th><th>Mensalista</th><th></th></tr></thead>\n          <tbody>\n            ")
    ; __line = 255
    ;  allPlayers.forEach((player) => { 
    ; __append("\n              <tr>\n                <td><div class=\"font-semibold text-horriver-light\">")
    ; __line = 257
    ; __append(escapeFn( player.name ))
    ; __append("</div>")
    ;  if (player.nickname) { 
    ; __append("<div class=\"finance-row-muted\">")
    ; __append(escapeFn( player.nickname ))
    ; __append("</div>")
    ;  } 
    ; __append("</td>\n                <td class=\"finance-row-muted\">")
    ; __line = 258
    ; __append(escapeFn( player.position ))
    ; __append("</td>\n                <td class=\"finance-row-muted\">")
    ; __line = 259
    ; __append(escapeFn( player.whatsapp || 'Sem WhatsApp' ))
    ; __append("</td>\n                <td colspan=\"3\">\n                  <form method=\"POST\" action=\"/admin/finance/players/")
    ; __line = 261
    ; __append(escapeFn( player.id ))
    ; __append("\" class=\"flex flex-wrap items-center gap-3\">\n                    ")
    ; __line = 262
    ; __append( stateFields() )
    ; __append("\n                    <label class=\"inline-flex items-center gap-2 text-sm\"><input type=\"checkbox\" name=\"financeActive\" ")
    ; __line = 263
    ; __append(escapeFn( player.financeActive ? 'checked' : '' ))
    ; __append(" /> <span>Ativo no financeiro</span></label>\n                    <label class=\"inline-flex items-center gap-2 text-sm\"><input type=\"checkbox\" name=\"isMonthlyMember\" ")
    ; __line = 264
    ; __append(escapeFn( player.isMonthlyMember ? 'checked' : '' ))
    ; __append(" /> <span>Mensalista</span></label>\n                    <button type=\"submit\" class=\"inline-flex items-center justify-center px-3 py-2 rounded-full border border-horriver-border text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition text-xs\">Salvar</button>\n                  </form>\n                </td>\n              </tr>\n            ")
    ; __line = 269
    ;  }) 
    ; __append("\n          </tbody>\n        </table>\n      </div>\n    </div>\n  </section>\n\n  ")
    ; __line = 276
    ;  const selectedFeeBalance = selectedFee ? computeMonthlyFeeBalance(selectedFee) : 0; 
    ; __append("\n  <section id=\"finance-fees\" class=\"grid grid-cols-1 xl:grid-cols-[1.35fr,0.65fr] gap-4\">\n    <div class=\"finance-panel p-5 md:p-6 space-y-4\">\n      <div class=\"flex flex-col md:flex-row md:items-start md:justify-between gap-4\">\n        <div class=\"space-y-2\">\n          <div class=\"flex items-center gap-2\">\n            <span class=\"finance-chip finance-chip--accent\">Mensalidades</span>\n            <span class=\"finance-chip\">")
    ; __line = 283
    ; __append(escapeFn( monthReferenceLabel ))
    ; __append("</span>\n          </div>\n          <h2 class=\"font-title text-2xl text-horriver-light\">Controle do mês</h2>\n          <p class=\"finance-subtle\">Gere a competência atual, acompanhe status e cobre apenas o saldo pendente de cada participante.</p>\n        </div>\n        <form method=\"POST\" action=\"/admin/finance/monthly-fees/generate\" class=\"flex items-center gap-2\">\n          ")
    ; __line = 289
    ; __append( stateFields() )
    ; __append("\n          <button type=\"submit\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">Gerar mensalidades do mês</button>\n        </form>\n      </div>\n\n      ")
    ; __line = 294
    ;  if (monthFees.length) { 
    ; __append("\n        <div class=\"finance-scroll\">\n          <table class=\"finance-table\">\n            <thead>\n              <tr>\n                <th>Participante</th>\n                <th>Status</th>\n                <th>Devido</th>\n                <th>Pago</th>\n                <th>Saldo</th>\n                <th>Vencimento</th>\n                <th>Pagamento</th>\n                <th>Forma</th>\n                <th>Ações</th>\n              </tr>\n            </thead>\n            <tbody>\n              ")
    ; __line = 311
    ;  monthFees.forEach((fee) => { 
    ; __append("\n                <tr>\n                  <td>\n                    <div class=\"font-semibold text-horriver-light\">")
    ; __line = 314
    ; __append(escapeFn( fee.player.name ))
    ; __append("</div>\n                    <div class=\"finance-row-muted\">")
    ; __line = 315
    ; __append(escapeFn( fee.player.position ))
    ;  if (fee.player.nickname) { 
    ; __append(" · ")
    ; __append(escapeFn( fee.player.nickname ))
    ;  } 
    ; __append("</div>\n                  </td>\n                  <td><span class=\"finance-status ")
    ; __line = 317
    ; __append(escapeFn( financeStatusClass(fee.statusMeta) ))
    ; __append("\">")
    ; __append(escapeFn( fee.statusMeta.label ))
    ; __append("</span></td>\n                  <td>")
    ; __line = 318
    ; __append(escapeFn( formatCurrencyBR(fee.amountDue) ))
    ; __append("</td>\n                  <td>")
    ; __line = 319
    ; __append(escapeFn( formatCurrencyBR(fee.amountPaid) ))
    ; __append("</td>\n                  <td class=\"")
    ; __line = 320
    ; __append(escapeFn( fee.balance > 0 ? 'text-[#fecaca]' : 'text-[#bbf7d0]' ))
    ; __append("\">")
    ; __append(escapeFn( formatCurrencyBR(fee.balance) ))
    ; __append("</td>\n                  <td>")
    ; __line = 321
    ; __append(escapeFn( formatDateBR(fee.dueDate) || '—' ))
    ; __append("</td>\n                  <td>")
    ; __line = 322
    ; __append(escapeFn( formatDateBR(fee.paidAt) || '—' ))
    ; __append("</td>\n                  <td class=\"finance-row-muted\">")
    ; __line = 323
    ; __append(escapeFn( getPaymentMethodLabel(fee.paymentMethod) ))
    ; __append("</td>\n                  <td>\n                    <div class=\"finance-inline-actions\">\n                      <a href=\"")
    ; __line = 326
    ; __append(escapeFn( buildFinanceQuery({ editFeeId: fee.id }) ))
    ; __append("#finance-fees\" class=\"px-3 py-2 rounded-full border border-horriver-border text-xs text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Editar</a>\n                      ")
    ; __line = 327
    ;  if (fee.whatsappUrl) { 
    ; __append("\n                        <a href=\"")
    ; __line = 328
    ; __append(escapeFn( fee.whatsappUrl ))
    ; __append("\" target=\"_blank\" rel=\"noopener\" class=\"px-3 py-2 rounded-full bg-horriver-orange text-black text-xs font-semibold hover:bg-orange-500 transition\">Cobrar</a>\n                      ")
    ; __line = 329
    ;  } else { 
    ; __append("\n                        <span class=\"px-3 py-2 rounded-full border border-white/10 text-xs text-horriver-gray/60\">Sem WhatsApp</span>\n                      ")
    ; __line = 331
    ;  } 
    ; __append("\n                    </div>\n                  </td>\n                </tr>\n              ")
    ; __line = 335
    ;  }) 
    ; __append("\n            </tbody>\n          </table>\n        </div>\n      ")
    ; __line = 339
    ;  } else { 
    ; __append("\n        <div class=\"finance-empty\">Nenhuma mensalidade encontrada para o filtro atual. Gere a competência do mês ou ajuste os filtros.</div>\n      ")
    ; __line = 341
    ;  } 
    ; __append("\n    </div>\n\n    <div class=\"space-y-4\">\n      <div class=\"finance-panel p-5 space-y-4\">\n        <div class=\"flex items-center justify-between gap-3\">\n          <div>\n            <h3 class=\"font-title text-xl text-horriver-light\">Editar mensalidade</h3>\n            <p class=\"finance-subtle\">Ajuste valor, vencimento, observações e registre pagamentos parciais.</p>\n          </div>\n          ")
    ; __line = 351
    ;  if (selectedFee) { 
    ; __append("\n            <a href=\"/admin/finance?month=")
    ; __line = 352
    ; __append(escapeFn( filters.month ))
    ; __append("&year=")
    ; __append(escapeFn( filters.year ))
    ; __append(escapeFn( filters.status !== 'ALL' ? `&status=${filters.status}` : '' ))
    ; __append(escapeFn( filters.search ? `&search=${encodeURIComponent(filters.search)}` : '' ))
    ; __append(escapeFn( filters.cashType !== 'ALL' ? `&cashType=${filters.cashType}` : '' ))
    ; __append("#finance-fees\" class=\"finance-chip\">Limpar seleção</a>\n          ")
    ; __line = 353
    ;  } 
    ; __append("\n        </div>\n\n        ")
    ; __line = 356
    ;  if (selectedFee) { 
    ; __append("\n          <div class=\"finance-card p-4 space-y-4\">\n            <div class=\"space-y-1\">\n              <div class=\"flex items-center justify-between gap-3\">\n                <div class=\"font-semibold text-horriver-light\">")
    ; __line = 360
    ; __append(escapeFn( selectedFee.player.name ))
    ; __append("</div>\n                ")
    ; __line = 361
    ;  const selectedMeta = getMonthlyFeeStatusMeta(selectedFee.status); 
    ; __append("\n                <span class=\"finance-status ")
    ; __line = 362
    ; __append(escapeFn( financeStatusClass(selectedMeta) ))
    ; __append("\">")
    ; __append(escapeFn( selectedMeta.label ))
    ; __append("</span>\n              </div>\n              <p class=\"finance-subtle\">")
    ; __line = 364
    ; __append(escapeFn( monthReferenceLabel ))
    ; __append(" · saldo atual <strong class=\"text-horriver-light\">")
    ; __append(escapeFn( formatCurrencyBR(selectedFeeBalance) ))
    ; __append("</strong></p>\n            </div>\n\n            <form method=\"POST\" action=\"/admin/finance/monthly-fees/")
    ; __line = 367
    ; __append(escapeFn( selectedFee.id ))
    ; __append("/update\" class=\"grid grid-cols-1 md:grid-cols-2 gap-3\">\n              ")
    ; __line = 368
    ; __append( stateFields({ editFeeId: selectedFee.id }) )
    ; __append("\n              <label class=\"finance-label\">Valor devido<input type=\"text\" name=\"amountDue\" value=\"")
    ; __line = 369
    ; __append(escapeFn( decimalToNumber(selectedFee.amountDue).toFixed(2).replace('.', ',') ))
    ; __append("\" class=\"finance-input\"></label>\n              <label class=\"finance-label\">Vencimento<input type=\"date\" name=\"dueDate\" value=\"")
    ; __line = 370
    ; __append(escapeFn( formatDateInput(selectedFee.dueDate) ))
    ; __append("\" class=\"finance-input\"></label>\n              <label class=\"finance-label\">Forma de pagamento padrão\n                <select name=\"paymentMethod\" class=\"finance-select\">\n                  <option value=\"\">Não definida</option>\n                  ")
    ; __line = 374
    ;  paymentMethodOptions.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( selectedFee.paymentMethod === option.value ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n                </select>\n              </label>\n              <label class=\"finance-label\">Ajuste especial\n                <span class=\"inline-flex items-center gap-2 text-sm mt-2\"><input type=\"checkbox\" name=\"isExempt\" ")
    ; __line = 378
    ; __append(escapeFn( selectedFee.status === 'EXEMPT' ? 'checked' : '' ))
    ; __append(" /> <span>Marcar como isento</span></span>\n              </label>\n              <label class=\"finance-label md:col-span-2\">Observação<textarea name=\"note\" class=\"finance-textarea\">")
    ; __line = 380
    ; __append(escapeFn( selectedFee.note || '' ))
    ; __append("</textarea></label>\n              <div class=\"md:col-span-2 flex justify-end\"><button type=\"submit\" class=\"inline-flex items-center justify-center px-4 py-3 rounded-full border border-horriver-border text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Salvar mensalidade</button></div>\n            </form>\n\n            <div class=\"border-t border-white/8 pt-4 space-y-3\">\n              <div>\n                <h4 class=\"font-semibold text-horriver-light\">Registrar pagamento</h4>\n                <p class=\"finance-subtle\">Cada pagamento lançado aqui cria automaticamente uma entrada no caixa.</p>\n              </div>\n              <form method=\"POST\" action=\"/admin/finance/monthly-fees/")
    ; __line = 389
    ; __append(escapeFn( selectedFee.id ))
    ; __append("/pay\" class=\"grid grid-cols-1 md:grid-cols-2 gap-3\">\n                ")
    ; __line = 390
    ; __append( stateFields({ editFeeId: selectedFee.id }) )
    ; __append("\n                <label class=\"finance-label\">Valor recebido<input type=\"text\" name=\"paymentAmount\" value=\"")
    ; __line = 391
    ; __append(escapeFn( selectedFeeBalance > 0 ? selectedFeeBalance.toFixed(2).replace('.', ',') : '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"0,00\"></label>\n                <label class=\"finance-label\">Data do pagamento<input type=\"date\" name=\"paidAt\" value=\"")
    ; __line = 392
    ; __append(escapeFn( formatDateInput(new Date()) ))
    ; __append("\" class=\"finance-input\"></label>\n                <label class=\"finance-label\">Forma de pagamento\n                  <select name=\"paymentMethod\" class=\"finance-select\">\n                    ")
    ; __line = 395
    ;  paymentMethodOptions.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( (selectedFee.paymentMethod || 'PIX') === option.value ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n                  </select>\n                </label>\n                <label class=\"finance-label\">Observação do lançamento<input type=\"text\" name=\"note\" class=\"finance-input\" placeholder=\"Pagamento parcial, acerto, Pix...\" /></label>\n                <div class=\"md:col-span-2 flex justify-end\"><button type=\"submit\" class=\"inline-flex items-center justify-center px-4 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">Registrar pagamento</button></div>\n              </form>\n\n              ")
    ; __line = 402
    ;  if (feeHistory.length) { 
    ; __append("\n                <div class=\"space-y-2\">\n                  <h4 class=\"font-semibold text-horriver-light\">Histórico recente do participante</h4>\n                  <div class=\"space-y-2\">\n                    ")
    ; __line = 406
    ;  feeHistory.forEach((item) => { const itemMeta = getMonthlyFeeStatusMeta(item.status); 
    ; __append("\n                      <div class=\"finance-stat-card flex items-center justify-between gap-3\">\n                        <div>\n                          <div class=\"font-medium text-horriver-light\">")
    ; __line = 409
    ; __append(escapeFn( formatMonthYearLabel(item.month, item.year) ))
    ; __append("</div>\n                          <div class=\"finance-subtle\">Pago: ")
    ; __line = 410
    ; __append(escapeFn( formatCurrencyBR(item.amountPaid) ))
    ; __append(" · Devido: ")
    ; __append(escapeFn( formatCurrencyBR(item.amountDue) ))
    ; __append("</div>\n                        </div>\n                        <span class=\"finance-status ")
    ; __line = 412
    ; __append(escapeFn( financeStatusClass(itemMeta) ))
    ; __append("\">")
    ; __append(escapeFn( itemMeta.label ))
    ; __append("</span>\n                      </div>\n                    ")
    ; __line = 414
    ;  }) 
    ; __append("\n                  </div>\n                </div>\n              ")
    ; __line = 417
    ;  } 
    ; __append("\n            </div>\n          </div>\n        ")
    ; __line = 420
    ;  } else { 
    ; __append("\n          <div class=\"finance-empty\">Escolha uma mensalidade na tabela para editar, registrar pagamentos parciais ou marcar isenção.</div>\n        ")
    ; __line = 422
    ;  } 
    ; __append("\n      </div>\n\n      <div class=\"finance-panel p-5 space-y-4\">\n        <div class=\"flex items-center justify-between gap-3\">\n          <div>\n            <h3 class=\"font-title text-xl text-horriver-light\">Pendentes do mês</h3>\n            <p class=\"finance-subtle\">Cobrança rápida para quem ainda tem saldo em aberto.</p>\n          </div>\n          <span class=\"finance-chip\">")
    ; __line = 431
    ; __append(escapeFn( pendingFees.length ))
    ; __append(" pendente(s)</span>\n        </div>\n\n        ")
    ; __line = 434
    ;  if (pendingFees.length) { 
    ; __append("\n          <div class=\"finance-aside-list\">\n            ")
    ; __line = 436
    ;  pendingFees.forEach((fee) => { const feeMeta = getMonthlyFeeStatusMeta(fee.status); 
    ; __append("\n              <div class=\"finance-aside-item space-y-2\">\n                <div class=\"flex items-center justify-between gap-2\">\n                  <div>\n                    <div class=\"font-medium text-horriver-light\">")
    ; __line = 440
    ; __append(escapeFn( fee.player.name ))
    ; __append("</div>\n                    <div class=\"finance-subtle\">")
    ; __line = 441
    ; __append(escapeFn( formatCurrencyBR(fee.balance) ))
    ; __append(" restante · ")
    ; __append(escapeFn( fee.player.whatsapp || 'sem WhatsApp' ))
    ; __append("</div>\n                  </div>\n                  <span class=\"finance-status ")
    ; __line = 443
    ; __append(escapeFn( financeStatusClass(feeMeta) ))
    ; __append("\">")
    ; __append(escapeFn( feeMeta.label ))
    ; __append("</span>\n                </div>\n                <div class=\"finance-inline-actions\">\n                  <a href=\"")
    ; __line = 446
    ; __append(escapeFn( buildFinanceQuery({ editFeeId: fee.id }) ))
    ; __append("#finance-fees\" class=\"px-3 py-2 rounded-full border border-horriver-border text-xs text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Abrir</a>\n                  ")
    ; __line = 447
    ;  if (fee.whatsappUrl) { 
    ; __append("<a href=\"")
    ; __append(escapeFn( fee.whatsappUrl ))
    ; __append("\" target=\"_blank\" rel=\"noopener\" class=\"px-3 py-2 rounded-full bg-horriver-orange text-black text-xs font-semibold hover:bg-orange-500 transition\">Cobrar</a>")
    ;  } 
    ; __append("\n                </div>\n              </div>\n            ")
    ; __line = 450
    ;  }) 
    ; __append("\n          </div>\n        ")
    ; __line = 452
    ;  } else { 
    ; __append("\n          <div class=\"finance-empty\">Nenhuma pendência encontrada neste período.</div>\n        ")
    ; __line = 454
    ;  } 
    ; __append("\n      </div>\n    </div>\n  </section>\n\n  ")
    ; __line = 459
    ;  const selectedTransactionCategories = selectedTransaction ? (transactionCategoryOptions[selectedTransaction.type] || []) : (transactionCategoryOptions.EXPENSE || []); 
    ; __append("\n  ")
    ; __line = 460
    ;  const selectedTransactionIsManual = selectedTransaction?.origin === 'MANUAL'; 
    ; __append("\n\n  <section id=\"finance-cash\" class=\"grid grid-cols-1 xl:grid-cols-[1.25fr,0.75fr] gap-4\">\n    <div class=\"finance-panel p-5 md:p-6 space-y-4\">\n      <div class=\"flex flex-col md:flex-row md:items-start md:justify-between gap-4\">\n        <div class=\"space-y-2\">\n          <div class=\"flex items-center gap-2\">\n            <span class=\"finance-chip finance-chip--accent\">Caixa</span>\n            <span class=\"finance-chip\">")
    ; __line = 468
    ; __append(escapeFn( filters.cashType === 'ALL' ? 'Extrato completo' : filters.cashType === 'INCOME' ? 'Somente entradas' : 'Somente saídas' ))
    ; __append("</span>\n          </div>\n          <h2 class=\"font-title text-2xl text-horriver-light\">Livro-caixa da pelada</h2>\n          <p class=\"finance-subtle\">Entradas automáticas de mensalidades e convidados aparecem aqui junto com as despesas manuais.</p>\n        </div>\n        <div class=\"finance-chip\">")
    ; __line = 473
    ; __append(escapeFn( monthTransactions.length ))
    ; __append(" lançamento(s)</div>\n      </div>\n\n      ")
    ; __line = 476
    ;  if (monthTransactions.length) { 
    ; __append("\n        <div class=\"finance-scroll\">\n          <table class=\"finance-table\">\n            <thead>\n              <tr>\n                <th>Data</th>\n                <th>Tipo</th>\n                <th>Categoria</th>\n                <th>Descrição</th>\n                <th>Origem</th>\n                <th>Valor</th>\n                <th>Ações</th>\n              </tr>\n            </thead>\n            <tbody>\n              ")
    ; __line = 491
    ;  monthTransactions.forEach((transaction) => { 
    ; __append("\n                <tr>\n                  <td>")
    ; __line = 493
    ; __append(escapeFn( formatDateBR(transaction.date) ))
    ; __append("</td>\n                  <td><span class=\"finance-status ")
    ; __line = 494
    ; __append(escapeFn( transaction.type === 'INCOME' ? 'finance-status--ok' : 'finance-status--warning' ))
    ; __append("\">")
    ; __append(escapeFn( transaction.type === 'INCOME' ? 'Entrada' : 'Saída' ))
    ; __append("</span></td>\n                  <td class=\"finance-row-muted\">")
    ; __line = 495
    ; __append(escapeFn( getTransactionCategoryLabel(transaction.category) ))
    ; __append("</td>\n                  <td>\n                    <div class=\"font-medium text-horriver-light\">")
    ; __line = 497
    ; __append(escapeFn( transaction.description ))
    ; __append("</div>\n                    ")
    ; __line = 498
    ;  if (transaction.player?.name) { 
    ; __append("<div class=\"finance-row-muted\">Participante: ")
    ; __append(escapeFn( transaction.player.name ))
    ; __append("</div>")
    ;  } 
    ; __append("\n                    ")
    ; __line = 499
    ;  if (transaction.guestPayment?.guestName) { 
    ; __append("<div class=\"finance-row-muted\">Convidado: ")
    ; __append(escapeFn( transaction.guestPayment.guestName ))
    ; __append("</div>")
    ;  } 
    ; __append("\n                  </td>\n                  <td class=\"finance-row-muted\">")
    ; __line = 501
    ; __append(escapeFn( transaction.origin === 'MANUAL' ? 'Manual' : transaction.origin === 'MONTHLY_FEE' ? 'Mensalidade' : 'Convidado' ))
    ; __append("</td>\n                  <td class=\"")
    ; __line = 502
    ; __append(escapeFn( transaction.type === 'INCOME' ? 'text-[#bbf7d0]' : 'text-[#fecaca]' ))
    ; __append("\">")
    ; __append(escapeFn( formatCurrencyBR(transaction.amount) ))
    ; __append("</td>\n                  <td>")
    ; __line = 503
    ;  if (transaction.origin === 'MANUAL') { 
    ; __append("<div class=\"finance-inline-actions\"><a href=\"")
    ; __append(escapeFn( buildFinanceQuery({ editTransactionId: transaction.id }) ))
    ; __append("#finance-cash\" class=\"px-3 py-2 rounded-full border border-horriver-border text-xs text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Editar</a></div>")
    ;  } else { 
    ; __append("<span class=\"finance-row-muted\">Automático</span>")
    ;  } 
    ; __append("</td>\n                </tr>\n              ")
    ; __line = 505
    ;  }) 
    ; __append("\n            </tbody>\n          </table>\n        </div>\n      ")
    ; __line = 509
    ;  } else { 
    ; __append("\n        <div class=\"finance-empty\">Nenhum lançamento encontrado para o filtro atual.</div>\n      ")
    ; __line = 511
    ;  } 
    ; __append("\n    </div>\n\n    <div class=\"finance-panel p-5 space-y-4\">\n      <div class=\"flex items-center justify-between gap-3\">\n        <div>\n          <h3 class=\"font-title text-xl text-horriver-light\">")
    ; __line = 517
    ; __append(escapeFn( selectedTransaction ? 'Editar lançamento manual' : 'Novo lançamento manual' ))
    ; __append("</h3>\n          <p class=\"finance-subtle\">Cadastre saídas como quadra, bola, colete ou entradas extras fora das mensalidades.</p>\n        </div>\n        ")
    ; __line = 520
    ;  if (selectedTransaction) { 
    ; __append("<a href=\"/admin/finance?month=")
    ; __append(escapeFn( filters.month ))
    ; __append("&year=")
    ; __append(escapeFn( filters.year ))
    ; __append(escapeFn( filters.status !== 'ALL' ? `&status=${filters.status}` : '' ))
    ; __append(escapeFn( filters.search ? `&search=${encodeURIComponent(filters.search)}` : '' ))
    ; __append(escapeFn( filters.cashType !== 'ALL' ? `&cashType=${filters.cashType}` : '' ))
    ; __append("#finance-cash\" class=\"finance-chip\">Novo</a>")
    ;  } 
    ; __append("\n      </div>\n\n      ")
    ; __line = 523
    ;  if (selectedTransaction && !selectedTransactionIsManual) { 
    ; __append("\n        <div class=\"finance-empty\">Esse lançamento foi gerado automaticamente por uma mensalidade ou convidado. Edite pela origem correspondente.</div>\n      ")
    ; __line = 525
    ;  } else { 
    ; __append("\n        <form method=\"POST\" action=\"")
    ; __line = 526
    ; __append(escapeFn( selectedTransaction ? `/admin/finance/cash-transactions/${selectedTransaction.id}/update` : '/admin/finance/cash-transactions' ))
    ; __append("\" class=\"grid grid-cols-1 gap-3\" data-finance-category-form>\n          ")
    ; __line = 527
    ; __append( stateFields(selectedTransaction ? { editTransactionId: selectedTransaction.id } : {}) )
    ; __append("\n          <label class=\"finance-label\">Tipo\n            <select name=\"type\" class=\"finance-select\" data-finance-type>\n              ")
    ; __line = 530
    ;  transactionTypeOptions.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( (selectedTransaction?.type || 'EXPENSE') === option.value ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n            </select>\n          </label>\n          <label class=\"finance-label\">Categoria\n            <select name=\"category\" class=\"finance-select\" data-finance-category>\n              ")
    ; __line = 535
    ;  selectedTransactionCategories.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( selectedTransaction?.category === option.value ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n            </select>\n          </label>\n          <label class=\"finance-label\">Valor<input type=\"text\" name=\"amount\" value=\"")
    ; __line = 538
    ; __append(escapeFn( selectedTransaction ? decimalToNumber(selectedTransaction.amount).toFixed(2).replace('.', ',') : '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"0,00\"></label>\n          <label class=\"finance-label\">Data<input type=\"date\" name=\"date\" value=\"")
    ; __line = 539
    ; __append(escapeFn( selectedTransaction ? formatDateInput(selectedTransaction.date) : formatDateInput(new Date()) ))
    ; __append("\" class=\"finance-input\"></label>\n          <label class=\"finance-label\">Descrição<input type=\"text\" name=\"description\" value=\"")
    ; __line = 540
    ; __append(escapeFn( selectedTransaction?.description || '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"Ex.: Quadra de abril\"></label>\n          <label class=\"finance-label\">Observação<textarea name=\"note\" class=\"finance-textarea\">")
    ; __line = 541
    ; __append(escapeFn( selectedTransaction?.note || '' ))
    ; __append("</textarea></label>\n          <div class=\"flex items-center justify-between gap-3\">\n            ")
    ; __line = 543
    ;  if (selectedTransaction) { 
    ; __append("\n              <button type=\"submit\" form=\"delete-cash-")
    ; __line = 544
    ; __append(escapeFn( selectedTransaction.id ))
    ; __append("\" class=\"px-4 py-3 rounded-full border border-red-400/35 text-red-200 hover:border-red-300 hover:text-white transition\">Excluir lançamento</button>\n            ")
    ; __line = 545
    ;  } else { 
    ; __append("\n              <span class=\"finance-subtle\">Lançamentos automáticos de mensalidade e convidado já entram aqui sozinhos.</span>\n            ")
    ; __line = 547
    ;  } 
    ; __append("\n            <button type=\"submit\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">")
    ; __line = 548
    ; __append(escapeFn( selectedTransaction ? 'Salvar alterações' : 'Criar lançamento' ))
    ; __append("</button>\n          </div>\n        </form>\n        ")
    ; __line = 551
    ;  if (selectedTransaction) { 
    ; __append("\n          <form id=\"delete-cash-")
    ; __line = 552
    ; __append(escapeFn( selectedTransaction.id ))
    ; __append("\" method=\"POST\" action=\"/admin/finance/cash-transactions/")
    ; __append(escapeFn( selectedTransaction.id ))
    ; __append("/delete\" class=\"hidden\">")
    ; __append( stateFields() )
    ; __append("</form>\n        ")
    ; __line = 553
    ;  } 
    ; __append("\n      ")
    ; __line = 554
    ;  } 
    ; __append("\n    </div>\n  </section>\n\n  <section id=\"finance-guests\" class=\"grid grid-cols-1 xl:grid-cols-[1.1fr,0.9fr] gap-4\">\n    <div class=\"finance-panel p-5 md:p-6 space-y-4\">\n      <div class=\"flex flex-col md:flex-row md:items-start md:justify-between gap-4\">\n        <div class=\"space-y-2\">\n          <div class=\"flex items-center gap-2\">\n            <span class=\"finance-chip finance-chip--accent\">Convidados</span>\n            <span class=\"finance-chip\">")
    ; __line = 564
    ; __append(escapeFn( guestPayments.length ))
    ; __append(" registro(s)</span>\n          </div>\n          <h2 class=\"font-title text-2xl text-horriver-light\">Pagamentos avulsos</h2>\n          <p class=\"finance-subtle\">Cada convidado salvo aqui gera automaticamente uma entrada correspondente no caixa.</p>\n        </div>\n      </div>\n\n      ")
    ; __line = 571
    ;  if (guestPayments.length) { 
    ; __append("\n        <div class=\"finance-scroll\">\n          <table class=\"finance-table\">\n            <thead>\n              <tr>\n                <th>Convidado</th>\n                <th>Data</th>\n                <th>Valor</th>\n                <th>Referência</th>\n                <th>Pelada</th>\n                <th>Ações</th>\n              </tr>\n            </thead>\n            <tbody>\n              ")
    ; __line = 585
    ;  guestPayments.forEach((guest) => { 
    ; __append("\n                <tr>\n                  <td><div class=\"font-medium text-horriver-light\">")
    ; __line = 587
    ; __append(escapeFn( guest.guestName ))
    ; __append("</div>")
    ;  if (guest.note) { 
    ; __append("<div class=\"finance-row-muted\">")
    ; __append(escapeFn( guest.note ))
    ; __append("</div>")
    ;  } 
    ; __append("</td>\n                  <td>")
    ; __line = 588
    ; __append(escapeFn( formatDateBR(guest.date) ))
    ; __append("</td>\n                  <td class=\"text-[#bbf7d0]\">")
    ; __line = 589
    ; __append(escapeFn( formatCurrencyBR(guest.amount) ))
    ; __append("</td>\n                  <td class=\"finance-row-muted\">")
    ; __line = 590
    ; __append(escapeFn( guest.month && guest.year ? formatMonthYearLabel(guest.month, guest.year) : 'Avulso' ))
    ; __append("</td>\n                  <td class=\"finance-row-muted\">")
    ; __line = 591
    ; __append(escapeFn( guest.match ? `${formatDateBR(guest.match.playedAt)}${guest.match.description ? ` · ${guest.match.description}` : ''}` : '—' ))
    ; __append("</td>\n                  <td><div class=\"finance-inline-actions\"><a href=\"")
    ; __line = 592
    ; __append(escapeFn( buildFinanceQuery({ editGuestId: guest.id }) ))
    ; __append("#finance-guests\" class=\"px-3 py-2 rounded-full border border-horriver-border text-xs text-horriver-light hover:border-horriver-orange hover:text-horriver-orange transition\">Editar</a></div></td>\n                </tr>\n              ")
    ; __line = 594
    ;  }) 
    ; __append("\n            </tbody>\n          </table>\n        </div>\n      ")
    ; __line = 598
    ;  } else { 
    ; __append("\n        <div class=\"finance-empty\">Nenhum convidado registrado neste período.</div>\n      ")
    ; __line = 600
    ;  } 
    ; __append("\n    </div>\n\n    <div class=\"finance-panel p-5 space-y-4\">\n      <div class=\"flex items-center justify-between gap-3\">\n        <div>\n          <h3 class=\"font-title text-xl text-horriver-light\">")
    ; __line = 606
    ; __append(escapeFn( selectedGuest ? 'Editar convidado' : 'Novo convidado pago' ))
    ; __append("</h3>\n          <p class=\"finance-subtle\">Use para entradas avulsas sem mensalidade fixa.</p>\n        </div>\n        ")
    ; __line = 609
    ;  if (selectedGuest) { 
    ; __append("<a href=\"/admin/finance?month=")
    ; __append(escapeFn( filters.month ))
    ; __append("&year=")
    ; __append(escapeFn( filters.year ))
    ; __append(escapeFn( filters.status !== 'ALL' ? `&status=${filters.status}` : '' ))
    ; __append(escapeFn( filters.search ? `&search=${encodeURIComponent(filters.search)}` : '' ))
    ; __append(escapeFn( filters.cashType !== 'ALL' ? `&cashType=${filters.cashType}` : '' ))
    ; __append("#finance-guests\" class=\"finance-chip\">Novo</a>")
    ;  } 
    ; __append("\n      </div>\n\n      <form method=\"POST\" action=\"")
    ; __line = 612
    ; __append(escapeFn( selectedGuest ? `/admin/finance/guest-payments/${selectedGuest.id}/update` : '/admin/finance/guest-payments' ))
    ; __append("\" class=\"grid grid-cols-1 md:grid-cols-2 gap-3\">\n        ")
    ; __line = 613
    ; __append( stateFields(selectedGuest ? { editGuestId: selectedGuest.id } : {}) )
    ; __append("\n        <label class=\"finance-label md:col-span-2\">Nome do convidado<input type=\"text\" name=\"guestName\" value=\"")
    ; __line = 614
    ; __append(escapeFn( selectedGuest?.guestName || '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"Ex.: João da resenha\"></label>\n        <label class=\"finance-label\">Data<input type=\"date\" name=\"date\" value=\"")
    ; __line = 615
    ; __append(escapeFn( selectedGuest ? formatDateInput(selectedGuest.date) : formatDateInput(new Date()) ))
    ; __append("\" class=\"finance-input\"></label>\n        <label class=\"finance-label\">Valor pago<input type=\"text\" name=\"amount\" value=\"")
    ; __line = 616
    ; __append(escapeFn( selectedGuest ? decimalToNumber(selectedGuest.amount).toFixed(2).replace('.', ',') : '' ))
    ; __append("\" class=\"finance-input\" placeholder=\"0,00\"></label>\n        <label class=\"finance-label\">Mês de referência\n          <select name=\"referenceMonth\" class=\"finance-select\">\n            <option value=\"\">Sem referência mensal</option>\n            ")
    ; __line = 620
    ;  monthOptions.forEach((option) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( option.value ))
    ; __append("\" ")
    ; __append(escapeFn( Number(selectedGuest?.month || filters.month) === Number(option.value) ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( option.label ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n          </select>\n        </label>\n        <label class=\"finance-label\">Ano de referência\n          <select name=\"referenceYear\" class=\"finance-select\">\n            <option value=\"\">Sem referência anual</option>\n            ")
    ; __line = 626
    ;  yearOptions.forEach((year) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( year ))
    ; __append("\" ")
    ; __append(escapeFn( Number(selectedGuest?.year || filters.year) === Number(year) ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( year ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n          </select>\n        </label>\n        <label class=\"finance-label md:col-span-2\">Pelada relacionada (opcional)\n          <select name=\"matchId\" class=\"finance-select\">\n            <option value=\"\">Sem pelada vinculada</option>\n            ")
    ; __line = 632
    ;  recentMatches.forEach((match) => { 
    ; __append("<option value=\"")
    ; __append(escapeFn( match.id ))
    ; __append("\" ")
    ; __append(escapeFn( Number(selectedGuest?.matchId || 0) === Number(match.id) ? 'selected' : '' ))
    ; __append(">")
    ; __append(escapeFn( formatDateBR(match.playedAt) ))
    ; __append(escapeFn( match.description ? ` · ${match.description}` : '' ))
    ; __append("</option>")
    ;  }) 
    ; __append("\n          </select>\n        </label>\n        <label class=\"finance-label md:col-span-2\">Observação<textarea name=\"note\" class=\"finance-textarea\">")
    ; __line = 635
    ; __append(escapeFn( selectedGuest?.note || '' ))
    ; __append("</textarea></label>\n        <div class=\"md:col-span-2 flex items-center justify-between gap-3\">\n          ")
    ; __line = 637
    ;  if (selectedGuest) { 
    ; __append("\n            <button type=\"submit\" form=\"delete-guest-")
    ; __line = 638
    ; __append(escapeFn( selectedGuest.id ))
    ; __append("\" class=\"px-4 py-3 rounded-full border border-red-400/35 text-red-200 hover:border-red-300 hover:text-white transition\">Excluir convidado</button>\n          ")
    ; __line = 639
    ;  } else { 
    ; __append("\n            <span class=\"finance-subtle\">Ao salvar, uma entrada de convidado será lançada no caixa automaticamente.</span>\n          ")
    ; __line = 641
    ;  } 
    ; __append("\n          <button type=\"submit\" class=\"inline-flex items-center justify-center px-5 py-3 rounded-full bg-horriver-orange text-black font-semibold hover:bg-orange-500 transition\">")
    ; __line = 642
    ; __append(escapeFn( selectedGuest ? 'Salvar convidado' : 'Registrar convidado' ))
    ; __append("</button>\n        </div>\n      </form>\n      ")
    ; __line = 645
    ;  if (selectedGuest) { 
    ; __append("<form id=\"delete-guest-")
    ; __append(escapeFn( selectedGuest.id ))
    ; __append("\" method=\"POST\" action=\"/admin/finance/guest-payments/")
    ; __append(escapeFn( selectedGuest.id ))
    ; __append("/delete\" class=\"hidden\">")
    ; __append( stateFields() )
    ; __append("</form>")
    ;  } 
    ; __append("\n    </div>\n  </section>\n</div>\n\n<script>\n  (() => {\n    const categoryMap = ")
    ; __line = 652
    ; __append( JSON.stringify(transactionCategoryOptions) )
    ; __append(";\n    document.querySelectorAll(\"[data-finance-category-form]\").forEach((form) => {\n      const typeSelect = form.querySelector(\"[data-finance-type]\");\n      const categorySelect = form.querySelector(\"[data-finance-category]\");\n      if (!typeSelect || !categorySelect) return;\n\n      const syncCategories = () => {\n        const selectedType = typeSelect.value || \"EXPENSE\";\n        const options = categoryMap[selectedType] || [];\n        const currentValue = categorySelect.value;\n        categorySelect.innerHTML = options.map((option) => `<option value=\"${option.value}\">${option.label}</option>`).join(\"\");\n        if (options.some((option) => option.value === currentValue)) {\n          categorySelect.value = currentValue;\n        }\n      };\n\n      syncCategories();\n      typeSelect.addEventListener(\"change\", syncCategories);\n    });\n  })();\n</script>\n")
    ; __line = 673
