// Entidad base: posición en el mundo, clase y frame de animación.

import { octant } from '../core/angles.js';

let nextId = 1;

export class Entity {
  constructor({ x, y, z, class: cls, subtype = 0, frame = 0, hidden = false }) {
    this.id = nextId++;
    this.x = x; this.y = y; this.z = z;
    this.class = cls;               // 1 persona, 2 vehículo, 4 objeto, 5 estático
    this.subtype = subtype;
    this.frame = frame;             // índice en la tabla de frames (HFRA)
    this.hidden = hidden;
  }
  update() {}
}

/** Objetos estáticos del escenario (clase 5): árboles, farolas, puertas… */
export class StaticObject extends Entity {}

/** Objetos que se pueden llevar (clase 4): armas y equipo. */
export class Item extends Entity {
  constructor(props) {
    super(props);
    this.weapon = props.weapon;     // tipo 1..19 (SPEC §6.1)
    this.ammo = props.ammo;         // recurso; 0 aún dispara, −1 agotado
    this.owner = null;
  }
}

/**
 * Modelos de vehículo (SPEC §7.4, `0x39890`). El subtipo `+0x19` es a la vez modelo y
 * condición: dos valores intactos, uno ardiendo y uno de chatarra. `anims` da la base de
 * cada condición; `dirs` cuántas orientaciones tiene la animación intacta (las demás
 * tienen 4, o 2 en los vagones). `value` se suma al contador de daños al quedar en chatarra.
 */
const VEHICLE_MODELS = [
  { intact: [0x01, 0x02], burning: 0x03, wreck: 0x04, anims: [400, 0x198, 0x19c], dirs: 8, value: 150000 },
  { intact: [0x05, 0x06], burning: 0x07, wreck: 0x08, anims: [0x1a0, 0x1a4, 0x1a8], dirs: 4, value: 2000000 },
  { intact: [0x09, 0x0a], burning: 0x0b, wreck: 0x0c, anims: [0x1ac, 0x1ae, 0x1b0], dirs: 2, value: 900000 },
  { intact: [0x0d, 0x0e], burning: 0x0f, wreck: 0x10, anims: [0x1be, 0x1c6, 0x1ca], dirs: 8, value: 9000, stillWreck: true },
  { intact: [0x11, 0x12], burning: 0x13, wreck: 0x14, anims: [0x206, 0x20e, 0x212], dirs: 8, value: 45000 },
  { intact: [0x1c, 0x1d], burning: 0x1e, wreck: 0x1f, anims: [0x216, 0x21e, 0x222], dirs: 8, value: 50000, stillWreck: true },
  { intact: [0x24, 0x25], burning: 0x26, wreck: 0x27, anims: [0x1d6, 0x1de, 0x1e2], dirs: 8, value: 40000 },
  { intact: [0x28, 0x29], burning: 0x2a, wreck: 0x2b, anims: [0x1ee, 0x1f6, 0x1fa], dirs: 8, value: 35000 },
];
const MODEL_OF = new Map();
for (const m of VEHICLE_MODELS) for (const s of [...m.intact, m.burning, m.wreck]) MODEL_OF.set(s, m);

/** Vagones: cada tipo (`+0x0e`, 0..2) ocupa 6 animaciones seguidas. */
const WAGON_TYPE_STRIDE = 6;

export const VehicleCondition = Object.freeze({ INTACT: 0, BURNING: 1, WRECK: 2 });

/**
 * Vehículos (clase 2; SPEC §7.4). Los mueve su conductor (`systems/vehicles.js`); la
 * velocidad actual vive en el conductor. Cada ciclo `VehicleUpdate` resuelve el daño,
 * la explosión y la chatarra, y coloca los vagones enganchados.
 */
export class Vehicle extends Entity {
  constructor(props) {
    super({ ...props, class: 2 });
    this.heading = props.heading ?? 0;          // +0x1a
    this.maxSpeed = props.maxSpeed ?? 0;        // +0x28
    this.health = props.health ?? 0;            // +0x14 resistencia; al arder, ciclos que le quedan
    this.wagonType = props.wagonType ?? 0;      // +0x0e aspecto del vagón
    this.model = MODEL_OF.get(this.subtype) ?? null;
    this.events = 0;                            // +0x0c eventos de daño (bits de `Ev`)
    this.attacker = null;                       // +0x16 último que le ha dado
    this.link = null;                           // +0x20 entidad a la que va enganchado
    this.linkOffset = null;                     // +0x22/+0x24/+0x26 desplazamiento respecto a ella
    this.occupants = [];                        // +0x1c y cadena +0x22: el primero conduce
  }
  get driver() { return this.occupants[0] ?? null; }
  /** Quien lo controla (para el objetivo 15, «vehículo controlado por un agente»). */
  get owner() { return this.driver; }
  /** Locomotoras (subtipos 5 y 6): van en línea recta hacia el destino. */
  get straight() { return this.model === VEHICLE_MODELS[1]; }
  /** Vagones de tren (subtipos 9 y 10). */
  get wagon() { return this.model === VEHICLE_MODELS[2]; }
  get condition() {
    const m = this.model;
    if (!m || m.intact.includes(this.subtype)) return VehicleCondition.INTACT;
    return this.subtype === m.burning ? VehicleCondition.BURNING : VehicleCondition.WRECK;
  }
  get destroyed() { return this.condition !== VehicleCondition.INTACT; }

  /** Animación según el modelo, la condición y la orientación; −1 si el subtipo no tiene modelo. */
  get animation() {
    const m = this.model;
    if (!m) return -1;
    const c = this.condition;
    let base = m.anims[c];
    if (this.wagon) base += this.wagonType * WAGON_TYPE_STRIDE;
    const dirs = c === VehicleCondition.INTACT ? m.dirs : this.wagon ? 2 : 4;
    if (dirs === 8) return base + octant(this.heading);
    return base + (((this.heading + 0x20) >> 6) & (dirs - 1));
  }
}
