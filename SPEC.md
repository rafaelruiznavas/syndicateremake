# Syndicate (Bullfrog, 1993) — especificación para la reimplementación

Versión 0.1 · 17‑oct‑2026 · Fase 2 (especificación). Aún no hay código.

Este documento describe el juego como **reglas y valores**, no como código. La reimplementación (`remake/`) se escribe desde cero con clases, máquinas de estados y un bucle con *delta time*. No incluye intérprete, emulador ni código traducido.

## Convenciones

**Etiquetas de certeza**

- **[OBS]**: observado directamente en el binario (pseudocódigo, bytes, tablas).
- **[INF]**: inferido; varias observaciones convergen.
- **[DES]**: desconocido o pendiente; se indica cómo resolverlo.
- **[DIS]**: decisión de diseño del remake, sin origen en el binario.

**Evidencia**

- `REA ev_…`: resultado de REA de este proyecto. Para que REA admita el LE, la imagen se reempaquetó como PE con las mismas direcciones (`tools/le2flat.py`, `tools/flat2pe.py`).
- `GH:<doc>`: análisis previo con Ghidra en `analysis/main/<doc>.md`.

**Unidades y direcciones**

- Las direcciones son VA de la imagen LE de `MAIN.EXE`.
- **Ciclo** = una iteración lógica del bucle de misión. **Tick** = interrupción del temporizador (72,83 Hz).
- Distancias: 256 u por casilla horizontal y 128 u por nivel vertical.

---

## 1. Reconocimiento

| Elemento | Hallazgo | Evidencia |
|---|---|---|
| `SYND.EXE` | Lanzador/configurador. Escribe `main /c%d /s` (o `smain…`) en `c:/synd/synd.inf` | [OBS] REA ev_3a4d8138 (`FUN_00010da3`) |
| Juego | `SYNDICAT\MAIN.EXE`: MZ+LE, DOS/4GW, Watcom C/C++32 | [OBS] cabecera LE en `0x3c→0x28b8`; cadenas del runtime |
| Plataforma | DOS en modo protegido. Menús en VGA 13h (320×200×256); misión en 12h (640×480×16, área útil 640×400 en las filas 40–439) | [OBS] INT 10h y copia `0x37e90`; [OBS] render planar `0x4c797` |
| Bucle principal | `0x101e0`: menús (`0x37600`) ↔ misión (bucle interior) ↔ informe | [OBS] GH:controls-logic-findings |
| Ciclo de misión | `0x2c880` entrada → `0x25560` órdenes → `0x15b10` IA de agentes → `0x29250` mundo → `0x27db0` → `0x10010` música → `0x18810` reloj y limitador → `0x105e0` objetivos → render | [OBS] pseudocódigo de `0x101e0` |
| Mundo | `0x29250` = `0x292d0`, `0x34110` (personas), `0x3a970` (objetos y armas), `0x1eb80` (efectos y disparos), `0x2b940`, `0x39890` (vehículos, §7.4) | [OBS] |
| Entrada | Teclado por IRQ1 (tabla `0x5e284[scan]`); ratón por callback INT 33h `0x2b290` | [OBS] |
| Render | Proyección y orden por x+y en `0x1d450`; panel en `0x2d0e0`; cursor en `0x4165e` | [OBS] GH:graphics-findings |
| Sonido | Sin `/s`: SFX `SOUND-0.DAT/.TAB`, música XMI `SYNGAME.XMI` con `GAMEFM.DLL` o `GAMEDG.DLL` | [OBS] cadenas `data/syngame.xmi`, `data/gamefm.dll` |
| Niveles | `GAMEnn.DAT` (estado del mundo, 116 010 B, RNC) + `MAPnn.DAT` (128×96×12 casillas) + `COL01.DAT` (clase por tile) + `MISSnn.DAT` (texto del briefing) | [OBS] cargador `0x252b0`, tabla `0x53f08` |
| Compresión | RNC ProPack método 1 (firma `RNC\x01`) | [OBS] `0x3caa4` |

---

## 2. Tiempo y bucle

| Regla | Valor | Evidencia |
|---|---|---|
| Frecuencia del temporizador | 1 193 182 / 16 384 = **72,83 Hz** | [OBS] `0x27af0`: `out 0x43,0x36; out 0x40,0x00; out 0x40,0x40` |
| Limitador de ciclo | Espera a que `ticks ≥ n`, luego `ticks = 0`. `n` empieza en **7** | [OBS] REA ev_51d909bd (`0x18810`); `0x237b0` pone `0x55304 = 7` |
| Ciclos por segundo (n=7) | 72,83/7 ≈ **10,4 ciclos/s** (96,1 ms) | [INF] |
| Velocidad del juego (F3/F4) | F3 resta 1 a `n` y F4 suma 1, con `n` entre 0 y 12. Si `n ≤ 2` no hay espera | [OBS] `0x18810` |
| Remake | Paso fijo de 96,1 ms por ciclo con acumulador de *delta time*; el multiplicador de velocidad cambia el periodo (n·1/72,83 s) | [DIS] |

---

## 3. Mundo, coordenadas y mapa

| Regla | Valor | Evidencia |
|---|---|---|
| Unidades | X e Y: 256 u por casilla. Z: 128 u por nivel | [OBS] REA ev_4663add3 (`0x125f0`) |
| Mapa | 128 de ancho × 96 de alto (Y módulo `0x6000`) × 12 niveles (Z < `0x601`) | [OBS] `0x125f0`; cabecera MAP `(128,96,12)` |
| Columna | `col[(ty·128+tx)]` apunta a 12 bytes, uno por nivel (id de tile 0..255) | [OBS] `0x235d0`, `0x125f0` |
| Clase de tile | `clase = COL01[tile]` (256 bytes) | [OBS] tabla de recursos `0x53f60 → 0x60ac0` |

**Altura de superficie** en (x,y) dentro del nivel de z. Llamamos `base = z & ~0x7f`, `fx = x & 255` y `fy = y & 255`. [OBS] REA ev_4663add3:

| Clase | Altura |
|---|---|
| 0 | vacío (sin suelo) |
| 1 | rampa: `base + (255−fy)/2` (sube hacia −Y) |
| 2 | rampa: `base + fy/2` (sube hacia +Y) |
| 3 | rampa: `base + fx/2` (sube hacia +X) |
| 4 | rampa: `base + (255−fx)/2` (sube hacia −X) |
| 5, 10, 13, 14 | suelo plano: `base + 128` |
| 0x0C | `base + 0x1000` (muro infranqueable) |
| 0x10 | depende de los objetos de la celda (puertas o vehículos de tipo 2, subtipos 5, 6, 9 y 10 → suelo plano) |
| resto ≤ 0x10 | `base + 0x100` (bloquea) |
| > 0x10 | no altera el valor anterior; tratar como «sin cambio» |

**Suelo bajo los pies** (`0x12340`, [OBS] REA ev_39a0229c):

1. Prueba la superficie en z+127; si no hay, en z−1; si no, en z−129.
2. Si tampoco hay, cae: `(z−129) & ~0x7f`, o `(z−128) & ~0x7f` si z−129 < 0.

Las clases 6–9 son las cuatro rampas orientadas según la dirección 0/0x40/0x80/0xC0 que usan las consultas de ruta. [OBS] REA ev_0c6e5c51 (`0x36c20`).

---

## 4. Movimiento

| Regla | Valor | Evidencia |
|---|---|---|
| Direcciones | 256 por vuelta. 0 = +Y; 64 = +X. `DIR_X[d] = round(256·sin(2πd/256))`, `DIR_Y[d] = round(256·cos(…))`. Muestras: 0, 181, 256, 181, 0, −181… | [OBS] tablas `0x5ab60` y `0x5ad60` |
| Paso | `nx = x + (DIR_X[d]·v >> 8)`, `ny = y + (DIR_Y[d]·v >> 8)`, con `v` en u/ciclo | [OBS] REA ev_5415834b (`0x2ff80`) |
| Aceptación del paso | `h = suelo(nx,ny,z)`; `dz = h − z`. Se acepta si `dz ≤ 32` y (`dz ≥ −32` o el bit `+0x0b & 2` permite caer). Si se acepta, `z += dz` | [OBS] REA ev_7b75da03 (`0x2fd20`), ev_c53f8b55 (`0x2fc70`) |
| Desvío si se bloquea | Rutina `0x307b0`: se elige seguir la pared por la izquierda (estado 0xE) o por la derecha (0xF) simulando ambas 32 pasos (§7.5) | [OBS] REA (`0x307b0`, `0x30cc0`, `0x32930`) |
| Velocidad base de los agentes | Piernas (bits 1–2 de las mejoras): 0→40, V1→48, V2→56, V3→64 u/ciclo (`+0x55/+0x56`) | [OBS] `0x24c80` (`switch((m&6)>>1)`) |
| Escala por adrenalina | `v' = v·(b49−b48)/(255−b48)` si b49 ≥ b48; `v·(b49−b48)/b48` si es menor; 0 si son iguales | [OBS] REA ev_dfd2b2d7 (`0x30120`) |
| Mínimo | Peatones: `max(12, v')`. Agentes (flags `0x1002`): `max(16, v')` | [OBS] REA ev_07b8a126 (`0x30180`) |
| Carga (agentes) | `cap = brazos·10000 + 1000 − peso`. Si `cap < 0`: `base = max(16, base·(1000−|cap|)/1000)`. Peso = suma de la tabla `0x5a7b4` por tipo de objeto | [OBS] `0x30180`, `0x39fb0` (GH) |
| Velocidad observada | Agente sin mejoras con la adrenalina por defecto: **16 u/ciclo** (≈ 6,5 casillas/s) | [OBS] ejecución del original en sesión previa |
| Sentido de la adrenalina | `b48` y `b49` son el punto neutro y el nivel actual de la barra de adrenalina | [INF] |

---

## 5. Entidades

### 5.1 Personas (pool `0x88110`, 92 B cada una)

| Campo | Significado | Grado |
|---|---|---|
| `+4/+6/+8` | x, y, z (int16) | [OBS] |
| `+0x0a` bit 0 | oculta o inactiva (no se dibuja ni colisiona) | [OBS] `0x1d450` |
| `+0x0b` bit 0 | muerta (usado por objetivos y filtros) | [OBS] `0x105e0` |
| `+0x0b` bit 1 | puede descender más de 32 | [OBS] |
| `+0x0b` bit 4 | paseante: al terminar una acción vuelve al estado 0x1D (§7.1) | [OBS] `0x30250`, `0x33230` |
| `+0x10` | frame de animación | [OBS] `0x1d450` |
| `+0x14` | salud (int16): 16 llena, muerte con < 0 | [OBS] GH:vida-profundo |
| `+0x16` | índice de quien la ha matado | [OBS] REA ev_24ab4230 |
| `+0x18 / +0x19` | clase (1 = persona) / estado (switch hasta 0x2c) | [OBS] |
| `+0x1c` | tipo: 1 civil, 2 agente, 4 policía, 8 guardia, 0x10 criminal, 0x1000 jugador, 0x40 marcado agresivo | [OBS] REA ev_24ab4230 |
| `+0x1d` | bit 2: buscado por la policía; bit 4 (0x10): objetivo «persuadible»; bit 8: … | [OBS] / [DES] parcial |
| `+0x20` | índice de a quién sigue (persuadido) | [OBS] REA ev_242d3ca0 |
| `+0x3c` | palabra de mejoras (ver §9.2) | [OBS] |
| `+0x46` | ventana de disparo L (ver §7) | [OBS] GH:ARMAS |
| `+0x48/+0x49` | adrenalina: neutro y actual | [INF] |
| `+0x54/+0x55` | velocidad efectiva y base | [OBS] |

Grupos: cada sindicato ocupa 8 casillas consecutivas desde `0x5e551·0x5c`. El jugador usa las primeras 4 como agentes. [OBS] `0x24c80`, `0x105e0`.

### 5.2 Otros pools

| Pool | Tamaño | Uso | Grado |
|---|---|---|---|
| `0x91670` | 36 B | objetos y armas (tipo en `+0x19`, recurso o munición en `+0x14` signed) | [OBS] GH:ARMAS |
| `0x95e70` | 30 B, 256 casillas | disparos y efectos (estados `1d→1e→1f`…) | [OBS] GH:proyectiles-profundo |
| `0x8dd10` | 42 B | vehículos y otros | [INF] GH:vida-profundo |
| Listas espaciales | `0x8010e`: celdas de 256×256 (cabeza por celda, encadenado en `+0`) | | [OBS] `0x14620` |

### 5.3 Colisión entre entidades (AABB)

[OBS] REA ev_0cfe2e6c (`0x14620`). Se recorren las celdas de 256×256 que cubre la caja y se devuelve **el primer** registro que solapa. Se excluyen el propio registro y los que tienen `+0x0a` bit 0.

| Clase o subtipo | Semiextensión XY | Altura |
|---|---|---|
| 1 (persona) | ±0x20 | 0x100 |
| 2 (vehículo) | ±0x80 | 0x100 |
| 4 con subtipo 0x0C | ±0x40 | 0x100 |
| 5 con subtipo 1/0x19/0x1A | ±0x40 | 0x100 |
| 5 con subtipo 0x0B | ±0x20 | 400 |
| 5 con subtipo 0x0C | ±0x80 | 0x180 |
| 5 con subtipo 0x16 | ±0x40 | 0x170 |
| 5 con subtipo 0x1C/0x26/0x27/0x29 | ±0x80 | 0x100 |

La caja consultada usa la **mitad** de su extensión (división truncada); el recorrido de celdas usa la extensión completa. Las personas de un mismo grupo de 8 no colisionan entre sí si el que consulta es un agente.

### 5.4 Animación de personas

[OBS] REA ev_b4e0d037 (`0x1cd10`), resuelto en la fase 5:

- `+0x0e`: **conjunto de animación** (los agentes usan 1; los guardias de GAME01, 1744).
- `+0x1a`: **orientación** (0..255).
- `+0x12`: animación activa; solo se reinicia el frame (`+0x10 = HSTA[anim]`) si cambia.
- `oct = ((orientación + 0x10) >> 5) & 7`.
- `arma` = tipo del objeto equipado (`+0x44 → +0x19`), o 0 si no hay.

Índice de animación según el estado `+0x19`:

| Estados | Índice |
|---|---|
| 0, 1, 6, 7, 8, 0xB, 0xC, 0xD, 0x10, 0x1C, 0x22, 0x24, 0x26, 0x28, 0x29 (parado) | `conjunto + PARADO[arma] + oct` |
| 2–5, 0xE, 0xF, 0x1D–0x20, 0x25, 0x27 (andando) | `conjunto + ANDAR[arma] + oct` |
| 0x2B (disparando) | `conjunto + DISPARO[arma] + oct` |
| 9, 0xA | `conjunto + 0xC0` |
| 0x11 | `conjunto + 0xC5` |
| 0x12/13/15/16 | `conjunto + 0xC1 + (((orientación + 0xA0) >> 6) & 3)` |
| 0x14/17 | `0xD0 + (((orientación + 0x20) >> 6) & 1)` |
| 0x18, 0x1A | dependen del conjunto (ver fuente) |
| 0x19 | `0xD2` |
| 0x1B | `0xD3` |
| 0x21 | `conjunto + 0xC9` |
| 0x23 | `0x33C` |
| 0x2C | `0xEC` |

Tablas por arma (20 entradas): PARADO `0x5a546` / ANDAR `0x5a56e` / DISPARO `0x5a596`. Si el conjunto vale 1 se usan `0x5a5e6` / `0x5a60e` / `0x5a636`, que tienen gráficos distintos por arma. Se extraen a `data/person-animations.json`.

**Reteñido por sindicato** [OBS] `0x1d450`: en los agentes, los sprites 0x29..0x30 de cada elemento se sustituyen por `color·8 + 0x461 + k`, donde color es el del sindicato del grupo (0 para el jugador).

**Avance de frames:** cada ciclo `frame = HFRA[frame].next` (`0x29290`).

