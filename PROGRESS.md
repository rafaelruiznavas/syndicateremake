# Progreso del remake

| Fase | Estado | Notas |
|---|---|---|
| 1. Reconocimiento | ✅ | `SYND.EXE` es un lanzador; el juego es `SYNDICAT\MAIN.EXE` (LE, DOS/4GW). |
| 2. Especificación | ✅ aprobada, viva | `SPEC.md`; ampliada en las fases 3 y 5 (§5.4, §6.1b–c, §6.4, §7.1–7.3, §8, §9, §12.1–12.3, §13, §13.1, §15.1). |
| 3. Datos a JSON | ✅ | `tools/extract-assets.mjs`; esquemas en SPEC §16. |
| 4. Arquitectura | ✅ aprobada | SPEC §14. |
| 5. Implementación | 🟡 núcleo, enemigos e IA, progresión, interfaz y menús, audio | Sigue pulido. |
| 6. Verificación | 🟡 | 53 tests (`node --test test/`). |

## Fase 5 — núcleo jugable ✅
- **Bucle:** paso fijo de 7/72,83 s por ciclo con acumulador; F3/F4 cambian los ticks por ciclo (0..12); P pausa.
- **Mundo:** mapa 128×96×12 con clases COL01; terreno (superficie, suelo, regla de ±32, muros, rampas); índice espacial de 256 u; colisión AABB con las cajas de la SPEC.
- **Personas:**
  - máquina de estados (parado y andando);
  - velocidad por piernas, adrenalina, mínimos 12/16 y carga;
  - animación por conjunto, postura, arma y octante;
  - avance de frames;
  - reteñido de agentes por sindicato.
- **Escuadra:** casillas 0..3 del grupo 0 con datos de plantilla; casillas 4..7 retiradas.
- **Render:** proyección original, tiles y sprites con la paleta de la misión, orden por diagonales.
- **Entrada:**
  - selección de agente (teclas 1–4 o cajas del panel) y de grupo (0 o barra);
  - orden de mover con clic en el suelo;
  - desplazamiento con flechas o borde de pantalla;
  - superposición de depuración con Mayús+D.
- **HUD básico:** cajas de agente con salud, barra de grupo, huecos de inventario y escáner simplificado, con la disposición del original.

Verificado en el navegador con la misión 1: terreno, árboles y agentes igual que en el original; el grupo camina a 16 u/ciclo y se detiene en el destino.

## Fase 5 — enemigos e IA ✅
- **Estados de persona:** los 45 números del original (`0x34110`) con resolución de eventos por prioridad y siguiente estado (`0x30250`); reacciones al daño, muerte, quemado y muerte por terreno; apuntar, disparar, seguir, huir, perseguir, advertir y esperar.
- **Barras:** adrenalina (velocidad), percepción (dispersión y distancias), inteligencia; ajustables desde el panel; regeneración de salud por el pecho.
- **Percepción** (`0x31830`): 8 personas por ciclo, lista de visibles con banderas; reglas de policía (advertencia y sonido), civiles (huida), guardias y agentes.
- **Armas:** activación (`0x31ec0`), elección automática (`0x3a390`), trazas de bala con dispersión `15 − p(15)`, escopeta, minigun, destellos de impacto; munición e inventario de 8 huecos; MEDIKIT; recogida de objetos del suelo.
- **Daño:** caja de impacto, resistencia del pecho (siempre, 1/2, 1/4, 1/6), escudo, daño por tipo de evento, soltar objetos al morir, estadísticas de bajas y buscado/agresivo.
- **Persuasión** (`0x302a0`): puntos por seguidores y nivel de cerebro; el PERSUADERTRON convierte a los cercanos.
- **Escenarios** (`0x97c70`): pasos de andar, esperar y repetir para civiles y guardias.
- **Agentes enemigos** (`0x15b10`/`0x15c60`): grupos guionizados, mejoras y arma según nivel, pasos de patrulla, espera y caza al 90 % del alcance; aturdimiento al recibir balas.
- **Objetivos** (`0x105e0`): persuadir, asesinar, proteger, conseguir objeto, eliminar policía o agentes, destruir, evacuar; fracaso si cae la escuadra; Esc×2 abandona; pantalla de fin con estadísticas.
- **Controles nuevos:** clic derecho dispara (mantenido repite con armas automáticas), clic izquierdo sobre un objeto lo recoge, clic en el inventario equipa, clic en las barras las ajusta.

