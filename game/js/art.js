/**
 * Sprite generation for Rockfall.
 *
 * Every tile is authored on a 16x16 virtual pixel grid and rasterized into an offscreen canvas at
 * the current tile size, so the artwork stays chunky and crisp at any zoom level, the way the
 * original Archimedes caves looked.
 */
window.Rockfall = window.Rockfall || {};

(function initArt(NS) {
  /** Archimedes-flavoured 16 color palette, keyed by the characters used in the pixel grids. */
  const PALETTE = {
    0: '#08080c',
    1: '#241408',
    2: '#6f4420',
    3: '#9c6330',
    4: '#d9a05c',
    5: '#33333f',
    6: '#5f5f70',
    7: '#9a9aae',
    8: '#e8e8f4',
    9: '#0d3a72',
    a: '#1f7fd0',
    b: '#74dcff',
    c: '#0f5c2a',
    d: '#3cc457',
    e: '#7c1414',
    f: '#e0402c',
    g: '#f09a1e',
    h: '#f7dc4e',
    i: '#4b2384',
    j: '#a964e8',
    k: '#1b1b26',
  };

  const GRID = 16;
  /**
   * Create an empty pixel grid.
   * @returns {string[][]} A 16x16 grid filled with transparent pixels.
   */
  const blank = () => Array.from({ length: GRID }, () => new Array(GRID).fill('.'));

  /**
   * Set a pixel, ignoring out-of-range coordinates.
   * @param {string[][]} grid - Target pixel grid.
   * @param {number} x - Column.
   * @param {number} y - Row.
   * @param {string} color - Palette key.
   */
  const put = (grid, x, y, color) => {
    if (x >= 0 && x < GRID && y >= 0 && y < GRID) {
      grid[y][x] = color;
    }
  };

  /**
   * Turn a list of equal length strings into a pixel grid.
   * @param {string[]} rows - Rows of palette keys, `.` meaning transparent.
   * @returns {string[][]} The parsed grid.
   */
  const fromRows = (rows) => rows.map((row) => row.split(''));

  /**
   * Deterministic value noise, so scenery looks random but never flickers between frames.
   * @param {number} x - Column.
   * @param {number} y - Row.
   * @param {number} seed - Extra salt.
   * @returns {number} A number in the range 0 to 1.
   */
  const noise = (x, y, seed) => {
    let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;

    n = (n ^ (n >>> 13)) * 1274126177;

    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  /**
   * Shade a sphere into the grid, lit from the upper left.
   * @param {string[][]} grid - Target pixel grid.
   * @param {string[]} ramp - Palette keys from darkest to lightest.
   * @param {number} radius - Sphere radius in virtual pixels.
   */
  const sphere = (grid, ramp, radius) => {
    const center = GRID / 2;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const dx = (x + 0.5 - center) / radius;
        const dy = (y + 0.5 - center) / radius;
        const d2 = dx * dx + dy * dy;

        if (d2 <= 1) {
          const nz = Math.sqrt(1 - d2);
          const light = Math.max(0, -0.46 * dx - 0.54 * dy + 0.7 * nz);
          const rim = d2 > 0.86 ? 1 : 0;
          const step = Math.round(light * (ramp.length - 1)) - rim;

          put(grid, x, y, ramp[Math.max(0, Math.min(ramp.length - 1, step))]);
        }
      }
    }
  };

  /**
   * Shade a faceted gem into the grid.
   * @param {string[][]} grid - Target pixel grid.
   * @param {string[]} ramp - Palette keys from darkest to lightest.
   * @param {number} sparkle - Animation frame driving the highlight position.
   */
  const gemShape = (grid, ramp, sparkle) => {
    const center = GRID / 2;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const dx = Math.abs(x + 0.5 - center) / 6.8;
        const dy = Math.abs(y + 0.5 - center) / 7.6;

        if (dx + dy <= 1) {
          const top = y < center;
          const left = x < center;
          let level = top ? 3 : 1;

          if (left) {
            level += 1;
          }

          if (dx + dy > 0.82) {
            level -= 2;
          }

          put(grid, x, y, ramp[Math.max(0, Math.min(ramp.length - 1, level))]);
        }
      }
    }

    const spots = [
      [5, 5],
      [9, 6],
      [8, 9],
      [6, 8],
    ];

    const [sx, sy] = spots[sparkle % spots.length];

    put(grid, sx, sy, '8');
    put(grid, sx + 1, sy, '8');
    put(grid, sx, sy + 1, '8');
  };

  /**
   * Player sprite frames: a slim spaceman in a red suit, drawn in profile facing right (the
   * renderer mirrors him when he walks left). Standing, then the two halves of a stride.
   */
  const SPACEMAN = [
    fromRows([
      '................',
      '......eeee......',
      '.....efgffe.....',
      '....efff99be....',
      '....eff99a8e....',
      '....efff999e....',
      '.....effffe.....',
      '......6776......',
      '....56fffff.....',
      '....56fhfff.....',
      '....56ffffe.....',
      '....55effe7.....',
      '......efff......',
      '......eeff......',
      '......eeff......',
      '.....666777.....',
    ]),
    fromRows([
      '................',
      '......eeee......',
      '.....efgffe.....',
      '....efff99be....',
      '....eff99a8e....',
      '....efff999e....',
      '.....effffe.....',
      '......6776......',
      '....56fffff.....',
      '....56fhfff.....',
      '....56ffffe.....',
      '....55effe7.....',
      '......efff......',
      '.....ee..ff.....',
      '....ee....ff....',
      '...666....777...',
    ]),
    fromRows([
      '................',
      '......eeee......',
      '.....efgffe.....',
      '....efff99be....',
      '....eff99a8e....',
      '....efff999e....',
      '.....effffe.....',
      '......6776......',
      '....56fffff.....',
      '....56fhfff.....',
      '....56ffffe.....',
      '....55effe7.....',
      '......efff......',
      '.....ff..ee.....',
      '....ff....ee....',
      '...777....666...',
    ]),
  ];

  /**
   * Paint the dirt tile.
   * @returns {string[][]} The pixel grid.
   */
  const dirtGrid = () => {
    const grid = blank();

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const n = noise(x, y, 7);
        let color = '2';

        if (n > 0.86) {
          color = '3';
        } else if (n < 0.14) {
          color = '1';
        }

        if (y === 0) {
          color = n > 0.5 ? '3' : '2';
        }

        put(grid, x, y, color);
      }
    }

    return grid;
  };

  /**
   * Paint the indestructible steel wall tile.
   * @returns {string[][]} The pixel grid.
   */
  const wallGrid = () => {
    const grid = blank();

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        let color = '5';

        if (y === 0 || x === 0) {
          color = '7';
        }

        if (y >= GRID - 2 || x >= GRID - 2) {
          color = 'k';
        }

        put(grid, x, y, color);
      }
    }

    [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ].forEach(([x, y]) => {
      put(grid, x, y, '6');
      put(grid, x + 1, y, '7');
      put(grid, x, y + 1, 'k');
      put(grid, x + 1, y + 1, '5');
    });

    return grid;
  };

  /**
   * Paint the crumbly brick wall tile, which explosions can clear.
   * @returns {string[][]} The pixel grid.
   */
  const brickGrid = () => {
    const grid = blank();

    for (let y = 0; y < GRID; y += 1) {
      const course = Math.floor(y / 4);
      const offset = course % 2 === 0 ? 0 : 4;

      for (let x = 0; x < GRID; x += 1) {
        const mortar = y % 4 === 3 || (x + offset) % 8 === 7;

        put(grid, x, y, mortar ? '1' : (y % 4 === 0 && 'f') || 'e');
      }
    }

    return grid;
  };

  /**
   * Paint a bomb, with a fuse that sparks once it is armed.
   * @param {number} frame - Animation frame.
   * @param {boolean} armed - Whether the fuse is burning.
   * @returns {string[][]} The pixel grid.
   */
  const bombGrid = (frame, armed) => {
    const grid = blank();

    sphere(grid, ['0', '0', '5', '5', '6', '7'], 6.4);
    put(grid, 9, 2, '2');
    put(grid, 10, 1, '2');
    put(grid, 11, 1, '2');

    if (armed && frame % 2 === 0) {
      put(grid, 12, 0, 'h');
      put(grid, 11, 0, 'g');
      put(grid, 12, 1, 'g');
    } else if (armed) {
      put(grid, 12, 0, 'f');
    }

    return grid;
  };

  /**
   * Paint a monster: a red crawler that wanders the open caves.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const monsterGrid = (frame) => {
    const grid = blank();

    sphere(grid, ['e', 'e', 'f', 'f', 'g'], 6.6);

    const wiggle = frame % 2 === 0 ? 1 : -1;

    [2, 7, 12].forEach((x) => {
      put(grid, x, 13 + (wiggle > 0 ? 0 : 1), 'e');
      put(grid, x, 14, 'e');
      put(grid, x + wiggle, 15, 'e');
    });

    [[5], [10]].forEach(([x]) => {
      put(grid, x, 5, '8');
      put(grid, x + 1, 5, '8');
      put(grid, x, 6, '8');
      put(grid, x + 1, 6, '0');
    });

    put(grid, 6, 10, '0');
    put(grid, 7, 11, '0');
    put(grid, 8, 11, '0');
    put(grid, 9, 10, '0');

    return grid;
  };

  /**
   * Paint a pulsator: a pulsing green creature that hugs the cave walls.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const pulsatorGrid = (frame) => {
    const grid = blank();
    const pulse = frame % 2;
    const outer = 7 - pulse;

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const dx = Math.abs(x + 0.5 - 8);
        const dy = Math.abs(y + 0.5 - 8);
        const ring = Math.max(dx, dy);

        if (ring <= outer) {
          let color = 'c';

          if (ring > outer - 1.5) {
            color = 'd';
          } else if (ring < 2.5) {
            color = pulse ? 'h' : 'd';
          } else if (ring < 4) {
            color = 'c';
          }

          put(grid, x, y, color);
        }
      }
    }

    const tip = pulse ? 'h' : 'd';

    [-1, 0, 1].forEach((offset) => {
      const near = Math.abs(offset) === 1 ? 1 : 0;

      put(grid, 8 + offset, near, tip);
      put(grid, 8 + offset, 15 - near, tip);
      put(grid, near, 8 + offset, tip);
      put(grid, 15 - near, 8 + offset, tip);
    });

    return grid;
  };

  /**
   * Paint the cave exit, either sealed or flashing open.
   * @param {number} frame - Animation frame.
   * @param {boolean} open - Whether enough gems have been collected.
   * @returns {string[][]} The pixel grid.
   */
  const exitGrid = (frame, open) => {
    const grid = wallGrid();

    for (let y = 2; y < 14; y += 1) {
      for (let x = 2; x < 14; x += 1) {
        const edge = x === 2 || x === 13 || y === 2 || y === 13;
        let color;

        if (edge) {
          color = open ? (frame % 2 === 0 && 'h') || 'g' : '7';
        } else if (open) {
          color = frame % 2 === 0 ? 'd' : 'c';
        } else {
          color = (x + y) % 6 < 3 ? 'g' : 'k';
        }

        put(grid, x, y, color);
      }
    }

    if (open) {
      for (let y = 6; y < 13; y += 1) {
        for (let x = 5; x < 11; x += 1) {
          put(grid, x, y, '0');
        }
      }

      for (let x = 5; x < 11; x += 1) {
        put(grid, x, 5, 'h');
      }

      put(grid, 4, 6, 'h');
      put(grid, 11, 6, 'h');
      put(grid, 9, 9, frame % 2 === 0 ? 'h' : 'g');
    }

    return grid;
  };

  /**
   * Paint one frame of an explosion.
   * @param {number} stage - Countdown stage, highest first.
   * @param {number} stages - Total number of stages.
   * @returns {string[][]} The pixel grid.
   */
  const boomGrid = (stage, stages) => {
    const grid = blank();
    const progress = 1 - stage / stages;
    const radius = 3 + progress * 6;
    const ramp = ['h', 'g', 'f', 'e'];

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const dx = x + 0.5 - 8;
        const dy = y + 0.5 - 8;
        const d = Math.sqrt(dx * dx + dy * dy) + noise(x, y, stage) * 1.8;

        if (d < radius) {
          const band = Math.min(ramp.length - 1, Math.floor((d / radius) * ramp.length));

          put(grid, x, y, progress > 0.7 && band > 1 ? '.' : ramp[band]);
        }
      }
    }

    return grid;
  };

  /**
   * Paint a boulder.
   * @returns {string[][]} The pixel grid.
   */
  const boulderGrid = () => {
    const grid = blank();

    sphere(grid, ['5', '5', '6', '6', '7', '8'], 7.4);

    return grid;
  };

  /**
   * Paint a gem.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const gemGrid = (frame) => {
    const grid = blank();

    gemShape(grid, ['9', '9', 'a', 'a', 'b', '8'], frame);

    return grid;
  };

  /**
   * Pick a spaceman frame.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const spacemanGrid = (frame) => SPACEMAN[frame];
  /**
   * Paint a bomb waiting to be picked up.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const bombIdleGrid = (frame) => bombGrid(frame, false);
  /**
   * Paint a bomb with a burning fuse.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const bombLitGrid = (frame) => bombGrid(frame, true);
  /**
   * Paint the sealed exit.
   * @returns {string[][]} The pixel grid.
   */
  const exitClosedGrid = () => exitGrid(0, false);
  /**
   * Paint the open exit.
   * @param {number} frame - Animation frame.
   * @returns {string[][]} The pixel grid.
   */
  const exitOpenGrid = (frame) => exitGrid(frame, true);
  /**
   * Paint an explosion frame, counted forwards rather than backwards.
   * @param {number} frame - Animation frame.
   * @param {number} total - Number of frames in the animation.
   * @returns {string[][]} The pixel grid.
   */
  const boomFrame = (frame, total) => boomGrid(total - 1 - frame, total);

  /**
   * Sprite definitions: each entry knows how many animation frames it has and how to paint one.
   */
  const SPRITES = {
    dirt: { frames: 1, paint: dirtGrid },
    wall: { frames: 1, paint: wallGrid },
    brick: { frames: 1, paint: brickGrid },
    boulder: { frames: 1, paint: boulderGrid },
    gem: { frames: 4, paint: gemGrid },
    player: { frames: 3, paint: spacemanGrid },
    monster: { frames: 2, paint: monsterGrid },
    pulsator: { frames: 2, paint: pulsatorGrid },
    bomb: { frames: 2, paint: bombIdleGrid },
    bombArmed: { frames: 2, paint: bombLitGrid },
    exitClosed: { frames: 1, paint: exitClosedGrid },
    exitOpen: { frames: 2, paint: exitOpenGrid },
    boom: { frames: 5, paint: boomFrame },
  };

  /**
   * A cache of rasterized sprites at one tile size.
   */
  class SpriteSheet {
    /**
     * Create an empty sheet.
     */
    constructor() {
      this.tileSize = 0;
      this.cache = new Map();
    }

    /**
     * Rasterize every sprite at a new tile size, discarding the previous bitmaps.
     * @param {number} tileSize - Size of one cave cell in device pixels.
     */
    resize(tileSize) {
      if (tileSize === this.tileSize) {
        return;
      }

      this.tileSize = tileSize;
      this.cache.clear();

      Object.entries(SPRITES).forEach(([name, sprite]) => {
        const bitmaps = [];

        for (let frame = 0; frame < sprite.frames; frame += 1) {
          bitmaps.push(this.rasterize(sprite.paint(frame, sprite.frames)));
        }

        this.cache.set(name, bitmaps);
      });
    }

    /**
     * Draw one pixel grid into an offscreen canvas.
     * @param {string[][]} grid - The pixel grid to rasterize.
     * @returns {HTMLCanvasElement} The rendered bitmap.
     */
    rasterize(grid) {
      const size = this.tileSize;
      const canvas = document.createElement('canvas');

      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');
      const scale = size / GRID;

      for (let y = 0; y < GRID; y += 1) {
        for (let x = 0; x < GRID; x += 1) {
          const color = PALETTE[grid[y][x]];

          if (color) {
            const px = Math.floor(x * scale);
            const py = Math.floor(y * scale);
            const pw = Math.ceil((x + 1) * scale) - px;
            const ph = Math.ceil((y + 1) * scale) - py;

            ctx.fillStyle = color;
            ctx.fillRect(px, py, pw, ph);
          }
        }
      }

      return canvas;
    }

    /**
     * Look up a rasterized sprite frame.
     * @param {string} name - Sprite name.
     * @param {number} frame - Frame index, wrapped to the sprite's frame count.
     * @returns {HTMLCanvasElement} The bitmap to blit.
     */
    get(name, frame = 0) {
      const bitmaps = this.cache.get(name);

      return bitmaps[((frame % bitmaps.length) + bitmaps.length) % bitmaps.length];
    }
  }

  NS.Art = { PALETTE, SpriteSheet, GRID };
})(window.Rockfall);
