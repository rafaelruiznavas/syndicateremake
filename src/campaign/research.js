// Investigación de mejoras y armas (SPEC §9.3, `0x35e20`, pantalla RESEARCH `0x34ad0`).

export const AVAILABLE = 0x960;               // 2400: investigado y a la venta
export const OPEN = 0;                        // investigable
export const LOCKED = -1;                     // bloqueado (0xFFFF) hasta completar su predecesor
export const CHART_POINTS = 240;              // 10 × 24 horas
export const FUNDING_MULTIPLIER = [1, 2, 4, 6, 10, 15, 30, 50, 75, 100];
export const PICKUP_BONUS = 600;              // arma nueva traída de una misión (§8.2)

/** Estado del proyecto en curso. */
export const Status = Object.freeze({ RUNNING: 0, COMPLETED: 1, IDLE: 2, NO_FUNDS: 3 });

const normalizeState = (v) => (v === 0xffff ? LOCKED : v);

/** Un elemento investigable (mejora o arma) con su gráfica de progreso. */
export class ResearchItem {
  constructor(kind, index, info, saved) {
    this.kind = kind;                          // 'mod' | 'weapon'
    this.index = index;                        // índice en su catálogo (0-based)
    this.info = info;
    this.state = saved?.state ?? normalizeState(info.researchInitial);
    this.chart = saved?.chart ?? [];           // progreso acumulado por hora
    this.discovered = saved?.discovered ?? !info.needsResearch;
  }
  get cost() { return this.info.researchCost; }
  get progress() { return this.chart.length ? this.chart[this.chart.length - 1] : 0; }
  get available() { return this.state === AVAILABLE; }
  get researchable() { return this.state >= 0 && this.state < 100; }
  /** Horas que faltan con la financiación L (`0x34ad0`, línea de previsión). */
  hoursLeft(level) { return level < 0 ? Infinity : Math.ceil((AVAILABLE - this.progress) / ((level + 1) * 10)); }
  toJSON() { return { state: this.state, chart: this.chart, discovered: this.discovered }; }
}

export class Research {
  constructor(modsCatalog, weaponsCatalog, saved) {
    this.mods = modsCatalog.map((m, i) => new ResearchItem('mod', i, m, saved?.mods?.[i]));
    this.weapons = weaponsCatalog.map((w, i) => new ResearchItem('weapon', i, w, saved?.weapons?.[i]));
    this.project = saved?.project ? this.item(saved.project.kind, saved.project.index) : null;
    this.status = saved?.status ?? Status.IDLE;
    this.funding = saved?.funding ?? -1;
    this.completed = [];                       // elementos completados pendientes de anunciar
  }

  item(kind, index) { return (kind === 'mod' ? this.mods : this.weapons)[index]; }
  weapon(type) { return this.weapons[type - 1]; }
  /** Lista RESEARCH: elementos investigables (`0x34ad0`). */
  researchable(kind) { return (kind === 'mod' ? this.mods : this.weapons).filter((it) => it.researchable && it.info.available !== false); }

  /** Elegir proyecto: conserva la gráfica del elemento y fija la financiación mínima. */
  select(item) {
    if (!item.researchable) return false;
    this.project = item;
    this.status = Status.RUNNING;
    this.funding = 0;
    return true;
  }

  /** FUNDING + / −: de −1 (sin financiar) a 9. */
  changeFunding(delta) {
    if (!this.project) return;
    this.funding = Math.max(-1, Math.min(FUNDING_MULTIPLIER.length - 1, this.funding + delta));
  }

  /** Coste por hora con la financiación actual. */
  hourlyCost() { return this.project && this.funding >= 0 ? this.project.cost * FUNDING_MULTIPLIER[this.funding] : 0; }

  /** Añade un punto a la gráfica; completa el elemento al llegar a 2400. */
  addProgress(item, amount) {
    if (item.chart.length >= CHART_POINTS) return false;
    item.chart.push(item.progress + amount);
    if (item.progress >= AVAILABLE) { this.#complete(item); return true; }
    return false;
  }

  #complete(item) {
    item.state = AVAILABLE;
    item.discovered = true;
    const list = item.kind === 'mod' ? this.mods : this.weapons;
    const next = list[item.info.next];
    if (item.info.next && next?.state === LOCKED) next.state = OPEN;
    this.completed.push(item);
    if (item === this.project) this.#finish();
  }

  /** Fin del proyecto (`0x36190`): sin proyecto, financiación −1. */
  #finish() {
    this.project = null;
    this.status = Status.IDLE;
    this.funding = -1;
  }

  /**
   * Paso horario (`0x35e20`): cobra la hora y avanza la gráfica.
   * @param {{funds: number}} bank objeto con los fondos del jugador
   */
  hour(bank) {
    if (this.status !== Status.RUNNING && this.status !== Status.NO_FUNDS) return;
    if (!this.project) { this.status = Status.IDLE; return; }
    if (this.funding < 0) { this.status = Status.RUNNING; return; }
    const cost = this.hourlyCost();
    if (cost > bank.funds) { this.status = Status.NO_FUNDS; return; }
    bank.funds -= cost;
    this.status = Status.RUNNING;
    this.addProgress(this.project, (this.funding + 1) * 10);
  }

  /** Arma «no descubierta» traída de una misión (§8.2). Devuelve true si se entrega. */
  submitWeapon(type) {
    const it = this.weapon(type);
    if (!it || it.discovered || !(it.state === LOCKED || it.state === OPEN)) return false;
    it.discovered = true;
    it.state = OPEN;
    this.addProgress(it, PICKUP_BONUS);
    return true;
  }

  toJSON() {
    return {
      mods: this.mods.map((m) => m.toJSON()), weapons: this.weapons.map((w) => w.toJSON()),
      project: this.project ? { kind: this.project.kind, index: this.project.index } : null,
      status: this.status, funding: this.funding,
    };
  }
}