Verificado en el navegador:
- GAME01: equipar la pistola y disparar al objetivo completa la misión con la pantalla de fin.
- GAME02: las patrullas enemigas siguen su guion; al acercarse disparan con UZI, el agente alcanzado se aturde y la escuadra puede morir (fuego amigo incluido).

## Fase 5 — progresión ✅
Analizado con REA:

| Rutina | Contenido |
|---|---|
| `0x18810` | reloj |
| `0x18bd0`, `0x18cf0` | descontento e ingreso |
| `0x18d80` | expansión rival |
| `0x23880` | partida nueva |
| `0x23120`, `0x23370` | compras |
| `0x1fbc0` | CRYO: recarga, venta y escala del reloj |
| `0x35e20`, `0x34ad0`, `0x36190` | investigación |
| `0x27e00`, `0x28d60`, `0x28fe0` | mapa, elegibles e impuestos |
| `0x246d0` | vuelta de la misión |
| `0x18ff0` | informe |
| `0x37f80` | conquista y fin de partida |

Implementado en `src/campaign/` y en escenas nuevas:
- **Campaña:**
  - partida nueva con 8 agentes en 18 huecos, 30 000 créditos y territorios rivales;
  - reloj de pantalla (día de 4032) y de misión (día de 1008), con /3 al entrar y ×4 al salir;
  - guardado y carga en `localStorage`.
- **Territorios:**
  - descontento, conservando el error de índice del original;
  - ingresos con la regla del territorio actual;
  - población;
  - expansión diaria de los 7 rivales;
  - impuestos ±1/±10;
  - elegibles: WESTERN EUROPE, vecinos y rebeliones;
  - conquista, rebelión a 170 y victoria con los 50.
- **Investigación:**
  - proyecto único con 10 niveles de financiación (×1…×100);
  - gráfica de 240 horas;
  - paro por falta de fondos;
  - desbloqueo del sucesor (nuevo campo `next` en el extractor);
  - armas nuevas traídas de misión con +600.
- **CRYO:**
  - equipo de 4;
  - mejoras por partes (sustituyen la versión);
  - compra con munición de catálogo, recarga de un objeto (catálogo, nuevo campo `catalogReloadCost`) o de todos (tablas), y venta (100 % o 25 %);
  - modo grupo.
- **Briefing:** texto por bloques con compras de INFO y ENHANCE.
- **Vuelta de la misión:**
  - recompensas por persuadidos (50/150/150/300);
  - reclutamiento de agentes persuadidos;
  - pérdida de los muertos;
  - el inventario es el que se trae, salvo si se abandona;
  - penalización de población por muertes;
  - informe con las 11 líneas;
  - fin de partida.
- **Flujo:** menú → mapa → briefing → CRYO → misión → informe → mapa. `?mission=N` sigue lanzando una misión directa.

Verificado en el navegador:
- partida nueva → WESTERN EUROPE → INFO (−100) → CRYO (4 escopetas en grupo, −1000) → misión con ese inventario → objetivo abatido → informe COMPLETED con un 42 % de precisión;
- WESTERN EUROPE pasa al jugador y SCANDINAVIA queda elegible (único vecino según el binario);
- 3 días de reloj: ingresos y la investigación de la UZI completada;
- guardar y cargar devuelve el mismo estado.

## Fase 5 — interfaz y menús ✅
Analizado con REA:

