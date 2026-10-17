// Audio frente a SPEC.md §13.1: peticiones por ciclo, sonidos de disparo, señales de las
// animaciones, intro, lector MIDI y selección de la música de misión.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AudioEngine } from '../src/audio/audio.js';
import { parseMidi } from '../src/audio/midi.js';
import { MissionAudio } from '../src/audio/mission-audio.js';
import { FIRE_SOUND, W } from '../src/systems/weapons.js';
import { FlicPlayer } from '../src/ui/flic-player.js';
import { Vga } from '../src/ui/vga.js';
import { EventBus } from '../src/core/events.js';
import { Person, PersonKind } from '../src/entities/person.js';
import { MissionStatus } from '../src/systems/objectives.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('data/anim-cues.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));
const bin = (p) => new Uint8Array(fs.readFileSync(new URL(p, ASSETS)));

test('Peticiones §13.1: por ciclo queda el volumen mayor de cada id y la tabla se vacía', () => {
  const a = new AudioEngine();
  const played = [];
  a.play = (bank, id, vol) => played.push([bank, id, vol]);
  a.request(2, 40); a.request(2, 127); a.request(2, 60); a.request(0x1c); a.request(0);
  a.flush('sfx0');
  assert.deepEqual(played, [['sfx0', 2, 127], ['sfx0', 0x1c, 127]]);
  a.flush('sfx0');
  assert.equal(played.length, 2);
});

test('Disparo §13.1: sonido por arma (`0x3a970`)', () => {
  assert.deepEqual(
    [W.PISTOL, W.GAUSS, W.SHOTGUN, W.UZI, W.MINIGUN, W.LASER, W.FLAMER, W.LONG_RANGE].map((t) => FIRE_SOUND[t]),
    [2, 0x16, 1, 0xb, 0xd, 4, 5, 0xc],
  );
  assert.equal(FIRE_SOUND[W.PERSUADERTRON], undefined);
});

test('Señales §13.1: tablas de MGAMEWIN, MENDLOSE, MLOSEGAM y MENDWIN', { skip }, () => {
  const c = json('data/anim-cues.json');
  const fmt = (list) => list.map((e) => `${e.cmd}${e.arg}@${e.frame}`).join(' ');
  assert.equal(fmt(c.mgamewin), 'S7@1 S8@6 S9@15 A120@84');
  assert.equal(fmt(c.mendlose), 'A6@35 S13@35 S11@41 S4@83 A10@108 S5@108 S6@113');
  assert.equal(fmt(c.mlosegam), 'S12@1 S10@40');
  assert.equal(fmt(c.mendwin), 'S3@1 M2@1 A10@2');
});

test('Intro §13.1: 149 señales, música 0 en el fotograma 19 y subtítulos en tres idiomas', { skip }, () => {
  const c = json('data/anim-cues.json').intro;
  assert.equal(c.length, 149);
  assert.ok(c.some((e) => e.cmd === 'M' && e.arg === 0 && e.frame === 19));
  const subs = json('data/intro.json').subtitles;
  assert.equal(subs[1].en, 'CITY NAME : NEW HESSEN EUROPE');
  assert.equal(subs[1].it, "NOME CITTA': NEW-HESSEN EUROPA");
  const maxT = Math.max(...c.filter((e) => e.cmd === 'T').map((e) => e.arg));
  assert.equal(subs.length, maxT + 1);
});

test('FLIC §13.1: las señales se disparan al mostrar su fotograma; A cambia la velocidad; saltar no las ejecuta', { skip }, () => {
  const seen = [];
  const cues = [{ frame: 1, cmd: 'S', arg: 7 }, { frame: 3, cmd: 'A', arg: 10 }, { frame: 3, cmd: 'S', arg: 8 }, { frame: 20, cmd: 'S', arg: 9 }];
  const p = new FlicPlayer(bin('anims/mgamewin.flc'), new Vga(), { cues, onCue: (c) => seen.push(c.arg), skippable: true });
  assert.deepEqual(seen, [7]);
  p.next(); p.next();
  assert.deepEqual(seen, [7, 8]);
  assert.ok(Math.abs(p.frameTime - 10 / (1193182 / 16384)) < 1e-9);
  p.skip();
  assert.deepEqual(seen, [7, 8], 'saltar al final no lanza el sonido 9');
  assert.ok(p.done);
});

test('MIDI §13.1: las secuencias de SYNGAME duran lo esperado (60 PPQN, 120 ticks/s)', { skip }, () => {
  const durations = [0, 1, 2, 3, 4].map((i) => parseMidi(bin(`audio/music/syngame-${i}.mid`)).duration);
  assert.ok(durations[3] > 5 && durations[3] < 10, 'fracaso: corta');
  assert.ok(durations[4] > 4 && durations[4] < 8, 'éxito: corta');
  assert.ok(durations[0] > 60, 'misión: larga, en bucle');
  const ons = parseMidi(bin('audio/music/syngame-0.mid')).events.filter((e) => e.type === 'on');
  assert.ok(ons.length > 100);
  assert.ok(ons.every((e, i) => i === 0 || e.time >= ons[i - 1].time));
});

function stubWorld(enemyDistance) {
  const events = new EventBus();
  const lead = new Person({ x: 0x2000, y: 0x2000, z: 0, kind: PersonKind.AGENT | PersonKind.DEPLOYED });
  lead.playerControlled = true;
  const enemy = new Person({ x: 0x2000 + enemyDistance, y: 0x2000, z: 0, kind: PersonKind.AGENT | PersonKind.DEPLOYED | PersonKind.SCRIPTED });
  return { events, leader: lead, people: [lead, enemy], entities: [], objectives: { status: MissionStatus.RUNNING } };
}

test('Música de misión §13.1: secuencia 1 con un agente rival a < 0x1000 del líder; 0 si no; 3/4 al acabar', () => {
  const selected = [];
  const music = { playing: null, finished: false, select(k) { selected.push(k); this.playing = k; }, stop() { this.playing = null; } };
  const audio = { request() {}, flush() {}, loadBank() {} };
  const camera = { project: () => [300, 200] };
  const near = new MissionAudio(stubWorld(0x800), camera, audio, music, { frames: [] });
  near.selectMusic();
  const far = new MissionAudio(stubWorld(0x1800), camera, audio, music, { frames: [] });
  far.selectMusic();
  far.world.objectives.status = MissionStatus.FAILED;
  far.selectMusic();
  assert.deepEqual(selected, ['syngame-1', 'syngame-0', 'syngame-3']);
});

test('Sonidos de fotograma §13.1: el byte bajo de los flags de HFRA se pide si la entidad está a la vista', () => {
  const asked = [];
  const audio = { request: (id) => asked.push(id), flush() {}, loadBank() {} };
  const music = { playing: 'syngame-0', select() {}, stop() {} };
  const w = stubWorld(0x1800);
  w.entities = [{ frame: 1, x: 0, y: 0, z: 0 }, { frame: 2, x: 0, y: 0, z: 0, hidden: true }];
  const camera = { project: () => [300, 200] };
  new MissionAudio(w, camera, audio, music, { frames: [{ flags: 0 }, { flags: 0x115 }, { flags: 0x09 }] }).cycle();
  assert.deepEqual(asked, [0x15]);
});
