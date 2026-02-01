(() => {
  const btn = document.getElementById("mobileMenuBtn");
  const menu = document.getElementById("mobileMenu");
  const panel = document.getElementById("mobilePanel");
  const closeBtn = document.getElementById("mobileClose");
  const backdrop = document.getElementById("mobileBackdrop");
  let lastActiveElement = null;

  if (!btn || !menu || !panel) return;

  function openMenu() {
    lastActiveElement = document.activeElement;
    menu.classList.remove("hidden");
    menu.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      panel.classList.remove("animate-slideUp");
      panel.classList.add("animate-slideDown");
      btn.classList.add("hamburger-active");
      panel.focus();
    });
    document.body.style.overflow = "hidden";
  }
  function closeMenu() {
    panel.classList.remove("animate-slideDown");
    panel.classList.add("animate-slideUp");
    btn.classList.remove("hamburger-active");
    menu.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      menu.classList.add("hidden");
    }, 180);
    document.body.style.overflow = "";
    if (lastActiveElement && typeof lastActiveElement.focus === "function") {
      lastActiveElement.focus();
    }
  }

  btn.addEventListener("click", openMenu);
  if (closeBtn) closeBtn.addEventListener("click", closeMenu);
  if (backdrop) backdrop.addEventListener("click", closeMenu);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) closeMenu();
  });
})();

(() => {
  const images = document.querySelectorAll("img");
  images.forEach((img) => {
    if (img.dataset.eager === "true") return;
    if (!img.hasAttribute("loading")) img.loading = "lazy";
    if (!img.hasAttribute("decoding")) img.decoding = "async";
  });
})();

(() => {
  const key = `scroll:${location.pathname}${location.search}`;
  const stored = sessionStorage.getItem(key);
  if (stored) {
    const y = parseInt(stored, 10);
    if (!Number.isNaN(y)) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    sessionStorage.removeItem(key);
  }

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!form || form.tagName !== "FORM") return;
      sessionStorage.setItem(key, String(window.scrollY || window.pageYOffset || 0));
    },
    true
  );
})();

(() => {
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!form || form.tagName !== "FORM") return;
      if (form.dataset.noSubmitLock === "true") return;
      const buttons = form.querySelectorAll("button[type='submit']");
      buttons.forEach((button) => {
        if (button.disabled) return;
        const label = button.dataset.submitLabel;
        if (label) button.textContent = label;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.classList.add("opacity-70", "cursor-not-allowed");
      });
    },
    true
  );
})();

(() => {
  const endpoint = "/monitoring/frontend-error";
  const send = (payload) => {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
    } else {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  };

  window.addEventListener("error", (event) => {
    send({
      type: "error",
      message: event.message,
      url: location.href,
      stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 1500) : undefined,
      userAgent: navigator.userAgent,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason || {};
    send({
      type: "unhandledrejection",
      message: reason.message ? String(reason.message) : String(reason),
      url: location.href,
      stack: reason.stack ? String(reason.stack).slice(0, 1500) : undefined,
      userAgent: navigator.userAgent,
    });
  });
})();

(() => {
  const root = document.documentElement;
  const markReady = () => root.classList.add("skeleton-ready");
  if (document.readyState === "complete") {
    setTimeout(markReady, 120);
  } else {
    window.addEventListener("load", () => setTimeout(markReady, 120));
  }
})();

(() => {
  const btn = document.getElementById("scrollTopBtn");
  if (!btn) return;

  const toggle = () => {
    if (window.scrollY > 420) {
      btn.classList.add("is-visible");
    } else {
      btn.classList.remove("is-visible");
    }
  };

  toggle();
  window.addEventListener("scroll", toggle, { passive: true });
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
