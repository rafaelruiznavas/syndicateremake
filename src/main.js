// Arranque: carga recursos, registra las escenas y abre el menú (o la misión ?mission=N).

import { Assets } from './data/assets.js';
import { GameLoop } from './core/loop.js';
import { Input } from './input/input.js';
import { Game } from './scenes/manager.js';
import { TitleScene, ScreenUpScene, MenuScene } from './scenes/menu.js';
import { MapScene } from './scenes/map.js';
import { BriefingScene } from './scenes/briefing.js';
import { CryoScene } from './scenes/cryo.js';
import { ResearchScene } from './scenes/research.js';
import { MissionScene } from './scenes/mission.js';
import { DebriefScene, AnimScene } from './scenes/debrief.js';
import { LoadSaveScene } from './scenes/loadsave.js';
import { StartScene, IntroScene } from './scenes/intro.js';
import { ConfigureScene } from './scenes/configure.js';
import { mountOptions } from './ui/options.js';
import { mountCheats } from './ui/cheats.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const status = document.getElementById('status');

async function boot() {
  const assets = new Assets('assets');
  status.textContent = 'cargando recursos…';
  await assets.loadCommon();
  const input = new Input(canvas);
  const loop = new GameLoop({ update: () => game.update(), render: () => game.render() });
  const game = new Game({ assets, ctx, input, loop });
  mountOptions(document.getElementById('bar'), game);
  mountCheats(document.getElementById('bar'), game);
  game.register('start', (g) => new StartScene(g));
  game.register('intro', (g) => new IntroScene(g));
  game.register('title', (g) => new TitleScene(g));
  game.register('screenup', (g, args) => new ScreenUpScene(g, args));
  game.register('anim', (g, args) => new AnimScene(g, args));
  game.register('menu', (g) => new MenuScene(g));
  game.register('configure', (g) => new ConfigureScene(g));
  game.register('loadsave', (g) => new LoadSaveScene(g));
  game.register('map', (g) => new MapScene(g));
  game.register('briefing', (g) => new BriefingScene(g));
  game.register('cryo', (g, args) => new CryoScene(g, args));
  game.register('research', (g, args) => new ResearchScene(g, args));
  game.register('mission', (g, args) => new MissionScene(g, args));
  game.register('debrief', (g, args) => new DebriefScene(g, args));

  const mission = new URLSearchParams(location.search).get('mission');
  if (mission) game.quickMission(Number(mission));
  else { game.newGame(); await game.go('start'); }
  status.textContent = mission ? `misión ${mission}` : 'campaña';
  window.__game = game;
  loop.start();
}

boot().catch((err) => { status.textContent = 'error: ' + err.message; console.error(err); });
