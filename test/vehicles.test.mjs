// Vehículos, desvío y órdenes de grupo frente a SPEC.md §7.4, §7.5 y §11.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Driving, VehicleUpdate } from '../src/systems/vehicles.js';
import { Detours } from '../src/systems/detour.js';
import { Vehicle, Item, VehicleCondition } from '../src/entities/entity.js';
import { Person, PersonKind, S, Ev } from '../src/entities/person.js';
import { W } from '../src/systems/weapons.js';
import { Damage } from '../src/systems/damage.js';
import { World } from '../src/world/world.js';
import { Animator } from '../src/systems/animation.js';
import { Rng16 } from '../src/core/rng.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('levels/game02.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

/** Mundo mínimo: todas las casillas son carretera del sentido pedido y la rejilla devuelve `others`. */
function fakeWorld({ roadClass = 8, others = [] } = {}) {
  return {
    map: { classAt: () => roadClass },
    grid: { query: (x0, y0) => others.filter((e) => (e.x >> 8) === (x0 >> 8) && (e.y >> 8) === (y0 >> 8)), move() {}, remove() {}, insert() {} },
  };
}
const driver = (kind = PersonKind.CIVILIAN) => Object.assign(new Person({ x: 0, y: 0, z: 0, kind }), { driveSpeed: 0 });

test('Carril §7.4: se acerca al desplazamiento del sentido como mucho 0x20 por ciclo (`0x36900`)', () => {
  assert.equal(Driving.center(0x3710, 0xc0), 0x3730);
  assert.equal(Driving.center(0x37b0, 0xc0), 0x37c0);
  assert.equal(Driving.center(0x37f0, 0x40), 0x37d0);
});

test('Mirada adelante §7.4: sin giros acelera +4; con un giro frena 8 sin bajar de máx/2', () => {
  const v = new Vehicle({ x: 0x2080, y: 0x2080, z: 0x100, subtype: 13, heading: 0, maxSpeed: 100 });
  const d = driver(); d.destination = { x: 0x2080, y: 0x5080, z: 0x100 };
  const straight = new Driving(fakeWorld({ roadClass: 8 }));
  straight.lookahead(d, v);
  assert.equal(d.driveSpeed, 4);
  d.driveSpeed = 98; straight.lookahead(d, v); assert.equal(d.driveSpeed, 100);
  // Destino al este y carretera hacia el este (clase 7): gira en la primera casilla.
  const turning = new Driving({ ...fakeWorld(), map: { classAt: () => 7 } });
  d.destination = { x: 0x6080, y: 0x2080, z: 0x100 }; d.driveSpeed = 80;
  turning.lookahead(d, v);
  assert.equal(d.driveSpeed, 72);
  d.driveSpeed = 52; turning.lookahead(d, v);
  assert.equal(d.driveSpeed, 50, 'no baja de máx/2');
});

test('Mirada adelante §7.4: peatón delante de un conductor no agente → 0 en la primera casilla, −0x10 después; el agente no frena', () => {
  const v = new Vehicle({ x: 0x2080, y: 0x2080, z: 0x100, subtype: 13, heading: 0, maxSpeed: 100 });
  const walker = new Person({ x: 0x2080, y: 0x2180, z: 0x100, kind: PersonKind.CIVILIAN });
  const d = driver(); d.destination = { x: 0x2080, y: 0x5080, z: 0x100 }; d.driveSpeed = 60;
  new Driving(fakeWorld({ others: [walker] })).lookahead(d, v);
  assert.equal(d.driveSpeed, 0);
  walker.y = 0x2280; d.driveSpeed = 60;
  new Driving(fakeWorld({ others: [walker] })).lookahead(d, v);
  assert.equal(d.driveSpeed, 44);
  const agent = driver(PersonKind.AGENT); agent.destination = d.destination; agent.driveSpeed = 60;
  new Driving(fakeWorld({ others: [walker] })).lookahead(agent, v);
  assert.equal(agent.driveSpeed, 64);
});