**Fin de animación** [OBS] `0x34110` y manejadores: una animación ha terminado cuando el frame alcanzado tras avanzar lleva la bandera `0x100` en sus flags (es el primer frame del ciclo). No se usa el bit 0, contra lo que se supuso en la fase 5.

---

### 5.5 Orden de pintado y oclusión

[OBS] REA (`0x1d450`, `0x43806`, `0x43933`).

1. Se pinta el mapa entero (de atrás adelante).
2. Se recogen las entidades visibles de las casillas de la vista y se ordenan (burbuja) por la clave `x + y`. Los estáticos de los subtipos 10, 0x12–0x15 y 0x20–0x25 usan `(x − 0x80) + (y − 0x80)`, así que se pintan antes.
3. Por cada entidad: se pinta su frame (con el reteñido de los agentes, §5.4) y se calcula el rectángulo que cubren sus elementos. Después (`0x43806`), si la entidad no tiene `+0x0a & 2` y la casilla de su posición no es un tile especial (3 o 4), se vuelven a pintar sobre ese rectángulo, por franjas de 16 px, los subtiles del mapa que quedan delante de ella. `0x43933` elige la variante según el triángulo de la casilla en el que está la entidad (`(x & 0xff) + (y & 0xff) > 0xff` y `(y & 0xff) ≤ (x & 0xff)`).

[DIS] `0x43933` es ensamblador con tablas de saltos por subtile; el remake usa una regla de cajas equivalente: un bloque se vuelve a pintar sobre la entidad si está por completo más cerca del observador en algún eje (más x, más y o más z que la caja de la entidad) y la entidad no lo está en ninguno. Cajas: personas ±0x20 y 0x100 de alto; vehículos ±0x80 y 0xC0; estáticos ±0x40 y 0x200; el resto ±0x20 y 0x80. Así, el bloque de una rampa que se pisa nunca tapa a quien está encima, y un coche no queda cortado por las casillas vecinas que invade.

### 5.6 Estáticos con estado: puertas y verjas

[OBS] REA (`0x2b940`, `0x15170`, `0x152e0`). Cada ciclo, después de las personas, los disparos y los efectos, se actualizan los estáticos según su subtipo (`+0x19`), que hace de estado. La animación de las puertas es `+0x0e` (base) + 2·paso + `((orientación + 0x20) >> 6) & 1`.

| Estado | Puerta (personas) | Verja (vehículos) |
|---|---|---|
| cerrada | 0x0C: si hay una persona visible a ±0x80 (más su ±0x20) en x e y y a la altura (`0x15170`), pasa a 0x0D | 0x26: si hay un vehículo visible en las 5×5 casillas que empiezan 2 casillas antes en x e y (`0x152e0`), pasa a 0x27 |
| abriéndose | 0x0D: al acabar la animación, 0x0E | 0x27: al acabar, 0x28 y se oculta (`+0x0a` |= 1) |
| abierta | 0x0E: si ya no hay nadie, 0x0F | 0x28: si ya no hay vehículo, 0x29 y vuelve a verse |
| cerrándose | 0x0F: al acabar, 0x0C y temporizador 0x28 | 0x29: al acabar, 0x26 y temporizador 0x28 |

Animaciones de las verjas: 0x18B/0x188 (cerrada), 0x18C/0x189 (abriéndose) y 0x18D/0x18A (cerrándose), según la orientación sea 0/0x80 u otra. Las puertas no bloquean el paso: la casilla de la puerta es libre en el mapa y el paso de las personas solo consulta el terreno (`0x2fd20`). [DES] Los demás estados de `0x2b940` (farolas que parpadean, objetos que se rompen) no se han implementado.

## 6. Combate

### 6.1 Armas (tipos 1–19)

Precio de compra: catálogo `0x57bf4 + (t−1)·0x1f5`, campo `+1` (int32). Un precio **negativo** significa «requiere investigación»; el valor absoluto es el precio. [OBS] volcado del catálogo.

| t | Nombre | Precio | Investigación | Munición (M+1) | Recarga por unidad | Alcance R | P | L | Emisión |
|---:|---|---:|---|---:|---:|---:|---:|---:|---|
| 1 | PERSUADERTRON | 5000 | no | 51 usos | 10 | 256 | 2 | 2 | estado 32 |
| 2 | PISTOL | 0 | no | 13 | 0 | 1280 | 0 | 2 | 1 traza |
| 3 | GAUSS GUN | 50000 | sí (625) | 3 | 15000 | 5120 | 0 | 2 | proyectil explosivo |
| 4 | SHOTGUN | 250 | no | 12 | 2 | 1024 | 0 | 2 | 7 trazas, consume 1 |
| 5 | UZI | 750 | sí (4) | 50 | 2 | 1792 | 1 | 2 | 1 traza |
| 6 | MINI-GUN | 10000 | sí (83) | 500 | 10 | 2816 (catálogo 2304) | 1 | 2 | 5 trazas |
| 7 | LASER | 35000 | sí (333) | 5 | 2000 | 4096 | 0 | 2 | rayo (hasta 8192 de recorrido) |
| 8 | FLAMER | 1500 | sí (10) | 1000 | 1 | 512 | 1 | 3 | 4 llamas |
| 9 | LONG RANGE | 1000 | sí (6) | 30 | 2 | 6144 | 0 | 2 | 1 traza |
| 10 | SCANNER | 500 | no | 20 (carga) | 1 | 4096 | 2 | 0 | servicio |
| 11 | MEDIKIT | 500 | no | 1 | 1 | 256 | 2 | 0 | salud a 16 |
| 12 | TIME BOMB | 25000 | sí (375) | 200 ciclos | 1 | 1000 | 2 | 0 | explosión de área |
| 13 | ACCESS CARD | 1000 | sí (83) | — | 1 | 256 | 2 | 0 | — |
| 16 | AUTO MAPPER | 100 | no (no disponible: `fe`) | — | 1 | 256 | 2 | 0 | — |
| 17 | ENERGY SHIELD | 8000 | sí (125) | 200 carga | 15 | 768 | 2 | 2 | consume 1/ciclo, regenera 1 cada 4 |
| 14, 15, 18, 19 | variantes `fe` (ACCESS CARD1/2, SHIELD1./2.) | | | | | | | | no disponibles [INF] |

Origen de cada columna:

- **Investigación:** el valor entre paréntesis es el campo `+0xd` del catálogo. [INF] Es el coste diario de investigación (§9.3).
- **P y L:** tablas `0x5a6ea` y `0x5a6fe`.
- **R:** tabla `0x5a6c2`.
- **M:** tabla `0x5a73a`.
- **Recarga:** tabla `0x5a712`.
- Las tablas y la columna de emisión vienen de GH:ARMAS.

Disparo:

- **P = 0** (semiautomática): requiere un clic derecho nuevo.
- **P = 1** (automática): repite mientras se mantiene el botón.
- **L** es la ventana de activación en ciclos: se decrementa en `0x34110` y el arma emite mientras L ≠ 0.
- **Munición:** el recurso 0 aún dispara; −1 significa agotada.

Trayectos [OBS] GH:ARMAS:

- **Balas:** `N = R >> 7` muestras con paso de 128.
- **Gauss:** 41 pasos de 120 + rng(23).
- **Láser:** 64 pasos de 128.
- **Lanzallamas:** 13 pasos de 38–48, con preavance de 0–3.

### 6.1b Disparo y trayectoria de las balas

[OBS] GH:proyectiles-profundo; REA ev_6956738d (`0x31ec0`, `0x33fb0`).

1. **Orden de disparar** (orden 8 o estado 0x1C) a (tx, ty, tz) → `0x31ec0`, si lleva un arma equipada con recurso ≥ 0:
   - `orientación = dir(tx−x, ty−y)`;
   - `inclinación = dir(tz − (z+0x80), distancia)`;
   - estado 0x2B y `L = tabla L[arma]`.
2. **Emisión** (`0x3a970`, tras actualizar a las personas): mientras L ≠ 0 se emiten trazas con `s = 15 − p(15)` (percepción) y `desvío = rng(s) − s/2` (si s > 0).
   - Escopeta: 7 trazas con abertura −3..3 y consume 1.
   - Minigun: 5 trazas y consume 5.
   - Resto de armas de bala: 1 traza que consume 1.
   - Se emite aunque no quede hueco en el pool de efectos.
3. **Traza** (`0x1eb80`, estado 0x1D → 0x1E en el mismo ciclo):
   - si el emisor es un agente del jugador, cuenta un **disparo**;
   - desde (x, y, z+0x80) avanza `R >> 7` pasos de 128 en (orientación + desvío, inclinación);
   - en cada paso: si el terreno es sólido (`0x12150`), retrocede y se detiene;
   - si una caja de 0x80 × 0x80 × 0x100, centrada en el punto y con base en z−0x80, toca a una persona (máscara `0x40`, `0x13870`), le aplica el impacto (§6.2) y se detiene, contando un **acierto** si el emisor es del jugador;
   - el destello final queda en el punto ±0x20 (`rng(0x40)`) con animación 0x17E.
4. **Cadencia:**
   - semiautomáticas (P = 0): el disparo dura la animación del estado 0x2B y requiere un clic nuevo;
   - automáticas (P = 1): repiten mientras se mantiene el botón (el estado se rearma cada ciclo).

[INF] Paso 3D: horizontal `h = DIR_Y[incl]·128 >> 8`, vertical `dz = DIR_X[incl]·128 >> 8`; después `x += DIR_X[orient]·h >> 8` e `y += DIR_Y[orient]·h >> 8`.

### 6.1c Elección automática de arma

[OBS] REA ev_ee985ca4 (`0x3a390`). Entre los objetos que lleva con recurso ≥ 0, para una distancia d, gana el arma de mayor rango que admita d:

| Arma | Rango | d máxima |
|---|---|---|
| GAUSS | 1 | ≤ 0x1400 |
| PISTOL | 4 | ≤ 0x500 |
| SHOTGUN | 5 | ≤ 0x400 |
| LONG RANGE | 5 | ≤ 0x1800 |
| FLAMER | 6 | ≤ 0x200 |
| UZI | 7 | ≤ 0x700 |
| MINI-GUN | 8 | ≤ 0x900 |
| LASER | 9 | ≤ 0x1000 |

Si ninguna admite d, se usa la equipada si tiene recurso.

### 6.2 Daño

[OBS] GH:ARMAS, GH:vida-profundo.

- Cada muestra que solapa a una persona puede restarle 1 de salud y añadir un evento por OR: `0x40` bala, `0x08` fuego, `0x10` láser, `0x80` explosión, `0x01` otro.
- Resistencia: `n = (mejoras & 0x60) >> 5` (pecho). Admite el impacto siempre si n=0; con `rng(2)==0` si n=1; con `rng(4)==0` si n=2; con `rng(6)==0` si n=3.
- Un ENERGY SHIELD equipado con carga ≥ 0 bloquea el impacto.

Handlers por evento:

| Evento | n=0 | n=1 | n=2 | n=3 |
|---|---|---|---|---|
| `80` explosión | muerte (−1) | muerte | −8 | −4 |
| `08` fuego | muerte | −8 | −4 | −2 |
| `40` bala | sin resta extra | | | |
| `01` | muerte | muerte | −8 | −4 |
| `10` láser | muerte | muerte | −8 | −4 |

- **Prioridad** de eventos en el mismo ciclo: 80 > 08 > 40 > 01 > 10 > 400 (persuasión).
- **Caída:** un desnivel < −64 resta 1 adicional (`0x32dc0`).
- **Vehículos** (`0x2b6f0`): `08:−5`, `01:−20`, `10:−70`, `80:−110`.
- **Otros objetos** (`0x395d0`): `08:−10`, `10/80:−300`.

### 6.3 Regeneración

Solo para agentes (`+0x1c & 2`) con 0 ≤ salud < 16. [OBS] GH:vida-profundo.

- Nivel 1 de corazón: +1 cuando `(contador & 0x7f) == 0`.
- Nivel 2: cuando `& 0x3f == 0`.
- Nivel 3: cuando `& 0x1f == 0`.
- Sin corazón: no regenera.

[DES] El campo exacto del nivel y el contador; GH indica `word3c & 0x60`, que es el mismo campo que el pecho. Hay que verificarlo en la fase 5.

### 6.4 Persuasión

[OBS] REA ev_ee985ca4 (`0x302a0`), ev_19470b7b (`0x30600`).

**Activación** [OBS] REA ev_fd42a25e (`0x3a970`, arma 1) y ev_105a908c (`0x1eb80`, efecto 0x32): el PERSUADERTRON es **pasivo**. Cada ciclo en que está equipado, con recurso ≥ 0 y su portador **no** está disparando (L = 0), crea en la posición del portador un efecto 0x32 que dura un ciclo; dispararlo no hace nada y no gasta recurso. El efecto marca el evento `0x400` (con `+0x16` = persuasor) en una rejilla de cajas de 0x100³ con base en z, centradas desde −n·0x80 hasta +n·0x80 en x e y con paso 0x100, donde n = nivel de los ojos del portador (`+0x3c & 0x1800`, 0..3). El alcance es ±0x80·(n+1), más el margen de ±0x20 de cada persona.

**Admisión.** Cuenta los seguidores vivos del grupo del persuasor (cuyo `+0x20` apunta a ese grupo) con estos pesos: agente 5, policía 2, guardia 2, criminal 1, civil 1. Sea `P = suma·(cerebro+1)+1`, con cerebro = bits 9–10 de las mejoras del persuasor.

| Objetivo | Se convierte si |
|---|---|
| civil | siempre |
| criminal | P > 1 |
| guardia | P > 3 |
| policía | P > 7 |
| agente | `P > 31` y P mayor que la cuenta equivalente del grupo del objetivo, usando su cerebro y los pesos 5/4/3/2/1 para agente/policía/guardia/criminal/civil |

**Efecto:** el persuadido sigue al persuasor (`+0x20`), siguiente estado 0x1E y estado 0x2C; suena el sonido 0xE.

**Recompensa al completar la misión** (`0x246d0`, REA ev_242d3ca0):

- civil +50 créditos;
- guardia +150;
- policía +150;
- criminal +300;
- agente: se une a la plantilla («NEW AGENTS GAINED»).

Todo persuadido suma 1 a «PEOPLE PERSUADED».

### 6.5 Muertes y reacción

[OBS] REA ev_24ab4230 (`0x315e0`). Solo cuenta si el asesino es un agente del jugador:

- civil → `CIVILIANS KILLED`;
- agente → `ENEMY AGENTS KILLED`, o `0x60afa` si era propio;
- criminal → `CRIMINALS`;
- policía → `POLICE`;
- guardia → `GUARDS`.

Si el asesino es civil, agente o criminal, hay una reacción:

- si la víctima es policía y el asesino no, el asesino queda **buscado** (`+0x1d |= 2`);
- en otro caso queda **marcado** (`+0x1a |= 0x40`).

---

## 7. IA

