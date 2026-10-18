// Panel de la misión con los gráficos del original (SPEC §12.3; `0x2d0e0`, `0x2e4a0`,
// `0x2ee30`, `0x1e1c0`, `0x2c510`; tablas `0x55112`, `0x55190`, `0x55256`). Cada elemento es
// la animación HSTA `0xd4 + base`, con +2 cuando está seleccionado.

import { PANEL_WIDTH, SCREEN_HEIGHT } from '../core/constants.js';
import { Scanner, SCANNER, BLIP_ROWS, circlePoints } from './scanner.js';
import { remakeText } from '../i18n/es-ui.js';

export { SCANNER };

const PANEL_ANIM = 0xd4;
export const AGENT_BOXES = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 100 }, { x: 64, y: 100 }];
export const BOX_W = 64, BOX_H = 46;
export const GROUP_BAR = { x: 0, y: 90, w: 128, h: 8, base: 0x3d };
export const INVENTORY = { x: 0, y: 208, w: 32, h: 32, cols: 4, rows: 2, base: 0x49 };
/** Barras bajo cada caja: desplazamiento y, colores claro/oscuro (adrenalina, percepción, inteligencia). */
export const BARS = [
  { name: 'adrenaline', dy: 0x30, light: 14, dark: 6 },
  { name: 'perception', dy: 0x3e, light: 15, dark: 7 },
  { name: 'intelligence', dy: 0x4c, light: 13, dark: 5 },
];
const BAR_X = 4, BAR_W = 55, BAR_H = 10;
/** Zonas de clic de las barras (`0x2d610`): filas de 14 px desde y+0x2E, x+4..x+0x3B. */
const BAR_HIT = { y: 0x2e, h: 0x0e, w: 0x38 };
const MESSAGE = { x: 0, y: 190, chars: 16 };
const BLIP_SIZE = 3, BLIP_SIZE_BORDER = 4;

export class Hud {
  /** @param {import('./renderer.js').Renderer} renderer  @param {import('../ui/mission-font.js').MissionFont} font */
  constructor(ctx, weapons, renderer, font, names) {
    this.ctx = ctx; this.weapons = weapons; this.renderer = renderer; this.font = font; this.names = names;
    this.frame = 0;
    this.scanner = new Scanner();
    this.lang = 'en';
  }

  color(i) { const c = this.renderer.gfx.palette[i] ?? [0, 0, 0]; return `rgb(${c[0]},${c[1]},${c[2]})`; }
  rect(x, y, w, h, i) { this.ctx.fillStyle = this.color(i); this.ctx.fillRect(x, y, w, h); }
  anim(base, x, y) {
    const f = this.renderer.sprites.anims[PANEL_ANIM + base];
    if (f) this.renderer.drawFrame(f, x, y);
  }

  /** Elemento del panel bajo (x, y). */
  hit(x, y) {
    if (x >= PANEL_WIDTH) return null;
    for (let i = 0; i < 4; i++) {
      const b = AGENT_BOXES[i];
      if (x >= b.x && x < b.x + BOX_W && y >= b.y && y < b.y + BOX_H) return { type: 'agent', index: i };
      const bx = b.x + BAR_X, row = Math.floor((y - b.y - BAR_HIT.y) / BAR_HIT.h);
      if (x >= bx && x < bx + BAR_HIT.w && row >= 0 && row < BARS.length) {
        return { type: 'bar', index: i, bar: BARS[row].name, level: Math.max(0, Math.min(255, Math.trunc(((x - bx) * 0x100) / 0x37))) };
      }
    }
    if (y >= GROUP_BAR.y && y < GROUP_BAR.y + GROUP_BAR.h) return { type: 'group' };
    if (y >= INVENTORY.y && y < INVENTORY.y + INVENTORY.rows * INVENTORY.h) {
      return { type: 'slot', index: Math.floor((y - INVENTORY.y) / INVENTORY.h) * INVENTORY.cols + Math.floor(x / INVENTORY.w) };
    }
    if (x < SCANNER.x + SCANNER.w && y >= SCANNER.y && y < SCANNER.y + SCANNER.h) return { type: 'scanner', x: x - SCANNER.x, y: y - SCANNER.y };
    return null;
  }

  render(world, hoverItem = null) {
    this.frame++;
    this.rect(0, 0, PANEL_WIDTH, SCREEN_HEIGHT, 0);
    world.squad.forEach((agent, i) => this.renderAgent(world, agent, i));
    this.anim(GROUP_BAR.base + (world.groupSelected ? 2 : 0), GROUP_BAR.x, GROUP_BAR.y);
    this.renderInventory(world.leader);
    this.renderScanner(world);
    this.renderMessage(world, hoverItem);
  }

