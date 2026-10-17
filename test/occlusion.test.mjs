// Oclusión del mapa sobre las entidades (SPEC §5.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockInFront, entityBox, paintKey } from '../src/render/occlusion.js';
import { Person, PersonKind } from '../src/entities/person.js';
import { Vehicle, StaticObject } from '../src/entities/entity.js';

const at = (tx, ty, z, fx = 0x80, fy = 0x80) => new Person({ x: tx * 256 + fx, y: ty * 256 + fy, z, kind: PersonKind.CIVILIAN });

test('Oclusión §5.5: tapan los bloques de delante (más x, más y o encima); no el suelo ni los de detrás', () => {
  const p = at(10, 10, 0x100), box = entityBox(p);
  assert.ok(blockInFront(11, 10, 2, box), 'bloque al +x a la altura del cuerpo');
  assert.ok(blockInFront(10, 11, 3, box), 'bloque al +y');
  assert.ok(blockInFront(10, 10, 5, box), 'techo encima de la cabeza');
  assert.ok(!blockInFront(10, 10, 1, box), 'el suelo que pisa');
  assert.ok(!blockInFront(11, 10, 1, box), 'el suelo de la casilla de delante, por debajo de los pies');
  assert.ok(!blockInFront(9, 10, 2, box), 'un bloque de detrás');
});

test('Oclusión §5.5: sobre una rampa no la tapa su propio bloque, pero sí el de delante a su altura', () => {
  const p = at(67, 50, 0x140, 0x80, 0x14), box = entityBox(p);     // a media rampa del nivel 2
  assert.ok(!blockInFront(67, 50, 2, box), 'la rampa que pisa');
  assert.ok(!blockInFront(67, 49, 2, box), 'el tramo de rampa de detrás');
  assert.ok(blockInFront(68, 50, 2, box), 'el bloque al +x en el mismo nivel');
});

test('Oclusión §5.5: un coche ocupa ±0x80; la casilla vecina que solapa su caja no lo corta', () => {
  const car = new Vehicle({ x: 55 * 256 + 0xc0, y: 40 * 256 + 0x80, z: 0x100, subtype: 13 }), box = entityBox(car);
  assert.ok(!blockInFront(56, 40, 1, box), 'la calzada vecina bajo el coche');
  assert.ok(!blockInFront(56, 40, 2, box), 'la casilla vecina que el coche invade');
  assert.ok(blockInFront(57, 40, 2, box), 'lo que está más allá de su caja sí lo tapa');
});

test('Orden de pintado §5.5 (`0x1d450`): x+y; algunos estáticos se adelantan 0x100', () => {
  assert.equal(paintKey(at(1, 2, 0, 0, 0)), 3 * 256);
  const decal = new StaticObject({ x: 0x400, y: 0x400, z: 0, class: 5, subtype: 0x12 });
  const lamp = new StaticObject({ x: 0x400, y: 0x400, z: 0, class: 5, subtype: 1 });
  assert.equal(paintKey(decal), 0x800 - 0x100);
  assert.equal(paintKey(lamp), 0x800);
});
