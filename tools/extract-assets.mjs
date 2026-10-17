// Extractor de recursos: lee la instalación del usuario y escribe en remake/assets/
// imágenes PNG, sonido WAV, música MIDI y datos JSON con estructura propia (SPEC §13).
// Solo LEE datos: no ejecuta ni copia código del juego.
//
// Uso: node tools/extract-assets.mjs [carpeta SYNDICAT] [carpeta salida]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpack } from './lib/rnc.mjs';
import { LeImage } from './lib/le.mjs';
import { encodePng } from './lib/png.mjs';
import { decodeFlic } from './lib/flic.mjs';
import { decodeVoc, encodeWav, xmiToMidi } from './lib/audio.mjs';
import {
  TRANSPARENT, decodePalette, decodeBlocks, decodeSpriteTable, decodePlanarSprite, decodeRleSprite,
  decodeAnimations, packAtlas, indexedToRgba, indexedToColor,
} from './lib/formats.mjs';
import { decodeLevel } from './lib/level.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? process.env.SYNDICATE ?? 'C:/GOG Games/Syndicate Plus/SYNDICAT';
const OUT = process.argv[3] ?? path.join(here, '..', 'assets');
const DATA = path.join(SRC, 'DATA');

const read = (name) => unpack(new Uint8Array(fs.readFileSync(path.join(DATA, name))));
const exists = (name) => fs.existsSync(path.join(DATA, name));
const out = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const json = (rel, obj) => out(rel, JSON.stringify(obj, null, 1));
const log = (s) => console.log(s);
const LANGS = ['en', 'fr', 'it'];

const exe = new LeImage(new Uint8Array(fs.readFileSync(path.join(SRC, 'MAIN.EXE'))));
/** Tabla de punteros a cadenas con tres idiomas por fila. */
const strings3 = (va, rows) => Array.from({ length: rows }, (_, i) => Object.fromEntries(LANGS.map((l, k) => [l, exe.cstr(exe.u32(va + (i * 3 + k) * 4))])));

// ---------------------------------------------------------------- paletas
const palettes = {};
for (let i = 1; i <= 5; i++) palettes[`hpal0${i}`] = decodePalette(read(`HPAL0${i}.DAT`));
palettes.hpalette = decodePalette(read('HPALETTE.DAT'));
if (exists('MSELECT.PAL')) palettes.mselect = decodePalette(read('MSELECT.PAL'));
json('palettes.json', palettes);
log('paletas: ' + Object.keys(palettes).join(', '));

// ---------------------------------------------------------------- tiles
const blocks = decodeBlocks(read('HBLK01.DAT'));
{
  const cols = 16, W = 64, H = 48, img = new Uint8Array(cols * W * (256 / cols) * H).fill(TRANSPARENT);
  blocks.forEach((px, t) => {
    const ox = (t % cols) * W, oy = Math.floor(t / cols) * H;
    for (let y = 0; y < H; y++) img.set(px.subarray(y * W, (y + 1) * W), (oy + y) * cols * W + ox);
  });
  out('gfx/blocks.png', encodePng(cols * W, 16 * H, indexedToRgba(img)));
  out('preview/blocks.png', encodePng(cols * W, 16 * H, indexedToColor(img, palettes.hpal01)));
  json('gfx/blocks.json', { tileWidth: W, tileHeight: H, columns: cols, count: 256, encoding: 'R = índice de paleta, A = 0 transparente' });
  log('tiles: 256');
}

