// TEAM SELECTION / CRYO (SPEC §9.2, §9.2b, §12.2; `0x1fbc0`, `0x22a10`, `0x22fe0`,
// `0x22eb0`, `0x228d0`): equipo de 4, cuerpo con las mejoras, inventario, listas TEAM /
// MODS / EQUIP con detalle y compra, recarga y venta.

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';
import { modLevel } from '../campaign/roster.js';

/** Casillas del equipo (2×2) y huecos de inventario (tabla `0x5b5b0`). */
const SLOTS = [[0x14, 0x54, 0x50, 0x96], [0x52, 0x54, 0x8e, 0x96], [0x14, 0xa2, 0x50, 0xe4], [0x52, 0xa2, 0x8e, 0xe4]];
const INV = Array.from({ length: 8 }, (_, i) => [0x16e + (i % 4) * 0x20, 0x134 + Math.floor(i / 4) * 0x20]);
/** Cuerpo por sexo (`0x5b55c`): {sprite base, x, y} de torso, piernas, brazos, pecho, corazón, ojos, cerebro. */
const BODY = [
  [[0x1e, 0xe0, 0x74], [0x20, 0xe0, 0xda], [0x28, 0xbc, 0x98], [0x2f, 0xd8, 0x94], [0, 0xfe, 0xa8], [0, 0xee, 0x74], [0, 0xee, 0x76]],
  [[0x1e, 0xe0, 0x76], [0x24, 0xe0, 0xd6], [0x2c, 0xc6, 0x9e], [0x32, 0xe0, 0x98], [0, 0x100, 0xaa], [0, 0xf0, 0x76], [0, 0xf0, 0x78]],
];
const MOD_LABEL_Y = { brain: 0x72, eyes: 0x8a, heart: 0xa2, chest: 0xce, arms: 0xe4, legs: 0xfc };
const LIST = { x: 0x1f8, y: 0x70, step: 0xc };
const TABS = { team: 'team', mods: 'mods', equip: 'equip' };

export class CryoScene extends MenuScreen {
  constructor(game, { mission = false } = {}) {
    super(game, { anim: 'mselect', out: 'mselout' });
    this.mission = mission;
    this.tab = TABS.team;
    this.slot = 0;            // casilla del equipo elegida
    this.detail = null;       // elemento de MODS/EQUIP elegido
    this.invSlot = -1;        // objeto del inventario elegido (vender/recargar)
  }

  get roster() { return this.campaign.roster; }
  /** Agente de cada casilla del equipo (por puesto). */
  teamAgent(i) { return this.roster.agents.find((a) => a.team === i + 1) ?? null; }
  get agent() { return this.teamAgent(this.slot); }
  name(a) { return this.game.assets.agentNames[a.name] ?? ''; }

