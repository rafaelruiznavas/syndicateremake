// Carga de recursos extraídos (assets/). Los atlas PNG son indexados (R = índice de
// paleta, A = 0 transparente); aquí se recolorean con la paleta de la misión.

import { addSpanish } from '../i18n/spanish.js';

async function loadJson(base, path) {
  const r = await fetch(`${base}/${path}`);
  if (!r.ok) throw new Error(`No se pudo cargar ${path} (¿has ejecutado tools/extract-assets.mjs?)`);
  return r.json();
}

async function loadBinary(base, path) {
  const r = await fetch(`${base}/${path}`);
  if (!r.ok) throw new Error(`No se pudo cargar ${path}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function loadIndexed(base, path) {
  const img = new Image();
  img.src = `${base}/${path}`;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/** Atlas indexado → canvas en color con `palette` ([[r,g,b]]). */
export function colorize(indexed, palette) {
  const out = new ImageData(indexed.width, indexed.height);
  const src = indexed.data, dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    if (!src[i + 3]) continue;
    const [r, g, b] = palette[src[i]];
    dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = 255;
  }
  const c = new OffscreenCanvas(indexed.width, indexed.height);
  c.getContext('2d').putImageData(out, 0, 0);
  return c;
}


export class Assets {
  constructor(base = 'assets') { this.base = base; this.cache = new Map(); }

  async loadCommon() {
    const b = this.base;
    [this.palettes, this.blocksInfo, this.sprites, this.tileClasses, this.weapons, this.personAnims,
      this.levelPalettes, this.pointersInfo, this.enemyWeapons, this.weaponArmed, this.agentNames,
      this.mods, this.territories, this.briefings, this.ui, this.menuSpritesInfo, this.animIndex, this.animCues, this.intro, this.menuFontInfo] = await Promise.all([
      loadJson(b, 'palettes.json'), loadJson(b, 'gfx/blocks.json'), loadJson(b, 'gfx/sprites.json'),
      loadJson(b, 'data/tile-classes.json'), loadJson(b, 'data/weapons.json'), loadJson(b, 'data/person-animations.json'),
      loadJson(b, 'data/level-palettes.json'), loadJson(b, 'gfx/pointers.json'),
      loadJson(b, 'data/enemy-weapons.json'), loadJson(b, 'data/weapon-armed.json'), loadJson(b, 'data/agent-names.json'),
      loadJson(b, 'data/mods.json'), loadJson(b, 'data/territories.json'), loadJson(b, 'data/briefings.json'),
      loadJson(b, 'data/ui.json'), loadJson(b, 'gfx/menu-sprites.json'), loadJson(b, 'anims/index.json'),
      loadJson(b, 'data/anim-cues.json'), loadJson(b, 'data/intro.json'), loadJson(b, 'gfx/menu-font.json'),
    ]);
    [this.blocksIndexed, this.spritesIndexed, this.pointersIndexed, this.menuSpritesIndexed,
      this.mapMasks, this.logos, this.miniLogos, this.missionFontData, this.menuFontIndexed, this.configBackground] = await Promise.all([
      loadIndexed(b, 'gfx/blocks.png'), loadIndexed(b, 'gfx/sprites.png'), loadIndexed(b, 'gfx/pointers.png'),
      loadIndexed(b, 'gfx/menu-sprites.png'), loadBinary(b, 'gfx/map-masks.bin'), loadBinary(b, 'gfx/logos.bin'),
      loadBinary(b, 'gfx/mini-logos.bin'), loadBinary(b, 'gfx/hfnt01.bin'), loadIndexed(b, 'gfx/menu-font.png'),
      loadBinary(b, 'gfx/mconscr.bin'),
    ]);
    this.flics = new Map();
    addSpanish(this);                // cuarto idioma [DIS] (src/i18n)
  }

  /** Animación FLIC por nombre (mmap, mbrief…); se cachea el fichero. */
  async flic(name) {
    if (!this.flics.has(name)) this.flics.set(name, loadBinary(this.base, `anims/${name}.flc`));
    return this.flics.get(name);
  }

  level(n) { return loadJson(this.base, `levels/game${String(n).padStart(2, '0')}.json`); }
  map(n) { return loadJson(this.base, `maps/map${String(n).padStart(2, '0')}.json`); }

  /** Atlas en color para la paleta de una misión (se cachean por nombre de paleta). */
  graphicsFor(paletteName) {
    if (!this.cache.has(paletteName)) {
      const pal = this.palettes[paletteName];
      this.cache.set(paletteName, {
        palette: pal,
        blocks: colorize(this.blocksIndexed, pal),
        sprites: colorize(this.spritesIndexed, pal),
        pointers: colorize(this.pointersIndexed, pal),
      });
    }
    return this.cache.get(paletteName);
  }

  paletteForMission(mission) {
    const n = this.levelPalettes[mission] || 1;
    return `hpal0${n}`;
  }
}