// ---------------------------------------------------------------- sprites de juego
function planarAtlas(name, datName, tabName, palette, { skipRows = 0 } = {}) {
  const data = read(datName), table = decodeSpriteTable(read(tabName))
    .map((e) => (e.w && e.h > skipRows ? { ...e, offset: e.offset + skipRows * (e.w / 8) * 5, h: e.h - skipRows } : e));
  const images = table.map((e) => (e.w && e.h ? { w: e.w, h: e.h, px: decodePlanarSprite(data, e) } : null));
  const atlas = packAtlas(images, 1024);
  out(`gfx/${name}.png`, encodePng(atlas.width, atlas.height, indexedToRgba(atlas.pixels)));
  out(`preview/${name}.png`, encodePng(atlas.width, atlas.height, indexedToColor(atlas.pixels, palette)));
  return atlas.rects;
}
{
  const rects = planarAtlas('sprites', 'HSPR-0.DAT', 'HSPR-0.TAB', palettes.hpal01);
  const { anims, frames, elements } = decodeAnimations(read('HSTA-0.ANI'), read('HFRA-0.ANI'), read('HELE-0.ANI'));
  json('gfx/sprites.json', { sprites: rects, anims, frames, elements });
  if (exists('HSPR-1.DAT') && exists('HSPR-1.TAB')) json('gfx/sprites1.json', { sprites: planarAtlas('sprites1', 'HSPR-1.DAT', 'HSPR-1.TAB', palettes.hpal01) });
  log(`sprites: ${rects.length}, animaciones ${anims.length}, frames ${frames.length}, elementos ${elements.length}`);
}

// ---------------------------------------------------------------- cursores de misión (mismo formato que los sprites)
{
  // [INF] La TAB declara 33 filas, pero la primera (20 B) no es imagen: decodificada es una barra
  // sólida y los cursores encajan desde la fila 1 (SPEC §13).
  const rects = planarAtlas('pointers', 'HPOINTER.DAT', 'HPOINTER.TAB', palettes.hpal01, { skipRows: 1 });
  json('gfx/pointers.json', { sprites: rects });
}

// ---------------------------------------------------------------- sprites y fuentes de menú (RLE)
function rleAtlas(name, datName, tabName, palette) {
  const data = read(datName), table = decodeSpriteTable(read(tabName));
  const images = table.map((e) => (e.w && e.h ? { w: e.w, h: e.h, px: decodeRleSprite(data, e) } : null));
  const atlas = packAtlas(images, 1024);
  out(`gfx/${name}.png`, encodePng(atlas.width, atlas.height, indexedToRgba(atlas.pixels)));
  if (palette) out(`preview/${name}.png`, encodePng(atlas.width, atlas.height, indexedToColor(atlas.pixels, palette)));
  json(`gfx/${name}.json`, { sprites: atlas.rects });
  return atlas.rects.length;
}

// ---------------------------------------------------------------- animaciones de menú (FLIC)
const menuPalette = { value: null };
fs.mkdirSync(path.join(OUT, 'anims'), { recursive: true });
const flics = fs.readdirSync(DATA).filter((n) => /^M[A-Z]+\.DAT$/i.test(n) || /^INTRO\.DAT$/i.test(n));
const animIndex = {};
for (const n of flics) {
  const buf = read(n);
  if (buf.length < 12 || buf[4] !== 0x12 || buf[5] !== 0xaf) continue;
  const key = n.replace(/\.DAT$/i, '').toLowerCase();
  out(`anims/${key}.flc`, buf);                    // el remake decodifica FLIC en ejecución (formato público)
  let first = null, count = 0;
  for (const fr of decodeFlic(buf)) {
    count++;
    if (!first) first = { w: fr.w, h: fr.h, palette: Array.from(fr.palette), pixels: fr.pixels.slice() };
    if (key !== 'intro' && count > 400) break;
    if (key === 'intro') break;
  }
  animIndex[key] = { file: `anims/${key}.flc`, width: first.w, height: first.h, frames: buf[6] | (buf[7] << 8) };
  if (key === 'mtitle' || key === 'mselect') {
    const pal = Array.from({ length: 256 }, (_, i) => [0, 1, 2].map((k) => Math.round(first.palette[i * 3 + k] * 255 / 63)));
    out(`preview/${key}-frame0.png`, encodePng(first.w, first.h, indexedToColor(first.pixels, pal)));
    if (key === 'mselect') menuPalette.value = pal;
  }
}
json('anims/index.json', animIndex);
log(`animaciones FLIC: ${Object.keys(animIndex).length}`);
log(`sprites de menú: ${rleAtlas('menu-sprites', 'MSPR-0.DAT', 'MSPR-0.TAB', menuPalette.value)}, fuente de menú: ${rleAtlas('menu-font', 'MFNT-0.DAT', 'MFNT-0.TAB', menuPalette.value)}`);
out('gfx/hfnt01.bin', read('HFNT01.DAT'));      // [DES] formato de la fuente de misión pendiente

