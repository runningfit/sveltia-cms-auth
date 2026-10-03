/**
 * Rockfall: the game shell.
 *
 * Owns the render loop, the scrolling viewport, the score and life counters, and the panels that
 * sit between caves.
 * @param {object} NS - The Rockfall namespace holding the other modules.
 */
(function initGame(NS) {
  const { Art, Engine, Levels, Sfx, Controls } = NS;
  const { TILE, FLAG, BOOM_STAGES } = Engine;
  /** Length of one logic tick in seconds. */
  const TICK = 0.125;
  /** Score awarded for each second left on the clock. */
  const TIME_BONUS = 5;
  /** Score needed for each extra miner. */
  const EXTRA_LIFE = 5000;
  /** Smallest comfortable viewport, in cave cells, used to pick the zoom level. */
  const MIN_COLS = 11;
  /** Smallest comfortable viewport height, in cave cells. */
  const MIN_ROWS = 9;

  /**
   * Read a setting from local storage, tolerating browsers that refuse access.
   * @param {string} key - Storage key.
   * @returns {string|null} The stored value, or null.
   */
  const loadSetting = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  /**
   * Write a setting to local storage, tolerating browsers that refuse access.
   * @param {string} key - Storage key.
   * @param {string|number} value - Value to store.
   */
  const saveSetting = (key, value) => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Private browsing modes can throw here; a lost setting is not worth a crash.
    }
  };

  /**
   * Pad a number with leading zeroes.
   * @param {number} value - Value to pad.
   * @param {number} width - Target width.
   * @returns {string} The padded string.
   */
  const pad = (value, width) => String(Math.max(0, Math.floor(value))).padStart(width, '0');

  /**
   * The game.
   */
  class Game {
    /**
     * Find the page furniture and start the loop.
     */
    constructor() {
      this.stage = document.getElementById('stage');
      this.canvas = document.getElementById('screen');
      this.ctx = this.canvas.getContext('2d');
      this.overlay = document.getElementById('overlay');
      this.panelTitle = document.getElementById('panel-title');
      this.panelText = document.getElementById('panel-text');
      this.panelKeys = document.getElementById('panel-keys');
      this.panelButton = document.getElementById('panel-button');
      this.touchLayer = document.getElementById('touch-layer');
      this.hud = {
        cave: document.getElementById('hud-cave'),
        gems: document.getElementById('hud-gems'),
        time: document.getElementById('hud-time'),
        score: document.getElementById('hud-score'),
        lives: document.getElementById('hud-lives'),
        bombs: document.getElementById('hud-bombs'),
        bombCount: document.getElementById('bomb-count'),
      };

      this.bombButton = document.getElementById('btn-bomb');
      this.art = new Art.SpriteSheet();
      this.sfx = new Sfx();
      this.controlPicker = document.getElementById('panel-controls');
      this.controls = new Controls({
        surface: this.canvas,
        dpad: document.getElementById('dpad'),
        joystick: document.getElementById('joystick'),
        bombButton: this.bombButton,
        onAction: this.action.bind(this),
      });

      this.state = 'title';
      this.level = 1;
      this.lives = 3;
      this.score = 0;
      this.nextLife = EXTRA_LIFE;
      this.highScore = Number(loadSetting('rockfall.highScore')) || 0;
      this.cave = null;
      this.accumulator = 0;
      this.lastFrame = 0;
      this.tileSize = 24;
      this.camera = { x: 0, y: 0 };
      this.timerBeep = 0;
      this.introTimer = 0;
      this.completeTimer = 0;

      this.setTouchMode(loadSetting('rockfall.controls') === 'pad' ? 'pad' : 'stick');
      this.bindButtons();
      this.bindInstall();
      this.detectTouch();
      this.resize();

      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => this.resize());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'playing') {
          this.action('pause');
        }
      });

      this.cave = new Engine.Cave(Levels.levelFor(this.level));
      this.resize();
      this.centerCamera();
      this.showTitle();
      window.requestAnimationFrame((time) => this.frame(time));
    }

    /**
     * Wire the header buttons and the panel button.
     */
    bindButtons() {
      document.getElementById('btn-pause').addEventListener('click', () => this.action('pause'));
      document.getElementById('btn-sound').addEventListener('click', () => this.action('mute'));
      this.panelButton.addEventListener('click', () => {
        this.sfx.unlock();
        this.action('confirm');
      });
      this.controlPicker.querySelectorAll('[data-mode]').forEach((choice) => {
        choice.addEventListener('click', () => {
          this.setTouchMode(choice.dataset.mode);
          saveSetting('rockfall.controls', choice.dataset.mode);
        });
      });
    }

    /**
     * Switch the on screen controls between the thumb joystick and the d-pad.
     * @param {string} mode - Either `stick` or `pad`.
     */
    setTouchMode(mode) {
      this.touchMode = mode;
      document.body.dataset.controls = mode;
      this.controls.releaseTouch();
      this.controlPicker.querySelectorAll('[data-mode]').forEach((choice) => {
        choice.setAttribute('aria-checked', String(choice.dataset.mode === mode));
      });
    }

    /**
     * Offer an install button where the browser supports installing the game as an app. Browsers
     * that install from their own menu instead (Safari) never fire the event, so the button stays
     * hidden there.
     */
    bindInstall() {
      const button = document.getElementById('btn-install');
      let offer = null;

      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        offer = event;
        button.hidden = false;
      });

      button.addEventListener('click', async () => {
        if (!offer) {
          return;
        }

        const pending = offer;

        offer = null;
        button.hidden = true;
        pending.prompt();
        await pending.userChoice;
      });

      window.addEventListener('appinstalled', () => {
        offer = null;
        button.hidden = true;
      });
    }

    /**
     * Show the touch controls on devices that have no keyboard.
     */
    detectTouch() {
      const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

      if (coarse) {
        this.enableTouch();
      }
    }

    /**
     * Reveal the on screen pad.
     */
    enableTouch() {
      if (!this.touchLayer.hidden) {
        return;
      }

      this.touchLayer.hidden = false;
      this.controlPicker.hidden = false;
      document.body.classList.add('touch');
      this.resize();
    }

    /**
     * Handle a named action from any input device.
     * @param {string} action - Action name.
     */
    action(action) {
      if (action === 'gesture') {
        this.sfx.unlock();
        this.enableTouch();

        return;
      }

      if (action === 'mute') {
        this.sfx.unlock();

        const muted = this.sfx.toggleMute();

        document.getElementById('btn-sound').classList.toggle('off', muted);

        return;
      }

      if (action === 'confirm') {
        this.confirm();

        return;
      }

      if (action === 'pause' && (this.state === 'playing' || this.state === 'paused')) {
        this.togglePause();

        return;
      }

      if (action === 'restart' && (this.state === 'playing' || this.state === 'paused')) {
        this.state = 'playing';
        this.hidePanel();
        this.cave.explode(this.cave.playerX, this.cave.playerY, false);
      }
    }

    /**
     * Act on the panel button or the enter key, depending on the current state.
     */
    confirm() {
      this.sfx.unlock();

      switch (this.state) {
        case 'title':
        case 'gameOver':
          this.startGame();
          break;
        case 'intro':
          this.beginCave();
          break;
        case 'complete':
          this.nextCave();
          break;
        case 'paused':
          this.togglePause();
          break;
        default:
          break;
      }
    }

    /**
     * Pause or resume play.
     */
    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.showPanel({
          title: 'PAUSED',
          text: `Cave ${Levels.caveLabel(this.level)} — ${this.cave.name}`,
          keys: ['P or Esc to resume', 'R restarts the cave', 'M toggles sound'],
          button: 'RESUME',
        });
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.hidePanel();
      }
    }

    /**
     * Show the attract screen.
     */
    showTitle() {
      this.state = 'title';
      this.showPanel({
        title: 'ROCKFALL',
        text:
          'Dig through the caves, collect the gems, then run for the exit before the ' +
          'clock beats you. Rocks fall when you dig under them, and they crush monsters ' +
          'and miners alike.',
        keys: [
          'Arrows, WASD or the thumb stick to dig',
          'Space, ● or a double tap drops a bomb',
          'Push rocks sideways to clear a path',
          this.highScore ? `Best score ${pad(this.highScore, 6)}` : '',
        ],
        button: 'START',
      });
    }

    /**
     * Begin a fresh game.
     */
    startGame() {
      this.level = 1;
      this.lives = 3;
      this.score = 0;
      this.nextLife = EXTRA_LIFE;
      this.loadCave();
    }

    /**
     * Load the current cave and show its title card.
     */
    loadCave() {
      this.cave = new Engine.Cave(Levels.levelFor(this.level));
      this.camera = { x: 0, y: 0 };
      this.accumulator = 0;
      this.controls.discardBomb();
      this.state = 'intro';
      this.introTimer = 2.2;
      this.resize();
      this.centerCamera();
      this.showPanel({
        title: `CAVE ${Levels.caveLabel(this.level)}`,
        text: this.cave.name,
        keys: [
          `Collect ${this.cave.gemsNeeded} gems`,
          `${Math.round(this.cave.timeLeft)} seconds`,
          `${this.lives} ${this.lives === 1 ? 'miner' : 'miners'} left`,
        ],
        button: 'DIG IN',
      });
    }

    /**
     * Start playing the loaded cave.
     */
    beginCave() {
      this.state = 'playing';
      this.hidePanel();
    }

    /**
     * Move on to the next cave.
     */
    nextCave() {
      this.level += 1;
      this.loadCave();
    }

    /**
     * Finish the current cave, banking the score and the time bonus.
     */
    completeCave() {
      const bonus = Math.floor(this.cave.timeLeft) * TIME_BONUS;

      this.score += this.cave.score + bonus;
      this.checkExtraLife();
      this.saveHighScore();
      this.state = 'complete';
      this.completeTimer = 3;
      this.showPanel({
        title: 'CAVE CLEARED',
        text: `${this.cave.name} is yours.`,
        keys: [
          `Gems ${this.cave.gems} × ${this.cave.gemValue}`,
          `Time bonus ${pad(bonus, 4)}`,
          `Score ${pad(this.score, 6)}`,
        ],
        button: 'NEXT CAVE',
      });
    }

    /**
     * Take a life away, then either restart the cave or end the game.
     */
    loseLife() {
      this.score += this.cave.score;
      this.lives -= 1;
      this.saveHighScore();

      if (this.lives <= 0) {
        this.state = 'gameOver';
        this.showPanel({
          title: 'GAME OVER',
          text: `You reached cave ${Levels.caveLabel(this.level)} — ${this.cave.name}.`,
          keys: [`Score ${pad(this.score, 6)}`, `Best ${pad(this.highScore, 6)}`],
          button: 'PLAY AGAIN',
        });

        return;
      }

      this.loadCave();
    }

    /**
     * Award an extra miner when the score passes the next threshold.
     */
    checkExtraLife() {
      while (this.score >= this.nextLife) {
        this.lives += 1;
        this.nextLife += EXTRA_LIFE;
        this.sfx.play('open');
      }
    }

    /**
     * Keep the best score of the session.
     */
    saveHighScore() {
      if (this.score > this.highScore) {
        this.highScore = this.score;
        saveSetting('rockfall.highScore', this.highScore);
      }
    }

    /**
     * Fill the panel and show it.
     * @param {object} options - Panel contents.
     * @param {string} options.title - Headline.
     * @param {string} options.text - Body copy.
     * @param {string[]} options.keys - Short lines listed under the body.
     * @param {string} options.button - Button label.
     */
    showPanel({ title, text, keys, button }) {
      this.panelTitle.textContent = title;
      this.panelText.textContent = text;
      this.panelKeys.replaceChildren(
        ...keys.filter(Boolean).map((line) => {
          const span = document.createElement('span');

          span.textContent = line;

          return span;
        }),
      );
      this.panelButton.textContent = button;
      this.overlay.hidden = false;
    }

    /**
     * Hide the panel.
     */
    hidePanel() {
      this.overlay.hidden = true;
    }

    /**
     * Work out the tile size and canvas resolution for the current viewport.
     *
     * Small caves are shown whole when there is room for a comfortable tile size; otherwise the
     * view zooms in so the miner stays readable on a phone and the camera scrolls instead.
     */
    resize() {
      const rect = this.stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(240, Math.floor(rect.width));
      const full = Math.max(200, Math.floor(rect.height));
      // Keep a strip clear at the bottom so the thumb pad is not sitting on top of the cave.
      const reserved = this.touchLayer.hidden ? 0 : Math.min(150, Math.round(full * 0.26));
      const height = Math.max(180, full - reserved);
      let tile = 24;

      if (this.cave) {
        const whole = Math.floor(Math.min(width / this.cave.width, height / this.cave.height));
        const zoomed = Math.floor(Math.min(width / MIN_COLS, height / MIN_ROWS));

        tile = whole >= 22 ? whole : Math.max(whole, Math.min(zoomed, 44));
      }

      this.tileSize = Math.round(Math.max(14, Math.min(tile, 56)) * dpr);

      const maxWidth = Math.floor(width * dpr);
      const maxHeight = Math.floor(height * dpr);

      this.canvas.width = this.cave
        ? Math.min(maxWidth, this.cave.width * this.tileSize)
        : maxWidth;
      this.canvas.height = this.cave
        ? Math.min(maxHeight, this.cave.height * this.tileSize)
        : maxHeight;
      this.canvas.style.width = `${Math.round(this.canvas.width / dpr)}px`;
      this.canvas.style.height = `${Math.round(this.canvas.height / dpr)}px`;
      this.ctx.imageSmoothingEnabled = false;
      this.art.resize(this.tileSize);
    }

    /**
     * Snap the camera to the player without any easing.
     */
    centerCamera() {
      const target = this.cameraTarget();

      this.camera.x = target.x;
      this.camera.y = target.y;
    }

    /**
     * Work out where the camera wants to be, in tile units.
     * @returns {object} The target camera position.
     */
    cameraTarget() {
      const cols = this.canvas.width / this.tileSize;
      const rows = this.canvas.height / this.tileSize;

      const x =
        cols >= this.cave.width
          ? (this.cave.width - cols) / 2
          : Math.max(0, Math.min(this.cave.width - cols, this.cave.playerX + 0.5 - cols / 2));

      const y =
        rows >= this.cave.height
          ? (this.cave.height - rows) / 2
          : Math.max(0, Math.min(this.cave.height - rows, this.cave.playerY + 0.5 - rows / 2));

      return { x, y };
    }

    /**
     * Run one logic tick.
     */
    step() {
      const intent =
        this.cave.alive && this.state === 'playing'
          ? this.controls.consume()
          : { dx: 0, dy: 0, bomb: false };

      this.cave.tick(intent, TICK);
      this.cave.events.forEach((event) => this.sfx.play(event));

      if (this.cave.timeLeft < 15 && this.cave.alive) {
        this.timerBeep += TICK;

        if (this.timerBeep >= 1) {
          this.timerBeep -= 1;
          this.sfx.play('tick');
        }
      }

      if (this.cave.won) {
        this.completeCave();

        return;
      }

      if (this.cave.finished) {
        this.loseLife();
      }
    }

    /**
     * Advance the simulation and the panel timers.
     * @param {number} dt - Seconds since the last frame.
     */
    update(dt) {
      if (this.state === 'intro') {
        this.introTimer -= dt;

        if (this.introTimer <= 0) {
          this.beginCave();
        }

        return;
      }

      if (this.state === 'complete') {
        this.completeTimer -= dt;

        if (this.completeTimer <= 0) {
          this.nextCave();
        }

        return;
      }

      if (this.state !== 'playing') {
        return;
      }

      this.accumulator += dt;

      let guard = 0;

      while (this.accumulator >= TICK && guard < 4 && this.state === 'playing') {
        this.accumulator -= TICK;
        guard += 1;
        this.step();
      }

      if (this.accumulator > TICK) {
        this.accumulator = TICK;
      }

      const target = this.cameraTarget();

      this.camera.x += (target.x - this.camera.x) * Math.min(1, dt * 9);
      this.camera.y += (target.y - this.camera.y) * Math.min(1, dt * 9);
    }

    /**
     * Pick the sprite for one cell.
     * @param {number} index - Grid index.
     * @param {number} beat - Animation counter.
     * @returns {object|null} Sprite name and frame, or null for empty cave.
     */
    spriteFor(index, beat) {
      const { cave } = this;
      const tile = cave.tiles[index];

      switch (tile) {
        case TILE.DIRT:
          return { name: 'dirt', frame: 0 };
        case TILE.WALL:
          return { name: 'wall', frame: 0 };
        case TILE.BRICK:
          return { name: 'brick', frame: 0 };
        case TILE.BOULDER:
          return { name: 'boulder', frame: 0 };
        case TILE.GEM:
          return { name: 'gem', frame: beat };
        case TILE.MONSTER:
          return { name: 'monster', frame: beat };
        case TILE.PULSATOR:
          return { name: 'pulsator', frame: beat };
        case TILE.BOMB:
          return (cave.flags[index] & FLAG.ARMED) !== 0
            ? { name: 'bombArmed', frame: cave.aux[index] < 6 ? cave.ticks : beat }
            : { name: 'bomb', frame: 0 };
        case TILE.EXIT:
          return cave.exitOpen
            ? { name: 'exitOpen', frame: beat }
            : { name: 'exitClosed', frame: 0 };
        case TILE.BOOM:
          return { name: 'boom', frame: BOOM_STAGES - cave.aux[index] };
        case TILE.PLAYER:
          return { name: 'player', frame: cave.moves.has(index) ? 1 + (cave.ticks % 2) : 0 };
        default:
          return null;
      }
    }

    /**
     * Draw the cave.
     */
    render() {
      const { ctx, cave, tileSize } = this;

      ctx.fillStyle = '#0a0a11';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (!cave) {
        return;
      }

      const alpha =
        this.state === 'playing' ? Math.max(0, Math.min(1, this.accumulator / TICK)) : 1;

      const beat = Math.floor(performance.now() / 150);
      const originX = -this.camera.x * tileSize;
      const originY = -this.camera.y * tileSize;
      const firstCol = Math.max(0, Math.floor(this.camera.x));
      const firstRow = Math.max(0, Math.floor(this.camera.y));

      const lastCol = Math.min(
        cave.width - 1,
        Math.ceil(this.camera.x + this.canvas.width / tileSize),
      );

      const lastRow = Math.min(
        cave.height - 1,
        Math.ceil(this.camera.y + this.canvas.height / tileSize),
      );

      for (let y = firstRow; y <= lastRow; y += 1) {
        for (let x = firstCol; x <= lastCol; x += 1) {
          const index = cave.at(x, y);
          const sprite = this.spriteFor(index, beat);

          if (sprite) {
            const move = cave.moves.get(index);
            const slide = move ? 1 - alpha : 0;
            const px = Math.round(originX + (x + (move ? move.dx * slide : 0)) * tileSize);
            const py = Math.round(originY + (y + (move ? move.dy * slide : 0)) * tileSize);
            const bitmap = this.art.get(sprite.name, sprite.frame);

            if (sprite.name === 'player' && cave.facing < 0) {
              ctx.save();
              ctx.translate(px + tileSize, py);
              ctx.scale(-1, 1);
              ctx.drawImage(bitmap, 0, 0);
              ctx.restore();
            } else {
              ctx.drawImage(bitmap, px, py);
            }
          }
        }
      }
    }

    /**
     * Refresh the status bar.
     */
    updateHud() {
      const { cave } = this;

      if (!cave) {
        return;
      }

      const total = this.score + (this.state === 'complete' ? 0 : cave.score);

      this.hud.cave.textContent = Levels.caveLabel(this.level);
      this.hud.gems.textContent = `${cave.gems}/${cave.gemsNeeded}`;
      this.hud.time.textContent = pad(Math.ceil(cave.timeLeft), 3);
      this.hud.score.textContent = pad(total, 6);
      this.hud.lives.textContent = String(Math.max(0, this.lives));
      this.hud.bombs.textContent = String(cave.bombs);
      this.hud.bombCount.textContent = String(cave.bombs);
      this.bombButton.classList.toggle('empty', cave.bombs === 0);
      this.hud.time.classList.toggle('urgent', cave.timeLeft < 15);
      this.hud.gems.classList.toggle('ready', cave.exitOpen);
    }

    /**
     * One animation frame.
     * @param {number} time - Timestamp from the browser.
     */
    frame(time) {
      const dt = Math.min(0.1, (time - this.lastFrame) / 1000 || 0);

      this.lastFrame = time;
      this.update(dt);
      this.render();
      this.updateHud();

      window.requestAnimationFrame((next) => this.frame(next));
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    NS.game = new Game();
  });

  // The service worker makes the game playable offline and installable. Pages opened straight
  // from disk cannot register one, and the game runs fine without it.
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    const { serviceWorker } = navigator;
    const updating = Boolean(serviceWorker.controller);
    let reloaded = false;

    // A new release has been fully downloaded and taken over. Switch to it straight away if that
    // loses nothing (no game in progress, or the game failed to start); otherwise this page keeps
    // running as it is and the new release is there the next time the game is opened.
    serviceWorker.addEventListener('controllerchange', () => {
      const { game } = NS;
      const idle = !game || ['title', 'gameOver'].includes(game.state);

      if (updating && idle && !reloaded) {
        reloaded = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      serviceWorker
        .register('sw.js')
        .then((registration) => {
          // An installed game is often resumed rather than relaunched, which does not check for
          // updates by itself, so check whenever it comes back to the foreground.
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
              registration.update().catch(() => {});
            }
          });
        })
        .catch(() => {});
    });
  }
})(window.Rockfall);
