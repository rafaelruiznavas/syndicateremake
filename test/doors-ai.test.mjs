// Puertas y verjas (SPEC §5.6) y huida/seguimiento (SPEC §7.1) frente al original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StaticUpdate, Door, Gate } from '../src/systems/statics.js';
import { StaticObject, Vehicle } from '../src/entities/entity.js';
import { Person, PersonKind, S } from '../src/entities/person.js';
import { Detours } from '../src/systems/detour.js';
import { turnTowards } from '../src/systems/states.js';
import { World } from '../src/world/world.js';
import { Animator } from '../src/systems/animation.js';
import { Rng16 } from '../src/core/rng.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('levels/game02.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

/** Animador de juguete: cada animación dura `len` avances. */
function fakeAnimator(len = 2) {
  return {
    setAnimation(e, a) { if (e.anim !== a) { e.anim = a; e.step = 0; } },
    advance(e) { e.step = (e.step ?? 0) + 1; return e.step >= len; },
  };
}
function world(entities, animator = fakeAnimator()) {
  return { animator, grid: { *query() { yield* entities; } } };
}

test('Puertas §5.6 (`0x2b940`): se abren con una persona a ±0xA0 y se cierran cuando se va', () => {
  const door = new StaticObject({ x: 0x5000, y: 0x3000, z: 0x100, class: 5, subtype: Door.CLOSED, heading: 64, baseAnim: 1077 });
  const p = new Person({ x: 0x5000 + 0x90, y: 0x3000, z: 0x100, kind: PersonKind.CIVILIAN });
  const up = new StaticUpdate(world([p]));
  up.update(door); assert.deepEqual([door.subtype, door.anim], [Door.OPENING, 1077 + 2 + 1], 'abriéndose: base + 2 + lado');
  up.update(door); up.update(door); assert.equal(door.subtype, Door.OPEN);
  assert.equal(door.anim, 1077 + 4 + 1);
  p.x += 0x100;                                    // se aleja
  up.update(door); assert.equal(door.subtype, Door.CLOSING);
  up.update(door); up.update(door); assert.equal(door.subtype, Door.CLOSED);
  assert.equal(door.anim, 1077 + 1);
});

test('Puertas §5.6: no las abre nadie a otra altura ni un vehículo', () => {
  const door = new StaticObject({ x: 0x5000, y: 0x3000, z: 0x100, class: 5, subtype: Door.CLOSED, heading: 0, baseAnim: 10 });
  const above = new Person({ x: 0x5000, y: 0x3000, z: 0x300, kind: PersonKind.CIVILIAN });
  const car = new Vehicle({ x: 0x5000, y: 0x3000, z: 0x100, subtype: 13 });
  new StaticUpdate(world([above, car])).update(door);
  assert.equal(door.subtype, Door.CLOSED);
});

test('Verjas §5.6: un vehículo en las 5×5 casillas la abre; abierta queda oculta', () => {
  const gate = new StaticObject({ x: 0x5000, y: 0x3000, z: 0x100, class: 5, subtype: Gate.CLOSED, heading: 0 });
  const car = new Vehicle({ x: 0x5000 + 0x180, y: 0x3000 - 0x180, z: 0x100, subtype: 13 });
  const up = new StaticUpdate(world([car]));
  up.update(gate); assert.deepEqual([gate.subtype, gate.anim], [Gate.OPENING, 0x18c]);
  up.update(gate); up.update(gate); assert.deepEqual([gate.subtype, gate.hidden], [Gate.OPEN, true]);
  car.x += 0x1000;
  up.update(gate); assert.deepEqual([gate.subtype, gate.hidden, gate.anim], [Gate.CLOSING, false, 0x18d]);
});

test('Puertas §5.6 (GAME02): las del nivel cargan su animación base y orientación', { skip }, () => {
  const level = asset('levels/game02.json');
  const w = new World(level, asset(`maps/map${String(level.map).padStart(2, '0')}.json`), {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), research: new Map(),
    armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
    animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')), roster: Array.from({ length: 4 }, () => ({ health: 16, mods: 0 })),
  });
  const door = w.statics.find((s) => s.subtype === Door.CLOSED);
  assert.equal(door.baseAnim, 1077);
  const a = w.squad[0];
  a.x = door.x + 0x40; a.y = door.y; a.z = door.z; w.grid.move(a); a.stop();
  w.update();
  assert.equal(door.subtype, Door.OPENING);
});

test('Huida corta §7.1 (`0x306d0`): pared = primer eje bloqueado; gira 90° hacia donde ya miraba', () => {
  const wallY = 0x3000;   // bloqueado todo lo que esté en y ≥ 0x3000
  const w = { terrain: { stepDelta: (x, y) => (y >= wallY ? null : 0), walksRoads: () => true }, rng: new Rng16(1), grid: { move() {} } };
  const det = new Detours(w);
  const p = new Person({ x: 0x2000, y: wallY - 0x10, z: 0x100, kind: PersonKind.CIVILIAN, facing: 0x10 });
  p.speed = 0x28; p.state = S.FLEE;
  det.quick(p, 0x32, { x: 0x2000, y: 0x4000, z: 0x100 });
  assert.equal(p.detour.heading, 0x00, 'la pared está hacia +y (orientación 0)');
  assert.deepEqual([p.state, p.facing, p.timer, p.nextState], [S.WALL_LEFT, 0x40, 0x32, S.FLEE]);
});

test('Seguir §7.1 (`0x33370`): gira como mucho 0x10 por ciclo hacia su objetivo', () => {
  assert.equal(turnTowards(0, 0x40, 0x10), 0x10);
  assert.equal(turnTowards(0x10, 0x18, 0x10), 0x18);
  assert.equal(turnTowards(0x08, 0xf0, 0x10), 0xf8, 'por el camino corto, cruzando el 0');
});