| Comportamiento | Regla | Evidencia |
|---|---|---|
| Agentes enemigos | Planificador periódico `0x15b10` sobre registros de 20 B por grupo; máquina de estados `0x15c60` que emite **las mismas órdenes que el jugador** | [OBS] GH:controls-logic; `syndicatejs/src/logic/enemies.js` (análisis) |
| Adquisición de blanco | Candidatos a distancia < `0xE00` de grupo distinto, con flags `& 0x11`, arma válida y distancia < alcance ajustado (`0x30060`) y línea de tiro libre (`0x30eb0`) → estado 0x1C, orientación y disparo | [OBS] GH:trazados-profundo (`0x31830`) |
| Ataque a blanco | Si distancia ≥ 80 y está en alcance: dispara (`0x31ec0`). Si no y distancia ≥ 300: se acerca | [OBS] GH:trazados (`0x337b0`) |
| Línea de tiro | Muestras a lo largo del segmento; terreno con `0x12150`; entidades con `0x14620`; devuelve el primer obstáculo | [OBS] GH:trazados |
| Visión | No hay cono ni niebla de guerra; solo obstrucción geométrica | [OBS] GH:HIPOTESIS |
| Policía | Ataca a los agentes buscados (`+0x1d & 2`) | [INF] por `0x315e0` + filtros de adquisición |
| Civiles y policías de calle | Pasean (estado 0x1D, abajo) y esperan el tren en los andenes (0x29); los civiles huyen de quien va armado (§7.2) | [OBS] REA ev_78712774 (`0x33230`, `0x33e60`); los niveles guardan 4714 personas visibles en 0x1D y ~700 en 0xE/0xF a mitad de un desvío de paseo |
| Escenarios (rutas y guiones) | Cada persona tiene `+0x28` (inicio) y `+0x26` (actual), que apuntan a registros de 8 B en `0x97c70`: `next` (u16; 0 = volver al inicio), `target` (u16), `x, y, z` (bytes; destino = x·128+64, y·128+64, z·128), `type`. Tipos: 1 ir a punto (estado 3); 2 subir al vehículo `target` si aún no va en uno (estado 5→6); 3 bajar del vehículo (estado 7); 4 matar a `target` (0xC); 5 estado 0xD con `target` [INF: persuadir/seguir]; 6 ir hacia `target` (estado 5→5), conduciendo si va en vehículo; 7 **la misión fracasa**; 8 esperar a que un agente entre en la zona de 5×7 casillas que empieza en (x/2, y/2) a la altura z·128 (estado 0x28); 9 fin del guion (0x1D); 10 esperar 50 ciclos (0x2A); 11 **la misión se completa** | [OBS] REA ev_b01d8225 (`0x31fc0`) |
| Sindicatos rivales en el mapa del mundo | Cada día, por cada rival, `0x18eb0` decide; elige un territorio propio al azar y ataca vecinos no suyos ni del jugador con probabilidad 50 % (`rng(100) < 50`) | [OBS] REA ev_94942848 (`0x18d80`) |

### 7.1 Ciclo de una persona

[OBS] REA ev_ece8b320 (`0x34110`).

Cada ciclo, primero corre `0x31830`: la percepción, que procesa 8 personas por ciclo en orden circular. Después, para cada persona activa:

1. `0x31340`: reacciones del terreno. Sobre las clases 6–9 y 0x0B entra en el estado 0x27 (deslizarse por la rampa, hacia el lado libre). Sobre la clase 10 entra en el estado 0x21 con salud −1 (muerte).
2. Solo agentes: `0x2fae0`, regeneración de salud y de barras (§6.3, §9.2).
3. El manejador del estado `+0x19` (tabla siguiente).
4. `0x31df0`: si es agente, policía o guardia (`+0x1c & 0xE`), está vivo y no persuadido, entra en la **lista de visibles** con estas banderas:
   - `1`: arma armada, según la tabla `0x5a686` (`data/weapon-armed.json`);
   - `8`: está disparando (L ≠ 0);
   - `0x10`: es agente;
   - `0x20`: es objetivo marcado (`+0x1d & 0x10`).
5. Decremento de la ventana L (`+0x46`). En los agentes, si `0x3a100` lo indica, L = 0.
6. Si el estado no fijó la animación, se recalcula (§5.4).

**Resolutor de eventos** (`0x30600`), que llaman casi todos los estados:

- Si `+0x0C` ≠ 0, se borra y se devuelve el primer estado aplicable por prioridad: `0x80`→0x15, `0x08`→0x14, `0x40`→0x12, `0x01`→0x13, `0x10`→0x11.
- Con `0x400` (persuasión), si `0x302a0` lo admite: sigue a `+0x16`, siguiente estado 0x1E y estado 0x2C.
- En otro caso conserva el estado.

**Siguiente estado** (`0x30250`) al acabar una acción:

- si `+0x58` está vacío o coincide con el actual: 0x1E si sigue a alguien; si no, 0x1D si `+0x0b & 0x10`; si no, 1 si tiene escenario; si no, 0;
- después, `estado = +0x58`.

| Estado | Manejador | Significado (grado) |
|---|---|---|
| 0 | `0x31f60` | quieto: anima y resuelve eventos [OBS] |
| 1 | `0x31fc0` | ejecutar el siguiente paso de escenario (tabla de escenarios abajo) [OBS] |
| 2, 3 | `0x32130` | andar hacia el destino; dentro de un vehículo, conducir (`0x37110`); si bloqueado, desvío (`0x307b0`) [OBS] |
| 4, 5 | `0x321c0` | ir hacia la entidad `+0x2c`; si es un vehículo y está a < 0x80, termina; si la persona ya va en un vehículo, lo conduce hacia ella (§7.4) [OBS] |
| 6 | `0x32300` | subir al vehículo `+0x2c` (§7.4) [OBS] |
| 7 | `0x32480` | bajar del vehículo (§7.4) [OBS] |
| 8 | `0x32560` | dentro del vehículo (§7.4) [OBS] |
| 9 | `0x32720` | recoger el objeto `+0x2c` si está en su misma posición (|dz| ≤ 0x80): pasa al inventario y se oculta; si no, estado 5 con siguiente 9 [OBS] |
| 0xE, 0xF | `0x32930`, `0x32aa0` | seguir la pared por la izquierda o la derecha (§7.5) [OBS] |
| 0xC | `0x32890` | ir hacia la persona `+0x2c`; al estar en su casilla → 0xD [OBS] |
| 0xD | `0x328e0` | junto al objetivo (persuadir o matar) [INF] |
| 0x11–0x16 | `0x32fc0`, `0x32f00`, `0x32f60`, `0x32ce0`, `0x32ea0`, `0x32dc0` | reacciones al daño (§6.2) [OBS] |
| 0x17 | `0x32c10` | arder o tambalearse: cada ciclo gira `rng(15)−7`, adrenalina +6, anda; al agotar el contador → 0x19 si la salud es < 0 [OBS] REA ev_ee985ca4 |
| 0x18 | `0x33050` | morir (suelta los objetos, `0x3a1d0`); al acabar la animación → 0x1A y se registra la baja (`0x315e0`) [OBS] |
| 0x19 | `0x33090` | morir quemado; al acabar → 0x1B, temporizador 100, registro de la baja [OBS] |
| 0x1A, 0x1B | `0x330d0`, `0x330f0` | cadáver [INF] |
| 0x1C | `0x33120` | apuntar: busca un blanco a su alcance con línea de tiro (`0x316d0`); si lo hay, dispara (`0x31ec0`, a z+0x80); cuenta atrás `+0x42` y después `0x30250` [OBS] |
| 0x1D | `0x33230` | **pasear**: paso de 0x10 en la orientación (sin escalar por adrenalina); si choca, desvío corto de 10 ciclos (`0x306d0`, que mide hacia el destino guardado `+0x2e/+0x30`, (0, 0) en quien nunca tuvo uno). Si el tile bajo los pies (nivel z − 1) es el borde de andén 0x80 y la orientación ≥ 0x80, mira a 0xC0; si es 0x81 y la orientación está en 0x40..0xC0, mira a 0x80; en ambos casos pasa a 0x29 con `+0x42` = 100. Después la orientación cambia `rng(3) − 1` y se fija `+0x0b \|= 0x10`, con lo que al acabar cualquier acción vuelve a 0x1D (`0x30250`). Es el estado inicial de casi todos los civiles y policías de los niveles, y el del fin de guion (paso 9) [OBS] |
| 0x1E | `0x33370` | seguir al persuasor: si el líder va en un vehículo, ir a subir a él (5 → 6); si el líder sigue a otro, seguir a ese; copia sus barras y su arma equipada; va hacia el destino del líder girando como mucho 0x10 por ciclo; si en el siguiente paso hay alguien de su grupo en una caja de `percepción(0xC0) + 0x40` (mín. 0x10, `0x153a0`), se aparta; si choca, desvío (`0x307b0`, 0x14 ciclos si va desviado más de 0x0F, 500 si no) [OBS]; [INF] el sentido del giro con errores pequeños (el decompilado parece invertirlo) |
| 0x1F | `0x33660` | huir de `+0x2a`: de espaldas a él (`atan − 0x80`) a velocidad fija 0x28; si choca, desvío corto (`0x306d0`: pared = primer eje bloqueado, giro de 90° hacia el lado al que ya miraba, 50 ciclos siguiendo la pared); termina cuando la distancia supera `percepción(0xA00)` [OBS] |
| 0x20 | `0x337b0` | perseguir y atacar a `+0x2a` (dispara a ≥ 80 si está en alcance; se acerca si ≥ 300) [OBS] GH |
| 0x21 | `0x33b40` | muerte por terreno [INF] |
| 0x22 | `0x33740` | aviso de policía o guardia antes de atacar (`+0x2c`: espera = 30 − inteligencia(30); `+0x42`: inteligencia(50)) [OBS] |
| 0x27 | `0x33c00` | deslizarse por una rampa [INF] |
| 0x28 | `0x33dc0` | esperar a un agente: cada ciclo revisa una fila (`+0x42` = 0..6) de 5 casillas a partir de (`+0x2e`, `+0x30` + fila); si hay una persona agente (`+0x1c & 2`) con z = `+0x32`, termina la acción [OBS] |
| 0x29 | `0x33e60` | **esperar el tren en el andén**: velocidad 0; si en la casilla de delante (posición + vector de la orientación) hay un vagón intacto (subtipo 9 o 10) y la cabeza de su tren (cadena `+0x20`) no tiene conductor o este está en 0x2A, sube a él (siguiente 6, objetivo el vagón); cuando `+0x42` llega a 0 (post-decremento), media vuelta y `0x30250` [OBS] |
| 0x2A | `0x33f70` | esperar `+0x2c` ciclos [INF] |
| 0x2B | `0x33fb0` | disparando: si llega un evento, lo atiende; si la animación acaba o el arma no es automática (P = 0, `0x3a0a0`), vuelve (`0x30250`) [OBS] |
| 0x2C | `0x34030` | convertido por persuasión [INF] |

### 7.2 Percepción y reacción

[OBS] REA ev_19470b7b (`0x31830`). Solo para personas de clase 1 que cumplan todo esto: no son criminales (`+0x1c & 0x30 == 0`), no van en vehículo, no están muertas ni ocultas (`+0x0a & 0x109 == 0`), no están persuadidas, y su estado es 0, 2–5, 0xC, 0x10, 0x1D, 0x28 o 0x29 (los agentes también con 0xE y 0xF).

Hay dos barras que escalan las distancias: **percepción** `p(v) = v·(b51−b50)/(255−b50)` (`0x30060`) e **inteligencia** `i(v) = v·(b4d−b4c)/(255−b4c)` (`0x300c0`). Si la barra está en su punto neutro, el valor es 0. Para cada visible t (bandera `0x80` → huir siempre, estado 0x1F):

| Quién | Regla |
|---|---|
| **Policía** (no agente) | Si d < 0xA00, d ≤ p(0xA00) y t es un agente armado (`flags & 0x11 == 0x11`): elige arma (`0x3a390`); sin arma → huir (0x1F); con arma → estado 0x22 (aviso) con blanco t; además suena el aviso 0x1C, con al menos 0x38 ciclos entre avisos |
| **Civil** | Si d < p(0xA00) y t va armado (`flags & 1`) → huir de t (0x1F) |
| **Guardia** | Si d < 0xA00, d ≤ p(0x800) y t es agente → igual que la policía, sin sonido |
| **Agente** (incluidos los del jugador) | Solo si i(100) > 0. Para t de otro grupo, no persuadido, con d < 0xE00 y `flags & 0x11`: elige arma para d; si d < p(alcance del arma) y hay línea de tiro (`0x30eb0`) → estado 0x1C (apuntar) con `+0x42 = 3` y orientado a t; sin línea de tiro y sin objetos → huir |

Consecuencia: con las barras en su punto neutro, los agentes del jugador no disparan solos. Hay que subir la inteligencia y la percepción para que actúen por iniciativa propia [INF].

### 7.3 Agentes enemigos con guion

[OBS] REA ev_6d43d9f7 (`0x15660`, `0x15b10`, `0x15c60`) y ev_bf99d8bb (`0x16550`, `0x16ab0`).

**Cabecera** en GAMEnn `0x9beaa`:

| Campo | Significado |
|---|---|
| grupos | número de grupos con guion; solo cuentan los grupos ≠ jugador marcados como controlados por guion |
| agentes por grupo | |
| ciclos por tick de guion | |
| nivel de mejoras | 0→0, 1→`0xAAA` (V1 en todo), 2→`0x1554` (V2), 3→`0x1FFE` (V3) |
| bomba | si está: TIME BOMB con 199 de recurso |
| persuasor | si está: PERSUADERTRON con 50 |
| paso inicial | |
| arma forzada | |

**Equipo:** si no hay arma forzada, se usa la de mayor prioridad entre las investigadas (pistola 1, largo alcance 2, escopeta 3, uzi 4, minigun 5; tabla `0x53ec0`). La munición es la máxima. Los agentes enemigos se marcan como objetivo (`+0x1d |= 0x10`), salud 16. Cada vez que ejecutan un paso, la munición del primer objeto se fija en M/4.

**Miembro** (20 B, `0x5c368`): `paso`, `estado` (0..0xC; 5 y 0xD inactivos), `objetivo`, `contador`…

| Estado | Comportamiento |
|---|---|
| 0 | buscar el siguiente paso libre del guion |
| 1 | ejecutarlo y pasar a 2 |
| 2 | esperar a que se cumpla y avanzar a `next` (o terminar) |
| 4 | orden 0x10 |
| 6, 9, 10 | tener un blanco: comprobar línea de tiro al 90 % del alcance (`0x30e40`) → disparar (`0x163f0`: equipar arma, orden 8 a z+0x80) o acercarse |
| 8 | repetir el paso |
| 0xB | rendirse o salir |
| 0xC | aturdido durante 10 ticks tras recibir un impacto (evento `0x40`) y volver |

Un paso de tipo 1 con orden 3 se repite si la persona se aparta del punto.

**Pasos** (15 B): `+0` siguiente, `+6` banderas (`0x10` hecho), `+7` tipo, `+8` orden, `+9/+B/+D` parámetros.

| Tipo | Acción | Cumplido cuando |
|---|---|---|
| 1 | emitir la orden `+8` con (`+9`,`+B`,`+D`); la orden 9 sobre un objetivo muerto se convierte en «ir a su posición» | orden 3: parado; orden 9: ha subido a ese vehículo; 0xB–0xE, 0x14, 0x19: inmediato |
| 2 | usar la TIME BOMB que lleva (orden 10) | inmediato |
| 3 | cazar a un miembro del grupo `+9` (`0x34590` elige la víctima) | el grupo no tiene vivos |
| 4 | según el objetivo de misión `+6`: 1 persuadir, 2 asesinar (cazar), 5 recoger objeto, 0xE destruir, 0x10 ir al punto | condición del objetivo |
| 5 | fijar la bandera del grupo | inmediato |
| 6 | pasar al estado 4 | — |
| 7 | esperar: el contador `+9` baja y se cumple si un agente del jugador está a < 0xF00 | contador a 0 |
| 8 | cazar (sin persuadir) | el blanco ha caído |
| 9 | cazar para persuadir | el blanco le sigue → orden 0xB |
| 10 | destruir | el blanco muere |

**Caza** (`0x17300`) [OBS] REA ev_e29a1c85. El miembro guarda si ya ha mandado acercarse:

- si el blanco ha muerto: se suelta (orden 0xB: sin arma equipada y L = 0), barras a 0x7F/0x7F/0x7F (orden 0x14) y se busca otro;
- si aún no lo ha mandado: barras a adrenalina 0xFF, inteligencia 0x7F, percepción 0x7F (orden 0x14) y orden 4 «ir hacia la entidad» (la persigue aunque se mueva); si está exactamente en su posición, orden 3 a x + 0x80. Queda marcado;
- si ya lo ha mandado: con línea de tiro al 90 % del alcance (`0x30e40`) dispara (`0x163f0`); sin ella, **no repite la orden** mientras la persona esté ocupada (andando, desviándose…) y solo la desmarca cuando queda quieta (estado 0).

