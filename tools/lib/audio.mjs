// Audio: VOC (Creative Voice File, formato público) → WAV, y XMI (XMIDI) → MIDI estándar.

/** Extrae las muestras PCM de 8 bits sin signo de un VOC. Devuelve {rate, samples}. */
export function decodeVoc(buf) {
  if (String.fromCharCode(...buf.subarray(0, 19)) !== 'Creative Voice File') throw new Error('VOC: firma inválida');
  let p = buf[20] | (buf[21] << 8);
  const parts = [];
  let rate = 11025;
  while (p < buf.length) {
    const type = buf[p];
    if (type === 0) break;
    const len = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16);
    const d = p + 4;
    if (type === 1) {                       // datos: divisor de frecuencia + códec
      rate = Math.round(1000000 / (256 - buf[d]));
      if (buf[d + 1] === 0) parts.push(buf.subarray(d + 2, d + len));
    } else if (type === 2) parts.push(buf.subarray(d, d + len));
    p = d + len;
  }
  const total = parts.reduce((s, a) => s + a.length, 0);
  const samples = new Uint8Array(total);
  let o = 0; for (const a of parts) { samples.set(a, o); o += a.length; }
  return { rate, samples };
}

export function encodeWav({ rate, samples }) {
  const out = Buffer.alloc(44 + samples.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples.length, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate, 28); out.writeUInt16LE(1, 32); out.writeUInt16LE(8, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length, 40);
  Buffer.from(samples).copy(out, 44);
  return out;
}

// ---------- XMI ----------
// XMI: IFF con FORM XDIR (número de pistas) y CAT XMID con un FORM XMID por pista, cada
// uno con un chunk EVNT. Diferencias con MIDI: los retardos son sumas de bytes < 0x80
// (no longitud variable), y las notas incluyen su duración (longitud variable) en vez
// de un Note Off. Reloj de 120 ticks/s: se escribe un MIDI de 60 PPQN a 120 bpm.

function chunks(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    const id = String.fromCharCode(...buf.subarray(p, p + 4));
    const len = ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
    out.push({ id, start: p + 8, len });
    p += 8 + len + (len & 1);
  }
  return out;
}

function findEvents(buf) {
  const tracks = [];
  const walk = (start, end) => {
    for (const c of chunks(buf, start, end)) {
      if (c.id === 'FORM' || c.id === 'CAT ') walk(c.start + 4, c.start + c.len);
      else if (c.id === 'EVNT') tracks.push(buf.subarray(c.start, c.start + c.len));
    }
  };
  walk(0, buf.length);
  return tracks;
}

function readVlq(b, p) { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return [v, p]; }
function vlq(v) { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; }

function xmiTrackToMidi(ev) {
  const events = [];                    // {t, bytes}
  let t = 0, p = 0;
  while (p < ev.length) {
    const b = ev[p];
    if (b < 0x80) { t += b; p++; continue; }       // retardo
    const st = b, type = st & 0xf0; p++;
    if (st === 0xff) {
      const meta = ev[p++]; let len; [len, p] = readVlq(ev, p);
      const data = ev.subarray(p, p + len); p += len;
      if (meta === 0x2f) break;
      if (meta !== 0x51) events.push({ t, bytes: [0xff, meta, ...vlq(len), ...data] });   // ignora tempo XMI
      continue;
    }
    if (st === 0xf0 || st === 0xf7) { let len; [len, p] = readVlq(ev, p); events.push({ t, bytes: [st, ...vlq(len), ...ev.subarray(p, p + len)] }); p += len; continue; }
    if (type === 0x90) {
      const note = ev[p++], vel = ev[p++]; let dur; [dur, p] = readVlq(ev, p);
      events.push({ t, bytes: [st, note, vel] });
      events.push({ t: t + dur, bytes: [0x80 | (st & 0x0f), note, 0], off: true });
      continue;
    }
    const n = type === 0xc0 || type === 0xd0 ? 1 : 2;
    events.push({ t, bytes: [st, ...ev.subarray(p, p + n)] }); p += n;
  }
  events.sort((a, b) => a.t - b.t || (b.off ? 1 : 0) - (a.off ? 1 : 0));
  const data = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];    // tempo 500000 µs/negra
  let last = 0;
  for (const e of events) { data.push(...vlq(e.t - last), ...e.bytes); last = e.t; }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return data;
}

/** Convierte un XMI en un array de ficheros MIDI (uno por pista/secuencia). */
export function xmiToMidi(buf) {
  return findEvents(buf).map((ev) => {
    const track = xmiTrackToMidi(ev);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 60];
    const tl = track.length;
    return Buffer.from([...head, 0x4d, 0x54, 0x72, 0x6b, (tl >>> 24) & 255, (tl >>> 16) & 255, (tl >>> 8) & 255, tl & 255, ...track]);
  });
}