// ---------------------------------------------------------------- tablas de MAIN.EXE
const COL01 = Array.from(read('COL01.DAT'));
json('data/tile-classes.json', COL01);

const weaponNames = strings3(0x54b10, 19);
const weapons = [];
for (let t = 1; t <= 19; t++) {
  const c = 0x57bf4 + (t - 1) * 0x1f5;
  const price = exe.s32(c + 1);
  weapons.push({
    type: t, name: weaponNames[t - 1], available: exe.u8(c) !== 0xfe,
    price: Math.abs(price), needsResearch: price < 0,
    maxAmmo: exe.u16(0x5a73a + 2 * t), catalogAmmo: exe.s16(c + 5), reloadCostPerUnit: exe.u16(0x5a712 + 2 * t), catalogReloadCost: exe.s32(c + 7),
    range: exe.u16(0x5a6c2 + 2 * t), catalogRange: exe.s16(c + 0xb), researchCost: exe.s16(c + 0xd),
    fireMode: exe.u8(0x5a6ea + t), activationWindow: exe.u8(0x5a6fe + t),
    weight: exe.u16(0x5a7b4 + 2 * t), researchInitial: exe.u16(0x5b498 + 2 * (t - 1)), group: exe.u8(0x5b830 + (t - 1)), next: exe.u8(c + 0x1f3),
  });
}
json('data/weapons.json', weapons);

const modNames = strings3(0x54a38, 18);
const PARTS = ['legs', 'arms', 'chest', 'heart', 'eyes', 'brain'];
const mods = [];
for (let i = 0; i < 18; i++) {
  const c = 0x55780 + i * 0x1eb;
  mods.push({ id: i, part: PARTS[Math.floor(i / 3)], version: (i % 3) + 1, name: modNames[exe.u8(c)], price: exe.u32(c + 1), researchCost: exe.u16(c + 6), researchInitial: exe.u16(0x5b474 + 2 * i), next: exe.u8(c + 0x1ea) });
}
json('data/mods.json', mods);

const territoryNames = strings3(0x541a4, 50);
const territories = [];
for (let c = 0; c < 50; c++) {
  const r = 0x5b060 + c * 0x13, label = exe.u8(r + 8);
  territories.push({
    id: c, name: territoryNames[exe.u8(r + 0x12)], mission: exe.u8(r + 0x11),
    rect: { x: exe.s16(r), y: exe.s16(r + 2), w: exe.s16(r + 4), h: exe.s16(r + 6) },
    labelBlock: label, labelPos: { x: exe.s16(0x5b416 + label * 4), y: exe.s16(0x5b418 + label * 4) },
    neighbors: Array.from({ length: 8 }, (_, k) => exe.u8(r + 9 + k)).filter(Boolean).map((v) => v - 1),
  });
}
json('data/territories.json', territories);

// Animación de personas (SPEC §5.4): desplazamiento por arma equipada (0..19) para cada
// postura; las tablas "agent" se usan cuando el conjunto de animación vale 1.
const animTable = (va) => Array.from({ length: 20 }, (_, i) => exe.u16(va + i * 2));
json('data/person-animations.json', {
  stand: animTable(0x5a546), walk: animTable(0x5a56e), fire: animTable(0x5a596),
  agentStand: animTable(0x5a5e6), agentWalk: animTable(0x5a60e), agentFire: animTable(0x5a636),
});

