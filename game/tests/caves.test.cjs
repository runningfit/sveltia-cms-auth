// Cave solvability check: `node game/tests/caves.test.cjs`.
//
// Two passes. The first is deterministic: every cave is flood filled from the miner's starting
// square to prove that the gem quota and the exit can actually be reached by digging. The second
// turns a simple path finding bot loose on the opening caves as a smoke test, which is noisier
// because the monsters move at random.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'js');
const sandbox = { window: {}, Math, console };

vm.createContext(sandbox);
['levels.js', 'engine.js'].forEach((file) =>
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file }),
);

const { Engine, Levels } = sandbox.window.Rockfall;
const T = Engine.TILE;
const TICK = 0.125;

let failures = 0;

/** Report one assertion. */
const check = (name, condition, extra = '') => {
  if (!condition) {
    failures += 1;
    console.log('FAIL:', name, extra);
  }
};

/** Tiles the miner can walk or dig through. */
const walkable = (t) => t === T.EMPTY || t === T.DIRT || t === T.GEM || t === T.BOMB;

/** Flood fill the cave from the miner, counting the gems and the exit that can be reached. */
const survey = (cave) => {
  const seen = new Uint8Array(cave.tiles.length);
  const queue = [cave.at(cave.playerX, cave.playerY)];
  let gems = 0;
  let exit = false;

  seen[queue[0]] = 1;

  while (queue.length) {
    const index = queue.pop();
    const x = index % cave.width;
    const y = Math.floor(index / cave.width);

    if (cave.tiles[index] === T.GEM) {
      gems += 1;
    }

    if (cave.tiles[index] === T.EXIT) {
      exit = true;
    }

    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || ny < 0 || nx >= cave.width || ny >= cave.height) {
        return;
      }

      const next = cave.at(nx, ny);
      const tile = cave.tiles[next];

      if (!seen[next] && (walkable(tile) || tile === T.EXIT)) {
        seen[next] = 1;
        queue.push(next);
      }
    });
  }

  return { gems, exit };
};

// --- Pass one: every cave has a reachable quota and a reachable exit -----------------------
for (let level = 1; level <= 60; level += 1) {
  const def = Levels.levelFor(level);
  const cave = new Engine.Cave(def);
  const { gems, exit } = survey(cave);

  check(`cave ${level} exit is reachable`, exit);
  check(
    `cave ${level} has enough reachable gems`,
    gems >= cave.gemsNeeded,
    `${gems} < ${cave.gemsNeeded}`,
  );
  check(`cave ${level} quota is worth playing for`, cave.gemsNeeded >= 4);
  check(`cave ${level} has a sane clock`, def.time >= 90 && def.time <= 200, `${def.time}`);
}

console.log('checked 60 caves for reachable gems and exits');

// --- Pass two: a bot plays the opening caves -----------------------------------------------
/** Breadth first search from the miner to the nearest matching cell, avoiding obvious deaths. */
const routeTo = (cave, wanted) => {
  const start = cave.at(cave.playerX, cave.playerY);
  const prev = new Map([[start, null]]);
  const queue = [start];

  /** True when a creature is close enough to bite. */
  const nearCreature = (x, y) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const t = cave.tile(x + dx, y + dy);

        if (t === T.MONSTER || t === T.PULSATOR) {
          return true;
        }
      }
    }

    return false;
  };

  while (queue.length) {
    const index = queue.shift();
    const x = index % cave.width;
    const y = Math.floor(index / cave.width);

    if (wanted(cave.tiles[index]) && index !== start) {
      const route = [];
      let node = index;

      while (node !== start) {
        route.unshift(node);
        node = prev.get(node);
      }

      return route;
    }

    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || ny < 0 || nx >= cave.width || ny >= cave.height) {
        return;
      }

      const next = cave.at(nx, ny);

      if (prev.has(next)) {
        return;
      }

      const tile = cave.tiles[next];
      const above = cave.tile(nx, ny - 1);
      const loaded = above === T.BOULDER || above === T.GEM;

      if (walkable(tile) && !loaded && !nearCreature(nx, ny)) {
        prev.set(next, index);
        queue.push(next);
      } else if (wanted(tile)) {
        prev.set(next, index);
        queue.push(next);
      }
    });
  }

  return null;
};

let cleared = 0;
const results = [];

for (let level = 1; level <= 12; level += 1) {
  const def = Levels.levelFor(level);
  const cave = new Engine.Cave(def);
  let ticks = 0;

  while (!cave.won && cave.alive && cave.timeLeft > 0 && ticks < def.time / TICK) {
    const wanted = cave.exitOpen ? (t) => t === T.EXIT : (t) => t === T.GEM;
    const route = routeTo(cave, wanted) || routeTo(cave, (t) => t === T.GEM);
    let dx = 0;
    let dy = 0;

    if (route && route.length) {
      dx = (route[0] % cave.width) - cave.playerX;
      dy = Math.floor(route[0] / cave.width) - cave.playerY;
    }

    cave.tick({ dx, dy, bomb: false }, TICK);
    ticks += 1;
  }

  if (cave.won) {
    cleared += 1;
  }

  // Whether the bot survives a given cave depends on where the monsters wander, so only the
  // aggregate below is asserted; the per-cave line is here to be read.
  results.push(
    `cave ${String(level).padStart(2)} ${cave.won ? 'cleared' : 'lost   '} ` +
      `gems ${cave.gems}/${cave.gemsNeeded} clock ${cave.timeLeft.toFixed(0)}/${def.time} "${def.name}"`,
  );
}

console.log(results.join('\n'));
console.log(`bot cleared ${cleared} of the first 12 caves`);
check('the bot clears a decent share of the opening caves', cleared >= 4, `${cleared}/12`);

console.log(failures === 0 ? '\nALL CAVE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
