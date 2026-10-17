// Mapa mundial (SPEC §9.4, §12.2; `0x27e00`, `0x28610`, `0x28e90`, `0x28af0`, `0x28490`).

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';
import { PLAYER } from '../campaign/territories.js';

const MASK_W = 64, MASK_H = 44, MASK_SIZE = MASK_W * MASK_H;
const MINI = 16;
const MOODS = [[0x2f, 'veryHappy'], [0x5f, 'happy'], [0xa0, 'content'], [0xd1, 'unhappy'], [0xfe, 'discontent'], [Infinity, 'rebellious']];

export class MapScene extends MenuScreen {
  constructor(game) {
    super(game, { anim: 'mmap', out: 'mmapout' });
  }

  /** Territorio elegido (`0x55030`), que se conserva entre visitas al mapa. */
  get selected() { return this.campaign.mapSelection; }
  set selected(i) { this.campaign.mapSelection = i; }

  get territories() { return this.campaign.territories; }
  color(syndicate) { return this.game.assets.ui.syndicateColors[this.campaign.colourOf(syndicate)] ?? 0; }

  /** Territorio bajo el punto: dentro de rect.x … +0x80 × rect.y … +0x58 y máscara ≠ 0 (`0x28490`). */
  territoryAt(x, y) {
    const masks = this.game.assets.mapMasks;
    for (const [i, t] of this.territories.list.entries()) {
      const r = t.info.rect;
      if (!(x > r.x && x < r.x + 0x80 && y > r.y && y < r.y + 0x58)) continue;
      if (masks[i * MASK_SIZE + ((x - r.x) >> 1) + ((y - r.y) >> 1) * MASK_W]) return i;
    }
    return -1;
  }

  paint(vga, i, color) {
    const r = this.territories.get(i).info.rect;
    vga.mask(this.game.assets.mapMasks, i * MASK_SIZE, MASK_W, MASK_H, r.x >> 1, r.y >> 1, color);
  }

  draw(vga) {
    const c = this.campaign, list = this.territories.list;
    for (const [i, t] of list.entries()) this.paint(vga, i, this.color(t.owner));
    // `0x28af0`: parpadeo de los vecinos elegibles del territorio propio y de las rebeliones.
    const blink = (this.frame & 4) !== 0;
    const sel = list[this.selected];
    if (sel.owner === PLAYER && !sel.rebel) {
      for (const n of sel.info.neighbors) if (c.eligible(n)) this.paint(vga, n, blink ? 0 : this.color(list[n].owner));
    }
    for (const [i, t] of list.entries()) if (t.rebel) this.paint(vga, i, blink ? 0 : this.color(PLAYER));

    this.drawLogo(vga);
    this.drawClock(vga);
    this.drawInfo(vga, sel);
    // Etiqueta del territorio elegido (`0x27e00`): línea animada, marco y el mini‑logo de la
    // compañía del jugador (MMINLOGO con su logo y su color, `0x186f0`), encima del logo grande.
    const lp = sel.info.labelPos, r = sel.info.rect;
    vga.line((lp.x + 8) * 2, (lp.y + 8) * 2, r.x + r.w, r.y + r.h, 0x58, { b: 0xfc, phase: -this.frame });
    vga.frame((lp.x - 1) * 2, (lp.y - 1) * 2, (lp.x + 16) * 2, (lp.y + 16) * 2, 0xfc);
    vga.mask(this.game.assets.miniLogos, c.logo * MINI * MINI, MINI, MINI, lp.x, lp.y, this.color(PLAYER), 0);
    if (c.eligible(this.selected)) this.button(vga, 'brief', 0x10, 0x15a, 0x92, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
  }

  drawInfo(vga, t) {
    const g = this.gfx, name = t.info.name[this.lang];
    g.text(vga, name, Math.trunc((0x118 - g.width(name, FONT.SMALL)) / 2) + 0xb8, 0x13a, FONT.SMALL);
    g.text(vga, this.label('pop'), 0xc2, 0x14e, FONT.HOT);
    g.text(vga, String(t.population), 0x10c, 0x14e, FONT.SMALL);
    g.text(vga, this.label('tax'), 0xc2, 0x15c, FONT.HOT);
    const known = t.owner === PLAYER || t.rebel;
    if (known) {
      const income = Math.trunc((Math.trunc(t.population / 1_000_000) * 14 * t.nextTax) / 10);
      g.text(vga, String(income), 0x10c, 0x15c, FONT.SMALL);
      g.text(vga, '@', 0x160, 0x15c, FONT.SMALL);
      g.text(vga, `${t.nextTax}%`, 0x184, 0x15c, FONT.SMALL);
      if (t.owner === PLAYER && !t.rebel) { g.sprite(vga, 11, 0x176, 0x15a); g.sprite(vga, 12, 0x1b4, 0x15a); }
      g.text(vga, this.label('stat'), 0xc2, 0x16a, FONT.HOT);
      g.text(vga, this.label(MOODS.find(([lim]) => t.discontent < lim)[1]), 0x10c, 0x16a, FONT.SMALL);
    } else {
      g.text(vga, this.label('unknown'), 0x10c, 0x15c, FONT.SMALL);
      g.text(vga, this.label('own'), 0xc2, 0x16a, FONT.HOT);    // [DES] nombre del sindicato rival
    }
  }

  click({ x, y, button }) {
    const c = this.campaign;
    const step = button === 'right' ? 10 : 1;
    if (y > 0x158 && y < 0x166) {
      if (x > 0x176 && x < 0x180) { c.territories.changeTax(this.selected, -step); return; }
      if (x > 0x1b4 && x < 0x1be) { c.territories.changeTax(this.selected, +step); return; }
    }
    if (button !== 'left') return;
    const t = this.territoryAt(x, y);
    if (t >= 0) this.selected = t;
    if (this.hot(0x10, 0x15a, 0x92, 0x174, { x, y })) this.brief();
    else if (this.hot(500, 0x15a, 0x274, 0x174, { x, y })) this.exit(() => this.game.go('menu'));
  }

  key(code) {
    if (code === 'Enter') { this.brief(); return true; }
    if (code === 'Escape') { this.exit(() => this.game.go('menu')); return true; }
    return false;
  }

  brief() {
    if (this.campaign.chooseTerritory(this.selected)) this.exit(() => this.game.go('briefing'));
  }
}
