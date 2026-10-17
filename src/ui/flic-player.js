// Reproducción de las animaciones FLIC de las pantallas (SPEC §12.1, `0x3c558`). Cada
// fotograma dura `ticksPerFrame` ticks del temporizador de 72,83 Hz (5 en las pantallas,
// 15 en el título) [INF].

import { decodeFlic } from '../formats/flic.js';
import { TIMER_HZ } from '../core/constants.js';

export class FlicPlayer {
  /**
   * @param {Uint8Array} buf
   * @param {import('./vga.js').Vga} vga
   * @param {{frame:number, cmd:string, arg:number}[]} [cues] señales por fotograma (SPEC §13.1)
   * @param {(cue) => void} [onCue] recibe las señales distintas de A (velocidad)
   */
  constructor(buf, vga, { ticksPerFrame = 5, skippable = false, cues = [], onCue = null } = {}) {
    this.frames = decodeFlic(buf);
    this.vga = vga;
    this.frameTime = ticksPerFrame / TIMER_HZ;
    this.skippable = skippable;
    this.cues = cues; this.cueIndex = 0; this.onCue = onCue;
    this.count = 0;                                  // fotogramas mostrados (contador `0x5bde4`)
    this.elapsed = 0;
    this.done = false;
    this.next();                                    // el primer fotograma se ve en el acto
  }

  next() {
    const { value, done } = this.frames.next();
    if (done) { this.done = true; return; }
    this.vga.setPixels(value.pixels);
    if (value.palChanged || value.index === 0) this.vga.setPalette(value.palette);
    this.count++;
    this.#runCues();
  }

  /** Señales del fotograma actual (`0x3ba60`, `0x105dc`): se consumen en orden. */
  #runCues() {
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].frame < this.count) this.cueIndex++;
    while (this.cueIndex < this.cues.length && this.cues[this.cueIndex].frame === this.count) {
      const cue = this.cues[this.cueIndex++];
      if (cue.cmd === 'A' || cue.cmd === 'a') this.frameTime = Math.max(1, cue.arg) / TIMER_HZ;
      else this.onCue?.(cue);
    }
  }

  /** Avanza dt segundos; devuelve true al terminar. */
  update(dt) {
    this.elapsed += dt;
    while (!this.done && this.elapsed >= this.frameTime) { this.elapsed -= this.frameTime; this.next(); }
    return this.done;
  }

  /** Salta al final sin ejecutar señales (sonidos, música, textos). */
  skip() { if (this.skippable) this.finish(); }
  finish() { const cb = this.onCue; this.onCue = null; while (!this.done) this.next(); this.onCue = cb; }
}
