// Combate, persuasión, IA y objetivos frente a SPEC.md (§6.1b, §6.1c, §6.2, §6.4, §7.3, §8.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Rng16 } from '../src/core/rng.js';
import { Person, PersonKind, S, Ev } from '../src/entities/person.js';
import { Item } from '../src/entities/entity.js';
import { Damage, resistance } from '../src/systems/damage.js';
import { Weapons, W } from '../src/systems/weapons.js';
import { Persuasion } from '../src/systems/persuasion.js';
import { Animator } from '../src/systems/animation.js';
import { MissionStatus } from '../src/systems/objectives.js';
import { World } from '../src/world/world.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('levels/game01.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

const person = (kind, extra = {}) => new Person({ x: 0, y: 0, z: 0, kind, ...extra });
const carry = (p, weapon, ammo = 10) => { const it = new Item({ class: 4, weapon, ammo }); it.owner = p; p.items.push(it); return it; };

test('Resistencia §6.2: nivel del pecho (bits 5–6); los objetivos marcados no resisten', () => {
  assert.equal(resistance(person(PersonKind.AGENT, { mods: 0x60 })), 3);
  assert.equal(resistance(person(PersonKind.AGENT, { mods: 0x20 })), 1);
  const marked = person(PersonKind.AGENT, { mods: 0x60 }); marked.objectiveMarked = true;
  assert.equal(resistance(marked), 0);
});

test('Resistencia §6.2: los impactos cuentan siempre, 1/2, 1/4 y 1/6', () => {
  const dmg = new Damage(), world = { rng: new Rng16(1) };
  const N = 6000;
  const rate = (mods) => { let n = 0; const p = person(PersonKind.AGENT, { mods }); for (let i = 0; i < N; i++) if (dmg.admits(world, p)) n++; return n / N; };
  assert.equal(rate(0), 1);
  assert.ok(Math.abs(rate(0x20) - 1 / 2) < 0.03);
  assert.ok(Math.abs(rate(0x40) - 1 / 4) < 0.03);
  assert.ok(Math.abs(rate(0x60) - 1 / 6) < 0.03);
});

test('Daño por evento §6.2: explosión mata sin pecho; con pecho 3 resta 4', () => {
  const dmg = new Damage();
  const a = person(PersonKind.AGENT); assert.equal(dmg.applyReaction(a, S.HIT_EXPLOSION), true);
  const b = person(PersonKind.AGENT, { mods: 0x60 }); assert.equal(dmg.applyReaction(b, S.HIT_EXPLOSION), false);
  assert.equal(b.health, 12);
  const c = person(PersonKind.AGENT, { mods: 0x20 }); dmg.applyReaction(c, S.HIT_FIRE);
  assert.equal(c.health, 8);
});

test('Escudo §6.2: con el ENERGY SHIELD equipado la bala no resta salud', () => {
  const dmg = new Damage();
  const p = person(PersonKind.CIVILIAN);
  p.equipped = carry(p, W.ENERGY_SHIELD, 5);
  assert.equal(dmg.shielded(p), true);
  p.equipped.ammo = -1;
  assert.equal(dmg.shielded(p), false);
});

test('Elección de arma §6.1c: preferencia por rango y alcance máximo', () => {
  const weapons = new Weapons([]);
  const p = person(PersonKind.AGENT);
  const pistol = carry(p, W.PISTOL), shotgun = carry(p, W.SHOTGUN), mini = carry(p, W.MINIGUN, -1);
  assert.equal(weapons.choose(p, 0x300), shotgun, 'escopeta (5) gana a pistola (4) dentro de 0x400');
  assert.equal(weapons.choose(p, 0x480), pistol, 'fuera de 0x400 solo alcanza la pistola');
  assert.equal(weapons.choose(p, 0x800), null, 'la minigun agotada no cuenta');
  mini.ammo = 3;
  assert.equal(weapons.choose(p, 0x800), mini);
});

