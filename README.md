# Syndicate — reimplementación en HTML5 + JavaScript

Juego nuevo escrito desde cero que reproduce las reglas de *Syndicate* (Bullfrog, 1993). No es un emulador: no ejecuta ni incluye código del original. Los gráficos, sonidos y textos se extraen de **tu** instalación.

- Especificación con evidencias: [SPEC.md](SPEC.md)
- Estado: [PROGRESS.md](PROGRESS.md)

## Extraer los recursos
Hace falta Node 20 o superior y una instalación del juego (la versión de GOG funciona).
```bash
node tools/extract-assets.mjs "C:/GOG Games/Syndicate Plus/SYNDICAT"
```
Genera `assets/`, que no se versiona ni se redistribuye.

## Tests
```bash
node --test test/
```

## Jugar
```bash
node tools/serve.mjs 8090
```
Abre http://localhost:8090/ para la campaña: clic para empezar → intro (se salta con un clic) → título → MAIN MENU → BEGIN MISSION → mapa → BRIEF → ACCEPT → CRYO → ACCEPT. La partida se guarda sola tras cada misión; LOAD AND SAVE GAME ofrece 10 ranuras.

Para ir directo a una misión: http://localhost:8090/?mission=N.

Trucos: añade `cheat` a la URL (http://localhost:8090/?cheat o ?mission=N&cheat) y aparece el menú «Trucos» en la barra superior, con «Agentes invulnerables».

Sonido: efectos y voces originales (VOC); la música son los MIDI originales con un sintetizador propio, porque emular el chip OPL está fuera del alcance del proyecto.

Opciones (barra superior, se recuerdan en el navegador): idioma —inglés, francés e italiano con los textos originales, y español, traducción propia del remake (menús, briefings de las 50 misiones, objetos, territorios e intro)— y volumen de la música y de los efectos.

Pantallas de gestión (gráficos, fuentes y animaciones originales):
- **Título:** clic o tecla. **MAIN MENU:** clic o F1–F5.
- **CONFIGURE COMPANY:** elige COLOUR AND LOGO (flechas de color y logo), COMPANY NAME o YOUR NAME (escribe; Intro confirma), OK o CANCEL; ACCEPT guarda y MENU descarta.
- **Mapa:** clic en un territorio; parpadean los elegibles. −/+ cambian el impuesto (clic derecho: ±10). BRIEF abre el briefing.
- **Briefing:** INFO y ENHANCE compran información y detalle del minimapa; las flechas pasan de página; mantener pulsado en los bordes del minimapa lo desplaza. ACCEPT lleva al equipo.
- **CRYO:** las casillas 1–4 eligen puesto; en TEAM, un clic en un nombre lo mete o lo saca. MODS y EQUIP listan lo investigado (clic → detalle → PURCHASE). Un clic en el inventario permite RELOAD y SELL. ACCEPT empieza la misión.
- **RESEARCH:** clic en un investigable → RESEARCH; FUNDING +/− ajustan la financiación.
- **LOAD/SAVE:** elige una ranura, escribe un nombre y pulsa SAVE, o LOAD para cargarla.

Controles:
- **Selección:** 1–4 elige un agente; 0 o la barra del panel, el grupo entero.
- **Movimiento:** clic izquierdo en el suelo mueve a la selección (el grupo se reparte en la casilla); sobre un objeto, lo recoge.
- **Vehículos:** clic en un vehículo para subir (el primero conduce); con el agente dentro, clic en el suelo para conducir hasta allí y clic en el propio vehículo para bajar.
- **Cursor:** flecha en el mapa, mano sobre un objeto, mira sobre un enemigo a tiro del arma equipada (si no está a tiro, otra mira).
- **Escáner:** abajo a la izquierda; la baliza marca el objetivo pendiente.
- **Combate:** los agentes empiezan con la pistola enfundada; clic en un hueco del inventario la equipa. Clic derecho dispara a una persona o a un punto; mantenerlo repite con armas automáticas. Con el MEDIKIT equipado, el clic derecho cura.
- **Barras:** clic en adrenalina, percepción o inteligencia del panel fija su nivel para la selección.
- **Misión:** Esc dos veces abandona.
- **Cámara:** flechas o borde de la pantalla.
- **Juego:** P pausa; F3/F4 cambian la velocidad.
- **Depuración:** Mayús+D muestra la superposición.