Con las barras neutras de los niveles (128/128) la velocidad sería la mínima (16); la orden 0x14 les da la velocidad completa.

[DES] Algunas rutinas auxiliares ( `0x34590` elección de víctima, `0x16930`, `0x170e0`, `0x172a0`) se completarán durante la implementación.

### 7.4 Vehículos

[OBS] REA (`0x39890`, `0x37110`, `0x36a50`, `0x36ec0`, `0x36c20`, `0x36900`, `0x36940`, `0x369d0`, `0x36a20`, `0x321c0`, `0x32300`, `0x32480`, `0x32560`, `0x32130`).

**Registro** (pool `0x8dd10`, 42 B; los enlaces son desplazamientos desde `0x8810e`: persona i → `2 + 0x5c·i`, vehículo j → `0x5c02 + 42·j`):

| Campo | Significado |
|---|---|
| `+0x04/06/08` | x, y, z |
| `+0x0c` | eventos de daño recibidos (bits como en las personas, §6.2) |
| `+0x0e` | aspecto del vagón (0..2) |
| `+0x12` | animación actual; la elige cada ciclo `0x39890` según modelo, condición y orientación (tabla de modelos) |
| `+0x16` | último atacante (enlace de persona) |
| `+0x14` | resistencia (30 en los coches de los niveles 1 y 2, 80 en los vagones, 100 en las locomotoras); mientras arde, ciclos que le quedan |
| `+0x19` | subtipo = modelo y condición (ver tabla de modelos): 5 y 6 son locomotoras y van en línea recta; 9 y 10 son vagones; el resto sigue las carreteras |
| `+0x1a` | orientación (0, 0x40, 0x80, 0xC0 en carretera) |
| `+0x1c` | primer ocupante (el conductor); los demás se encadenan por `+0x22` de cada persona |
| `+0x20` | enganche: si no es 0, la entidad cuya posición más `+0x22/+0x24/+0x26` es la del vehículo |
| `+0x28` | velocidad máxima; al subir, el conductor la copia en su `+0x55` |

La velocidad actual vive en el conductor (`+0x54`). La persona dentro de un vehículo está oculta (`+0x0a | 1`) y su `+0x24` apunta al vehículo.

**Conducir** (`0x37110`, lo llama el estado 2/3 o 4/5 de quien va dentro):

- Subtipos 5 y 6: orientación directa hacia el destino (`atan`), por el eje con más casillas pendientes; el otro eje se centra en la casilla (`0x36900`, hacia el desplazamiento 0x80, como mucho 0x20 por ciclo). Velocidad: 0 si ya está en la casilla; a 1–2 casillas, −12 con mínimo 12; a 3, máx/2; más lejos, +4 hasta el máximo. En la casilla de destino termina la acción.
- Resto (carretera):
  1. **Mirada adelante** (`0x36a50`, 6 casillas): se simula el recorrido casilla a casilla eligiendo orientación como en el punto 3. En las 3 primeras casillas se busca la primera entidad visible de clase 1 o 2 a la misma altura (`0x36940`):
     - si es un vehículo: en la primera casilla, velocidad 0; si no, la de su conductor − 8 (0 si no llega);
     - si es una persona y el conductor no es agente: en la primera casilla, 0; si no, −0x10.
     
     Sin obstáculo, si hay un giro en las 6 casillas: −8 (mínimo máx/2); si no hay giro: +4 hasta el máximo.
  2. **Carril**: con orientación 0 la x se centra hacia 0xC0 de la casilla; con 0x40, la y hacia 0x40; con 0x80, la x hacia 0x40; con 0xC0, la y hacia 0xC0 (como mucho 0x20 por ciclo).
  3. **Al entrar en una casilla nueva** (`0x36ec0`): si va por el eje y (0/0x80) y la x de la casilla no es la del destino, prueba a girar hacia el destino; si no, sigue recto; si no, −0x40; si no, +0x40 (lo mismo con el eje x). Una orientación vale si la casilla siguiente en esa dirección tiene, en el nivel z − 1, la clase de carretera de ese sentido (`0x36c20`): 8 para 0, 7 para 0x40, 9 para 0x80 y 6 para 0xC0.
  4. Si el conductor no es agente y el vehículo tiene `+0x0d & 2`, se para y se borra la bandera.
  5. En la casilla del destino, con suelo de clase ≠ 0 debajo, termina la acción.
  6. Avance: `DIR·velocidad >> 8`; los ocupantes viajan con el vehículo.

**Subir** (estado 6, `0x32300`): hace falta distancia < 0x80 y |dz| ≤ 0x80; si no, estado 5 con siguiente 6. Si el vehículo no tiene conductor, la persona pasa a serlo: se oculta, copia la velocidad máxima y termina la acción. Si ya lo tiene, se añade como pasajero y pasa al estado 8. Los vagones (9 y 10) también van al 8.

**Dentro** (estado 8, `0x32560`): si sigue a un líder que ya no va en vehículo y el suelo bajo ella no es de clase 2, se baja (estado 7, siguiente 0x1E). En un coche, termina la acción y queda quieta dentro (estado 0). En un tren viaja con el primer vagón.

**Bajar** (estado 7, `0x32480`): sale de la cadena de ocupantes (si era el conductor, el siguiente pasa a serlo), recupera su velocidad base (`+0x56`), deja de estar oculta, aparece en (x+1, y+1) y termina la acción.

#### Ciclo de vehículos (`0x39890`)

[OBS] REA (`0x39890`, `0x39660`, `0x395d0`, `0x39530`, `0x39730`, `0x394e0`, `0x13870`, `0x12880`, `0x127a0`, `0x1eb80`, `0x1ea30`). Es la última llamada del ciclo de misión y recorre el pool `0x8dd10`. Para cada vehículo activo:

1. **Enganche:** si `+0x20` no es 0, su posición pasa a ser la de esa entidad más el desplazamiento `+0x22/+0x24/+0x26` (y se actualiza la lista espacial).
2. **Condición** según el subtipo (abajo).
3. **Animación:** si la calculada no es 0 y difiere de `+0x12`, se reinicia en su primer frame.

**Modelos.** El subtipo `+0x19` es modelo y condición a la vez: dos valores intactos, uno ardiendo y uno de chatarra. Los demás subtipos no tienen manejador (no cambian ni se animan). oct8 = `((o + 0x10) >> 5) & 7`, oct4 = `((o + 0x20) >> 6) & 3`, oct2 = `((o + 0x20) >> 6) & 1`.

| Intacto | Ardiendo | Chatarra | Animación intacto / ardiendo / chatarra | Valor |
|---|---|---|---|---:|
| 1, 2 | 3 | 4 | 400 + oct8 / 0x198 + oct4 / 0x19C + oct4 | 150000 |
| 5, 6 (locomotora) | 7 | 8 | 0x1A0 + oct4 / 0x1A4 + oct4 / 0x1A8 + oct4 | 2000000 |
| 9, 10 (vagón) | 0xB | 0xC | (0x1AC / 0x1AE / 0x1B0) + 6·`+0x0e` + oct2 | 900000 |
| 0xD, 0xE (coche) | 0xF | 0x10 (sin animar) | 0x1BE + oct8 / 0x1C6 + oct4 / 0x1CA + oct4 | 9000 |
| 0x11, 0x12 | 0x13 | 0x14 | 0x206 + oct8 / 0x20E + oct4 / 0x212 + oct4 | 45000 |
| 0x1C, 0x1D | 0x1E | 0x1F (sin animar) | 0x216 + oct8 / 0x21E + oct4 / 0x222 + oct4 | 50000 |
| 0x24, 0x25 | 0x26 | 0x27 | 0x1D6 + oct8 / 0x1DE + oct4 / 0x1E2 + oct4 | 40000 |
| 0x28, 0x29 | 0x2A | 0x2B | 0x1EE + oct8 / 0x1F6 + oct4 / 0x1FA + oct4 | 35000 |

[OBS] La tabla reproduce el `+0x12` guardado en todos los vehículos de GAME02, GAME03 y GAME14 (test).

**Intacto** (`0x39660`):

- Si la resistencia es negativa: pasa a valer 100, el subtipo pasa a «ardiendo», `+0x0a |= 0x108` [DES: significado de esos bits] y se crea una **explosión** en (x+1, y+1, z). Nada más en ese ciclo.
- Si no:
  1. **Atropello:** si hay conductor, este es agente o el vehículo es locomotora o vagón, y la velocidad del conductor (`+0x54`) es > 0x1F: evento 0x01 en una caja de 0xF0×0xF0×0x100 sobre el vehículo (§6.2: las personas que toca reaccionan como a «otro»). No cambia el autor del daño de la víctima.
  2. La orientación se redondea a 0/0x40/0x80/0xC0: `o = (o + 0x20) & 0xC0`.
  3. Avanza un frame y atiende los eventos (`0x395d0`).

**Eventos** (`0x395d0`): si hay eventos y el atacante `+0x16` no es el conductor `+0x1c`:

| Bit (por prioridad) | Resistencia |
|---|---|
| `08` fuego | −10 |
| `10` láser | −300 |
| `80` explosión | −300 |
| `40` bala | 0 (la bala ya restó 1 al impactar) |
| otro | nada y no se avisa a los ocupantes |

Después, aviso a los ocupantes (`0x39530`). Al final se borran los eventos salvo el bit `0x200`.

**Impacto de bala** (`0x13870`, clase 2): la muestra de la traza toca el vehículo si solapa su caja de ±0x80 y 0x100 de altura y el vehículo no lo conduce quien dispara. Se añade el evento por OR, el atacante pasa a ser el tirador (`0x127a0`), la resistencia baja 1 y la traza se detiene. Un coche de resistencia 30 explota a la 31.ª bala.

**Aviso a los ocupantes** (`0x39530`): no en las locomotoras (subtipos 5 y 6). Cada ocupante que no sigue a nadie (`+0x20 = 0`):

- civil: baja (`0x32480`), estado y siguiente estado 0x1F (huir);
- policía o guardia: baja, estado 0x20 (perseguir);
- agentes y criminales: se quedan.

A los que bajan se les pone como blanco (`+0x2a`) al atacante y las barras `+0x49/4a`, `+0x4d/4e`, `+0x51/52` a 0xFF.

**Ardiendo** (`0x39730`): la resistencia baja 1 por ciclo; al hacerse negativa (101 ciclos) pasa a chatarra y, si el atacante es uno de los 4 agentes del jugador, el contador `0x60af0` suma el valor del modelo [INF: contador de daños materiales; los objetos estáticos también suman; solo se pone a 0 en `0x237b0` y no se ha visto quién lo lee]. Cada ciclo avanza un frame y saca a los ocupantes (`0x394e0`): bajan, su autor del daño pasa a ser el atacante del vehículo y su estado pasa a 0x14 (alcanzado por fuego, §6.2).

**Chatarra:** solo avanza la animación (salvo 0x10 y 0x1F, que quedan quietas).

**Explosión** (efecto de estado 0xD en el pool `0x95e70`, `0x1eb80`): suena el efecto 9 y se marca el evento 0x80 en 4 cajas de 0x100×0x100×0x200 centradas en (x ± 0x80, y ± 0x80) con base en z − 0x100 (las personas suman ±0x20 a la caja y los vehículos ±0x80, así que una explosión alcanza a otros vehículos cercanos y los encadena). Luego reproduce la animación 0x186 y crea **llamas** (`0x1ea30`) en un punto al azar a ±0x80 y z + 0x80. [OBS] `0x1ea30` no sale del bucle al crear una: ocupa todos los huecos libres de las 128 primeras casillas del pool, todas en el mismo punto (las siguientes llamadas ya no encuentran hueco).

**Llamas** (estados 0x29/0x2A): animación 0x187; cada ciclo marcan el evento 0x08 en una caja de 0x40×0x40×0x40 y suben 0x30; avanzan un frame cada 2 ciclos y desaparecen al terminar la animación.

**Trenes:** en los niveles, cada vagón (9/10) está enganchado (`+0x20`) al registro anterior y la locomotora de cola (5) al último vagón; solo la locomotora de cabeza, con conductor, se mueve (en línea recta, como arriba). Como el pool se recorre en orden, todo el tren se desplaza en el mismo ciclo. [OBS] GAME03, GAME06, GAME14, GAME22, GAME35.

[DIS] En el remake la explosión aplica su onda en el mismo ciclo en que se crea (en el original, en el siguiente pase de efectos); las llamas se crean una sola vez en lugar de llenar el pool, lo que daña igual (los eventos se acumulan por OR); el autor de la onda es el atacante del vehículo (en el original el efecto conserva el `+0x1c` que dejó el uso anterior de la casilla); la orden del ciclo (personas, vehículos, disparos, efectos) es la del remake.

### 7.5 Desvío ante obstáculos

[OBS] REA (`0x307b0`, `0x30cc0`, `0x30db0`, `0x32930`, `0x32aa0`).

Cuando un paso de marcha falla (`0x2fc70`), `0x307b0(persona, 500)`:

1. Solo una persona por ciclo puede calcular un desvío (bandera `0x55300`, que se borra al empezar el ciclo).
2. `q` = orientación redondeada al eje más cercano − 0x40. Se busca la primera dirección libre `a` desde `q` girando +0x40 (sondeo con paso 0x80) y la primera `b` con el paso de su velocidad.
3. Si no hay `b`: gira a la primera dirección libre desde `q + 0x20` ± 0x20 al azar y da un paso.
4. Si la hay: guarda `b` (`+0x5a`), el temporizador (`+0x42` = 500), 4 intentos (`+0x59`) y la distancia actual al destino (`+0x1e`). Simula dos copias con paso 0x80 durante 32 pasos: la izquierda empieza en `a + 0x40` y gira con −0x40; la derecha en `a − 0x40` y gira con +0x40 (cada paso prueba girar hacia la pared y, si no puede, va recto, luego al otro lado…). Si una copia llega a la casilla del destino, gana ese lado. Si ninguna llega, se comparan la menor distancia alcanzada por cada una y el paso en que la alcanzó: gana la que mejora antes, salvo que la otra mejore bastante más (más de 0x80 por cada paso de diferencia). Si la derecha nunca mejora, izquierda; si la izquierda nunca mejora, derecha.
5. Izquierda → estado 0xE con orientación `b + 0x40`; derecha → estado 0xF con `b − 0x40`.

**Seguir la pared** (0xE con δ = −0x40, 0xF con δ = +0x40; `0x30cc0`): cada ciclo prueba la orientación `o + δ` y, si está bloqueada, va restando δ (hasta 4 veces). Termina (y vuelve al estado anterior con `0x30250`) si ya está más cerca que al empezar y no va hacia `+0x5a − δ` ni en sentido contrario a `+0x5a`, si se agota el temporizador o si se acaban los intentos. Ir recto repone los intentos a 4; cada giro gasta uno. Si sigue, avanza con su velocidad. En la casilla de destino termina.

---

## 8. Misión: objetivos, fin y puntuación

### 8.1 Objetivos

Hay 8 entradas de 14 B en `0x9be3a` (cargadas desde GAMEnn). [OBS] REA ev_94942848 (`0x105e0`). Campos: `+0` hecho (u32), `+4` tipo, `+6` referencia de entidad, `+8/+0xA` x, y.

