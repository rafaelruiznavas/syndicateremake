// Reloj de la campaña (SPEC §9.4, `0x18810`): un contador que avanza una unidad por
// fotograma de pantalla (día de 4032) o por ciclo de misión (día de 1008).

export const SCREEN_DAY = 0xfc0;
export const MISSION_DAY = 0x3f0;
export const DAYS_PER_YEAR = 365;

export class Clock {
  constructor({ counter = 0, day = 1, year = 85, hour = 0 } = {}) {
    this.counter = counter;
    this.day = day;
    this.year = year;
    this.hour = hour;
  }

  /**
   * Avanza una unidad con la duración de día indicada.
   * @returns {{hourChanged: boolean, dayPassed: boolean}}
   */
  tick(dayLength) {
    const hour = Math.floor(this.counter / Math.floor(dayLength / 24)) & 0xff;
    const hourChanged = hour !== this.hour;
    this.hour = hour;
    if (this.counter >= dayLength - 1) {
      this.counter -= dayLength - 1;
      this.day++;
      if (this.day > DAYS_PER_YEAR) { this.day = 1; this.year++; }
      return { hourChanged, dayPassed: true };
    }
    this.counter++;
    return { hourChanged, dayPassed: false };
  }

  /** Paso de escala al empezar una misión (CRYO, `0x1fbc0`): contador / 3. */
  enterMission() { this.counter = Math.floor(this.counter / 3); }
  /** Paso de escala al entrar en el informe (`0x18ff0`): contador × 4. */
  leaveMission() { this.counter *= 4; }

  toJSON() { return { counter: this.counter, day: this.day, year: this.year, hour: this.hour }; }
}
