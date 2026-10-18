// Opciones del remake [DIS] (SPEC §15.1): idioma (textos originales en/fr/it y traducción
// propia al español) y
// volúmenes de música y efectos. En el original se fijaban en la instalación; aquí van en
// un panel bajo el lienzo y se guardan en localStorage.

const KEY = 'syndicate-remake.options';
export const LANGUAGES = Object.freeze({ en: 'English', fr: 'Français', it: 'Italiano', es: 'Español' });
export const DEFAULT_OPTIONS = Object.freeze({ lang: 'en', music: 0.6, sfx: 1, graphics: 'enhanced' });
export const GRAPHICS = Object.freeze({ enhanced: 'Gráficos mejorados', original: 'Gráficos originales' });

/** Opciones guardadas, con los valores por defecto para lo que falte o no sea válido. */
export function loadOptions(storage = globalThis.localStorage) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { saved = {}; }
  const vol = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  return {
    lang: saved.lang in LANGUAGES ? saved.lang : DEFAULT_OPTIONS.lang,
    music: vol(saved.music, DEFAULT_OPTIONS.music),
    sfx: vol(saved.sfx, DEFAULT_OPTIONS.sfx),
    graphics: saved.graphics in GRAPHICS ? saved.graphics : DEFAULT_OPTIONS.graphics,
  };
}

export function saveOptions(options, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(options)); } catch { /* sin almacenamiento */ }
}

/** Aplica las opciones al juego: idioma de las pantallas y volúmenes. */
export function applyOptions(game, options) {
  game.lang = options.lang;
  game.audio?.setVolumes({ music: options.music, sfx: options.sfx });
  if (game.graphics !== options.graphics) game.setGraphicsMode?.(options.graphics);
}

/** Crea los controles en `container` y los mantiene sincronizados con el juego. */
export function mountOptions(container, game) {
  const options = loadOptions();
  applyOptions(game, options);
  const doc = container.ownerDocument;
  const wrap = doc.createElement('span');
  wrap.className = 'options';
  const lang = doc.createElement('select');
  lang.setAttribute('aria-label', 'Idioma');
  for (const [code, name] of Object.entries(LANGUAGES)) lang.add(new Option(name, code, false, code === options.lang));
  const slider = (label, value) => {
    const l = doc.createElement('label'), input = doc.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100'; input.value = String(Math.round(value * 100));
    l.append(label + ' ', input);
    return [l, input];
  };
  const gfx = doc.createElement('select');
  gfx.setAttribute('aria-label', 'Gráficos');
  for (const [code, name] of Object.entries(GRAPHICS)) gfx.add(new Option(name, code, false, code === options.graphics));
  const [musicLabel, music] = slider('música', options.music);
  const [sfxLabel, sfx] = slider('efectos', options.sfx);
  const update = () => {
    options.lang = lang.value; options.graphics = gfx.value; options.music = Number(music.value) / 100; options.sfx = Number(sfx.value) / 100;
    applyOptions(game, options);
    saveOptions(options);
  };
  for (const el of [lang, gfx, music, sfx]) el.addEventListener('input', update);
  // Que las teclas del juego no muevan los controles por accidente.
  for (const el of [lang, gfx, music, sfx]) el.addEventListener('change', () => game.input?.canvas?.focus?.());
  wrap.append(' · ', lang, ' ', gfx, ' ', musicLabel, ' ', sfxLabel);
  container.append(wrap);
  return options;
}
