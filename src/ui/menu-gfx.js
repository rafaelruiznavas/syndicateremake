// Sprites y texto de las pantallas de gestión con MSPR-0 (SPEC §12.1): `0x4cfec` (blitter),
// `0x38f50` (texto), `0x38f00` (ancho), `0x38ac0` (botón), `0x38a60` (título) y
// `0x38c90` (caja de texto con ajuste de línea).

export const FONT = Object.freeze({ SMALL: 0x54, HOT: 0x166, LIST: 0xdd, BUTTON: 0x1ef, MENU_HOT: 0x278, MENU: 0x301, LOADING: 0x38a, TITLE: 0x413 });
const SPACING = -2;

export class MenuGfx {
  /** @param {ImageData} indexed atlas MSPR (R = índice, A = 0 transparente)  @param {{x,y,w,h}[]} rects */
  constructor(indexed, rects) { this.indexed = indexed; this.rects = rects; }

  /** Tamaño en unidades lógicas (el original duplica la TAB al cargar). */
  size(i) { const r = this.rects[i]; return r ? { w: r.w * 2, h: r.h * 2 } : { w: 0, h: 0 }; }

  sprite(vga, i, x, y) {
    const r = this.rects[i];
    if (!r) return;
    const src = this.indexed.data, W = this.indexed.width, ox = x >> 1, oy = y >> 1;
    for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
      const s = ((r.y + yy) * W + r.x + xx) * 4;
      if (src[s + 3]) vga.plot(ox + xx, oy + yy, src[s]);
    }
  }

  glyph(base, ch) { return base + ch.charCodeAt(0) - 0x20; }

  width(str, base, spacing = SPACING) {
    let w = 0;
    for (const ch of str) { if (ch === '\n') break; w += this.size(this.glyph(base, ch)).w + spacing; }
    return w;
  }

  /** Texto con línea base en y + 12 − alto. */
  text(vga, str, x, y, base, { spacing = SPACING, lineHeight = 16 } = {}) {
    let cx = x;
    for (const ch of String(str)) {
      if (ch === '\n') { y += lineHeight; cx = x; continue; }
      if (ch === ' ') { cx += this.size(base).w + spacing; continue; }
      const g = this.glyph(base, ch), { w, h } = this.size(g);
      if (!w) continue;
      this.sprite(vga, g, cx, y + 12 - h);
      cx += w + spacing;
    }
    return cx;
  }

  centered(vga, str, x, y, width, base) { this.text(vga, str, x + Math.trunc((width - this.width(str, base)) / 2), y, base); }

  /** Botón (`0x38ac0`): texto centrado en el ancho, a y + 8, resaltado si `hot`. */
  button(vga, label, x, y, w, hot) { this.centered(vga, label, x, y + 8, w, hot ? FONT.HOT : FONT.BUTTON); }

  /** Título centrado en 640 a y = 0x30 (`0x38a60`). */
  title(vga, str) { this.centered(vga, str, 0, 0x30, 0x280, FONT.TITLE); }

  /**
   * Caja de texto (`0x38c90`). `|` termina el texto visible, `\` fuerza salto y una línea
   * en blanco separa párrafos. Devuelve el índice donde seguiría la página siguiente o −1.
   */
  textBox(vga, str, start, x, y, w, h, base, lineHeight) {
    let cx = x, cy = y, i = start;
    const space = this.size(base).w;
    while (i < str.length && str[i] !== '|') {
      let j = i;
      while (j < str.length && !' \n\\|'.includes(str[j])) j++;
      const word = str.slice(i, j);
      const ww = this.width(word, base);
      if (cx + ww > x + w) { cy += lineHeight; cx = x; }
      if (cy > y + h) return i;
      this.text(vga, word, cx, cy, base);
      cx += ww + space;
      for (; j < str.length && ' \n\\'.includes(str[j]); j++) {
        if (str[j] === '\n' && str[j + 1] === '\n') { cy += lineHeight * 2; cx = x; j++; }
        else if (str[j] === '\\') { cy += lineHeight; cx = x; }
      }
      i = j;
    }
    return -1;
  }
}
