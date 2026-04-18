"use strict";

(() => {
  const config = window.ADMIN_FINANCE_CONFIG || {};
  const categoryMap = config.categoryMap || {};
  const participantTypeToneMap = config.participantTypeMeta || {};
  const defaultMonthlyAmount = Number(config.defaultMonthlyAmount || 0);
  const latePerMatchAmount = Number(config.latePerMatchAmount || 25);

  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const statusToneClassMap = {
    ok: "finance-status--ok",
    warning: "finance-status--warning",
    info: "finance-status--info",
    pending: "finance-status--pending",
    danger: "finance-status--danger",
  };

  function formatCurrency(value) {
    const parsed = Number(value || 0);
    return currencyFormatter.format(Number.isFinite(parsed) ? parsed : 0);
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.getAttribute("content") || "";
  }

  async function copyToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      console.warn("Clipboard API unavailable:", error);
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }

  function openWhatsappLinks(links) {
    links.forEach((href, index) => {
      window.setTimeout(() => {
        window.open(href, "_blank", "noopener");
      }, index * 220);
    });
  }

  function ensureToastStack() {
    let stack = document.querySelector(".finance-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "finance-toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(message, tone = "info") {
    const stack = ensureToastStack();
    const toast = document.createElement("div");
    toast.className = `finance-toast finance-toast--${tone}`;
    toast.textContent = message;
    stack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  function buildRequestParams(payload) {
    const params = new URLSearchParams();

    if (payload instanceof FormData) {
      payload.forEach((value, key) => {
        if (value == null || value === "") return;
        params.append(key, String(value));
      });
      return params;
    }

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item != null && item !== "") params.append(key, String(item));
        });
        return;
      }

      if (value == null || value === "") return;
      params.append(key, String(value));
    });

    return params;
  }

  async function postJson(url, payload) {
    const csrfToken = getCsrfToken();
    const requestPayload =
      payload instanceof FormData
        ? (() => {
            const formData = new FormData();
            payload.forEach((value, key) => {
              formData.append(key, value);
            });
            if (!formData.has("format")) formData.append("format", "json");
            if (csrfToken && !formData.has("_csrf")) formData.append("_csrf", csrfToken);
            return formData;
          })()
        : {
            ...(payload || {}),
            format: "json",
            ...(csrfToken ? { _csrf: csrfToken } : {}),
          };

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    };

    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    let response;

    try {
      response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: buildRequestParams(requestPayload).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("A requisicao demorou demais e foi cancelada. Tente novamente.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    console.debug("[finance] POST", url, {
      status: response.status,
      ok: response.ok,
      payload: requestPayload instanceof FormData ? Array.from(requestPayload.entries()) : requestPayload,
    });

    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      const fallbackMessage = response.status === 403
        ? "A requisicao foi bloqueada pelo servidor (403)."
        : `Resposta invalida do servidor (${response.status}).`;
      data = {
        ok: false,
        message: fallbackMessage,
        rawResponse: responseText,
      };
    }

    if (!response.ok || data.ok === false) {
      console.error("[finance] Falha no POST", url, {
        status: response.status,
        ok: response.ok,
        response: data,
      });
      throw new Error(data.message || "Nao foi possivel concluir a acao.");
    }

    return data;
  }

  function withLoadingState(node, loadingText, callback) {
    const originalText = node.textContent;
    node.classList.add("finance-is-loading");
    if (loadingText) node.textContent = loadingText;

    return Promise.resolve()
      .then(callback)
      .finally(() => {
        node.classList.remove("finance-is-loading");
        node.textContent = originalText;
      });
  }

  function applyStatusAppearance(node, tone, label) {
    if (!node) return;
    Object.values(statusToneClassMap).forEach((className) => node.classList.remove(className));
    node.classList.add(statusToneClassMap[tone] || statusToneClassMap.pending);
    node.textContent = label;
  }

  function updateBalanceAppearance(node, value) {
    if (!node) return;
    node.textContent = formatCurrency(value);
    node.classList.remove("finance-balance--pending", "finance-balance--ok");
    node.classList.add(Number(value || 0) > 0 ? "finance-balance--pending" : "finance-balance--ok");
  }

  function updateFeeNodes(feeId, updatedFee) {
    if (!feeId || !updatedFee) return;
    const selectors = [`[data-fee-id="${feeId}"]`, `[data-fee-detail-panel="${feeId}"]`];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((root) => {
        root.setAttribute("data-balance-value", String(Number(updatedFee.balance || 0)));
        root.setAttribute("data-amount-paid", String(Number(updatedFee.amountPaid || 0)));
        root.setAttribute("data-monthly-status", updatedFee.status || "");

        applyStatusAppearance(root.querySelector("[data-fee-status]"), updatedFee.statusTone, updatedFee.statusLabel);

        const paidNode = root.querySelector("[data-fee-paid]");
        if (paidNode) paidNode.textContent = formatCurrency(updatedFee.amountPaid);

        const dueNode = root.querySelector("[data-fee-due]");
        if (dueNode) dueNode.textContent = formatCurrency(updatedFee.amountDue);

        updateBalanceAppearance(root.querySelector("[data-fee-balance]"), updatedFee.balance);

        const isSettled = Number(updatedFee.balance || 0) <= 0;
        root.querySelectorAll("[data-hide-on-paid]").forEach((button) => {
          button.style.display = isSettled ? "none" : "";
        });
        root.classList.toggle("finance-charge-item--settled", isSettled);

        root.querySelectorAll("[data-quick-pay-button]").forEach((button) => {
          const unitAmount = Number(
            String(button.getAttribute("data-unit-amount") || "").replace(/\./g, "").replace(",", ".")
          );
          const nextAmount = Number.isFinite(unitAmount) && unitAmount > 0
            ? Math.min(Number(updatedFee.balance || 0), unitAmount)
            : Number(updatedFee.balance || 0);

          if (nextAmount > 0) {
            button.setAttribute("data-amount", nextAmount.toFixed(2).replace(".", ","));
            button.style.display = "";
          } else if (button.hasAttribute("data-hide-on-paid")) {
            button.style.display = "none";
          }
        });

        const checkbox = root.querySelector("[data-charge-select]");
        if (checkbox && checkbox.checked) {
          checkbox.checked = false;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
  }

  function refreshMemberCardPresentation(form) {
    const participantType = form.querySelector("[name='financeParticipantType']")?.value || "MONTHLY";
    const participantMeta = participantTypeToneMap[participantType] || participantTypeToneMap.MONTHLY;
    const badge = form.querySelector("[data-member-type-badge]");

    if (badge) {
      applyStatusAppearance(badge, participantMeta.tone, participantMeta.label);
    }

    const amountBadge = form.querySelector("[data-member-amount-badge]");
    if (amountBadge) {
      const overrideValue = form.querySelector("[name='financeAmountOverride']")?.value?.trim();
      const defaultAmount = form.getAttribute("data-default-amount") || "0,00";

      if (participantType === "GUEST") {
        amountBadge.textContent = "Avulso";
      } else if (participantType === "PER_MATCH") {
        amountBadge.textContent = `${formatCurrency(latePerMatchAmount)} / pelada`;
      } else if (participantType === "EXEMPT") {
        amountBadge.textContent = formatCurrency(0);
      } else if (participantType === "MONTHLY") {
        amountBadge.textContent = formatCurrency(defaultMonthlyAmount);
      } else {
        const normalized = (overrideValue || defaultAmount).replace(/\./g, "").replace(",", ".");
        amountBadge.textContent = formatCurrency(Number(normalized));
      }
    }
  }

  function initCategoryForms() {
    document.querySelectorAll("[data-finance-category-form]").forEach((form) => {
      const typeSelect = form.querySelector("[data-finance-type]");
      const categorySelect = form.querySelector("[data-finance-category]");
      if (!typeSelect || !categorySelect) return;

      const syncCategories = () => {
        const available = categoryMap[typeSelect.value] || [];
        const currentValue = categorySelect.value;
        categorySelect.innerHTML = available
          .map((option) => `<option value="${option.value}">${option.label}</option>`)
          .join("");

        if (available.some((option) => option.value === currentValue)) {
          categorySelect.value = currentValue;
        }
      };

      typeSelect.addEventListener("change", syncCategories);
      syncCategories();
    });
  }

  function initCopyButtons() {
    document.querySelectorAll("[data-copy-target]").forEach((button) => {
      const originalText = button.textContent;

      button.addEventListener("click", async () => {
        const targetSelector = button.getAttribute("data-copy-target");
        const target = targetSelector ? document.querySelector(targetSelector) : null;
        const text = target?.value || target?.textContent || "";
        const copied = await copyToClipboard(text);

        if (copied) {
          button.textContent = "Copiado";
          window.setTimeout(() => {
            button.textContent = originalText;
          }, 1400);
        }
      });
    });
  }

  function initAsyncPlayerForms() {
    document.querySelectorAll("[data-async-player-form]").forEach((form) => {
      const participantTypeSelect = form.querySelector("[name='financeParticipantType']");
      if (participantTypeSelect) {
        participantTypeSelect.addEventListener("change", () => refreshMemberCardPresentation(form));
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector("button[type='submit']");
        if (!submitButton) return;

        await withLoadingState(submitButton, "Salvando...", async () => {
          try {
            const response = await postJson(form.action, new FormData(form));
            refreshMemberCardPresentation(form);
            showToast(response.message || "Regra do participante atualizada.", "success");
          } catch (error) {
            showToast(error.message, "error");
          }
        });
      });

      refreshMemberCardPresentation(form);
    });
  }

  function initFillPaymentButtons() {
    document.querySelectorAll("[data-fill-payment]").forEach((button) => {
      button.addEventListener("click", () => {
        const panel = button.closest(".finance-fee-detail");
        const input = panel?.querySelector("[data-payment-input]");
        if (input) input.value = button.getAttribute("data-fill-payment") || "";
      });
    });

    document.querySelectorAll("[data-fill-payment-date]").forEach((button) => {
      button.addEventListener("click", () => {
        const panel = button.closest(".finance-fee-detail");
        const input = panel?.querySelector("[data-payment-date-input]");
        if (input) input.value = button.getAttribute("data-fill-payment-date") || "";
      });
    });
  }

  function initQuickPayButtons() {
    document.querySelectorAll("[data-quick-pay-button]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const endpoint = button.getAttribute("data-endpoint");
        if (!endpoint) return;

        const feeIdMatch = endpoint.match(/monthly-fees\/(\d+)\/pay/);
        const feeId = feeIdMatch ? feeIdMatch[1] : "";

        await withLoadingState(button, "Salvando...", async () => {
          try {
            const response = await postJson(endpoint, {
              paymentAmount: button.getAttribute("data-amount") || "",
              paymentMethod: button.getAttribute("data-payment-method") || "PIX",
              paidAt: button.getAttribute("data-paid-at") || "",
              note: button.getAttribute("data-note") || "",
              paymentScope: "custom",
            });

            if (response.updatedFee) {
              updateFeeNodes(feeId, response.updatedFee);
            }

            showToast(
              button.getAttribute("data-success-message") || response.message || "Pagamento registrado.",
              "success"
            );
          } catch (error) {
            showToast(error.message, "error");
          }
        });
      });
    });
  }

  function initConfirmActions() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-confirm]");
      if (!trigger) return;
      const message = trigger.getAttribute("data-confirm") || "Tem certeza?";
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  function initChargeBulkRoots() {
    document.querySelectorAll("[data-charge-bulk-root]").forEach((root) => {
      const itemNodes = Array.from(root.querySelectorAll("[data-charge-item]"));
      if (!itemNodes.length) return;

      const getSelectedItems = () =>
        itemNodes
          .map(getItemData)
          .filter((item) => item.checkbox?.checked && item.feeId);

      const getItemData = (itemNode) => ({
        node: itemNode,
        checkbox: itemNode.querySelector("[data-charge-select]"),
        feeId: itemNode.getAttribute("data-fee-id") || "",
        name: itemNode.getAttribute("data-player-name") || "Jogador",
        balanceLabel: itemNode.getAttribute("data-balance-label") || "",
        balanceValue: Number(itemNode.getAttribute("data-balance-value") || 0),
        amountPaid: Number(itemNode.getAttribute("data-amount-paid") || 0),
        monthlyStatus: itemNode.getAttribute("data-monthly-status") || "",
        message: itemNode.getAttribute("data-message") || "",
        whatsappUrl: itemNode.getAttribute("data-whatsapp-url") || "",
      });

      const previewMode = root.querySelector("[data-bulk-preview-mode]");
      const selectionCount = root.querySelector("[data-charge-selection-count]");
      const selectionNote = root.querySelector("[data-charge-selection-note]");
      const hiddenIdsWraps = Array.from(root.querySelectorAll("[data-bulk-selected-ids]"));
      const previewTextarea = root.querySelector("[data-bulk-preview-textarea]");
      const previewLinks = root.querySelector("[data-bulk-preview-links]");
      const checkAll = root.querySelector("[data-charge-check-all]");
      const markPaidButton = root.querySelector("[data-charge-mark-paid]");
      const markPendingButton = root.querySelector("[data-charge-mark-pending]");
      const hasPreview = Boolean(previewTextarea || previewLinks || previewMode);

      const buildBundle = (items) =>
        items
          .filter((item) => item.message)
          .map((item, index) => `${index + 1}. ${item.name} - ${item.balanceLabel}\n${item.message}`)
          .join("\n\n----------------\n\n");

      const renderLinks = (items) => {
        if (!previewLinks) return;
        previewLinks.innerHTML = "";
        const withWhatsapp = items.filter((item) => item.whatsappUrl);

        if (!withWhatsapp.length) {
          const empty = document.createElement("div");
          empty.className = "finance-subtle";
          empty.textContent = "Nenhum WhatsApp disponivel neste conjunto.";
          previewLinks.appendChild(empty);
          return;
        }

        withWhatsapp.forEach((item) => {
          const link = document.createElement("a");
          link.href = item.whatsappUrl;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = item.name;
          previewLinks.appendChild(link);
        });
      };

      const syncSelection = () => {
        const allItems = itemNodes.map(getItemData);
        const selectedItems = getSelectedItems();
        const previewItems = selectedItems.length ? selectedItems : allItems;
        const payableItems = selectedItems.filter((item) => item.balanceValue > 0);
        const revertibleItems = selectedItems.filter(
          (item) => item.amountPaid > 0 && item.monthlyStatus !== "EXEMPT"
        );

        itemNodes.forEach((node) => {
          const checkbox = node.querySelector("[data-charge-select]");
          node.classList.toggle("finance-charge-item--selected", Boolean(checkbox?.checked));
        });

        if (selectionCount) {
          selectionCount.textContent = `${selectedItems.length} selecionada(s)`;
        }

        if (selectionNote) {
          selectionNote.textContent = selectedItems.length
            ? `As acoes em massa vao considerar apenas as linhas selecionadas. ${payableItems.length} podem ser quitadas e ${revertibleItems.length} podem voltar para pendente.`
            : hasPreview
              ? "Sem selecao: o preview abaixo considera toda a fila com mensagem pronta."
              : "Use a selecao em massa para atualizar o status das mensalidades sem navegar linha por linha.";
        }

        if (previewMode) {
          previewMode.textContent = selectedItems.length
            ? `Preview atual: ${selectedItems.length} cobranca(s) selecionada(s).`
            : "Sem selecao: o preview abaixo considera toda a fila com mensagem pronta.";
        }

        hiddenIdsWraps.forEach((hiddenIdsWrap) => {
          hiddenIdsWrap.innerHTML = selectedItems
            .map((item) => `<input type="hidden" name="feeIds" value="${item.feeId}">`)
            .join("");
        });

        if (previewTextarea) {
          previewTextarea.value = buildBundle(previewItems);
        }

        renderLinks(previewItems);

        if (markPaidButton) {
          markPaidButton.disabled = payableItems.length === 0;
        }

        if (markPendingButton) {
          markPendingButton.disabled = revertibleItems.length === 0;
        }

        if (checkAll) {
          checkAll.checked = selectedItems.length > 0 && selectedItems.length === allItems.length;
          checkAll.indeterminate = selectedItems.length > 0 && selectedItems.length < allItems.length;
        }
      };

      itemNodes.forEach((itemNode) => {
        const checkbox = itemNode.querySelector("[data-charge-select]");
        if (checkbox) {
          checkbox.addEventListener("change", syncSelection);
        }

        const copyButton = itemNode.querySelector("[data-copy-charge-message]");
        if (copyButton) {
          copyButton.addEventListener("click", async () => {
            const item = getItemData(itemNode);
            const copied = await copyToClipboard(item.message);
            if (copied) {
              const original = copyButton.textContent;
              copyButton.textContent = "Copiado";
              window.setTimeout(() => {
                copyButton.textContent = original;
              }, 1400);
            }
          });
        }
      });

      if (checkAll) {
        checkAll.addEventListener("change", () => {
          itemNodes.forEach((itemNode) => {
            const checkbox = itemNode.querySelector("[data-charge-select]");
            if (checkbox) checkbox.checked = checkAll.checked;
          });
          syncSelection();
        });
      }

      const maybeConfirmBulkOpen = () => {
        if (root.getAttribute("data-charge-behavior") === "MANUAL_ONLY") {
          return window.confirm("A cobranca esta em modo manual. Deseja mesmo abrir os links de WhatsApp em lote?");
        }
        return true;
      };

      const actions = {
        "[data-charge-copy-selected]": async () => {
          const items = itemNodes.map(getItemData).filter((item) => item.checkbox?.checked);
          const fallback = items.length ? items : itemNodes.map(getItemData);
          await copyToClipboard(buildBundle(fallback));
          showToast("Mensagens copiadas.", "success");
        },
        "[data-charge-copy-all]": async () => {
          const items = itemNodes.map(getItemData).filter((item) => item.whatsappUrl);
          await copyToClipboard(buildBundle(items));
          showToast("Preview completo copiado.", "success");
        },
        "[data-charge-open-selected]": () => {
          if (!maybeConfirmBulkOpen()) return;
          const items = itemNodes.map(getItemData).filter((item) => item.checkbox?.checked && item.whatsappUrl);
          const fallback = items.length
            ? items
            : itemNodes.map(getItemData).filter((item) => item.whatsappUrl);
          openWhatsappLinks(fallback.map((item) => item.whatsappUrl));
        },
        "[data-charge-open-all]": () => {
          if (!maybeConfirmBulkOpen()) return;
          const items = itemNodes.map(getItemData).filter((item) => item.whatsappUrl);
          openWhatsappLinks(items.map((item) => item.whatsappUrl));
        },
        "[data-bulk-copy-preview]": async () => {
          await copyToClipboard(previewTextarea?.value || "");
          showToast("Preview copiado.", "success");
        },
        "[data-bulk-clear-selection]": () => {
          itemNodes.forEach((itemNode) => {
            const checkbox = itemNode.querySelector("[data-charge-select]");
            if (checkbox) checkbox.checked = false;
          });
          syncSelection();
        },
      };

      Object.entries(actions).forEach(([selector, handler]) => {
        const button = root.querySelector(selector);
        if (!button) return;
        button.addEventListener("click", handler);
      });

      root.querySelectorAll("[data-charge-bulk-form]").forEach((form) => {
        form.addEventListener("submit", (event) => {
          const submitter =
            event.submitter instanceof HTMLButtonElement
              ? event.submitter
              : form.querySelector("button[type='submit']");

          if (!submitter || submitter.disabled) {
            event.preventDefault();
            syncSelection();
            return;
          }

          const selectedItems = getSelectedItems();
          if (!selectedItems.length) {
            event.preventDefault();
            showToast("Selecione pelo menos uma mensalidade para a acao em lote.", "error");
            syncSelection();
            return;
          }

          const hiddenIdsWrap = form.querySelector("[data-bulk-selected-ids]");
          if (hiddenIdsWrap) {
            hiddenIdsWrap.innerHTML = selectedItems
              .map((item) => `<input type="hidden" name="feeIds" value="${item.feeId}">`)
              .join("");
          }

          submitter.disabled = true;
          submitter.classList.add("finance-is-loading");
          submitter.textContent = "Salvando...";
        });
      });

      syncSelection();
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      const openDialog = document.querySelector(".finance-dialog:not([hidden])");
      if (event.key === "Escape" && openDialog) {
        event.preventDefault();
        const closeButton = openDialog.querySelector("[data-dialog-close]");
        if (closeButton instanceof HTMLElement) {
          closeButton.click();
        } else {
          openDialog.hidden = true;
          document.body.classList.remove("finance-dialog-open");
        }
        return;
      }

      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (event.key === "/" && !isTypingTarget) {
        const search = document.querySelector("[data-finance-search]");
        if (search) {
          event.preventDefault();
          search.focus();
          search.select?.();
        }
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const index = Number.parseInt(event.key, 10);
        if (Number.isFinite(index) && index >= 1 && index <= 7) {
          const tab = document.querySelectorAll(".finance-tabbar .finance-tab")[index - 1];
          if (tab) {
            event.preventDefault();
            window.location = tab.href;
          }
        }
      }
    });
  }

  function initFinanceDialogs() {
    const dialogTransitionMs = 240;

    const clearDialogTimer = (dialog) => {
      if (!dialog || !dialog.__hideTimer) return;
      window.clearTimeout(dialog.__hideTimer);
      dialog.__hideTimer = null;
    };

    const closeDialog = (dialog) => {
      if (!dialog) return;
      clearDialogTimer(dialog);
      dialog.classList.remove("is-visible");
      dialog.__hideTimer = window.setTimeout(() => {
        dialog.hidden = true;
        dialog.__hideTimer = null;
        if (!document.querySelector('.finance-dialog.is-visible:not([hidden])')) {
          document.body.classList.remove("finance-dialog-open");
        }
      }, dialogTransitionMs);
    };

    const openDialog = (dialog) => {
      if (!dialog) return;
      clearDialogTimer(dialog);
      dialog.hidden = false;
      document.body.classList.add("finance-dialog-open");
      window.requestAnimationFrame(() => {
        dialog.classList.add("is-visible");
      });

      const autofocusField = dialog.querySelector("[data-competence-search], [autofocus]");
      if (autofocusField instanceof HTMLElement) {
        window.setTimeout(() => autofocusField.focus(), 120);
      }
    };

    document.querySelectorAll("[data-dialog-open]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const target = button.getAttribute("data-dialog-open");
        const dialog = document.querySelector(`[data-finance-dialog="${target}"]`);
        if (!dialog) return;
        event.preventDefault();
        openDialog(dialog);
      });
    });

    document.querySelectorAll("[data-finance-dialog]").forEach((dialog) => {
      dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
        button.addEventListener("click", () => closeDialog(dialog));
      });
    });

    const requestedDialog = new URLSearchParams(window.location.search).get("openDialog");
    if (requestedDialog) {
      const dialog = document.querySelector(`[data-finance-dialog="${requestedDialog}"]`);
      if (dialog) {
        openDialog(dialog);

        if (window.history?.replaceState) {
          const url = new URL(window.location.href);
          url.searchParams.delete("openDialog");
          window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
        }
      }
    }
  }

  function initCompetencePlanForms() {
    document.querySelectorAll("[data-competence-plan-form]").forEach((form) => {
      const dialog = form.closest("[data-finance-dialog]");
      const searchInput = form.querySelector("[data-competence-search]");
      const playerRows = Array.from(form.querySelectorAll("[data-competence-player]"));
      const countNodes = {
        MONTHLY: form.querySelector('[data-competence-count="MONTHLY"]'),
        PER_MATCH: form.querySelector('[data-competence-count="PER_MATCH"]'),
        EXEMPT: form.querySelector('[data-competence-count="EXEMPT"]'),
      };

      const getCurrentPlan = (row) => {
        const selected = row.querySelector("[data-competence-plan-input]:checked");
        return selected?.value || "PER_MATCH";
      };

      const syncCounts = () => {
        const counts = {
          MONTHLY: 0,
          PER_MATCH: 0,
          EXEMPT: 0,
        };

        playerRows.forEach((row) => {
          const plan = getCurrentPlan(row);
          counts[plan] = (counts[plan] || 0) + 1;
        });

        Object.entries(countNodes).forEach(([plan, node]) => {
          if (node) node.textContent = String(counts[plan] || 0);
        });
      };

      const syncSearch = () => {
        const term = String(searchInput?.value || "").trim().toLowerCase();
        playerRows.forEach((row) => {
          const haystack = row.getAttribute("data-player-search") || "";
          row.hidden = term ? !haystack.includes(term) : false;
        });
      };

      playerRows.forEach((row) => {
        row.querySelectorAll("[data-competence-plan-input]").forEach((input) => {
          input.addEventListener("change", syncCounts);
        });
      });

      form.querySelectorAll("[data-set-competence-plan]").forEach((button) => {
        button.addEventListener("click", () => {
          const plan = button.getAttribute("data-set-competence-plan") || "PER_MATCH";

          playerRows.forEach((row) => {
            const target = row.querySelector(`[data-competence-plan-input][value="${plan}"]`);
            if (target && !target.disabled) target.checked = true;
          });

          syncCounts();
        });
      });

      if (searchInput) {
        searchInput.addEventListener("input", syncSearch);
      }

      form.addEventListener("submit", () => {
        if (dialog) {
          dialog.classList.remove("is-visible");
        }
      });

      syncCounts();
      syncSearch();
    });
  }

  function initAdminFinance() {
    initCategoryForms();
    initCopyButtons();
    initAsyncPlayerForms();
    initFillPaymentButtons();
    initQuickPayButtons();
    initConfirmActions();
    initChargeBulkRoots();
    initFinanceDialogs();
    initCompetencePlanForms();
    initKeyboardShortcuts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminFinance, { once: true });
  } else {
    initAdminFinance();
  }
})();
