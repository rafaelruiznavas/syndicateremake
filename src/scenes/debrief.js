// Fin de misión (SPEC §8.2, §12.2): animación de resultado (`0x37f80`: MGAMEWIN, MENDWIN,
// MENDLOSE, MLOSEGAM), MSCRENUP y MISSION DEBRIEFING (`0x18ff0`, tabla `0x5b808`).

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';
import { MissionStatus } from '../systems/objectives.js';
import { Outcome } from '../campaign/campaign.js';
import { Bank } from '../audio/audio.js';

const ROW = { label: 0x12, value: 0x140, y: 0x78, step: 0xe };

/**
 * Animación a pantalla completa y después otra escena. Sus señales (SPEC §13.1) lanzan
 * sonidos del banco SOUND-1 y secuencias de música.
 */
export class AnimScene extends MenuScreen {
  constructor(game, { anim, next, args = {}, skippable = true }) {
    super(game, { anim, skippable, cues: game.assets.animCues?.[anim] ?? [] });
    this.clock = false; this.next = next; this.args = args;
  }
  cue({ cmd, arg }) {
    if (cmd === 'S' || cmd === 's') this.game.audio.play(Bank.SCREENS, arg);
    else if (cmd === 'M' || cmd === 'm') this.game.music.select(`syngame-${arg}`);
  }
  ready() { this.game.go(this.next, this.args); }
  draw() {}
}

/** Animación de resultado según `0x37f80`; MENDWIN encadena tras MGAMEWIN al ganar la partida. */
export function outcomeAnimations(outcome) {
  switch (outcome) {
    case Outcome.MISSION_WON: return ['mgamewin'];
    case Outcome.GAME_WON: return ['mgamewin', 'mendwin'];
    case Outcome.MISSION_LOST: return ['mendlose'];
    case Outcome.GAME_OVER: return ['mlosegam'];
    default: return [];
  }
}

export class DebriefScene extends MenuScreen {
  constructor(game, { report }) {
    super(game, { anim: 'mdebrief', out: 'mdeout' });
    this.report = report;
  }

  draw(vga) {
    const g = this.gfx, r = this.report;
    g.title(vga, this.label('debriefTitle'));
    this.drawClock(vga);
    this.drawLogo(vga);
    g.text(vga, this.label('statistics'), 0x12, 0x64, FONT.HOT);
    const status = { [MissionStatus.COMPLETED]: 'completed', [MissionStatus.FAILED]: 'failed', [MissionStatus.WITHDRAWN]: 'withdrew' }[r.status];
    const rows = [
      ['missionStatus', this.label(status)],
      ['agentsUsed', r.agentsUsed],
      ['newAgents', r.newAgents],
      ['timeInMission', `${String(r.hours).padStart(2, '0')} HRS ${r.days} DAYS`],
      ['enemyAgents', r.enemyAgents],
      ['criminals', r.criminals],
      ['civilians', r.civilians],
      ['police', r.police],
      ['guards', r.guards],
      ['persuaded', r.persuaded],
      ['accuracy', r.shots ? `${Math.floor((r.hits * 100) / r.shots)}%` : this.label('noBullets')],
    ];
    rows.forEach(([key, value], i) => {
      const y = ROW.y + i * ROW.step;
      g.text(vga, this.label(key), ROW.label, y, FONT.HOT);
      g.text(vga, String(value), ROW.value, y, FONT.HOT);
    });
    if (r.researchCompleted.length) g.text(vga, r.researchCompleted.map((it) => it.info.name[this.lang]).join(' '), 0x12, 0x120, FONT.HOT);
    if (r.newWeaponry) {
      g.text(vga, this.label('newWeaponry1'), 0x12, 0x138, FONT.HOT);
      g.text(vga, this.label('newWeaponry2'), 0x12, 0x144, FONT.HOT);
    }
    this.button(vga, 'accept', 0x10, 0x15a, 0x92, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
  }

  click(e) {
    if (this.hot(0x10, 0x15a, 0x92, 0x174, e)) this.exit(() => this.game.go('map'));
    else if (this.hot(500, 0x15a, 0x274, 0x174, e)) this.exit(() => this.game.go('menu'));
  }

  key(code) {
    if (code === 'Enter') { this.exit(() => this.game.go('map')); return true; }
    if (code === 'Escape') { this.exit(() => this.game.go('menu')); return true; }
    return false;
  }
}
