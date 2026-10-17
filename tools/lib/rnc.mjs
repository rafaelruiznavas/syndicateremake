// Descompresor RNC ProPack, método 1 (cabecera "RNC\x01").
//
// Formato:
//   cabecera de 18 bytes:
//     0..3   "RNC" + método
//     4..7   tamaño descomprimido (big-endian)
//     8..11  tamaño comprimido
//     12..15 CRC
//     16     margen
//     17     número de bloques
//   flujo de bits leído en palabras de 16 bits little-endian, bit menos significativo
//   primero, con dos bits iniciales que se descartan.
//
// Cada bloque trae tres tablas de Huffman (longitudes de literales, distancias y
// longitudes de copia) y un número de sub-bloques. Cada sub-bloque copia una tira de
// literales tomada directamente del flujo de bytes y, salvo el último, una
// referencia (distancia, longitud) hacia atrás en la salida.
// Una tabla de 0 hojas mantiene la tabla del bloque anterior.

export function isRnc(buf) {
  return buf.length >= 18 && buf[0] === 0x52 && buf[1] === 0x4e && buf[2] === 0x43 && buf[3] === 1;
}

export function unpackedSize(buf) {
  return ((buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7]) >>> 0;
}

class BitReader {
  constructor(src, pos) {
    this.src = src;
    this.pos = pos;              // posición de la palabra que ocupa los 16 bits altos
    this.buf = this.word(pos);
    this.count = 16;
  }
  word(p) { return (this.src[p] ?? 0) | ((this.src[p + 1] ?? 0) << 8); }
  peek(n) { return this.buf & ((1 << n) - 1); }
  skip(n) {
    this.buf >>>= n;
    this.count -= n;
    if (this.count < 16) {
      this.pos += 2;
      this.buf = (this.buf | (this.word(this.pos) << this.count)) >>> 0;
      this.count += 16;
    }
  }
  read(n) { const v = this.peek(n); this.skip(n); return v; }
  /** Tras copiar literales del flujo de bytes, la palabra alta se toma de la nueva posición. */
  resync() {
    this.count -= 16;
    this.buf &= (1 << this.count) - 1;
    this.buf = (this.buf | (this.word(this.pos) << this.count)) >>> 0;
    this.count += 16;
  }
}

function reverseBits(v, n) {
  let r = 0;
  for (let i = 0; i < n; i++) { r = (r << 1) | (v & 1); v >>= 1; }
  return r;
}

/** Lee una tabla canónica: 5 bits de número de hojas y 4 bits de longitud por hoja. */
function readTable(br, previous) {
  const leaves = br.read(5);
  if (leaves === 0) return previous;
  const lengths = [];
  for (let i = 0; i < leaves; i++) lengths.push(br.read(4));
  const codes = [];
  let code = 0;
  for (let len = 1; len <= 16; len++) {
    for (let value = 0; value < leaves; value++) {
      if (lengths[value] === len) codes.push({ code: reverseBits(code, len), len, value }), code++;
    }
    code <<= 1;
  }
  return codes;
}

function decodeValue(br, table) {
  for (const e of table) {
    if (br.peek(e.len) === e.code) {
      br.skip(e.len);
      if (e.value < 2) return e.value;
      const extra = e.value - 1;
      return (1 << extra) | br.read(extra);
    }
  }
  throw new Error('RNC: código de Huffman inválido');
}

/** Devuelve los datos descomprimidos (Uint8Array). Si no es RNC1, devuelve la entrada. */
export function unpack(src) {
  if (!isRnc(src)) return src;
  const out = new Uint8Array(unpackedSize(src));
  const blocks = src[17];
  const br = new BitReader(src, 18);
  br.skip(2);
  let o = 0, raw = [], dist = [], len = [];
  for (let b = 0; b < blocks; b++) {
    raw = readTable(br, raw);
    dist = readTable(br, dist);
    len = readTable(br, len);
    let sub = br.read(16);
    for (;;) {
      const n = decodeValue(br, raw);
      if (n) {
        for (let i = 0; i < n; i++) out[o++] = src[br.pos + i];
        br.pos += n;
        br.resync();
      }
      if (--sub <= 0) break;
      const back = decodeValue(br, dist) + 1;
      const count = decodeValue(br, len) + 2;
      for (let i = 0; i < count; i++, o++) out[o] = out[o - back];
    }
  }
  if (o !== out.length) throw new Error(`RNC: se esperaban ${out.length} bytes, salieron ${o}`);
  return out;
}
