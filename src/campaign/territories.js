// Territorios del mapa mundial: propiedad, impuestos, descontento, población, expansión
// de los sindicatos rivales y territorios elegibles (SPEC §9.4).

export const PLAYER = 0;
export const SYNDICATES = 8;
export const REBELLION = 0xff;
const CUT_INCOME_DISCONTENT = 160;
const NEUTRAL_TAX = 30;
const MAX_TAX = 100;
const FIRST_MISSION = 1;

export class Territory {
  constructor(info, state = {}) {
    this.info = info;                          // datos estáticos: nombre, misión, vecinos, rectángulo
    this.owner = state.owner ?? 1;
    this.discontent = state.discontent ?? 0;
    this.tax = state.tax ?? NEUTRAL_TAX;
    this.nextTax = state.nextTax ?? NEUTRAL_TAX;
    this.population = state.population ?? 0;
  }
  get id() { return this.info.id; }
  get mission() { return this.info.mission; }
  get rebel() { return this.discontent === REBELLION; }
  toJSON() { return { owner: this.owner, discontent: this.discontent, tax: this.tax, nextTax: this.nextTax, population: this.population }; }
}

export class Territories {
  /** @param {object[]} infos territories.json  @param {object[]} [states] */
  constructor(infos, states) {
    this.list = infos.map((info, i) => new Territory(info, states?.[i]));
    this.current = 0;                          // territorio de la última misión elegida
    this.lastCaptures = [];                    // conquistas de los rivales del último día
  }

  get(i) { return this.list[i]; }
  ownedBy(s) { return this.list.filter((t) => t.owner === s); }

  /** Partida nueva (`0x23880`). */
  reset(rng) {
    for (const t of this.list) {
      t.owner = rng.int(7) + 1;
      t.discontent = 0;
      t.population = (rng.int(20) + 40) * 1_000_000;
      t.tax = NEUTRAL_TAX;
      t.nextTax = NEUTRAL_TAX;
    }
  }

  /** Propietario del territorio con índice i, como lo lee el original (fuera de rango = rival). */
  #ownerAt(i) { return this.list[i]?.owner ?? -1; }

  /** Descontento diario (`0x18bd0`). */
  updateDiscontent(t) {
    if (t.owner === PLAYER) {
      // [OBS] El original lee el propietario del índice `vecino` en lugar de `vecino − 1`
      // (un territorio más allá del vecino real); se conserva ese comportamiento.
      for (const n of t.info.neighbors) if (this.#ownerAt(n + 1) !== PLAYER) t.discontent += 2;
    }
    t.discontent += Math.trunc((t.tax - NEUTRAL_TAX) / 2);
    if (t.discontent >= 31) t.discontent -= 2;
    else if (t.discontent < 30) t.discontent += 2;
    t.discontent = Math.max(0, Math.min(255, t.discontent));
  }

  /** Ingreso diario (`0x18cf0`): depende del descontento del territorio *actual*. */
  income(t) {
    if (t.owner !== PLAYER || this.list[this.current].discontent >= CUT_INCOME_DISCONTENT) return 0;
    const credits = Math.trunc((Math.trunc(t.population / 1_000_000) * 14 * t.tax) / 10);
    t.tax = t.nextTax;
    return credits;
  }

  /** Un día para los 50 territorios; devuelve los créditos ingresados. */
  daily(rng) {
    let credits = 0;
    for (const t of this.list) {
      this.updateDiscontent(t);
      credits += this.income(t);
      t.population += 500 - rng.int(1000);
    }
    this.expandRivals(rng);
    return credits;
  }

  /** k-ésimo territorio (desde 1, en orden) del sindicato s (`0x18ef0`). */
  #nthOwned(k, s) {
    let i = -1;
    while (k > 0) { i = (i + 1) % this.list.length; if (this.list[i].owner === s) k--; }
    return this.list[i];
  }

  /** Expansión diaria de los sindicatos rivales (`0x18d80`). */
  expandRivals(rng) {
    this.lastCaptures = [];
    for (let s = 0; s < SYNDICATES; s++) {
      if (s === PLAYER) continue;
      const count = this.ownedBy(s).length;
      if (count === this.list.length) return;
      if (count === 0) continue;
      const from = this.#nthOwned(count === 1 ? 1 : rng.int(count - 1) + 1, s);
      for (const n of from.info.neighbors) {
        const target = this.list[n];
        if (target.owner === s) continue;
        if (target.owner !== PLAYER && rng.int(100) < 50) {
          target.owner = s;
          this.lastCaptures.push({ syndicate: s, territory: n });
        }
        break;
      }
    }
  }

  /** ¿Se puede elegir como misión? (`0x28d60`) */
  eligible(i, { cheat = false } = {}) {
    if (cheat) return true;
    const t = this.list[i];
    if (t.owner === PLAYER && !t.rebel) return false;
    if (t.mission === FIRST_MISSION || t.rebel) return true;
    return this.list.some((o) => o.owner === PLAYER && !o.rebel && o.info.neighbors.includes(i));
  }

  /** Cambia el impuesto siguiente (`0x28fe0`); solo en territorios propios sin rebelión. */
  changeTax(i, delta) {
    const t = this.list[i];
    if (t.owner !== PLAYER || t.rebel) return false;
    t.nextTax = Math.max(0, Math.min(MAX_TAX, t.nextTax + delta));
    return true;
  }

  /** Misión completada en el territorio actual (`0x37f80`). Devuelve true si se ha ganado la partida. */
  conquer(i) {
    const t = this.list[i];
    if (t.rebel && t.owner === PLAYER) t.discontent = 170;
    else { t.discontent = 0; t.owner = PLAYER; }
    t.tax = NEUTRAL_TAX;
    t.nextTax = NEUTRAL_TAX;
    return this.list.every((o) => o.owner === PLAYER && o.discontent < REBELLION);
  }

  toJSON() { return { current: this.current, list: this.list.map((t) => t.toJSON()) }; }
}
