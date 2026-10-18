// Gráficos mejorados [DIS] (SPEC §15.1): Scale2x sobre índices, interpolación del dibujo y
// precisión de medio píxel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale2x, scale2xToRgba } from '../src/render/upscale.js';
import { drawPosition } from '../src/render/occlusion.js';
import { Camera } from '../src/render/iso.js';
import { Game, ENHANCED_CANVAS } from '../src/scenes/manager.js';

/** Imagen indexada w×h a partir de filas de caracteres: '.' transparente, dígito = índice. */
function indexed(rows) {
  const h = rows.length, w = rows[0].length, data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { const o = (y * w + x) * 4; data[o] = +ch; data[o + 3] = 255; } }));
  return { width: w, height: h, data };
}
const pick = (img) => Array.from({ length: img.height }, (_, y) => Array.from({ length: img.width }, (_, x) => {
  const o = (y * img.width + x) * 4; return img.data[o + 3] ? String(img.data[o]) : '.';
}).join(''));

test('Scale2x: una diagonal se suaviza sin colores nuevos; las zonas lisas quedan igual', () => {
  // Escalón: sin suavizar sería 1111.. / 1111.. / 11.... / 11....; Scale2x corta la diagonal.
  const out = scale2x(indexed(['11.', '1..', '...']));
  assert.deepEqual(pick(out), ['1111..', '111...', '111...', '1.....', '......', '......']);
  assert.deepEqual(pick(scale2x(indexed(['22', '22']))), ['2222', '2222', '2222', '2222']);
  const colours = new Set(out.data.filter((_, i) => i % 4 === 0));
  assert.deepEqual([...colours].sort(), [0, 1], 'solo los índices de la imagen original (0 = transparente)');
});

test('Scale2x de la VGA: framebuffer de índices a RGBA con la paleta de 6 bits', () => {
  const pal = new Uint8Array(768); pal.set([63, 0, 0], 3);   // índice 1 = rojo
  const out = new Uint8ClampedArray(4 * 4 * 4);
  scale2xToRgba(Uint8Array.from([1, 0, 0, 1]), 2, 2, pal, out);
  assert.deepEqual([...out.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...out.slice(4 * 2, 4 * 2 + 4)], [0, 0, 0, 255], 'esquina superior derecha: fondo');
});

test('Interpolación: entre el ciclo anterior y el actual; sin ella en saltos grandes', () => {
  const e = { x: 1000, y: 2000, z: 256, prevX: 900, prevY: 2000, prevZ: 256 };
  assert.deepEqual(drawPosition(e, 0.5), { x: 950, y: 2000, z: 256 });
  assert.equal(drawPosition(e, 0), e, 'alpha 0 (modo original): la posición del ciclo');
  assert.equal(drawPosition({ ...e, prevX: 0 }, 0.5).x, 1000, 'un salto de más de 0x200 no se interpola');
});

test('Lienzo 16:9 [DIS]: 1280×720 con 400 filas lógicas; la misión ensancha la vista y los menús se centran', () => {
  const game = Object.assign(Object.create(Game.prototype), { graphics: 'enhanced', scene: { wide: true } });
  assert.equal(game.pixelScale, 1.8);
  assert.equal(game.screenWidth * game.pixelScale, ENHANCED_CANVAS.width);
  assert.equal(game.sceneOffset, 0, 'la misión ocupa todo el ancho');
  game.scene = {};
  assert.equal(game.sceneOffset * 2 + 640, game.screenWidth, 'una pantalla de 640 queda centrada');
  game.graphics = 'original';
  assert.deepEqual([game.pixelScale, game.screenWidth, game.sceneOffset], [1, 640, 0], 'el modo original no cambia');
});

test('Proyección fina: medio píxel lógico (un píxel real del lienzo ×2)', () => {
  const cam = new Camera();
  const [x0] = cam.projectFine(0, 0, 0), [x1] = cam.projectFine(4, 0, 0), [x2] = cam.projectFine(8, 0, 0);
  assert.equal(x1 - x0, 0.5);
  assert.equal(x2 - x0, 1);
  assert.deepEqual(cam.projectFine(64, 32, 16), cam.project(64, 32, 16), 'coincide con la normal en múltiplos de 8');
});
