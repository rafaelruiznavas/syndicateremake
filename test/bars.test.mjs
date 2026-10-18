// Barras de adrenalina, percepción e inteligencia (SPEC §9.2, §12.3; `0x2f990`, `0x2ee30`, `0x2d610`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bar } from '../src/entities/person.js';
import { Hud } from '../src/render/hud.js';

/** Simula `cycles` ciclos de recuperación con el contador de 8 bits del agente. */
function run(bar, cycles, implant = 0, from = 0) {
  for (let c = from + 1; c <= from + cycles; c++) bar.recover(c & 0xff, implant);
  return bar;
}

test('Barras §9.2 (`0x2f990`): el valor real sube 1 cada 4 ciclos hacia lo pedido y el neutro le sigue cada 0x14', () => {
  const b = new Bar(128, 255, 128);
  run(b, 40);
  assert.equal(b.actual, 138, '40/4 pasos');
  assert.equal(b.neutral, 130, '40/0x14 pasos de dependencia');
  assert.equal(b.level, 255, 'lo pedido se mantiene mientras el real no llega');
});

test('Barras §9.2: alcanzado el nivel, nivel y real vuelven hacia el neutro; todo acaba en 0x80', () => {
  const b = new Bar(128, 200, 200);
  run(b, 40);
  assert.ok(b.level < 200 && b.level === b.actual, 'el efecto se pasa');
  assert.ok(b.neutral > 128, 'queda dependencia');
  run(b, 20000, 0, 40);
  assert.deepEqual([b.neutral, b.level, b.actual], [0x80, 0x80, 0x80], 'al final todo vuelve al punto medio');
});

test('Barras §9.2: un implante mejor hace el efecto más lento (real cada 0x28 ciclos con nivel 3)', () => {
  const b = new Bar(128, 255, 128);
  run(b, 0x50, 3);
  assert.equal(b.actual, 130);
  assert.equal(b.neutral, 128, 'neutro cada 0x80 ciclos: aún no');
});

test('Barras §9.2: con valor forzado, nivel = forzado + 0x80 y neutro = forzado', () => {
  const b = new Bar(128, 128, 128, 80);
  b.recover(1, 0);
  assert.deepEqual([b.level, b.neutral], [208, 80]);
});

test('Panel §12.3 (`0x2d610`): filas de 14 px desde y+0x2E; valor = (x − 4)·0x100/0x37 hasta 255', () => {
  const hud = Object.create(Hud.prototype);
  assert.deepEqual(hud.hit(4, 0x2e), { type: 'bar', index: 0, bar: 'adrenaline', level: 0 });
  assert.equal(hud.hit(4 + 0x37, 0x2e + 0x0e).bar, 'perception');
  assert.equal(hud.hit(4 + 0x37, 0x2e + 0x0e).level, 255);
  assert.equal(hud.hit(4 + 20, 0x2e + 2 * 0x0e).level, Math.trunc((20 * 0x100) / 0x37));
  assert.equal(hud.hit(64 + 10, 100 + 0x2e + 0x1c).index, 3);
});

test('Panel §12.3 (`0x2ee30`): claro del neutro a lo pedido, oscuro del neutro al real, marca del neutro', () => {
  const rects = [];
  const hud = Object.assign(Object.create(Hud.prototype), {
    rect: (x, y, w, h, c) => rects.push([x, y, w, h, c]), anim() {}, renderer: { drawFrame() {} },
  });
  const agent = { dead: false, health: 16, frame: 0, adrenaline: new Bar(128, 255, 160), perception: new Bar(), intelligence: new Bar() };
  hud.renderAgent({ selection: new Set(), recolorFor: () => null }, agent, 0);
  const row = rects.filter((r) => r[1] === 0x30);
  const px = (u) => Math.trunc((u * 55) / 255);
  assert.deepEqual(row[1], [4 + px(128), 0x30, px(255) - px(128), 10, 14], 'claro hasta lo pedido');
  assert.deepEqual(row[2], [4 + px(128), 0x30, px(160) - px(128), 10, 6], 'oscuro hasta el real, encima');
  assert.deepEqual(row[3], [4 + px(128), 0x30, 1, 10, 12], 'marca del neutro');
});
