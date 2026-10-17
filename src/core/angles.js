// Direcciones de 256 pasos por vuelta (SPEC §4): 0 = +Y, 64 = +X, 128 = −Y, 192 = −X.
// Las tablas son 256·sin y 256·cos redondeados; coinciden con las del original en las
// muestras documentadas (0, 181, 256…).

export const DIR_X = new Int16Array(256);
export const DIR_Y = new Int16Array(256);
for (let d = 0; d < 256; d++) {
  DIR_X[d] = Math.round(Math.sin((d * Math.PI) / 128) * 256);
  DIR_Y[d] = Math.round(Math.cos((d * Math.PI) / 128) * 256);
}

/** Dirección (0..255) del vector (dx, dy). */
export function directionTo(dx, dy) {
  return (Math.round((Math.atan2(dx, dy) * 128) / Math.PI) + 256) & 255;
}

/** Octante de animación (0..7) para una orientación, como lo cuantiza el original. */
export function octant(facing) {
  return ((facing + 0x10) >> 5) & 7;
}

/** Distancia horizontal entera. */
export function distance(dx, dy) {
  return Math.floor(Math.hypot(dx, dy));
}
