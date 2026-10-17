// Decodificador FLIC (formato público de Autodesk) en la variante de Syndicate:
// mini-cabecera de 12 bytes = u32 longitud (12), u16 0xAF12, u16 frames, u16 ancho,
// u16 alto. Después vienen frames estándar (u32 tamaño, u16 0xF1FA, u16 chunks,
// 8 reservados) con chunks:
//   4  COLOR_256  paleta de 8 bits
//   11 COLOR_64   paleta de 6 bits
//   7  DELTA_FLC  líneas de palabras
//   12 DELTA_FLI  líneas de bytes
//   13 BLACK      borrar
//   15 BYTE_RUN   RLE completa
//   16 FLI_COPY   sin comprimir

export function* decodeFlic(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint16(4, true) !== 0xaf12) throw new Error('FLIC: firma inválida');
  const frames = dv.getUint16(6, true), w = dv.getUint16(8, true), h = dv.getUint16(10, true);
  const px = new Uint8Array(w * h), pal = new Uint8Array(768);
  let p = dv.getUint32(0, true);
  for (let f = 0; f < frames && p + 16 <= buf.length; f++) {
    const size = dv.getUint32(p, true), magic = dv.getUint16(p + 4, true), chunks = dv.getUint16(p + 6, true);
    let palChanged = false, end = p + size;
    if (magic === 0xf1fa) {
      let c = p + 16;
      for (let k = 0; k < chunks; k++) {
        const csize = dv.getUint32(c, true), type = dv.getUint16(c + 4, true), d = c + 6;
        switch (type) {
          case 4: case 11: palette(buf, dv, d, pal, type === 11); palChanged = true; break;
          case 7: deltaFlc(buf, dv, d, px, w); break;
          case 12: deltaFli(buf, dv, d, px, w); break;
          case 13: px.fill(0); break;
          case 15: byteRun(buf, d, px, w, h); break;
          case 16: px.set(buf.subarray(d, d + w * h)); break;
          default: break;
        }
        c += csize;
      }
      // En los FLIC de Syndicate el tamaño del fotograma no siempre cuadra: el siguiente
      // empieza donde terminan los chunks si allí hay una cabecera 0xF1FA (SPEC §13).
      if (c + 6 <= buf.length && dv.getUint16(c + 4, true) === 0xf1fa) end = c;
    }
    yield { index: f, frames, w, h, pixels: px, palette: pal, palChanged };
    p = end;
  }
}

function palette(buf, dv, d, pal, sixBit) {
  const packets = dv.getUint16(d, true);
  let p = d + 2, i = 0;
  for (let k = 0; k < packets; k++) {
    i += buf[p++];
    let n = buf[p++]; if (n === 0) n = 256;
    for (let j = 0; j < n; j++, i++) for (let c = 0; c < 3; c++) {
      const v = buf[p++]; pal[i * 3 + c] = sixBit ? v : v >> 2;   // se guarda en 6 bits
    }
  }
}
function byteRun(buf, d, px, w, h) {
  let p = d;
  for (let y = 0; y < h; y++) {
    p++;                       // número de paquetes (ignorado)
    let x = 0;
    while (x < w) {
      const c = (buf[p++] << 24) >> 24;
      if (c > 0) { px.fill(buf[p++], y * w + x, y * w + x + c); x += c; }
      else { for (let i = 0; i < -c; i++) px[y * w + x++] = buf[p++]; }
    }
  }
}
function deltaFli(buf, dv, d, px, w) {
  let y = dv.getUint16(d, true);
  const lines = dv.getUint16(d + 2, true);
  let p = d + 4;
  for (let l = 0; l < lines; l++, y++) {
    const packets = buf[p++];
    let x = 0;
    for (let k = 0; k < packets; k++) {
      x += buf[p++];
      const c = (buf[p++] << 24) >> 24;
      if (c > 0) { for (let i = 0; i < c; i++) px[y * w + x++] = buf[p++]; }
      else { px.fill(buf[p++], y * w + x, y * w + x - c); x -= c; }
    }
  }
}
function deltaFlc(buf, dv, d, px, w) {
  let lines = dv.getUint16(d, true), p = d + 2, y = 0;
  while (lines > 0) {
    let op = dv.getInt16(p, true); p += 2;
    if ((op & 0xc000) === 0xc000) { y -= op; continue; }        // saltar líneas
    if ((op & 0xc000) === 0x8000) { px[y * w + w - 1] = op & 0xff; op = dv.getInt16(p, true); p += 2; }
    let x = 0;
    for (let k = 0; k < op; k++) {
      x += buf[p++];
      const c = (buf[p++] << 24) >> 24;
      if (c > 0) { for (let i = 0; i < c * 2; i++) px[y * w + x++] = buf[p++]; }
      else { const a = buf[p++], b = buf[p++]; for (let i = 0; i < -c; i++) { px[y * w + x++] = a; px[y * w + x++] = b; } }
    }
    y++; lines--;
  }
}
