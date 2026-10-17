// Sonido (SPEC §13.1): bancos VOC (extraídos a WAV) reproducidos con WebAudio y peticiones
// por ciclo como en el original (`0x387e0`/`0x38790`): cada id se pide con un volumen, queda el
// mayor, y al cerrar el ciclo se reproduce todo y la tabla se vacía.

export const Bank = Object.freeze({ GAME: 'sfx0', SCREENS: 'sfx1', INTRO: 'isnds0' });
const FULL_VOLUME = 0x7f;

export class AudioEngine {
  constructor(base = 'assets') {
    this.base = base;
    this.ctx = null;
    this.banks = new Map();             // nombre → Promise<AudioBuffer[]> (índice = id)
    this.pending = new Map();           // id → volumen (peticiones del ciclo)
    this.voices = new Map();            // `${bank}:${id}` → AudioBufferSourceNode
    this.muted = false;
    this.volumes = { music: 0.6, sfx: 1 };   // [DIS] opciones del remake (SPEC §15.1)
  }

  /** Volúmenes de 0 a 1 de la música y de los efectos. */
  setVolumes({ music = this.volumes.music, sfx = this.volumes.sfx } = {}) {
    this.volumes = { music, sfx };
    if (this.music) this.music.gain.value = music;
    if (this.sfx) this.sfx.gain.value = sfx;
  }

  /** El contexto solo puede arrancar tras un gesto del usuario. */
  unlock() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
      this.music = this.ctx.createGain(); this.music.gain.value = this.volumes.music; this.music.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 1; return this.muted; }

  /** Carga un banco (`sfx0`, `sfx1`, `isnds0`) y lo decodifica cuando haya contexto. */
  loadBank(name) {
    if (!this.banks.has(name)) {
      this.banks.set(name, (async () => {
        const index = await (await fetch(`${this.base}/audio/${name}.json`)).json();
        const raw = await Promise.all(index.map((e) => (e ? fetch(`${this.base}/${e.file}`).then((r) => r.arrayBuffer()) : null)));
        return { raw, buffers: [] };
      })());
    }
    return this.banks.get(name);
  }

  async #buffer(bankName, id) {
    const bank = await this.loadBank(bankName);
    if (!this.ctx) return null;
    const i = id - 1;                                  // id n = entrada n de la TAB (1-based)
    if (!bank.buffers[i] && bank.raw[i]) bank.buffers[i] = await this.ctx.decodeAudioData(bank.raw[i].slice(0));
    return bank.buffers[i] ?? null;
  }

  /** Reproduce en el acto (pantallas e intro). Devuelve la voz o null. */
  async play(bankName, id, volume = FULL_VOLUME) {
    if (!this.ready || !id) return null;
    const buf = await this.#buffer(bankName, id);
    if (!buf) return null;
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buf; gain.gain.value = volume / FULL_VOLUME;
    src.connect(gain); gain.connect(this.sfx);
    src.start();
    const key = `${bankName}:${id}`;
    try { this.voices.get(key)?.stop(); } catch { /* ya terminada */ }   // [INF] el mismo sonido se reinicia
    this.voices.set(key, src);
    src.onended = () => { if (this.voices.get(key) === src) this.voices.delete(key); };
    return src;
  }

  stopAll() { for (const v of this.voices.values()) { try { v.stop(); } catch { /* ya terminada */ } } this.voices.clear(); }

  /** Petición del ciclo (`0x387e0`): queda el volumen mayor por id. */
  request(id, volume = FULL_VOLUME) {
    if (!id) return;
    if ((this.pending.get(id) ?? -1) < volume) this.pending.set(id, volume);
  }

  /** Fin del ciclo: suenan las peticiones del banco de juego y la tabla se vacía (`0x38790`). */
  flush(bankName = Bank.GAME) {
    for (const [id, vol] of this.pending) this.play(bankName, id, vol);
    this.pending.clear();
  }
}