// Arma de los agentes enemigos: pares (prioridad, tipo) hasta tipo 0; se elige la de mayor
// prioridad ya investigada (SPEC §7.3, `0x15660`).
{
  const pairs = [];
  for (let i = 0; i < 32 && exe.u8(0x53ec1 + i * 2); i++) pairs.push({ priority: exe.u8(0x53ec0 + i * 2), weapon: exe.u8(0x53ec1 + i * 2) });
  json('data/enemy-weapons.json', pairs);
}
// Tabla "arma armada" (0x5a686) usada para la lista de visibles (SPEC §7.1).
json('data/weapon-armed.json', Array.from({ length: 20 }, (_, i) => exe.u8(0x5a686 + i)));

const agentNames = Array.from({ length: 69 }, (_, i) => exe.cstr(exe.u32(0x5b844 + i * 4)));
json('data/agent-names.json', agentNames);
json('data/level-palettes.json', Array.from({ length: 51 }, (_, l) => exe.u8(0x54170 + l)));

// Todas las cadenas imprimibles del objeto de datos, con su dirección: base para textos de UI.
{
  const all = {};
  const o = exe.objects[1];
  let s = '', start = 0;
  for (let va = o.base; va < o.base + o.size; va++) {
    const ch = exe.u8(va);
    if (ch >= 0x20 && ch < 0x7f) { if (!s) start = va; s += String.fromCharCode(ch); }
    else { if (ch === 0 && s.length >= 2) all['0x' + start.toString(16)] = s; s = ''; }
  }
  json('data/strings.json', all);
}
// ---------------------------------------------------------------- interfaz (SPEC §12.1–12.3)
{
  const one = (va) => strings3(va, 1)[0];
  const label = Object.fromEntries(Object.entries({
    mainMenu: 0x5454c, loadSave: 0x54558, missionBrief: 0x54570, researchTitle: 0x54588, debriefTitle: 0x54594,
    accept: 0x545a0, menu: 0x545ac, cancel: 0x545c4, brief: 0x545d0, research: 0x545dc, mods: 0x545f4, equip: 0x54600,
    fundingUp: 0x54630, fundingDown: 0x5463c, info: 0x54648, enhance: 0x54654, map: 0x54678, replay: 0x54684,
    pop: 0x5469c, stat: 0x546a8, tax: 0x546b4, own: 0x546c0, unknown: 0x546cc,
    veryHappy: 0x546d8, happy: 0x546e4, content: 0x546f0, unhappy: 0x546fc, discontent: 0x54708, rebellious: 0x54714,
    minFunding: 0x54810, maxFunding: 0x5481c, loggingOut: 0x54834, loadingGame: 0x5484c,
    missionStatus: 0x54858, completed: 0x54864, withdrew: 0x54870, failed: 0x5487c, agentsUsed: 0x54888,
    newAgents: 0x54894, timeInMission: 0x548a0, enemyAgents: 0x548d0, criminals: 0x548dc, civilians: 0x548e8,
    police: 0x548f4, guards: 0x54900, persuaded: 0x5490c, accuracy: 0x54918, noBullets: 0x54924,
    newWeaponry1: 0x5493c, newWeaponry2: 0x54948, statistics: 0x54954,
    cost: 0x547a4, ammo: 0x547b0, range: 0x547bc, shot: 0x547c8, reload: 0x547d4, purchase: 0x54618, sell: 0x5460c, load: 0x54660, save: 0x5466c,
    team: 0x545e8, cryoChamber: 0x543fc, empty: 0x54720,
    // CONFIGURE COMPANY (`0x175c0`, `0x18250`)
    selectDetail: 0x54738, colourAndLogo: 0x54744, companyName: 0x54750, yourName: 0x5475c,
    changeColourLogo: 0x54768, colour: 0x54774, logo: 0x54780, changeCompanyName: 0x5478c, enterYourName: 0x54798, ok: 0x545b8,
  }).map(([k, va]) => [k, one(va)]));
  json('data/ui.json', {
    labels: label,
    mainMenuItems: strings3(0x54c00, 6),
    modDescriptions: strings3(0x54960, 18),
    modDescIndex: Array.from({ length: 18 }, (_, i) => exe.u8(0x55780 + i * 0x1eb + 5)),
    syndicateColors: Array.from({ length: 8 }, (_, i) => exe.u8(0x5b46a + i)),
    labelBlocks: Array.from({ length: 21 }, (_, i) => ({ x: exe.s16(0x5b416 + 4 * i), y: exe.s16(0x5b418 + 4 * i) })),
    screenAnims: Array.from({ length: 12 }, (_, i) => exe.cstr(exe.u32(0x5b4c0 + 4 * i))),
  });
  out('gfx/map-masks.bin', read('MMAPBLK.DAT'));
  out('gfx/logos.bin', read('MLOGOS.DAT'));
  out('gfx/mconscr.bin', read('MCONSCR.DAT'));     // fondo de CONFIGURE COMPANY sin recuadros (SPEC §12.2)
  out('gfx/mini-logos.bin', read('MMINLOGO.DAT'));
}
log(`tablas: ${weapons.length} armas, ${mods.length} mejoras, ${territories.length} territorios, ${agentNames.length} nombres`);

