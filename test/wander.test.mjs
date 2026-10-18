// Paseantes (SPEC §7.1, estados 0x1D y 0x29): civiles y policías que deambulan por la ciudad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PersonStates } from '../src/systems/states.js';
import { Detours } from '../src/systems/detour.js';
import { Person, PersonKind, S } from '../src/entities/person.js';
import { Vehicle } from '../src/entities/entity.js';
import { World } from '../src/world/world.js';
import { Animator } from '../src/systems/animation.js';
import { Rng16 } from '../src/core/rng.js';

const ASSETS = new URL('../assets/', import.meta.url);
const skip = fs.existsSync(new URL('levels/game02.json', ASSETS)) ? false : 'recursos no extraídos (node tools/extract-assets.mjs)';
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

/** Mundo de juguete: `blocked(x, y)` decide el terreno y `tile(x, y)` el tile bajo los pies. */
function world({ blocked = () => false, tile = () => 0, entities = [] } = {}) {
  const w = {
    terrain: { stepDelta: (x, y) => (blocked(x, y) ? null : 0), walksRoads: () => false },
    map: { tileUnder: (x, y) => tile(x, y), classAt: () => 5 },
    rng: new Rng16(7),
    grid: { move() {}, *query() { yield* entities; } },
    animator: { advance: () => false, refreshPerson() {} },
    carriedWeight: () => 0,
  };
  w.detours = new Detours(w);
  w.states = new PersonStates(w);
  return w;
}
const civilian = (props = {}) => new Person({ x: 0x4080, y: 0x4080, z: 0x100, kind: PersonKind.CIVILIAN, ...props });
const run = (w, p) => w.states.handlers[p.state].call(w.states, p);

test('Pasear §7.1 (`0x33230`): paso de 0x10 en su orientación, que varía −1..+1 por ciclo', () => {
  const w = world(), p = civilian({ facing: 0x40, state: S.WANDER });
  for (let i = 0; i < 20; i++) {
    const { x, y, facing } = p;
    run(w, p);
    assert.equal(p.state, S.WANDER);
    assert.ok(Math.abs(Math.hypot(p.x - x, p.y - y) - 0x10) < 1, 'avanza 0x10 u');
    assert.ok(Math.abs(((p.facing - facing + 128) & 255) - 128) <= 1, 'gira como mucho 1');
  }
  assert.equal(p.wanders, true, 'queda marcado como paseante (+0x0b |= 0x10)');
});

test('Pasear §7.1: si choca, desvío corto de 10 ciclos y vuelta a pasear', () => {
  const w = world({ blocked: (x) => x >= 0x4100 }), p = civilian({ facing: 0x40, state: S.WANDER });
  for (let i = 0; i < 10 && p.state === S.WANDER; i++) run(w, p);
  assert.ok(p.state === S.WALL_LEFT || p.state === S.WALL_RIGHT);
  assert.equal(p.nextState, S.WANDER);
  assert.ok(p.timer <= 10);
  for (let i = 0; i < 12 && p.state !== S.WANDER; i++) run(w, p);
  assert.equal(p.state, S.WANDER, 'al acabar el desvío sigue paseando');
});

test('Siguiente estado §7.1 (`0x30250`): con +0x0b & 0x10 vuelve a pasear; sin ella, quieto', () => {
  const a = civilian({ wanders: true }); a.state = S.FLEE; a.finishAction();
  assert.equal(a.state, S.WANDER);
  const b = civilian(); b.state = S.FLEE; b.finishAction();
  assert.equal(b.state, S.IDLE);
});

test('Andén §7.1: en un borde 0x80 mirando a la vía espera 100 ciclos y sube a un vagón parado', () => {
  const w = world({ tile: () => 0x80 }), p = civilian({ facing: 0x90, state: S.WANDER });
  run(w, p);
  assert.equal(p.state, S.PLATFORM);
  assert.ok(Math.abs(p.facing - 0xc0) <= 1, 'mira hacia la vía (0xC0)');
  assert.equal(p.timer, 100);
  // Sin tren: a los 100 ciclos da media vuelta y sigue paseando.
  const f = p.facing;
  for (let i = 0; i <= 100; i++) run(w, p);
  assert.deepEqual([p.state, p.facing], [S.WANDER, (f + 0x80) & 255]);
  // Con un vagón sin conductor en la casilla de delante: sube.
  const q = civilian({ facing: 0xc0, state: S.PLATFORM }); q.timer = 100;
  const wagon = new Vehicle({ x: 0x3f80, y: 0x4080, z: 0x100, subtype: 0x09 });
  const w2 = world({ entities: [wagon] });
  run(w2, q);
  assert.deepEqual([q.state, q.target], [S.BOARD, wagon]);
});

test('Andén §7.1: el borde 0x81 solo para a quien va entre 0x40 y 0xC0, y le orienta a 0x80', () => {
  const w = world({ tile: () => 0x81 });
  const away = civilian({ facing: 0x10, state: S.WANDER }); run(w, away);
  assert.equal(away.state, S.WANDER);
  const toward = civilian({ facing: 0x60, state: S.WANDER }); run(w, toward);
  assert.equal(toward.state, S.PLATFORM);
  assert.ok(Math.abs(toward.facing - 0x80) <= 1);
});

test('Paseantes §7.1 (GAME02): conservan el estado inicial 0x1D y los desvíos en curso', { skip }, () => {
  const level = asset('levels/game02.json');
  const w = new World(level, asset(`maps/map${String(level.map).padStart(2, '0')}.json`), {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), research: new Map(),
    armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
    animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')), roster: Array.from({ length: 4 }, () => ({ health: 16, mods: 0 })),
  });
  const wanderers = w.people.filter((p) => p.state === S.WANDER);
  assert.ok(wanderers.length > 100, `${wanderers.length} paseantes`);
  assert.ok(wanderers.every((p) => p.wanders));
  const wall = w.people.find((p) => p.state === S.WALL_LEFT || p.state === S.WALL_RIGHT);
  assert.ok(wall?.detour && wall.nextState === S.WANDER && wall.timer > 0);
  const start = new Map(wanderers.map((p) => [p, [p.x, p.y]]));
  for (let i = 0; i < 100; i++) w.update();
  const moved = wanderers.filter((p) => Math.hypot(p.x - start.get(p)[0], p.y - start.get(p)[1]) > 0x100).length;
  assert.ok(moved > wanderers.length * 0.8, `se mueven ${moved} de ${wanderers.length}`);
});
