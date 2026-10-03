/**
 * Input handling for Rockfall: keyboard, an on screen joystick or d-pad, and a relative thumb stick
 * that works anywhere on the playfield.
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

  /** Distance in CSS pixels the thumb has to travel before the playfield stick registers. */
  const DEAD_ZONE = 16;
  /** A touch on the cave shorter than this, in milliseconds, is a tap rather than a swipe. */
  const TAP_TIME = 250;
  /** How far in CSS pixels a tap may drift and still count as a tap. */
  const TAP_SLOP = 12;
  /** Longest pause in milliseconds between the two taps of a double tap. */
  const DOUBLE_TAP_GAP = 350;
  /** Furthest apart in CSS pixels the two taps of a double tap may land. */
  const DOUBLE_TAP_REACH = 60;
  /** Thumb travel in CSS pixels before the on screen joystick registers a direction. */
  const JOYSTICK_DEAD_ZONE = 12;
  /** How far the joystick knob can move from the center of its base, in CSS pixels. */
  const JOYSTICK_TRAVEL = 36;
  /** Radius in CSS pixels of the dead spot in the middle of the d-pad. */
  const PAD_DEAD_ZONE = 12;
  /**
   * How much stronger the other axis must be before a held direction gives way to it. Without
   * this a thumb resting near a diagonal flickers between two directions on a four way grid.
   */
  const HYSTERESIS = 1.35;

  /**
   * Turn a thumb offset into one of four directions, holding on to the current direction until
   * the other axis clearly wins.
   * @param {number} dx - Horizontal offset.
   * @param {number} dy - Vertical offset.
   * @param {string|null} current - Direction currently held.
   * @returns {string} The direction name.
   */
  const directionFor = (dx, dy, current) => {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const horizontal = dx > 0 ? 'right' : 'left';
    const vertical = dy > 0 ? 'down' : 'up';

    if (current === horizontal && ax * HYSTERESIS >= ay) {
      return horizontal;
    }

    if (current === vertical && ay * HYSTERESIS >= ax) {
      return vertical;
    }

    return ax > ay ? horizontal : vertical;
  };

  /**
   * Route a pointer's later events to an element. Capture is a nicety, so a browser that refuses
   * it must not break the control.
   * @param {HTMLElement} element - The element to capture to.
   * @param {number} pointerId - The pointer to capture.
   */
  const capture = (element, pointerId) => {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // The control still works from events on the element itself.
    }
  };

  /**
   * Collects held directions from every input device and hands the game a single intent.
   */
  class Controls {
    /**
     * Wire up the listeners.
     * @param {object} options - Element references and callbacks.
     * @param {HTMLElement} options.surface - Element used as the thumb stick area.
     * @param {HTMLElement} options.dpad - Container of the on screen direction keys.
     * @param {HTMLElement} options.joystick - The on screen joystick area.
     * @param {HTMLElement} options.bombButton - The bomb key.
     * @param {(action: string) => void} options.onAction - Callback for named actions such as
     * pause, mute or start.
     */
    constructor({ surface, dpad, joystick, bombButton, onAction }) {
      this.onAction = onAction;
      this.held = [];
      this.stick = null;
      this.touchDir = null;
      this.pointerId = null;
      this.bombQueued = false;
      this.resets = [];

      this.bindKeyboard();
      this.bindStick(surface);
      this.bindPad(dpad);
      this.bindJoystick(joystick);
      this.bindBomb(bombButton);
    }

    /**
     * Let go of every touch control, for instance when switching between the pad and the stick.
     */
    releaseTouch() {
      this.touchDir = null;
      this.stick = null;
      this.pointerId = null;
      this.resets.forEach((reset) => reset());
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
        this.releaseTouch();
      });
    }

    /**
     * Turn the playfield into a relative thumb stick, and let a double tap on it drop a bomb. A
     * tap is a touch that is both short and still, so a swipe never counts as one.
     * @param {HTMLElement} surface - The playfield element.
     */
    bindStick(surface) {
      let touch = null;
      let lastTap = null;

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
        touch = { time: performance.now(), x: event.clientX, y: event.clientY, drift: 0 };
        capture(surface, event.pointerId);
        this.onAction('gesture');
      };

      /**
       * Count a tap, dropping a bomb when it is the second of a quick pair.
       * @param {number} x - Where the tap landed, horizontally.
       * @param {number} y - Where the tap landed, vertically.
       */
      const tap = (x, y) => {
        const now = performance.now();

        const paired =
          lastTap &&
          now - lastTap.time <= DOUBLE_TAP_GAP &&
          Math.hypot(x - lastTap.x, y - lastTap.y) <= DOUBLE_TAP_REACH;

        if (paired) {
          this.bombQueued = true;
          lastTap = null;
        } else {
          lastTap = { time: now, x, y };
        }
      };

      /**
       * Turn the thumb offset into a direction, dragging the anchor along behind it.
       * @param {PointerEvent} event - The pointer event.
       */
      const move = (event) => {
        if (event.pointerId !== this.pointerId) {
          return;
        }

        touch.drift = Math.max(
          touch.drift,
          Math.hypot(event.clientX - touch.x, event.clientY - touch.y),
        );

        const dx = event.clientX - this.origin.x;
        const dy = event.clientY - this.origin.y;
        const distance = Math.hypot(dx, dy);

        if (distance < DEAD_ZONE) {
          this.stick = null;

          return;
        }

        this.stick = directionFor(dx, dy, this.stick);

        const pull = distance - DEAD_ZONE * 1.6;

        if (pull > 0) {
          this.origin.x += (dx / distance) * pull;
          this.origin.y += (dy / distance) * pull;
        }
      };

      /**
       * Let go of the stick, and count the touch as a tap if it was short and still.
       * @param {PointerEvent} event - The pointer event.
       */
      const end = (event) => {
        if (event.pointerId !== this.pointerId) {
          return;
        }

        this.pointerId = null;
        this.stick = null;

        const still = touch && touch.drift <= TAP_SLOP;
        const quick = touch && performance.now() - touch.time <= TAP_TIME;

        if (event.type === 'pointerup' && still && quick) {
          tap(event.clientX, event.clientY);
        }

        touch = null;
      };

      surface.addEventListener('pointerdown', start);
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', end);
      surface.addEventListener('pointercancel', end);
    }

    /**
     * Wire up the on screen d-pad. The whole pad is live: the direction comes from which side of
     * its center the thumb is on, so a thumb that misses the arrow itself still steers.
     * @param {HTMLElement} dpad - Container of the direction keys.
     */
    bindPad(dpad) {
      const keys = Object.fromEntries(
        [...dpad.querySelectorAll('[data-dir]')].map((key) => [key.dataset.dir, key]),
      );

      let padPointer = null;

      /**
       * Hold a direction and light its key.
       * @param {string|null} dir - Direction name, or null to release.
       */
      const setDir = (dir) => {
        this.touchDir = dir;
        Object.entries(keys).forEach(([name, key]) => key.classList.toggle('active', name === dir));
      };

      /**
       * Work out the direction for a pointer from its position against the pad's center.
       * @param {PointerEvent} event - The pointer event.
       * @returns {string|null} The direction name, or null in the dead spot.
       */
      const dirAt = (event) => {
        const rect = dpad.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);

        if (Math.hypot(dx, dy) < PAD_DEAD_ZONE) {
          return null;
        }

        return directionFor(dx, dy, this.touchDir);
      };

      dpad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        padPointer = event.pointerId;
        capture(dpad, event.pointerId);
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

      this.resets.push(() => {
        padPointer = null;
        setDir(null);
      });
    }

    /**
     * Wire up the floating thumb joystick. The base jumps to wherever the thumb lands inside the
     * joystick area, the knob follows the thumb, and the stick's anchor trails along behind a
     * thumb that overshoots, so reversing never needs a long drag back. The anchor may follow the
     * thumb right out of the joystick area; only the drawn base is kept inside it.
     * @param {HTMLElement} zone - The joystick area.
     */
    bindJoystick(zone) {
      const base = zone.querySelector('.joystick-base');
      const knob = zone.querySelector('.joystick-knob');
      let stickPointer = null;
      let origin = null;
      let bounds = null;
      let rest = null;

      /**
       * Place the base and the knob.
       * @param {number} bx - Base offset from its resting place, horizontally.
       * @param {number} by - Base offset from its resting place, vertically.
       * @param {number} kx - Knob offset from the base center, horizontally.
       * @param {number} ky - Knob offset from the base center, vertically.
       */
      const place = (bx, by, kx, ky) => {
        base.style.setProperty('--bx', `${bx}px`);
        base.style.setProperty('--by', `${by}px`);
        knob.style.setProperty('--kx', `${kx}px`);
        knob.style.setProperty('--ky', `${ky}px`);
      };

      /**
       * Keep a point far enough inside the joystick area for the whole base to show.
       * @param {number} x - Point, in client coordinates.
       * @param {number} y - Point, in client coordinates.
       * @returns {object} The nearest point the base center can sit on.
       */
      const inside = (x, y) => ({
        x: Math.min(Math.max(x, bounds.left + rest.radius), bounds.right - rest.radius),
        y: Math.min(Math.max(y, bounds.top + rest.radius), bounds.bottom - rest.radius),
      });

      /**
       * Draw the base at the anchor, as far as the area allows, with the knob toward the thumb.
       * @param {number} x - Thumb position, in client coordinates.
       * @param {number} y - Thumb position, in client coordinates.
       */
      const draw = (x, y) => {
        const center = inside(origin.x, origin.y);
        const kx = x - center.x;
        const ky = y - center.y;
        const reach = Math.min(Math.hypot(kx, ky), JOYSTICK_TRAVEL) / (Math.hypot(kx, ky) || 1);

        place(center.x - rest.x, center.y - rest.y, kx * reach, ky * reach);
      };

      /**
       * Return the stick to rest.
       */
      const reset = () => {
        stickPointer = null;
        origin = null;
        this.touchDir = null;
        zone.classList.remove('active');
        place(0, 0, 0, 0);
      };

      zone.addEventListener('pointerdown', (event) => {
        if (stickPointer !== null) {
          return;
        }

        event.preventDefault();
        stickPointer = event.pointerId;
        bounds = zone.getBoundingClientRect();

        const radius = base.offsetWidth / 2;

        rest = {
          x: bounds.left + base.offsetLeft + radius,
          y: bounds.top + base.offsetTop + radius,
          radius,
        };
        origin = inside(event.clientX, event.clientY);
        draw(event.clientX, event.clientY);
        capture(zone, event.pointerId);
        zone.classList.add('active');
        this.onAction('gesture');
      });

      zone.addEventListener('pointermove', (event) => {
        if (event.pointerId !== stickPointer) {
          return;
        }

        let dx = event.clientX - origin.x;
        let dy = event.clientY - origin.y;
        let distance = Math.hypot(dx, dy);
        const overshoot = distance - JOYSTICK_TRAVEL;

        if (overshoot > 0) {
          origin = {
            x: origin.x + (dx / distance) * overshoot,
            y: origin.y + (dy / distance) * overshoot,
          };
          dx = event.clientX - origin.x;
          dy = event.clientY - origin.y;
          distance = Math.hypot(dx, dy);
        }

        draw(event.clientX, event.clientY);
        this.touchDir = distance < JOYSTICK_DEAD_ZONE ? null : directionFor(dx, dy, this.touchDir);
      });

      ['pointerup', 'pointercancel'].forEach((type) => {
        zone.addEventListener(type, (event) => {
          if (event.pointerId === stickPointer) {
            reset();
          }
        });
      });

      this.resets.push(reset);
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
     * Forget a bomb asked for while it could not be dropped, so it does not go off later at a
     * bad moment, such as the start of the next life.
     */
    discardBomb() {
      this.bombQueued = false;
    }

    /**
     * Read and clear the intent for one logic tick.
     * @returns {object} The step to take and whether a bomb was requested.
     */
    consume() {
      const dir = this.touchDir || this.stick || this.held[this.held.length - 1] || null;
      const step = STEPS[dir] || { x: 0, y: 0 };
      const bomb = this.bombQueued;

      this.bombQueued = false;

      return { dx: step.x, dy: step.y, bomb };
    }
  }

  NS.Controls = Controls;
})(window.Rockfall);
