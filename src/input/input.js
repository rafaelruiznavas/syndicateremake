// Entrada: ratón y teclado → acciones de juego. Las coordenadas del ratón se convierten
// al espacio lógico de 640×400 de la misión.

import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../core/constants.js';

export class Input {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.mouse = { x: 320, y: 200, inside: false };
    this.keys = new Set();
    this.buttons = { left: false, right: false };
    this.handlers = { click: [], key: [] };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousemove', (e) => this.#move(e));
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.#move(e); canvas.focus();
      this.buttons[e.button === 2 ? 'right' : 'left'] = true;
      for (const h of this.handlers.click) h({ x: this.mouse.x, y: this.mouse.y, button: e.button === 2 ? 'right' : 'left', shift: e.shiftKey });
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => { this.buttons[e.button === 2 ? 'right' : 'left'] = false; });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      for (const h of this.handlers.key) if (h(e.code, e.key) === true) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  #move(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_WIDTH);
    this.mouse.y = Math.floor(((e.clientY - r.top) / r.height) * SCREEN_HEIGHT);
    this.mouse.inside = true;
  }
  onClick(h) { this.handlers.click.push(h); }
  onKey(h) { this.handlers.key.push(h); }
  held(code) { return this.keys.has(code); }
}
