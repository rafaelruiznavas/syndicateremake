// PERSUADERTRON (SPEC §6.4) y caza de los agentes enemigos (SPEC §7.3) frente al original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Persuasion } from '../src/systems/persuasion.js';
import { Weapons } from '../src/systems/weapons.js';
import { Person, PersonKind, S, Ev } from '../src/entities/person.js';
import { World } from '../src/world/world.js';
import { Animator } from '../src/systems/animation.js';

const ASSETS = new URL('../assets/', import.meta.url);
const skip = fs.existsSync(new URL('levels/game02.json', ASSETS)) ? false : 'recursos no extraídos (node tools/extract-assets.mjs)';
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

function world(people) {
  const w = { people, grid: { *query() { yield* people; } }, events: { emit() {} } };
  w.persuasion = new Persuasion(w);
  return w;
}
const person = (kind, x, props = {}) => new Person({ x, y: 0x4000, z: 0x100, kind, group: kind === PersonKind.AGENT ? 0 : 3, ...props });

test('PERSUADERTRON §6.4 (`0x3a970`, arma 1): actúa cada ciclo mientras está equipado y sin disparar', () => {
  const agent = person(PersonKind.AGENT, 0x4000), civ = person(PersonKind.CIVILIAN, 0x4090);
  agent.equipped = { weapon: 1, ammo: 50 };
  const w = world([agent, civ]);
  const weapons = new Weapons([{ type: 1, range: 256, fireMode: 2, activationWindow: 2 }]);
  weapons.emit(w);
  assert.equal(civ.events & Ev.PERSUADE, Ev.PERSUADE, 'sin disparar, ya marca a quien está cerca');
  assert.equal(civ.eventSource, agent);
  assert.equal(agent.events & Ev.PERSUADE, 0, 'no se marca a sí mismo');
  civ.events = 0; agent.fireWindow = 2;
  weapons.emit(w);
  assert.equal(civ.events, 0, 'disparándolo no hace nada');
  assert.equal(agent.equipped.ammo, 50, 'no gasta recurso');
});

test('PERSUADERTRON §6.4 (efecto 0x32): alcance ±0x80·(ojos+1) más ±0x20 de la persona', () => {
  for (const [eyes, reach] of [[0, 0xa0], [1, 0x120], [3, 0x220]]) {
    const agent = person(PersonKind.AGENT, 0x4000, { mods: eyes << 11 });
    const near = person(PersonKind.CIVILIAN, 0x4000 + reach), far = person(PersonKind.CIVILIAN, 0x4000 + reach + 1);
    world([agent, near, far]).persuasion.pulse(world([agent, near, far]), agent);
    assert.equal(near.events & Ev.PERSUADE, Ev.PERSUADE, `ojos ${eyes}: alcanza ${reach.toString(16)}`);
    assert.equal(far.events & Ev.PERSUADE, 0, `ojos ${eyes}: no pasa de ${reach.toString(16)}`);
  }
});

test('PERSUADERTRON §6.4 (GAME02): un civil junto al agente pasa a seguirle', { skip }, () => {
  const level = asset('levels/game02.json');
  const w = new World(level, asset(`maps/map${String(level.map).padStart(2, '0')}.json`), {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), research: new Map(),
    armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
    animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')), roster: Array.from({ length: 4 }, () => ({ health: 16, mods: 0 })),
  });
  const a = w.squad[0];
  w.giveItem(a, 1, 50, true);
  const civ = w.people.find((p) => p.is(PersonKind.CIVILIAN) && !p.hidden && p.state === S.WANDER);
  civ.x = a.x + 0x60; civ.y = a.y; civ.z = a.z; w.grid.move(civ);
  for (let i = 0; i < 20; i++) w.update();
  assert.equal(civ.following, a);
  assert.equal(civ.state, S.FOLLOW);
});

test('Caza §7.3 (`0x17300`, GAME02): orden 4 una sola vez con adrenalina al máximo; el desvío no se interrumpe', { skip }, () => {
  const level = asset('levels/game02.json');
  const w = new World(level, asset(`maps/map${String(level.map).padStart(2, '0')}.json`), {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), research: new Map([[5, 0x960]]),
    armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
    animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')), roster: Array.from({ length: 4 }, () => ({ health: 16, mods: 0 })),
  });
  w.cheats.invulnerable = true;
  const hunters = () => w.enemyAI.members.filter((m) => m.state === 9 && m.approaching && !m.person.dead);
  for (let i = 0; i < 30 && !hunters().length; i++) w.update();
  const m = hunters()[0];
  assert.ok(m, 'hay agentes cazando');
  assert.equal(m.person.adrenaline.level, 0xff);
  assert.ok([S.GOTO_THING, S.WALL_LEFT, S.WALL_RIGHT, S.FIRING, S.AIM].includes(m.person.state) || m.person.state === S.IDLE);
  // Un agente en pleno desvío no recibe la orden de nuevo en el siguiente tick del guion.
  let interrupted = 0, detours = 0;
  const order = Person.prototype.order;
  Person.prototype.order = function (...args) {
    if (this.state === S.WALL_LEFT || this.state === S.WALL_RIGHT) interrupted++;
    return order.apply(this, args);
  };
  try {
    for (let i = 0; i < 600; i++) {
      w.update();
      detours += hunters().filter((h) => h.person.state === S.WALL_LEFT || h.person.state === S.WALL_RIGHT).length;
    }
  } finally { Person.prototype.order = order; }
  assert.ok(detours > 0, 'hay cazadores desviándose');
  assert.equal(interrupted, 0, 'el guion no da órdenes a quien está siguiendo una pared');
});