test('Mirada adelante §7.4: detrás de otro vehículo copia su velocidad − 8', () => {
  const v = new Vehicle({ x: 0x2080, y: 0x2080, z: 0x100, subtype: 13, heading: 0, maxSpeed: 100 });
  const other = new Vehicle({ x: 0x2080, y: 0x2280, z: 0x100, subtype: 13, heading: 0, maxSpeed: 100 });
  other.occupants.push(Object.assign(driver(), { driveSpeed: 30 }));
  const d = driver(); d.destination = { x: 0x2080, y: 0x5080, z: 0x100 }; d.driveSpeed = 90;
  new Driving(fakeWorld({ others: [other] })).lookahead(d, v);
  assert.equal(d.driveSpeed, 22);
});

test('Línea recta §7.4 (subtipos 5 y 6): 0 en la casilla, −12 (mín. 12) a 1–2, máx/2 a 3, +4 más lejos', () => {
  const dr = new Driving(fakeWorld());
  const make = (tiles) => {
    const v = new Vehicle({ x: 0x2080, y: 0x2080, z: 0x100, subtype: 5, maxSpeed: 160 });
    const d = driver(); d.destination = { x: 0x2080, y: 0x2080 + tiles * 0x100, z: 0x100 }; d.driveSpeed = 40;
    v.occupants.push(d); d.vehicle = v; d.state = S.WALK;
    return [v, d];
  };
  let [v, d] = make(6); dr.drive(d, v); assert.equal(d.driveSpeed, 44); assert.equal(v.heading, 0);
  [v, d] = make(3); dr.drive(d, v); assert.equal(d.driveSpeed, 80);
  [v, d] = make(2); dr.drive(d, v); assert.equal(d.driveSpeed, 28);
  [v, d] = make(1); d.driveSpeed = 15; dr.drive(d, v); assert.equal(d.driveSpeed, 12);
  [v, d] = make(0); dr.drive(d, v); assert.equal(d.driveSpeed, 0); assert.equal(d.state, S.IDLE, 'en la casilla termina la acción');
});

test('Subir y bajar §7.4: el primero conduce; al bajar aparece en (x+1, y+1) y deja de estar oculto', () => {
  const dr = new Driving(fakeWorld());
  const v = new Vehicle({ x: 0x3000, y: 0x3000, z: 0x100, subtype: 13, maxSpeed: 100 });
  const a = new Person({ x: 0x3040, y: 0x3000, z: 0x100, kind: PersonKind.AGENT });
  const b = new Person({ x: 0x3000, y: 0x3040, z: 0x100, kind: PersonKind.AGENT });
  assert.ok(Driving.canBoard(a, v));
  assert.ok(!Driving.canBoard(new Person({ x: 0x3080, y: 0x3000, z: 0x100, kind: 1 }), v), 'a 0x80 ya no');
  assert.equal(dr.board(a, v), 'driver');
  assert.equal(dr.board(b, v), 'passenger');
  assert.ok(a.hidden && a.vehicle === v && v.driver === a);
  dr.leave(a);
  assert.equal(v.driver, b, 'el siguiente pasa a conducir');
  assert.deepEqual([a.x, a.y, a.hidden, a.vehicle], [0x3001, 0x3001, false, null]);
});

test('Carretera §7.4 (GAME02): al entrar en un cruce gira hacia el eje del destino si la casilla de al lado es carretera de ese sentido', { skip }, () => {
  const level = asset('levels/game02.json');
  const w = makeWorld(level);
  const dr = w.driving, dest = { x: 71 * 256 + 128, y: 45 * 256 + 128 };
  // Carril hacia el sur (clase 8) en la columna 55; fila 43 va al oeste y fila 45 al este.
  assert.equal(dr.chooseHeading(55 * 256 + 0xc0, 43 * 256 + 0x80, 0x100, 0x00, dest), 0x00, 'la fila 43 va al oeste: sigue recto');
  assert.equal(dr.chooseHeading(55 * 256 + 0xc0, 45 * 256 + 0x80, 0x100, 0x00, dest), 0x40, 'la fila 45 va al este: gira');
});

