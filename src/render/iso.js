// Proyección isométrica de la misión (SPEC §1): con la cámara en (cx, cy) unidades,
//   sx = (dx − dy)/8 + 128,   sy = ((dx + dy)/2 − z)/8 + 16,   donde dx = x − cx, dy = y − cy.

import { VIEW_ORIGIN_X, VIEW_ORIGIN_Y, SCREEN_WIDTH } from '../core/constants.js';

export class Camera {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; this.width = SCREEN_WIDTH; }   // borde derecho de la vista

  project(x, y, z) {
    const dx = x - this.x, dy = y - this.y;
    return [((dx - dy) >> 3) + VIEW_ORIGIN_X, ((Math.trunc((dx + dy) / 2) - z) >> 3) + VIEW_ORIGIN_Y];
  }

  /** Como `project`, pero con precisión de medio píxel (lienzo ×2 de los gráficos mejorados). */
  projectFine(x, y, z) {
    const dx = x - this.x, dy = y - this.y;
    return [Math.round((dx - dy) / 4) / 2 + VIEW_ORIGIN_X, Math.round(((dx + dy) / 2 - z) / 4) / 2 + VIEW_ORIGIN_Y];
  }

  /** Punto del mundo bajo la posición de pantalla (sx, sy) a la altura z. */
  unproject(sx, sy, z) {
    const a = (sx - VIEW_ORIGIN_X) * 8;               // dx − dy
    const b = ((sy - VIEW_ORIGIN_Y) * 8 + z) * 2;     // dx + dy
    return [this.x + Math.round((a + b) / 2), this.y + Math.round((b - a) / 2)];
  }

  /** Coloca la cámara para que (x, y, z) quede en el punto de pantalla (sx, sy). */
  centerOn(x, y, z, sx, sy) {
    const a = (sx - VIEW_ORIGIN_X) * 8, b = ((sy - VIEW_ORIGIN_Y) * 8 + z) * 2;
    this.x = x - Math.round((a + b) / 2);
    this.y = y - Math.round((b - a) / 2);
  }
}
