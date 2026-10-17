// Estado de una partida: fondos, reloj, plantilla, territorios e investigación, y el paso
// de la campaña a la misión y de vuelta (SPEC §8.2, §9).

import { Rng16 } from '../core/rng.js';
import { Clock, SCREEN_DAY, MISSION_DAY } from './clock.js';
import { Territories, PLAYER } from './territories.js';
import { Research } from './research.js';
import { Roster } from './roster.js';
import { Shop } from './shop.js';
import { PersonKind } from '../entities/person.js';
import { MissionStatus } from '../systems/objectives.js';

export const START_FUNDS = 30000;
export const CHEAT_FUNDS = 100_000_000;
const KILL_POPULATION_PENALTY = 100;
const SYNDICATES = 8;
const INITIAL_MAP_SELECTION = 9;
const PERSUADED_REWARD = [
  [PersonKind.CIVILIAN, 50], [PersonKind.GUARD, 150], [PersonKind.POLICE, 150], [PersonKind.CRIMINAL, 300],
];

/** Fin de partida tras volver de una misión. */
export const Outcome = Object.freeze({ CONTINUE: 'continue', MISSION_WON: 'mission-won', MISSION_LOST: 'mission-lost', GAME_WON: 'game-won', GAME_OVER: 'game-over' });

export class Campaign {
  /**
   * @param {{weapons:object[], mods:object[], territories:object[], briefings:object}} data
   * @param {object} [saved] estado guardado (toJSON)
   */
  constructor(data, saved) {
    this.data = data;
    this.rng = new Rng16(saved?.seed ?? 0);
    this.funds = saved?.funds ?? START_FUNDS;
    this.clock = new Clock(saved?.clock);
    this.roster = new Roster(saved?.roster);
    this.territories = new Territories(data.territories, saved?.territories?.list);
    this.territories.current = saved?.territories?.current ?? 0;
    this.research = new Research(data.mods, data.weapons, saved?.research);
    this.shop = new Shop(this, data.weapons, data.mods, this.research);
    this.briefing = saved?.briefing ?? null;  // {territory, mission}
    this.briefs = saved?.briefs ?? {};        // INFO y ENHANCE comprados por territorio (`+0x555`, `+0x587`)
    this.logo = saved?.logo ?? 0;             // logo de la compañía (`+0x4ac`)
    // Color de cada sindicato (`+0x4ab` de cada registro de 0x417 B; al empezar, el i‑ésimo, `0x25a10`).
    this.colours = saved?.colours ?? Array.from({ length: SYNDICATES }, (_, i) => i);
    if (!saved?.colours && saved?.colour !== undefined) this.setColour(saved.colour);
    // Territorio elegido en el mapa (`0x55030`): solo lo cambia la pantalla del mapa y empieza
    // en WESTERN EUROPE (valor estático 9). No forma parte de la partida guardada [INF].
    this.mapSelection = INITIAL_MAP_SELECTION;
    this.companyName = saved?.companyName ?? '';   // `+0x4bf`
    this.playerName = saved?.playerName ?? '';     // `+0x4ad`
  }

  /** Color del jugador (sindicato 0). */
  get colour() { return this.colours[PLAYER]; }
  /** Color del sindicato `s` (índice en la tabla `0x5b46a`). */
  colourOf(s) { return this.colours[s] ?? s; }

  /** Cambia el color del jugador; el rival que lo tenía recibe el antiguo (`0x175c0`). */
  setColour(c) {
    const old = this.colours[PLAYER];
    if (c === old) return;
    const rival = this.colours.findIndex((v, s) => s !== PLAYER && v === c);
    if (rival >= 0) this.colours[rival] = old;
    this.colours[PLAYER] = c;
  }

  /** Partida nueva (`0x23880`). */
  static newGame(data, { seed = 0, cheat = false } = {}) {
    const c = new Campaign(data);
    c.rng = new Rng16(seed);
    c.funds = cheat ? CHEAT_FUNDS : START_FUNDS;
    c.roster.reset(c.rng, data.weapons[1].maxAmmo);
    c.territories.reset(c.rng);
    return c;
  }

  // ------------------------------------------------------------------ tiempo

