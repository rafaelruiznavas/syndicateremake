// Progresión frente a SPEC.md: partida nueva (§9.1), reloj y territorios (§9.4),
// investigación (§9.3), tienda y mejoras (§9.2, §9.2b) y vuelta de la misión (§8.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Rng16 } from '../src/core/rng.js';
import { Clock, SCREEN_DAY } from '../src/campaign/clock.js';
import { Campaign, Outcome, START_FUNDS } from '../src/campaign/campaign.js';
import { PLAYER, REBELLION } from '../src/campaign/territories.js';
import { AVAILABLE, OPEN, LOCKED, Status } from '../src/campaign/research.js';
import { modLevel } from '../src/campaign/roster.js';
import { Animator } from '../src/systems/animation.js';
import { MissionStatus } from '../src/systems/objectives.js';
import { PersonKind, Ev } from '../src/entities/person.js';
import { World } from '../src/world/world.js';

const ASSETS = new URL('../assets/', import.meta.url);
const haveAssets = fs.existsSync(new URL('data/mods.json', ASSETS)) || 'recursos no extraídos (node tools/extract-assets.mjs)';
const skip = haveAssets !== true && haveAssets;
const asset = (p) => JSON.parse(fs.readFileSync(new URL(p, ASSETS), 'utf8'));
const data = () => ({
  weapons: asset('data/weapons.json'), mods: asset('data/mods.json'), territories: asset('data/territories.json'),
  briefings: asset('data/briefings.json'), agentNames: asset('data/agent-names.json'),
});
const WESTERN_EUROPE = 9;

test('Reloj §9.4: 24 horas de 168 unidades y un día cada 4031 avances', () => {
  const k = new Clock();
  let hours = 0, days = 0;
  for (let i = 0; i < SCREEN_DAY; i++) { const r = k.tick(SCREEN_DAY); if (r.hourChanged) hours++; if (r.dayPassed) days++; }
  assert.equal(days, 1);
  assert.equal(hours, 23);
  assert.equal(k.day, 2);
  k.day = 365; k.counter = SCREEN_DAY - 1; k.tick(SCREEN_DAY);
  assert.deepEqual([k.day, k.year], [1, 86]);
});

test('Partida nueva §9.1: fondos, plantilla de 8 agentes y territorios rivales', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 1234 });
  assert.equal(c.funds, START_FUNDS);
  assert.deepEqual([c.clock.day, c.clock.year], [1, 85]);
  const alive = c.roster.agents.filter((a) => a.alive);
  assert.equal(alive.length, 8);
  assert.equal(c.roster.team().length, 4);
  for (const a of alive) {
    assert.equal(a.health, 16);
    assert.ok((a.mods & ~1) === 0, 'solo el bit 0 al azar');
    assert.deepEqual(a.items, [{ weapon: 2, ammo: 12 }]);
  }
  assert.equal(new Set(alive.map((a) => a.name)).size, 8, 'nombres sin repetir');
  for (const t of c.territories.list) {
    assert.ok(t.owner >= 1 && t.owner <= 7);
    assert.ok(t.population >= 40e6 && t.population < 60e6);
    assert.deepEqual([t.tax, t.nextTax, t.discontent], [30, 30, 0]);
  }
  assert.equal(c.research.status, Status.IDLE);
  assert.equal(c.research.weapon(5).state, OPEN, 'UZI investigable');
  assert.equal(c.research.weapon(6).state, LOCKED, 'MINI-GUN bloqueada');
  assert.equal(c.research.weapon(2).state, AVAILABLE, 'PISTOL disponible');
});

test('Territorios §9.4: solo WESTERN EUROPE al empezar; tras conquistarla, sus vecinos', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 7 });
  const eligible = () => c.territories.list.map((t, i) => i).filter((i) => c.eligible(i));
  assert.deepEqual(eligible(), [WESTERN_EUROPE]);
  c.territories.conquer(WESTERN_EUROPE);
  const we = c.territories.get(WESTERN_EUROPE);
  assert.equal(we.owner, PLAYER);
  assert.deepEqual(eligible().sort((a, b) => a - b), [...we.info.neighbors].sort((a, b) => a - b));
  we.discontent = REBELLION;
  assert.ok(c.eligible(WESTERN_EUROPE), 'en rebelión se puede volver a elegir');
  assert.equal(c.territories.changeTax(WESTERN_EUROPE, 5), false, 'sin impuestos en rebelión');
  c.territories.conquer(WESTERN_EUROPE);
  assert.equal(we.discontent, 170);
});