// ---------------------------------------------------------------- briefings
{
  const briefs = {};
  for (const n of fs.readdirSync(DATA).filter((n) => /^MISS\d+\.DAT$/i.test(n))) {
    const id = n.match(/MISS(\d+)/i)[1];
    const lang = id.length === 3 ? LANGS[+id[0]] ?? id[0] : 'en', mission = +(id.length === 3 ? id.slice(1) : id);
    const parts = Buffer.from(read(n)).toString('latin1').split('|').map((p) => p.replace(/\r/g, '').replace(/^\n+|\s+$/g, ''));
    const nums = (p) => p.split('\n').map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v));
    const raw = Buffer.from(read(n)).toString('latin1').replaceAll(String.fromCharCode(13), '');
    const marks = parts[1].split('\n').filter((l) => /\d/.test(l));
    (briefs[mission] ??= {})[lang] = {
      infoCosts: nums(parts[0]), enhanceCosts: nums(parts[1]), sections: parts.slice(2).filter(Boolean),
      // Marcas de ENHANCE (`0x10e60`): «O» objetivos y «A» todas las personas en el minimapa.
      enhanceMarks: { objectives: marks.findIndex((l) => /O\s*$/.test(l)), all: marks.findIndex((l) => /A\s*$/.test(l)) },
      text: raw.slice(raw.indexOf('|', raw.indexOf('|') + 1) + 2),
    };
  }
  json('data/briefings.json', briefs);
  log(`briefings: ${Object.keys(briefs).length} misiones`);
}

// ---------------------------------------------------------------- mapas y niveles
const levels = [];
for (const n of fs.readdirSync(DATA).filter((n) => /^GAME\d\d\.DAT$/i.test(n)).sort()) {
  const id = +n.slice(4, 6);
  const level = decodeLevel(read(n));
  json(`levels/game${String(id).padStart(2, '0')}.json`, level);
  levels.push({ id, map: level.map, people: level.people.length, objectives: level.objectives.length });
}
const maps = new Set();
for (const n of fs.readdirSync(DATA).filter((n) => /^MAP\d\d\.DAT$/i.test(n))) {
  const id = +n.slice(3, 5), buf = read(n), dv = new DataView(buf.buffer, buf.byteOffset);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true), d = dv.getUint32(8, true);
  const tiles = new Uint8Array(w * h * d);
  for (let c = 0; c < w * h; c++) { const at = 12 + dv.getUint32(12 + c * 4, true); tiles.set(buf.subarray(at, at + d), c * d); }   // offsets relativos al fin de la cabecera de 12 B
  json(`maps/map${String(id).padStart(2, '0')}.json`, { width: w, height: h, depth: d, layout: 'tiles[(y*width+x)*depth+z]', tiles: Buffer.from(tiles).toString('base64') });
  maps.add(id);
}
json('levels/index.json', levels);
log(`niveles: ${levels.length}, mapas: ${maps.size}`);

