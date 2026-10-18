// Localizar agentes y usar el escáner desde el panel (SPEC §11, `0x2d610`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MissionScene } from '../src/scenes/mission.js';
import { Hud } from '../src/render/hud.js';
import { Scanner, SCANNER } from '../src/render/scanner.js';
import { Camera } from '../src/render/iso.js';
import { World } from '../src/world/world.js';
import { Animator } from '../src/systems/animation.js';
import { S } from '../src/entities/person.js';
import { PANEL_WIDTH, SCREEN_HEIGHT } from '../src/core/constants.js';

const ASSETS = new URL('../assets/', import.meta.url);
const skip = fs.existsSync(new URL('levels/game02.json', ASSETS)) ? false : 'recursos no extraídos (node tools/extract-assets.mjs)';
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));

function scene() {
  const level = asset('levels/game02.json');
  const world = new World(level, asset(`maps/map${String(level.map).padStart(2, '0')}.json`), {
    tileClasses: asset('data/tile-classes.json'), weapons: asset('data/weapons.json'), research: new Map(),
    armedTable: asset('data/weapon-armed.json'), enemyWeapons: asset('data/enemy-weapons.json'),
    animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')), roster: Array.from({ length: 4 }, () => ({ health: 16, mods: 0 })),
  });
  const s = new MissionScene({ assets: {}, ctx: {}, input: {}, loop: {}, screenWidth: 640 }, { mission: 2, roster: [] });
  let clock = 0;
  Object.assign(s, { world, camera: new Camera(), hud: Object.create(Hud.prototype), now: () => clock });
  s.tick = (ms) => { clock += ms; };
  // Agentes separados para ver a cuál se centra la vista.
  world.squad.forEach((a, i) => { a.x = 0x2000 + i * 0x1000; a.y = 0x3000; w(world, a); });
  return s;
}
const w = (world, a) => world.grid.move(a);
const centered = (s, e) => {
  const [sx, sy] = s.camera.project(e.x, e.y, e.z);
  return Math.abs(sx - (PANEL_WIDTH + 640) / 2) <= 1 && Math.abs(sy - SCREEN_HEIGHT / 2) <= 1;
};

test('Panel §11 (`0x2d610`): clic derecho en la caja de un agente lo selecciona y centra la vista en él', { skip }, () => {
  const s = scene(), a = s.world.squad[2];
  s.onClick({ x: 10, y: 110, button: 'right' });          // caja 3 (0,100)
  assert.equal(s.world.leader, a);
  assert.ok(centered(s, a));
});

test('Panel §11 [DIS]: doble clic izquierdo en la caja localiza al agente; un clic solo no mueve la vista', { skip }, () => {
  const s = scene(), a = s.world.squad[1];
  const cam = { x: s.camera.x, y: s.camera.y };
  s.onClick({ x: 70, y: 10, button: 'left' });             // caja 2 (64,0)
  assert.equal(s.world.leader, a);
  assert.deepEqual({ x: s.camera.x, y: s.camera.y }, cam, 'un clic solo selecciona');
  s.tick(200);
  s.onClick({ x: 70, y: 10, button: 'left' });
  assert.ok(centered(s, a), 'el segundo clic a tiempo centra');
  // Dos clics demasiado separados no cuentan.
  const b = s.world.squad[0];
  s.onClick({ x: 10, y: 10, button: 'left' }); s.tick(600); s.onClick({ x: 10, y: 10, button: 'left' });
  assert.ok(!centered(s, b));
});

test('Escáner §11 (`0x2d610`): clic izquierdo manda ir al punto; derecho centra la vista allí', { skip }, () => {
  const s = scene(), lead = s.world.squad[0];
  s.world.select(0);
  const zoom = Scanner.zoom(s.world), k = 0x100 / zoom;
  s.onClick({ x: 64 + 10, y: SCANNER.y + 64 - 4, button: 'left' });
  assert.equal(lead.state, S.WALK);
  assert.deepEqual([lead.destination.x - 0x40, lead.destination.y - 0x40].map((v) => v & ~0xff), [(0x2000 + 10 * k) & ~0xff, (0x3000 - 4 * k) & ~0xff].map((v) => v & ~0xff));
  s.onClick({ x: 64, y: SCANNER.y + 64 + 8, button: 'right' });
  assert.ok(centered(s, { x: lead.x, y: lead.y + 8 * k, z: lead.z }));
});
