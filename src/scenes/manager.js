// Gestor de escenas y estado de la partida: reparte la entrada a la escena activa, avanza
// el reloj de la campaña en las pantallas de gestión y guarda la partida.

import { Campaign, Outcome } from '../campaign/campaign.js';
import { outcomeAnimations } from './debrief.js';
import { Vga } from '../ui/vga.js';
import { MenuGfx } from '../ui/menu-gfx.js';
import { AudioEngine } from '../audio/audio.js';
import { MusicPlayer } from '../audio/music.js';

const SAVE_KEY = 'syndicate-remake.save';

export class Game {
  constructor({ assets, ctx, input, loop }) {
    this.assets = assets; this.ctx = ctx; this.input = input; this.loop = loop;
    this.vga = new Vga();
    this.menuGfx = new MenuGfx(assets.menuSpritesIndexed, assets.menuSpritesInfo.sprites);
    this.lang = 'en';
    this.scene = null;
    this.campaign = null;
    this.factories = {};
    this.audio = new AudioEngine(assets.base);
    this.music = new MusicPlayer(this.audio, assets.base);
    // El audio del navegador solo arranca tras un gesto del usuario.
    input.onClick((e) => { this.audio.unlock(); this.scene?.onClick?.(e); });
    input.onKey((code, key) => { this.audio.unlock(); return this.scene?.onKey?.(code, key) ?? false; });
  }

  /** Datos de catálogo que necesita la campaña. */
  get data() {
    const a = this.assets;
    return { weapons: a.weapons, mods: a.mods, territories: a.territories, briefings: a.briefings, agentNames: a.agentNames };
  }

  register(name, factory) { this.factories[name] = factory; }

  async go(name, args = {}) {
    this.scene?.leave?.();
    const scene = this.factories[name](this, args);
    await scene.enter?.();
    this.scene = scene;
    scene.render?.();                         // la GUI necesita un fotograma para aceptar clics

  }

  /** CRYO → ACCEPT: arranca la misión del briefing con el equipo elegido. */
  startMission() {
    const setup = this.campaign.startMission();
    if (setup) this.go('mission', setup);
  }

  /**
   * Fin de misión (`0x37f80`, `0x37600`): animación de resultado, MSCRENUP e informe. Si se
   * gana o se pierde la partida, se vuelve al menú principal (y se empieza otra al perder).
   */
  finishMission(world) {
    const report = this.campaign.finishMission(world);
    const final = report.outcome === Outcome.GAME_OVER || report.outcome === Outcome.GAME_WON;
    if (report.outcome === Outcome.GAME_OVER) this.newGame();
    this.save();                                // [DIS] guardado automático tras cada misión
    let step = { name: 'screenup', args: final ? { next: 'menu' } : { next: 'debrief', args: { report } } };
    for (const anim of outcomeAnimations(report.outcome).reverse()) step = { name: 'anim', args: { anim, next: step.name, args: step.args } };
    this.go(step.name, step.args);
  }

  /** Atajo de desarrollo (?mission=N): partida nueva y misión N directamente. */
  quickMission(mission) {
    this.newGame();
    const territory = this.campaign.territories.list.findIndex((t) => t.mission === mission);
    this.campaign.briefing = { territory: Math.max(0, territory), mission, info: 0, enhance: 0 };
    this.startMission();
  }

  newGame() { this.campaign = Campaign.newGame(this.data, { seed: (Date.now() & 0xffff) }); }   // [DIS] semilla

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.campaign.toJSON())); return true; } catch { return false; }
  }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  loadState(state) { this.campaign = new Campaign(this.data, state); }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      this.campaign = new Campaign(this.data, JSON.parse(raw));
      return true;
    } catch { return false; }
  }

  update() {
    // Las pantallas de gestión avanzan el reloj una unidad por tick del temporizador (72,83 Hz) [INF].
    if (this.scene?.ticksClock && this.campaign) for (let i = 0; i < this.loop.ticksPerCycle; i++) this.campaign.screenTick();
    this.scene?.update?.();
  }

  render() { this.scene?.render?.(); }
}
