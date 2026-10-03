// Rules of the cave simulation, checked without a browser: `node game/tests/rules.test.cjs`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'js');

const sandbox = { window: {}, Math, performance: { now: () => 0 }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['levels.js', 'engine.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
});

const { Engine, Levels } = sandbox.window.Rockfall;
const TICK = 0.125;
let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) {
    failures += 1;
    console.log('FAIL:', name, extra);
  } else {
    console.log('ok  :', name);
  }
};

// --- Hand made caves parse and are consistent -------------------------------
for (let level = 1; level <= 40; level += 1) {
  const def = Levels.levelFor(level);
  const cave = new Engine.Cave(def);
  const widths = new Set(def.map.map((r) => r.length));
  const gemCount = def.map.join('').split('*').length - 1;
  const players = def.map.join('').split('P').length - 1;
  const exits = def.map.join('').split('X').length - 1;
  if (widths.size !== 1 || players !== 1 || exits !== 1 || gemCount < def.gemsNeeded) {
    failures += 1;
    console.log('FAIL: cave', level, {
      widths: [...widths],
      players,
      exits,
      gemCount,
      need: def.gemsNeeded,
    });
  }
  if (level % 10 === 0) {
    console.log(
      `ok  : cave ${level} ${cave.width}x${cave.height} "${def.name}" gems ${gemCount}/${def.gemsNeeded} time ${def.time}`,
    );
  }
}
check('40 caves generate', true);

// --- Gravity ---------------------------------------------------------------
const rockTest = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWWW', 'W  r   W', 'W      W', 'W      W', 'W P  *XW', 'WWWWWWWW'],
});
rockTest.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check(
  'rock falls one cell per tick',
  rockTest.tile(3, 2) === Engine.TILE.BOULDER,
  rockTest.tile(3, 2),
);
rockTest.tick({ dx: 0, dy: 0, bomb: false }, TICK);
rockTest.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check('rock lands on the floor', rockTest.tile(3, 4) === Engine.TILE.BOULDER);

// --- Digging, collecting, exit ---------------------------------------------
const runTest = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWWW', 'W......W', 'W.P..*XW', 'W......W', 'WWWWWWWW'],
});
runTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check('player digs dirt', runTest.playerX === 3 && runTest.tile(2, 2) === Engine.TILE.EMPTY);
runTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
runTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check('gem collected', runTest.gems === 1 && runTest.exitOpen, `gems=${runTest.gems}`);
runTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check('exit completes the cave', runTest.won);

// --- Cuts reported for the cutter animation -------------------------------
const cutTest = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWWW', 'W.P.* XW', 'WWWWWWWW'],
});
cutTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check(
  'digging dirt reports a dirt cut at that cell',
  JSON.stringify(cutTest.cuts) === JSON.stringify([{ kind: 'dirt', x: 3, y: 1, dx: 1, dy: 0 }]),
  JSON.stringify(cutTest.cuts),
);
cutTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check(
  'taking a gem reports a gem cut',
  cutTest.cuts.length === 1 && cutTest.cuts[0].kind === 'gem' && cutTest.cuts[0].x === 4,
  JSON.stringify(cutTest.cuts),
);
cutTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check(
  'walking through open cave reports no cut',
  cutTest.cuts.length === 0,
  JSON.stringify(cutTest.cuts),
);

// --- Pushing ---------------------------------------------------------------
const pushTest = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWWW', 'W.....*W', 'W.Pr  XW', 'WWWWWWWW'],
});
pushTest.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check(
  'boulder pushed right',
  pushTest.playerX === 3 && pushTest.tile(4, 2) === Engine.TILE.BOULDER,
  `px=${pushTest.playerX} t4=${pushTest.tile(4, 2)}`,
);
const blocked = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWWW', 'W.....*W', 'W.PrrXWW', 'WWWWWWWW'],
});
blocked.tick({ dx: 1, dy: 0, bomb: false }, TICK);
check('boulder against a boulder does not move', blocked.playerX === 2);

// --- Rock crushes the player ------------------------------------------------
const crush = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWW', 'W r W', 'W   W', 'W P W', 'WWWWW'],
});
for (let i = 0; i < 3; i += 1) crush.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check('falling rock kills the player', !crush.alive);

// --- Rock kills a monster and leaves gems ----------------------------------
const kill = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  map: ['WWWWWWW', 'W..r..W', 'W..m..W', 'W.....W', 'W.P..XW', 'WWWWWWW'],
});
// Arm the rock as already falling, the state it would be in after a drop.
kill.flags[kill.at(3, 1)] |= Engine.FLAG.FALLING;
kill.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check('falling rock destroys the monster', kill.tile(3, 2) === Engine.TILE.BOOM, kill.tile(3, 2));
for (let i = 0; i < Engine.BOOM_STAGES + 1; i += 1) kill.tick({ dx: 0, dy: 0, bomb: false }, TICK);
let gemsLeft = 0;
for (let idx = 0; idx < kill.tiles.length; idx += 1) {
  if (kill.tiles[idx] === Engine.TILE.GEM) gemsLeft += 1;
}
check('crushed monster leaves gems behind', gemsLeft > 0, `gems=${gemsLeft}`);

// --- Bombs ------------------------------------------------------------------
const bombTest = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 100,
  bombs: 1,
  map: ['WWWWWWWWW', 'W.......W', 'W.P.BBB.W', 'W.......W', 'W......XW', 'WWWWWWWWW'],
});
bombTest.tick({ dx: 0, dy: 0, bomb: true }, TICK);
check('bomb is dropped in front', bombTest.tile(3, 2) === Engine.TILE.BOMB && bombTest.bombs === 0);
for (let i = 0; i < Engine.BOMB_FUSE + 2; i += 1)
  bombTest.tick({ dx: -1, dy: 0, bomb: false }, TICK);
check('bomb clears brick', bombTest.tile(4, 2) !== Engine.TILE.BOMB);
check('bomb explosion kills nothing behind steel', bombTest.tile(0, 2) === Engine.TILE.WALL);

// --- Time out ---------------------------------------------------------------
const clock = new Engine.Cave({
  name: 'T',
  gemsNeeded: 1,
  time: 0.2,
  map: ['WWWWW', 'W.P.W', 'W..XW', 'WWWWW'],
});
for (let i = 0; i < 4; i += 1) clock.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check('running out of time kills the player', !clock.alive);
for (let i = 0; i < 20; i += 1) clock.tick({ dx: 0, dy: 0, bomb: false }, TICK);
check('death animation finishes', clock.finished);

// --- Long generated-cave soak: no crashes, creatures behave ----------------
for (let level = 3; level <= 12; level += 1) {
  const cave = new Engine.Cave(Levels.levelFor(level));
  for (let i = 0; i < 400; i += 1) {
    const dir = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][i % 5];
    cave.tick({ dx: dir[0], dy: dir[1], bomb: i % 97 === 0 }, TICK);
  }
}
check('generated caves survive 400 ticks of play', true);

console.log(failures === 0 ? '\nALL LOGIC TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
