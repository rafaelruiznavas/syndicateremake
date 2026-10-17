// Núcleo jugable frente a SPEC.md: RNG, direcciones, terreno, paso, velocidad, colisión,
// animación y una misión real (si están los recursos extraídos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Rng16 } from '../src/core/rng.js';
import { DIR_X, DIR_Y, directionTo, octant } from '../src/core/angles.js';
import { TileMap } from '../src/world/map.js';
import { Terrain } from '../src/world/terrain.js';
import { SpatialGrid } from '../src/world/spatial.js';
import { firstOverlap } from '../src/world/collision.js';
import { effectiveSpeed, legsSpeed, adrenalineScale } from '../src/systems/movement.js';
import { Person, PersonKind, S } from '../src/entities/person.js';
import { StaticObject } from '../src/entities/entity.js';
import { Animator } from '../src/systems/animation.js';
import { World } from '../src/world/world.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('levels/game01.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

/** Mapa sintético 128×96×12: tile = clase (identidad) para controlar cada caso. */
function syntheticMap(cells) {
  const tiles = new Uint8Array(128 * 96 * 12);
  for (const [tx, ty, tz, cls] of cells) tiles[(ty * 128 + tx) * 12 + tz] = cls;
  const classes = Array.from({ length: 256 }, (_, i) => i);
  return new TileMap({ width: 128, height: 96, depth: 12, tiles: Buffer.from(tiles).toString('base64') }, classes);
}

test('RNG §10: seed·0x24A1 + 0x24DF en 16 bits', () => {
  const r = new Rng16(0);
  assert.equal(r.next(), 0x24df);
  assert.equal(r.next(), (0x24df * 0x24a1 + 0x24df) & 0xffff);
  const s = new Rng16(1234); const v = s.int(100); assert.ok(v >= 0 && v < 100);
});

test('Direcciones §4: muestras de las tablas y octantes', () => {
  assert.deepEqual([0, 32, 64, 96, 128, 160, 192, 224].map((d) => DIR_X[d]), [0, 181, 256, 181, 0, -181, -256, -181]);
  assert.deepEqual([0, 32, 64, 96, 128].map((d) => DIR_Y[d]), [256, 181, 0, -181, -256]);
  assert.equal(directionTo(0, 100), 0); assert.equal(directionTo(100, 0), 64); assert.equal(directionTo(-100, 0), 192);
  assert.equal(octant(192), 6); assert.equal(octant(0), 0); assert.equal(octant(250), 0);
});

test('Terreno §3: suelo plano, rampas, muro y regla de ±32', () => {
  const map = syntheticMap([
    [10, 10, 0, 5],             // suelo plano en el nivel 0 → superficie 128
    [11, 10, 0, 5], [11, 10, 1, 2],  // rampa +Y en el nivel 1
    [12, 10, 0, 5], [12, 10, 1, 5],  // bloque de un nivel → superficie 256
    [13, 10, 1, 0x0c],          // muro
  ]);
  const t = new Terrain(map);
  assert.equal(t.surface(10 * 256 + 50, 10 * 256 + 50, 0), 128);
  assert.equal(t.surface(11 * 256, 10 * 256 + 0, 128), 128 + 0);
  assert.equal(t.surface(11 * 256, 10 * 256 + 200, 128), 128 + 100);
  assert.equal(t.surface(13 * 256, 10 * 256, 128), 128 + 0x1000);
  assert.equal(t.ground(10 * 256 + 50, 10 * 256 + 50, 128), 128);
  // Subir un bloque entero (128 → 256) está prohibido; la rampa sí permite subir.
  assert.equal(t.stepDelta(12 * 256 + 10, 10 * 256 + 10, 128), null);
  assert.equal(t.stepDelta(11 * 256 + 10, 10 * 256 + 20, 128), 10);
  // Bajar más de 32 solo si se permite caer.
  assert.equal(t.stepDelta(10 * 256 + 10, 10 * 256 + 10, 256), null);
  assert.equal(t.stepDelta(10 * 256 + 10, 10 * 256 + 10, 256, true), -128);
});

