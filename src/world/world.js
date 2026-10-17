// Estado de una misión y su ciclo de simulación, en el orden del original (SPEC §1, §7.1):
// órdenes → guiones enemigos → percepción → personas → emisión de armas → efectos →
// lista de visibles → objetivos.

import { TileMap } from './map.js';
import { Terrain } from './terrain.js';
import { SpatialGrid } from './spatial.js';
import { Person, PersonKind, S, Bar } from '../entities/person.js';
import { StaticObject, Item, Vehicle, Entity } from '../entities/entity.js';
import { legsSpeed } from '../systems/movement.js';
import { Rng16 } from '../core/rng.js';
import { EventBus } from '../core/events.js';
import { LEVEL } from '../core/constants.js';
import { Weapons, W } from '../systems/weapons.js';
import { Damage } from '../systems/damage.js';
import { Persuasion } from '../systems/persuasion.js';
import { Perception } from '../systems/perception.js';
import { PersonStates } from '../systems/states.js';
import { EnemyAI } from '../systems/enemy-ai.js';
import { Objectives } from '../systems/objectives.js';
import { Driving, VehicleUpdate } from '../systems/vehicles.js';
import { Detours } from '../systems/detour.js';

const SQUAD_SIZE = 4;
const GROUP_SLOTS = 8;
const AGENT_RECOLOR_FIRST = 0x29, AGENT_RECOLOR_BASE = 0x461;
const PICKUP_DISTANCE = 0x80;      // [DIS] distancia para recoger un objeto
const MAX_ITEMS = 8;
const PERSON_SIZE = 0x5c, PERSON_LINK_BASE = 2;   // enlaces de `0x8810e` (SPEC §7.4)
const VEHICLE_SIZE = 42, VEHICLE_LINK_BASE = 0x5c02;
const GROUP_SPREAD = 0x80, GROUP_CENTER = 0x40;   // orden 0x23: reparto 2×2 en la casilla
const NO_EXIT_CLASS = 2;                          // orden 0x19: no se baja sobre esta clase

export class World {
  /**
   * @param {object} level JSON de GAMEnn  @param {object} mapData JSON de MAPnn
   * @param {object} deps tablas y animador; `roster` = 4 agentes de la plantilla; `research` = Map(tipo → estado)
   */
  constructor(level, mapData, deps) {
    const { tileClasses, weapons, animator, roster, research, enemyWeapons, armedTable } = deps;
    this.map = new TileMap(mapData, tileClasses);
    this.terrain = new Terrain(this.map);
    this.grid = new SpatialGrid(this.map.width, this.map.height);
    this.rng = new Rng16(level.seed);
    this.events = new EventBus();
    this.animator = animator;
    this.weapons = new Weapons(weapons);
    this.damage = new Damage();
    this.persuasion = new Persuasion(this);
    this.perception = new Perception(this, armedTable);
    this.states = new PersonStates(this);
    this.driving = new Driving(this);
    this.vehicleUpdate = new VehicleUpdate(this);
    this.detours = new Detours(this);
    this.entities = []; this.people = []; this.statics = []; this.items = []; this.vehicles = []; this.effects = [];
    this.selection = new Set();
    this.cheats = { invulnerable: false };    // [DIS] trucos del remake (?cheat en la URL)
    this.groupSelected = false;
    this.leader = null;
    this.cycles = 0;
    this.stats = { shots: 0, hits: 0, civilians: 0, police: 0, guards: 0, criminals: 0, enemyAgents: 0, agentsLost: 0, persuaded: 0, propertyDamage: 0 };
    this.scenarioSteps = new Map(level.scenarios.map((s) => [s.index, s]));

    this.#load(level);
    this.squad = this.#deploySquad(roster);
    for (const e of [...this.people, ...this.statics, ...this.vehicles, ...this.items]) { this.entities.push(e); if (!e.hidden) this.grid.insert(e); }
    this.enemyAI = new EnemyAI(this, level.enemyAI, { research, enemyWeapons });
    this.objectives = new Objectives(this, level.objectives);
    this.select(0);
  }

