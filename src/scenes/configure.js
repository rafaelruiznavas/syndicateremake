// CONFIGURE COMPANY (SPEC §12.2; `0x175c0`, `0x18250`, `0x186f0`, `0x390c0`): color y logo,
// nombre de la compañía y del jugador. Los cambios se guardan con ACCEPT; MENU los descarta.

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';

const Mode = Object.freeze({ SELECT: 0, LOGO: 1, PLAYER_NAME: 2, COMPANY_NAME: 3 });
const COLOURS = 8, LOGOS = 40, NAME_MAX = 16, LOGO_SIZE = 32;
/** Sprites MSPR (desplazamientos de 6 B en la TAB: +0x1e → 5…). */
const SPR = Object.freeze({ LEFT: 5, RIGHT: 6, FRAME: 7, LEFT_HOT: 8, RIGHT_HOT: 9, FRAME_HOT: 10 });
const OPTIONS = [
  { key: 'colourAndLogo', y: 0x40, hit: [0x41, 0x55], mode: Mode.LOGO },
  { key: 'companyName', y: 0x58, hit: [0x59, 0x6d], mode: Mode.COMPANY_NAME },
  { key: 'yourName', y: 0x70, hit: [0x71, 0x85], mode: Mode.PLAYER_NAME },
];
const OPTION_X = [0x144, 0x242];
const OK = [0x122, 0x78, 0x1a2, 0x90], CANCEL = [0x1da, 0x78, 0x25a, 0x90];
const ACCEPT = [0x2e, 0x15a, 0x90, 0x172], MENU = [500, 0x15a, 0x256, 0x172];
const ARROWS = { colour: 0x38, logo: 0x5a, left: 0x198, right: 0x1b6, w: 0x1c, h: 0x14 };
const FIELD = { x: 0x136, y: 0x52, box: [0x130, 0x4a, 0x24c, 0x62], lineHeight: 0xf };
const BOX_COLOR = 0xea, EMPTY_NAME_COLOR = 0x1e, CURSOR_COLORS = [0xfc, 0x58];
/** Interior del panel derecho que se limpia con MCONSCR al cambiar de modo [INF `0x18670`]. */
const PANEL = { x0: 141, y0: 12, x1: 306, y1: 75 };

export class ConfigureScene extends MenuScreen {
  constructor(game) {
    super(game, { anim: 'mconfup', out: 'mconfout' });
    const c = this.campaign;
    this.clock = false;
    this.mode = Mode.SELECT;
    // Valores pendientes (se guardan con ACCEPT) y temporales del modo actual.
    this.pending = { colour: c.colour, logo: c.logo, company: c.companyName, player: c.playerName };
    this.temp = null;
  }

  // ---------------------------------------------------------- dibujo

  draw(vga) {
    const g = this.gfx, p = this.pending;
    this.drawLogoAt(vga, p.logo, p.colour, 0xe, 0xb);
    for (const [name, y, box] of [[p.company, 0x5e, [0x1c, 0x5a, 0xac, 0x6c]], [p.player, 0x74, [0x1c, 0x70, 0xac, 0x82]]]) {
      if (name) g.text(vga, name, 0x1c, y, FONT.SMALL);
      else vga.frame(...box, EMPTY_NAME_COLOR);
    }
    this.button(vga, 'accept', ...ACCEPT);
    this.button(vga, 'menu', ...MENU);
    if (this.mode === Mode.SELECT) this.drawSelect(vga);
    else {
      this.clearPanel(vga);
      if (this.mode === Mode.LOGO) this.drawLogoMode(vga);
      else this.drawNameMode(vga);
      vga.frame(...OK, BOX_COLOR);
      vga.frame(...CANCEL, BOX_COLOR);
      g.centered(vga, this.label('ok'), OK[0], OK[1] + 8, OK[2] - OK[0], this.hot(...OK) ? FONT.HOT : FONT.BUTTON);
      g.centered(vga, this.label('cancel'), CANCEL[0], CANCEL[1] + 8, CANCEL[2] - CANCEL[0], this.hot(...CANCEL) ? FONT.HOT : FONT.BUTTON);
    }
  }

  drawLogoAt(vga, logo, colour, x, y) {
    const a = this.game.assets;
    vga.mask(a.logos, logo * LOGO_SIZE * LOGO_SIZE, LOGO_SIZE, LOGO_SIZE, x, y, a.ui.syndicateColors[colour], 0);
  }

  clearPanel(vga) {
    const bg = this.game.assets.configBackground;
    if (!bg) return;
    for (let y = PANEL.y0; y < PANEL.y1; y++) for (let x = PANEL.x0; x < PANEL.x1; x++) vga.plot(x, y, bg[y * 320 + x]);
  }

  drawSelect(vga) {
    const g = this.gfx;
    g.text(vga, this.label('selectDetail'), 300, 0x22, FONT.HOT);
    for (const o of OPTIONS) {
      const hot = this.optionAt(this.mouse) === o;
      g.sprite(vga, hot ? SPR.FRAME_HOT : SPR.FRAME, OPTION_X[0], o.y);
      g.text(vga, this.label(o.key), 0x16a, o.y + 6, hot ? FONT.HOT : FONT.BUTTON);
    }
  }

