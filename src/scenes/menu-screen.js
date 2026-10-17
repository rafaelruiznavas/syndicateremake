// Base de las pantallas de gestión (SPEC §12.1): animación FLIC de entrada cuyo último
// fotograma queda de fondo, contenido dinámico redibujado cada fotograma sobre el fondo y
// animación de salida al dejar la pantalla. Todo en el framebuffer de 320×200.

import { FlicPlayer } from '../ui/flic-player.js';
import { FONT } from '../ui/menu-gfx.js';

const LOGO_SIZE = 32;

export class MenuScreen {
  /**
   * @param {import('./manager.js').Game} game
   * @param {{anim: string, out?: string, ticksPerFrame?: number, skippable?: boolean}} opts
   */
  constructor(game, { anim, out = null, ticksPerFrame = 5, skippable = false, cues = [] }) {
    this.game = game;
    this.vga = game.vga;
    this.gfx = game.menuGfx;
    this.anim = anim; this.out = out;
    this.ticksPerFrame = ticksPerFrame; this.skippable = skippable; this.cues = cues;
    this.phase = 'loading';
    this.frame = 0;
    this.clock = true;                      // el reloj de la campaña corre en esta pantalla
  }

  get campaign() { return this.game.campaign; }
  get mouse() { return this.game.input.mouse; }
  get lang() { return this.game.lang; }
  label(key) { return this.game.assets.ui.labels[key]?.[this.lang] ?? key; }

  /** Comprobación estricta de rectángulo, como el original. */
  hot(x0, y0, x1, y1, m = this.mouse) { return m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1; }

  get ticksClock() { return this.clock && this.phase === 'idle'; }

  async enter() {
    if (!this.anim) { this.phase = 'idle'; return; }
    const buf = await this.game.assets.flic(this.anim);
    this.player = new FlicPlayer(buf, this.vga, { ticksPerFrame: this.ticksPerFrame, skippable: this.skippable, cues: this.cues, onCue: (c) => this.cue?.(c) });
    this.phase = 'in';
  }

  /** Sale reproduciendo la animación de salida (si la hay) y luego llama a `then`. */
  async exit(then) {
    if (this.phase === 'out') return;
    if (!this.out) { then(); return; }
    this.phase = 'out';
    this.after = then;
    this.player = new FlicPlayer(await this.game.assets.flic(this.out), this.vga, { ticksPerFrame: this.ticksPerFrame });
  }

  update() {
    const dt = this.game.loop.step;
    if (this.player && (this.phase === 'in' || this.phase === 'out')) {
      if (this.player.update(dt)) {
        this.player = null;
        if (this.phase === 'in') { this.vga.saveBackground(); this.phase = 'idle'; this.ready?.(); }
        else { this.phase = 'done'; this.after?.(); }
      }
      return;
    }
    if (this.phase === 'idle') { this.frame++; this.tick?.(); }
  }

  render() {
    if (this.phase === 'idle') { this.vga.restoreBackground(); this.draw(this.vga); }
    this.vga.present(this.game.ctx);
  }

  onClick(e) {
    if (this.phase === 'in' && this.skippable) { this.player.skip(); return; }
    if (this.phase === 'idle') this.click(e);
  }
  onKey(code, ch) { return this.phase === 'idle' ? (this.key?.(code, ch) ?? false) : false; }

  // ---------------------------------------------------------- elementos comunes

  /** Fecha "%02d:%d:%dNC" (hora, día, año) en (500, 10) (`0x18f30`). */
  drawClock(vga) {
    const k = this.campaign.clock;
    this.gfx.text(vga, `${String(k.hour).padStart(2, '0')}:${k.day}:${k.year}NC`, 500, 10, FONT.HOT);
  }

  /** Logo de la compañía en (9, 7) del buffer de 320 (`0x186f0`). */
  drawLogo(vga) {
    const a = this.game.assets, c = this.campaign;
    const color = a.ui.syndicateColors[c.colour ?? 0];
    vga.mask(a.logos, (c.logo ?? 0) * LOGO_SIZE * LOGO_SIZE, LOGO_SIZE, LOGO_SIZE, 9, 7, color, 0);
  }

  /** Fondos centrados en 500…624, y = 0x58. */
  drawFunds(vga, y = 0x58) {
    const s = String(this.campaign.funds);
    this.gfx.text(vga, s, Math.trunc((0x7c - this.gfx.width(s, FONT.HOT)) / 2) + 500, y, FONT.HOT);
  }

  button(vga, key, x0, y0, x1, y1) { this.gfx.button(vga, this.label(key), x0, y0, x1 - x0, this.hot(x0, y0, x1, y1)); }
}
