// CONFIGURE COMPANY y opciones frente a SPEC.md §12.2 y §15.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigureScene } from '../src/scenes/configure.js';
import { Campaign } from '../src/campaign/campaign.js';
import { loadOptions, saveOptions, applyOptions, DEFAULT_OPTIONS } from '../src/ui/options.js';

const data = { weapons: [{}, { maxAmmo: 13 }], mods: [], territories: [], briefings: {} };

function scene() {
  const campaign = new Campaign(data);
  const game = { vga: {}, menuGfx: {}, campaign, lang: 'en', input: { mouse: { x: 0, y: 0 } }, assets: { ui: { labels: {} } } };
  const s = new ConfigureScene(game);
  s.left = 0;
  s.leave = () => { s.left++; };
  return s;
}
const click = (s, x, y, button = 'left') => s.click({ x, y, button });

test('CONFIGURE §12.2: las tres opciones abren el modo de su fila (`0x175c0`)', () => {
  const s = scene();
  click(s, 0x150, 0x48); assert.equal(s.mode, 1, 'COLOUR AND LOGO');
  s.cancel(); click(s, 0x150, 0x60); assert.equal(s.mode, 3, 'COMPANY NAME');
  s.cancel(); click(s, 0x150, 0x78); assert.equal(s.mode, 2, 'YOUR NAME');
  s.cancel(); click(s, 0x150, 0x57); assert.equal(s.mode, 0, 'entre filas no hace nada');
});

test('CONFIGURE §12.2: flechas cíclicas de color (0..7) y logo (0..39); OK confirma, CANCEL descarta', () => {
  const s = scene();
  click(s, 0x150, 0x48);
  click(s, 0x1a0, 0x40); assert.equal(s.temp.colour, 7, 'color 0 − 1 → 7');
  click(s, 0x1c0, 0x60); click(s, 0x1c0, 0x60); assert.equal(s.temp.logo, 2);
  click(s, 0x1a0, 0x60); click(s, 0x1a0, 0x60); click(s, 0x1a0, 0x60); assert.equal(s.temp.logo, 39, 'logo 0 − 1 → 39');
  click(s, 0x1e0, 0x80);                                   // CANCEL
  assert.deepEqual([s.mode, s.pending.colour, s.pending.logo], [0, 0, 0]);
  click(s, 0x150, 0x48); click(s, 0x1c0, 0x40); click(s, 0x130, 0x80);   // OK
  assert.equal(s.pending.colour, 1);
  assert.equal(s.campaign.colour, 0, 'sin ACCEPT no se guarda');
});

test('CONFIGURE §12.2: nombre de hasta 16 caracteres en mayúsculas, con edición; ACCEPT no guarda mientras se escribe', () => {
  const s = scene();
  click(s, 0x150, 0x60);
  for (const ch of 'eurocorp corporation x') s.key(`Key${ch}`, ch);
  assert.equal(s.temp.text, 'EUROCORP CORPORA');
  s.key('Home'); s.key('Delete'); s.key('ArrowRight'); s.key('Backspace'); s.key('End'); s.key('Backspace');
  assert.equal(s.temp.text, 'ROCORP CORPOR');
  click(s, 0x40, 0x160);                                   // ACCEPT mientras se escribe
  assert.equal(s.left, 0);
  s.key('Enter');
  assert.equal(s.pending.company, 'ROCORP CORPOR');
  click(s, 0x40, 0x160);
  assert.equal(s.campaign.companyName, 'ROCORP CORPOR');
  assert.equal(s.left, 1);
});

test('CONFIGURE §12.2: MENU sale sin guardar', () => {
  const s = scene();
  click(s, 0x150, 0x48); click(s, 0x1c0, 0x40); click(s, 0x130, 0x80);
  click(s, 0x200, 0x160);
  assert.equal(s.left, 1);
  assert.equal(s.campaign.colour, 0);
});

test('Color §12.2: el rival que tenía el color nuevo recibe el antiguo; se guarda en la partida', () => {
  const c = new Campaign(data);
  c.setColour(5);
  assert.deepEqual(c.colours, [5, 1, 2, 3, 4, 0, 6, 7]);
  const copy = new Campaign(data, JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(copy.colour, 5);
  assert.equal(copy.colourOf(5), 0);
  assert.equal(new Campaign(data, { colour: 3 }).colourOf(3), 0, 'partidas antiguas con solo `colour`');
});

test('Opciones §15.1: idioma y volúmenes se guardan, se validan y se aplican', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadOptions(storage), DEFAULT_OPTIONS);
  saveOptions({ lang: 'it', music: 0.25, sfx: 0.5, graphics: 'original' }, storage);
  assert.deepEqual(loadOptions(storage), { lang: 'it', music: 0.25, sfx: 0.5, graphics: 'original' });
  store.set('syndicate-remake.options', '{"lang":"de","music":7}');
  assert.deepEqual(loadOptions(storage), DEFAULT_OPTIONS);
  const set = [];
  const modes = [];
  const game = { lang: 'en', graphics: 'original', audio: { setVolumes: (v) => set.push(v) }, setGraphicsMode: (m) => modes.push(m) };
  applyOptions(game, { lang: 'fr', music: 0.1, sfx: 0.9, graphics: 'enhanced' });
  assert.deepEqual(modes, ['enhanced']);
  assert.equal(game.lang, 'fr');
  assert.deepEqual(set, [{ music: 0.1, sfx: 0.9 }]);
});
