// Lector de MIDI estándar (SMF tipo 0/1) para las secuencias convertidas de XMI (SPEC §13):
// devuelve los eventos con su tiempo absoluto en segundos, aplicando los cambios de tempo.

function readVarLen(d, p) {
  let v = 0, b;
  do { b = d[p.i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
  return v;
}

/**
 * @param {Uint8Array} data
 * @returns {{events: {time:number, type:string, channel:number, a:number, b:number}[], duration:number}}
 */
export function parseMidi(data) {
  const str = (o) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
  const u32 = (o) => ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
  const u16 = (o) => (data[o] << 8) | data[o + 1];
  if (str(0) !== 'MThd') throw new Error('MIDI: cabecera inválida');
  const tracks = u16(10), division = u16(12);
  const raw = [];                                   // {tick, order, ...}
  let p = 8 + u32(4), order = 0;
  for (let t = 0; t < tracks && p < data.length; t++) {
    if (str(p) !== 'MTrk') break;
    const end = p + 8 + u32(p + 4);
    const ptr = { i: p + 8 };
    let tick = 0, status = 0;
    while (ptr.i < end) {
      tick += readVarLen(data, ptr);
      let b = data[ptr.i];
      if (b & 0x80) { status = b; ptr.i++; } else b = status;   // estado continuo
      const type = status & 0xf0, channel = status & 0x0f;
      if (status === 0xff) {
        const meta = data[ptr.i++], len = readVarLen(data, ptr);
        if (meta === 0x51) raw.push({ tick, order: order++, type: 'tempo', value: (data[ptr.i] << 16) | (data[ptr.i + 1] << 8) | data[ptr.i + 2] });
        if (meta === 0x2f) { ptr.i += len; break; }
        ptr.i += len;
      } else if (status === 0xf0 || status === 0xf7) {
        ptr.i += readVarLen(data, ptr);
      } else if (type === 0xc0 || type === 0xd0) {
        raw.push({ tick, order: order++, type: type === 0xc0 ? 'program' : 'pressure', channel, a: data[ptr.i++], b: 0 });
      } else {
        const a = data[ptr.i++], c = data[ptr.i++];
        const kind = type === 0x90 ? (c ? 'on' : 'off') : type === 0x80 ? 'off' : type === 0xb0 ? 'control' : type === 0xe0 ? 'bend' : 'other';
        raw.push({ tick, order: order++, type: kind, channel, a, b: c });
      }
    }
    p = end;
  }
  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);
  let tempo = 500000, lastTick = 0, time = 0;
  const events = [];
  for (const e of raw) {
    time += ((e.tick - lastTick) * tempo) / (division * 1e6);
    lastTick = e.tick;
    if (e.type === 'tempo') { tempo = e.value; continue; }
    events.push({ time, type: e.type, channel: e.channel, a: e.a, b: e.b });
  }
  return { events, duration: time };
}
