(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") {
    root.setAttribute("data-theme", saved);
  } else {
    // default: dark para manter seu visual atual
    root.setAttribute("data-theme", "dark");
  }

  window.toggleTheme = function () {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    // opcional: trocar label/ícone do switch, se houver
    const label = document.querySelector("[data-theme-label]");
    if (label) label.textContent = next === "dark" ? "Escuro" : "Claro";
  };
})();
