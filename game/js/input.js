/**
 * Input handling for Rockfall: keyboard, an on screen pad, and a relative thumb stick that works
 * anywhere on the playfield.
 */
window.Rockfall = window.Rockfall || {};

(function initInput(NS) {
  /** Direction names mapped to grid steps. */
  const STEPS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  /** Keyboard bindings. */
  const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
  };

  /** Distance in CSS pixels the thumb has to travel before the stick registers. */
  const DEAD_ZONE = 16;

  /**
   * Collects held directions from every input device and hands the game a single intent.
   */
  class Controls {
    /**
     * Wire up the listeners.
     * @param {object} options - Element references and callbacks.
     * @param {HTMLElement} options.surface - Element used as the thumb stick area.
     * @param {HTMLElement} options.dpad - Container of the on screen direction keys.
     * @param {HTMLElement} options.bombButton - The bomb key.
     * @param {(action: string) => void} options.onAction - Callback for named actions such as
     * pause, mute or start.
     */
    constructor({ surface, dpad, bombButton, onAction }) {
      this.onAction = onAction;
      this.held = [];
      this.stick = null;
      this.pointerId = null;
      this.bombQueued = false;

      this.bindKeyboard();
      this.bindStick(surface);
      this.bindPad(dpad);
      this.bindBomb(bombButton);
    }

    /**
     * Push a direction onto the held stack.
     * @param {string} dir - Direction name.
     */
    press(dir) {
      if (dir && !this.held.includes(dir)) {
        this.held.push(dir);
      }
    }

    /**
     * Remove a direction from the held stack.
     * @param {string} dir - Direction name.
     */
    release(dir) {
      this.held = this.held.filter((entry) => entry !== dir);
    }

    /**
     * Listen for keyboard input.
     */
    bindKeyboard() {
      window.addEventListener('keydown', (event) => {
        const dir = KEYS[event.code];

        if (dir) {
          event.preventDefault();
          this.press(dir);

          return;
        }

        if (event.code === 'Space') {
          event.preventDefault();
          this.bombQueued = true;

          return;
        }

        const actions = {
          KeyP: 'pause',
          Escape: 'pause',
          KeyR: 'restart',
          KeyM: 'mute',
          Enter: 'confirm',
          NumpadEnter: 'confirm',
        };

        if (actions[event.code]) {
          event.preventDefault();
          this.onAction(actions[event.code]);
        }
      });

      window.addEventListener('keyup', (event) => {
        const dir = KEYS[event.code];

        if (dir) {
          this.release(dir);
        }
      });

      window.addEventListener('blur', () => {
        this.held = [];
        this.stick = null;
      });
    }

    /**
     * Turn the playfield into a relative thumb stick.
     * @param {HTMLElement} surface - The playfield element.
     */
    bindStick(surface) {
      /**
       * Anchor the stick where the thumb landed.
       * @param {PointerEvent} event - The pointer event.
       */
      const start = (event) => {
        if (this.pointerId !== null || event.pointerType === 'mouse') {
          return;
        }

        this.pointerId = event.pointerId;
        this.origin = { x: event.clientX, y: event.clientY };
        this.stick = null;
        surface.setPointerCapture(event.pointerId);
        this.onAction('gesture');
      };

      /**
       * Turn the thumb offset into a direction, dragging the anchor along behind it.
       * @param {PointerEvent} event - The pointer event.
       */
      const move = (event) => {
        if (event.pointerId !== this.pointerId) {
          return;
        }

        const dx = event.clientX - this.origin.x;
        const dy = event.clientY - this.origin.y;
        const distance = Math.hypot(dx, dy);

        if (distance < DEAD_ZONE) {
          this.stick = null;

          return;
        }

        this.stick =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 && 'right') || 'left' : (dy > 0 && 'down') || 'up';

        const pull = distance - DEAD_ZONE * 1.6;

        if (pull > 0) {
          this.origin.x += (dx / distance) * pull;
          this.origin.y += (dy / distance) * pull;
        }
      };

      /**
       * Let go of the stick.
       * @param {PointerEvent} event - The pointer event.
       */
      const end = (event) => {
        if (event.pointerId === this.pointerId) {
          this.pointerId = null;
          this.stick = null;
        }
      };

      surface.addEventListener('pointerdown', start);
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', end);
      surface.addEventListener('pointercancel', end);
    }

    /**
     * Wire up the on screen direction keys, including sliding a thumb between them.
     * @param {HTMLElement} dpad - Container of the direction keys.
     */
    bindPad(dpad) {
      let padPointer = null;
      let current = null;

      /**
       * Switch the pad to a new direction.
       * @param {string|null} dir - Direction name, or null to release.
       */
      const setDir = (dir) => {
        if (current === dir) {
          return;
        }

        if (current) {
          this.release(current);
        }

        current = dir;

        if (dir) {
          this.press(dir);
        }
      };

      /**
       * Work out which key sits under a pointer.
       * @param {PointerEvent} event - The pointer event.
       * @returns {string|null} The direction name under the pointer.
       */
      const dirAt = (event) => {
        const element = document.elementFromPoint(event.clientX, event.clientY);

        return (element && element.dataset && element.dataset.dir) || null;
      };

      dpad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        padPointer = event.pointerId;
        dpad.setPointerCapture(event.pointerId);
        setDir(dirAt(event));
        this.onAction('gesture');
      });

      dpad.addEventListener('pointermove', (event) => {
        if (event.pointerId === padPointer) {
          setDir(dirAt(event));
        }
      });

      ['pointerup', 'pointercancel'].forEach((type) => {
        dpad.addEventListener(type, (event) => {
          if (event.pointerId === padPointer) {
            padPointer = null;
            setDir(null);
          }
        });
      });
    }

    /**
     * Wire up the bomb key.
     * @param {HTMLElement} button - The bomb key.
     */
    bindBomb(button) {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.bombQueued = true;
        this.onAction('gesture');
      });
    }

    /**
     * Read and clear the intent for one logic tick.
     * @returns {object} The step to take and whether a bomb was requested.
     */
    consume() {
      const dir = this.stick || this.held[this.held.length - 1] || null;
      const step = STEPS[dir] || { x: 0, y: 0 };
      const bomb = this.bombQueued;

      this.bombQueued = false;

      return { dx: step.x, dy: step.y, bomb };
    }
  }

  NS.Controls = Controls;
})(window.Rockfall);