  #load(level) {
    this.byRef = { people: [], vehicles: [], statics: [], items: [] };
    for (const p of level.people) {
      const raw = hexBytes(p.raw);
      const person = new Person({
        x: p.x, y: p.y, z: p.z, frame: p.frame, hidden: p.hidden, kind: p.kind, health: p.health,
        facing: p.facing, animSet: p.animSet, mods: p.mods, baseSpeed: p.speed, group: Math.floor(p.index / GROUP_SLOTS),
        bars: { adrenaline: new Bar(raw[0x48], raw[0x49]), intelligence: new Bar(raw[0x4c], raw[0x4d]), perception: new Bar(raw[0x50], raw[0x51]) },
        state: p.state, scenarioStart: p.scenarioStart, scenarioCurrent: p.scenarioCurrent,
      });
      person.levelIndex = p.index;
      person.state = person.scenarioStart ? S.SCENARIO : S.IDLE;   // los guiones arrancan desde su paso actual
      // Pasos ya en curso al cargar el nivel: se conservan con sus datos (`+0x2e/+0x30/+0x32`).
      const u16 = (o) => raw[o] | (raw[o + 1] << 8);
      if (p.state === S.WAIT_AGENT) {
        person.state = person.nextState = S.WAIT_AGENT;
        person.watch = { tx: u16(0x2e), ty: u16(0x30), z: u16(0x32) };
        person.watchRow = -1;
      } else if (p.state === S.WALK_SCENARIO) {
        person.state = person.nextState = S.WALK_SCENARIO;
        person.destination = { x: u16(0x2e), y: u16(0x30), z: u16(0x32) };
      }
      this.people.push(person);
      this.byRef.people[p.index] = person;
    }
    for (const s of level.statics) { const o = new StaticObject({ x: s.x, y: s.y, z: s.z, class: s.class, subtype: s.subtype, frame: s.frame, hidden: s.hidden }); this.statics.push(o); this.byRef.statics[s.index] = o; }
    for (const v of level.vehicles) {
      const raw = hexBytes(v.raw), u16 = (o) => raw[o] | (raw[o + 1] << 8), s16 = (o) => (u16(o) << 16) >> 16;
      const o = new Vehicle({
        x: v.x, y: v.y, z: v.z, subtype: v.subtype, frame: v.frame, hidden: v.hidden,
        heading: raw[0x1a], maxSpeed: raw[0x28], health: v.value14, wagonType: u16(0x0e),
      });
      o.anim = u16(0x12);
      o.firstOccupantLink = u16(0x1c);
      o.rawLink = u16(0x20);
      o.linkOffset = { x: s16(0x22), y: s16(0x24), z: s16(0x26) };
      this.vehicles.push(o); this.byRef.vehicles[v.index] = o;
    }
    // Enganches (`+0x20`): cada vagón va pegado al registro anterior del tren.
    for (const o of this.vehicles) o.link = this.#entityByLink(o.rawLink);
    for (const it of level.items) {
      const o = new Item({ x: it.x, y: it.y, z: it.z, class: 4, subtype: it.weapon, weapon: it.weapon, ammo: it.ammo, frame: it.frame, hidden: it.hidden });
      this.items.push(o); this.byRef.items[it.index] = o;
    }
    // Objetos que ya lleva alguien en el nivel: cadena primer objeto → siguiente.
    for (const p of level.people) {
      let ref = p.firstItem;
      const person = this.byRef.people[p.index];
      for (let guard = 0; ref && ref.pool === 'items' && guard < MAX_ITEMS; guard++) {
        const it = this.byRef.items[ref.index];
        if (!it) break;
        this.#attach(person, it);
        ref = level.items.find((q) => q.index === ref.index)?.nextInList;
      }
      if (p.equipped?.pool === 'items') person.equipped = this.byRef.items[p.equipped.index] ?? null;
    }
    this.#seatOccupants(level);
  }

  /** Ocupantes iniciales: primero el conductor (`+0x1c` del vehículo), después el resto por índice. */
  #seatOccupants(level) {
    const inside = level.people.filter((p) => p.vehicle?.pool === 'vehicles');
    for (const v of this.vehicles) {
      const link = v.firstOccupantLink;
      const first = link ? this.byRef.people[(link - PERSON_LINK_BASE) / PERSON_SIZE] : null;
      const rest = inside.filter((p) => this.byRef.vehicles[p.vehicle.index] === v).map((p) => this.byRef.people[p.index]);
      for (const person of [first, ...rest]) if (person && !person.vehicle) this.#seat(person, v);
    }
  }

  /** Enlace de `0x8810e` → entidad: personas desde 2 (paso 0x5c), vehículos desde 0x5c02 (paso 42). */
  #entityByLink(link) {
    if (!link) return null;
    if (link >= VEHICLE_LINK_BASE) {
      const j = (link - VEHICLE_LINK_BASE) / VEHICLE_SIZE;
      return Number.isInteger(j) ? this.byRef.vehicles[j] ?? null : null;
    }
    const i = (link - PERSON_LINK_BASE) / PERSON_SIZE;
    return Number.isInteger(i) ? this.byRef.people[i] ?? null : null;
  }

  #seat(person, v) {
    v.occupants.push(person);
    person.vehicle = v; person.hidden = true;
    person.x = v.x; person.y = v.y; person.z = v.z;
  }

  /** Referencia {pool, index} del nivel → entidad. */
  entityFor(ref) { return ref ? this.byRef[ref.pool]?.[ref.index] ?? null : null; }

  /**
   * Escuadra: casillas 0..3 del grupo 0 con los datos de la plantilla (salud, mejoras,
   * velocidad por piernas y una PISTOL cargada); las casillas sin agente se retiran (SPEC §9.1).
   */
  #deploySquad(roster) {
    const squad = [];
    for (let slot = 0; slot < GROUP_SLOTS; slot++) {
      const person = this.byRef.people[slot];
      if (!person) continue;
      const member = roster[slot];
      if (slot < SQUAD_SIZE && member) {
        person.kind |= PersonKind.DEPLOYED;
        person.playerControlled = true;
        person.health = member.health ?? 16;
        person.mods = member.mods ?? 0;
        person.baseSpeed = legsSpeed(person.mods);
        person.name = member.name;
        person.rosterMember = member.agent ?? null;
        for (const { weapon, ammo } of member.items ?? [{ weapon: W.PISTOL, ammo: this.weapons.fullAmmo(W.PISTOL) }]) this.giveItem(person, weapon, ammo, false);
        person.state = S.IDLE;
        squad.push(person);
      } else {
        this.people.splice(this.people.indexOf(person), 1);
      }
    }
    return squad;
  }

  #attach(person, it) {
    if (person.items.length >= MAX_ITEMS) return false;
    it.owner = person; it.hidden = true;
    this.grid.remove(it);
    person.items.push(it);
    return true;
  }

  /** Crea un objeto en el inventario de una persona (y lo equipa si se pide). */
  giveItem(person, weapon, ammo, equip) {
    const it = new Item({ x: person.x, y: person.y, z: person.z, class: 4, subtype: weapon, weapon, ammo, frame: 0, hidden: true });
    this.items.push(it); this.entities.push(it);
    if (this.#attach(person, it) && equip) person.equipped = it;
    return it;
  }

  /** Efecto visual con animación (destellos de impacto). */
  spawnEffect(x, y, z, anim) {
    const fx = new Entity({ x, y, z, class: 3, frame: this.animator.anims[anim] ?? 0 });
    fx.anim = anim;
    this.effects.push(fx); this.entities.push(fx);
    return fx;
  }

  get playerColor() { return 0; }

  /** Truco [DIS]: los agentes de la escuadra no reciben daño. */
  invulnerable(p) { return this.cheats.invulnerable && p.isPlayerSquad === true; }

  /** Reteñido de los sprites de los agentes por sindicato (SPEC §5.4). */
  recolorFor(e) {
    if (!(e instanceof Person) || !e.isAgent) return null;
    const color = Math.max(0, e.group);
    return (sprite) => {
      const k = sprite - AGENT_RECOLOR_FIRST;
      return k >= 0 && k < 8 ? color * 8 + AGENT_RECOLOR_BASE + k : sprite;
    };
  }

  // ---------- selección y órdenes del jugador (despachador, SPEC §11) ----------
  select(index) {
    const agent = this.squad[index];
    if (!agent || agent.dead) return;
    this.selection = new Set([agent]); this.groupSelected = false; this.leader = agent;
  }
  selectGroup() {
    this.selection = new Set(this.squad.filter((a) => !a.dead));
    this.groupSelected = true;
    this.leader = this.leader && !this.leader.dead ? this.leader : [...this.selection][0] ?? null;
  }
  selected() { return [...this.selection].filter((a) => !a.dead); }

  /**
   * Orden 3 (un agente: el punto exacto) u orden 0x23 (grupo: el agente k va a la
   * subcasilla (k>>1, k&1) de la casilla pulsada; SPEC §11).
   */
  orderMove(x, y, z) {
    const group = this.groupSelected && this.selected().length > 1;
    for (const a of this.selected()) {
      a.pickup = null;
      if (!group) { a.walkTo(x, y, z); continue; }
      const k = this.squad.indexOf(a);
      a.walkTo((x & 0xff00) + (k >> 1) * GROUP_SPREAD + GROUP_CENTER, (y & 0xff00) + (k & 1) * GROUP_SPREAD + GROUP_CENTER, z);
    }
  }

  /** Orden 9 (0x29 en grupo): ir al vehículo y subir. */
  orderBoard(v) {
    for (const a of this.selected()) {
      if (a.vehicle === v) continue;
      a.pickup = null; a.target = v;
      a.order(S.GOTO_VEHICLE, S.BOARD, { x: v.x, y: v.y, z: v.z });
    }
  }

  /** Orden 0x19: bajar del vehículo, salvo sobre suelo de clase 2. */
  orderLeave() {
    for (const a of this.selected()) {
      const v = a.vehicle;
      if (!v || this.map.classAt(v.x, v.y, v.z - 1) === NO_EXIT_CLASS) continue;
      a.state = a.nextState = S.LEAVE_VEHICLE;
    }
  }

  /** Orden 8: disparar el arma equipada hacia (x, y, z); los seguidores armados también disparan. */
  orderFire(x, y, z) {
    for (const a of this.selected()) {
      if (a.equipped?.weapon === W.MEDIKIT) { this.useMedikit(a); continue; }
      this.weapons.activate(a, x, y, z);
      for (const f of this.people) if (f.following === a && f.equipped) this.weapons.activate(f, x, y, z);
    }
  }

  /** Orden 7: equipar (o desequipar) el objeto `slot` del líder. */
  orderEquip(slot) {
    const lead = this.leader;
    const it = lead?.items[slot];
    if (!it) return;
    for (const a of this.selected()) {
      const own = a === lead ? it : a.items.find((x) => x.weapon === it.weapon);
      a.equipped = a.equipped === own ? null : own ?? a.equipped;
    }
  }

  /** Orden 9: ir a recoger un objeto del suelo. */
  orderPickup(item) {
    const a = this.leader;
    if (!a || a.dead || item.owner) return;
    a.pickup = item;
    a.walkTo(item.x, item.y, item.z);
  }

  /** MEDIKIT: salud a 16 y consume una unidad (SPEC §6.1). */
  useMedikit(a) {
    const kit = a.equipped;
    if (!kit || kit.ammo < 0) return;
    a.health = 16;
    kit.ammo--;
    if (kit.ammo < 0) { a.items.splice(a.items.indexOf(kit), 1); a.equipped = null; }
  }

  /** Objeto del suelo bajo una posición del mundo. */
  itemNear(x, y, radius = 0x80) {
    return this.items.find((it) => !it.owner && !it.hidden && Math.hypot(it.x - x, it.y - y) <= radius) ?? null;
  }

  /** Punto del suelo bajo una posición de pantalla, probando de arriba abajo. */
  pickGround(camera, sx, sy) {
    for (let level = this.map.depth - 1; level >= 0; level--) {
      const z = (level + 1) * LEVEL;
      const [x, y] = camera.unproject(sx, sy, z);
      if (!this.map.inside(x >> 8, y >> 8)) continue;
      const top = this.terrain.topSurface(x, y);
      if (top && Math.abs(top - z) < LEVEL) return { x, y, z: top };
    }
    return null;
  }

  // ---------- un ciclo ----------
  update(ticksPerCycle = 7) {
    this.cycles++;
    this.detours.newCycle();
    if (this.objectives.running) this.enemyAI.update();
    this.perception.update();
    for (const p of this.people) {
      this.states.update(p);
      if (p.pickup && !p.dead) this.#tryPickup(p);
    }
    this.#updateVehicles();
    this.weapons.emit(this);
    this.#updateEffects();
    this.perception.collect();
    this.objectives.update(ticksPerCycle);
  }

  /** Ciclo de vehículos (`0x39890`): enganches, daño, explosión y animación (SPEC §7.4). */
  #updateVehicles() {
    for (const v of this.vehicles) this.vehicleUpdate.update(v);
  }

  #tryPickup(p) {
    const it = p.pickup;
    if (it.owner) { p.pickup = null; return; }
    if (Math.hypot(it.x - p.x, it.y - p.y) <= PICKUP_DISTANCE) {
      if (this.#attach(p, it)) this.events.emit('pickup', { person: p, item: it });
      p.pickup = null;
    } else if (p.state === S.IDLE) p.pickup = null;
  }

  #updateEffects() {
    for (const fx of this.effects) if (fx.tick ? fx.tick(this) : this.animator.advance(fx)) fx.expired = true;
    if (this.effects.some((fx) => fx.expired)) {
      this.effects = this.effects.filter((fx) => !fx.expired);
      this.entities = this.entities.filter((e) => !e.expired);
    }
  }

  carriedWeight(p) {
    let w = 0;
    for (const it of p.items) w += this.weapons.info(it.weapon)?.weight ?? 0;
    return w;
  }
}

function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
