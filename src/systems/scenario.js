// Escenarios de personas: guiones de 8 B de cada nivel (SPEC §7, tabla «Escenarios»; `0x31fc0`).

import { S } from '../entities/person.js';

export const ScenarioType = Object.freeze({
  WALK: 1, BOARD_VEHICLE: 2, LEAVE_VEHICLE: 3, KILL: 4, FOLLOW_TARGET: 5, GOTO_TARGET: 6,
  MISSION_FAIL: 7, WAIT_AGENT: 8, END: 9, WAIT: 10, MISSION_SUCCESS: 11,
});

const WAIT_CYCLES = 50;

/**
 * Ejecuta el paso actual del escenario de `p` y avanza al siguiente (o vuelve al inicio).
 * @param {Map<number, object>} steps escenarios del nivel por índice
 */
export function runScenarioStep(world, p, steps) {
  const step = steps.get(p.scenario);
  if (!step) { p.state = S.IDLE; return; }
  switch (step.type) {
    case ScenarioType.WALK:
      p.destination = { x: step.x * 128 + 64, y: step.y * 128 + 64, z: step.z << 7 };
      p.state = p.nextState = S.WALK_SCENARIO;
      break;
    case ScenarioType.BOARD_VEHICLE:
      if (!p.vehicle) { p.target = world.entityFor(step.target); p.state = S.GOTO_VEHICLE; p.nextState = S.BOARD; }
      break;
    case ScenarioType.LEAVE_VEHICLE:
      p.state = p.nextState = S.LEAVE_VEHICLE;
      break;
    case ScenarioType.GOTO_TARGET:
      p.target = world.entityFor(step.target);
      p.state = p.nextState = S.GOTO_VEHICLE;
      break;
    case ScenarioType.WAIT_AGENT:
      // Coordenadas en medias casillas: la zona empieza en la casilla (x/2, y/2) (`0x31fc0`).
      p.watch = { tx: step.x >> 1, ty: step.y >> 1, z: step.z << 7 };
      p.watchRow = -1;
      p.state = p.nextState = S.WAIT_AGENT;
      break;
    case ScenarioType.KILL:
      p.target = world.entityFor(step.target);
      p.state = p.nextState = S.APPROACH;
      break;
    case ScenarioType.FOLLOW_TARGET:
      p.target = world.entityFor(step.target);
      p.state = p.nextState = S.ADJACENT;
      break;
    case ScenarioType.MISSION_FAIL:
      p.state = p.nextState = S.IDLE;
      world.objectives.fail('escenario');
      break;
    case ScenarioType.END:
      p.scenario = null;
      p.state = S.SCRIPT_WAIT;
      return;
    case ScenarioType.WAIT:
      p.timer = WAIT_CYCLES;
      p.state = S.WAIT;
      break;
    case ScenarioType.MISSION_SUCCESS:
      p.state = p.nextState = S.IDLE;
      world.objectives.complete('escenario');
      break;
    default:
      p.state = S.IDLE;
      break;
  }
  p.scenario = step.next ?? p.scenarioStart;
  if (!p.scenario) p.scenario = p.scenarioStart;
}