  renderAgent(world, agent, i) {
    const b = AGENT_BOXES[i];
    this.anim(4 * i + (world.selection.has(agent) ? 2 : 0), b.x, b.y);
    if (agent.dead) return;
    // Figura del agente con su animación actual, reteñida (`0x1e1c0`).
    this.renderer.drawFrame(agent.frame, b.x + 0x20, b.y + 0x26, world.recolorFor(agent));
    const hp = Math.max(0, Math.min(16, agent.health)), h = Math.trunc((hp * 36) / 16);
    this.rect(b.x + 0x34, b.y + 6 + 36 - h, 6, h, 12);
    for (const bar of BARS) {
      const v = agent[bar.name];
      if (!v) continue;
      const y = b.y + bar.dy, x = b.x + BAR_X;
      // `0x2ee30`: del neutro al nivel pedido en claro y del neutro al valor real en oscuro;
      // primero el tramo más largo y encima el otro. Marca del neutro en color 12.
      const px = (u) => Math.trunc((u * BAR_W) / 255);
      const n = px(v.neutral), l = px(v.level), a = px(v.actual ?? v.level);
      const span = (to, color) => this.rect(x + Math.min(n, to), y, Math.abs(to - n), BAR_H, color);
      this.rect(x, y, BAR_W, BAR_H, 0);
      if ((n < l && a < l) || (l < n && l < a)) { span(l, bar.light); span(a, bar.dark); }
      else { span(a, bar.dark); span(l, bar.light); }
      this.rect(x + n, y, 1, BAR_H, 12);
    }
  }

  renderInventory(lead) {
    for (let s = 0; s < INVENTORY.cols * INVENTORY.rows; s++) {
      const x = INVENTORY.x + (s % INVENTORY.cols) * INVENTORY.w, y = INVENTORY.y + Math.floor(s / INVENTORY.cols) * INVENTORY.h;
      const it = lead?.items[s];
      if (!it) { this.anim(INVENTORY.base, x, y); continue; }
      this.anim(INVENTORY.base + 2 + 4 * (it.weapon - 1) + (lead.equipped === it ? 2 : 0), x, y);
      const max = this.weapons.fullAmmo(it.weapon);
      if (max > 0) {
        this.rect(x + 4, y + 0x18, 0x17, 4, 8);
        const w = Math.min(0x17, Math.trunc(((it.ammo + 1) * 0x17) / (max + 1)));
        if (w > 0) this.rect(x + 4, y + 0x18, w, 4, 14);
      }
    }
  }

  /** Escáner (`0x1bec0`, SPEC §12.3): recortado a su recuadro. */
  renderScanner(world) {
    const s = SCANNER, g = this.ctx;
    this.rect(s.x, s.y, s.w, s.h, 0);
    const focus = world.leader ?? world.squad.find((a) => !a.dead);
    if (!focus) return;
    const zoom = Scanner.zoom(world), view = this.scanner.layout(world, focus, zoom);
    g.save();
    g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip();
    for (const c of view.cells) this.rect(s.x + c.x, s.y + c.y, c.size, c.size, c.color);
    for (const q of view.squares) this.rect(s.x + q.x, s.y + q.y, q.size, q.size, q.color);
    if (view.cross) { this.rect(s.x + view.cross.x, s.y, 1, s.h, 0); this.rect(s.x, s.y + view.cross.y, s.w, 1, 0); }
    for (const b of view.blips) this.blip(s.x + b.x, s.y + b.y, BLIP_SIZE_BORDER, (b.color + 8) & 0xf);
    for (const b of view.blips) this.blip(s.x + b.x, s.y + b.y, BLIP_SIZE, b.color);
    const blink = (this.frame >> 2) & 1;        // [INF] periodo del parpadeo `0x5e397`
    for (const c of this.scanner.beacon(world, focus, zoom, blink)) {
      g.fillStyle = this.color(c.color);
      for (const [dx, dy] of circlePoints(c.r)) g.fillRect(s.x + c.x + dx, s.y + c.y + dy, 1, 1);
    }
    g.restore();
  }

  /** Punto redondeado de líneas horizontales (`0x1b5d0`). */
  blip(x, y, size, color) {
    const rows = BLIP_ROWS[size];
    rows.forEach((hw, dy) => {
      this.rect(x - hw, y + dy, 2 * hw + 1, 1, color);
      if (dy) this.rect(x - hw, y - dy, 2 * hw + 1, 1, color);
    });
  }

  /** Línea de mensajes de 16 caracteres con HFNT01 (`0x2c510`): arma bajo el cursor o estado. */
  renderMessage(world, hoverItem) {
    let text = '';
    if (hoverItem) text = this.names?.[hoverItem.weapon - 1] ?? '';
    else if (!world.objectives.running && (this.frame & 0x10)) text = remakeText(world.objectives.status === 2 ? 'missionComplete' : 'missionFailed', this.lang);
    if (text && this.font) this.font.draw(this.ctx, text.slice(0, MESSAGE.chars), MESSAGE.x + 2, MESSAGE.y, this.color(14));
  }
}