| Rutina | Contenido |
|---|---|
| `0x37600` | despachador de pantallas y MAIN MENU |
| `0x37ef0` | animación de entrada |
| `0x3c558` | reproductor FLIC |
| `0x42aee`, `0x4cfec` | modo 13h con coordenadas de 640 divididas entre 2 |
| `0x38f50`, `0x38ac0`, `0x38c90` | texto MSPR, botones y caja de texto |
| `0x27e00`, `0x28cb0`, `0x28af0`, `0x28490`, `0x28610`, `0x28e90` | mapa |
| `0x10e60`, `0x11a70` | briefing y minimapa |
| `0x1fbc0`, `0x22a10`, `0x22fe0` | CRYO |
| `0x34ad0` | RESEARCH |
| `0x18ff0` | informe |
| `0x26ef0` | LOAD/SAVE |
| `0x2d0e0`, `0x2e4a0`, `0x2ee30`, `0x1e1c0` | panel de misión |
| `0x4f69b` | fuente HFNT01 |

Tablas de rectángulos: `0x5b5b0`, `0x5b6a0`, `0x5b77c`, `0x5b808`, `0x55112`, `0x5b55c` y `0x5b416`.

Implementado:
- **Framebuffer** VGA de 320×200 con paleta de 6 bits y coordenadas lógicas de 640×400 (`src/ui/vga.js`).
- **Reproductor FLIC** (`src/ui/flic-player.js`; el decodificador está ahora en `src/formats/flic.js` y lo comparte el extractor).
- **Texto MSPR** y botones con resaltado (`src/ui/menu-gfx.js`).
- **Fuente HFNT01** (`src/ui/mission-font.js`).
- **Pantallas** con su animación de entrada y salida, con la base común en `src/scenes/menu-screen.js`:
  - título (MTITLE), MSCRENUP y MAIN MENU con F1–F5;
  - **mapa mundial:**
    - máscaras MMAPBLK coloreadas por sindicato;
    - parpadeo de elegibles y rebeliones;
    - línea animada a la etiqueta y mini‑logo;
    - POP, TAX (ingreso @ impuesto %, botones −/+) y STAT;
  - **briefing:**
    - texto paginado con flechas;
    - INFO y ENHANCE por territorio;
    - minimapa con zoom `(5−ENHANCE)·2`, desplazable, con las marcas «O»/«A»;
  - **CRYO:**
    - equipo 2×2 y cuerpo compuesto por mejoras;
    - inventario con munición;
    - listas TEAM, MODS y EQUIP con detalle, PURCHASE, RELOAD y SELL;
  - **RESEARCH:** listas, FUNDING ±, gráfica y previsión;
  - **informe** con sus 11 líneas;
  - **LOAD/SAVE:** 10 ranuras con nombre editable;
  - **animaciones de resultado:** MGAMEWIN, MENDWIN, MENDLOSE y MLOSEGAM.
- **Panel de misión** con los sprites HSTA `0xd4+`:
  - cajas de agente con su figura animada;
  - salud;
  - barras de adrenalina, percepción e inteligencia bajo cada caja, ajustables con un clic;
  - barra de grupo;
  - inventario con iconos y munición;
  - línea de mensajes en HFNT01.
- **Datos nuevos del extractor:**
  - `data/ui.json` (etiquetas en 3 idiomas, colores de sindicato, descripciones de mejoras y animaciones por pantalla);
  - `gfx/map-masks.bin`, `gfx/logos.bin` y `gfx/mini-logos.bin`;
  - marcas y texto en bruto de los briefings.
- **Corrección:** los FLIC solo decodificaban 2 fotogramas, porque el campo de tamaño de frame no es fiable; ahora se encadenan por el final de los chunks.

Verificado en el navegador:
- título → menú → mapa → briefing (INFO −100) → CRYO → misión;
- objetivo abatido → MGAMEWIN → MSCRENUP → informe → mapa con WESTERN EUROPE conquistada;
- panel de misión, LOAD/SAVE.

## Fase 5 — audio ✅
Analizado con REA, en MAIN.EXE y en INTRO.EXE (aplanado con las mismas herramientas):