test('Suelo §4/§7.4: un peatón fuera de la calzada no pisa la carretera; un agente sí (`0x2fd20`)', { skip }, () => {
  const w = makeWorld(asset('levels/game02.json'));
  const t = w.terrain, z = 0x100;
  let pair = null;
  for (let y = 20; y < 70 && !pair; y++) for (let x = 30; x < 90 && !pair; x++) {
    if (w.map.classAt(x * 256 + 128, y * 256 + 128, z - 1) === 5 && w.map.classAt((x + 1) * 256 + 128, y * 256 + 128, z - 1) === 8) pair = [x, y];
  }
  assert.ok(pair, 'hay una acera junto a una carretera');
  const [x, y] = pair, nx = (x + 1) * 256 + 64, ny = y * 256 + 128;
  const civ = new Person({ x: x * 256 + 200, y: ny, z, kind: PersonKind.CIVILIAN });
  const agent = new Person({ x: x * 256 + 200, y: ny, z, kind: PersonKind.AGENT });
  assert.equal(t.walksRoads(civ), false);
  assert.equal(t.stepDelta(nx, ny, z, false, t.walksRoads(civ)), null);
  assert.equal(t.stepDelta(nx, ny, z, false, t.walksRoads(agent)), 0);
});

test('Desvío §7.5: con la pared al oeste y el destino al suroeste, sigue la pared por la izquierda hacia el sur', () => {
  const wallX = 0x4000;
  const world = {
    terrain: { stepDelta: (x) => (x < wallX ? null : 0), walksRoads: () => true },
    rng: new Rng16(1), grid: { move() {} },
  };
  const det = new Detours(world);
  const p = new Person({ x: wallX + 1, y: 0x2000, z: 0x100, kind: PersonKind.CIVILIAN, facing: 212 });
  p.destination = { x: 0x3c00, y: 0x2400, z: 0x100 };
  p.speed = 12;
  assert.ok(det.start(p, 500));
  assert.equal(p.state, S.WALL_LEFT);
  assert.equal(p.facing, 0x00, 'pared en 0xC0 (oeste) → orientación b + 0x40');
  assert.deepEqual(p.detour, { heading: 0xc0, tries: 4, startDist: Math.floor(Math.hypot(0x401, 0x400)) });
  assert.equal(p.timer, 500);
  assert.equal(det.start(p, 500), false, 'solo un desvío por ciclo');
  det.newCycle();
  // Seguir la pared: prueba girar hacia ella (bloqueado) y sigue recto; repone los intentos.
  assert.ok(det.follow(p, -0x40));
  assert.equal(p.facing, 0x00);
  assert.equal(p.detour.tries, 4);
});

test('Órdenes §11: el grupo se reparte 2×2 en la casilla pulsada; un agente solo, al punto exacto', { skip }, () => {
  const w = makeWorld(asset('levels/game01.json'));
  w.selectGroup();
  w.orderMove(0x3456, 0x2789, 0x100);
  assert.deepEqual(w.squad.map((a) => [a.destination.x, a.destination.y]), [[0x3440, 0x2740], [0x3440, 0x27c0], [0x34c0, 0x2740], [0x34c0, 0x27c0]]);
  w.select(1);
  w.orderMove(0x3456, 0x2789, 0x100);
  assert.deepEqual([w.squad[1].destination.x, w.squad[1].destination.y], [0x3456, 0x2789]);
});

test('Aceptación de órdenes §11 (`0x258f0`): disparando, la orden queda como siguiente estado', () => {
  const p = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.AGENT });
  p.state = S.FIRING;
  p.walkTo(100, 200, 0);
  assert.equal(p.state, S.FIRING);
  assert.equal(p.nextState, S.WALK);
  p.finishAction();
  assert.equal(p.state, S.WALK);
  p.state = S.AIM; p.walkTo(1, 2, 0);
  assert.equal(p.state, S.WALK, 'apuntando (0x1C) sí la acepta');
});

test('Misión 1 §7.4 (GAME01): el objetivo espera (0x28) hasta que entra un agente; después huye en su coche y la misión fracasa si llega', { skip }, () => {
  const w = makeWorld(asset('levels/game01.json'));
  const target = w.byRef.people[8], car = w.vehicles[0];
  assert.equal(target.state, S.WAIT_AGENT);
  assert.deepEqual(target.watch, { tx: 63, ty: 33, z: 0x100 });
  for (let i = 0; i < 60; i++) w.update();
  assert.equal(target.state, S.WAIT_AGENT, 'sin agentes cerca sigue esperando');
  const a = w.squad[0];
  a.x = 65 * 256 + 128; a.y = 36 * 256 + 128; a.z = 0x100; w.grid.move(a);
  const start = { x: car.x, y: car.y };
  let boardedAt = -1;
  for (let i = 0; i < 600 && w.objectives.running; i++) { w.update(); if (boardedAt < 0 && target.vehicle === car) boardedAt = i; }
  assert.ok(boardedAt > 0 && boardedAt < 300, `sube al coche (ciclo ${boardedAt})`);
  assert.equal(car.driver, target);
  assert.ok(Math.hypot(car.x - start.x, car.y - start.y) > 8 * 256, 'el coche se aleja por la carretera');
  assert.equal(w.objectives.reason, 'escenario', 'el paso 7 del guion hace fracasar la misión');
});

