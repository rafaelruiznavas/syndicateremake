// Fuente de misión HFNT01 (SPEC §13): 128 entradas de 5 B (offset u16, ancho, alto,
// desplazamiento vertical; 0xFFFF = sin glifo) y bitmaps de 1 bpp: una fila por byte si el
// ancho es < 8 y por palabra de 16 bits little‑endian si es ≥ 8; el bit alto es el píxel izquierdo.

export class MissionFont {
  /** @param {Uint8Array} data HFNT01 descomprimido */
  constructor(data) {
    this.glyphs = [];
    for (let c = 0; c < 128; c++) {
      const e = c * 5, off = data[e] | (data[e + 1] << 8), w = data[e + 2], h = data[e + 3], dy = data[e + 4];
      if (off === 0xffff) { this.glyphs.push({ w, h: 0, dy, bits: null }); continue; }
      const wide = w >= 8, bits = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = wide ? data[off + y * 2] | (data[off + y * 2 + 1] << 8) : data[off + y] << 8;
        for (let x = 0; x < w; x++) bits[y * w + x] = (row >> (15 - x)) & 1;
      }
      this.glyphs.push({ w, h, dy, bits });
    }
  }

  width(str) { let w = 0; for (const ch of str) w += (this.glyphs[ch.charCodeAt(0) & 127]?.w ?? 0) + 1; return w; }

  /** Dibuja en un contexto 2D con el color CSS dado; (x, y) es la esquina superior. */
  draw(ctx, str, x, y, color) {
    ctx.fillStyle = color;
    for (const ch of str) {
      const g = this.glyphs[ch.charCodeAt(0) & 127];
      if (!g) continue;
      if (g.bits) for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) if (g.bits[yy * g.w + xx]) ctx.fillRect(x + xx, y + g.dy + yy, 1, 1);
      x += g.w + 1;
    }
    return x;
  }
}
