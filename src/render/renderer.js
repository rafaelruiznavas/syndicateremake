// Render de la misión: terreno y entidades de atrás hacia delante, sobre un canvas
// lógico de 640×400 (vista de 512×400 a la derecha del panel; más ancha en 16:9).

import { TILE, LEVEL, SCREEN_WIDTH, SCREEN_HEIGHT, PANEL_WIDTH } from '../core/constants.js';
import { paintKey, entityBox, blockInFront, drawPosition } from './occlusion.js';
import { Vehicle } from '../entities/entity.js';
import { Person, S } from '../entities/person.js';

const BLOCK_W = 64, BLOCK_H = 48, BLOCK_COLS = 16;
const OCCLUDE_REACH = 8;       // casillas por delante de la entidad en x e y que pueden taparla

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
        const x = sx + el.dx, y = sy + el.dy, k = this.gfx.scale ?? 1;
        if (el.flip) {
          g.save(); g.translate(x + r.w, y); g.scale(-1, 1);
          g.drawImage(atlas, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, r.w, r.h);
          g.restore();
        } else g.drawImage(atlas, r.x * k, r.y * k, r.w * k, r.h * k, x, y, r.w, r.h);
      }
      e = el.next;
    }
  }

  drawBlock(tile, sx, sy) {
    const k = this.gfx.scale ?? 1;
    this.ctx.drawImage(this.gfx.blocks, (tile % BLOCK_COLS) * BLOCK_W * k, Math.floor(tile / BLOCK_COLS) * BLOCK_H * k, BLOCK_W * k, BLOCK_H * k, sx, sy, BLOCK_W, BLOCK_H);
  }

  /**
   * Orden de pintado (`0x1d450`, SPEC §5.5): el mapa entero de atrás adelante; después las
   * entidades ordenadas por x+y y, tras cada una, los bloques que quedan delante de ella,
   * recortados a su rectángulo en pantalla.
   */
  render(world, camera, { alpha = 0, enhanced = false } = {}) {
    const g = this.ctx, map = world.map;
    this.alpha = enhanced ? alpha : 0;      // el modo original dibuja la posición del ciclo
    this.fx = enhanced ? this.effects ?? null : null;
    const right = this.right = camera.width ?? SCREEN_WIDTH;   // borde derecho: 640, o más en 16:9
    g.save();
    g.beginPath(); g.rect(PANEL_WIDTH, 0, right - PANEL_WIDTH, SCREEN_HEIGHT); g.clip();
    g.fillStyle = '#000'; g.fillRect(PANEL_WIDTH, 0, right - PANEL_WIDTH, SCREEN_HEIGHT);

    // Casillas visibles: se proyectan las esquinas de la vista a los niveles 0 y máximo.
    const corners = [];
    for (const [sx, sy] of [[PANEL_WIDTH, 0], [right, 0], [PANEL_WIDTH, SCREEN_HEIGHT + 64], [right, SCREEN_HEIGHT + 64]])
      for (const z of [0, map.depth * LEVEL]) corners.push(camera.unproject(sx, sy, z));
    const view = {
      tx0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) / TILE) - 1),
      tx1: Math.min(map.width - 1, Math.floor(Math.max(...corners.map((c) => c[0])) / TILE) + 1),
      ty0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) / TILE) - 1),
      ty1: Math.min(map.height - 1, Math.floor(Math.max(...corners.map((c) => c[1])) / TILE) + 1),
    };

    // 1. El mapa, por diagonales (tx+ty) y de abajo arriba en cada columna.
    for (let s = view.tx0 + view.ty0; s <= view.tx1 + view.ty1; s++) {
      for (let tx = Math.max(view.tx0, s - view.ty1); tx <= Math.min(view.tx1, s - view.ty0); tx++) {
        for (let tz = 0; tz < map.depth; tz++) this.drawMapBlock(map, camera, tx, s - tx, tz);
      }
    }

    // 2. Las entidades por x+y; cada una, tapada por los bloques que tiene delante.
    const ents = world.entities.filter((e) => !e.hidden && (e.x >> 8) >= view.tx0 - 2 && (e.x >> 8) <= view.tx1 + 2 && (e.y >> 8) >= view.ty0 - 2 && (e.y >> 8) <= view.ty1 + 2);
    ents.sort((a, b) => paintKey(a) - paintKey(b) || a.z - b.z);
    for (const e of ents) {
      const pos = drawPosition(e, this.alpha);
      if (this.fx && e instanceof Vehicle && !e.destroyed) {
        const [sx, sy] = camera.projectFine(pos.x, pos.y, pos.z);
        this.fx.underglow(g, sx, sy, e.id);
      }
      const bounds = this.drawEntity(e, camera, world, pos);
      if (bounds) this.occlude(e, bounds, map, camera, pos);
      if (this.fx && bounds) this.light(e, bounds, world, camera, pos);
    }
    if (this.debug) this.drawDebug(world, camera);
    g.restore();
  }

  drawMapBlock(map, camera, tx, ty, tz) {
    const tile = map.tileAt(tx, ty, tz);
    if (!tile || this.emptyBlock[tile]) return;
    const [px, py] = camera.project(tx * TILE, ty * TILE, (tz + 1) * LEVEL);
    if (px + 32 < PANEL_WIDTH || px - 32 > (this.right ?? SCREEN_WIDTH) || py > SCREEN_HEIGHT || py + BLOCK_H < 0) return;
    this.drawBlock(tile, px - 32, py);
  }

  /** Luces del modo mejorado [DIS]: destellos de los efectos y fogonazos al disparar. */
  light(e, [x0, y0, x1, y1], world, camera, pos) {
    const [sx, sy] = camera.projectFine(pos.x, pos.y, pos.z);
    if (world.effects.includes(e)) this.fx.flash(this.ctx, sx, sy, x1 - x0 > 40 || y1 - y0 > 40);
    else if (e instanceof Person && e.state === S.FIRING && !e.dead) this.fx.muzzle(this.ctx, sx, sy);
  }

  /** Vuelve a pintar, recortados al rectángulo de la entidad, los bloques que tiene delante. */
  occlude(e, [x0, y0, x1, y1], map, camera, pos = e) {
    const box = entityBox(e, pos), g = this.ctx;
    const ex = Math.floor(pos.x) >> 8, ey = Math.floor(pos.y) >> 8;
    let clipped = false;
    for (let s = ex + ey - 2; s <= ex + ey + OCCLUDE_REACH * 2; s++) {
      for (let tx = Math.max(0, ex - 2, s - (ey + OCCLUDE_REACH)); tx <= Math.min(map.width - 1, ex + OCCLUDE_REACH, s - (ey - 2)); tx++) {
        const ty = s - tx;
        if (ty < 0 || ty >= map.height) continue;
        for (let tz = 0; tz < map.depth; tz++) {
          const tile = map.tileAt(tx, ty, tz);
          if (!tile || this.emptyBlock[tile] || !blockInFront(tx, ty, tz, box)) continue;
          const [px, py] = camera.project(tx * TILE, ty * TILE, (tz + 1) * LEVEL);
          if (px + 32 <= x0 || px - 32 >= x1 || py + BLOCK_H <= y0 || py >= y1) continue;
          if (!clipped) { g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); clipped = true; }
          this.drawBlock(tile, px - 32, py);
        }
      }
    }
    if (clipped) g.restore();
  }

  /** Dibuja la entidad y devuelve su rectángulo en pantalla [x0, y0, x1, y1] (o null si no se ve). */
  drawEntity(e, camera, world, pos = e) {
    const [sx, sy] = this.alpha ? camera.projectFine(pos.x, pos.y, pos.z) : camera.project(pos.x, pos.y, pos.z);
    if (sx < PANEL_WIDTH - 64 || sx > (this.right ?? SCREEN_WIDTH) + 64 || sy < -64 || sy > SCREEN_HEIGHT + 96) return null;
    const selected = world.selection.has(e);
    if (selected && this.fx) this.fx.selection(this.ctx, sx, sy);
    this.drawFrame(e.frame, sx, sy, world.recolorFor(e));
    if (selected && !this.fx) {
      const g = this.ctx; g.strokeStyle = '#ff0'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(sx, sy, 8, 4, 0, 0, Math.PI * 2); g.stroke();
    }
    return this.frameBounds(e.frame, sx, sy);
  }

  /** Rectángulo que cubren los elementos de un frame anclado en (sx, sy). */
  frameBounds(frameIndex, sx, sy) {
    const { frames, elements, sprites } = this.sprites, frame = frames[frameIndex];
    if (!frame) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let el = frame.first, guard = 0; el && guard < 64; guard++) {
      const elem = elements[el], r = sprites[elem.sprite];
      if (r) {
        x0 = Math.min(x0, sx + elem.dx); y0 = Math.min(y0, sy + elem.dy);
        x1 = Math.max(x1, sx + elem.dx + r.w); y1 = Math.max(y1, sy + elem.dy + r.h);
      }
      el = elem.next;
    }
    return x0 < x1 ? [x0, y0, x1, y1] : null;
  }

  drawDebug(world, camera) {
    const g = this.ctx; g.font = '8px monospace'; g.fillStyle = '#0f0';
    for (const p of world.people) {
      const [sx, sy] = camera.project(p.x, p.y, p.z);
      g.fillText(`${p.state.toString(16)} z${p.z} v${p.speed}`, sx - 16, sy + 10);
    }
  }
}