// ---------------------------------------------------------------- señales de animación (SPEC §13.1)
{
  // MAIN.EXE: registros de 4 B {fotograma u16, orden u8, argumento u8} hasta FFFF (`0x3ba60`).
  const cues4 = (va) => {
    const list = [];
    for (let a = va; exe.u16(a) !== 0xffff; a += 4) list.push({ frame: exe.u16(a), cmd: String.fromCharCode(exe.u8(a + 2)), arg: exe.u8(a + 3) });
    return list;
  };
  const cues = { mendlose: cues4(0x5bb94), mgamewin: cues4(0x5bbb4), mlosegam: cues4(0x5bbc8), mendwin: cues4(0x5bbd4) };
  // INTRO.EXE: registros de 7 B {fotograma u16, orden u8, argumento u32} (`0x105dc`) y subtítulos (`0x20ed8`).
  const introPath = path.join(SRC, 'INTRO.EXE');
  if (fs.existsSync(introPath)) {
    const intro = new LeImage(new Uint8Array(fs.readFileSync(introPath)));
    const list = [];
    for (let a = 0x20abc; intro.u16(a) !== 0xffff; a += 7) list.push({ frame: intro.u16(a), cmd: String.fromCharCode(intro.u8(a + 2)), arg: intro.u32(a + 3) });
    const maxText = Math.max(...list.filter((c) => c.cmd === 'T').map((c) => c.arg));
    const subtitles = Array.from({ length: maxText + 1 }, (_, i) => Object.fromEntries(LANGS.map((l, k) => [l, intro.cstr(intro.u32(0x20ed8 + (i * 3 + k) * 4))])));
    cues.intro = list;
    json('data/intro.json', { subtitles });
  }
  json('data/anim-cues.json', cues);
  log(`señales: ${Object.keys(cues).map((k) => `${k} ${cues[k].length}`).join(', ')}`);
}

// ---------------------------------------------------------------- sonido
for (const [set, dat, tab] of [['sfx0', 'SOUND-0.DAT', 'SOUND-0.TAB'], ['sfx1', 'SOUND-1.DAT', 'SOUND-1.TAB'], ['gsfx0', 'GSOUND-0.DAT', 'GSOUND-0.TAB'], ['isnds0', 'ISNDS-0.DAT', 'ISNDS-0.TAB'], ['isnds1', 'ISNDS-1.DAT', 'ISNDS-1.TAB']]) {
  if (!exists(dat)) continue;
  const data = read(dat), t = read(tab), dv = new DataView(t.buffer, t.byteOffset, t.byteLength), index = [];
  for (let i = 1; i * 32 + 32 <= t.length; i++) {
    const off = dv.getUint32(i * 32 + 18, true), size = dv.getUint32(i * 32 + 26, true);
    if (!size) { index.push(null); continue; }
    try { const voc = decodeVoc(data.subarray(off, off + size)); out(`audio/${set}/${i}.wav`, encodeWav(voc)); index.push({ file: `audio/${set}/${i}.wav`, rate: voc.rate, samples: voc.samples.length }); }
    catch { index.push(null); }
  }
  json(`audio/${set}.json`, index);
  log(`sonido ${set}: ${index.filter(Boolean).length}`);
}
for (const n of ['SYNGAME.XMI', 'INTRO.XMI']) {
  if (!exists(n)) continue;
  const mids = xmiToMidi(read(n));
  mids.forEach((m, i) => out(`audio/music/${n.replace('.XMI', '').toLowerCase()}-${i}.mid`, m));
  log(`música ${n}: ${mids.length} secuencias`);
}

json('manifest.json', { generated: new Date().toISOString(), source: SRC, note: 'Extraído de la instalación del usuario. No redistribuir.' });
log('listo: ' + OUT);