test('Impuestos y descontento §9.4: acotado a 0..100; (impuesto−30)/2 y tendencia a 30', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 3 });
  const t = c.territories.get(WESTERN_EUROPE);
  t.owner = PLAYER;
  c.territories.changeTax(WESTERN_EUROPE, 500);
  assert.equal(t.nextTax, 100);
  c.territories.changeTax(WESTERN_EUROPE, -500);
  assert.equal(t.nextTax, 0);
  // Sin vecinos ajenos que cuenten: impuesto 40 → +5, y como queda < 30, +2.
  for (const n of t.info.neighbors) { const o = c.territories.get(n + 1); if (o) o.owner = PLAYER; }
  t.tax = 40; t.discontent = 0;
  c.territories.updateDiscontent(t);
  assert.equal(t.discontent, 7);
  t.tax = 30; t.discontent = 40;
  c.territories.updateDiscontent(t);
  assert.equal(t.discontent, 38);
});

test('Ingreso §9.4: población/1e6·14·impuesto/10, cortado si el territorio actual está descontento', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 3 });
  const t = c.territories.get(WESTERN_EUROPE);
  t.owner = PLAYER; t.population = 45_678_901; t.tax = 30; t.nextTax = 50;
  c.territories.current = WESTERN_EUROPE;
  assert.equal(c.territories.income(t), Math.trunc((45 * 14 * 30) / 10));
  assert.equal(t.tax, 50, 'el impuesto siguiente entra en vigor');
  t.discontent = 160;
  assert.equal(c.territories.income(t), 0);
});

test('Rivales §9.4: se expanden por vecinos pero nunca quitan territorios al jugador', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 99 });
  c.territories.conquer(WESTERN_EUROPE);
  const rng = new Rng16(5);
  for (let d = 0; d < 300; d++) c.territories.daily(rng);
  assert.equal(c.territories.get(WESTERN_EUROPE).owner, PLAYER);
});

test('Investigación §9.3: UZI a financiación mínima tarda 240 h, cuesta 4/h y desbloquea la MINI-GUN', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 1 });
  const uzi = c.research.weapon(5);
  assert.ok(c.research.select(uzi));
  assert.equal(c.research.funding, 0);
  const before = c.funds;
  let hours = 0;
  while (c.research.project && hours < 1000) { c.research.hour(c); hours++; }
  assert.equal(hours, 240);
  assert.equal(before - c.funds, 4 * 240);
  assert.equal(uzi.state, AVAILABLE);
  assert.equal(c.research.weapon(6).state, OPEN, 'la sucesora pasa a investigable');
  assert.equal(c.research.status, Status.IDLE);
  assert.equal(c.research.funding, -1);
});

test('Investigación §9.3: financiación máxima ×100 → +100 por hora; sin fondos se para', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 1 });
  const laser = c.research.weapon(7);
  c.funds = 1_000_000;
  c.research.select(laser);
  c.research.changeFunding(+20);
  assert.equal(c.research.funding, 9);
  assert.equal(c.research.hourlyCost(), laser.info.researchCost * 100);
  c.research.hour(c);
  assert.equal(laser.progress, 100);
  c.funds = 10;
  c.research.hour(c);
  assert.equal(c.research.status, Status.NO_FUNDS);
  assert.equal(laser.progress, 100);
});

test('Tienda §9.2/§9.2b: mejoras por partes, compra con munición de catálogo y venta al 25 %', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 1 });
  const a = c.roster.team()[0];
  const chest1 = c.data.mods.findIndex((m) => m.part === 'chest' && m.version === 1);
  assert.ok(c.shop.buyMod(a, chest1));
  assert.equal(modLevel(a.mods, 'chest'), 1);
  assert.equal(c.funds, START_FUNDS - 8000);
  assert.equal(c.shop.buyMod(a, chest1), false, 'la misma versión no se cobra dos veces');
  assert.ok(c.shop.buyWeapon(a, 4));
  assert.deepEqual(a.items.at(-1), { weapon: 4, ammo: 11 });
  const funds = c.funds;
  a.items.at(-1).ammo = 5;
  assert.ok(c.shop.sell(a, a.items.length - 1));
  assert.equal(c.funds - funds, Math.trunc((250 * 25) / 100));
  a.items[0].ammo = 3;
  const f2 = c.funds;
  assert.ok(c.shop.reloadAll(a));
  assert.deepEqual([a.items[0].ammo, c.funds], [12, f2], 'la PISTOL recarga gratis (RECARGA[2] = 0)');
});