test('Persuasión §6.4: civil siempre; policía exige más de 7 puntos; agente exige más de 31', () => {
  const people = [];
  const persuasion = new Persuasion({ people });
  const agent = person(PersonKind.AGENT, { group: 0 });
  assert.equal(persuasion.admits(agent, person(PersonKind.CIVILIAN)), true);
  assert.equal(persuasion.admits(agent, person(PersonKind.POLICE)), false);
  // 4 policías seguidores × 2 = 8 → 8·1 + 1 = 9 > 7
  for (let i = 0; i < 4; i++) { const f = person(PersonKind.POLICE); f.following = agent; people.push(f); }
  assert.equal(persuasion.admits(agent, person(PersonKind.POLICE)), true);
  assert.equal(persuasion.admits(agent, person(PersonKind.AGENT, { group: 1 })), false);
});

function loadWorld(n) {
  const level = asset(`levels/game${String(n).padStart(2, '0')}.json`);
  const map = asset(`maps/map${String(level.map).padStart(2, '0')}.json`);
  const animator = new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json'));
  const weapons = asset('data/weapons.json');
  const roster = Array.from({ length: 4 }, () => ({ health: 16, mods: 0 }));
  return new World(level, map, {
    tileClasses: asset('data/tile-classes.json'), weapons, animator, roster,
    research: new Map(weapons.map((w) => [w.type, w.researchInitial])),
    enemyWeapons: asset('data/enemy-weapons.json'), armedTable: asset('data/weapon-armed.json'),
  });
}

test('Disparo §6.1b: una ráfaga de pistola a quemarropa resta salud y cuenta disparos y aciertos', { skip: haveAssets !== true && haveAssets }, () => {
  const w = loadWorld(1);
  const a = w.squad[0];
  const victim = w.people.find((p) => !p.isPlayerSquad && p.is(PersonKind.CIVILIAN));
  w.grid.remove(victim); victim.x = a.x + 0x100; victim.y = a.y; victim.z = a.z; w.grid.insert(victim);
  a.perception.level = 255; a.perception.neutral = 0;    // sin dispersión
  w.select(0);
  w.orderFire(victim.x, victim.y, victim.z + 0x80);
  assert.equal(w.stats.shots, 0, 'sin arma equipada no dispara (los agentes empiezan desarmados)');
  w.orderEquip(0);
  w.orderFire(victim.x, victim.y, victim.z + 0x80);
  const before = victim.health;
  w.update();
  assert.ok(w.stats.shots >= 1);
  assert.ok(victim.health < before || victim.dead, 'la bala impacta');
});

test('Objetivos GAME01 §8.1: matar a la persona marcada completa la misión; Esc×2 abandona', { skip: haveAssets !== true && haveAssets }, () => {
  const w = loadWorld(1);
  const o = w.objectives.list[0];
  assert.equal(o.type, 2);
  assert.ok(o.entity instanceof Person);
  o.entity.health = -1; o.entity.events |= Ev.BULLET; o.entity.eventSource = w.squad[0];
  for (let i = 0; i < 200 && w.objectives.running; i++) w.update();
  assert.equal(w.objectives.status, MissionStatus.COMPLETED);

  const w2 = loadWorld(1);
  w2.objectives.withdraw();
  assert.equal(w2.objectives.status, MissionStatus.WITHDRAWN);
});

test('Objetivos §8.1: si muere toda la escuadra la misión fracasa', { skip: haveAssets !== true && haveAssets }, () => {
  const w = loadWorld(2);
  for (const a of w.squad) { a.health = -1; a.state = S.DEAD; }
  w.update();
  assert.equal(w.objectives.status, MissionStatus.FAILED);
});

test('IA enemiga §7.3: GAME02 simula 300 ciclos sin errores y con agentes enemigos guionizados', { skip: haveAssets !== true && haveAssets }, () => {
  const w = loadWorld(2);
  const enemies = w.people.filter((p) => p.is(PersonKind.AGENT) && !p.isPlayerSquad);
  for (const e of enemies) assert.ok(e.is(PersonKind.SCRIPTED), 'los agentes enemigos llevan SCRIPTED');
  for (let i = 0; i < 300; i++) w.update();
  for (const p of w.people) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
});
