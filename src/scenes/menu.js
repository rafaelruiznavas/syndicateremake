// Título (MTITLE → MSCRENUP) y MAIN MENU (SPEC §12, §12.2; `0x37600`).

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';

const ITEM_X = 0xd0, ITEM_Y = 0x8c, ITEM_STEP = 0x22;
const MULTIPLAYER = 3;                       // opción que no se dibuja

export class TitleScene extends MenuScreen {
  constructor(game) { super(game, { anim: 'mtitle', ticksPerFrame: 15, skippable: true }); this.clock = false; }
  click() { this.continue(); }
  key() { this.continue(); return true; }
  continue() { if (!this.going) { this.going = true; this.game.go('screenup'); } }
  draw() {}
}

/** Animación de pantalla «subiendo» (MSCRENUP) antes del menú principal. */
export class ScreenUpScene extends MenuScreen {
  constructor(game, { next = 'menu', args = {} } = {}) { super(game, { anim: 'mscrenup' }); this.clock = false; this.next = next; this.args = args; }
  ready() { this.game.go(this.next, this.args); }
  draw() {}
}

export class MenuScene extends MenuScreen {
  constructor(game) { super(game, { anim: 'moption', out: 'moptout' }); this.clock = false; }

  /** Opción bajo el ratón según la fórmula del original. */
  hovered() {
    const y = this.mouse.y;
    if (!(y > 0x7c && y < 0x148)) return -1;
    let k = Math.trunc((y - 0x5a) / ITEM_STEP);
    if (k > 3) k++;
    return k - 1;
  }

  draw(vga) {
    const items = this.game.assets.ui.mainMenuItems;
    this.gfx.title(vga, this.label('mainMenu'));
    const hot = this.hovered();
    let y = ITEM_Y;
    items.forEach((item, i) => {
      if (i === MULTIPLAYER) return;
      this.gfx.text(vga, item[this.lang], ITEM_X, y, i === hot ? FONT.MENU_HOT : FONT.MENU);
      y += ITEM_STEP;
    });
  }

  click({ y }) {
    if (!(y > 0x7c && y < 0x126)) return;
    this.choose(Math.trunc((y - 0x5a) / ITEM_STEP));
  }

  key(code) {
    const k = { F1: 1, F2: 2, F3: 3, F4: 4, F5: 5 }[code];
    if (!k) return false;
    this.choose(k);
    return true;
  }

  /** 1 configurar, 2 empezar misión (mapa), 3 cargar/guardar, 4 reiniciar, 5 salir. */
  choose(k) {
    switch (k) {
      case 1: this.exit(() => this.game.go('configure')); break;
      case 2: this.exit(() => this.game.go('map')); break;
      case 3: this.exit(() => this.game.go('loadsave')); break;
      case 4: this.game.newGame(); break;
      case 5: this.exit(() => this.game.go('title')); break;
    }
  }
}