| Tipo | Condición de cumplido | Fracaso inmediato | Nombre |
|---|---|---|---|
| 0 | siempre | — | vacío |
| 1 | el objetivo sigue a un agente del jugador (cadena `+0x20`); al iniciar se marca `+0x1c |= 0x20` | objetivo muerto | persuadir [INF] |
| 2 | objetivo muerto | — | asesinar [INF] |
| 3 | — (se comprueba hasta el final) | objetivo muerto | proteger [INF] |
| 5 | el propietario del objeto es un agente del jugador | — | conseguir objeto [INF] |
| 10 | no queda ninguna persona de clase 1 con `+0x1c & 4` viva en el pool desde `0x883f0` | — | eliminar a la policía [INF] |
| 11 | no queda ninguna persona con `+0x1d & 0x10` viva y no persuadida por el jugador | — | eliminar o persuadir el grupo marcado [INF] |
| 14 | objetivo destruido | — | destruir [INF] |
| 15 | vehículo u objeto controlado por un agente del jugador | destruido | capturar vehículo [INF] |
| 16 | todos los agentes vivos (y los objetivos de tipo 1 y 5) a ≤ `0x300` u de (x,y) | — | evacuar [INF] |

**Fin de misión:**

- Éxito cuando todas las entradas están cumplidas.
- Fracaso si todos los agentes del jugador han muerto.
- **Abandono:** Esc pone `estado = (estado & ~1) | 8`.
- **Pausa:** la tecla P detiene la simulación hasta soltar, pulsar y soltar.
- Tras fracaso o éxito, la pantalla se mantiene hasta 576 ticks (`0x240`, 7,9 s) o hasta pulsar una tecla o un botón.

Estado de misión `0x60afc`: 1 en curso, 2 completada, 4 fallida, 8 abandonada.

### 8.2 Informe (debriefing) y vuelta de la misión

[OBS] REA ev_85599506 (`0x18ff0`) y ev_f6143f72 (`0x246d0`).

**Transferencia del resultado** (`0x246d0`, antes del informe). Para cada agente de la plantilla que fue a la misión:

- **Seguidores persuadidos** (solo si la misión se completó): cada persona viva que le sigue cuenta como persuadida y, según su tipo (se comprueba en este orden):

  | Tipo | Efecto |
  |---|---|
  | civil | +50 créditos |
  | guardia | +150 |
  | policía | +150 |
  | criminal | +300 |
  | agente | pasa a la plantilla (primer hueco libre de 18) con sus mejoras, salud 16, nombre nuevo al azar e inventario vacío; suma a NEW AGENTS GAINED |

- **Agente muerto** (salud < 0): se borra de la plantilla con todo su inventario.
- **Agente vivo:** salud 16; conserva las mejoras con que salió. Si la misión **no** se abandonó, su inventario pasa a ser lo que lleva al terminar (hasta 8 objetos, con su munición). Si se abandonó, conserva el inventario anterior a la misión.
- Al final, `aciertos = min(aciertos, disparos)`.

**Armas nuevas:** de los objetos que traen los agentes, los de un tipo aún «no descubierto» (precio negativo en el catálogo, `needsResearch`) se entregan a investigación:

- se quitan del inventario y el arma pasa a investigable (estado 0, precio positivo);
- su gráfica de progreso suma +600;
- si llega a 2400 (`0x960`), queda completa y se desbloquea su sucesora;
- se muestra «NEW WEAPONRY HAS BEEN SUBMITTED TO THE RESEARCH DEPARTMENT».

**Informe**, líneas en este orden:

1. MISSION STATUS (COMPLETED / FAILED / WITHDREW FROM MISSION)
2. AGENTS USED
3. NEW AGENTS GAINED
4. TIME IN MISSION
5. ENEMY AGENTS KILLED
6. CRIMINALS KILLED
7. CIVILIANS KILLED
8. POLICE KILLED
9. GUARDS KILLED
10. PEOPLE PERSUADED
11. HIT ACCURACY = `aciertos·100/disparos`, o «NO BULLETS FIRED» si no hubo disparos

**Tiempo:**

- Al aceptar la misión en CRYO (`0x1fbc0`), `contador = contador / 3`.
- Durante la misión, el contador sube 1 por ciclo con un día de 1008 (`0x3f0`).
- Al entrar al informe, el contador y el tiempo de misión se multiplican por 4, que es la escala de las pantallas (día de 4032 = `0xfc0`).
- TIME IN MISSION muestra `tiempo/4032` días y las horas restantes [INF].
- [OBS] El /3 y el ×4 no son simétricos; el remake conserva esa asimetría.

**Al salir del informe:** `población[territorio] −= 100·(guardias + civiles + policías + criminales + c9)`, donde c9 = `0x60af9` [DES].

**Fin de misión** (`0x37f80`):

- **Completada:** el territorio pasa al jugador con descontento 0 e impuestos 30. Si ya era suyo y estaba en rebelión (255), su descontento pasa a 170. Con los 50 territorios del jugador y ninguno en rebelión, la partida está ganada (MGAMEWIN y MENDWIN). En otro caso se muestra la animación MGAMEWIN.
- **Fracasada:** si queda algún agente vivo en la plantilla, se muestra MENDLOSE. Si no queda ninguno, la partida termina (MLOSEGAM) y empieza una nueva.

---

## 9. Progresión y economía

### 9.1 Partida nueva

[OBS] REA ev_46bf8b0d (`0x23880`). Hay 8 sindicatos: el 0 es el jugador y los otros 7 son rivales.

- **Fondos:** 30 000 créditos (100 000 000 en modo trampa `0x60b43`).
- **Fecha:** día 1, año 85 (se muestra «NC»), hora 0.
- **Plantilla:** 18 huecos. Los huecos 0–7 tienen agentes:
  - salud 16;
  - mejoras = bit 0 al azar (`rng(3) & 1`, el aspecto);
  - nombre al azar entre 69 sin repetir (`0x23540`);
  - una PISTOL con su munición máxima.

  Los huecos 8–17 están vacíos (salud −1). Los agentes 0–3 forman el equipo de la misión.
- **Territorios:** propietario `rng(7)+1` (todos son de rivales), descontento 0, población `(rng(20)+40)·1 000 000`, impuesto y siguiente impuesto 30.
- **Investigación:**
  - el estado de cada mejora es `0x5b474[i]` y el de cada arma `0x5b498[t]`: 2400 = disponible, 0 = investigable, 0xFFFF = bloqueada;
  - todas las gráficas de progreso empiezan vacías;
  - no hay investigación en curso (estado 2) y la financiación es −1.

**Registro de agente** (0x28 B desde `0x5e5b9`): `+0` nombre (0xff = vacío), `+1` salud (s16), `+3` mejoras (u16), `+7` hueco en el equipo (1–4; 0 = fuera) y `+8 + 4k` objeto k (munición s16, tipo u16).

### 9.2 Palabra de mejoras (`+0x3c` / plantilla `+3`)

[OBS] `0x1fbc0` y `0x24c80`; el catálogo de mejoras está en `0x55780`, con 18 entradas de `0x1eb` B. La mejora de identificador `m` (1–18) se compra con `0x23120`.

| Bits | Parte | m | Efecto | Precio V1/V2/V3 | Investigación (`+6`) |
|---|---|---|---|---|---|
| 0 | sexo o aspecto del cuerpo | — | sprite | — | — |
| 1–2 | LEGS | 1–3 | velocidad base 48/56/64 | 6000 / 30000 / 60000 | 37 / 185 / 370 |
| 3–4 | ARMS | 4–6 | capacidad de carga +10000 por nivel | 5000 / 25000 / 50000 | 37 / 185 / 370 |
| 5–6 | CHEST | 7–9 | resistencia n (§6.2) | 8000 / 40000 / 80000 | 50 / 250 / 500 |
| 7–8 | HEART | 10–12 | recuperación de la adrenalina | 4500 / 22500 / 45000 | 29 / 145 / 290 |
| 11–12 | EYES | 13–15 | recuperación de la percepción | 4500 / 22500 / 45000 | 29 / 145 / 290 |
| 9–10 | BRAIN | 16–18 | recuperación de la inteligencia y persuasión | 4500 / 22500 / 45000 | 29 / 145 / 290 |

**Compra** (`0x23120`):

- exige `fondos ≥ precio` y un agente vivo;
- si ya tiene esa misma versión, no hace nada;
- si no, sustituye la versión de esa parte (también hacia abajo) y cobra el precio completo.

La pantalla solo ofrece las mejoras investigadas (estado 2400, `0x22eb0`).

[OBS] REA ev_ee985ca4 (`0x2fae0`) y ev_7e2877dd (`0x2f990`): la recuperación de las barras usa HEART para la adrenalina, BRAIN para la inteligencia y EYES para la percepción. La salud se regenera según CHEST (§6.3).

**Barras.** Cada una son 4 bytes: real R (`+0x47`, `+0x4b`, `+0x4f`), neutro N (`+0x48`…), nivel pedido L (`+0x49`…, el que fija el jugador) y forzado F (`+0x4a`…). El efecto (`0x30060`, `0x300c0`, `0x30120`) usa L frente a N. Cada ciclo, con el contador c del agente (`+0x53`, de 8 bits) y el nivel i del implante:

| i | R se mueve cada | N se mueve cada |
|---|---|---|
| 0 | 4 ciclos | 0x14 |
| 1 | 8 | 0x1C |
| 2 | 0x10 | 0x28 |
| 3 | 0x28 | 0x80 |

- si F ≠ 0: L = F + 0x80 y N = F (así quedan fijas las barras de los civiles y la policía de los niveles);
- si toca a N: si N = L = R, N se acerca 1 a 0x80; si no, se acerca 1 a L (**dependencia**);
- si toca a R: si R ≠ L, R se acerca 1 a L; si ya son iguales, R y L se acercan juntos 1 a N (**el efecto se pasa**).

Con L al máximo y sin implantes, el efecto pasa del 90 % durante unos 53 s, del 50 % durante unos 67 s, y todo vuelve a 0x80 en unos 163 s; con implantes de nivel 3, unos 8 minutos de efecto completo.

### 9.2b Equipo: comprar, recargar y vender

[OBS] `0x23370` y `0x1fbc0` (pantalla CRYO/EQUIP).

- **Comprar** (`0x23370`):
  - exige `fondos ≥ precio`, menos de 8 objetos y un agente vivo;
  - añade el arma con munición = munición de catálogo (`+5`);
  - cobra el precio.
- **Recargar un objeto:**
  - coste `(munición de catálogo − munición)·coste de recarga de catálogo (+7, s32)`;
  - exige que el arma esté investigada (estado 2400), que no esté llena y que haya fondos.
- **Recargar todo** (botón del equipo): para cada objeto, coste `RECARGA[t]·(MUNICIÓN_MÁX[t] − munición)` con las tablas `0x5a712` y `0x5a73a`, y las mismas condiciones.
- **Vender:**
  - devuelve el precio completo si la munición está al máximo, o el 25 % (`precio·25/100`) si no;
  - quita el objeto y compacta el inventario.
- Con el botón de grupo, comprar y mejorar se aplica a los 4 agentes del equipo.

### 9.3 Investigación

[OBS] REA ev_7d4b1fdb (`0x35e20`) y ev_528e2d1a (pantalla RESEARCH `0x34ad0`).

- **Proyecto en curso:** uno solo, de tipo mejora (1) o arma (2). Su estado puede ser:
  - 0, en curso;
  - 1, recién completado;
  - 2, sin proyecto;
  - 3, parado por falta de fondos.
- **Financiación:** nivel L de −1 (sin financiar) a 9, ajustable con FUNDING +/−. Al elegir un proyecto, L = 0.
  - Multiplicadores (`0x5b95c`): **1, 2, 4, 6, 10, 15, 30, 50, 75, 100**.
  - La pantalla muestra MIN FUNDING = `coste·24` y MAX FUNDING = `coste·24·100` por día.
- **Cada hora de juego** (un día tiene 24 horas; en pantallas, 1 hora = 168 fotogramas), si el estado es 0 o 3:
  - L = −1: no hay avance;
  - si `coste·mult[L] > fondos`: estado 3 y no hay avance;
  - si no:
    - se cobra `coste·mult[L]`;
    - se añade un punto a la gráfica de progreso: `anterior + (L+1)·10`;
    - la gráfica tiene 240 puntos, uno por hora.
  - Al llegar a 2400, el elemento queda **disponible** (estado 2400) y su sucesor bloqueado (`0xFFFF`) pasa a investigable (0). El sucesor está en `+0x1ea` para las mejoras y en `+0x1f3` para las armas.
- La gráfica de cada elemento se guarda con él: cambiar de proyecto conserva el progreso.
- La lista RESEARCH muestra los elementos investigables (estado 0).

### 9.4 Territorios (50) y reloj

Registro de 10 B en `0x5539c` [OBS] REA ev_e1c7bcf1:

| Offset | Campo |
|---|---|
| `+0` | descontento (short, 0..255; 255 = rebelión) |
| `+2` | propietario (sindicato 0..7; 0 = jugador) |
| `+3` | impuesto actual |
| `+4` | impuesto siguiente (el que fija el jugador) |
| `+6` | población (u32) |

Registro estático de 19 B en `0x5b060 + país·0x13` [OBS] `0x27e00`, `0x28610`, `0x18bd0` (resuelto en la fase 3):

| Offset | Campo |
|---|---|
| `+0..+6` | rectángulo en el mapa del mundo (x, y, w, h; s16) |
| `+8` | bloque de etiqueta (coordenadas en `0x5b416 + 4·b`) |
| `+9..+16` | hasta 8 vecinos (índice de territorio + 1; 0 = ninguno) |
| `+0x11` | número de misión (GAMEnn, MISSnn) |
| `+0x12` | índice del nombre (tabla `0x541a4`, 3 idiomas) |

**Impuestos** (`0x28fe0`):

- botones −/+ que cambian 1 (clic izquierdo) o 10 (derecho) el impuesto siguiente, acotado a 0..100;
- solo en territorios del jugador que no estén en rebelión.

**Territorios elegibles** (`0x28d60`):

- no lo es uno propio que no esté en rebelión;
- sí lo son:
  - WESTERN EUROPE (el único de misión 1) mientras no sea del jugador;
  - cualquiera en rebelión;
  - cualquier vecino de un territorio del jugador que no esté en rebelión.
- Al elegir: territorio actual = el elegido, misión = `+0x11`, y se pasa al briefing.

**Reloj** (`0x18810`, ev_85599506):

- El contador sube 1 por fotograma de pantalla (día de 4032) o por ciclo de misión (día de 1008).
- La hora es `contador / (día/24)`. Al cambiar de hora se ejecuta el paso de investigación.
- Al llegar a `día − 1` pasa un día. Tras el día 365 viene el año siguiente.

Cada día, para cada uno de los 50 territorios, en este orden:

1. **Descontento** (`0x18bd0`):
   - si es del jugador, +2 por cada vecino que no es del jugador;
     - [OBS] el original indexa el propietario con `vecino` en lugar de `vecino − 1`, es decir, mira el territorio siguiente al vecino; el remake lo conserva y lo marca como error del original;
   - `+= (impuesto − 30)/2` (división truncada);
   - tiende a 30: −2 si ≥ 31, +2 si < 30;
   - se acota a 0..255.
2. **Ingreso** (`0x18cf0`):
   - si es del jugador **y** el descontento del *territorio actual* (no el de este) es < 160, ingresa `población/1 000 000 · 14 · impuesto / 10` créditos;
   - en ese caso, además, `impuesto = impuestoSiguiente`;
   - [OBS] lo del territorio actual es probablemente un error del original; el remake lo conserva.
3. **Población:** `+= 500 − rng(1000)`.

Después de los 50 territorios llega la **expansión de los rivales** (`0x18d80`). Para cada sindicato rival s = 1..7 con territorios:

- elige uno de ellos al azar (`rng(n−1)+1`-ésimo, recorriendo en ciclo);
- busca su primer vecino que no sea de s;
- si ese vecino tampoco es del jugador, con probabilidad 50 % (`rng(100) < 50`) pasa a s;
- el mapa anima la conquista;
- si un rival tiene los 50 territorios, se para.

Los rivales nunca quitan territorios al jugador. Un territorio en **rebelión** (descontento 255) sigue siendo suyo, pero no admite cambios de impuesto, no cuenta para ganar la partida y se puede volver a elegir para sofocarla: al completar la misión, su descontento pasa a 170. Si el descontento del territorio *actual* llega a 160, se cortan todos los ingresos (regla de `0x18cf0`).

