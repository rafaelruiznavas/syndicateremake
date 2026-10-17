// Plantilla de 18 huecos de agente, mejoras y equipo (SPEC §9.1, §9.2, §9.2b).

export const ROSTER_SIZE = 18;
export const TEAM_SIZE = 4;
export const MAX_ITEMS = 8;
const NAME_COUNT = 69;

/** Campo de bits de cada parte del cuerpo dentro de la palabra de mejoras (§9.2). */
export const MOD_FIELDS = Object.freeze({
  legs: { shift: 1, mask: 0x0006 }, arms: { shift: 3, mask: 0x0018 }, chest: { shift: 5, mask: 0x0060 },
  heart: { shift: 7, mask: 0x0180 }, eyes: { shift: 11, mask: 0x1800 }, brain: { shift: 9, mask: 0x0600 },
});

export const modLevel = (mods, part) => (mods & MOD_FIELDS[part].mask) >> MOD_FIELDS[part].shift;
export const withMod = (mods, part, version) => (mods & ~MOD_FIELDS[part].mask) | (version << MOD_FIELDS[part].shift);

export class Agent {
  constructor({ name = -1, health = -1, mods = 0, team = 0, items = [] } = {}) {
    this.name = name;                          // índice en agent-names.json; −1 = hueco vacío
    this.health = health;
    this.mods = mods;
    this.team = team;                          // 1..4 = puesto en el equipo; 0 = fuera
    this.items = items.map((it) => ({ weapon: it.weapon, ammo: it.ammo }));
  }
  get alive() { return this.health >= 0; }
  get empty() { return this.name < 0; }
  clear() { this.name = -1; this.health = -1; this.mods = 0; this.team = 0; this.items = []; }
  toJSON() { return { name: this.name, health: this.health, mods: this.mods, team: this.team, items: this.items }; }
}

export class Roster {
  constructor(saved) {
    this.agents = Array.from({ length: ROSTER_SIZE }, (_, i) => new Agent(saved?.[i]));
  }

  /** Nombre al azar sin repetir (`0x23540`): rng(69) y, si está en uso, el siguiente libre. */
  pickName(rng) {
    let n = rng.int(NAME_COUNT);
    while (this.agents.some((a) => a.name === n)) n = (n + 1) % NAME_COUNT;
    return n;
  }

  /** Partida nueva: 8 agentes, los 4 primeros en el equipo, cada uno con una PISTOL. */
  reset(rng, pistolAmmo) {
    this.agents.forEach((a, i) => {
      a.clear();
      if (i >= 8) return;
      a.mods = rng.int(3) & 1;
      a.health = 16;
      a.name = this.pickName(rng);
      a.team = i < TEAM_SIZE ? i + 1 : 0;
      a.items = [{ weapon: 2, ammo: pistolAmmo }];
    });
  }

  /** Equipo de la misión ordenado por puesto. */
  team() {
    return this.agents.filter((a) => a.team > 0 && a.alive).sort((a, b) => a.team - b.team);
  }

  /** Mete o saca a un agente del equipo; los puestos se reasignan en orden. */
  toggleTeam(agent) {
    if (!agent.alive) return false;
    if (agent.team > 0) agent.team = 0;
    else if (this.team().length < TEAM_SIZE) agent.team = TEAM_SIZE + 1;
    else return false;
    this.team().forEach((a, i) => { a.team = i + 1; });
    return true;
  }

  /** Primer hueco vacío (para reclutas persuadidos). */
  freeSlot() { return this.agents.find((a) => a.empty) ?? null; }
  anyAlive() { return this.agents.some((a) => a.alive); }

  toJSON() { return this.agents.map((a) => a.toJSON()); }
}