test('Animación §7.4 (`0x39890`): la tabla por modelo reproduce la animación guardada en los niveles', { skip }, () => {
  for (const name of ['game02', 'game03', 'game14']) {
    const level = asset(`levels/${name}.json`);
    for (const lv of level.vehicles) {
      const raw = Buffer.from(lv.raw, 'hex');
      const v = new Vehicle({ x: 0, y: 0, z: 0, subtype: lv.subtype, heading: raw[0x1a], wagonType: raw.readUInt16LE(0x0e) });
      assert.equal(v.animation, raw.readUInt16LE(0x12), `${name} vehículo ${lv.index} (subtipo ${lv.subtype})`);
    }
  }
  const car = new Vehicle({ x: 0, y: 0, z: 0, subtype: 13, heading: 0x40 });
  car.subtype = 0x0f; assert.equal(car.animation, 0x1c6 + 1, 'ardiendo: 4 orientaciones');
  car.subtype = 0x10; assert.equal(car.animation, 0x1ca + 1, 'chatarra');
  const wagon = new Vehicle({ x: 0, y: 0, z: 0, subtype: 9, heading: 0xc0, wagonType: 2 });
  wagon.subtype = 0x0c; assert.equal(wagon.animation, 0x1bc + 1);
});

/** Mundo de prueba para el ciclo de vehículos: rejilla con todas las entidades y animador sin frames. */
function lifeWorld(entities) {
  const sounds = [], effects = [];
  const world = {
    grid: { query: () => entities, move() {}, remove() {}, insert() {} },
    animator: { advance: () => false, setAnimation() {} },
    events: { emit: (type, e) => { if (type === 'sound') sounds.push(e.id); } },
    rng: new Rng16(7),
    stats: { propertyDamage: 0 },
    spawnEffect: (x, y, z, anim) => { const fx = { x, y, z, anim }; effects.push(fx); return fx; },
  };
  world.driving = new Driving(world);
  world.vehicleUpdate = new VehicleUpdate(world);
  return Object.assign(world, { sounds, effects });
}

test('Daño §7.4 (`0x395d0`): fuego −10, láser o explosión −300, bala sin resta extra; nada si el autor es el conductor', () => {
  const v = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 13, health: 400 });
  const shooter = new Person({ x: 0, y: 0, z: 0x100, kind: PersonKind.AGENT });
  const w = lifeWorld([v]);
  v.attacker = shooter;
  v.events = Ev.FIRE | Ev.EXPLOSION; w.vehicleUpdate.update(v); assert.equal(v.health, 390, 'el fuego tiene prioridad');
  v.events = Ev.EXPLOSION; w.vehicleUpdate.update(v); assert.equal(v.health, 90);
  v.events = Ev.BULLET; w.vehicleUpdate.update(v); assert.equal(v.health, 90);
  assert.equal(v.events, 0);
  const d = driver(PersonKind.AGENT); w.driving.board(d, v);
  v.attacker = d; v.events = Ev.LASER; w.vehicleUpdate.update(v);
  assert.equal(v.health, 90, 'el conductor no daña su propio vehículo');
});

test('Bala §7.4 (`0x13870`): −1 de resistencia y evento 0x40 al vehículo solapado; el conductor no le da al suyo', () => {
  const v = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 13, health: 30 });
  const shooter = new Person({ x: 0x2000, y: 0x3080, z: 0x100, kind: PersonKind.AGENT });
  const w = { grid: { query: () => [v] } };
  const dmg = new Damage();
  assert.equal(dmg.bulletHit(w, shooter, 0x3080 - 0xc0, 0x3080, 0x180), v, 'a 0x40 + 0x80 todavía da');
  assert.deepEqual([v.health, v.events, v.attacker], [29, Ev.BULLET, shooter]);
  assert.equal(dmg.bulletHit(w, shooter, 0x3080 - 0xc1, 0x3080, 0x180), null);
  v.occupants.push(shooter);
  assert.equal(dmg.bulletHit(w, shooter, 0x3080, 0x3080, 0x180), null);
});

