// Escena de misión: une mundo, render, HUD y entrada.

import { World } from '../world/world.js';
import { Camera } from '../render/iso.js';
import { Renderer } from '../render/renderer.js';
import { Hud } from '../render/hud.js';
import { MissionFont } from '../ui/mission-font.js';
import { MissionAudio } from '../audio/mission-audio.js';
import { Animator } from '../systems/animation.js';
import { Person } from '../entities/person.js';
import { Vehicle } from '../entities/entity.js';
import { MissionStatus } from '../systems/objectives.js';
import { PANEL_WIDTH, SCREEN_WIDTH, SCREEN_HEIGHT } from '../core/constants.js';
import { lineOfFire } from '../systems/perception.js';
import { remakeText } from '../i18n/es-ui.js';

const SCROLL_STEP = 64;       // [DIS] u de cámara por fotograma al desplazar
const EDGE = 6;               // px del borde que activan el desplazamiento
const PICK_RADIUS = 14;       // px para elegir una persona u objeto con el ratón
const VEHICLE_PICK_RADIUS = 28;   // [DIS] los vehículos son más grandes
/** Cursores (sprites de HPOINTER, `0x2cb40`). */
export const Cursor = Object.freeze({ PANEL: 1, MAP: 2, ITEM: 4, OUT_OF_RANGE: 5, IN_RANGE: 6 });
const CURSOR_HOTSPOT = 16;        // [INF] centro del sprite de 32×33

export class MissionScene {
  /** @param {import('./manager.js').Game} game  @param {{mission:number, roster:object[]}} setup */
  constructor(game, { mission, roster }) {
    this.game = game;
    this.assets = game.assets; this.ctx = game.ctx; this.input = game.input; this.loop = game.loop;
    this.camera = new Camera();
    this.renderer = new Renderer(this.ctx, this.assets);
    this.escArmed = 0;
    this.setup = { mission, roster };
  }

  enter() { this.ctx.canvas.style.cursor = 'none'; return this.load(this.setup.mission, this.setup.roster); }
  leave() { this.ctx.canvas.style.cursor = ''; this.loop.paused = false; this.loop.ticksPerCycle = 7; this.sound?.dispose(); }

  /**
   * Cursor bajo el ratón (`0x2cb40`): panel, mapa, objeto del suelo, o mira (en alcance y con
   * línea de tiro del arma equipada del agente seleccionado) o fuera de alcance sobre una
   * persona de otro sindicato o un vehículo.
   */
  cursorAt(x, y, target = this.entityAt(x, y)) {
    if (x < PANEL_WIDTH) return Cursor.PANEL;
    const w = this.world, lead = w.leader;
    const enemy = target instanceof Person && target.group !== 0 && !target.isPlayerSquad;
    if (enemy || target instanceof Vehicle) {
      const it = lead && !lead.dead ? lead.equipped : null;
      const range = it ? w.weapons.range(it.weapon) : 0;
      return it && range > 0 && lineOfFire(w, lead, target, range) === target ? Cursor.IN_RANGE : Cursor.OUT_OF_RANGE;
    }
    if (target && !(target instanceof Person)) return Cursor.ITEM;
    return Cursor.MAP;
  }

  drawCursor(id, x, y) {
    const r = this.assets.pointersInfo.sprites[id], atlas = this.renderer.gfx?.pointers;
    if (!r || !atlas) return;
    this.ctx.drawImage(atlas, r.x, r.y, r.w, r.h, x - CURSOR_HOTSPOT, y - CURSOR_HOTSPOT, r.w, r.h);
  }

