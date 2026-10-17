// Lector de ejecutables LE (DOS/4GW) para sacar TABLAS DE DATOS de MAIN.EXE: nombres,
// catálogos, territorios. Coloca cada objeto en su dirección base y aplica los fixups
// internos para que los punteros entre tablas sean direcciones utilizables. No se
// ejecuta nada: solo se leen datos.

export class LeImage {
  constructor(exe) {
    const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    const u32 = (o) => dv.getUint32(o, true), u16 = (o) => dv.getUint16(o, true), s16 = (o) => dv.getInt16(o, true);
    const le = u32(0x3c);
    if (exe[le] !== 0x4c || exe[le + 1] !== 0x45) throw new Error('MAIN.EXE no es un ejecutable LE');
    const H = (o) => u32(le + o);
    const pageSize = H(0x28), lastPage = H(0x2c), pages = H(0x14);
    const objTable = le + H(0x40), objCount = H(0x44);
    const fixPages = le + H(0x68), fixRecords = le + H(0x6c), dataPages = H(0x80);
    this.objects = [];
    for (let i = 0; i < objCount; i++) {
      const o = objTable + i * 24;
      this.objects.push({ size: u32(o), base: u32(o + 4), firstPage: u32(o + 12), pageCount: u32(o + 16) });
    }
    this.base = Math.min(...this.objects.map((o) => o.base));
    const end = Math.max(...this.objects.map((o) => o.base + o.size));
    this.bytes = new Uint8Array(end - this.base);
    for (const o of this.objects) {
      for (let k = 0; k < o.pageCount; k++) {
        const page = o.firstPage + k, size = page === pages ? lastPage : pageSize;
        const from = dataPages + (page - 1) * pageSize;
        this.bytes.set(exe.subarray(from, from + size), o.base - this.base + k * pageSize);
      }
    }
    const img = new DataView(this.bytes.buffer);
    for (const o of this.objects) {
      for (let k = 0; k < o.pageCount; k++) {
        const page = o.firstPage + k;
        let p = fixRecords + u32(fixPages + (page - 1) * 4);
        const stop = fixRecords + u32(fixPages + page * 4);
        while (p < stop) {
          const srcType = exe[p], flags = exe[p + 1]; p += 2;
          let list = null, single = 0;
          if (srcType & 0x20) list = exe[p++]; else { single = s16(p); p += 2; }
          let target; if (flags & 0x40) { target = u16(p); p += 2; } else target = exe[p++];
          let offset = 0;
          if ((srcType & 0xf) !== 2) { if (flags & 0x10) { offset = u32(p); p += 4; } else { offset = u16(p); p += 2; } }
          const sources = [];
          if (list !== null) { for (let j = 0; j < list; j++) sources.push(s16(p + 2 * j)); p += 2 * list; } else sources.push(single);
          const value = this.objects[target - 1].base + offset;
          for (const s of sources) {
            const at = o.base - this.base + k * pageSize + s;
            if (at < 0 || at + 4 > this.bytes.length) continue;
            if ((srcType & 0xf) === 7) img.setUint32(at, value >>> 0, true);
          }
        }
      }
    }
    this.view = img;
  }
  u8(va) { return this.bytes[va - this.base]; }
  s8(va) { return (this.u8(va) << 24) >> 24; }
  u16(va) { return this.view.getUint16(va - this.base, true); }
  s16(va) { return this.view.getInt16(va - this.base, true); }
  u32(va) { return this.view.getUint32(va - this.base, true); }
  s32(va) { return this.view.getInt32(va - this.base, true); }
  slice(va, n) { return this.bytes.slice(va - this.base, va - this.base + n); }
  cstr(va, max = 256) {
    let s = '';
    for (let i = 0; i < max; i++) { const c = this.u8(va + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
}
