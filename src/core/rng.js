// Generador congruencial de 16 bits (SPEC §10): seed = seed·0x24A1 + 0x24DF; rng(n) = seed mod n.
// La semilla inicial de cada misión viene del propio nivel (campo `seed` de GAMEnn).

export class Rng16 {
  constructor(seed = 0) { this.seed = seed & 0xffff; }
  next() {
    this.seed = (Math.imul(this.seed, 0x24a1) + 0x24df) & 0xffff;
    return this.seed;
  }
  /** Entero en [0, n). */
  int(n) { return n > 0 ? this.next() % n : 0; }
}