| Rutina | Contenido |
|---|---|
| `0x387e0`, `0x38790` | peticiones por ciclo |
| `0x1d450`, `0x1e050` | sonido de fotogramas |
| `0x10360` | posicional |
| `0x3a970` | disparo por arma |
| `0x104c0`, `0x10510` | fin de misión |
| `0x10010`, `0x3b8a0` | música de misión |
| `0x3ba60` y tablas `0x5bb94`… | señales de las animaciones |
| `0x274a0` | arranque: `intro >nul`, SYNGAME.XMI con GAMEFM.DLL |
| INTRO.EXE `0x101ac`, `0x105dc`, `0x10794` | intro |

Implementado:
- **`src/audio/audio.js`:**
  - bancos WAV (SOUND-0 de misión, SOUND-1 de las animaciones de fin, ISNDS-0 de la intro);
  - peticiones por ciclo con el volumen máximo;
  - desbloqueo con el primer gesto.
- **`src/audio/mission-audio.js`:**
  - sonidos del byte bajo de los flags de cada fotograma visible;
  - posicionales con el margen de `0x10360` (disparos por arma, advertencia de la policía, impacto);
  - fin de misión (0x17/0x18);
  - música 0 / 1 (agente rival a < 0x1000 del líder) / 3 / 4.
- **`src/audio/midi.js` y `src/audio/music.js`:**
  - lector SMF con tempo;
  - secuenciador con programación anticipada;
  - sintetizador propio ([DIS], sin emular OPL): voces por familia GM, ADSR y percusión de ruido.
- **Señales en las FLIC** (`FlicPlayer`):
  - A (velocidad), S (sonido) y M (música) en MGAMEWIN, MENDLOSE, MLOSEGAM y MENDWIN;
  - saltar la animación no las ejecuta.
- **Intro** (`src/scenes/intro.js`):
  - pantalla de inicio para el audio ([DIS]);
  - INTRO.DAT con sus 149 señales;
  - sonidos ISNDS, música INTRO.XMI;
  - subtítulos MFNT en 3 idiomas, en la franja inferior;
  - se salta con un clic o una tecla.
- **Extractor:** `data/anim-cues.json` (señales de MAIN e INTRO) y `data/intro.json` (subtítulos).

Verificado en el navegador:
- intro con música, voz y subtítulo «SUBJECT STATISTICS : WEIGHT :70KGS» en su fotograma;
- en GAME02 suenan la pistola (2), el aviso de la policía (0x1c) y la UZI enemiga (0xb), y la música pasa a la secuencia 1 al acercarse un agente rival;
- MGAMEWIN reproduce 7, 8 y 9, y MENDWIN el 3 y la música 2.

## Fase 5 — pulido ✅
Analizado con REA (MAIN.EXE):

| Rutina | Contenido |
|---|---|
| `0x37110`, `0x36a50`, `0x36ec0`, `0x36c20`, `0x36900`, `0x36940`, `0x369d0`, `0x36a20` | conducción: línea recta, carreteras por sentido, carril, mirada adelante |
| `0x321c0`, `0x32300`, `0x32480`, `0x32560`, `0x33dc0`, `0x31fc0` | ir a un vehículo, subir, bajar, dentro, esperar a un agente, pasos de escenario 2/3/6/8 |
| `0x307b0`, `0x30cc0`, `0x30db0`, `0x32930`, `0x2ff80`, `0x2fff0`, `0x2fd20`, `0x2fe70` | desvío: la pared es el primer eje **bloqueado**; simulación izquierda/derecha de 32 pasos |
| `0x12400`, `0x125f0` | suelo: los peatones fuera de la calzada no pisan carreteras; agentes y quien ya está en ellas, sí |
| `0x25a10`, `0x258f0` | órdenes: reparto 2×2 del grupo, aceptación inmediata o diferida; 5 recoger, 9 subir, 0x19 bajar |
| `0x1bec0`, `0x1b5d0`, `0x1bbd0`, `0x2d0e0` | escáner: suelo por clase, puntos, cruz, baliza con sonido 0x11, zoom 4 con escáner |
| `0x2cb40`, `0x4165e` | cursores HPOINTER contextuales |
| `0x175c0`, `0x18250`, `0x186f0`, `0x390c0` | CONFIGURE COMPANY |

