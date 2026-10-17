// Interfaz frente a SPEC.md §12.1–12.3 y §13: framebuffer de 320×200 con coordenadas de
// 640×400, texto MSPR, fuente HFNT01, FLIC, mapa mundial, briefing y menú principal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vga, VGA_W } from '../src/ui/vga.js';
import { MenuGfx, FONT } from '../src/ui/menu-gfx.js';
import { MissionFont } from '../src/ui/mission-font.js';
import { FlicPlayer } from '../src/ui/flic-player.js';
import { Campaign } from '../src/campaign/campaign.js';
import { MapScene } from '../src/scenes/map.js';
import { MenuScene } from '../src/scenes/menu.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('data/ui.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));
const bin = (p) => new Uint8Array(fs.readFileSync(new URL(p, ASSETS)));
const data = () => ({
  weapons: json('data/weapons.json'), mods: json('data/mods.json'), territories: json('data/territories.json'),
  briefings: json('data/briefings.json'), agentNames: json('data/agent-names.json'),
});

test('VGA §12.1: las coordenadas de 640×400 se dividen entre 2 al dibujar', () => {
  const v = new Vga();
  v.pset(101, 51, 7);
  assert.equal(v.pixels[25 * VGA_W + 50], 7);
  v.fillRect(10, 10, 20, 4, 3);
  assert.equal(v.pixels[5 * VGA_W + 5], 3);
  assert.equal(v.pixels[5 * VGA_W + 14], 3);
  assert.equal(v.pixels[5 * VGA_W + 15], 0, 'el rectángulo cubre [x>>1, (x+w)>>1)');
  v.saveBackground(); v.pset(0, 0, 9); v.restoreBackground();
  assert.equal(v.pixels[0], 0);
});

test('Texto MSPR §12.1: glifo = base + c − 0x20, ancho duplicado y espaciado −2', { skip }, () => {
  const rects = json('gfx/menu-sprites.json').sprites;
  const gfx = new MenuGfx({ width: 1, data: new Uint8Array(4) }, rects);
  const w = (ch) => rects[FONT.HOT + ch.charCodeAt(0) - 0x20].w * 2 - 2;
  assert.equal(gfx.width('AB', FONT.HOT), w('A') + w('B'));
  assert.equal(gfx.size(FONT.HOT + 1).h, rects[FONT.HOT + 1].h * 2);
});

test('Fuente HFNT01 §13: «A» de 6×10 y glifos anchos en palabras de 16 bits', { skip }, () => {
  const f = new MissionFont(bin('gfx/hfnt01.bin'));
  const row = (ch, y) => { const g = f.glyphs[ch.charCodeAt(0)]; return Array.from(g.bits.slice(y * g.w, (y + 1) * g.w), (b) => (b ? '#' : '.')).join(''); };
  assert.deepEqual([f.glyphs[65].w, f.glyphs[65].h], [6, 10]);
  assert.equal(row('A', 5), '######');
  assert.equal(row('T', 0), '....####');
  assert.equal(row('T', 9), '...##...');
  assert.equal(row('M', 3), '########');
});

test('FLIC §13: MMAP se reproduce entera y deja paleta y fondo', { skip }, () => {
  const index = json('anims/index.json');
  const v = new Vga();
  const p = new FlicPlayer(bin('anims/mmap.flc'), v, { ticksPerFrame: 5 });
  let frames = 1;
  while (!p.done) { p.next(); frames++; }
  assert.equal(frames - 1, index.mmap.frames);
  assert.ok(v.palette.some((c) => c > 0));
  assert.ok(v.pixels.some((c) => c > 0));
});

function fakeGame(campaign) {
  const ui = json('data/ui.json');
  return {
    campaign, vga: new Vga(), menuGfx: new MenuGfx({ width: 1, data: new Uint8Array(4) }, json('gfx/menu-sprites.json').sprites), lang: 'en',
    input: { mouse: { x: 0, y: 0 }, buttons: {} }, loop: { step: 0.1 },
    assets: { ui, mapMasks: bin('gfx/map-masks.bin'), mods: json('data/mods.json'), agentNames: json('data/agent-names.json') },
  };
}

test('Mapa §12.2: la máscara de MMAPBLK decide el territorio bajo el ratón (`0x28490`)', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 2 });
  const map = new MapScene(fakeGame(c));
  const masks = bin('gfx/map-masks.bin');
  for (const i of [0, 9, 30, 49]) {
    const r = c.territories.get(i).info.rect;
    let hit = -1;
    for (let k = 0; k < 64 * 44 && hit < 0; k++) if (masks[i * 64 * 44 + k]) hit = k;
    const x = r.x + (hit % 64) * 2 + 1, y = r.y + Math.floor(hit / 64) * 2 + 1;
    assert.equal(map.territoryAt(x, y), i, `territorio ${i}`);
  }
});

test('Briefing §12.2: INFO revela el siguiente bloque y se guarda por territorio; coste < fondos', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 2 });
  c.chooseTerritory(9);
  const before = c.briefingText();
  assert.ok(before.includes('|'));
  assert.equal(c.briefCost('info'), 100);
  assert.ok(c.buyBriefing('info'));
  assert.equal(c.briefingText().split('|').length, before.split('|').length - 1);
  assert.ok(c.buyBriefing('enhance'));
  c.briefing = null;
  c.chooseTerritory(9);
  assert.deepEqual(c.briefState, { info: 1, enhance: 1 }, 'persisten por territorio');
  c.funds = c.briefCost('info');
  assert.equal(c.buyBriefing('info'), false, 'exige coste estrictamente menor que los fondos');
});

test('MAIN MENU §12.2: la fila bajo el ratón y la opción elegida siguen las fórmulas del original', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 2 });
  const menu = new MenuScene(fakeGame(c));
  const chosen = [];
  menu.choose = (k) => chosen.push(k);
  const rowY = [0x8c, 0xae, 0xd0, 0xf2, 0x114];
  menu.game.input.mouse.y = rowY[3] + 4;
  assert.equal(menu.hovered(), 4, 'la cuarta fila dibujada es RESTART GAME (índice 4)');
  for (const y of rowY) menu.click({ y: y + 4 });
  assert.deepEqual(chosen, [1, 2, 3, 4, 5]);
});

test('Mapa §12.2: empieza en WESTERN EUROPE (`0x55030` = 9) y la elección se conserva entre visitas', async () => {
  const { Campaign } = await import('../src/campaign/campaign.js');
  const { MapScene } = await import('../src/scenes/map.js');
  const data = { weapons: [{}, { maxAmmo: 13 }], mods: [], territories: [], briefings: {} };
  const campaign = new Campaign(data);
  assert.equal(campaign.mapSelection, 9);
  const game = { campaign, vga: {}, menuGfx: {}, input: { mouse: { x: 0, y: 0 } } };
  const first = new MapScene(game);
  assert.equal(first.selected, 9);
  first.selected = 29;
  assert.equal(new MapScene(game).selected, 29, 'otra visita al mapa conserva la elección');
});
