// RESEARCH (SPEC §9.3, §12.2; `0x34ad0`, tabla de botones `0x5b6a0`): investigables a la
// izquierda, financiación y gráfica en el centro, investigados a la derecha.

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';
import { AVAILABLE, FUNDING_MULTIPLIER } from '../campaign/research.js';

const GRAPH = { x: 0xcc, y: 0x15e };
const HOURS_PER_DAY = 24;

export class ResearchScene extends MenuScreen {
  constructor(game, { mission = false } = {}) {
    super(game, { anim: 'mresrch', out: 'mresout' });
    this.mission = mission;
    this.kind = 'weapon';     // pestaña EQUIP (armas) o MODS
    this.choosing = null;     // elemento elegido en la lista izquierda, pendiente de RESEARCH/CANCEL
    this.viewing = null;      // elemento investigado mostrado a la derecha
  }

  get research() { return this.campaign.research; }
  name(it) { return it.info.name[this.lang]; }

  draw(vga) {
    const g = this.gfx, r = this.research, p = r.project;
    g.title(vga, this.label('researchTitle'));
    this.drawClock(vga);
    this.drawLogo(vga);
    this.drawFunds(vga);
    if (p && !this.choosing) {
      this.button(vga, 'fundingUp', 0x10, 0xd2, 0x92, 0xec);
      this.button(vga, 'fundingDown', 0x10, 0x106, 0x92, 0x120);
      const perDay = String(r.hourlyCost() * HOURS_PER_DAY);
      g.text(vga, perDay, Math.trunc((0x82 - g.width(perDay, FONT.HOT)) / 2) + 0x10, 0xf4, FONT.HOT);
      g.text(vga, `${this.name(p)} : ${Math.floor((p.progress * 100) / AVAILABLE)}%`, 0x9e, 0x58, FONT.HOT);
      this.drawGraph(vga, p, r.funding);
    }
    this.button(vga, 'mods', 0x10, 0x122, 0x92, 0x13c);
    this.button(vga, 'equip', 0x10, 0x13e, 0x92, 0x158);
    this.button(vga, 'accept', 0x10, 0x15a, 0x92, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
    if (this.choosing) this.drawChoice(vga, this.choosing);
    else this.drawResearchable(vga);
    if (this.viewing) {
      g.text(vga, this.name(this.viewing), 0x1f8, 0x6e, FONT.SMALL);
      vga.line(500, 0x13e, 0x272, 0x13e, 0x58);
      this.button(vga, 'cancel', 500, 0x13e, 0x272, 0x156);
    } else this.drawCompleted(vga);
  }

  researchable() { return this.research.researchable(this.kind); }
  completed() { return (this.kind === 'mod' ? this.research.mods : this.research.weapons).filter((it) => it.available && it.info.available !== false); }

  drawResearchable(vga) {
    this.researchable().forEach((it, i) => {
      const y = 0x56 + i * 0xc;
      this.gfx.text(vga, this.name(it), 0x14, y, this.hot(0x10, y, 0x90, y + 0xc) ? FONT.SMALL : FONT.LIST);
    });
  }

  drawCompleted(vga) {
    this.completed().forEach((it, i) => {
      const y = 0x70 + i * 0xc;
      this.gfx.text(vga, this.name(it), 0x1f8, y, this.hot(500, y, 0x272, y + 0xc) ? FONT.SMALL : FONT.LIST);
    });
  }

  /** Panel de elección: MIN/MAX FUNDING por día y botones RESEARCH / CANCEL. */
  drawChoice(vga, it) {
    const g = this.gfx;
    g.text(vga, this.name(it), 0x14, 0x56, FONT.SMALL);
    g.text(vga, this.label('minFunding'), 0x14, 0x6a, FONT.HOT);
    g.text(vga, String(it.cost * HOURS_PER_DAY), 0x14, 0x76, FONT.SMALL);
    g.text(vga, this.label('maxFunding'), 0x14, 0x82, FONT.HOT);
    g.text(vga, String(it.cost * HOURS_PER_DAY * FUNDING_MULTIPLIER.at(-1)), 0x14, 0x8e, FONT.SMALL);
    for (const y of [100, 0x9e, 0xb6]) vga.line(0x12, y, 0x8e, y, 0x58);
    this.button(vga, 'research', 0x10, 0x9e, 0x90, 0xb6);
    this.button(vga, 'cancel', 0x10, 0xb6, 0x90, 0xce);
  }

  /** Gráfica (`0x34ad0`): una columna lógica por hora, altura progreso/10, previsión hasta 2400. */
  drawGraph(vga, it, funding) {
    let px = GRAPH.x, py = GRAPH.y;
    it.chart.forEach((v, i) => {
      const nx = GRAPH.x + i + 1, ny = GRAPH.y - Math.trunc(v / 10);
      vga.line(px, py, nx, ny, 0xfc);
      px = nx; py = ny;
    });
    if (funding >= 0 && it.progress < AVAILABLE) vga.line(px + 1, py, px + Math.trunc((AVAILABLE - it.progress) / ((funding + 1) * 10)), 0x6e, 0x58);
  }

  click(e) {
    const at = (x0, y0, x1, y1) => this.hot(x0, y0, x1, y1, e);
    const r = this.research;
    if (this.choosing) {
      if (at(0x10, 0x9e, 0x92, 0xb8)) { r.select(this.choosing); this.choosing = null; return; }
      if (at(0x10, 0xb6, 0x92, 0xd0)) { this.choosing = null; return; }
    } else if (at(0x10, 0x50, 0x92, 0xd0)) {
      const it = this.researchable()[Math.trunc((e.y - 0x56) / 0xc)];
      if (it) this.choosing = it;
      return;
    }
    if (r.project && !this.choosing) {
      if (at(0x10, 0xd2, 0x92, 0xec)) { r.changeFunding(+1); return; }
      if (at(0x10, 0x106, 0x92, 0x120)) { r.changeFunding(-1); return; }
    }
    if (at(0x10, 0x122, 0x92, 0x13c)) { this.kind = 'mod'; this.choosing = this.viewing = null; return; }
    if (at(0x10, 0x13e, 0x92, 0x158)) { this.kind = 'weapon'; this.choosing = this.viewing = null; return; }
    if (at(0x10, 0x15a, 0x92, 0x174)) { this.exit(() => this.game.go('cryo', { mission: this.mission })); return; }
    if (at(500, 0x15a, 0x274, 0x174)) { this.exit(() => this.game.go('menu')); return; }
    if (this.viewing) { if (at(500, 0x13e, 0x274, 0x158)) this.viewing = null; return; }
    if (at(500, 0x6a, 0x274, 0x158)) this.viewing = this.completed()[Math.trunc((e.y - 0x70) / 0xc)] ?? null;
  }

  key(code) {
    if (code === 'Escape') { this.exit(() => this.game.go('menu')); return true; }
    return false;
  }
}