  async load(mission, roster) {
    const a = this.assets;
    const level = await a.level(mission);
    const mapData = await a.map(level.map);
    const animator = new Animator(a.sprites, a.personAnims);
    const research = new Map(a.weapons.map((w) => [w.type, w.researchInitial]));
    this.world = new World(level, mapData, {
      tileClasses: a.tileClasses, weapons: a.weapons, animator, roster, research,
      enemyWeapons: a.enemyWeapons, armedTable: a.weaponArmed,
    });
    if (this.game.cheats) this.world.cheats = this.game.cheats;   // compartido: el menú actúa en vivo
    this.hud = new Hud(this.ctx, this.world.weapons, this.renderer, new MissionFont(a.missionFontData), a.weapons.map((w) => w.name[this.game.lang ?? 'en']));
    this.renderer.setGraphics(a.graphicsFor(a.paletteForMission(mission)));
    const lead = this.world.squad[0];
    if (lead) this.camera.centerOn(lead.x, lead.y, lead.z, (PANEL_WIDTH + SCREEN_WIDTH) / 2, SCREEN_HEIGHT / 2);
    this.mission = mission;
    if (this.game.audio) this.sound = new MissionAudio(this.world, this.camera, this.game.audio, this.game.music, a.sprites);
  }

  /** Persona, vehículo u objeto bajo el ratón (por proyección de su ancla). */
  entityAt(sx, sy) {
    let best = null, bestScore = 1;
    for (const e of this.world.entities) {
      if (e.hidden) continue;
      const vehicle = e instanceof Vehicle;
      if (e instanceof Person ? e.corpse : !vehicle && (e.class !== 4 || e.owner)) continue;
      const [px, py] = this.camera.project(e.x, e.y, e.z);
      const lift = e instanceof Person ? 14 : vehicle ? 12 : 2;
      const score = Math.hypot(px - sx, (py - lift) - sy) / (vehicle ? VEHICLE_PICK_RADIUS : PICK_RADIUS);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  /** Tras el fin (éxito o fracaso): pulsar continúa al informe sin esperar los 576 ticks. */
  #leaveIfEnded() {
    const o = this.world.objectives;
    if (o.running || this.leaving) return false;
    this.leaving = true;
    this.game.finishMission(this.world);
    return true;
  }

  onClick({ x, y, button }) {
    const w = this.world;
    if (this.#leaveIfEnded() || !w.objectives.running) return;
    const hit = this.hud.hit(x, y);
    if (hit) {
      if (hit.type === 'agent') w.select(hit.index);
      else if (hit.type === 'group') w.selectGroup();
      else if (hit.type === 'slot') w.orderEquip(hit.index);
      else if (hit.type === 'bar') for (const ag of w.selected()) ag[hit.bar].level = hit.level;
      return;
    }
    if (x < PANEL_WIDTH) return;
    const target = this.entityAt(x, y);
    if (button === 'right') {
      if (target instanceof Person) w.orderFire(target.x, target.y, target.z + 0x80);
      else { const g = w.pickGround(this.camera, x, y); if (g) w.orderFire(g.x, g.y, g.z + 0x80); }
      return;
    }
    if (target instanceof Vehicle) {
      if (w.leader?.vehicle === target) w.orderLeave(); else w.orderBoard(target);
      return;
    }
    if (target && !(target instanceof Person)) { w.orderPickup(target); return; }
    const g = w.pickGround(this.camera, x, y);
    if (g) w.orderMove(g.x, g.y, g.z);
  }

  onKey(code) {
    const w = this.world;
    if (this.#leaveIfEnded()) return true;
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[code];
    if (digit !== undefined) { w.select(digit); return true; }
    if (code === 'Digit0' || code === 'Backquote') { w.selectGroup(); return true; }
    if (code === 'KeyP') { this.loop.paused = !this.loop.paused; return true; }
    if (code === 'F3') { this.loop.ticksPerCycle = Math.max(0, this.loop.ticksPerCycle - 1); return true; }
    if (code === 'F4') { this.loop.ticksPerCycle = Math.min(12, this.loop.ticksPerCycle + 1); return true; }
    if (code === 'Escape') {
      if (this.escArmed > 0) w.objectives.withdraw(); else this.escArmed = 60;
      return true;
    }
    if (code === 'KeyD' && this.input.held('ShiftLeft')) { this.renderer.debug = !this.renderer.debug; return true; }
    return false;
  }

  update() {
    const w = this.world;
    // Armas automáticas: mantener el botón derecho repite la orden (SPEC §6.1b punto 4).
    if (this.input.buttons?.right && w.objectives.running) {
      const m = this.input.mouse;
      if (m.x >= PANEL_WIDTH) {
        const t = this.entityAt(m.x, m.y);
        const g = t instanceof Person ? { x: t.x, y: t.y, z: t.z } : w.pickGround(this.camera, m.x, m.y);
        for (const a of w.selected()) if (a.equipped && w.weapons.isAutomatic(a.equipped) && g) w.weapons.activate(a, g.x, g.y, g.z + 0x80);
      }
    }
    w.update(this.loop.ticksPerCycle);
    this.sound?.cycle();
    if (w.objectives.running) this.game.campaign?.missionTick();
    // Abandono inmediato; éxito o fracaso tras la espera de 576 ticks (SPEC §8.1).
    if (!w.objectives.running && (w.objectives.status === MissionStatus.WITHDRAWN || w.objectives.endTimer === 0)) this.#leaveIfEnded();
  }

  scroll() {
    const m = this.input.mouse, i = this.input;
    let ex = 0, ey = 0;
    if (i.held('ArrowLeft') || (m.inside && m.x >= PANEL_WIDTH && m.x < PANEL_WIDTH + EDGE)) ex -= 1;
    if (i.held('ArrowRight') || (m.inside && m.x >= SCREEN_WIDTH - EDGE)) ex += 1;
    if (i.held('ArrowUp') || (m.inside && m.y < EDGE)) ey -= 1;
    if (i.held('ArrowDown') || (m.inside && m.y >= SCREEN_HEIGHT - EDGE)) ey += 1;
    this.camera.x += (ex + ey) * SCROLL_STEP;
    this.camera.y += (ey - ex) * SCROLL_STEP;
  }

  render() {
    this.scroll();
    if (this.escArmed > 0) this.escArmed--;
    this.renderer.render(this.world, this.camera);
    this.hud.lang = this.game.lang;
    const m = this.input.mouse, hit = this.hud.hit(m.x, m.y);
    const under = m.x >= PANEL_WIDTH ? this.entityAt(m.x, m.y) : null;
    const groundItem = under && !(under instanceof Person) && !(under instanceof Vehicle) ? under : null;
    this.hud.render(this.world, hit?.type === 'slot' ? this.world.leader?.items[hit.index] ?? null : groundItem);
    const g = this.ctx, o = this.world.objectives;
    g.font = 'bold 14px monospace'; g.textAlign = 'center';
    const cx = (PANEL_WIDTH + SCREEN_WIDTH) / 2;
    if (this.loop.paused) { g.fillStyle = '#ff0'; g.fillText(remakeText('paused', this.game.lang), cx, 200); }
    if (this.escArmed > 0 && o.running) { g.fillStyle = '#fc0'; g.fillText(remakeText('escAgain', this.game.lang), cx, 24); }
    if (!o.running) {
      const text = remakeText({ [MissionStatus.COMPLETED]: 'missionComplete', [MissionStatus.FAILED]: 'missionFailed', [MissionStatus.WITHDRAWN]: 'withdrew' }[o.status], this.game.lang);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(PANEL_WIDTH, 170, SCREEN_WIDTH - PANEL_WIDTH, 60);
      g.fillStyle = o.status === MissionStatus.COMPLETED ? '#6f6' : '#f66'; g.fillText(text, cx, 200);
      const s = this.world.stats;
      g.font = '10px monospace'; g.fillStyle = '#ccc';
      g.fillText(remakeText('stats', this.game.lang, { a: s.enemyAgents, c: s.civilians, p: s.police, g: s.guards, h: s.shots ? Math.floor((s.hits * 100) / s.shots) + '%' : '—' }), cx, 218);
    }
    g.textAlign = 'start';
    if (m.inside) this.drawCursor(this.cursorAt(m.x, m.y, under), m.x, m.y);
  }
}
