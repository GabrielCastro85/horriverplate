(() => {
  const form = document.getElementById('annual-vote-form');
  if (!form) return;
  const screens = [...form.querySelectorAll('[data-screen]')];
  const choices = screens.filter(s => s.dataset.screen === 'choices');
  const best = choices.find(s => s.dataset.category === 'MELHOR_JOGADOR');
  const positions = choices.filter(s => s !== best);
  const progress = document.getElementById('avProgress');
  const submit = document.getElementById('avSubmit');
  const agreed = document.getElementById('avUnderstood');
  let current = 0;
  let sending = false;
  const selected = screen => screen.querySelector('input[type=radio]:checked:not(:disabled)');
  const name = input => input.closest('.av-card').dataset.playerName;
  function sync() {
    const used = new Map(positions.flatMap(s => selected(s) ? [[selected(s).value, s.dataset.label]] : []));
    best.querySelectorAll('input[type=radio]').forEach(input => {
      input.disabled = used.has(input.value);
      if (input.disabled) input.checked = false;
      const card = input.closest('.av-card');
      card.classList.toggle('is-locked', input.disabled);
      card.querySelector('.av-lock-note').textContent = input.disabled ? `Você já votou nele como ${used.get(input.value).toLowerCase()}.` : '';
    });
    best.querySelector('.av-empty').hidden = !!best.querySelector('input:not(:disabled)');
    choices.forEach(screen => {
      screen.querySelector('[data-next]').disabled = !selected(screen);
      screen.querySelectorAll('input[type=radio]').forEach(input => input.closest('.av-card').classList.toggle('is-selected', input.checked));
    });
    document.getElementById('avStart').disabled = !agreed.checked;
    submit.disabled = sending || !choices.every(selected);
    const receipt = document.getElementById('avReceipt');
    receipt.replaceChildren();
    choices.forEach(screen => {
      const input = selected(screen);
      const row = document.createElement('div'); row.className = 'av-receipt-row';
      const text = document.createElement('div');
      const label = document.createElement('small'); label.textContent = screen.dataset.label;
      const player = document.createElement('strong'); player.textContent = input ? name(input) : 'Falta escolher';
      text.append(label, player);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'av-back'; edit.textContent = 'Trocar';
      edit.setAttribute('aria-label', `Trocar voto: ${screen.dataset.label}`);
      edit.addEventListener('click', () => show(screens.indexOf(screen)));
      row.append(text, edit); receipt.append(row);
    });
  }
  function show(index) {
    if (sending) return;
    sync();
    current = Math.max(0, Math.min(index, screens.length - 1));
    screens.forEach((screen, i) => { screen.hidden = i !== current; });
    const screen = screens[current];
    progress.hidden = current < 2;
    const step = screen.dataset.step;
    document.getElementById('avProgressLabel').textContent = step !== undefined ? `Escolha ${Number(step) + 1} de ${choices.length} · ${choices[Number(step)].dataset.label}` : 'Revisão · falta só confirmar';
    document.getElementById('avProgressBar').style.width = `${step !== undefined ? (Number(step) + 1) / choices.length * 100 : 100}%`;
    screen.querySelector('h1,h2')?.focus({ preventScroll: true });
    document.getElementById('annualWizard').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  form.addEventListener('change', sync);
  form.addEventListener('click', event => {
    if (event.target.closest('[data-next]')) {
      const screen = screens[current];
      if (screen.dataset.screen === 'rules' && !agreed.checked) return;
      if (screen.dataset.screen === 'choices' && !selected(screen)) return;
      show(current + 1);
    }
    if (event.target.closest('[data-back]')) show(current - 1);
  });
  document.getElementById('avRestart').addEventListener('click', () => {
    form.querySelectorAll('input[type=radio]').forEach(input => { input.checked = false; });
    show(2);
  });
  form.addEventListener('submit', event => {
    sync();
    if (sending || screens[current].dataset.screen !== 'review' || !choices.every(selected)) {
      event.preventDefault(); return;
    }
    sending = true; submit.disabled = true; submit.textContent = 'Computando seu voto…';
  });
  window.addEventListener('pageshow', () => { sending = false; submit.textContent = 'Confirmar votação'; sync(); });
  sync();
  if (form.querySelector('input[type=radio]:checked')) {
    agreed.checked = true;
    const pending = choices.find(screen => !selected(screen));
    show(pending ? screens.indexOf(pending) : screens.length - 1);
  }
})();