test('Ocupantes §7.4 (`0x39530`): al recibir daño el civil baja y huye, el policía baja y persigue, el agente se queda', () => {
  const v = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 13, health: 30 });
  const civ = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.CIVILIAN });
  const cop = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.POLICE });
  const agent = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.AGENT });
  const shooter = new Person({ x: 0, y: 0, z: 0x100, kind: PersonKind.AGENT });
  const w = lifeWorld([v]);
  for (const p of [civ, cop, agent]) w.driving.board(p, v);
  v.events = Ev.BULLET; v.attacker = shooter;
  w.vehicleUpdate.update(v);
  assert.deepEqual([civ.state, civ.vehicle, civ.target, civ.adrenaline.level], [S.FLEE, null, shooter, 255]);
  assert.deepEqual([cop.state, cop.vehicle, cop.target], [S.PURSUE, null, shooter]);
  assert.equal(agent.vehicle, v);
  const loco = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 5, health: 100 });
  const rider = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.CIVILIAN });
  w.driving.board(rider, loco);
  loco.events = Ev.BULLET; loco.attacker = shooter; w.vehicleUpdate.update(loco);
  assert.equal(rider.vehicle, loco, 'las locomotoras no sueltan a nadie');
});

test('Explosión §7.4 (`0x39660`, `0x1eb80`): con resistencia < 0 arde 100 ciclos, suena 9 y la onda alcanza a quien está al lado', () => {
  const v = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 13, health: -1 });
  const near = new Person({ x: 0x3080 + 0x100, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN });
  const far = new Person({ x: 0x3080 + 0x200, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN });
  const other = new Vehicle({ x: 0x3080, y: 0x3080 + 0x180, z: 0x100, subtype: 13, health: 30 });
  const agent = new Person({ x: 0, y: 0, z: 0x100, kind: PersonKind.AGENT });
  agent.playerControlled = true;
  const w = lifeWorld([v, near, far, other]);
  const passenger = new Person({ x: 0, y: 0, z: 0, kind: PersonKind.AGENT });
  w.driving.board(passenger, v);
  v.attacker = agent;
  w.vehicleUpdate.update(v);
  assert.equal(v.condition, VehicleCondition.BURNING);
  assert.deepEqual([v.subtype, v.health], [0x0f, 100]);
  assert.deepEqual(w.sounds, [9]);
  assert.equal(w.effects[0].anim, 0x186);
  assert.equal(near.events & Ev.EXPLOSION, Ev.EXPLOSION);
  assert.equal(near.eventSource, agent);
  assert.equal(far.events, 0);
  assert.equal(other.events & Ev.EXPLOSION, Ev.EXPLOSION, 'otros vehículos también (y pierden 300)');
  w.vehicleUpdate.update(other);
  assert.equal(other.condition, VehicleCondition.INTACT);
  assert.ok(other.health < 0, 'explotará en el siguiente ciclo');
  // Arder: los ocupantes salen ardiendo; a los 101 ciclos queda la chatarra y suma su valor.
  w.vehicleUpdate.update(v);
  assert.deepEqual([passenger.vehicle, passenger.state, passenger.eventSource, passenger.hidden], [null, S.HIT_FIRE, agent, false]);
  for (let i = 0; i < 99; i++) w.vehicleUpdate.update(v);
  assert.equal(v.condition, VehicleCondition.BURNING);
  w.vehicleUpdate.update(v);
  assert.equal(v.condition, VehicleCondition.WRECK);
  assert.equal(w.stats.propertyDamage, 9000);
});