test('Velocidad §4: piernas, adrenalina, mínimos y carga', () => {
  assert.deepEqual([0, 2, 4, 6].map(legsSpeed), [40, 48, 56, 64]);
  const agent = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.AGENT, baseSpeed: 40, adrenaline: { neutral: 128, level: 128 } });
  assert.equal(effectiveSpeed(agent), 16, 'adrenalina neutra → mínimo de agente (observado en el original)');
  agent.adrenaline = { neutral: 128, level: 255 };
  assert.equal(effectiveSpeed(agent), 40);
  const guard = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.GUARD, baseSpeed: 32, adrenaline: { neutral: 50, level: 178 } });
  assert.equal(effectiveSpeed(guard), Math.trunc((32 * 128) / 205));
  const civ = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.CIVILIAN, baseSpeed: 32, adrenaline: { neutral: 128, level: 128 } });
  assert.equal(effectiveSpeed(civ), 12);
  // 500 por encima de la capacidad (1000) → base·500/1000
  agent.adrenaline = { neutral: 0, level: 255 };
  assert.equal(effectiveSpeed(agent, 1500), 20);
  assert.equal(adrenalineScale(40, { neutral: 100, level: 50 }), -20);
});

test('Colisión §5.3: caja de persona ±0x20 y de vehículo ±0x80', () => {
  const grid = new SpatialGrid();
  const a = new Person({ x: 5000, y: 5000, z: 256, kind: PersonKind.CIVILIAN });
  const tree = new StaticObject({ x: 6000, y: 5000, z: 256, class: 5, subtype: 0x0b });
  grid.insert(a); grid.insert(tree);
  assert.equal(firstOverlap(grid, null, 5000 + 0x20, 5000, 256, 0, 0, 0x100), a);
  assert.equal(firstOverlap(grid, null, 5000 + 0x21, 5000, 256, 0, 0, 0x100), null);
  assert.equal(firstOverlap(grid, null, 6000, 5000, 256 + 399, 0, 0, 1), tree, 'altura 400 del subtipo 0x0B');
  assert.equal(firstOverlap(grid, a, 5000, 5000, 256, 0, 0, 0x100), null, 'se excluye a sí misma');
});

test('Animación §5.4: agente desarmado mirando a 192 → animación 7', { skip: haveAssets !== true && haveAssets }, () => {
  const animator = new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json'));
  const p = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.AGENT, animSet: 1, facing: 192 });
  assert.equal(animator.personAnimation(p), 7);
  p.walkTo(10, 10, 0);
  assert.equal(animator.personAnimation(p), 1 + 8 + 6);
});

test('Misión 1 real: escuadra de 4, casillas 4..7 retiradas y marcha a 16 u/ciclo', { skip: haveAssets !== true && haveAssets }, () => {
  const level = asset('levels/game01.json');
  const map = asset(`maps/map${String(level.map).padStart(2, '0')}.json`);
  const animator = new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json'));
  const roster = Array.from({ length: 4 }, () => ({ health: 16, mods: 0 }));
  const w = new World(level, map, { tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), animator, roster });
  assert.equal(w.squad.length, 4);
  assert.equal(w.people.length, 14 - 4, 'las 4 casillas sin agente se retiran');
  const a = w.squad[0];
  assert.equal(a.baseSpeed, 40);
  const start = { x: a.x, y: a.y };
  w.select(0);
  w.orderMove(a.x - 1600, a.y, a.z);
  for (let i = 0; i < 10; i++) w.update();
  assert.equal(start.x - a.x, 160, '10 ciclos × 16 u');
  for (let i = 0; i < 100; i++) w.update();
  assert.equal(a.state, S.IDLE);
  assert.equal(a.x, start.x - 1600);
});
