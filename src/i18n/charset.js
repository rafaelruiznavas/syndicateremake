// Juego de caracteres de las fuentes del original: los textos extraídos guardan los bytes
// CP437 como códigos 0..255 (é = 0x82…), y el glifo de un carácter es `base + código − 0x20`
// (SPEC §12.1). Las fuentes de menú tienen glifos hasta 0xA8, pero las vocales acentuadas
// tienen forma de minúscula (en el título, «Ú» parece una «o»): como hacen los textos
// franceses del original (SOCIETE, DETAIL), las mayúsculas acentuadas se escriben sin acento.
// La Ñ (0xA5) sí se lee bien en todas. La fuente de misión HFNT01 solo tiene ASCII.

const TO_CP437 = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, ü: 0x81, Ñ: 0xa5, '¿': 0xa8,
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U',
};
/** Signos sin glifo en las fuentes (CP437 0xAD queda fuera del rango). */
const DROPPED = new Set(['¡']);

/** Texto Unicode → códigos CP437 que entienden las fuentes del juego. */
export function toGameCharset(str) {
  let out = '';
  for (const ch of str) {
    if (DROPPED.has(ch)) continue;
    const t = TO_CP437[ch];
    out += t === undefined ? ch : typeof t === 'string' ? t : String.fromCharCode(t);
  }
  return out;
}

const FOLD = new Map([
  [0x80, 'C'], [0x81, 'U'], [0x82, 'E'], [0x83, 'A'], [0x84, 'A'], [0x85, 'A'], [0x86, 'A'], [0x87, 'C'],
  [0x88, 'E'], [0x89, 'E'], [0x8a, 'E'], [0x8b, 'I'], [0x8c, 'I'], [0x8d, 'I'], [0x8e, 'A'], [0x8f, 'A'],
  [0x90, 'E'], [0x93, 'O'], [0x94, 'O'], [0x95, 'O'], [0x96, 'U'], [0x97, 'U'], [0x99, 'O'], [0x9a, 'U'],
  [0xa0, 'A'], [0xa1, 'I'], [0xa2, 'O'], [0xa3, 'U'], [0xa4, 'N'], [0xa5, 'N'], [0xa8, '?'],
]);

/** Códigos CP437 acentuados → letra ASCII sin acento (para HFNT01). */
export function foldToAscii(str) {
  let out = '';
  for (const ch of str) {
    const c = ch.charCodeAt(0);
    out += c > 0x7e ? FOLD.get(c) ?? '' : ch;
  }
  return out;
}