test('Llamas §7.4: suben 0x30 por ciclo y marcan fuego en una caja de 0x40', () => {
  const p = new Person({ x: 0x3000, y: 0x3000, z: 0x100, kind: PersonKind.CIVILIAN });
  const w = lifeWorld([p]);
  const fx = w.vehicleUpdate.flame(0x3000, 0x3000, 0x180, null);
  fx.tick(w);
  assert.equal(p.events, Ev.FIRE);
  assert.equal(fx.z, 0x1b0);
  p.events = 0; fx.tick(w); fx.tick(w);
  assert.equal(p.events, Ev.FIRE, 'en 0x1B0 y 0x1E0 aún toca a la persona (z..z+0x100)');
  p.events = 0; fx.tick(w);
  assert.equal(p.events, 0, 'en 0x210 ya pasa por encima');
});

test('Atropello §7.4: con un agente al volante a más de 0x1F, evento 0x01 en una caja de 0xF0 alrededor', () => {
  const v = new Vehicle({ x: 0x3080, y: 0x3080, z: 0x100, subtype: 13, health: 30, heading: 0x50 });
  const walker = new Person({ x: 0x3080 + 0x90, y: 0x3080, z: 0x100, kind: PersonKind.CIVILIAN });
  const w = lifeWorld([v, walker]);
  const d = driver(PersonKind.AGENT); w.driving.board(d, v);
  d.driveSpeed = 0x1f; w.vehicleUpdate.update(v);
  assert.equal(walker.events, 0);
  assert.equal(v.heading, 0x40, 'el rumbo se ajusta a 0/0x40/0x80/0xC0');
  d.driveSpeed = 0x20; w.vehicleUpdate.update(v);
  assert.equal(walker.events, Ev.OTHER);
  walker.events = 0; d.kind = PersonKind.CIVILIAN; w.vehicleUpdate.update(v);
  assert.equal(walker.events, 0, 'un civil no atropella');
});

test('Trenes §7.4 (GAME03): los vagones siguen a la locomotora con su desplazamiento (`+0x20`/`+0x22`)', { skip }, () => {
  const w = makeWorld(asset('levels/game03.json'));
  const head = w.byRef.vehicles[1], tail = w.byRef.vehicles[7];
  const wagons = [2, 3, 4, 5, 6].map((i) => w.byRef.vehicles[i]);
  assert.equal(wagons[0].link, head);
  assert.equal(tail.link, wagons[4]);
  assert.ok(wagons.every((v) => v.wagon) && head.straight && head.driver);
  const gaps = wagons.map((v) => v.y - v.link.y);
  head.y += 0x300; head.x += 4;
  w.update();
  assert.deepEqual(wagons.map((v) => v.y - v.link.y), gaps, 'mantienen la separación');
  assert.equal(tail.y, wagons[4].y + tail.linkOffset.y);
  assert.equal(wagons[0].x, head.x + wagons[0].linkOffset.x);
});

test('GAME02 §7.4: un coche tiroteado por un agente explota, arde y queda en chatarra', { skip }, () => {
  const w = makeWorld(asset('levels/game02.json'));
  const car = w.vehicles[0], agent = w.squad[0], driverBefore = car.driver;
  assert.ok(driverBefore && car.health === 30);
  const gun = new Item({ x: 0, y: 0, z: 0, class: 4, weapon: W.MINIGUN, ammo: 500 });
  gun.owner = agent; agent.items.push(gun); agent.equipped = gun;
  let explodedAt = -1;
  for (let i = 0; i < 200 && explodedAt < 0; i++) {
    agent.x = car.x - 0x280; agent.y = car.y; agent.z = car.z; w.grid.move(agent);
    w.orderFire(car.x, car.y, car.z + 0x80);
    w.update();
    if (car.destroyed) explodedAt = i;
  }
  assert.ok(explodedAt > 0, 'acaba explotando');
  assert.equal(car.subtype, 0x0f);
  assert.equal(car.attacker, agent);
  assert.notEqual(driverBefore.vehicle, car, 'el conductor civil ya no va dentro');
  assert.ok(w.effects.some((fx) => fx.anim === 0x186), 'efecto de explosión');
  for (let i = 0; i < 101; i++) w.update();
  assert.equal(car.condition, VehicleCondition.WRECK);
  assert.equal(w.stats.propertyDamage, 9000);
});

function makeWorld(level) {
  const map = asset(`maps/map${String(level.map).padStart(2, '0')}.json`);
  const animator = new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json'));
  const roster = Array.from({ length: 4 }, () => ({ health: 16, mods: 0 }));
  return new World(level, map, {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), animator, roster,
    research: new Map(), armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
  });
}