  drawLogoMode(vga) {
    const g = this.gfx, t = this.temp;
    g.text(vga, this.label('changeColourLogo'), 0x12e, 0x22, FONT.HOT);
    g.text(vga, this.label('colour'), 0x1dc, 0x3c, FONT.HOT);
    g.text(vga, this.label('logo'), 0x1dc, 0x5e, FONT.HOT);
    this.drawLogoAt(vga, t.logo, t.colour, 0xaa, 0x1a);
    for (const y of [ARROWS.colour, ARROWS.logo]) {
      g.sprite(vga, this.arrowAt(this.mouse)?.y === y && this.arrowAt(this.mouse).dir < 0 ? SPR.LEFT_HOT : SPR.LEFT, ARROWS.left, y);
      g.sprite(vga, this.arrowAt(this.mouse)?.y === y && this.arrowAt(this.mouse).dir > 0 ? SPR.RIGHT_HOT : SPR.RIGHT, ARROWS.right, y);
    }
  }

  drawNameMode(vga) {
    const g = this.gfx, t = this.temp;
    const company = this.mode === Mode.COMPANY_NAME;
    g.text(vga, this.label(company ? 'changeCompanyName' : 'enterYourName'), company ? 0x142 : 0x158, 0x22, FONT.HOT);
    vga.frame(...FIELD.box, BOX_COLOR);
    g.text(vga, t.text, FIELD.x, FIELD.y, FONT.HOT);
    // Cursor: subrayado bajo el carácter actual que parpadea (`0x390c0`).
    const before = g.width(t.text.slice(0, t.cursor), FONT.HOT), ch = t.text[t.cursor] ?? ' ';
    const w = g.size(g.glyph(FONT.HOT, ch)).w || g.size(FONT.HOT).w;
    const y = FIELD.y + FIELD.lineHeight - 2;
    vga.line(FIELD.x + before, y, FIELD.x + before + w - 2, y, CURSOR_COLORS[(this.frame >> 2) & 1]);
  }

  // ---------------------------------------------------------- entrada

  optionAt(m) {
    if (!(m.x > OPTION_X[0] && m.x < OPTION_X[1])) return null;
    return OPTIONS.find((o) => m.y >= o.hit[0] && m.y <= o.hit[1]) ?? null;
  }

  arrowAt(m) {
    for (const y of [ARROWS.colour, ARROWS.logo]) {
      if (!(m.y > y && m.y < y + ARROWS.h)) continue;
      if (m.x > ARROWS.left && m.x < ARROWS.left + ARROWS.w) return { y, dir: -1 };
      if (m.x > ARROWS.right && m.x < ARROWS.right + ARROWS.w) return { y, dir: 1 };
    }
    return null;
  }

  click(e) {
    if (e.button === 'right' && this.mode === Mode.LOGO) { this.cancel(); return; }
    if (this.hot(...ACCEPT, e)) { this.accept(); return; }
    if (this.hot(...MENU, e)) { this.leave(); return; }
    if (this.mode === Mode.SELECT) {
      const o = this.optionAt(e);
      if (o) this.open(o.mode);
      return;
    }
    if (this.mode === Mode.LOGO) {
      const a = this.arrowAt(e);
      if (a?.y === ARROWS.colour) this.temp.colour = (this.temp.colour + a.dir + COLOURS) % COLOURS;
      else if (a?.y === ARROWS.logo) this.temp.logo = (this.temp.logo + a.dir + LOGOS) % LOGOS;
    }
    if (this.hot(...OK, e)) this.confirm();
    else if (this.hot(...CANCEL, e)) this.cancel();
  }

  open(mode) {
    this.mode = mode;
    const p = this.pending;
    if (mode === Mode.LOGO) this.temp = { colour: p.colour, logo: p.logo };
    else { const text = mode === Mode.COMPANY_NAME ? p.company : p.player; this.temp = { text, cursor: text.length }; }
  }

  confirm() {
    const p = this.pending, t = this.temp;
    if (this.mode === Mode.LOGO) { p.colour = t.colour; p.logo = t.logo; }
    else if (this.mode === Mode.COMPANY_NAME) p.company = t.text;
    else if (this.mode === Mode.PLAYER_NAME) p.player = t.text;
    this.mode = Mode.SELECT; this.temp = null;
  }

  cancel() { this.mode = Mode.SELECT; this.temp = null; }

  /** ACCEPT: guarda (salvo mientras se escribe un nombre) y sale. */
  accept() {
    if (this.mode === Mode.PLAYER_NAME || this.mode === Mode.COMPANY_NAME) return;
    const c = this.campaign, p = this.pending;
    c.setColour(p.colour); c.logo = p.logo; c.companyName = p.company; c.playerName = p.player;
    this.leave();
  }

  leave() { this.exit(() => this.game.go('menu')); }

  key(code, ch) {
    if (code === 'Escape') { if (this.mode === Mode.SELECT) this.leave(); else this.cancel(); return true; }
    if (this.mode !== Mode.PLAYER_NAME && this.mode !== Mode.COMPANY_NAME) return false;
    const t = this.temp, s = t.text;
    switch (code) {
      case 'Enter': this.confirm(); return true;
      case 'Backspace': if (t.cursor > 0) { t.text = s.slice(0, t.cursor - 1) + s.slice(t.cursor); t.cursor--; } return true;
      case 'Delete': t.text = s.slice(0, t.cursor) + s.slice(t.cursor + 1); return true;
      case 'Home': t.cursor = 0; return true;
      case 'End': t.cursor = s.length; return true;
      case 'ArrowLeft': t.cursor = Math.max(0, t.cursor - 1); return true;
      case 'ArrowRight': t.cursor = Math.min(s.length, t.cursor + 1); return true;
      default:
        if (ch && ch.length === 1 && ch >= ' ' && ch <= '~' && s.length < NAME_MAX) {
          t.text = s.slice(0, t.cursor) + ch.toUpperCase() + s.slice(t.cursor);
          t.cursor++;
          return true;
        }
        return false;
    }
  }
}
