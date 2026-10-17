// Escáner y cursor frente a SPEC.md §12.3 (`0x1bec0`, `0x1b5d0`, `0x2cb40`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scanner, BLIP_ROWS, circlePoints } from '../src/render/scanner.js';
import { Person, PersonKind } from '../src/entities/person.js';
import { Vehicle, Item } from '../src/entities/entity.js';
import { EventBus } from '../src/core/events.js';
import { MissionScene, Cursor } from '../src/scenes/mission.js';
import { W } from '../src/systems/weapons.js';

/** Mapa de 128×96 con la clase `cls` en todas las casillas del nivel 0 y entidades en una rejilla simple. */
function fakeWorld(entities, { cls = 5, objectives = [] } = {}) {
  const classes = new Uint8Array(256); classes[1] = cls;
  const squad = entities.filter((e) => e.isPlayerSquad);
  return {
    map: { classes, tileAt: (c, r, z) => (z === 0 ? 1 : 0) },
    grid: { *query(x, y) { for (const e of entities) if (!e.hidden && e.x >> 8 === x >> 8 && e.y >> 8 === y >> 8) yield e; } },
    squad, events: new EventBus(),
    objectives: { running: true, list: objectives },
  };
}
const agent = (x, y, group = 0) => {
  const p = new Person({ x, y, z: 0x100, kind: PersonKind.AGENT, group });
  if (group === 0) p.playerControlled = true;
  return p;
};

test('Escáner §12.3: 8 px por casilla, 4 si un agente lleva el escáner (tipo 10)', () => {
  const a = agent(0x4000, 0x3000);
  const w = fakeWorld([a]);
  assert.equal(Scanner.zoom(w), 8);
  a.items.push(new Item({ x: 0, y: 0, z: 0, class: 4, weapon: W.SCANNER }));
  assert.equal(Scanner.zoom(w), 4);
});

test('Escáner §12.3: el agente queda en el centro con la cruz; casillas de z px con el color de su clase', () => {
  const a = agent(0x4080, 0x3080);
  const view = new Scanner().layout(fakeWorld([a], { cls: 8 }), a, 8);
  assert.deepEqual(view.cross, { x: 64, y: 64 });
  assert.deepEqual(view.blips, [{ x: 64, y: 64, color: 0x0b }]);
  assert.equal(view.cells.length, 18 * 18, '16 casillas por lado más los bordes');
  assert.ok(view.cells.every((c) => c.size === 8 && c.color === 10), 'carretera → color 10');
  assert.deepEqual(view.cells[0], { x: -4, y: -4, size: 8, color: 10 }, 'origen a 8 casillas del agente, con su desplazamiento dentro de la casilla (0x80 → 4 px)');
});

test('Escáner §12.3: colores de las personas y cuadrado de z/2 para los vehículos', () => {
  const a = agent(0x4080, 0x3080);
  const rival = agent(0x4180, 0x3080, 3);
  const police = new Person({ x: 0x4280, y: 0x3080, z: 0x100, kind: PersonKind.POLICE });
  const guard = new Person({ x: 0x4380, y: 0x3080, z: 0x100, kind: PersonKind.GUARD });
  const civ = new Person({ x: 0x4480, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN });
  const convert = new Person({ x: 0x4580, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN }); convert.following = a;
  const car = new Vehicle({ x: 0x4080, y: 0x3180, z: 0x100, subtype: 13 });
  const view = new Scanner().layout(fakeWorld([a, rival, police, guard, civ, convert, car]), a, 8);
  const colorAt = (x) => view.blips.find((b) => b.x === x)?.color;
  assert.deepEqual([colorAt(64), colorAt(72), colorAt(80), colorAt(88), colorAt(96), colorAt(104)], [0x0b, 0x0e, 15, 4, undefined, 0x0b]);
  assert.deepEqual(view.squares, [{ x: 62, y: 70, size: 4, color: 0x0c }]);
});

test('Puntos §12.3 (`0x1b5d0`): tamaños 2–8 y simetría', () => {
  assert.deepEqual(BLIP_ROWS[3], [2, 2, 1]);
  assert.equal(Object.keys(BLIP_ROWS).length, 7);
  for (const [size, rows] of Object.entries(BLIP_ROWS)) assert.equal(rows.length, +size, `tamaño ${size}: ${size} filas desde el centro`);
});

test('Baliza §12.3: crece z por fotograma; al pasar del centro + 4z vuelve a 0 y suena 0x11', () => {
  const a = agent(0x4080, 0x3080);
  const target = new Person({ x: 0x4080 + 0x400, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN });
  const w = fakeWorld([a, target], { objectives: [{ type: 2, done: false, entity: target }] });
  const sounds = []; w.events.on('sound', (e) => sounds.push(e.id));
  const s = new Scanner();
  const [first] = s.beacon(w, a, 8, 0);
  assert.deepEqual(first, { x: 96, y: 64, r: 8, color: 0x0c }, 'centrada en el blanco, a 4 casillas = 32 px');
  for (let i = 0; i < 7; i++) s.beacon(w, a, 8, 0);
  assert.equal(s.ring, 64); assert.deepEqual(sounds, []);
  s.beacon(w, a, 8, 0);
  assert.equal(s.ring, 0); assert.deepEqual(sounds, [0x11]);
});

test('Círculo §12.3 (`0x1bbd0`): todos los puntos están a distancia r ± 1', () => {
  for (const [dx, dy] of circlePoints(10)) assert.ok(Math.abs(Math.hypot(dx, dy) - 10) < 1);
});

test('Cursor §12.3 (`0x2cb40`): panel 1, mapa 2, objeto 4, enemigo fuera de alcance 5, en alcance 6', () => {
  const lead = agent(0x4080, 0x3080);
  const enemy = agent(0x4080 + 0x300, 0x3080, 2);
  const far = agent(0x4080 + 0x3000, 0x3080, 2);
  const world = {
    leader: lead,
    weapons: { range: () => 0x800 },
    terrain: { solidAt: () => false },
    grid: { query: () => [] },
  };
  const at = (target, x = 300) => MissionScene.prototype.cursorAt.call({ world }, x, 200, target);
  assert.equal(at(null, 50), Cursor.PANEL);
  assert.equal(at(null), Cursor.MAP);
  assert.equal(at(new Item({ x: 0, y: 0, z: 0, class: 4, weapon: 2 })), Cursor.ITEM);
  assert.equal(at(enemy), Cursor.OUT_OF_RANGE, 'sin arma equipada');
  lead.equipped = new Item({ x: 0, y: 0, z: 0, class: 4, weapon: W.PISTOL });
  assert.equal(at(enemy), Cursor.IN_RANGE);
  assert.equal(at(far), Cursor.OUT_OF_RANGE);
  assert.equal(at(agent(0x4100, 0x3080)), Cursor.MAP, 'un agente propio no es blanco');
});
