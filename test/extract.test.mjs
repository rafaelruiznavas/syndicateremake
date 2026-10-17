// Datos extraídos frente a los valores documentados en SPEC.md.
// Necesitan la instalación del juego (SYNDICATE o la ruta por defecto de GOG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unpack, isRnc } from '../tools/lib/rnc.mjs';
import { LeImage } from '../tools/lib/le.mjs';
import { decodeLevel, resolveRef } from '../tools/lib/level.mjs';
import { decodeFlic } from '../tools/lib/flic.mjs';
import { decodeVoc } from '../tools/lib/audio.mjs';

const SRC = process.env.SYNDICATE ?? 'C:/GOG Games/Syndicate Plus/SYNDICAT';
const skip = !fs.existsSync(path.join(SRC, 'MAIN.EXE')) && 'instalación de Syndicate no encontrada (define SYNDICATE)';
const read = (n) => new Uint8Array(fs.readFileSync(path.join(SRC, 'DATA', n)));

test('RNC: COL01 se descomprime a 256 clases (SPEC §3)', { skip }, () => {
  const raw = read('COL01.DAT');
  assert.ok(isRnc(raw));
  const col = unpack(raw);
  assert.equal(col.length, 256);
  assert.deepEqual([...col.subarray(0, 6)], [0, 0x10, 5, 0, 0, 5]);
});

test('RNC: todos los ficheros comprimidos tienen el tamaño declarado', { skip }, () => {
  let n = 0;
  for (const f of fs.readdirSync(path.join(SRC, 'DATA'))) {
    const b = read(f); if (!isRnc(b)) continue;
    assert.equal(unpack(b).length, ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) >>> 0, f); n++;
  }
  assert.ok(n > 100);
});

test('Tablas de armas de MAIN.EXE (SPEC §6.1)', { skip }, () => {
  const exe = new LeImage(new Uint8Array(fs.readFileSync(path.join(SRC, 'MAIN.EXE'))));
  const R = (t) => exe.u16(0x5a6c2 + 2 * t), M = (t) => exe.u16(0x5a73a + 2 * t), price = (t) => exe.s32(0x57bf4 + (t - 1) * 0x1f5 + 1);
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 9].map(R), [1280, 5120, 1024, 1792, 2816, 4096, 512, 6144]);
  assert.deepEqual([2, 4, 5, 6, 8].map(M), [12, 11, 49, 499, 999]);
  assert.equal(price(1), 5000); assert.equal(price(2), 0); assert.equal(price(3), -50000); assert.equal(price(5), -750);
  assert.equal(exe.cstr(exe.u32(0x54b10 + 12 * (3 - 1))), 'GAUSS GUN');
  // DIR_X/DIR_Y (SPEC §4)
  assert.deepEqual([0, 32, 64, 128].map((d) => exe.s16(0x5ab60 + d * 2)), [0, 181, 256, 0]);
  assert.deepEqual([0, 64, 128].map((d) => exe.s16(0x5ad60 + d * 2)), [256, 0, -256]);
});

test('Territorios y mejoras (SPEC §9)', { skip }, () => {
  const exe = new LeImage(new Uint8Array(fs.readFileSync(path.join(SRC, 'MAIN.EXE'))));
  const name = (c) => exe.cstr(exe.u32(0x541a4 + exe.u8(0x5b060 + c * 0x13 + 0x12) * 12));
  const we = [...Array(50).keys()].find((c) => name(c) === 'WESTERN EUROPE');
  assert.equal(exe.u8(0x5b060 + we * 0x13 + 0x11), 1, 'Western Europe es la misión 1');
  assert.deepEqual([0, 1, 2, 6, 7, 8].map((i) => exe.u32(0x55780 + i * 0x1eb + 1)), [6000, 30000, 60000, 8000, 40000, 80000]);
});

test('GAME01: objetivo asesinar a la persona 8, 14 personas (SPEC §8.1)', { skip }, () => {
  const lvl = decodeLevel(unpack(read('GAME01.DAT')));
  assert.equal(lvl.map, 1);
  assert.equal(lvl.people.length, 14);
  assert.equal(lvl.objectives.length, 1);
  assert.equal(lvl.objectives[0].type, 2);
  assert.deepEqual(lvl.objectives[0].target, { pool: 'people', index: 8 });
  assert.deepEqual(resolveRef(2), { pool: 'people', index: 0 });
});

test('FLIC del título: 320×200, 15 frames, con paleta', { skip }, () => {
  const it = decodeFlic(unpack(read('MTITLE.DAT')));
  const first = it.next().value;
  assert.equal(first.w, 320); assert.equal(first.h, 200); assert.equal(first.frames, 15);
  assert.ok(first.palChanged);
});

test('Sonido: el primer efecto es un VOC válido', { skip }, () => {
  const tab = read('SOUND-0.TAB'), dat = read('SOUND-0.DAT'), dv = new DataView(tab.buffer);
  const off = dv.getUint32(32 + 18, true), size = dv.getUint32(32 + 26, true);
  const voc = decodeVoc(dat.subarray(off, off + size));
  assert.ok(voc.rate > 4000 && voc.rate < 45000);
  assert.ok(voc.samples.length > 1000);
});
