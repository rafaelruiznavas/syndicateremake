// Decodificadores de los formatos gráficos de Syndicate (ver SPEC §13).
// Producen imágenes INDEXADAS: Uint8Array con índice de paleta por píxel y 255 = transparente.
// La paleta se aplica en tiempo de ejecución, porque cada misión usa la suya (HPAL01..05).

export const TRANSPARENT = 255;

const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const les16 = (b, o) => (le16(b, o) << 16) >> 16;

/** Paleta VGA de 768 bytes (componentes de 6 bits) → [[r,g,b] de 8 bits]. */
export function decodePalette(buf) {
  const out = [];
  for (let i = 0; i < 256; i++) out.push([0, 1, 2].map((k) => Math.round((buf[i * 3 + k] & 63) * 255 / 63)));
  return out;
}

/**
 * HBLK: 256 bloques de 64×48, cada uno con 6 punteros u32 (LE) a subtiles de 32×16.
 * Subtile = 16 filas × 20 bytes: máscara (1 = transparente) y 4 planos, cada uno un
 * dword big-endian de 32 píxeles. Subtiles por columnas: 0..2 izquierda (de arriba
 * abajo), 3..5 derecha. Puntero 0 = subtile vacío.
 */
export function decodeBlocks(buf) {
  const blocks = [];
  for (let t = 0; t < 256; t++) {
    const px = new Uint8Array(64 * 48).fill(TRANSPARENT);
    for (let s = 0; s < 6; s++) {
      const off = le32(buf, (t * 6 + s) * 4);
      if (!off) continue;
      const ox = s < 3 ? 0 : 32, oy = (s % 3) * 16;
      for (let r = 0; r < 16; r++) {
        const row = off + r * 20;
        const mask = be32(buf, row), p = [1, 2, 3, 4].map((k) => be32(buf, row + k * 4));
        for (let x = 0; x < 32; x++) {
          const bit = 31 - x;
          if ((mask >>> bit) & 1) continue;
          px[(oy + r) * 64 + ox + x] = ((p[0] >>> bit) & 1) | (((p[1] >>> bit) & 1) << 1) | (((p[2] >>> bit) & 1) << 2) | (((p[3] >>> bit) & 1) << 3);
        }
      }
    }
    blocks.push(px);
  }
  return blocks;
}

/** Tabla de sprites (TAB): entradas de 6 bytes = offset u32, ancho u8, alto u8. */
export function decodeSpriteTable(tab) {
  const out = [];
  for (let i = 0; i + 6 <= tab.length; i += 6) out.push({ offset: le32(tab, i), w: tab[i + 4], h: tab[i + 5] });
  return out;
}

/** Sprite planar de juego (HSPR): por cada 8 píxeles, 5 bytes = máscara + 4 planos. */
export function decodePlanarSprite(data, { offset, w, h }) {
  const px = new Uint8Array(w * h).fill(TRANSPARENT);
  const groups = Math.ceil(w / 16) * 2;          // filas alineadas a 16 píxeles
  for (let r = 0; r < h; r++) {
    for (let g = 0; g < groups; g++) {
      const b = offset + (r * groups + g) * 5;
      const [m, p0, p1, p2, p3] = data.subarray(b, b + 5);
      for (let x = 0; x < 8; x++) {
        const X = g * 8 + x; if (X >= w) break;
        const bit = 7 - x;
        if ((m >> bit) & 1) continue;
        px[r * w + X] = ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1) | (((p2 >> bit) & 1) << 2) | (((p3 >> bit) & 1) << 3);
      }
    }
  }
  return px;
}

/** Sprite RLE de menú (MSPR, fuentes): por fila, byte de control >0 literales, <0 salto, 0 fin de fila. */
export function decodeRleSprite(data, { offset, w, h }) {
  const px = new Uint8Array(w * h).fill(TRANSPARENT);
  let p = offset;
  for (let y = 0; y < h; y++) {
    let x = 0;
    for (;;) {
      const c = (data[p++] << 24) >> 24;
      if (c === 0) break;
      if (c < 0) { x -= c; continue; }
      for (let i = 0; i < c; i++, x++) { const v = data[p++]; if (x < w) px[y * w + x] = v; }
    }
  }
  return px;
}

/**
 * Animaciones de juego.
 * HSTA: u16 primer frame por animación.
 * HFRA: 8 B por frame = primer elemento, ancho, alto, flags, siguiente frame.
 * HELE: 10 B por elemento = sprite (offset en TAB, múltiplo de 6), dx, dy, flags (bit 0 = espejo), siguiente.
 */
export function decodeAnimations(sta, fra, ele) {
  const anims = [];
  for (let i = 0; i + 2 <= sta.length; i += 2) anims.push(le16(sta, i));
  const frames = [];
  for (let i = 0; i + 8 <= fra.length; i += 8) frames.push({ first: le16(fra, i), w: fra[i + 2], h: fra[i + 3], flags: le16(fra, i + 4), next: le16(fra, i + 6) });
  const elements = [];
  for (let i = 0; i + 10 <= ele.length; i += 10) elements.push({ sprite: le16(ele, i) / 6, dx: les16(ele, i + 2), dy: les16(ele, i + 4), flip: ele[i + 6] & 1, next: le16(ele, i + 8) });
  return { anims, frames, elements };
}

/** Empaqueta imágenes indexadas en un atlas (estantes por filas). Devuelve {width, height, pixels, rects}. */
export function packAtlas(images, maxWidth = 1024, pad = 1) {
  const rects = [];
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const im of images) {
    if (!im || !im.w || !im.h) { rects.push(null); continue; }
    if (x + im.w > maxWidth) { x = 0; y += rowH + pad; rowH = 0; }
    rects.push({ x, y, w: im.w, h: im.h });
    x += im.w + pad; rowH = Math.max(rowH, im.h); width = Math.max(width, x);
  }
  const height = y + rowH;
  const pixels = new Uint8Array(width * height).fill(TRANSPARENT);
  images.forEach((im, i) => {
    const r = rects[i]; if (!r) return;
    for (let yy = 0; yy < r.h; yy++) pixels.set(im.px.subarray(yy * r.w, (yy + 1) * r.w), (r.y + yy) * width + r.x);
  });
  return { width, height, pixels, rects };
}

/** Imagen indexada → RGBA con el índice en el canal R (para recolorear en ejecución). */
export function indexedToRgba(pixels) {
  const out = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (v === TRANSPARENT) continue;
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Imagen indexada → RGBA real con una paleta [[r,g,b]] (para previsualizar). */
export function indexedToColor(pixels, palette) {
  const out = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]; if (v === TRANSPARENT) continue;
    const [r, g, b] = palette[v]; out.set([r, g, b, 255], i * 4);
  }
  return out;
}
