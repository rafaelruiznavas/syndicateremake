// Trucos del remake [DIS] (SPEC §15.1): menú solo con ?cheat y agentes invulnerables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheatsEnabled } from '../src/ui/cheats.js';
import { Damage } from '../src/systems/damage.js';
import { areaEvent } from '../src/systems/vehicles.js';
import { Person, PersonKind, Ev, S } from '../src/entities/person.js';

test('Trucos: el menú solo se ofrece con el parámetro cheat', () => {
  assert.equal(cheatsEnabled(''), false);
  assert.equal(cheatsEnabled('?mission=2'), false);
  assert.equal(cheatsEnabled('?cheat'), true);
  assert.equal(cheatsEnabled('?mission=2&cheat=1'), true);
});

function world(entities, invulnerable) {
  const cheats = { invulnerable };
  return {
    cheats,
    invulnerable: (p) => cheats.invulnerable && p.isPlayerSquad === true,
    grid: { *query() { yield* entities; } },
    rng: { int: () => 0 },
  };
}

test('Invulnerables: balas, explosiones y daño de reacción no afectan a la escuadra; sí a los demás', () => {
  const agent = new Person({ x: 0x1000, y: 0x1000, z: 0x100, kind: PersonKind.AGENT });
  agent.playerControlled = true;
  const enemy = new Person({ x: 0x1000, y: 0x1000, z: 0x100, kind: PersonKind.AGENT });
  const w = world([agent, enemy], true);
  const dmg = new Damage();
  dmg.bulletHit(w, null, 0x1000, 0x1000, 0x180);
  assert.deepEqual([agent.health, agent.events], [16, 0]);
  assert.deepEqual([enemy.health, enemy.events], [15, Ev.BULLET]);
  areaEvent(w, 0x1000, 0x1000, 0x100, [0x100, 0x100, 0x100], Ev.EXPLOSION);
  assert.equal(agent.events, 0);
  assert.equal(dmg.applyReaction(agent, S.HIT_EXPLOSION, w), false);
  assert.equal(agent.health, 16);
  w.cheats.invulnerable = false;
  dmg.bulletHit(w, null, 0x1000, 0x1000, 0x180);
  assert.equal(agent.health, 15, 'sin el truco recibe daño');
});
