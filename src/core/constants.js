// Constantes del mundo y del tiempo (SPEC §2–§3).

export const TILE = 256;                 // unidades por casilla en X/Y
export const LEVEL = 128;                // unidades por nivel en Z
export const MAP_WIDTH = 128;
export const MAP_HEIGHT = 96;
export const MAP_DEPTH = 12;
export const WORLD_HEIGHT = MAP_DEPTH * LEVEL;

export const TIMER_HZ = 1193182 / 16384;          // 72,83 Hz
export const DEFAULT_TICKS_PER_CYCLE = 7;         // limitador por defecto (F3/F4 lo cambian, 0..12)
export const cycleSeconds = (ticks) => Math.max(ticks, 1) / TIMER_HZ;

// Pantalla lógica de la misión: 640×400, panel de 128 px a la izquierda.
export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 400;
export const PANEL_WIDTH = 128;
export const VIEW_ORIGIN_X = 128;        // proyección: sx = (dx-dy)/8 + 128
export const VIEW_ORIGIN_Y = 16;         //             sy = ((dx+dy)/2 - z)/8 + 16
