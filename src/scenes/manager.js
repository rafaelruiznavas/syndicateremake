// Gestor de escenas y estado de la partida: reparte la entrada a la escena activa, avanza
// el reloj de la campaña en las pantallas de gestión y guarda la partida.

import { Campaign, Outcome } from '../campaign/campaign.js';
import { outcomeAnimations } from './debrief.js';
import { Vga } from '../ui/vga.js';
import { MenuGfx } from '../ui/menu-gfx.js';
import { AudioEngine } from '../audio/audio.js';
import { MusicPlayer } from '../audio/music.js';
import { Effects } from '../render/effects.js';

const SAVE_KEY = 'syndicate-remake.save';
/** Lienzo de los gráficos mejorados [DIS] (SPEC §15.1): 16:9, con 400 filas lógicas de alto. */
export const ENHANCED_CANVAS = Object.freeze({ width: 1280, height: 720 });
const LOGICAL_HEIGHT = 400, MENU_WIDTH = 640;

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
    this.cheats = { invulnerable: false };   // [DIS] trucos del remake; los cambia src/ui/cheats.js
    this.graphics = 'original';
    this.effects = new Effects();
    this.music = new MusicPlayer(this.audio, assets.base);
    // El audio del navegador solo arranca tras un gesto del usuario.
    input.onClick((e) => { this.audio.unlock(); this.scene?.onClick?.(e); });
    input.onKey((code, key) => { this.audio.unlock(); return this.scene?.onKey?.(code, key) ?? false; });
  }

  /**
   * Modo de gráficos [DIS] (SPEC §15.1): 'original' (640×400, píxeles nítidos) o 'enhanced'
   * (lienzo de 1280×720, atlas ampliados con Scale2x, suavizado y efectos). En 16:9 el espacio
   * lógico conserva sus 400 filas (escala 1,8) y gana anchura: la misión ve más ciudad y las
   * pantallas de gestión, de 640 de ancho, se centran con bandas a los lados.
   */
  setGraphicsMode(mode) {
    this.graphics = mode === 'enhanced' ? 'enhanced' : 'original';
    const c = this.ctx.canvas;
    const w = this.enhanced ? ENHANCED_CANVAS.width : MENU_WIDTH, h = this.enhanced ? ENHANCED_CANVAS.height : LOGICAL_HEIGHT;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (c.style) {
      c.style.imageRendering = this.enhanced ? 'auto' : 'pixelated';
      c.style.setProperty?.('--aspect', String(w / h));
    }
    this.vga.smooth = this.enhanced;
    this.render();
  }
  get enhanced() { return this.graphics === 'enhanced'; }
  /** Escala de los atlas (Scale2x): ×2 en el modo mejorado. */
  get graphicsScale() { return this.enhanced ? 2 : 1; }
  /** Píxeles reales por píxel lógico. */
  get pixelScale() { return this.enhanced ? ENHANCED_CANVAS.height / LOGICAL_HEIGHT : 1; }
  /** Anchura lógica del lienzo: 640 en el modo original, ≈711 en 16:9. */
  get screenWidth() { return this.enhanced ? ENHANCED_CANVAS.width / this.pixelScale : MENU_WIDTH; }
  /** Desplazamiento lógico de la escena activa: las de 640 de ancho se centran. */
  get sceneOffset() { return this.scene?.wide ? 0 : (this.screenWidth - MENU_WIDTH) / 2; }

  /** Transformación de la escena activa y espacio lógico del ratón. */
  #frame() {
    const k = this.pixelScale, ox = this.sceneOffset, ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (ox > 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
    ctx.setTransform(k, 0, 0, k, ox * k, 0);
    ctx.imageSmoothingEnabled = this.enhanced;
    if (this.input) this.input.space = { width: this.screenWidth, height: LOGICAL_HEIGHT, offsetX: ox };
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
    this.render();                            // la GUI necesita un fotograma para aceptar clics
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

  render(alpha = 0) {
    if (!this.scene) return;
    this.#frame();
    this.scene.render?.(alpha);
    if (this.enhanced) { this.effects.tick(); this.effects.post(this.ctx); }
  }
}
