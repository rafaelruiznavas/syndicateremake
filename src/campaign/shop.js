// Compra de mejoras y equipo, recarga y venta (SPEC §9.2, §9.2b). Todas las operaciones
// devuelven true si se han realizado.

import { MAX_ITEMS, withMod, modLevel } from './roster.js';

const SELL_PARTIAL_PERCENT = 25;

export class Shop {
  /** @param {{funds:number}} bank  @param {object[]} weapons weapons.json  @param {object[]} mods mods.json */
  constructor(bank, weapons, mods, research) {
    this.bank = bank; this.weapons = weapons; this.mods = mods; this.research = research;
  }

  /** Mejoras a la venta: investigadas (estado 2400). */
  modsForSale() { return this.mods.filter((m, i) => this.research.mods[i].available); }
  /** Armas a la venta: investigadas y presentes en el catálogo. */
  weaponsForSale() { return this.weapons.filter((w, i) => w.available && this.research.weapons[i].available); }

  /** Compra de una mejora (`0x23120`): sustituye la versión de esa parte. */
  buyMod(agent, modIndex) {
    const m = this.mods[modIndex];
    if (!agent.alive || this.bank.funds < m.price) return false;
    if (modLevel(agent.mods, m.part) === m.version) return false;
    agent.mods = withMod(agent.mods, m.part, m.version);
    this.bank.funds -= m.price;
    return true;
  }

  /** Compra de un arma (`0x23370`) con la munición de catálogo. */
  buyWeapon(agent, type) {
    const w = this.weapons[type - 1];
    if (!agent.alive || this.bank.funds < w.price || agent.items.length >= MAX_ITEMS) return false;
    agent.items.push({ weapon: type, ammo: w.catalogAmmo });
    this.bank.funds -= w.price;
    return true;
  }

  /** Recarga de un objeto con los precios de catálogo. */
  reload(agent, slot) {
    const it = agent.items[slot];
    if (!it) return false;
    const w = this.weapons[it.weapon - 1];
    const cost = (w.catalogAmmo - it.ammo) * w.catalogReloadCost;
    if (it.ammo >= w.catalogAmmo || cost > this.bank.funds || !this.research.weapon(it.weapon).available) return false;
    this.bank.funds -= cost;
    it.ammo = w.catalogAmmo;
    return true;
  }

  /** Botón de recargar todo: tablas RECARGA[t] y MUNICIÓN_MÁX[t]. */
  reloadAll(agent) {
    let any = false;
    for (const it of agent.items) {
      const w = this.weapons[it.weapon - 1];
      const cost = w.reloadCostPerUnit * (w.maxAmmo - it.ammo);
      if (cost > this.bank.funds || it.ammo >= w.maxAmmo || !this.research.weapon(it.weapon).available) continue;
      this.bank.funds -= cost;
      it.ammo = w.maxAmmo;
      any = true;
    }
    return any;
  }

  /** Venta: precio completo si está lleno, 25 % si no; el inventario se compacta. */
  sell(agent, slot) {
    const it = agent.items[slot];
    if (!it) return false;
    const w = this.weapons[it.weapon - 1];
    this.bank.funds += it.ammo < w.maxAmmo ? Math.trunc((w.price * SELL_PARTIAL_PERCENT) / 100) : w.price;
    agent.items.splice(slot, 1);
    return true;
  }
}