### 9.5 Misiones por territorio

- 50 niveles `GAME01..50` más `GAME90..99`.
- Paleta del nivel: `HPAL%02d` según la tabla `0x54170`.
- Territorio → misión: campo `+0x11` del registro (§9.4). [OBS]
- **Briefing** en `MISSnn.DAT` (francés `MISS1nn`, italiano `MISS2nn`). Contiene:
  - tres costes de INFO, `|`;
  - tres costes de ENHANCE, `|`;
  - bloques de texto separados por `|`.

  [OBS] Misión 1: INFO 100/200/400, ENHANCE 100/200/400. Hay 4 bloques: el informe inicial y tres actualizaciones (DEFENCE UPDATE, TARGET UPDATE, TACTICS).
- **INFO:** la compra n (n = 1..3) cuesta `infoCosts[n−1]` y muestra el bloque n [INF].
- **ENHANCE:** la compra n cuesta `enhanceCosts[n−1]` y mejora el mapa del briefing [INF]. Su efecto visual llega con la fase de interfaz.
- [DES] Si INFO y ENHANCE se descuentan de los fondos al comprar o al aceptar la misión. El remake los cobra al comprar.

---

## 10. RNG

[OBS] REA ev_e1c7bcf1 (`0x10e20`):

```
seed = (seed · 0x24A1 + 0x24DF)   (16 bits, en 0x80108 = primera palabra de GAMEnn)
rng(n) = seed mod n
```

[INF] La semilla es de 16 bits, porque `0x605da` copia ese word. Es determinista: misma semilla y mismas órdenes, mismo resultado.

---

## 11. Controles

[OBS] GH:controls-logic-findings, `0x2b290`, `0x2c880`.

| Control | Acción |
|---|---|
| Clic izquierdo en el mapa | mover al agente seleccionado (orden 3: ir a x,y,z) [OBS] `0x2d610`. Sobre una persona se genera la orden 4 (o 0x18 si es el propio agente); con los dos botones a la vez, la 0x11. Según el ejecutor de órdenes (`0x25a10`): la 5 va a un objeto y lo recoge (estado 5 → 9, si lleva menos de 8); la 9 va a un vehículo y sube (5 → 6); la 0x19 baja del vehículo (estado 7) si el suelo no es de clase 2 [OBS] |
| Órdenes de grupo (`0x25a10`, 0x23–0x25) | se aplican a cada agente con `+0x1d & 4`. **Ir a un punto (0x23):** el agente k (0..3) va a `(x & 0xff00) + (k>>1)·0x80 + 0x40`, `(y & 0xff00) + (k&1)·0x80 + 0x40`: los cuatro se reparten en 2×2 dentro de la casilla pulsada [OBS] |
| Aceptación de una orden (`0x258f0`) | si la persona no sigue a nadie y su estado es 0, 2–5, 0xE, 0xF, 0x1C, 0x1F, 0x26 o 0x2C, cambia de estado ya; si no, solo se guarda como siguiente estado (`+0x58`) y se ejecuta al acabar lo que está haciendo [OBS] |
| Clic izquierdo en una caja del panel (0,0 · 64,0 · 0,100 · 64,100; 64×46) | seleccionar agente 1–4 |
| Clic derecho en una caja del panel | seleccionar el agente y **localizarlo**: `0x1e300` coloca la vista en ((x − 0xA00 − z) / 128, (y − 0x200 − z) / 128), que deja al agente en el centro de la vista (384, 208) [OBS] REA ev_b5e94f7d (`0x2d610`, `+0x5e114`). [DIS] El remake también lo hace con doble clic izquierdo (dos clics en la misma caja en menos de 400 ms), centra en el centro de la vista ancha de 16:9 y, si el agente va en un vehículo, en el vehículo |
| Clic en el escáner (x < 0x80, y > 0x10F) | punto = posición del agente seleccionado + (0x100 / zoom)·(ratón − (0x40, 0x150)), dentro de 0x100..0x7F00 × 0x100..0x5F00, a z + 0x80. **Izquierdo:** orden 3 (ir allí). **Derecho:** `0x1e300`, centrar la vista en ese punto [OBS] `0x2d610` |
| Barra de grupo (0,90; 128×8) | seleccionar el grupo |
| Clic derecho | disparar o usar el objeto equipado hacia el punto u objetivo (orden 8) |
| Ranuras de inventario (2×4 de 32×34 desde 0,208) | equipar (orden 7) |
| Teclas 1–4 | seleccionar agente |
| Esc | abandonar misión |
| P | pausa |
| F3/F4 | velocidad del juego |
| Barras de adrenalina, percepción e inteligencia | filas de 14 px desde `y + 0x2E` (adrenalina, percepción, inteligencia), de `x + 4` a `x + 0x3B`; con el botón izquierdo pulsado (también arrastrando) fijan L = (ratón − x − 4)·0x100/0x37, de 0 a 255, **solo del agente de esa caja** (órdenes 0xC, 0xE y 0xD), o de toda la escuadra viva si está seleccionado el grupo (0x2C–0x2E) [OBS] `0x2d610`, `0x25a10` |
| Cursor | contextual: cambia si hay blanco en alcance (`0x2cb40`) |
| Ratón | coordenadas virtuales 0..638 × 0..398 |

---

## 12. Flujo de pantallas

[OBS] `0x37600` y cadenas.

- Título (MTITLE, clic o tecla).
- MAIN MENU:
  - F1 CONFIGURE COMPANY: nombre, logo y colores;
  - F2 BEGIN MISSION;
  - F3 LOAD AND SAVE GAME;
  - F4 RESTART GAME;
  - F5 QUIT TO DOS.
- Desde BEGIN MISSION:
  1. Mapa del mundo (territorio, POP, TAX, OWN; botones BRIEF y MENU).
  2. MISSION BRIEF (texto MISSnn, INFO y ENHANCE de pago, ACCEPT, MAP, MENU).
  3. TEAM SELECTION, con las subpantallas RESEARCH, TEAM, MODS y EQUIP; ACCEPT.
  4. Misión.
  5. MISSION DEBRIEFING.
  6. Mapa del mundo.
- Final: MGAMEWIN, MENDWIN, MENDLOSE y MLOSEGAM.

### 12.1 Composición de las pantallas de gestión

[OBS] REA ev_baee0984 (`0x3c558`, `0x38f50`, `0x38ac0`, `0x38a60`, `0x186f0`, `0x29030`, `0x28cb0`) y ev_244917e5 (`0x42aee`, `0x4cfec`).

- **Modo de vídeo.** Las pantallas de gestión van en modo 13h, a **320×200** con paleta de 256 colores. La paleta es la de la animación FLIC de la pantalla. Todas las coordenadas del código (ratón, texto, sprites, rectángulos) están en un espacio lógico de **640×400**. Al dibujar, x e y se dividen entre 2 (`0x42aee` pone el píxel en `(x>>1, y>>1)`; `0x4cfec` divide también la posición).
- **Sprites de menú (MSPR-0).** Al cargarlos (`0x37600`), el ancho y el alto de la TAB se duplican en memoria, así que en el espacio de 640 miden el doble que en píxeles. Los datos RLE tienen el tamaño real en píxeles de 320×200.
- **Texto de menú** (`0x38f50`):
  - el carácter c usa el sprite `base + (c − 0x20)` de MSPR-0;
  - la línea base es `y + 12 − alto`;
  - el avance es `ancho + espaciado`, con un espaciado habitual de −2 (todo en unidades de 640);
  - el espacio avanza el ancho del sprite `base`;
  - `\n` baja `interlineado`.

  | base | Uso |
  |---|---|
  | `0x54` | texto pequeño |
  | `0x166` | resaltado, blanco |
  | `0x1ef` | botón normal |
  | `0x278` / `0x301` | opción de MAIN MENU con o sin cursor |
  | `0x38a` | LOADING |
  | `0x413` | título |
- **Botones** (`0x38ac0`):
  - el texto va centrado en el ancho del rectángulo, a `y + 8`;
  - la base es `0x166` si el ratón está dentro y `0x1ef` si no;
  - las tablas de botones son registros de 10 B (`x0, y0, x1, y1` s16, `id`, `tecla`) y terminan con el id = número de entradas (`0x22e20`).
- **Título de pantalla** (`0x38a60`): centrado en 640, a y = 0x30, con base `0x413`.
- **Fecha** (`0x18f30`): `"%02d:%d:%dNC"` (hora, día, año) en (500, 10) con base `0x166`.
- **Logo de la compañía** (`0x186f0`): bitmap de MLOGOS de 32×32 (1 = color del sindicato, 0 = negro), en (9, 7) del buffer de 320.
- **Ciclo de una pantalla** (`0x37ef0`, `0x37df0`, `0x37e90`):
  1. Al entrar se reproduce la animación de entrada (tabla `0x5b4c0`), y su último fotograma queda como fondo.
  2. En cada fotograma se restaura el fondo y se dibujan los elementos dinámicos.
  3. Al salir se reproduce la animación `…OUT`.
- **Animaciones** (`0x3c558`): se reproducen a pantalla completa. Con la bandera de «saltable» se cortan con un clic o una tecla.
- **Colores de sindicato** (`0x5b46a`): índices 6, 7, 14, 3, 11, 12, 13 y 15 para los sindicatos 0 a 7.

### 12.2 Pantallas

Coordenadas en el espacio de 640×400. [OBS] Funciones citadas.

**MAIN MENU** (`0x37600`, caso 0):

- título MAIN MENU;
- opciones CONFIGURE COMPANY, BEGIN MISSION, LOAD AND SAVE GAME, MULTIPLAYER GAME, RESTART GAME y QUIT TO DOS (tabla `0x54c00`):
  - en x = 0xd0, y = `0x8c + 0x22·i`;
  - MULTIPLAYER GAME, la cuarta, no se dibuja;
  - base `0x278` bajo el ratón y `0x301` en reposo;
  - un clic en y ∈ (0x7c, 0x126) elige `(y − 0x5a)/0x22`;
  - también se eligen con F1–F5.

**CONFIGURE COMPANY** (`0x175c0`, `0x18250`, `0x186f0`, `0x390c0`): animaciones MCONFUP y MCONFOUT; MCONSCR (64 000 B) es el mismo fondo sin los recuadros y se usa para limpiar el panel derecho al cambiar de modo [INF `0x18670`].

- Siempre: logo de la compañía (32×32 de MLOGOS en el color del sindicato) en (0xe, 0xb) del buffer de 320; nombre de la compañía en (0x1c, 0x5e) y del jugador en (0x1c, 0x74), con la base `0x54`. Si un nombre está vacío, solo su recuadro (color 0x1e).
- Botones de la pantalla: ACCEPT (0x2e, 0x15a)–(0x90, 0x172) guarda los cambios y sale; MENU (500, 0x15a)–(0x256, 0x172) sale sin guardarlos. Ambos reproducen MCONFOUT y vuelven al menú. Mientras se escribe un nombre, ACCEPT no guarda [OBS].
- **Modo 0** (elegir dato): SELECT DETAIL TO CHANGE en (300, 0x22) con `0x166`; las opciones COLOUR AND LOGO, COMPANY NAME y YOUR NAME en x = 0x16a, y = 0x46/0x5e/0x76, con el marco (sprite MSPR `+0x2a`) en (0x144, 0x40/0x58/0x70). Bajo el ratón se resaltan (base `0x166` y sprite `+0x3c`). Clic en y ∈ [0x41, 0x55] → modo 1; [0x59, 0x6d] → modo 3 (nombre de la compañía); [0x71, 0x85] → modo 2 (tu nombre).
- **Modo 1** (CHANGE COLOUR AND LOGO, en (0x12e, 0x22)): muestra del logo en (0xaa, 0x1a) del buffer; COLOUR en (0x1dc, 0x3c) y LOGO en (0x1dc, 0x5e); flechas (sprites `+0x1e` izquierda y `+0x24` derecha; `+0x30`/`+0x36` bajo el ratón) en (0x198/0x1b6, 0x38) para el color (0..7, cíclico) y (0x198/0x1b6, 0x5a) para el logo (0..39, cíclico).
- **Modos 2 y 3** (ENTER YOUR NAME en (0x158, 0x22); CHANGE COMPANY NAME en (0x142, 0x22)): recuadro (0x130, 0x4a)–(0x24c, 0x62) de color 0xea y campo de texto en (0x136, 0x52) con la base `0x166`: hasta 16 caracteres; las minúsculas pasan a mayúsculas; Retroceso, Supr, Inicio, Fin y ← → editan; Intro confirma; el cursor es un subrayado bajo el carácter actual que parpadea (colores 0xfc y 0x58).
- En los modos 1–3: OK en (0x122, 0x78)–(0x1a2, 0x90) confirma y CANCEL en (0x1da, 0x78)–(0x25a, 0x90) descarta; los dos recuadros son de color 0xea y el texto se resalta bajo el ratón. Esc o el botón derecho en el modo 1 cancelan.
- **Al guardar un color nuevo**, el sindicato rival que lo tenía recibe el color antiguo del jugador.

**Mapa** (`0x27e00`, `0x28610`, `0x28e90`, `0x29030`):

- fondo MMAP;
- cada territorio se pinta con su máscara de 64×44 de MMAPBLK, en `(rect.x/2, rect.y/2)` del buffer de 320, con el color del sindicato propietario (`0x28cb0`);
- el territorio elegido tiene:
  - su nombre centrado en (0xb8 … 0x1d0, 0x13a);
  - una línea discontinua animada desde la etiqueta `(etiqueta + 8)·2` hasta el centro del rectángulo, en colores 0x58/0xfc;
  - un recuadro alrededor de la etiqueta, en color 0xfc;
  - el mini‑logo **de la compañía del jugador** (MMINLOGO de 16×16 con su logo y su color, `0x186f0`), sea quien sea el propietario; se dibuja encima del logo grande;
- el territorio elegido es una variable propia (`0x55030`) que solo cambia esta pantalla: empieza en 9 (WESTERN EUROPE, valor estático) y se conserva entre visitas; un clic fuera de los territorios no la cambia (`0x28490` devuelve 0x32) [OBS];
- el bucle (`0x27e00`): clic → territorio bajo el ratón, luego BRIEF (si es elegible) o MENU, luego −/+ del impuesto (±1; con el botón derecho, ±10); Intro equivale a BRIEF y Esc a MENU; cada día que pasa se repintan los territorios que han cambiado de dueño;
- datos a la derecha:
  - POP en (0xc2/0x10c, 0x14e);
  - TAX en (0xc2, 0x15c), con botones −/+ en 0x176 y 0x1b4 y sprites `0x42/6` y `0x48/6`;
  - STAT en (0xc2, 0x16a): VERY HAPPY < 0x2f, HAPPY < 0x5f, CONTENT < 0xa0, UNHAPPY < 0xd1, DISCONTENT < 0xfe y REBELLIOUS a partir de ahí;
  - «UNKNOWN» si el territorio no es del jugador;
- botones BRIEF en (0x10, 0x15a, 0x82 de ancho) y MENU en (500, 0x15a).

**MISSION BRIEF** (`0x10e60`):