Implementado:
- **Vehículos** (`src/entities/entity.js`, `src/systems/vehicles.js`): orientación y 8 animaciones, ocupantes (el primero conduce), conducción por carretera y en línea recta, subir/bajar, ocupantes iniciales del nivel. Clic en un vehículo: subir (orden 9); clic en el propio: bajar (0x19).
- **Escenarios:** pasos 2, 3, 6 y 8 (esperar a un agente en una zona de 5×7); los pasos en curso al cargar el nivel (estado 0x28 o 3) se conservan. En la misión 1 el objetivo espera, huye en su coche cuando llega un agente y la misión fracasa si escapa.
- **Desvío** (`src/systems/detour.js`) y estados 0xE/0xF; **suelo de carretera** por tipo de persona.
- **Órdenes** con la aceptación de `0x258f0` y el reparto 2×2 del grupo.
- **Escáner** (`src/render/scanner.js`) y **cursores** (`MissionScene.cursorAt`), con el nombre del objeto del suelo en la línea de mensajes.
- **CONFIGURE COMPANY** (`src/scenes/configure.js`): color (cambia con el rival que lo tenía), logo, nombre de la compañía y del jugador; la campaña guarda los colores de los 8 sindicatos y el mapa los usa.
- **Opciones** [DIS] (`src/ui/options.js`): idioma en/fr/it y volúmenes de música y efectos bajo el lienzo, en localStorage.
- **Extractor:** etiquetas de CONFIGURE, `gfx/mconscr.bin`; HPOINTER sin la fila 0, que no es imagen.

Verificado:
- 78 pruebas (`npm test`), entre ellas la huida en coche de la misión 1 y los giros en un cruce de GAME02;
- simulación de los 50 niveles sin errores; los coches circulan en las misiones con tráfico;
- en el navegador: tráfico de GAME02, escáner, cursores, CONFIGURE COMPANY y cambio de idioma en vivo;
- coste medido en GAME02: render 1,6 ms por fotograma y simulación 0,14 ms por ciclo, así que no hizo falta optimizar.

## Vehículos: destrucción y trenes ✅
Analizado con REA (MAIN.EXE): `0x39890` (ciclo de vehículos), `0x39660` (intacto), `0x395d0` (eventos), `0x39530` (aviso a los ocupantes), `0x39730`/`0x394e0` (ardiendo), `0x13870` (bala contra vehículo), `0x12880` (caja de eventos), `0x1eb80`/`0x1ea30` (explosión y llamas).

Implementado (`src/systems/vehicles.js` `VehicleUpdate`, `src/entities/entity.js` `Vehicle`, `src/systems/damage.js`):
- tabla de modelos: intacto → ardiendo → chatarra, con la animación de cada condición y orientación;
- las balas restan 1 de resistencia; fuego −10, láser y explosión −300; el conductor no daña su vehículo;
- al recibir daño los civiles bajan y huyen, y policías y guardias bajan y persiguen al atacante;
- con resistencia < 0: explosión (sonido 9, onda que encadena vehículos cercanos, llamas que suben), 100 ciclos ardiendo con los ocupantes saliendo en llamas, y chatarra;
- atropello con un agente al volante (o en locomotora) a más de 0x1F;
- trenes: vagones y locomotora de cola enganchados (`+0x20`) siguen a la locomotora de cabeza;
- los objetivos 14 (destruir) y 15 (capturar vehículo, fracasa si se destruye) ya pueden cumplirse o fallar.

Verificado: 87 pruebas (`npm test`), entre ellas un coche de GAME02 tiroteado con la MINI-GUN que explota, arde 101 ciclos y queda en chatarra, y el tren de GAME03; simulación de 600 ciclos en los 50 niveles sin errores (los vagones se mueven).

