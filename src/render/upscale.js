// Ampliación ×2 de pixel art (modo de gráficos mejorado [DIS], SPEC §15.1). Algoritmo
// Scale2x/EPX: cada píxel se convierte en 2×2 y una esquina toma el color de sus dos vecinos
// cuando estos coinciden entre sí y no con los otros dos, lo que suaviza diagonales y curvas
// sin mezclar colores. Trabaja sobre índices de paleta (canal R; A = 0 es transparente), así
// que el resultado sirve para cualquier paleta.

/** Clave de un píxel indexado: índice + transparencia. */
const keyAt = (d, i) => (d[i + 3] ? d[i] : 256);

/**
 * Scale2x de una imagen indexada (`ImageData` con R = índice y A = 0/255).
 * @param {{width:number, height:number, data:Uint8ClampedArray}} src
 * @returns {ImageData|{width:number, height:number, data:Uint8ClampedArray}}
 */
export function scale2x(src) {
  const w = src.width, h = src.height, s = src.data;
  const W = w * 2, H = h * 2;
  const out = typeof ImageData === 'function' ? new ImageData(W, H) : { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const d = out.data;
  const k = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) k[i] = keyAt(s, i * 4);
  const put = (x, y, key) => {
    const o = (y * W + x) * 4;
    if (key === 256) return;                       // transparente: queda a 0
    d[o] = key; d[o + 1] = key; d[o + 2] = key; d[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = k[y * w + x];
      const a = y > 0 ? k[(y - 1) * w + x] : p;          // arriba
      const b = x < w - 1 ? k[y * w + x + 1] : p;        // derecha
      const c = x > 0 ? k[y * w + x - 1] : p;            // izquierda
      const e = y < h - 1 ? k[(y + 1) * w + x] : p;      // abajo
      let p1 = p, p2 = p, p3 = p, p4 = p;
      if (a !== e && c !== b) {
        if (c === a) p1 = a;
        if (a === b) p2 = b;
        if (c === e) p3 = c;
        if (e === b) p4 = b;
      }
      put(2 * x, 2 * y, p1); put(2 * x + 1, 2 * y, p2);
      put(2 * x, 2 * y + 1, p3); put(2 * x + 1, 2 * y + 1, p4);
    }
  }
  return out;
}

/**
 * Scale2x de un framebuffer de índices sin transparencia (pantallas VGA), directamente a
 * RGBA con la paleta VGA de 6 bits. `out` tiene (2w)×(2h)×4 bytes.
 */
export function scale2xToRgba(px, w, h, pal6, out) {
  const W = w * 2;
  const put = (x, y, idx) => {
    const o = (y * W + x) * 4, c = idx * 3;
    out[o] = (pal6[c] * 255) / 63; out[o + 1] = (pal6[c + 1] * 255) / 63; out[o + 2] = (pal6[c + 2] * 255) / 63; out[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = px[row + x];
      const a = y > 0 ? px[row - w + x] : p, e = y < h - 1 ? px[row + w + x] : p;
      const c = x > 0 ? px[row + x - 1] : p, b = x < w - 1 ? px[row + x + 1] : p;
      let p1 = p, p2 = p, p3 = p, p4 = p;
      if (a !== e && c !== b) {
        if (c === a) p1 = a;
        if (a === b) p2 = b;
        if (c === e) p3 = c;
        if (e === b) p4 = b;
      }
      put(2 * x, 2 * y, p1); put(2 * x + 1, 2 * y, p2);
      put(2 * x, 2 * y + 1, p3); put(2 * x + 1, 2 * y + 1, p4);
    }
  }
}