- caja de texto en (0x18, 0x5a), de 0x1d6×0xd0, con base `0x166`, interlineado 0x10 y espaciado −2 (`0x38c90`). El texto se corta en el primer `|`; `\` fuerza salto de línea y `\n\n` deja una línea en blanco;
- flechas de página con los sprites 0x4f–0x52 en (0x1ac, 0x13c) y (0x1ce, 0x13c);
- botones INFO (500, 0x6c), ENHANCE (500, 0xa2) y MAP (0x94, 0x15a);
- ACCEPT en (0x10, 0x15a) lleva a TEAM SELECTION; MENU en (500, 0x15a);
- costes centrados en 500…624, en y = 0x58 (fondos), 0x8e (INFO) y 0xc4 (ENHANCE);
- **minimapa** (`0x11a70`) en (500, 0xd8), de 128×128:
  - zoom `z = (5 − ENHANCE)·2` unidades por casilla, con `128/z` casillas por lado;
  - cada casilla toma el color de la clase COL01 de su tile en z = 0: 1–4 y 13 → 15; 5 y 14 → 7; 6–9, 11 y 15 → 10; 10 → 0; las demás no se pintan (fondo 8);
  - personas: los agentes (casillas 0–7) en color 12 y las demás en 6; las demás solo se muestran con el nivel de ENHANCE marcado con «A» [INF];
  - marco en color 0x18;
  - se centra en el primer agente; mantener pulsado el botón en sus bordes lo desplaza `ENHANCE + 1` casillas por fotograma;
- INFO y ENHANCE se cobran al comprar y se guardan **por territorio** (`+0x555[t]` y `+0x587[t]` del jugador).

**TEAM SELECTION / CRYO** (`0x1fbc0`, `0x22a10`, `0x22fe0`, `0x22eb0`, `0x228d0`):

- **Tabla de botones** `0x5b5b0`:

  | Elemento | Rectángulo |
  |---|---|
  | 4 casillas del equipo (2×2) | (0x14, 0x54, 0x50, 0x96), (0x52, 0x54, 0x8e, 0x96), (0x14, 0xa2, 0x50, 0xe4), (0x52, 0xa2, 0x8e, 0xe4) |
  | TEAM | (0x10, 0x106) |
  | MODS | (0x10, 0x122) |
  | EQUIP | (0x10, 0x13e) |
  | ACCEPT | (0x10, 0x15a) |
  | MENU | (500, 0x15a) |
  | PURCHASE / SELL | (500, 0x13e) |
  | CANCEL / RELOAD | (500, 0x124) |
  | 8 huecos de inventario de 32×32 | desde (0x16e, 0x134), en filas de 4 |
  | lista de la derecha | (500, 0x6a) – (0x274, 0x158) |
  | RESEARCH | (0x10, 0xea) |

- **Casilla i del equipo:** sprite MSPR `i+1` si está ocupada; barra de salud de 6×0x24 en `(x+0x30, y+4)`, color 12 (10 si está vacía). La casilla elegida lleva un marco discontinuo animado.
- **Cuerpo del agente** (`0x5b55c`, 7 entradas de {sprite, x, y} por sexo, con el bit 0 de las mejoras):

  | Parte | Sprite |
  |---|---|
  | torso | `base + sexo` |
  | piernas | `base + LEGS` |
  | brazos | `base + ARMS` |
  | pecho (si > 0) | `base + CHEST` |
  | corazón | `0x35 + HEART` |
  | ojos | `0x3b + EYES` |
  | cerebro | `0x38 + BRAIN` |

  Los nombres de las mejoras instaladas van en x = 0x16e y en estas y, con base 0x54:

  | Mejora | y |
  |---|---|
  | BRAIN | 0x72 |
  | EYES | 0x8a |
  | HEART | 0xa2 |
  | CHEST | 0xce |
  | ARMS | 0xe4 |
  | LEGS | 0xfc |
- **Nombre del agente:** en (0x9e, 0x58) con base 0x166.
- **Inventario:** el arma t se dibuja con el sprite `t + 0xd` (el escudo, 0x1c). La barra de munición mide `munición·24/máx` × 6 y va en `(x+4, y+0x16)`, color 12.
- **Lista TEAM:**
  - título CRYO CHAMBER en (0x1f8, 0x6c), base 0x54;
  - 18 nombres en (0x208, `0x7c + 0xc·i`), base 0xdd (EMPTY si el hueco está vacío);
  - número de puesto en x = 0x1f8.
- **Listas MODS y EQUIP:** elementos investigados en (0x1f8, `0x70 + 0xc·i`), base 0xdd, con resaltado 0x54; fila elegida `(y − 0x70)/12`.
- **Detalle de arma:**
  - imagen MSPR `t + 0x3f` (escudo 0x4e) en (0x1f6, 0x6a);
  - COST, AMMO, RANGE y SHOT en x = 0x1f8 / 0x22c desde y = 0xd0, con paso 0xc.
- **Detalle de mejora:**
  - nombre en (0x1f8, 0x6e);
  - COST en y = 0x7e;
  - descripción (tabla `0x54960` con el índice `+5` de la mejora) en una caja de (0x1f8, 0x8e), 0x78×0xea, base 0x54.

**RESEARCH** (`0x34ad0`), tabla de botones `0x5b6a0`:

| Botón | Rectángulo |
|---|---|
| FUNDING + | (0x10, 0xd2) – (0x92, 0xec) |
| FUNDING − | (0x10, 0x106) – (0x92, 0x120) |
| MODS | (0x10, 0x122) – (0x92, 0x13c) |
| EQUIP | (0x10, 0x13e) – (0x92, 0x158) |
| ACCEPT | (0x10, 0x15a) – (0x92, 0x174) |
| MENU | (500, 0x15a) – (0x274, 0x174) |
| lista de completados | (500, 0x6a) – (0x274, 0x158) |
| lista de investigables | (0x10, 0x50) – (0x92, 0xd0) |

- La gráfica se dibuja desde (0xcc, 0x15e): una columna por hora, con altura `progreso/10`.

**MISSION DEBRIEFING** (`0x18ff0`), tabla de botones `0x5b808`:

- REPLAY (0x94, 0x15a) – (0xf8, 0x174), solo si la misión no se completó;
- ACCEPT (0x10, 0x15a) y MENU (500, 0x15a);
- líneas: etiquetas en x = 0x12 y valores en x = 0x140, desde y = 0x78 con paso 0xe; MISSION STATISTICS en (0x12, 0x64).

**Final:** MGAMEWIN, MENDWIN, MENDLOSE y MLOSEGAM son solo animaciones (§8.2).

### 12.3 Panel de la misión

[OBS] REA ev_094fe97d (`0x2d0e0`) y ev_6703d867 (`0x2e4a0`, `0x1dcb0`, `0x2ee30`, `0x2cb40`, `0x2c510`); tablas `0x55112`, `0x55190` y `0x55256`.

La misión va en modo SVGA a 640×400, sin dividir coordenadas. El panel ocupa la franja izquierda, de 128 px.

- **Elementos** (registros de 18 B: tipo, x, y, w, h, contador de redibujo, fotograma, caché y base):
  - cajas de agente de 64×46 en (0,0), (64,0), (0,100) y (64,100);
  - barra de grupo de 128×8 en (0,90);
  - 8 huecos de inventario de 32×34 desde (0,208), con paso de 32 en x y en y.

  Cada elemento se dibuja con la **animación HSTA `0xd4 + base + variante`**, donde la variante vale 0–3 según el estado (por ejemplo, seleccionado). Las bases son `4·i` para los agentes, 0x3d para el grupo y 0x49 para los huecos. Son las mismas animaciones y sprites HSPR de la misión.
- **Por agente:**
  - salud: barra vertical de 6×`salud·36/16` en `(x+0x34, y+6)`, color 12;
  - arma equipada: dibujada en `(x+0x20, y+0x26)` (`0x1e1c0`, reteñida con el color del sindicato);
  - tres barras de 55×10 bajo la caja, en `(x+4, y+0x30)` adrenalina, `y+0x3e` percepción e `y+0x4c` inteligencia:
    - del neutro N al nivel pedido L en color claro y del neutro al valor real R en oscuro (14/6, 15/7 y 13/5); se pinta primero el tramo que llega más lejos y encima el otro [OBS] `0x2ee30`;
    - marca del neutro en color 12, de 10 px;
    - escala `v·55/255`.
- **Munición** de cada hueco: barra de `munición·23/(máx+1)` × 4 en `(x+4, y+0x18)`, color 14 sobre 8.
- **Escáner** (`0x1bec0`, recortado a (0, 0x110)–128×128): vista cenital centrada en el agente seleccionado. Escala `z` = 8 px por casilla, o 4 si algún agente de la escuadra lleva un escáner (objeto de tipo 10, `0x3a030`). Abarca 128/z casillas por lado.
  1. **Suelo:** por cada casilla, la clase (COL01) del bloque más bajo de la columna da un cuadrado de z×z: clases 1–4 y 0xD → color 15; 5 y 0xE → 7; 6–9, 0xB y 0xF (carreteras) → 10; 0xA → 0; las demás no se pintan.
  2. **Entidades** visibles de cada casilla (como mucho 300): posición `(x & 0xff)·z >> 8` dentro de su casilla.
     - Se muestran las entidades sin `+0x0b & 1` que no estén ocultas, y también las ocultas del jugador (sus agentes dentro de un vehículo).
     - Personas: si es un agente, su sindicato es `(índice/8)`. Guardia (`+0x1c & 8`) que no sigue a nadie → color 4; policía (`& 4`) que no sigue a nadie → 15. Si sigue a alguien (`+0x20`), cuenta el sindicato de su líder. Del jugador → 0xB (o `0xB + 0x5e396`, parpadeando, si sigue a alguien y tiene `+0x1c & 0x20`); de otro sindicato → 0xE; sin sindicato (civiles) → solo con la opción `0x5e395`, 2×2 de color 0xC. Las personas se dibujan como **puntos redondeados** (`0x1b5d0`, tamaño 2–8, hecho de líneas horizontales; semianchura por fila desde el centro: 2 → 1,0; 3 → 2,2,1; 4 → 3,3,2,1; 5 → 4,4,3,3,1; 6 → 5,5,5,4,4,2; 7 → 6,6,6,5,5,4,2; 8 → 7,7,7,6,6,5,4,2): primero con tamaño 4 y color `(c + 8) & 0xF` (borde) y después con tamaño 3 y color c.
     - Vehículos: cuadrado de z/2 de color 0xC.
     - Objetos (clase 4): con la opción `0x5e395`, 2×2 de color 4.
  3. **Cruz** de color 0 que pasa por el agente seleccionado (una línea horizontal y una vertical de todo el escáner).
  4. **Baliza de objetivo:** para el primer objetivo pendiente de tipo 1, 2, 3, 5, 0xE o 0xF (sobre una entidad) o 0x10 (un punto), se dibuja un círculo (`0x1bbd0`, color 0xC) centrado en el blanco, con un radio que crece z por fotograma. Al pasar de la distancia entre el blanco y el centro + 4·z, vuelve a 0 y suena el efecto 0x11. Si el punto (tipo 0x10) cae dentro del escáner, además se dibuja un círculo fijo de radio 3·z con color `0xE − 8·parpadeo`.
- **Línea de mensajes:** 16 caracteres en y = 190, con la fuente HFNT01 (`0x4f69b`). Muestra el nombre del arma bajo el cursor, el aviso de misión y el texto de estado alternando cada 16 o 32 fotogramas.
- **Cursor** (`0x2cb40`; se dibuja en `0x4165e`): el número es directamente el sprite de HPOINTER (32×32 útiles, punto activo en (16, 16) [INF por la forma]).
  - x < 0x80 (panel) → 1 (flecha).
  - Sobre el mapa → 2 (flecha), salvo:
    - persona visible de otro sindicato bajo el ratón: 6 (mira) si el agente seleccionado tiene un arma equipada y línea de tiro hasta ella dentro del alcance del arma (`0x30eb0`); si no, 5;
    - vehículo u otra entidad bajo el ratón: lo mismo, con `0x310c0`;
    - objeto del suelo: 4 (mano). Además, el objeto aparece en el siguiente hueco libre del inventario y su nombre en la línea de mensajes.

---

## 13. Recursos

Se extraerán de la instalación del usuario a `remake/assets/`, que no se versiona.

| Recurso | Formato | Grado |
|---|---|---|
| Tiles HBLK01 | 256 bloques × 6 punteros u32 a subtiles de 32×16. Fila = 5 dwords big‑endian (máscara + 4 planos). Subtiles en columnas de arriba abajo (0–2 izquierda, 3–5 derecha); el bloque mide 64×48 | [OBS] verificado visualmente |
| Sprites HSPR-0 | TAB: offset u32, ancho u8 y alto u8. Datos: por cada 8 píxeles, 5 bytes (máscara + 4 planos) | [OBS] verificado visualmente |
| Animación | HSTA (u16 primer frame por animación), HFRA (8 B: elemento, ancho, alto, flags, siguiente frame) y HELE (10 B: sprite·6, dx, dy, flags (bit 0 espejo), siguiente) | [OBS] |
| Paletas | HPAL01–05: 768 B de 6 bits (la misión usa 16 colores) | [OBS] |
| Menús MSPR-0, MFNT-0 | TAB igual que HSPR. Datos RLE: control > 0 literal, < 0 salto, 0 fin de línea | [OBS] blitter `0x4cfec` |
| Pantallas M*.DAT e INTRO.DAT | **FLIC** con mini‑cabecera de 12 B (`u32 12`, `0xAF12`, frames, ancho, alto) y frames `0xF1FA` estándar (chunks 4, 11, 7, 12, 13, 15 y 16). El campo de tamaño del frame no siempre es fiable: el siguiente frame empieza donde terminan los chunks. 25 animaciones; la intro tiene 997 frames | [OBS] fase 3; corregido en la fase de interfaz |
| Cursores HPOINTER | Mismo formato que los sprites HSPR (32 px de ancho); 6 cursores. La TAB declara 33 filas, pero la primera (20 B) no es imagen: se descarta y quedan 32×32 con la punta de la flecha y el centro de la mira en (16, 16), que es el punto activo | [OBS] fase 3; [INF] fila 0 y punto activo (pulido) |
| Sonido | SOUND-0/1, GSOUND-0 e ISNDS-0/1 (.DAT + .TAB). TAB de 32 B por entrada: `+18` offset u32, `+26` tamaño u32; la entrada 0 es la cabecera. Cada sonido es un fichero **Creative Voice (VOC)** | [OBS] fase 3 |
| Música | SYNGAME.XMI (5 secuencias) e INTRO.XMI: XMIDI → MIDI de 60 PPQN a 120 bpm (120 ticks/s); se reproducirá con un secuenciador en WebAudio | [OBS] formato; [DIS] síntesis |
| Fuente de misión HFNT01 | Tras RNC, 1707 B: 128 entradas de 5 B (offset u16 al bitmap, ancho, alto y desplazamiento vertical; offset 0xFFFF = sin glifo) y bitmaps de 1 bpp: un byte por fila si el ancho es < 8 y una palabra de 16 bits little‑endian si es ≥ 8, con el bit alto como píxel izquierdo (h+1 filas reservadas) | [OBS] verificado («A», «!», «M», «T», «W») |
| Mapa mundial MMAPBLK | Tras RNC, 50 máscaras de 64×44 B (1 B por píxel; ≠ 0 = territorio) | [OBS] `0x28cb0` |
| Logos MLOGOS / MMINLOGO | Tras RNC, 40 logos de 32×32 / 40 de 16×16 (1 B por píxel; ≠ 0 = color) | [OBS] `0x186f0` |
| MCONSCR | 64 000 B sin comprimir: imagen de 320×200 | [INF] |
| Textos | En inglés, francés e italiano dentro de MAIN.EXE (tablas de 3 punteros); briefings en MISSnn.DAT | [OBS] |

### 13.1 Sonido y música

[OBS] REA (MAIN.EXE):

| Rutina | Contenido |
|---|---|
| `0x387e0`, `0x38790` | peticiones de sonido |
| `0x10360` | sonido posicional |
| `0x1d450`, `0x1e050` | sonido de fotogramas |
| `0x3a970` | disparo |
| `0x104c0`, `0x10510` | fin de misión |
| `0x10010`, `0x3b8a0` | música de misión |
| `0x3c558`, `0x3ba60` | señales de las animaciones |
| `0x37f80` | animaciones de fin |
| `0x274a0` | arranque |

[OBS] REA (INTRO.EXE, aplanado igual que MAIN):

| Rutina | Contenido |
|---|---|
| `0x101ac` | arranque |
| `0x105dc` | señales |
| `0x10794`, `0x1089c` | subtítulos |
| `0x20abc` | tabla de señales |
| `0x20ed8` | tabla de subtítulos |

**Bancos:**

| Banco | Uso | Id |
|---|---|---|
| `SOUND-0` (28) | misión, tarjeta Sound Blaster (`GSOUND-0` es la variante para otra tarjeta) | id n = entrada n de la TAB |
| `SOUND-1` (13) | animaciones de fin | id n = entrada n de la TAB |
| `ISNDS-0` (18) | intro | id n = entrada n de la TAB |

**Peticiones** (`0x387e0`):

- Cada ciclo se pide `(id, volumen)`. Si el mismo id se pide varias veces, queda el volumen mayor.
- El id solo vale si existe en el banco.
- Al final del ciclo se reproducen las peticiones y la tabla se vacía (`0x38790`).
- Todos los sonidos de juego van a volumen 0x7f, sin atenuación por distancia.

**Fuentes de sonido en la misión:**

- **Fotogramas:**
  - el byte bajo de los flags de HFRA es un id de sonido;
  - cada entidad dibujada en pantalla pide el sonido de su fotograma actual (`0x1d450` y el panel `0x1e050`);
  - los flags `0x100` siguen marcando el inicio del ciclo (§5.4).
- **Posicionales** (`0x10360`):
  - suenan solo si la entidad está a la vista, con `−0x201 < (dx−dy)/8 < 0x400` y `−0x191 < ((dx+dy)/2 − z)/8 + 16 < 800` respecto a la cámara;
  - las usan el disparo, la advertencia de la policía (0x1c) y la reacción al impacto (`0x30600`).
- **Disparo por arma** (`0x3a970`):

  | Arma | Sonido |
  |---|---|
  | PISTOL | 2 |
  | GAUSS | 0x16 |
  | SHOTGUN | 1 |
  | UZI | 0xb |
  | MINI-GUN | 0xd |
  | LASER | 4 |
  | FLAMER | 5 |
  | LONG RANGE | 0xc |
- **Otros:**
  - explosión: 9;
  - misión completada: 0x17 (`0x10510`);
  - misión fallida: 0x18 (`0x104c0`).

**Música:**

- SYNGAME.XMI tiene 5 secuencias e INTRO.XMI una; las reproduce el driver FM `GAMEFM.DLL`.
- Selección de la secuencia de misión, cada ciclo (`0x10010`):

  | Secuencia | Cuándo |
  |---|---|
  | 3 | misión fallida, hasta que termina; después, silencio |
  | 4 | misión completada, ídem |
  | 1 | el agente seleccionado está a menos de 0x1000 u de un agente desplegado de otro sindicato que no le sigue |
  | 0 | resto de casos |

- `0x3b8a0` solo reinicia la música si cambia de secuencia.
- La secuencia 2 la lanza la animación MENDWIN, al ganar la partida.

**Señales de las animaciones** (`0x3ba60`):

- Registros de 4 B `{fotograma u16, orden u8, argumento u8}` hasta FFFF:
  - A: ticks por fotograma;
  - S/s: sonido del banco SOUND-1;
  - M/m: secuencia de música.
- Tablas:

  | Tabla | Animación | Señales |
  |---|---|---|
  | `0x5bb94` | MENDLOSE | A6@35, S13@35, S11@41, S4@83, A10@108, S5@108, S6@113 |
  | `0x5bbb4` | MGAMEWIN | S7@1, S8@6, S9@15, A120@84 |
  | `0x5bbc8` | MLOSEGAM | S12@1, S10@40 |
  | `0x5bbd4` | MENDWIN | S3@1, M2@1, A10@2 |
  | `0x5b958` | pantallas de menú | vacía |

**Intro** (INTRO.EXE, ejecutado por MAIN como `intro >nul` antes del juego):

- INTRO.DAT (FLIC de 997 fotogramas) a 5 ticks por fotograma, con la tabla de señales `0x20abc`.
- Registros de 7 B `{fotograma u16, orden u8, argumento u32}` hasta FFFF:

  | Orden | Efecto |
  |---|---|
  | A | ticks por fotograma |
  | S | sonido n de ISNDS (0 lo para) [INF] |
  | M | secuencia de INTRO.XMI |
  | X | para la música |
  | T | subtítulo n (0 lo borra) |
  | L, E | [DES] (carga de datos de sonido y reinicio) |

- **Subtítulos:**
  - tabla `0x20ed8` de 3 punteros por índice (inglés, francés, italiano);
  - se dibujan con MFNT-0 (glifo `c − 0x20`, tamaños duplicados como MSPR) alineados a la izquierda en x = 0, con la línea base en y = 0x17c;
  - el espacio avanza 8; «-» sube 4 y «'» sube 8;
  - antes de cada uno se borra la franja y = 0x168…0x17c.

**Síntesis musical** [DIS]:

- El original suena con FM OPL a través de GAMEFM.DLL y los timbres de SAMPLE.AD/OPL. Reproducirlos exactamente exigiría emular el chip OPL, cosa que el proyecto prohíbe.
- El remake interpreta los MIDI con un secuenciador propio y un sintetizador sencillo de WebAudio: osciladores por familia de instrumento General MIDI, envolvente ADSR y percusión de ruido filtrado.
- Notas, tempo, canales y cambios de programa son los del original; el timbre es aproximado.

---

## 14. Arquitectura propuesta (pendiente de aprobación)

[DIS] Código nuevo en ES modules, sin dependencias en tiempo de ejecución.

```
remake/
  index.html
  src/
    main.js                 arranque, bucle con delta time y acumulador de ciclos de 96,1 ms
    core/  loop.js · rng.js (LCG §10) · events.js · fixed.js (enteros 16 bits)
    data/  loader.js (lee assets/*.json y PNG) · rnc.js (descompresor nuevo, solo en el extractor)
    world/ map.js (columnas, clases) · terrain.js (§3) · spatial.js (celdas 256) · collision.js (§5.3)
    entities/ person.js (FSM de estados) · vehicle.js · item.js · projectile.js
    systems/ movement.js (§4) · combat.js (§6) · ai/ (agentes, policía, civiles) · persuasion.js · objectives.js (§8)
    meta/  company.js · territories.js (§9.4) · research.js · market.js · calendar.js
    scenes/ title · mainMenu · worldMap · brief · teamSelect (research/team/mods/equip) · mission · debrief · saveLoad · ending
    render/ iso.js (proyección §1) · tiles.js · sprites.js (HFRA/HELE) · hud.js · menus.js
    input/ mouse.js · keyboard.js (acciones de §11)
    audio/ sfx.js · music.js (XMI → secuenciador WebAudio)
    save/  storage.js (JSON en IndexedDB)
  tools/ extract-assets.mjs  (instalación del usuario → assets/*.png + *.json; solo formatos, sin código original)
  test/  *.test.mjs (node --test): terreno, movimiento, colisión, daño, puntuación, RNG, economía
```

- Las personas usan una **máquina de estados explícita** (enum de estados, transiciones documentadas en la fase 5).
- **Render** [DIS]: los bloques se pintan por diagonales (tx+ty) crecientes y de abajo arriba. Cada entidad se pinta en la casilla de la esquina delantera de su caja (x+0x20, y+0x20), tras los bloques por debajo de su altura. Se omiten los bloques sin píxeles visibles. El original usa máscaras de ocultación (`0x44164`); el orden por diagonales es una aproximación.
- **Bloque de tile** [OBS por coincidencia visual con el original]: la imagen de 64×48 del bloque (tx,ty,tz) se coloca en `proyección(tx·256, ty·256, (tz+1)·128) − (32, 0)`.
- **Cámara inicial** [DIS]: centrada en el primer agente. El original la sitúa en (150, 76) medias casillas en la misión 1, con el agente en (545, 310) de pantalla.
- La simulación es independiente del render: el render interpola a 60 fps.

**Fuera del proyecto nuevo:**

- La carpeta `web/` del experimento anterior (emulador) y `syndicatejs/` (rutinas portadas sobre la memoria original) no se usan ni se importan.
- Su información solo vale como documentación de comportamiento.

---

## 15. Pendientes antes o durante la implementación

1. Fase 3. Resuelto salvo la fuente HFNT01 y el significado de los campos `raw` de vehículos y estáticos.
2. Fase 5, enemigos e IA. Resuelto:
   - estados `0x34110`;
   - percepción;
   - disparo;
   - daño;
   - persuasión;
   - guiones enemigos;
   - objetivos;
   - bits HEART, EYES y BRAIN.
3. Pendiente:
   - desvío `0x307b0`;
   - vehículos (`0x37110`) y pasos de escenario que los usan;
   - rejilla de alcance del persuasor (`word3c & 0x1800`);
   - helpers enemigos `0x17300` y `0x34590`;
   - estados 4–6 y 0x27;
   - reacciones a rampas;
   - reparto de destinos al mover el grupo;
   - efecto visual de ENHANCE y cobro de INFO/ENHANCE (§9.5);
   - contador c9 `0x60af9` (§8.2).

### 15.1 Decisiones provisionales [DIS] de la fase de enemigos e IA

Valores elegidos para huecos que aún no se han documentado. Se sustituirán cuando se analice la rutina citada.

| Comportamiento | Valor provisional | Pendiente de |
|---|---|---|
| ~~Seguidor persuadido~~ | Resuelto (`0x33370`, §7.1) | — |
| ~~Huida~~ | Resuelto (`0x33660`, `0x306d0`, §7.1) | — |
| Recogida de objetos | Se recoge al llegar a menos de 0x80 u | estado 9 (`0x32720`) exige la misma posición; el remake mantiene 0x80 |
| Alcance del PERSUADERTRON | resuelto: §6.4 (pasivo, rejilla según los ojos) | — |
| Abertura de la escopeta | 7 trazas con orientaciones −12, −8 … +12 (paso 4) más la dispersión | `0x31f60` |
| Caza enemiga | También dispara si la línea de tiro cruza a otro miembro del grupo del blanco | `0x34590` |
| ~~Desvío ante obstáculos~~ | Resuelto en la fase de pulido (§7.5) | — |
| ~~Destino de grupo~~ | Resuelto: reparto 2×2 en la casilla (§11) | — |
| Quién conduce | En el original, cualquier ocupante en estado 2/3 llama a `0x37110` sobre el vehículo; el remake solo deja conducir al conductor, para que un grupo dentro de un coche no lo mueva varias veces por ciclo | comprobar en el original con varios agentes dentro |
| Vehículos destruidos y trenes | Los vehículos no reciben daño y los vagones (9, 10) no se mueven | rutina de actualización de vehículos (no localizada) |
| Opciones de idioma y volumen | El original fija el idioma y el volumen en la instalación (SETUP); el remake ofrece un panel bajo el lienzo con idioma (en/fr/it con los textos originales, y **español**, traducción propia del remake en `src/i18n/`), volumen de música y de efectos, guardado en localStorage. El español se añade al cargar como clave `es` de cada texto `{en, fr, it}` y de cada briefing (mismas secciones «|» de INFO). Los acentos se convierten a CP437 para las fuentes; como en los textos franceses del original, las mayúsculas van sin acento (los glifos acentuados tienen forma de minúscula), salvo la Ñ (0xA5); HFNT01, sin glifos acentuados, recibe la letra sin acento | — |
| Gráficos mejorados (por defecto; se puede volver a «Gráficos originales») | Lienzo de 1280×720 (16:9): el espacio lógico conserva sus 400 filas (escala 1,8) y mide ≈711 de ancho; la misión usa todo el ancho (la vista se ensancha a la derecha del panel y se ve más ciudad; el desplazamiento por el borde, el centrado y el sonido «en pantalla» usan el borde nuevo) y las pantallas de gestión de 640×400 se centran con bandas negras. Atlas de bloques, sprites y cursores ampliados ×2 con Scale2x sobre los índices de paleta (sin colores nuevos), y pantallas VGA ampliadas igual cada fotograma; suavizado al escalar. Posición de dibujo interpolada entre el ciclo anterior y el actual (no en saltos de más de 0x200) con precisión de medio píxel. Efectos futuristas sin efecto en la simulación: bloom de las zonas brillantes, gradación cian/magenta, viñeta, neón bajo los vehículos, destellos de efectos y disparos, anillo holográfico de selección y HUD con bordes de neón y barrido de radar. El modo original no cambia nada de lo anterior | — |
| Trucos | Solo con el parámetro `cheat` en la URL aparece un menú «Trucos» en la barra superior. «Agentes invulnerables» hace que los agentes de la escuadra ignoren balas, explosiones, fuego, atropellos, el daño de las reacciones y el suelo mortal (clase 10). Se aplica en vivo y no se guarda | — |

---

## 16. Datos extraídos (fase 3)

`tools/extract-assets.mjs` lee la instalación del usuario y escribe en `assets/`, que no se versiona. Todo el JSON tiene estructura propia; los PNG de `gfx/` son **indexados**: R = índice de paleta y A = 0 para transparente. El remake los recolorea con la paleta de cada misión.

| Fichero | Contenido |
|---|---|
| `palettes.json` | `{hpal01..05, hpalette, mselect}`: 256 × `[r,g,b]` de 8 bits |
| `gfx/blocks.png/.json` | 256 tiles de 64×48 en 16 columnas |
| `gfx/sprites.png/.json` | `sprites[i] = {x,y,w,h}` (atlas), `anims[a] = primerFrame`, `frames[f] = {first,w,h,flags,next}`, `elements[e] = {sprite,dx,dy,flip,next}` |
| `gfx/sprites1.*` | segundo juego de sprites (HSPR‑1) |
| `gfx/pointers.*` | 6 cursores de misión (32×32, sin la fila 0 de la TAB) |
| `gfx/mconscr.bin` | fondo de CONFIGURE COMPANY sin recuadros (320×200, índices) |
| `gfx/menu-sprites.*`, `gfx/menu-font.*` | sprites RLE de menú (1180) y fuente de menú (205) |
| `anims/*.flc` + `anims/index.json` | 25 animaciones FLIC (`{file,width,height,frames}`); el remake las decodifica en ejecución |
| `data/tile-classes.json` | 256 clases (COL01) |
| `data/weapons.json` | por tipo: `name{en,fr,it}`, `available`, `price`, `needsResearch`, `maxAmmo` (M; capacidad M+1), `reloadCostPerUnit`, `range`, `catalogRange`, `researchCost`, `fireMode` (P), `activationWindow` (L), `weight`, `researchInitial`, `group` |
| `data/mods.json` | 18 mejoras: `part`, `version`, `name`, `price`, `researchCost`, `researchInitial` |
| `data/territories.json` | 50 territorios: `name`, `mission`, `rect`, `labelPos`, `neighbors[]` (índices) |
| `data/agent-names.json` | 69 nombres de agente |
| `data/level-palettes.json` | número de HPAL por misión |
| `data/strings.json` | todas las cadenas del objeto de datos de MAIN.EXE por dirección (base para los textos de la interfaz) |
| `data/briefings.json` | `{misión: {en/fr/it: {infoCosts[3], enhanceCosts[3], sections[]}}}` |
| `maps/mapNN.json` | `{width:128, height:96, depth:12, tiles: base64}`, con `tiles[(y·128+x)·12+z]` = id de tile |
| `levels/gameNN.json` | `seed`, `map`, `people[]`, `vehicles[]`, `statics[]`, `items[]`, `scenarios[]` y `objectives[]`; las referencias son `{pool,index}` (ver `tools/lib/level.mjs`); cada registro conserva `raw` (hex) para los campos aún no nombrados |
| `audio/<set>/<n>.wav` + `audio/<set>.json` | efectos (VOC → WAV de 8 bits) |
| `audio/music/*.mid` | música (XMI → MIDI) |
| `preview/*.png` | previsualizaciones en color (solo para revisar) |

Tests: `node --test test/` comprueba RNC, armas, direcciones, territorios, mejoras, GAME01, FLIC y VOC frente a esta especificación.