## Español ✅
- Traducción propia [DIS] en `src/i18n/`: 202 textos cortos (menús, etiquetas, mejoras, armas, territorios, subtítulos de la intro), los briefings de las 50 misiones con sus mismas secciones de INFO y los textos propios del remake (pausa, fin de misión…).
- Se añade al cargar como cuarto idioma (`es`) y se elige en la barra superior.
- Los acentos van a CP437; las mayúsculas sin acento, como el francés del original, salvo la Ñ. En el panel de la misión (HFNT01, solo ASCII) se quitan los acentos.
- Verificado: pruebas de cobertura (ningún texto sin traducir) y de estructura de los briefings; en el navegador, MAIN MENU y el briefing de la misión 1.

## Corrección del render: rampas y coches ✅
- El render pintaba casilla a casilla e intercalaba cada entidad con los bloques de su columna. Por eso, en las rampas la entidad quedaba tapada por bloques de su propia casilla o los tapaba ella, y los coches (más grandes que una casilla) quedaban cortados por las casillas vecinas.
- Ahora sigue el orden del original (`0x1d450`): todo el mapa, luego las entidades por x+y y, tras cada una, los bloques que tiene delante repintados sobre su rectángulo (`src/render/occlusion.js`).
- Verificado: pruebas de la regla (rampa, coche, suelo, techo) y en el navegador (agente en una rampa de GAME02, coches circulando y pasando detrás de una torre). Coste: 1,9 ms por fotograma.

## Diferencias conocidas
- **Quién conduce:** solo el conductor mueve el vehículo ([DIS], SPEC §15.1).
- **Explosión de vehículos:** la onda se aplica en el mismo ciclo y se crea una sola llama (el original llena el pool de efectos con llamas en el mismo punto); el efecto es el mismo ([DIS], SPEC §7.4). El significado de los bits `0x108` y del contador de daños `0x60af0` sigue abierto.
- **Atascos:** un conductor que no es agente se para ante un peatón en la calzada, como en el original; los civiles quietos sobre un paso de cebra bloquean el tráfico.
- **Seguidores y vehículos:** el estado 0x1E (seguir) no sube al vehículo del líder ([DES] `0x33370`).
- **Oclusión:** se sigue el esquema del original (mapa, entidades por x+y y bloques de delante repintados encima, `0x1d450`), pero el criterio de «delante» es una regla de cajas propia en lugar de las rutinas por subtile de `0x43933` ([DIS], SPEC §5.5).
- **Provisionales [DIS]:** ver SPEC §15.1 (seguir, huir, recoger, alcance del persuasor, abertura de la escopeta, caza enemiga).
- **Paso entre personas:** sin colisión entre ellas al andar.
- **Cámara inicial:** distinta de la del original.
- **Escáner:** el modo `0x60b45` y la opción `0x5e395` (civiles y objetos) no se activan ([DES]); el periodo del parpadeo es [INF].
- **Cursores en las pantallas de gestión:** se usa el del sistema ([DIS]).
- **Minimapa del briefing y suelo del escáner:** el original lee el tile de z = 0 de cada columna; en mapas como el de la misión 1 deja casi todo vacío. Se conserva tal cual.
- **Nombre de los rivales** en OWN del mapa: pendiente ([DES]).
- **Niveles 30 y 40:** solo tienen un objetivo «proteger» y se dan por cumplidos al empezar; parecen niveles sin uso en la campaña.
- **MULTIPLAYER GAME:** no se ofrece, como en la versión de un jugador.
- **Velocidad de las animaciones:** 5 ticks por fotograma (15 en el título) ([INF]); las señales A la cambian donde las hay.
- **Timbres musicales:** aproximados con un sintetizador propio ([DIS]); el original usa FM OPL con los timbres de SAMPLE.AD.
- **Señales L/E de la intro:** sin interpretar ([DES]); los sonidos S n se toman como la entrada n de ISNDS-0 ([INF]).
- **Mezcla:** un sonido se reinicia si vuelve a pedirse mientras suena ([INF]); no hay límite de canales.
- **Semilla:** la de una partida nueva sale del reloj del sistema ([DIS]).

## Siguiente (propuesta)
- Estado 0x1E con vehículos y colisión entre personas.
- Orden de pintado exacto (`0x1d450`).
