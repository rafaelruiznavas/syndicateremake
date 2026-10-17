// Menú de trucos del remake [DIS] (SPEC §15.1). Solo aparece con el parámetro `cheat` en la
// URL (http://localhost:8090/?cheat). Por ahora: agentes invulnerables.

/** ¿Está activado el parámetro `cheat` en la URL? */
export function cheatsEnabled(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).has('cheat');
}

/** Crea el menú «Trucos» en `container` si la URL lo pide. Devuelve true si lo ha creado. */
export function mountCheats(container, game, search) {
  if (!cheatsEnabled(search)) return false;
  const doc = container.ownerDocument;
  const menu = doc.createElement('details');
  menu.className = 'cheats';
  const summary = doc.createElement('summary');
  summary.textContent = 'Trucos';
  const label = doc.createElement('label'), box = doc.createElement('input');
  box.type = 'checkbox';
  box.checked = game.cheats.invulnerable;
  box.addEventListener('change', () => {
    game.cheats.invulnerable = box.checked;
    game.input?.canvas?.focus?.();
  });
  label.append(box, ' Agentes invulnerables');
  menu.append(summary, label);
  container.append(' · ', menu);
  return true;
}
