/**
 * Cave definitions for Rockfall.
 *
 * The first two caves are hand drawn to teach digging and rock pushing. Everything after that is
 * generated from a seed derived from the cave number, so the caves are endless but a given cave
 * always looks the same, exactly as the seeded caves of the era did.
 */
window.Rockfall = window.Rockfall || {};

(function initLevels(NS) {
  /** Hand drawn caves, used for the opening levels. */
  const HANDMADE = [
    {
      name: 'FIRST DIG',
      gemsNeeded: 6,
      time: 150,
      gemValue: 10,
      bombs: 0,
      map: [
        'WWWWWWWWWWWWWWWWWWWW',
        'W.P.....*.....*....W',
        'W..................W',
        'W...WWWW....*......W',
        'W...W..W...........W',
        'W*..W..W...r...r...W',
        'W...WWWW...........W',
        'W.........*........W',
        'W..r....r.....*....W',
        'W..................W',
        'W....*.........*...W',
        'W..................W',
        'W.............X....W',
        'WWWWWWWWWWWWWWWWWWWW',
      ],
    },
    {
      name: 'ROCK PILE',
      gemsNeeded: 9,
      time: 160,
      gemValue: 10,
      bombs: 1,
      map: [
        'WWWWWWWWWWWWWWWWWWWWWWWW',
        'W.P....rrrr.....*......W',
        'W......rrrr............W',
        'W...*..........rr......W',
        'W.....BBBBB....rr..*...W',
        'W.....B...B............W',
        'W..r..B.*.B....*.......W',
        'W..r..B...B......rrr...W',
        'W..r..BB.BB......rrr...W',
        'W..r...................W',
        'W......*.....b.........W',
        'W..rrr.........*...*...W',
        'W..rrr.....*...........W',
        'W......................W',
        'W..*...........r..X....W',
        'WWWWWWWWWWWWWWWWWWWWWWWW',
      ],
    },
  ];

  /** Names given to the generated caves, cycled through with a roman numeral suffix. */
  const NAMES = [
    'DEEP SEAM',
    'THE CRUSHER',
    'BOULDER RUN',
    'MONSTER PIT',
    'GLASS CAVERN',
    'THE GRINDER',
    'PULSE CHAMBER',
    'BLACK GALLERY',
    'ROCK GARDEN',
    'THE LAST DROP',
  ];

  /**
   * A small deterministic random number generator.
   * @param {number} seed - Seed value.
   * @returns {() => number} A function returning numbers in the range 0 to 1.
   */
  const mulberry32 = (seed) => {
    let state = seed >>> 0;

    return () => {
      state += 0x6d2b79f5;

      let t = state;

      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /**
   * Difficulty settings for a generated cave.
   * @param {number} level - One based cave number.
   * @returns {object} The generation parameters.
   */
  const paramsFor = (level) => {
    const step = level - HANDMADE.length;
    const ramp = Math.min(1, step / 14);

    return {
      width: Math.min(44, 26 + Math.floor(step / 2) * 2),
      height: Math.min(26, 18 + Math.floor(step / 3) * 2),
      boulders: 0.11 + ramp * 0.11,
      gems: 0.035 + ramp * 0.015,
      caverns: 0.12 + ramp * 0.1,
      bricks: step > 2 ? 0.02 + ramp * 0.03 : 0,
      monsters: step > 0 ? Math.min(5, 1 + Math.floor(step / 3)) : 0,
      pulsators: step > 2 ? Math.min(4, Math.floor((step - 2) / 3)) : 0,
      bombs: step > 1 ? 1 + Math.floor(step / 6) : 0,
      quota: Math.round(8 + ramp * 16),
      time: Math.max(95, 170 - step * 4),
      gemValue: 10 + Math.floor(step / 3) * 5,
    };
  };

  /**
   * Carve an area of the grid to a single tile.
   * @param {string[][]} grid - Character grid.
   * @param {number} cx - Center column.
   * @param {number} cy - Center row.
   * @param {number} radius - Half width of the area.
   * @param {string} char - Character to write.
   */
  const carve = (grid, cx, cy, radius, char) => {
    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if (grid[y] && grid[y][x] && grid[y][x] !== 'W') {
          grid[y][x] = char;
        }
      }
    }
  };

  /**
   * Dig an L shaped corridor between two cells, used as a last resort when a generated cave
   * seals its own exit off behind rock.
   * @param {string[][]} grid - Character grid.
   * @param {number} fromX - Start column.
   * @param {number} fromY - Start row.
   * @param {number} toX - End column.
   * @param {number} toY - End row.
   */
  const carvePath = (grid, fromX, fromY, toX, toY) => {
    const height = grid.length;
    const width = grid[0].length;

    /**
     * Dig one cell, leaving the outer wall and the two end points alone.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    const dig = (x, y) => {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1 && !'PX'.includes(grid[y][x])) {
        grid[y][x] = '.';
      }
    };

    const stepX = toX > fromX ? 1 : -1;
    const stepY = toY > fromY ? 1 : -1;

    for (let x = fromX; x !== toX; x += stepX) {
      dig(x, fromY);
    }

    for (let y = fromY; y !== toY; y += stepY) {
      dig(toX, y);
    }
  };

  /**
   * Flood fill from the player to work out which cells can actually be reached by digging.
   * @param {string[][]} grid - Character grid.
   * @param {number} startX - Player column.
   * @param {number} startY - Player row.
   * @returns {object} Reachable gem count, and whether the exit can be reached.
   */
  const survey = (grid, startX, startY) => {
    const height = grid.length;
    const width = grid[0].length;
    const seen = new Set();
    const queue = [[startX, startY]];
    let gems = 0;
    let exit = false;

    seen.add(startY * width + startX);

    while (queue.length > 0) {
      const [x, y] = queue.pop();
      const char = grid[y][x];

      if (char === '*') {
        gems += 1;
      }

      if (char === 'X') {
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
        const key = ny * width + nx;

        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !seen.has(key)) {
          if ('. *bXP'.includes(grid[ny][nx])) {
            seen.add(key);
            queue.push([nx, ny]);
          }
        }
      });
    }

    return { gems, exit };
  };

  /**
   * Generate one cave.
   * @param {number} level - One based cave number.
   * @param {number} attempt - Retry counter, used to vary the seed.
   * @returns {object} The generated grid plus the player position.
   */
  const build = (level, attempt) => {
    const p = paramsFor(level);
    const rng = mulberry32(level * 2654435761 + attempt * 40503 + 1013904223);
    const grid = [];

    for (let y = 0; y < p.height; y += 1) {
      const row = [];

      for (let x = 0; x < p.width; x += 1) {
        const edge = x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1;
        let char = '.';

        if (edge) {
          char = 'W';
        } else {
          const roll = rng();

          if (roll < p.caverns) {
            char = ' ';
          } else if (roll < p.caverns + p.boulders) {
            char = 'r';
          } else if (roll < p.caverns + p.boulders + p.gems) {
            char = '*';
          } else if (roll < p.caverns + p.boulders + p.gems + p.bricks) {
            char = 'B';
          }
        }

        row.push(char);
      }

      grid.push(row);
    }

    const chambers = 2 + Math.floor(rng() * 4);

    for (let i = 0; i < chambers; i += 1) {
      const cx = 3 + Math.floor(rng() * (p.width - 6));
      const cy = 3 + Math.floor(rng() * (p.height - 6));

      carve(grid, cx, cy, 1 + Math.floor(rng() * 2), rng() < 0.5 ? ' ' : '.');
    }

    const playerX = 2 + Math.floor(rng() * 3);
    const playerY = 2 + Math.floor(rng() * 3);

    carve(grid, playerX, playerY, 1, '.');
    grid[playerY][playerX] = 'P';

    const exitX = p.width - 3 - Math.floor(rng() * 3);
    const exitY = p.height - 3 - Math.floor(rng() * 3);

    carve(grid, exitX, exitY, 1, '.');
    grid[exitY][exitX] = 'X';

    for (let i = 0; i < p.bombs; i += 1) {
      const bx = 4 + Math.floor(rng() * (p.width - 8));
      const by = 4 + Math.floor(rng() * (p.height - 8));

      if (grid[by][bx] !== 'X' && grid[by][bx] !== 'P') {
        grid[by][bx] = 'b';
      }
    }

    const creatures = [...new Array(p.monsters).fill('m'), ...new Array(p.pulsators).fill('p')];

    creatures.forEach((kind) => {
      for (let tries = 0; tries < 30; tries += 1) {
        const cx = 4 + Math.floor(rng() * (p.width - 8));
        const cy = 4 + Math.floor(rng() * (p.height - 8));
        const farFromPlayer = Math.abs(cx - playerX) + Math.abs(cy - playerY) > 8;
        const farFromExit = Math.abs(cx - exitX) + Math.abs(cy - exitY) > 4;

        if (farFromPlayer && farFromExit && grid[cy][cx] !== 'W') {
          carve(grid, cx, cy, 1, ' ');
          grid[cy][cx] = kind;

          return;
        }
      }
    });

    return { grid, playerX, playerY, exitX, exitY, params: p };
  };

  /**
   * Generate a playable cave, retrying until enough gems and the exit can be reached.
   * @param {number} level - One based cave number.
   * @returns {object} A level definition ready for the engine.
   */
  const generate = (level) => {
    let best = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = build(level, attempt);

      candidate.reach = survey(candidate.grid, candidate.playerX, candidate.playerY);

      const better =
        !best ||
        (candidate.reach.exit && !best.reach.exit) ||
        (candidate.reach.exit === best.reach.exit && candidate.reach.gems > best.reach.gems);

      if (better) {
        best = candidate;
      }

      if (candidate.reach.exit && candidate.reach.gems >= candidate.params.quota + 3) {
        break;
      }
    }

    if (!best.reach.exit) {
      carvePath(best.grid, best.playerX, best.playerY, best.exitX, best.exitY);
      best.reach = survey(best.grid, best.playerX, best.playerY);
    }

    const { params, reach } = best;
    const index = level - HANDMADE.length - 1;
    const cycle = Math.floor(index / NAMES.length);

    return {
      name: `${NAMES[index % NAMES.length]}${cycle > 0 ? ` ${cycle + 1}` : ''}`,
      map: best.grid.map((row) => row.join('')),
      gemsNeeded: Math.max(4, Math.min(params.quota, reach.gems - 2)),
      time: params.time,
      gemValue: params.gemValue,
      bombs: 0,
    };
  };

  /**
   * Look up a cave definition.
   * @param {number} level - One based cave number.
   * @returns {object} The level definition.
   */
  const levelFor = (level) => {
    if (level <= HANDMADE.length) {
      return HANDMADE[level - 1];
    }

    return generate(level);
  };

  /**
   * Turn a cave number into its display letter, wrapping past Z.
   * @param {number} level - One based cave number.
   * @returns {string} The cave label.
   */
  const caveLabel = (level) => {
    const letter = String.fromCharCode(65 + ((level - 1) % 26));
    const lap = Math.floor((level - 1) / 26);

    return lap > 0 ? `${letter}${lap + 1}` : letter;
  };

  NS.Levels = { levelFor, caveLabel, HANDMADE };
})(window.Rockfall);
