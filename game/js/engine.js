/**
 * Cave simulation for Rockfall.
 *
 * The cave is a grid that advances one logic tick at a time, exactly like the 8 and 16 bit
 * originals: the player takes a whole step, then the world is scanned from the bottom row upwards
 * so that stacks of rocks fall as a column instead of dribbling one cell per tick.
 */
window.Rockfall = window.Rockfall || {};

(function initEngine(NS) {
  /** Tile identifiers stored in the cave grid. */
  const TILE = {
    EMPTY: 0,
    DIRT: 1,
    WALL: 2,
    BRICK: 3,
    BOULDER: 4,
    GEM: 5,
    PLAYER: 6,
    MONSTER: 7,
    PULSATOR: 8,
    BOMB: 9,
    EXIT: 10,
    BOOM: 11,
  };

  /** Bit flags held alongside each tile. */
  const FLAG = { FALLING: 1, SCANNED: 2, ARMED: 4 };

  /** Characters used by the hand drawn cave maps. */
  const CHARS = {
    ' ': TILE.EMPTY,
    '.': TILE.DIRT,
    W: TILE.WALL,
    B: TILE.BRICK,
    r: TILE.BOULDER,
    '*': TILE.GEM,
    P: TILE.PLAYER,
    m: TILE.MONSTER,
    p: TILE.PULSATOR,
    b: TILE.BOMB,
    X: TILE.EXIT,
  };

  /** Clockwise direction vectors, indexed by the creature direction stored in `aux`. */
  const DIRS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  /** How many ticks an explosion burns for. */
  const BOOM_STAGES = 5;
  /** How many ticks a dropped bomb waits before going off. */
  const BOMB_FUSE = 16;
  /** Tiles a falling object can roll sideways off. */
  const ROUNDED = new Set([TILE.BOULDER, TILE.GEM, TILE.BRICK]);
  /** Tiles that fall under gravity. */
  const HEAVY = new Set([TILE.BOULDER, TILE.GEM, TILE.BOMB]);

  /**
   * One playable cave.
   */
  class Cave {
    /**
     * Build a cave from a level definition.
     * @param {object} def - Level definition.
     * @param {string[]} def.map - Rows of map characters.
     * @param {string} def.name - Cave name shown on the title card.
     * @param {number} def.gemsNeeded - Gems required before the exit opens.
     * @param {number} def.time - Time limit in seconds.
     * @param {number} [def.gemValue] - Score for each gem before the quota is met.
     * @param {number} [def.bombs] - Bombs the player starts with.
     */
    constructor(def) {
      this.def = def;
      this.name = def.name;
      this.height = def.map.length;
      this.width = def.map[0].length;

      const size = this.width * this.height;

      this.tiles = new Uint8Array(size);
      this.flags = new Uint8Array(size);
      this.aux = new Int16Array(size);
      this.boomGem = new Uint8Array(size);
      this.gemsNeeded = def.gemsNeeded;
      this.gemValue = def.gemValue || 10;
      this.timeLeft = def.time;
      this.bombs = def.bombs || 0;
      this.gems = 0;
      this.score = 0;
      this.ticks = 0;
      this.facing = 1;
      this.exitOpen = false;
      this.alive = true;
      this.won = false;
      this.deathDelay = 0;
      this.events = [];
      // Cells the player dug or took a gem from this tick, for the cutter animation.
      this.cuts = [];
      this.moves = new Map();
      this.playerX = 1;
      this.playerY = 1;

      this.load(def.map);
    }

    /**
     * Fill the grid from the map rows.
     * @param {string[]} rows - Rows of map characters.
     */
    load(rows) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          const tile = CHARS[rows[y][x]];
          const index = y * this.width + x;

          this.tiles[index] = tile === undefined ? TILE.DIRT : tile;

          if (tile === TILE.PLAYER) {
            this.playerX = x;
            this.playerY = y;
          }

          if (tile === TILE.MONSTER || tile === TILE.PULSATOR) {
            this.aux[index] = (x + y) % DIRS.length;
          }
        }
      }
    }

    /**
     * Convert coordinates to a grid index.
     * @param {number} x - Column.
     * @param {number} y - Row.
     * @returns {number} The grid index.
     */
    at(x, y) {
      return y * this.width + x;
    }

    /**
     * Read a tile, treating anything outside the cave as solid wall.
     * @param {number} x - Column.
     * @param {number} y - Row.
     * @returns {number} The tile identifier.
     */
    tile(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
        return TILE.WALL;
      }

      return this.tiles[this.at(x, y)];
    }

    /**
     * Record an event for the sound layer.
     * @param {string} event - Event name.
     */
    emit(event) {
      if (!this.events.includes(event)) {
        this.events.push(event);
      }
    }

    /**
     * Move a tile between two cells, keeping its flags and remembering the move so the renderer
     * can interpolate it.
     * @param {number} fromX - Source column.
     * @param {number} fromY - Source row.
     * @param {number} toX - Target column.
     * @param {number} toY - Target row.
     */
    relocate(fromX, fromY, toX, toY) {
      const from = this.at(fromX, fromY);
      const to = this.at(toX, toY);

      this.tiles[to] = this.tiles[from];
      this.flags[to] = this.flags[from] | FLAG.SCANNED;
      this.aux[to] = this.aux[from];
      this.tiles[from] = TILE.EMPTY;
      this.flags[from] = 0;
      this.aux[from] = 0;
      this.moves.set(to, { dx: fromX - toX, dy: fromY - toY });
    }

    /**
     * Blow a three by three hole in the cave.
     * @param {number} cx - Center column.
     * @param {number} cy - Center row.
     * @param {boolean} intoGems - Whether the debris turns into gems.
     */
    explode(cx, cy, intoGems) {
      this.emit('boom');

      for (let y = cy - 1; y <= cy + 1; y += 1) {
        for (let x = cx - 1; x <= cx + 1; x += 1) {
          if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
            const index = this.at(x, y);
            const tile = this.tiles[index];

            if (tile !== TILE.WALL) {
              if (tile === TILE.PLAYER) {
                this.killPlayer();
              }

              this.tiles[index] = TILE.BOOM;
              this.flags[index] = FLAG.SCANNED;
              this.aux[index] = BOOM_STAGES;
              this.boomGem[index] = intoGems ? 1 : 0;
              this.moves.delete(index);
            }
          }
        }
      }
    }

    /**
     * Mark the player as dead and start the respawn countdown.
     */
    killPlayer() {
      if (this.alive) {
        this.alive = false;
        this.deathDelay = BOOM_STAGES + 6;
        this.emit('death');
      }
    }

    /**
     * Drop an armed bomb in front of the player, if one is carried and there is room.
     */
    dropBomb() {
      if (!this.alive || this.bombs <= 0) {
        return;
      }

      const candidates = [
        [this.playerX + this.facing, this.playerY],
        [this.playerX - this.facing, this.playerY],
        [this.playerX, this.playerY - 1],
      ];

      const spot = candidates.find(([x, y]) => {
        const tile = this.tile(x, y);

        return tile === TILE.EMPTY || tile === TILE.DIRT;
      });

      if (!spot) {
        return;
      }

      const index = this.at(spot[0], spot[1]);

      this.tiles[index] = TILE.BOMB;
      this.flags[index] = FLAG.ARMED | FLAG.SCANNED;
      this.aux[index] = BOMB_FUSE;
      this.bombs -= 1;
      this.emit('drop');
    }

    /**
     * Try to move the player one cell.
     * @param {number} dx - Horizontal step, -1, 0 or 1.
     * @param {number} dy - Vertical step, -1, 0 or 1.
     */
    movePlayer(dx, dy) {
      if (!this.alive || (dx === 0 && dy === 0)) {
        return;
      }

      if (dx !== 0) {
        this.facing = dx;
      }

      const nx = this.playerX + dx;
      const ny = this.playerY + dy;
      const target = this.tile(nx, ny);
      let allowed = false;

      if (target === TILE.EMPTY) {
        allowed = true;
      } else if (target === TILE.DIRT) {
        allowed = true;
        this.emit('dig');
        this.cuts.push({ kind: 'dirt', x: nx, y: ny, dx, dy });
      } else if (target === TILE.GEM) {
        allowed = true;
        this.cuts.push({ kind: 'gem', x: nx, y: ny, dx, dy });
        this.gems += 1;
        this.score += this.gems > this.gemsNeeded ? this.gemValue * 2 : this.gemValue;
        this.emit('gem');

        if (this.gems >= this.gemsNeeded && !this.exitOpen) {
          this.exitOpen = true;
          this.emit('open');
        }
      } else if (target === TILE.BOMB && (this.flags[this.at(nx, ny)] & FLAG.ARMED) === 0) {
        allowed = true;
        this.bombs += 1;
        this.emit('pickup');
      } else if (target === TILE.BOULDER && dy === 0) {
        const beyond = this.tile(nx + dx, ny);

        if (beyond === TILE.EMPTY) {
          this.relocate(nx, ny, nx + dx, ny);
          this.emit('push');
          allowed = true;
        }
      } else if (target === TILE.EXIT && this.exitOpen) {
        this.won = true;
        this.emit('exit');
        allowed = true;
      }

      if (allowed) {
        const from = this.at(this.playerX, this.playerY);
        const to = this.at(nx, ny);

        this.tiles[from] = TILE.EMPTY;
        this.flags[from] = 0;
        this.tiles[to] = TILE.PLAYER;
        this.flags[to] = FLAG.SCANNED;
        this.moves.set(to, { dx: -dx, dy: -dy });
        this.playerX = nx;
        this.playerY = ny;
      }
    }

    /**
     * Check whether the player is standing next to a cell.
     * @param {number} x - Column.
     * @param {number} y - Row.
     * @returns {boolean} True when the player is orthogonally adjacent.
     */
    touchesPlayer(x, y) {
      if (!this.alive) {
        return false;
      }

      return Math.abs(x - this.playerX) + Math.abs(y - this.playerY) === 1;
    }

    /**
     * Advance a falling object by one tick.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    stepHeavy(x, y) {
      const index = this.at(x, y);
      const falling = (this.flags[index] & FLAG.FALLING) !== 0;
      const below = this.tile(x, y + 1);

      if (below === TILE.EMPTY) {
        this.relocate(x, y, x, y + 1);
        this.flags[this.at(x, y + 1)] |= FLAG.FALLING;

        return;
      }

      if (falling) {
        if (below === TILE.PLAYER) {
          this.explode(x, y + 1, false);

          return;
        }

        if (below === TILE.MONSTER) {
          this.explode(x, y + 1, true);

          return;
        }

        if (below === TILE.PULSATOR) {
          this.explode(x, y + 1, false);

          return;
        }

        if (below === TILE.BOMB) {
          this.flags[this.at(x, y + 1)] |= FLAG.ARMED;
          this.aux[this.at(x, y + 1)] = 1;

          return;
        }
      }

      if (ROUNDED.has(below)) {
        const sides = [-1, 1];

        const rolled = sides.some((side) => {
          if (this.tile(x + side, y) === TILE.EMPTY && this.tile(x + side, y + 1) === TILE.EMPTY) {
            this.relocate(x, y, x + side, y);
            this.flags[this.at(x + side, y)] |= FLAG.FALLING;

            return true;
          }

          return false;
        });

        if (rolled) {
          return;
        }
      }

      if (falling) {
        this.emit('land');
      }

      this.flags[index] &= ~FLAG.FALLING;
    }

    /**
     * Advance a monster, which wanders through open cave and explodes on contact.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    stepMonster(x, y) {
      if (this.touchesPlayer(x, y)) {
        this.explode(x, y, true);

        return;
      }

      const index = this.at(x, y);
      const order = [this.aux[index], (this.aux[index] + 1) % 4, (this.aux[index] + 3) % 4];

      if (Math.random() < 0.25) {
        order.unshift(Math.floor(Math.random() * 4));
      }

      order.push((this.aux[index] + 2) % 4);

      const choice = order.find(
        (dir) => this.tile(x + DIRS[dir][0], y + DIRS[dir][1]) === TILE.EMPTY,
      );

      if (choice !== undefined) {
        this.aux[index] = choice;
        this.relocate(x, y, x + DIRS[choice][0], y + DIRS[choice][1]);
      }
    }

    /**
     * Advance a pulsator, which hugs the cave walls with a left hand rule.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    stepPulsator(x, y) {
      if (this.touchesPlayer(x, y)) {
        this.explode(x, y, false);

        return;
      }

      const index = this.at(x, y);
      const dir = this.aux[index];
      const order = [(dir + 3) % 4, dir, (dir + 1) % 4, (dir + 2) % 4];

      const choice = order.find(
        (option) => this.tile(x + DIRS[option][0], y + DIRS[option][1]) === TILE.EMPTY,
      );

      if (choice !== undefined) {
        this.aux[index] = choice;
        this.relocate(x, y, x + DIRS[choice][0], y + DIRS[choice][1]);
      }
    }

    /**
     * Burn a bomb fuse down, detonating it when it runs out.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    stepBomb(x, y) {
      const index = this.at(x, y);

      if ((this.flags[index] & FLAG.ARMED) === 0) {
        this.stepHeavy(x, y);

        return;
      }

      this.aux[index] -= 1;

      if (this.aux[index] <= 0) {
        this.explode(x, y, false);

        return;
      }

      this.stepHeavy(x, y);
    }

    /**
     * Burn an explosion down, leaving empty cave or a fresh gem behind.
     * @param {number} x - Column.
     * @param {number} y - Row.
     */
    stepBoom(x, y) {
      const index = this.at(x, y);

      this.aux[index] -= 1;

      if (this.aux[index] <= 0) {
        this.tiles[index] = this.boomGem[index] ? TILE.GEM : TILE.EMPTY;
        this.boomGem[index] = 0;
        this.flags[index] = 0;
      }
    }

    /**
     * Run one logic tick.
     * @param {object} intent - Player intent for this tick.
     * @param {number} intent.dx - Horizontal step.
     * @param {number} intent.dy - Vertical step.
     * @param {boolean} intent.bomb - Whether a bomb was requested.
     * @param {number} seconds - Length of a tick in seconds.
     */
    tick(intent, seconds) {
      this.events.length = 0;
      this.cuts.length = 0;
      this.moves.clear();
      this.ticks += 1;

      if (this.won) {
        return;
      }

      if (this.alive) {
        this.timeLeft = Math.max(0, this.timeLeft - seconds);

        if (this.timeLeft === 0) {
          this.explode(this.playerX, this.playerY, false);
        }
      } else {
        this.deathDelay -= 1;
      }

      if (intent.bomb) {
        this.dropBomb();
      }

      this.movePlayer(intent.dx, intent.dy);

      if (this.won) {
        return;
      }

      this.flags.forEach((value, index) => {
        this.flags[index] = value & ~FLAG.SCANNED;
      });

      for (let y = this.height - 1; y >= 0; y -= 1) {
        for (let x = 0; x < this.width; x += 1) {
          const index = this.at(x, y);

          if ((this.flags[index] & FLAG.SCANNED) === 0) {
            const tile = this.tiles[index];

            this.flags[index] |= FLAG.SCANNED;

            if (tile === TILE.BOMB) {
              this.stepBomb(x, y);
            } else if (HEAVY.has(tile)) {
              this.stepHeavy(x, y);
            } else if (tile === TILE.MONSTER) {
              this.stepMonster(x, y);
            } else if (tile === TILE.PULSATOR) {
              this.stepPulsator(x, y);
            } else if (tile === TILE.BOOM) {
              this.stepBoom(x, y);
            }
          }
        }
      }
    }

    /**
     * Whether the death animation has finished and the life can be taken away.
     * @returns {boolean} True once the cave is ready to restart.
     */
    get finished() {
      return !this.alive && this.deathDelay <= 0;
    }
  }

  NS.Engine = { Cave, TILE, FLAG, CHARS, BOOM_STAGES, BOMB_FUSE, DIRS };
})(window.Rockfall);