function playMission(c, mutate) {
  const setup = c.startMission();
  const level = asset(`levels/game${String(setup.mission).padStart(2, '0')}.json`);
  const map = asset(`maps/map${String(level.map).padStart(2, '0')}.json`);
  const weapons = c.data.weapons;
  const w = new World(level, map, {
    tileClasses: asset('data/tile-classes.json'), weapons, animator: new Animator(asset('gfx/sprites.json'), asset('data/person-animations.json')),
    roster: setup.roster, research: new Map(weapons.map((x) => [x.type, x.researchInitial])),
    enemyWeapons: asset('data/enemy-weapons.json'), armedTable: asset('data/weapon-armed.json'),
  });
  mutate(w);
  for (let i = 0; i < 200 && w.objectives.running; i++) { w.update(); c.missionTick(); }
  return c.finishMission(w);
}

test('Vuelta de misión §8.2: GAME01 completada conquista WESTERN EUROPE, paga persuadidos y pierde muertos', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 11 });
  c.chooseTerritory(WESTERN_EUROPE);
  const team = c.roster.team();
  const funds = c.funds;
  const report = playMission(c, (w) => {
    const target = w.objectives.list[0].entity;
    const civ = w.people.find((p) => p.is(PersonKind.CIVILIAN) && !p.isPlayerSquad && p !== target);
    civ.following = w.squad[0];
    w.squad[3].health = -1; w.squad[3].events |= Ev.BULLET;
    target.health = -1; target.events |= Ev.BULLET; target.eventSource = w.squad[0];
  });
  assert.equal(report.status, MissionStatus.COMPLETED);
  assert.equal(report.outcome, Outcome.MISSION_WON);
  assert.equal(c.territories.get(WESTERN_EUROPE).owner, PLAYER);
  assert.equal(report.persuaded, 1);
  assert.equal(c.funds - funds, 50, 'civil persuadido: +50');
  assert.ok(team[3].empty, 'el agente muerto se pierde');
  assert.ok(team.slice(0, 3).every((a) => a.health === 16));
  assert.ok(c.clock.counter % 4 === 0, 'el contador vuelve ×4');
});

test('Vuelta de misión §8.2: abandonar conserva el inventario anterior y no conquista', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 12 });
  c.chooseTerritory(WESTERN_EUROPE);
  const a = c.roster.team()[0];
  const report = playMission(c, (w) => { w.squad[0].items[0].ammo = 1; w.objectives.withdraw(); });
  assert.equal(report.outcome, Outcome.CONTINUE);
  assert.equal(a.items[0].ammo, 12);
  assert.notEqual(c.territories.get(WESTERN_EUROPE).owner, PLAYER);
});

test('Vuelta de misión §8.2: perder a toda la plantilla termina la partida', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 13 });
  for (const a of c.roster.agents) if (!a.team) a.clear();
  c.chooseTerritory(WESTERN_EUROPE);
  const report = playMission(c, (w) => { for (const p of w.squad) { p.health = -1; p.events |= Ev.BULLET; } });
  assert.equal(report.status, MissionStatus.FAILED);
  assert.equal(report.outcome, Outcome.GAME_OVER);
});

test('Arma nueva §8.2: una UZI traída de la misión se entrega a investigación con +600', { skip }, () => {
  const c = Campaign.newGame(data(), { seed: 14 });
  c.chooseTerritory(WESTERN_EUROPE);
  const report = playMission(c, (w) => { w.giveItem(w.squad[0], 5, 20, false); w.objectives.withdraw(); });
  assert.equal(report.newWeaponry, false, 'abandonando no se trae nada');
  c.chooseTerritory(WESTERN_EUROPE);
  const r2 = playMission(c, (w) => {
    w.giveItem(w.squad[0], 5, 20, false);
    const t = w.objectives.list[0].entity; t.health = -1; t.events |= Ev.BULLET; t.eventSource = w.squad[0];
  });
  assert.equal(r2.newWeaponry, true);
  assert.equal(c.research.weapon(5).progress, 600);
  assert.ok(!c.roster.team()[0].items.some((it) => it.weapon === 5), 'el arma se queda en investigación');
});

test('Guardado: toJSON → Campaign reconstruye el mismo estado', { skip }, () => {
  const d = data();
  const c = Campaign.newGame(d, { seed: 21 });
  c.research.select(c.research.weapon(5)); c.research.hour(c);
  for (let i = 0; i < 5000; i++) c.screenTick();
  const copy = new Campaign(d, JSON.parse(JSON.stringify(c.toJSON())));
  assert.deepEqual(copy.toJSON(), c.toJSON());
});
