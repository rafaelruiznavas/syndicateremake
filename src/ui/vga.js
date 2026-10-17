// Framebuffer indexado de 320×200 para las pantallas de gestión (SPEC §12.1). Las
// coordenadas que recibe están en el espacio lógico de 640×400 y se dividen entre 2,
// como en el original; al presentar se escala ×2 al canvas de 640×400.

export const VGA_W = 320;
export const VGA_H = 200;

export class Vga {
  constructor() {
    this.pixels = new Uint8Array(VGA_W * VGA_H);
    this.background = new Uint8Array(VGA_W * VGA_H);
    this.palette = new Uint8Array(768);            // 6 bits por componente, como la VGA
    this.canvas = null;                            // se crea al presentar (permite usarlo sin DOM)
  }

  setPalette(pal6) { this.palette.set(pal6.subarray(0, 768)); }
  setPixels(px) { this.pixels.set(px.subarray(0, VGA_W * VGA_H)); }
  saveBackground() { this.background.set(this.pixels); }
  restoreBackground() { this.pixels.set(this.background); }

  /** Píxel en coordenadas de 320×200. */
  plot(x, y, c) { if (x >= 0 && y >= 0 && x < VGA_W && y < VGA_H) this.pixels[y * VGA_W + x] = c; }
  /** Píxel en coordenadas lógicas de 640×400 (`0x42aee`). */
  pset(x, y, c) { this.plot(x >> 1, y >> 1, c); }

  /** Rectángulo lleno en coordenadas lógicas. */
  fillRect(x, y, w, h, c) {
    const x0 = Math.max(0, x >> 1), y0 = Math.max(0, y >> 1);
    const x1 = Math.min(VGA_W, (x + w) >> 1), y1 = Math.min(VGA_H, (y + h) >> 1);
    for (let yy = y0; yy < y1; yy++) this.pixels.fill(c, yy * VGA_W + x0, yy * VGA_W + x1);
  }

  /** Marco de 1 píxel (`0x187a0`). */
  frame(x0, y0, x1, y1, c) {
    for (let x = x0; x <= x1; x += 2) { this.pset(x, y0, c); this.pset(x, y1, c); }
    for (let y = y0; y <= y1; y += 2) { this.pset(x0, y, c); this.pset(x1, y, c); }
  }

  /**
   * Línea en coordenadas lógicas con paso de 2 (`0x1b3a0`). Con `dash`, alterna los colores
   * a y b cada 4 pasos desplazados por `phase` (`0x29030`, líneas animadas del mapa).
   */
  line(x0, y0, x1, y1, a, { b = a, phase = 0 } = {}) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const steps = Math.max(dx, dy) >> 1;
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const c = ((i + phase) & 4) ? b : a;
      this.pset(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
    }
  }

  /** Bitmap de 1 byte por píxel (máscaras del mapa, logos): ≠0 → color, 0 → `zero` (o nada). */
  mask(data, offset, w, h, x, y, color, zero = -1) {
    for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) {
      const v = data[offset + r * w + k];
      if (v) this.plot(x + k, y + r, color);
      else if (zero >= 0) this.plot(x + k, y + r, zero);
    }
  }

  /** Convierte a RGBA con la paleta y dibuja escalado en el contexto de 640×400. */
  present(ctx, x = 0, y = 0, scale = 2) {
    if (!this.canvas) { this.canvas = new OffscreenCanvas(VGA_W, VGA_H); this.g = this.canvas.getContext('2d'); this.image = new ImageData(VGA_W, VGA_H); }
    const d = this.image.data, pal = this.palette, px = this.pixels;
    for (let i = 0, j = 0; i < px.length; i++, j += 4) {
      const c = px[i] * 3;
      d[j] = (pal[c] * 255) / 63; d[j + 1] = (pal[c + 1] * 255) / 63; d[j + 2] = (pal[c + 2] * 255) / 63; d[j + 3] = 255;
    }
    this.g.putImageData(this.image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, x, y, VGA_W * scale, VGA_H * scale);
  }
}
