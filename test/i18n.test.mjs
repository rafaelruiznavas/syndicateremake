// Español [DIS] (SPEC §15.1): cobertura de la traducción, estructura de los briefings y
// conversión a los códigos CP437 de las fuentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addSpanishTexts, addSpanishBriefings } from '../src/i18n/spanish.js';
import { ES_BRIEFINGS } from '../src/i18n/es-briefings.js';
import { toGameCharset, foldToAscii } from '../src/i18n/charset.js';
import { remakeText } from '../src/i18n/es-ui.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('data/briefings.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

test('Español: todos los textos de interfaz, objetos, territorios e intro tienen traducción', { skip }, () => {
  const missing = new Set();
  for (const f of ['data/ui.json', 'data/weapons.json', 'data/mods.json', 'data/territories.json', 'data/intro.json']) {
    const data = json(f);
    for (const m of addSpanishTexts(data)) missing.add(m);
  }
  assert.deepEqual([...missing], []);
  const ui = json('data/ui.json'); addSpanishTexts(ui);
  assert.equal(ui.labels.mainMenu.es, toGameCharset('MENÚ PRINCIPAL'));
  assert.equal(ui.mainMenuItems[1].es, toGameCharset('EMPEZAR MISIÓN'));
});

test('Español: 50 briefings con las mismas secciones de INFO («|») que el original', { skip }, () => {
  const briefings = json('data/briefings.json');
  assert.equal(Object.keys(ES_BRIEFINGS).length, 50);
  for (const [m, b] of Object.entries(briefings)) {
    assert.equal(ES_BRIEFINGS[m].split('|').length, b.en.text.split('|').length, `misión ${m}`);
  }
  addSpanishBriefings(briefings);
  assert.deepEqual(briefings[1].es.infoCosts, briefings[1].en.infoCosts, 'costes de INFO como en inglés');
  assert.ok(briefings[1].es.text.startsWith('CAMPAMENTO MERCENARIO.'));
});

test('Juego de caracteres: acentos y eñes a CP437; HFNT01 recibe ASCII', () => {
  assert.equal(toGameCharset('MISIÓN ÑÚ ¿É?'), 'MISION \xa5U \xa8E?', 'mayúsculas sin acento; Ñ y ¿ con su glifo');
  assert.equal(toGameCharset('canción'), 'canci\xa2n');
  assert.equal(toGameCharset('¡HOLA!'), 'HOLA!', '¡ no tiene glifo');
  assert.equal(foldToAscii(toGameCharset('CAÑÓN GAUSS')), 'CANON GAUSS');
  assert.equal(foldToAscii('BOMBE \x82'), 'BOMBE E', 'también los acentos franceses');
});

test('Textos del remake: español si lo hay, inglés si no', () => {
  assert.equal(remakeText('paused', 'es'), 'PAUSA');
  assert.equal(remakeText('paused', 'fr'), 'PAUSED');
  assert.equal(remakeText('stats', 'es', { a: 3, c: 1, p: 0, g: 2, h: '50%' }), 'Agentes enemigos 3 · Civiles 1 · Policía 0 · Guardias 2 · Precisión 50%');
});
