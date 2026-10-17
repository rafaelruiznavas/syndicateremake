// Bucle de juego: simulación a paso fijo (un ciclo = ticks/72,83 s) con acumulador de
// delta time; el render corre a la frecuencia del navegador.

import { cycleSeconds, DEFAULT_TICKS_PER_CYCLE } from './constants.js';

export class GameLoop {
  /** @param {{update: () => void, render: (alpha:number) => void}} game */
  constructor(game) {
    this.game = game;
    this.ticksPerCycle = DEFAULT_TICKS_PER_CYCLE;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.paused = false;
    this.frame = this.frame.bind(this);
  }
  get step() { return cycleSeconds(this.ticksPerCycle); }
  start() { this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  frame(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.25);   // evita espirales tras pestañas en segundo plano
    this.last = now;
    if (!this.paused) {
      this.accumulator += dt;
      while (this.accumulator >= this.step) { this.game.update(); this.accumulator -= this.step; }
    }
    this.game.render(this.paused ? 0 : this.accumulator / this.step);
    requestAnimationFrame(this.frame);
  }
}
