// LOAD AND SAVE GAME (SPEC §12.2; `0x26ef0`, tabla `0x5b77c`): 10 ranuras con nombre
// editable y botones LOAD, SAVE y MENU. Las partidas se guardan en localStorage [DIS].

import { MenuScreen } from './menu-screen.js';
import { FONT } from '../ui/menu-gfx.js';

const SLOTS = 10, NAME_MAX = 20;
const slotRect = (i) => [0x9e, 0x64 + i * 0x18, 0x21a, 0x7a + i * 0x18];
const KEY = (i) => `syndicate-remake.slot${i}`;

function readSlot(i) {
  try { return JSON.parse(localStorage.getItem(KEY(i)) ?? 'null'); } catch { return null; }
}

export class LoadSaveScene extends MenuScreen {
  constructor(game) {
    super(game, { anim: 'mlosa', out: 'mlosaout' });
    this.clock = false;
    this.names = Array.from({ length: SLOTS }, (_, i) => readSlot(i)?.name ?? '');
    this.selected = -1;
  }

  draw(vga) {
    const g = this.gfx;
    g.title(vga, this.game.assets.ui.labels.loadSave?.[this.lang] ?? 'LOAD/SAVE GAME');
    this.button(vga, 'load', 0x2e, 0x15a, 0x92, 0x174);
    this.button(vga, 'save', 0x94, 0x15a, 0xf8, 0x174);
    this.button(vga, 'menu', 500, 0x15a, 0x274, 0x174);
    this.names.forEach((name, i) => {
      const [x, y] = slotRect(i);
      const cursor = i === this.selected && (this.frame & 8) ? '_' : '';
      g.text(vga, name + cursor, x + 6, y + 6, i === this.selected ? FONT.HOT : FONT.BUTTON);
    });
  }

  click(e) {
    const slot = this.names.findIndex((_, i) => this.hot(...slotRect(i), e));
    if (slot >= 0) { this.selected = slot; return; }
    if (this.hot(500, 0x15a, 0x274, 0x174, e)) this.exit(() => this.game.go('menu'));
    else if (this.hot(0x2e, 0x15a, 0x92, 0x174, e)) this.load();
    else if (this.hot(0x94, 0x15a, 0xf8, 0x174, e)) this.save();
  }

  load() {
    const data = this.selected >= 0 && readSlot(this.selected);
    if (!data) return;
    this.game.loadState(data.state);
    this.exit(() => this.game.go('menu'));
  }

  save() {
    if (this.selected < 0) return;
    const name = this.names[this.selected] || `GAME ${this.selected + 1}`;
    try { localStorage.setItem(KEY(this.selected), JSON.stringify({ name, state: this.campaign.toJSON() })); } catch { return; }
    this.names[this.selected] = name;
    this.exit(() => this.game.go('menu'));
  }

  key(code, ch) {
    if (this.selected < 0) return false;
    const name = this.names[this.selected];
    if (code === 'Backspace') { this.names[this.selected] = name.slice(0, -1); return true; }
    if (code === 'Enter') { this.save(); return true; }
    if (ch && ch.length === 1 && /[a-z0-9 .\-]/i.test(ch) && name.length < NAME_MAX) { this.names[this.selected] = name + ch.toUpperCase(); return true; }
    return false;
  }
}
