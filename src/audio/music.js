// Música (SPEC §13.1): secuenciador de los MIDI convertidos de XMI y sintetizador propio en
// WebAudio. [DIS] El original usa FM OPL (GAMEFM.DLL); aquí cada familia General MIDI tiene una
// voz sencilla (oscilador + filtro + ADSR) y la percusión se hace con ruido filtrado.

import { parseMidi } from './midi.js';

const LOOKAHEAD = 0.25, TICK_MS = 50;
const DRUM_CHANNEL = 9;

/** Voz por familia GM (programa >> 3): forma de onda, corte del filtro, ataque y caída. */
const FAMILIES = [
  ['triangle', 3000, 0.005, 0.8],   // piano
  ['sine', 5000, 0.002, 0.5],       // percusión cromática
  ['square', 2500, 0.01, 2.0],      // órgano
  ['sawtooth', 2200, 0.005, 0.6],   // guitarra
  ['triangle', 900, 0.005, 0.7],    // bajo
  ['sawtooth', 1800, 0.08, 2.5],    // cuerdas
  ['sawtooth', 1600, 0.12, 3.0],    // conjunto
  ['sawtooth', 2600, 0.03, 1.5],    // metales
  ['square', 2000, 0.03, 1.5],      // lengüeta
  ['sine', 3500, 0.03, 1.5],        // flauta
  ['square', 3500, 0.005, 1.5],     // sintetizador solista
  ['sawtooth', 1200, 0.2, 3.5],     // sintetizador pad
  ['sawtooth', 1500, 0.05, 2.0],    // efectos
  ['triangle', 2500, 0.005, 0.8],   // étnicos
  ['triangle', 1800, 0.002, 0.3],   // percusivos
  ['square', 1000, 0.01, 0.5],      // efectos de sonido
];

const freq = (note) => 440 * 2 ** ((note - 69) / 12);

export class MusicPlayer {
  /** @param {import('./audio.js').AudioEngine} engine */
  constructor(engine, base = 'assets') {
    this.engine = engine; this.base = base;
    this.cache = new Map();
    this.current = null;            // {key, song, start, index, loop, gen}
    this.timer = null;
    this.generation = 0;
  }

  async #song(file) {
    if (!this.cache.has(file)) this.cache.set(file, fetch(`${this.base}/audio/music/${file}`).then((r) => r.arrayBuffer()).then((b) => parseMidi(new Uint8Array(b))));
    return this.cache.get(file);
  }

  /** Secuencia actual ('syngame-0', 'intro-0'…) o null. */
  get playing() { return this.current?.key ?? null; }
  /** ¿Ha terminado la secuencia sin bucle? (`0x3ba10`) */
  get finished() { return !!this.current && this.current.done; }

  /**
   * Cambia de secuencia solo si es otra (`0x3b8a0`).
   * @param {string|null} key p. ej. 'syngame-1'; null = silencio
   */
  async select(key, { loop = true } = {}) {
    if (key === this.playing) return;
    this.stop();
    if (!key) return;
    const gen = ++this.generation;
    const song = await this.#song(`${key}.mid`);
    if (gen !== this.generation || !this.engine.ctx) return;
    this.current = { key, song, start: this.engine.ctx.currentTime + 0.05, index: 0, loop, done: false, channels: this.#channels(), notes: new Map() };
    this.timer = setInterval(() => this.#pump(), TICK_MS);
    this.#pump();
  }

  stop() {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) for (const v of this.current.notes.values()) this.#release(v, this.engine.ctx.currentTime);
    this.current = null;
  }

  #channels() { return Array.from({ length: 16 }, () => ({ program: 0, volume: 100 / 127, pan: 0, bend: 0 })); }

  #pump() {
    const c = this.current, ctx = this.engine.ctx;
    if (!c || !ctx) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    const events = c.song.events;
    while (c.index < events.length && c.start + events[c.index].time < horizon) {
      this.#event(c, events[c.index], c.start + events[c.index].time);
      c.index++;
    }
    if (c.index >= events.length) {
      if (c.loop) { c.start += c.song.duration + 0.01; c.index = 0; }
      else if (ctx.currentTime > c.start + c.song.duration) { c.done = true; clearInterval(this.timer); this.timer = null; }
    }
  }

  #event(c, e, t) {
    const ch = c.channels[e.channel];
    switch (e.type) {
      case 'program': ch.program = e.a; break;
      case 'control':
        if (e.a === 7) ch.volume = e.b / 127;
        else if (e.a === 10) ch.pan = (e.b - 64) / 64;
        else if (e.a === 123) for (const [k, v] of c.notes) if (k >> 8 === e.channel) { this.#release(v, t); c.notes.delete(k); }
        break;
      case 'on': {
        const key = (e.channel << 8) | e.a;
        const old = c.notes.get(key);
        if (old) this.#release(old, t);
        c.notes.set(key, e.channel === DRUM_CHANNEL ? this.#drum(e.a, e.b / 127 * ch.volume, t) : this.#note(ch, e.a, e.b / 127, t));
        break;
      }
      case 'off': {
        const key = (e.channel << 8) | e.a, v = c.notes.get(key);
        if (v) { this.#release(v, t); c.notes.delete(key); }
        break;
      }
      default: break;
    }
  }

  #note(ch, note, velocity, t) {
    const ctx = this.engine.ctx, [wave, cutoff, attack, decay] = FAMILIES[ch.program >> 3];
    const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), env = ctx.createGain(), pan = ctx.createStereoPanner();
    osc.type = wave; osc.frequency.setValueAtTime(freq(note), t);
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const peak = 0.18 * velocity * ch.volume;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setTargetAtTime(peak * 0.6, t + attack, decay / 3);
    pan.pan.value = ch.pan;
    osc.connect(filter); filter.connect(env); env.connect(pan); pan.connect(this.engine.music);
    osc.start(t);
    return { osc, env };
  }

  #drum(note, velocity, t) {
    const ctx = this.engine.ctx, env = ctx.createGain();
    env.connect(this.engine.music);
    const peak = 0.3 * velocity;
    if (note === 35 || note === 36 || (note >= 41 && note <= 50 && ![42, 44, 46].includes(note))) {
      // Bombo y timbales: seno con caída de tono.
      const osc = ctx.createOscillator(), base = note <= 36 ? 55 : freq(note - 12);
      osc.frequency.setValueAtTime(base * 2.5, t); osc.frequency.exponentialRampToValueAtTime(base, t + 0.08);
      env.gain.setValueAtTime(peak, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(env); osc.start(t); osc.stop(t + 0.4);
      return { osc, env, oneShot: true };
    }
    // Caja, platos y demás: ruido con filtro paso alto o paso banda.
    const len = Math.floor(ctx.sampleRate * 0.4), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    src.buffer = buf;
    const hat = [42, 44, 46, 49, 51, 52, 55, 57, 59].includes(note);
    filter.type = hat ? 'highpass' : 'bandpass'; filter.frequency.value = hat ? 7000 : 1800;
    const length = note === 46 || note === 49 || note === 57 ? 0.35 : hat ? 0.06 : 0.18;
    env.gain.setValueAtTime(peak * (hat ? 0.5 : 1), t); env.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(filter); filter.connect(env); src.start(t); src.stop(t + length + 0.02);
    return { osc: src, env, oneShot: true };
  }

  #release(v, t) {
    if (v.oneShot) return;
    try {
      v.env.gain.cancelScheduledValues(t);
      v.env.gain.setTargetAtTime(0, t, 0.08);
      v.osc.stop(t + 0.5);
    } catch { /* nota ya terminada */ }
  }
}
