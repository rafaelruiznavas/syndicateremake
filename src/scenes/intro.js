// Intro (SPEC §13.1; INTRO.EXE `0x101ac`, `0x105dc`, `0x10794`): INTRO.DAT con sus señales de
// sonido (ISNDS), música (INTRO.XMI) y subtítulos MFNT-0. Antes, una pantalla de inicio para que
// el navegador permita el audio [DIS].

import { MenuScreen } from './menu-screen.js';
import { MenuGfx } from '../ui/menu-gfx.js';
import { Bank } from '../audio/audio.js';
import { remakeText } from '../i18n/es-ui.js';

const SUBTITLE = { baseline: 0x17c, bandTop: 0x168, space: 8 };

export class StartScene {
  constructor(game) { this.game = game; }
  render() {
    const g = this.game.ctx;
    g.fillStyle = '#000'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#8c8'; g.font = '16px monospace'; g.textAlign = 'center';
    g.fillText(remakeText('clickToStart', this.game.lang), 320, 200);
    g.textAlign = 'start';
  }
  onClick() { this.start(); }
  onKey() { this.start(); return true; }
  start() { if (!this.going) { this.going = true; this.game.go('intro'); } }
}

export class IntroScene extends MenuScreen {
  constructor(game) {
    super(game, { anim: 'intro', ticksPerFrame: 5, skippable: true, cues: game.assets.animCues?.intro ?? [] });
    this.clock = false;
    this.font = new MenuGfx(game.assets.menuFontIndexed, game.assets.menuFontInfo.sprites);
    this.subtitle = 0;
  }

  cue({ cmd, arg }) {
    const { audio, music } = this.game;
    switch (cmd) {
      case 'S': case 's': if (arg) audio.play(Bank.INTRO, arg); else audio.stopAll(); break;
      case 'M': case 'm': music.select(`intro-${arg}`, { loop: false }); break;
      case 'X': case 'x': music.stop(); break;
      case 'T': case 't': this.subtitle = arg; break;
      default: break;                                  // L, E: [DES]
    }
  }

  /** Subtítulo (`0x10794`): MFNT‑0, x = 0, línea base 0x17c; «-» sube 4 y «'» sube 8. */
  drawSubtitle(vga) {
    vga.fillRect(0, SUBTITLE.bandTop, 640, SUBTITLE.baseline - SUBTITLE.bandTop, 0);
    const text = this.game.assets.intro.subtitles[this.subtitle]?.[this.lang] ?? '';
    let x = 0;
    for (const ch of text) {
      if (ch === ' ') { x += SUBTITLE.space; continue; }
      const g = ch.charCodeAt(0) - 0x20, { w, h } = this.font.size(g);
      const lift = ch === '-' ? 4 : ch === "'" ? 8 : 0;
      this.font.sprite(vga, g, x, SUBTITLE.baseline - h - lift);
      x += w;
    }
  }

  render() {
    if (this.subtitle) this.drawSubtitle(this.vga);
    this.vga.present(this.game.ctx);
  }

  ready() { this.finishIntro(); }
  onClick() { this.finishIntro(); }
  onKey() { this.finishIntro(); return true; }

  finishIntro() {
    if (this.going) return;
    this.going = true;
    this.game.audio.stopAll();
    this.game.music.stop();
    this.game.go('title');
  }
}
