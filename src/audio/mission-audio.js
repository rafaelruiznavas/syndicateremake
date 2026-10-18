// Audio de la misión (SPEC §13.1): sonidos de fotograma de las entidades visibles (`0x1d450`),
// sonidos posicionales (`0x10360`), peticiones por ciclo (`0x387e0`) y selección de la
// secuencia de música (`0x10010`).

import { Bank } from './audio.js';
import { Person, PersonKind } from '../entities/person.js';
import { MissionStatus } from '../systems/objectives.js';
import { VIEW_ORIGIN_X, VIEW_ORIGIN_Y } from '../core/constants.js';

const DANGER_DISTANCE = 0x1000;
const SEQ = Object.freeze({ NORMAL: 0, DANGER: 1, FAILED: 3, COMPLETED: 4 });

export class MissionAudio {
  /**
   * @param {import('../world/world.js').World} world
   * @param {import('../render/iso.js').Camera} camera
   * @param {import('./audio.js').AudioEngine} audio
   * @param {import('./music.js').MusicPlayer} music
   * @param {{frames: {flags:number}[]}} sprites
   */
  constructor(world, camera, audio, music, sprites) {
    this.world = world; this.camera = camera; this.audio = audio; this.music = music; this.sprites = sprites;
    this.endMusicDone = false;
    this.unsubscribe = world.events.on('sound', ({ id, at }) => { if (!at || this.inView(at)) audio.request(id); });
    audio.loadBank(Bank.GAME);
  }

  dispose() { this.unsubscribe(); this.music.stop(); }

  /** Margen de `0x10360`: −0x201 < sx < 0x400 y −0x191 < sy < 800 respecto al origen de la vista. */
  inView(e) {
    const [sx, sy] = this.camera.project(e.x, e.y, e.z);
    const x = sx - VIEW_ORIGIN_X, y = sy - VIEW_ORIGIN_Y;
    return x > -0x201 && x < 0x400 && y > -0x191 && y < 800;
  }

  /** Visible en la zona de juego (las entidades que se dibujan). */
  onScreen(e) {
    const [sx, sy] = this.camera.project(e.x, e.y, e.z);
    return sx > VIEW_ORIGIN_X - 64 && sx < (this.camera.width ?? 640) + 64 && sy > -96 && sy < 400 + 96;
  }

  /** Un ciclo: sonidos de fotograma, música y reproducción de las peticiones. */
  cycle() {
    const frames = this.sprites.frames;
    for (const e of this.world.entities) {
      if (e.hidden || !(e.frame >= 0)) continue;
      const id = (frames[e.frame]?.flags ?? 0) & 0xff;
      if (id && this.onScreen(e)) this.audio.request(id);
    }
    this.selectMusic();
    this.audio.flush(Bank.GAME);
  }

  selectMusic() {
    const o = this.world.objectives;
    if (o.status === MissionStatus.FAILED || o.status === MissionStatus.COMPLETED) {
      if (this.endMusicDone) return;
      const key = `syngame-${o.status === MissionStatus.FAILED ? SEQ.FAILED : SEQ.COMPLETED}`;
      if (this.music.playing !== key) this.music.select(key, { loop: false });
      else if (this.music.finished) { this.music.stop(); this.endMusicDone = true; }
      return;
    }
    if (o.status === MissionStatus.WITHDRAWN) { this.music.stop(); return; }
    this.music.select(`syngame-${this.danger() ? SEQ.DANGER : SEQ.NORMAL}`);
  }

  /** Un agente desplegado de otro sindicato, vivo y que no sigue a nadie, a < 0x1000 del líder. */
  danger() {
    const lead = this.world.leader;
    if (!lead || lead.dead) return false;
    return this.world.people.some((p) => p instanceof Person && p.is(PersonKind.AGENT) && p.is(PersonKind.DEPLOYED) && !p.isPlayerSquad
      && !p.dead && !p.following && Math.hypot(p.x - lead.x, p.y - lead.y) < DANGER_DISTANCE);
  }
}
