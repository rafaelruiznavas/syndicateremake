// Render de la misión: terreno y entidades de atrás hacia delante, sobre un canvas
// lógico de 640×400 (vista de 512×400 a la derecha del panel).

import { TILE, LEVEL, SCREEN_WIDTH, SCREEN_HEIGHT, PANEL_WIDTH } from '../core/constants.js';

const BLOCK_W = 64, BLOCK_H = 48, BLOCK_COLS = 16;

export class Renderer {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx, assets) {
    this.ctx = ctx;
    this.assets = assets;
    this.sprites = assets.sprites;       // {sprites, frames, elements}
    this.debug = false;
  }

  setGraphics(gfx) {
    this.gfx = gfx;
    // Bloques sin ningún píxel visible (aire): no se dibujan.
    const img = this.assets.blocksIndexed, empty = new Uint8Array(256);
    for (let t = 0; t < 256; t++) {
      const ox = (t % BLOCK_COLS) * BLOCK_W, oy = Math.floor(t / BLOCK_COLS) * BLOCK_H;
      let visible = false;
      for (let y = 0; y < BLOCK_H && !visible; y++) for (let x = 0; x < BLOCK_W; x++) if (img.data[((oy + y) * img.width + ox + x) * 4 + 3]) { visible = true; break; }
      empty[t] = visible ? 0 : 1;
    }
    this.emptyBlock = empty;
  }

  /** Dibuja un frame compuesto (cadena de elementos) con el ancla en (sx, sy). */
  drawFrame(frameIndex, sx, sy, recolor) {
    const { frames, elements, sprites } = this.sprites, g = this.ctx, atlas = this.gfx.sprites;
    const frame = frames[frameIndex];
    if (!frame) return;
    for (let e = frame.first, guard = 0; e && guard < 64; guard++) {
      const el = elements[e];
      let sprite = el.sprite;
      if (recolor) sprite = recolor(sprite);
      const r = sprites[sprite];
      if (r) {
        const x = sx + el.dx, y = sy + el.dy;
        if (el.flip) {
          g.save(); g.translate(x + r.w, y); g.scale(-1, 1);
          g.drawImage(atlas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          g.restore();
        } else g.drawImage(atlas, r.x, r.y, r.w, r.h, x, y, r.w, r.h);
      }
      e = el.next;
    }
  }

  drawBlock(tile, sx, sy) {
    this.ctx.drawImage(this.gfx.blocks, (tile % BLOCK_COLS) * BLOCK_W, Math.floor(tile / BLOCK_COLS) * BLOCK_H, BLOCK_W, BLOCK_H, sx, sy, BLOCK_W, BLOCK_H);
  }

  /**
   * Orden de pintado: por diagonales (tx+ty) crecientes; dentro de cada columna, los
   * bloques por debajo de la entidad, luego la entidad y luego los bloques superiores.
   * Cada entidad se asigna a la casilla de la esquina delantera de su caja (x+0x20, y+0x20)
   * para que los suelos que pisa se dibujen antes que ella. [DIS]
   */
  render(world, camera) {
    const g = this.ctx, map = world.map;
    g.save();
    g.beginPath(); g.rect(PANEL_WIDTH, 0, SCREEN_WIDTH - PANEL_WIDTH, SCREEN_HEIGHT); g.clip();
    g.fillStyle = '#000'; g.fillRect(PANEL_WIDTH, 0, SCREEN_WIDTH - PANEL_WIDTH, SCREEN_HEIGHT);

    // Casillas visibles: se proyectan las esquinas de la vista a los niveles 0 y máximo.
    const corners = [];
    for (const [sx, sy] of [[PANEL_WIDTH, 0], [SCREEN_WIDTH, 0], [PANEL_WIDTH, SCREEN_HEIGHT + 64], [SCREEN_WIDTH, SCREEN_HEIGHT + 64]])
      for (const z of [0, map.depth * LEVEL]) corners.push(camera.unproject(sx, sy, z));
    const tx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) / TILE) - 1);
    const tx1 = Math.min(map.width - 1, Math.floor(Math.max(...corners.map((c) => c[0])) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) / TILE) - 1);
    const ty1 = Math.min(map.height - 1, Math.floor(Math.max(...corners.map((c) => c[1])) / TILE) + 1);

    const buckets = new Map();
    for (const e of world.entities) {
      if (e.hidden) continue;
      const tx = (e.x + 0x20) >> 8, ty = (e.y + 0x20) >> 8;
      if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue;
      const k = ty * map.width + tx;
      (buckets.get(k) ?? buckets.set(k, []).get(k)).push(e);
    }

    for (let s = tx0 + ty0; s <= tx1 + ty1; s++) {
      for (let tx = Math.max(tx0, s - ty1); tx <= Math.min(tx1, s - ty0); tx++) {
        const ty = s - tx;
        const ents = buckets.get(ty * map.width + tx);
        if (ents) ents.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.z - b.z);
        let next = 0;
        for (let tz = 0; tz < map.depth; tz++) {
          while (ents && next < ents.length && ents[next].z < tz * LEVEL + LEVEL / 2) this.drawEntity(ents[next++], camera, world);
          const tile = map.tileAt(tx, ty, tz);
          if (!tile || this.emptyBlock[tile]) continue;
          const [px, py] = camera.project(tx * TILE, ty * TILE, (tz + 1) * LEVEL);
          if (px + 32 < PANEL_WIDTH || px - 32 > SCREEN_WIDTH || py > SCREEN_HEIGHT || py + BLOCK_H < 0) continue;
          this.drawBlock(tile, px - 32, py);
        }
        while (ents && next < ents.length) this.drawEntity(ents[next++], camera, world);
      }
    }
    if (this.debug) this.drawDebug(world, camera);
    g.restore();
  }

  drawEntity(e, camera, world) {
    const [sx, sy] = camera.project(e.x, e.y, e.z);
    if (sx < PANEL_WIDTH - 64 || sx > SCREEN_WIDTH + 64 || sy < -64 || sy > SCREEN_HEIGHT + 96) return;
    this.drawFrame(e.frame, sx, sy, world.recolorFor(e));
    if (world.selection.has(e)) {
      const g = this.ctx; g.strokeStyle = '#ff0'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(sx, sy, 8, 4, 0, 0, Math.PI * 2); g.stroke();
    }
  }

  drawDebug(world, camera) {
    const g = this.ctx; g.font = '8px monospace'; g.fillStyle = '#0f0';
    for (const p of world.people) {
      const [sx, sy] = camera.project(p.x, p.y, p.z);
      g.fillText(`${p.state.toString(16)} z${p.z} v${p.speed}`, sx - 16, sy + 10);
    }
  }
}
