// Español [DIS] (SPEC §15.1): se añade como cuarto idioma a los datos ya cargados. Cada
// objeto `{en, fr, it}` recibe `es` (la traducción de su texto inglés, o el inglés si falta) y
// cada briefing recibe su versión `es` con la misma estructura de secciones (`|`).

import { ES_UI } from './es-ui.js';
import { ES_BRIEFINGS } from './es-briefings.js';
import { toGameCharset } from './charset.js';

/** Recorre `data` y añade `es` a cada `{en, fr, it}`. Devuelve los textos ingleses sin traducción. */
export function addSpanishTexts(data, dict = ES_UI) {
  const missing = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.en === 'string' && 'fr' in o) {
      const t = dict[o.en];
      if (t === undefined) missing.add(o.en);
      o.es = toGameCharset(t ?? o.en);
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return missing;
}

/** Añade `briefings[m].es` (texto, secciones y los mismos costes y marcas que en inglés). */
export function addSpanishBriefings(briefings, table = ES_BRIEFINGS) {
  for (const [mission, b] of Object.entries(briefings)) {
    const es = table[mission];
    if (!b.en) continue;
    if (!es) { b.es = b.en; continue; }
    const text = toGameCharset(es);
    b.es = { ...b.en, text, sections: text.split('|').map((s) => s.trim()).filter(Boolean) };
  }
}

/** Español para todos los datos con texto de `assets`. */
export function addSpanish(assets) {
  const missing = new Set();
  for (const key of ['ui', 'weapons', 'mods', 'territories', 'intro']) {
    for (const m of addSpanishTexts(assets[key])) missing.add(m);
  }
  if (assets.briefings) addSpanishBriefings(assets.briefings);
  return missing;
}
