// Persuasión (SPEC §6.4).

import { PersonKind, Ev } from '../entities/person.js';

const brainLevel = (p) => (p.mods >> 9) & 3;

/** Peso de un seguidor para el persuasor (agente 5, policía/guardia 2, criminal/civil 1). */
function followerWeight(p) {
  if (p.is(PersonKind.AGENT)) return 5;
  if (p.is(PersonKind.POLICE) || p.is(PersonKind.GUARD)) return 2;
  if (p.is(PersonKind.CRIMINAL) || p.is(PersonKind.CIVILIAN)) return 1;
  return 0;
}
/** Peso usado al comparar fuerzas de dos grupos (agente 5, policía 4, guardia 3, criminal 2, civil 1). */
function groupWeight(p) {
  if (p.is(PersonKind.AGENT)) return 5;
  if (p.is(PersonKind.POLICE)) return 4;
  if (p.is(PersonKind.GUARD)) return 3;
  if (p.is(PersonKind.CRIMINAL)) return 2;
  if (p.is(PersonKind.CIVILIAN)) return 1;
  return 0;
}

export class Persuasion {
  constructor(world) { this.world = world; }

  followersOf(group, weight) {
    let sum = 0;
    for (const p of this.world.people) if (!p.dead && p.following && p.following.group === group) sum += weight(p);
    return sum;
  }

  /** ¿Convierte `persuader` a `target`? (`0x302a0`) */
  admits(persuader, target) {
    if (target.following && target.following.group === persuader.group) return false;
    if (target.group >= 0 && target.group === persuader.group) return false;
    if (!target.is(PersonKind.AGENT)) {
      const points = this.followersOf(persuader.group, followerWeight) * (brainLevel(persuader) + 1) + 1;
      if (target.is(PersonKind.CIVILIAN)) return true;
      if (target.is(PersonKind.CRIMINAL)) return points > 1;
      if (target.is(PersonKind.GUARD)) return points > 3;
      if (target.is(PersonKind.POLICE)) return points > 7;
      return false;
    }
    const mine = this.followersOf(persuader.group, groupWeight) * (brainLevel(persuader) + 1) + 1;
    const theirs = this.followersOf(target.group, groupWeight) * (brainLevel(target) + 1) + 1;
    return mine > 31 && theirs < mine;
  }

  /**
   * Activación del PERSUADERTRON: marca el evento 0x400 en las personas cercanas.
   * [DIS] Mientras se documenta la rejilla original (`word3c & 0x1800`), radio de una casilla.
   */
  pulse(world, persuader) {
    for (const p of world.grid.query(persuader.x - 0x100, persuader.y - 0x100, persuader.x + 0x100, persuader.y + 0x100)) {
      if (p === persuader || p.class !== 1 || p.dead || Math.abs(p.z - persuader.z) > 0x80) continue;
      p.events |= Ev.PERSUADE;
      p.eventSource = persuader;
    }
  }
}