  draw(vga) {
    const g = this.gfx;
    this.drawClock(vga);
    this.drawLogo(vga);
    SLOTS.forEach(([x0, y0], i) => {
      const a = this.teamAgent(i);
      if (a) g.sprite(vga, i + 1, x0, y0);
      vga.fillRect(x0 + (i % 2 ? 0x32 : 0x30), y0 + 4, 6, 0x24, a ? 12 : 10);
    });
    const [sx0, sy0, sx1, sy1] = SLOTS[this.slot];
    const ph = -this.frame;
    vga.line(sx0, sy0, sx1 - 2, sy0, 0x58, { b: 0xfc, phase: ph });
    vga.line(sx0, sy0, sx0, sy1 - 2, 0x58, { b: 0xfc, phase: ph });
    vga.line(sx0, sy1 - 2, sx1 - 2, sy1 - 2, 0x58, { b: 0xfc, phase: ph });
    vga.line(sx1 - 2, sy0, sx1 - 2, sy1 - 2, 0x58, { b: 0xfc, phase: ph });

    const a = this.agent;
    if (a?.alive) this.drawBody(vga, a);
    for (const [y, x1] of [[0x7c, 0xfe], [0x84, 0x108], [0xae, 0x10a], [0xd2, 0xfc], [0xe8, 0x12e], [0x100, 0x108]]) vga.line(0x16a, y, x1, y, 0x58);
    if (a) this.drawInventory(vga, a);

    this.button(vga, 'team', 0x10, 0x106, 0x92, 0x120);
    this.button(vga, 'mods', 0x10, 0x122, 0x92, 0x13c);
    this.button(vga, 'equip', 0x10, 0x13e, 0x92, 0x158);
    this.button(vga, 'research', 0x10, 0xea, 0x92, 0x104);
    this.button(vga, 'accept', 0x10, 0x15a, 0x92, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
    this.drawFunds(vga);
    if (this.tab === TABS.team) this.drawTeamList(vga);
    else if (this.detail) this.drawDetail(vga);
    else this.drawShopList(vga);
  }

  drawBody(vga, a) {
    const g = this.gfx, sex = a.mods & 1, body = BODY[sex];
    g.text(vga, this.name(a), 0x9e, 0x58, FONT.HOT);
    const level = (part) => modLevel(a.mods, part);
    g.sprite(vga, body[0][0] + sex, body[0][1], body[0][2]);
    g.sprite(vga, body[1][0] + level('legs'), body[1][1], body[1][2]);
    g.sprite(vga, body[2][0] + level('arms'), body[2][1], body[2][2]);
    if (level('chest')) g.sprite(vga, body[3][0] + level('chest'), body[3][1], body[3][2]);
    if (level('heart')) g.sprite(vga, 0x35 + level('heart'), body[4][1], body[4][2]);
    if (level('eyes')) g.sprite(vga, 0x3b + level('eyes'), body[5][1], body[5][2]);
    if (level('brain')) g.sprite(vga, 0x38 + level('brain'), body[6][1], body[6][2]);
    const mods = this.game.assets.mods;
    for (const [part, y] of Object.entries(MOD_LABEL_Y)) {
      const v = level(part);
      if (v) g.text(vga, mods.find((m) => m.part === part && m.version === v).name[this.lang], 0x16e, y, FONT.SMALL);
    }
  }

  drawInventory(vga, a) {
    const weapons = this.game.assets.weapons;
    a.items.forEach((it, i) => {
      const [x, y] = INV[i];
      this.gfx.sprite(vga, it.weapon === 17 ? 0x1c : it.weapon + 0xd, x, y);
      const max = weapons[it.weapon - 1].catalogAmmo;
      if (max > 0 && it.ammo >= 0) vga.fillRect(x + 4, y + 0x16, Math.min(0x18, Math.trunc((Math.max(0, it.ammo) * 0x18) / max)), 6, 12);
      if (i === this.invSlot) vga.frame(x, y, x + 0x1e, y + 0x1e, 0xfc);
    });
  }

  drawTeamList(vga) {
    const g = this.gfx;
    g.text(vga, this.label('cryoChamber'), 0x1f8, 0x6c, FONT.SMALL);
    this.roster.agents.forEach((a, i) => {
      const y = 0x7c + i * 0xc;
      if (a.team) g.text(vga, String(a.team), 0x1f8, y, FONT.LIST);
      const hot = this.hot(500, y, 0x272, y + 0xc);
      g.text(vga, a.empty ? this.label('empty') : this.name(a), 0x208, y, hot ? FONT.SMALL : FONT.LIST);
    });
  }

  /** Elementos investigados del catálogo de la pestaña. */
  shopItems() {
    const shop = this.campaign.shop;
    return this.tab === TABS.mods
      ? shop.modsForSale().map((m) => ({ kind: 'mod', ref: m, name: m.name[this.lang] }))
      : shop.weaponsForSale().map((w) => ({ kind: 'weapon', ref: w, name: w.name[this.lang] }));
  }

  drawShopList(vga) {
    this.shopItems().forEach((it, i) => {
      const y = LIST.y + i * LIST.step;
      this.gfx.text(vga, it.name, LIST.x, y, this.hot(500, y, 0x272, y + LIST.step) ? FONT.SMALL : FONT.LIST);
    });
    if (this.invSlot >= 0 && this.agent?.items[this.invSlot]) {
      this.button(vga, 'reload', 500, 0x124, 0x274, 0x140);
      this.button(vga, 'sell', 500, 0x13e, 0x274, 0x158);
    }
  }

  drawDetail(vga) {
    const g = this.gfx, d = this.detail;
    if (d.kind === 'weapon') {
      const w = d.ref;
      g.sprite(vga, w.type === 17 ? 0x4e : w.type + 0x3f, 0x1f6, 0x6a);
      g.text(vga, w.name[this.lang], 0x1f8, 0xc4, FONT.SMALL);
      let y = 0xd0;
      const row = (key, value) => { g.text(vga, this.label(key), 0x1f8, y, FONT.SMALL); g.text(vga, `:${value}`, 0x22c, y, FONT.SMALL); y += 0xc; };
      row('cost', w.price);
      if (w.maxAmmo > 0) row('ammo', w.catalogAmmo);
      row('range', w.range);
      if (w.maxAmmo > 0) row('shot', w.catalogReloadCost);
    } else {
      const m = d.ref, ui = this.game.assets.ui;
      g.text(vga, m.name[this.lang], 0x1f8, 0x6e, FONT.SMALL);
      g.text(vga, this.label('cost'), 0x1f8, 0x7e, FONT.SMALL);
      g.text(vga, `:${m.price}`, 0x22c, 0x7e, FONT.SMALL);
      g.textBox(vga, ui.modDescriptions[ui.modDescIndex[m.id]]?.[this.lang] ?? '', 0, 0x1f8, 0x8e, 0x78, 0xea - 0x8e, FONT.SMALL, 0xc);
    }
    for (const y of [0x10e, 0x126, 0x13e]) vga.line(0x1f6, y, 0x270, y, 0xea);
    this.button(vga, 'purchase', 500, 0x13e, 0x272, 0x156);
    this.button(vga, 'cancel', 500, 0x10e, 0x272, 0x126);
  }

  click(e) {
    const at = (x0, y0, x1, y1) => this.hot(x0, y0, x1, y1, e);
    const shop = this.campaign.shop;
    const slot = SLOTS.findIndex((r) => at(...r));
    if (slot >= 0) { this.slot = slot; this.invSlot = -1; return; }
    const inv = INV.findIndex(([x, y]) => at(x, y, x + 0x20, y + 0x20));
    if (inv >= 0 && this.agent?.items[inv]) { this.invSlot = inv; this.detail = null; if (this.tab === TABS.team) this.tab = TABS.equip; return; }
    if (at(0x10, 0x106, 0x92, 0x120)) { this.tab = TABS.team; this.detail = null; return; }
    if (at(0x10, 0x122, 0x92, 0x13c)) { this.tab = TABS.mods; this.detail = null; return; }
    if (at(0x10, 0x13e, 0x92, 0x158)) { this.tab = TABS.equip; this.detail = null; return; }
    if (at(0x10, 0xea, 0x92, 0x104)) { this.exit(() => this.game.go('research', { mission: this.mission })); return; }
    if (at(0x10, 0x15a, 0x92, 0x174)) { if (this.mission) this.exit(() => this.game.startMission()); return; }
    if (at(500, 0x15a, 0x274, 0x174)) { this.exit(() => this.game.go('menu')); return; }

    if (this.tab === TABS.team && at(500, 0x76, 0x272, 0x156)) {
      const i = Math.trunc((e.y - 0x7c) / 0xc);
      const a = this.roster.agents[i];
      if (!a || a.empty) return;
      const holder = this.teamAgent(this.slot);
      if (a === holder) { a.team = 0; return; }
      if (a.team) return;
      if (holder) holder.team = 0;
      a.team = this.slot + 1;
      return;
    }
    if (this.detail) {
      if (at(500, 0x13e, 0x272, 0x156)) {
        const d = this.detail, a = this.agent;
        if (a) d.kind === 'mod' ? shop.buyMod(a, d.ref.id) : shop.buyWeapon(a, d.ref.type);
      } else if (at(500, 0x10e, 0x272, 0x126)) this.detail = null;
      return;
    }
    if (this.invSlot >= 0 && this.agent) {
      if (at(500, 0x124, 0x274, 0x140)) { shop.reload(this.agent, this.invSlot); return; }
      if (at(500, 0x13e, 0x274, 0x158)) { shop.sell(this.agent, this.invSlot); this.invSlot = -1; return; }
    }
    if (at(500, 0x6a, 0x272, 0x156)) {
      const item = this.shopItems()[Math.trunc((e.y - LIST.y) / LIST.step)];
      if (item) { this.detail = item; this.invSlot = -1; }
    }
  }

  key(code) {
    if (code === 'Enter' && this.mission) { this.exit(() => this.game.startMission()); return true; }
    if (code === 'Escape') { this.exit(() => this.game.go('menu')); return true; }
    return false;
  }
}
