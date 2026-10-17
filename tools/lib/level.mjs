// GAMEnn.DAT (116 010 bytes) → JSON propio (SPEC §5, §7, §8).
// El fichero es una instantánea del estado inicial del mundo. Las direcciones se dan
// como VA donde el juego lo carga (base 0x80108) solo para documentar los campos.
//
// Pools (dirección inicial, tamaño de registro, cantidad):
//   personas   0x88110  92 B  256
//   vehículos  0x8dd10  42 B   64
//   estáticos  0x8e790  30 B  400
//   objetos    0x91670  36 B  512
//   efectos    0x95e70  30 B  256
//   escenarios 0x97c70   8 B 2048
// Las referencias entre registros son u16 relativas a 0x8810e; se convierten a
// {pool, index}. Las de escenario son relativas a 0x97c70.

const BASE = 0x80108;
const REF_BASE = 0x8810e;
export const POOLS = [
  { name: 'people', va: 0x88110, size: 92, count: 256 },
  { name: 'vehicles', va: 0x8dd10, size: 42, count: 64 },
  { name: 'statics', va: 0x8e790, size: 30, count: 400 },
  { name: 'items', va: 0x91670, size: 36, count: 512 },
  { name: 'effects', va: 0x95e70, size: 30, count: 256 },
];
const SCENARIOS = { va: 0x97c70, size: 8, count: 2048 };

/** Referencia u16 (relativa a 0x8810e) → {pool, index} o null. */
export function resolveRef(ref) {
  if (!ref) return null;
  const va = REF_BASE + ref;
  for (const p of POOLS) {
    if (va >= p.va && va < p.va + p.size * p.count) {
      const off = va - p.va;
      return off % p.size === 0 ? { pool: p.name, index: off / p.size } : { pool: p.name, index: Math.floor(off / p.size), misaligned: off % p.size };
    }
  }
  return { pool: 'unknown', ref };
}

const hex = (b) => Buffer.from(b).toString('hex');

export function decodeLevel(buf) {
  if (buf.length !== 116010) throw new Error(`GAMEnn: tamaño inesperado ${buf.length}`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const at = (va) => va - BASE;
  const u8 = (va) => buf[at(va)], s16 = (va) => dv.getInt16(at(va), true), u16 = (va) => dv.getUint16(at(va), true), u32 = (va) => dv.getUint32(at(va), true);

  const common = (r) => ({
    x: s16(r + 4), y: s16(r + 6), z: s16(r + 8),
    hidden: (u8(r + 0x0a) & 1) === 1, flagsA: u8(r + 0x0a), flagsB: u8(r + 0x0b),
    frame: u16(r + 0x10), value14: s16(r + 0x14), class: u8(r + 0x18), subtype: u8(r + 0x19),
  });
  const scenarioRef = (v) => (v ? v / 8 : null);
  const level = {
    format: 'syndicate-level/1',
    seed: u16(0x80108),
    header: hex(buf.subarray(2, 6)),
    map: u16(0x9be30),
    mapInfo: hex(buf.subarray(at(0x9bc70), at(0x9be30))),
    tail: { w9be32: u16(0x9be32), minZ: s16(0x9be34) },
    people: [], vehicles: [], statics: [], items: [], effects: [], scenarios: [], objectives: [],
  };

  for (const p of POOLS) {
    for (let i = 0; i < p.count; i++) {
      const r = p.va + i * p.size;
      if (!u8(r + 0x18)) continue;
      const e = { index: i, ...common(r), raw: hex(buf.subarray(at(r), at(r) + p.size)) };
      if (p.name === 'people') Object.assign(e, {
        health: s16(r + 0x14), kind: u16(r + 0x1c), state: u8(r + 0x19), nextState: u8(r + 0x58),
        animSet: u16(r + 0x0e), anim: u16(r + 0x12), facing: u8(r + 0x1a),
        vehicle: resolveRef(u16(r + 0x24)), scenarioCurrent: scenarioRef(u16(r + 0x26)), scenarioStart: scenarioRef(u16(r + 0x28)),
        target: resolveRef(u16(r + 0x2a)), follow: resolveRef(u16(r + 0x20)),
        firstItem: resolveRef(u16(r + 0x3a)), mods: u16(r + 0x3c), equipped: resolveRef(u16(r + 0x44)),
        adrenaline: { neutral: u8(r + 0x48), level: u8(r + 0x49) }, speed: u8(r + 0x55),
      });
      if (p.name === 'items') Object.assign(e, { weapon: u8(r + 0x19), ammo: s16(r + 0x14), nextInList: resolveRef(u16(r + 0x1c)) });
      p.name === 'people' ? level.people.push(e) : level[p.name].push(e);
    }
  }
  for (let i = 1; i < SCENARIOS.count; i++) {
    const r = SCENARIOS.va + i * 8;
    const next = u16(r), target = u16(r + 2), x = u8(r + 4), y = u8(r + 5), z = u8(r + 6), type = u8(r + 7);
    if (!type && !next && !target) continue;
    level.scenarios.push({ index: i, next: scenarioRef(next), target: resolveRef(target), x, y, z, type });
  }
  // Guiones de los agentes enemigos (SPEC §7.3): cabecera en 0x9beaa y 128 pasos de 15 B en 0x9beb2.
  level.enemyAI = {
    groups: u8(0x9beaa), agentsPerGroup: u8(0x9beab), cyclesPerTick: u8(0x9beac), modsLevel: u8(0x9bead),
    timeBomb: u8(0x9beae) !== 0, persuadertron: u8(0x9beaf) !== 0, firstStep: u8(0x9beb0), forcedWeapon: u8(0x9beb1),
    steps: [],
  };
  for (let i = 0; i < 128; i++) {
    const r = 0x9beb2 + i * 15;
    if (r + 15 > 0x9c632) break;
    const type = u8(r + 7);
    level.enemyAI.steps.push({
      index: i, next: u16(r), counter: u16(r + 2), useFlag: u8(r + 4), flags: u8(r + 6), type,
      order: u8(r + 8), a: u16(r + 9), b: u16(r + 11), c: u16(r + 13),
    });
  }
  for (let k = 0; k < 8; k++) {
    const r = 0x9be3a + k * 14;
    const type = u16(r + 4);
    if (!type) continue;
    level.objectives.push({ slot: k, type, target: resolveRef(u16(r + 6)), x: s16(r + 8), y: s16(r + 10), raw: hex(buf.subarray(at(r), at(r) + 14)) });
  }
  return level;
}
