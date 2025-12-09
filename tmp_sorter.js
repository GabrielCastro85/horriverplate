
  (() => {
    const matchId = 1;
    const form = document.getElementById("sorterForm");
    const resultsEl = document.getElementById("sorterResults");
    const statusEl = document.getElementById("sorterStatus");
    const shareBox = document.getElementById("sorterShare");
    const copyBtn = document.getElementById("copyTeamsBtn");
    const imgBtn = document.getElementById("imgTeamsBtn");
    const saveBtn = document.getElementById("saveTeamsBtn");
    const sortBtn = document.getElementById("sortBtn");
    const shareStatus = document.getElementById("shareStatus");
    const benchBox = document.getElementById("benchBox");
    const goalkeeperBenchBox = document.getElementById("goalkeeperBenchBox");
    const initialLineup = null;

    const guestName = document.getElementById("guestName");
    const guestPos = document.getElementById("guestPos");
    const guestStr = document.getElementById("guestStr");
    const guestsField = document.getElementById("guestsField");
    const guestList = document.getElementById("guestList");
    const addGuestBtn = document.getElementById("addGuestBtn");

    if (!form || !resultsEl) return;

    const matchDateLabel = new Date("2025-12-09T19:26:05.494Z").toLocaleDateString("pt-BR");

    const guests = [];

    function getPresentIdsFromForm() {
      return Array.from(document.querySelectorAll('input[name^="present_"]'))
        .filter((cb) => cb.checked)
        .map((cb) => cb.name.replace("present_", ""))
        .filter(Boolean);
    }

    function syncGuestsField() {
      const lines = guests.map((g) => `${g.name};${g.position};${g.strength}`);
      guestsField.value = lines.join("\n");
      guestList.innerHTML = guests
        .map(
          (g, idx) => `
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-horriver-border text-horriver-light">
              ${g.name} • ${g.position} • ${g.strength}
              <button type="button" data-remove="${idx}" class="text-horriver-orange hover:text-white">x</button>
            </span>
          `
        )
        .join("");
    }

    guestList.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-remove]");
      if (!btn) return;
      const idx = parseInt(btn.dataset.remove, 10);
      if (!Number.isNaN(idx)) {
        guests.splice(idx, 1);
        syncGuestsField();
      }
    });

    addGuestBtn?.addEventListener("click", () => {
      const name = (guestName.value || "Convidado").trim();
      const position = guestPos.value || "Outros";
      const strength = Math.max(40, Math.min(100, parseInt(guestStr.value || "60", 10) || 60));
      guests.push({ name, position, strength });
      guestName.value = "";
      guestStr.value = "60";
      syncGuestsField();
    });

    const teamColors = [
      { name: "Amarelo", value: "#facc15" },
      { name: "Azul", value: "#3b82f6" },
      { name: "Preto", value: "#18181b" },
      { name: "Vermelho", value: "#ef4444" },
      { name: "Branco", value: "#e5e7eb" },
    ];

    function renderTeams(teams, bench) {
      const goalkeepers = (bench || []).filter((p) => (p.position || "").toLowerCase().includes("goleiro"));
      const fieldBench = (bench || []).filter((p) => !(p.position || "").toLowerCase().includes("goleiro"));

      resultsEl.innerHTML = (teams || [])
        .map((t, idx) => {
          const players = Array.isArray(t.players) ? t.players : [];
          const power = players.reduce((sum, p) => sum + Number(p.strength || 0), 0);
          const selectedColor = t.colorName || teamColors[idx % teamColors.length].name;
          const selectedDef = teamColors.find((c) => c.name === selectedColor) || teamColors[0];
          return `
            <div class="border border-horriver-border/60 rounded-xl p-3 bg-black/30" data-team="${idx}" data-team-id="${idx}">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full" data-color-indicator style="background:${selectedDef.value}"></span>
                  <span data-team-name>${t.name}</span>
                </div>
                <div class="flex items-center gap-2">
                  <select data-color-select class="bg-horriver-dark border border-horriver-border rounded px-2 py-1 text-[11px] text-horriver-light">
                    ${teamColors
                      .map(
                        (c) => `<option value="${c.value}" ${c.name === selectedColor ? "selected" : ""}>${c.name}</option>`
                      )
                      .join("")}
                  </select>
                  <p class="text-horriver-light" data-team-power>Forca: ${power.toFixed(1)}</p>
                </div>
              </div>
              <ul class="space-y-1" data-team-list data-list-id="team-${idx}">
                ${players
                  .map(
                    (p) => `
                      <li
                        class="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1 text-horriver-light text-[12px]"
                        data-player-id="${p.id}"
                        data-player-strength="${p.strength}"
                        data-player-overall="${p.displayOverall ?? ""}"
                        data-player-position="${p.position}"
                        data-player-name="${p.name}"
                        data-player-nickname="${p.nickname || ""}"
                        data-player-guest="${p.guest ? "true" : "false"}"
                      >
                        <div class="flex flex-col">
                          <span>${p.name}${p.nickname ? " (" + p.nickname + ")" : ""}</span>
                          <span class="text-horriver-orange text-[11px]">${p.position || ""}</span>
                        </div>
                        <span class="text-horriver-gray">${Number(p.displayOverall ?? p.strength ?? 0).toFixed(1)}</span>
                      </li>
                    `
                  )
                  .join("")}
              </ul>
            </div>
          `;
        })
        .join("");

      // aplica cor escolhida no nome/indicador e habilita troca
      resultsEl.querySelectorAll("[data-team]").forEach((teamEl) => {
        const select = teamEl.querySelector("[data-color-select]");
        const indicator = teamEl.querySelector("[data-color-indicator]");
        const nameEl = teamEl.querySelector("[data-team-name]");
        if (!select) return;
        const applyColor = () => {
          if (indicator) indicator.style.background = select.value;
          if (nameEl) nameEl.style.color = select.value;
        };
        select.addEventListener("change", applyColor);
        applyColor();
      });

      const renderBenchList = (players, listId) =>
        players
          .map(
            (p) => `
              <li
                class="flex items-center justify-between bg-white/5 rounded-lg px-2 py-1 text-horriver-light text-[12px]"
                data-player-id="${p.id}"
                data-player-strength="${p.strength}"
                data-player-overall="${p.displayOverall ?? ""}"
                data-player-position="${p.position}"
                data-player-name="${p.name}"
                data-player-nickname="${p.nickname || ""}"
                data-player-guest="${p.guest ? "true" : "false"}"
                data-list-id="${listId}"
              >
                <div class="flex flex-col">
                  <span>${p.name}${p.nickname ? " (" + p.nickname + ")" : ""}</span>
                  <span class="text-horriver-orange text-[11px]">${p.position || ""}</span>
                </div>
                <span class="text-horriver-gray">${Number(p.displayOverall ?? p.strength ?? 0).toFixed(1)}</span>
              </li>
            `
          )
          .join("");

      if (goalkeeperBenchBox) {
        goalkeeperBenchBox.classList.remove("hidden");
        goalkeeperBenchBox.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <p class="text-horriver-orange font-semibold">Goleiros</p>
            <p class="text-horriver-light">${goalkeepers.length} jogador(es)</p>
          </div>
          <ul class="space-y-1 min-h-[12px]" data-list-id="goalkeeper-bench">
            ${renderBenchList(goalkeepers, "goalkeeper-bench")}
          </ul>
        `;
      }

      if (benchBox) {
        benchBox.classList.remove("hidden");
        benchBox.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <p class="text-horriver-orange font-semibold">Banco / Reservas</p>
            <p class="text-horriver-light">${fieldBench.length} jogador(es)</p>
          </div>
          <ul class="space-y-1 min-h-[12px]" data-list-id="bench">
            ${renderBenchList(fieldBench, "bench")}
          </ul>
        `;
      }
      recalculatePower();
      setupDragAndDrop();
    }

    function recalculatePower() {
      const teamBoxes = resultsEl.querySelectorAll("[data-team]");
      teamBoxes.forEach((box) => {
        const players = box.querySelectorAll("li[data-player-strength]");
        const total = Array.from(players).reduce((sum, li) => sum + parseFloat(li.dataset.playerStrength || "0"), 0);
        const powerEl = box.querySelector("[data-team-power]");
        if (powerEl) powerEl.textContent = `Forca: ${total.toFixed(1)}`;
      });

      if (goalkeeperBenchBox) {
        const gkCount = goalkeeperBenchBox.querySelectorAll("li[data-player-id]").length;
        const gkCountEl = goalkeeperBenchBox.querySelector(".text-horriver-light");
        if (gkCountEl) gkCountEl.textContent = `${gkCount} jogador(es)`;
      }

      if (benchBox) {
        const benchCount = benchBox.querySelectorAll("li[data-player-id]").length;
        const benchCountEl = benchBox.querySelector(".text-horriver-light");
        if (benchCountEl) benchCountEl.textContent = `${benchCount} jogador(es)`;
      }
    }

    function setupDragAndDrop() {
      const draggableItems = document.querySelectorAll(
        "#sorterResults li[data-player-id], #benchBox li[data-player-id], #goalkeeperBenchBox li[data-player-id]"
      );
      const lists = document.querySelectorAll("[data-team-list],[data-list-id]");
      let currentDragEl = null;

      draggableItems.forEach((li) => {
        li.setAttribute("draggable", "true");
        li.addEventListener("dragstart", (e) => {
          currentDragEl = li;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "moving");
        });
      });

      lists.forEach((list) => {
        list.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        list.addEventListener("drop", (e) => {
          e.preventDefault();
          if (!currentDragEl) return;
          list.appendChild(currentDragEl);
          currentDragEl = null;
          recalculatePower();
        });
      });
    }

    function buildLineupPayload() {
      const teams = Array.from(resultsEl.querySelectorAll("[data-team]"))
        .map((teamEl, idx) => {
          const colorSelect = teamEl.querySelector("[data-color-select]");
          const colorName =
            colorSelect?.options[colorSelect.selectedIndex]?.text || null;
          const colorValue = colorSelect?.value || null;
          const players = Array.from(teamEl.querySelectorAll("li[data-player-id]"))
            .map((li) => ({
              id: li.dataset.playerId,
              name: li.dataset.playerName || li.querySelector("span")?.textContent || "Jogador",
              nickname: li.dataset.playerNickname || null,
              position: li.dataset.playerPosition || "",
              strength: Number(li.dataset.playerStrength || 0),
              displayOverall: li.dataset.playerOverall ? Number(li.dataset.playerOverall) : null,
              guest: li.dataset.playerGuest === "true",
            }));
          const power = players.reduce((sum, p) => sum + (p.strength || 0), 0);
          return {
            name: teamEl.querySelector("[data-team-name]")?.textContent?.trim() || `Time ${idx + 1}` ,
            colorName,
            colorValue,
            power,
            players,
          };
        });

      const benchPlayers = [
        ...Array.from(goalkeeperBenchBox?.querySelectorAll("li[data-player-id]") || []).map((li) => ({
          id: li.dataset.playerId,
          name: li.dataset.playerName || li.querySelector("span")?.textContent || "Jogador",
          nickname: li.dataset.playerNickname || null,
          position: li.dataset.playerPosition || "",
          strength: Number(li.dataset.playerStrength || 0),
          displayOverall: li.dataset.playerOverall ? Number(li.dataset.playerOverall) : null,
          guest: li.dataset.playerGuest === "true",
        })),
        ...Array.from(benchBox?.querySelectorAll("li[data-player-id]") || []).map((li) => ({
          id: li.dataset.playerId,
          name: li.dataset.playerName || li.querySelector("span")?.textContent || "Jogador",
          nickname: li.dataset.playerNickname || null,
          position: li.dataset.playerPosition || "",
          strength: Number(li.dataset.playerStrength || 0),
          displayOverall: li.dataset.playerOverall ? Number(li.dataset.playerOverall) : null,
          guest: li.dataset.playerGuest === "true",
        })),
      ];

      return { teams, bench: benchPlayers };
    }

    async function persistLineup(source = "manual") {
      const payload = buildLineupPayload();
      if (!payload.teams.length) {
        if (shareStatus) shareStatus.textContent = "Sorteie os times antes de salvar.";
        return;
      }

      try {
        const resp = await fetch(`/admin/matches/${matchId}/save-lineup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, source }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error) throw new Error(data.error || "Erro ao salvar lineup.");
        if (shareStatus) shareStatus.textContent = "Times salvos para esta pelada.";
      } catch (err) {
        console.error(err);
        if (shareStatus) shareStatus.textContent = "Falha ao salvar os times.";
      }
    }

    if (initialLineup && Array.isArray(initialLineup.teams) && initialLineup.teams.length) {
      renderTeams(initialLineup.teams || [], initialLineup.bench || []);
      if (shareBox) shareBox.classList.remove("hidden");
      statusEl.textContent = "Times salvos carregados.";
    }

    async function handleSort(e) {
      if (e) e.preventDefault();
      statusEl.textContent = "Sorteando...";
      resultsEl.innerHTML = "";
      benchBox.classList.add("hidden");
      benchBox.innerHTML = "";
      if (goalkeeperBenchBox) {
        goalkeeperBenchBox.classList.add("hidden");
        goalkeeperBenchBox.innerHTML = "";
      }

      const presentIds = getPresentIdsFromForm();
      if (!presentIds.length) {
        statusEl.textContent = "Sorteando com os presentes já salvos (marque acima se quiser alterar).";
      }

      syncGuestsField();
      const payload = { guests: guestsField.value || "", presentIds };

      try {
        const resp = await fetch(`/admin/matches/${matchId}/sort-teams`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
          statusEl.textContent = data.error || "Erro ao sortear.";
          return;
        }

        renderTeams(data.teams || [], data.bench || []);
        statusEl.textContent = `Gerados ${data.teams?.length || 0} time(s). Ajuste e salve se precisar.`;
        if (shareBox) shareBox.classList.remove("hidden");
        await persistLineup("auto-sort");
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Erro inesperado ao sortear.";
      }
    }
    form.addEventListener("submit", handleSort);
    sortBtn?.addEventListener("click", handleSort);
    saveBtn?.addEventListener("click", () => {
      persistLineup("manual-save");
    });

    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const blocks = resultsEl.querySelectorAll("[data-team]");
        if (!blocks.length) return;
        let text = `Sorteio da pelada ${matchDateLabel}\n`;
        blocks.forEach((box) => {
          const name = box.querySelector("[data-team-name]")?.textContent || "Time";
          const lines = Array.from(box.querySelectorAll("li")).map((li) => {
            const spans = li.querySelectorAll("span");
            const nome = spans[0]?.textContent?.trim() || "";
            const pos = spans[1]?.textContent?.trim() || "";
            return `- ${nome}${pos ? " [" + pos + "]" : ""}`;
          });
          text += `\n${name}\n${lines.join("\n")}\n`;
        });
        const gkItems = goalkeeperBenchBox ? goalkeeperBenchBox.querySelectorAll("li") : [];
        if (gkItems.length) {
          text += "\nGoleiros\n";
          gkItems.forEach((li) => {
            const spans = li.querySelectorAll("span");
            const nome = spans[0]?.textContent?.trim() || "";
            const pos = spans[1]?.textContent?.trim() || "";
            text += `- ${nome}${pos ? " [" + pos + "]" : ""}\n`;
          });
        }

        const benchItems = benchBox.querySelectorAll("li");
        if (benchItems.length) {
          text += "\nBanco/Reservas\n";
          benchItems.forEach((li) => {
            const spans = li.querySelectorAll("span");
            const nome = spans[0]?.textContent?.trim() || "";
            const pos = spans[1]?.textContent?.trim() || "";
            text += `- ${nome}${pos ? " [" + pos + "]" : ""}\n`;
          });
        }
        try {
          navigator.clipboard.writeText(text);
          if (shareStatus) shareStatus.textContent = "Times copiados para a área de transferência.";
        } catch (err) {
          if (shareStatus) shareStatus.textContent = "Falha ao copiar. Copie manualmente.";
        }
      });
    }

    if (imgBtn) {
      imgBtn.addEventListener("click", async () => {
        shareStatus.textContent = "Gerando imagem...";
        try {
          if (typeof html2canvas === "undefined") {
            shareStatus.textContent = "html2canvas não carregado.";
            return;
          }
          const canvas = await html2canvas(resultsEl, { backgroundColor: "#0f0f0f", scale: 2 });
          const link = document.createElement("a");
          link.download = "times-sorteio.png";
          link.href = canvas.toDataURL("image/png");
          link.click();
          shareStatus.textContent = "Imagem baixada.";
        } catch (err) {
          console.error(err);
          shareStatus.textContent = "Erro ao gerar imagem.";
        }
      });
    }
  })();
