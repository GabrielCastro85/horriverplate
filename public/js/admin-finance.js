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
    const params = new URLSearchParams(window.location.search);

    const appendPair = (key, value) => {
      if (value == null || value === "") return;
      params.delete(key);
      params.append(key, String(value));
    };

    if (payload instanceof FormData) {
      payload.forEach((value, key) => {
        if (params.has(key)) params.delete(key);
        params.append(key, String(value));
      });
      return params;
    }

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        params.delete(key);
        value.forEach((item) => {
          if (item != null && item !== "") params.append(key, String(item));
        });
        return;
      }

      appendPair(key, value);
    });

    return params;
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: buildRequestParams(payload).toString(),
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = { ok: false, message: "Resposta invalida do servidor." };
    }

    if (!response.ok || data.ok === false) {
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
        applyStatusAppearance(root.querySelector("[data-fee-status]"), updatedFee.statusTone, updatedFee.statusLabel);

        const paidNode = root.querySelector("[data-fee-paid]");
        if (paidNode) paidNode.textContent = formatCurrency(updatedFee.amountPaid);

        const dueNode = root.querySelector("[data-fee-due]");
        if (dueNode) dueNode.textContent = formatCurrency(updatedFee.amountDue);

        updateBalanceAppearance(root.querySelector("[data-fee-balance]"), updatedFee.balance);

        if (Number(updatedFee.balance || 0) <= 0) {
          root.querySelectorAll("[data-hide-on-paid]").forEach((button) => {
            button.style.display = "none";
          });
          root.classList.add("finance-charge-item--settled");
        }

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
        const selectedItems = allItems.filter((item) => item.checkbox?.checked);
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

      syncSelection();
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
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

  function initAdminFinance() {
    initCategoryForms();
    initCopyButtons();
    initAsyncPlayerForms();
    initFillPaymentButtons();
    initQuickPayButtons();
    initConfirmActions();
    initChargeBulkRoots();
    initKeyboardShortcuts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminFinance, { once: true });
  } else {
    initAdminFinance();
  }
})();
