// Efectos del modo de gráficos mejorado [DIS] (SPEC §15.1): estética futurista sobre los
// gráficos originales. Nada de esto existe en el original y no cambia la simulación:
// - posproceso de toda la imagen: resplandor de las zonas brillantes (bloom), gradación de
//   color cian/magenta y viñeta;
// - luces en la misión: neón bajo los vehículos, destellos de explosiones, fuego e impactos,
//   fogonazos al disparar y un anillo holográfico en los agentes seleccionados;
// - HUD holográfico: bordes de neón y barrido de radar en el escáner.

const NEON_CYAN = '0,240,255', NEON_MAGENTA = '255,40,200', FIRE = '255,150,40';
const BLOOM_SCALE = 4;                 // el bloom se calcula a 1/4 de la resolución interna
const BLOOM_FILTER = 'brightness(0.85) contrast(2.4) saturate(1.6) blur(2px)';
const BLOOM_ALPHA = 0.55;
const SWEEP_PERIOD = 2.4;              // s por vuelta del radar del escáner

export class Effects {
  constructor() { this.time = 0; this.last = performance.now(); }

  /** Avanza el reloj de las animaciones de los efectos (independiente de la simulación). */
  tick() {
    const now = performance.now();
    this.time += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
  }

  // ---------------------------------------------------------------- luces de la misión

  /** Halo aditivo de color `rgb` en (x, y) con radio r. */
  glow(g, x, y, r, rgb, alpha = 1, squash = 1) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(x, y); g.scale(1, squash);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(${rgb},${0.55 * alpha})`);
    grad.addColorStop(0.4, `rgba(${rgb},${0.22 * alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }

  /** Neón bajo un vehículo (antes de pintarlo): elipse cian que late suavemente. */
  underglow(g, sx, sy, seed = 0) {
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 3 + seed);
    this.glow(g, sx, sy - 4, 42, NEON_CYAN, 1.6 * pulse, 0.42);
    this.glow(g, sx, sy - 4, 22, NEON_MAGENTA, 1.1 * pulse, 0.42);
  }

  /** Destello de un efecto (explosión, fuego, impacto). */
  flash(g, sx, sy, big) {
    const flicker = 0.8 + 0.2 * Math.sin(this.time * 40 + sx);
    this.glow(g, sx, sy - 10, big ? 70 : 26, FIRE, flicker);
  }

  /** Fogonazo de un arma al disparar. */
  muzzle(g, sx, sy) { this.glow(g, sx, sy - 16, 22, '255,240,180', 0.9); }

  /** Anillo holográfico animado bajo un agente seleccionado. */
  selection(g, sx, sy) {
    const t = this.time;
    g.save();
    g.translate(sx, sy); g.scale(1, 0.5);
    g.shadowColor = `rgb(${NEON_CYAN})`; g.shadowBlur = 8;
    g.lineWidth = 1.5;
    g.strokeStyle = `rgba(${NEON_CYAN},0.9)`;
    g.setLineDash([5, 4]); g.lineDashOffset = -t * 20;
    g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = `rgba(${NEON_CYAN},${0.35 + 0.25 * Math.sin(t * 4)})`;
    g.beginPath(); g.arc(0, 0, 16 + 2 * Math.sin(t * 4), 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- HUD holográfico

  /** Bordes de neón del panel y barrido de radar en el escáner (x, y, w, h). */
  hud(g, panelW, panelH, scanner) {
    const t = this.time;
    g.save();
    // Línea de neón entre el panel y la vista.
    g.shadowColor = `rgb(${NEON_CYAN})`; g.shadowBlur = 10;
    g.strokeStyle = `rgba(${NEON_CYAN},0.85)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(panelW - 0.5, 0); g.lineTo(panelW - 0.5, panelH); g.stroke();
    // Escáner: marco, retícula tenue y barrido.
    const { x, y, w, h } = scanner, cx = x + w / 2, cy = y + h / 2;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.shadowBlur = 0;
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = `rgba(${NEON_CYAN},0.12)`;
    for (let r = 16; r < w; r += 16) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    const a = (t / SWEEP_PERIOD) * Math.PI * 2;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      const b = a - i * 0.06;
      g.strokeStyle = `rgba(${NEON_CYAN},${0.35 * (1 - i / 12)})`;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(b) * w, cy + Math.sin(b) * h); g.stroke();
    }
    g.restore();
  }

  // ---------------------------------------------------------------- posproceso

  /** Bloom, gradación y viñeta sobre todo el lienzo (en píxeles reales). */
  post(ctx) {
    const c = ctx.canvas, W = c.width, H = c.height;
    const w = Math.max(1, Math.round(W / BLOOM_SCALE)), h = Math.max(1, Math.round(H / BLOOM_SCALE));
    if (!this.small || this.small.width !== w) { this.small = new OffscreenCanvas(w, h); this.sg = this.small.getContext('2d'); }
    const sg = this.sg;
    sg.filter = BLOOM_FILTER;
    sg.clearRect(0, 0, w, h);
    sg.drawImage(c, 0, 0, w, h);
    sg.filter = 'none';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // Bloom aditivo.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = BLOOM_ALPHA;
    ctx.drawImage(this.small, 0, 0, W, H);
    // Gradación: cian arriba, magenta abajo.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'soft-light';
    const grade = ctx.createLinearGradient(0, 0, 0, H);
    grade.addColorStop(0, 'rgba(0,200,255,0.35)');
    grade.addColorStop(1, 'rgba(255,0,170,0.30)');
    ctx.fillStyle = grade; ctx.fillRect(0, 0, W, H);
    // Viñeta.
    ctx.globalCompositeOperation = 'source-over';
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,10,0.55)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