  /** Un fotograma de pantalla de gestión. Devuelve true si ha pasado un día. */
  screenTick() { return this.#tick(SCREEN_DAY); }
  /** Un ciclo de misión. */
  missionTick() { this.missionTime++; return this.#tick(MISSION_DAY); }

  #tick(dayLength) {
    const { hourChanged, dayPassed } = this.clock.tick(dayLength);
    if (hourChanged) this.research.hour(this);
    if (dayPassed) this.funds += this.territories.daily(this.rng);
    return dayPassed;
  }

  // ------------------------------------------------------------------ mapa y briefing

  eligible(i) { return this.territories.eligible(i); }

  /** Elegir territorio en el mapa → briefing (`0x27e00`). */
  chooseTerritory(i) {
    if (!this.eligible(i)) return false;
    this.territories.current = i;
    this.briefing = { territory: i, mission: this.territories.get(i).mission };
    this.briefs[i] ??= { info: 0, enhance: 0 };
    return true;
  }

  /** INFO y ENHANCE comprados en el territorio del briefing. */
  get briefState() { return this.briefs[this.briefing?.territory] ?? { info: 0, enhance: 0 }; }

  briefData(lang = 'en') { return this.data.briefings[String(this.briefing?.mission)]?.[lang] ?? null; }

  /** Texto visible: cada INFO comprado sustituye el siguiente `|` por un espacio (`0x10e60`). */
  briefingText(lang = 'en') {
    const b = this.briefData(lang);
    if (!b) return '';
    let text = b.text, n = this.briefState.info;
    for (let i = 0; n > 0 && i < text.length; i++) if (text[i] === '|') { text = `${text.slice(0, i)} ${text.slice(i + 1)}`; n--; }
    return text;
  }

  /** Coste de la siguiente compra de INFO o ENHANCE, o 0 si no quedan. */
  briefCost(kind) {
    const b = this.briefData();
    if (!b) return 0;
    const costs = kind === 'info' ? b.infoCosts : b.enhanceCosts;
    const level = this.briefState[kind];
    if (kind === 'info' && b.text.split('|').length - 1 <= level) return 0;
    return costs[level] ?? 0;
  }

  /** Compra de INFO o ENHANCE: exige coste < fondos (`0x10e60`). */
  buyBriefing(kind) {
    const cost = this.briefCost(kind);
    if (!cost || cost >= this.funds) return false;
    this.funds -= cost;
    this.briefState[kind]++;
    return true;
  }

  // ------------------------------------------------------------------ misión

  /** Aceptar en CRYO: plantilla para el World y cambio de escala del reloj. */
  startMission() {
    const team = this.roster.team();
    if (!team.length || !this.briefing) return null;
    this.clock.enterMission();
    this.missionTime = 0;
    return {
      mission: this.briefing.mission,
      roster: team.map((agent) => ({ agent, name: this.data.agentNames?.[agent.name], health: agent.health, mods: agent.mods, items: agent.items })),
    };
  }

  /**
   * Vuelta de la misión (`0x246d0` + `0x18ff0` + `0x37f80`). Devuelve el informe.
   * @param {import('../world/world.js').World} world
   */
  finishMission(world) {
    const status = world.objectives.status;
    const completed = status === MissionStatus.COMPLETED;
    const withdrawn = status === MissionStatus.WITHDRAWN;
    const report = {
      status, agentsUsed: world.squad.length, newAgents: 0, persuaded: 0,
      enemyAgents: world.stats.enemyAgents, criminals: world.stats.criminals, civilians: world.stats.civilians,
      police: world.stats.police, guards: world.stats.guards, extra: 0,
      shots: world.stats.shots, hits: Math.min(world.stats.hits, world.stats.shots),
      newWeaponry: false, researchCompleted: [], time: 0, outcome: Outcome.CONTINUE,
    };

    // 1. Transferencia de los agentes y sus seguidores.
    for (const person of world.squad) {
      const agent = person.rosterMember;
      if (!agent) continue;
      if (completed) {
        for (const f of world.people) {
          if (f.following !== person || f.dead) continue;
          report.persuaded++;
          const reward = PERSUADED_REWARD.find(([kind]) => f.is(kind));
          if (reward) { this.funds += reward[1]; continue; }
          if (f.is(PersonKind.AGENT) && f.health >= 0) {
            const slot = this.roster.freeSlot();
            if (!slot) continue;
            slot.mods = f.mods; slot.health = 16; slot.name = this.roster.pickName(this.rng); slot.items = []; slot.team = 0;
            report.newAgents++;
          }
        }
      }
      if (person.health < 0 || person.dead) { agent.clear(); continue; }
      agent.health = 16;
      agent.mods = person.mods;
      if (!withdrawn) agent.items = person.items.slice(0, 8).map((it) => ({ weapon: it.weapon, ammo: it.ammo }));
    }

    // 2. Informe: armas nuevas a investigación y reloj a escala de pantalla.
    for (const agent of this.roster.team()) {
      agent.items = agent.items.filter((it) => {
        if (!this.research.submitWeapon(it.weapon)) return true;
        report.newWeaponry = true;
        return false;
      });
    }
    report.researchCompleted = this.research.completed.splice(0);
    this.clock.leaveMission();
    report.time = this.missionTime * 4;
    report.days = Math.floor(report.time / SCREEN_DAY);
    report.hours = Math.floor((report.time % SCREEN_DAY) / Math.floor(SCREEN_DAY / 24));

    // 3. Al salir del informe: la población del territorio paga los muertos.
    const territory = this.territories.get(this.briefing.territory);
    territory.population -= KILL_POPULATION_PENALTY * (report.guards + report.civilians + report.police + report.criminals + report.extra);

    // 4. Conquista o derrota.
    if (completed) report.outcome = this.territories.conquer(this.briefing.territory) ? Outcome.GAME_WON : Outcome.MISSION_WON;
    else if (status === MissionStatus.FAILED) report.outcome = this.roster.anyAlive() ? Outcome.MISSION_LOST : Outcome.GAME_OVER;
    this.briefing = null;
    return report;
  }

  // ------------------------------------------------------------------ guardado

  get owned() { return this.territories.ownedBy(PLAYER).length; }

  toJSON() {
    return {
      seed: this.rng.seed, funds: this.funds, clock: this.clock.toJSON(), roster: this.roster.toJSON(),
      territories: this.territories.toJSON(), research: this.research.toJSON(), briefing: this.briefing,
      briefs: this.briefs, logo: this.logo, colours: [...this.colours], companyName: this.companyName, playerName: this.playerName,
    };
  }
}
