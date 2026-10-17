// MISSION BRIEF (SPEC §9.5, §12.2; `0x10e60`, `0x38c90`, `0x11a70`): texto paginado,
// compras de INFO y ENHANCE por territorio y minimapa con el zoom de ENHANCE.

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';
import { TileMap } from '../world/map.js';
import { PersonKind } from '../entities/person.js';

const TEXT = { x: 0x18, y: 0x5a, w: 0x1d6, h: 0xd0, lineHeight: 0x10 };
const MINIMAP = { x: 500, y: 0xd8, size: 0x80 };
const MAP_W = 0x80, MAP_H = 0x60;
/** Color del minimapa por clase COL01 de la casilla en z = 0; las demás no se pintan. */
const CLASS_COLOR = { 1: 15, 2: 15, 3: 15, 4: 15, 13: 15, 5: 7, 14: 7, 6: 10, 7: 10, 8: 10, 9: 10, 11: 10, 15: 10, 10: 0 };

export class BriefingScene extends MenuScreen {
  constructor(game) {
    super(game, { anim: 'mbrief', out: 'mbrieout' });
    this.pages = [0];
    this.page = 0;
  }

  async enter() {
    const a = this.game.assets, c = this.campaign;
    this.level = await a.level(c.briefing.mission);
    this.tiles = new TileMap(await a.map(this.level.map), a.tileClasses);
    const first = this.level.people[0];
    this.view = { x: first.x >> 8, y: first.y >> 8 };
    this.targets = new Set(this.level.objectives.filter((o) => o.target?.pool === 'people').map((o) => o.target.index));
    await super.enter();
  }

  get state() { return this.campaign.briefState; }

  draw(vga) {
    const g = this.gfx, c = this.campaign;
    g.title(vga, this.label('missionBrief'));
    this.drawClock(vga);
    this.drawLogo(vga);
    this.button(vga, 'accept', 0x10, 0x15a, 0x92, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
    this.button(vga, 'map', 0x94, 0x15a, 0xf6, 0x172);
    this.button(vga, 'info', 500, 0x6c, 0x272, 0x9e);
    this.button(vga, 'enhance', 500, 0xa2, 0x272, 0xd4);
    this.drawFunds(vga, 0x58);
    const info = c.briefCost('info'), enh = c.briefCost('enhance');
    if (info) this.centeredNumber(vga, info, 0x8e);
    if (enh) this.centeredNumber(vga, enh, 0xc4);

    const text = c.briefingText(this.lang);
    const next = g.textBox(vga, text, this.pages[this.page], TEXT.x, TEXT.y, TEXT.w, TEXT.h, FONT.HOT, TEXT.lineHeight);
    this.hasNext = next >= 0;
    if (this.hasNext) this.pages[this.page + 1] = next;
    if (this.page > 0) g.sprite(vga, this.hot(0x1ac, 0x13c, 0x1ca, 0x152) ? 0x50 : 0x52, 0x1ac, 0x13c);
    if (this.hasNext) g.sprite(vga, this.hot(0x1ce, 0x13c, 0x1ec, 0x152) ? 0x4f : 0x51, 0x1ce, 0x13c);
    this.drawMinimap(vga);
  }

  centeredNumber(vga, n, y) {
    const s = String(n);
    this.gfx.text(vga, s, Math.trunc((0x7c - this.gfx.width(s, FONT.HOT)) / 2) + 500, y, FONT.HOT);
  }

  /** Minimapa (`0x11a70`): zoom (5 − ENHANCE)·2 unidades por casilla. */
  drawMinimap(vga) {
    const zoom = (5 - this.state.enhance) * 2, n = Math.trunc(MINIMAP.size / zoom);
    const x0 = Math.max(0, Math.min(MAP_W - n, this.view.x - (n >> 1)));
    const y0 = Math.max(0, Math.min(MAP_H - n, this.view.y - (n >> 1)));
    const pad = (MINIMAP.size - n * zoom) >> 1;
    vga.fillRect(MINIMAP.x, MINIMAP.y, MINIMAP.size, MINIMAP.size, 8);
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
      const tile = this.tiles.tileAt(x0 + tx, y0 + ty, 0);
      const color = CLASS_COLOR[this.tiles.classes[tile]];
      if (color !== undefined) vga.fillRect(MINIMAP.x + pad + tx * zoom, MINIMAP.y + pad + ty * zoom, zoom, zoom, color);
    }
    const b = this.campaign.briefData();
    const showAll = b && b.enhanceMarks.all >= 0 && this.state.enhance > b.enhanceMarks.all;
    const showTargets = b && b.enhanceMarks.objectives >= 0 && this.state.enhance > b.enhanceMarks.objectives;
    for (const p of this.level.people) {
      if (p.hidden) continue;
      const own = p.index < 8, target = this.targets.has(p.index);
      if (!(p.kind & PersonKind.AGENT) && !(target && showTargets)) continue;
      if (!own && !showAll && !(target && showTargets)) continue;
      const tx = (p.x >> 8) - x0, ty = (p.y >> 8) - y0;
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      vga.fillRect(MINIMAP.x + pad + tx * zoom, MINIMAP.y + pad + ty * zoom, zoom, zoom, target && showTargets ? 14 : own ? 12 : 6);
    }
    vga.frame(MINIMAP.x, MINIMAP.y, 0x272, 0x156, 0x18);
  }

  /** Mantener pulsado sobre los bordes del minimapa lo desplaza ENHANCE + 1 casillas. */
  tick() {
    const m = this.mouse;
    if (!this.game.input.buttons.left || !this.hot(500, 0xd8, 0x274, 0x158)) return;
    const step = this.state.enhance + 1;
    if (m.y < 0x102) this.view.y = Math.max(0, this.view.y - step);
    if (m.y > 0x12e) this.view.y = Math.min(0x5f, this.view.y + step);
    if (m.x < 0x21e) this.view.x = Math.max(0, this.view.x - step);
    if (m.x > 0x24a) this.view.x = Math.min(0x7f, this.view.x + step);
  }

  click(e) {
    const c = this.campaign, at = (x0, y0, x1, y1) => this.hot(x0, y0, x1, y1, e);
    if (this.page > 0 && at(0x1ac, 0x13c, 0x1ca, 0x152)) this.page--;
    else if (this.hasNext && at(0x1ce, 0x13c, 0x1ec, 0x152)) this.page++;
    else if (at(500, 0x6c, 0x270, 0x9e)) { c.buyBriefing('info'); this.pages = [0]; this.page = 0; }
    else if (at(500, 0xa2, 0x270, 0xd4)) c.buyBriefing('enhance');
    else if (at(0x10, 0x15a, 0x92, 0x174)) this.exit(() => this.game.go('cryo', { mission: true }));
    else if (at(500, 0x15a, 0x274, 0x174)) this.exit(() => this.game.go('menu'));
    else if (at(0x94, 0x15a, 0xfc, 0x172)) this.exit(() => this.game.go('map'));
  }

  key(code) {
    if (code === 'Enter') { this.exit(() => this.game.go('cryo', { mission: true })); return true; }
    if (code === 'Escape') { this.exit(() => this.game.go('menu')); return true; }
    return false;
  }
}
