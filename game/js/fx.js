/**
 * The spaceman's cutter, drawn on top of the cave as he digs.
 *
 * When he steps into dirt or a gem the cell does not vanish at once: it stays in front of him and
 * is cut away by a glowing laser edge that moves with his front as he slides in. The cut material
 * swirls into him like a vacuum, spiralling in toward him so it always ends up inside him, even
 * when he is walking flat out.
 *
 * Purely visual. The engine reports each cut cell and its direction; this module animates it in
 * real time, snapped to the same 16 pixel grid as the sprites.
 */
window.Rockfall = window.Rockfall || {};

(function initFx(NS) {
  /** Fragments thrown off by one cut. */
  const PIECES = { dirt: 14, gem: 10 };

  /** Fragment colors: cut earth, laser-hot embers, and gem shards. */
  const COLORS = {
    dirt: ['#9c6330', '#6f4420', '#d9a05c', '#241408'],
    hot: ['#f09a1e', '#f7dc4e'],
    gem: ['#74dcff', '#e8e8f4', '#1f7fd0'],
  };

  /** Share of dirt fragments that glow hot from the laser. */
  const HOT_SHARE = 0.3;

  /** Laser colors along the cutting edge: outer glow and core, by what is being cut. */
  const EDGE = {
    dirt: { glow: '#e0402c', core: '#f7dc4e' },
    gem: { glow: '#1f7fd0', core: '#e8e8f4' },
  };

  /** How fast the vortex turns, in radians per second. */
  const SPIN = 8;
  /**
   * Pick a random color.
   * @param {string[]} list - Colors to choose from.
   * @returns {string} One of them.
   */
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  /**
   * Split a cut into its axis of travel. Positions along the axis run from 0 to 1 across the cell
   * in the direction he is moving.
   * @param {object} cut - The cut.
   * @param {number} cut.dx - Horizontal direction of travel.
   * @param {number} cut.dy - Vertical direction of travel.
   * @returns {object} Whether he moves horizontally, and the sign of travel along that axis.
   */
  const axisOf = ({ dx, dy }) => ({ horizontal: dx !== 0, sign: dx || dy });

  /**
   * Live cutter animations.
   */
  class CutterFx {
    /**
     * Start with nothing on screen.
     * @param {number} slideTime - Seconds the spaceman takes to slide into a cell.
     */
    constructor(slideTime) {
      this.slideTime = slideTime;
      this.cuts = [];
      this.pieces = [];
    }

    /**
     * Drop everything, for instance when a cave starts.
     */
    clear() {
      this.cuts.length = 0;
      this.pieces.length = 0;
    }

    /**
     * Start cutting a cell.
     * @param {object} cut - The cut, as reported by the engine.
     * @param {string} cut.kind - `dirt` or `gem`.
     * @param {number} cut.x - Cell column.
     * @param {number} cut.y - Cell row.
     * @param {number} cut.dx - Horizontal direction the spaceman is moving.
     * @param {number} cut.dy - Vertical direction the spaceman is moving.
     */
    cut({ kind, x, y, dx, dy }) {
      this.cuts.push({
        kind,
        x,
        y,
        dx,
        dy,
        age: 0,
        emitted: 0,
        spin: (Math.random() < 0.5 ? -1 : 1) * SPIN * (0.8 + Math.random() * 0.4),
      });
    }

    /**
     * How far the cut has got across its cell, from 0 to 1.
     * @param {object} cut - A live cut.
     * @returns {number} The cut fraction.
     */
    progress(cut) {
      return Math.min(1, cut.age / this.slideTime);
    }

    /**
     * Where the cutting edge is, in tile coordinates along the axis of travel.
     * @param {object} cut - A live cut.
     * @returns {number} The edge position along the travel axis.
     */
    edgeOf(cut) {
      const { horizontal, sign } = axisOf(cut);
      const start = horizontal ? cut.x : cut.y;
      const p = this.progress(cut);

      return sign > 0 ? start + p : start + 1 - p;
    }

    /**
     * Throw a fragment off the cutting edge into the vortex around the nozzle.
     * @param {object} cut - The cut it comes from.
     * @param {object} nozzle - Where the cutter is, in tile coordinates.
     */
    emit(cut, nozzle) {
      const { horizontal, sign } = axisOf(cut);
      // Just ahead of the edge, still in the uncut part of the cell.
      const along = this.edgeOf(cut) + sign * Math.random() * 0.6;
      const across = (horizontal ? cut.y : cut.x) + 0.1 + Math.random() * 0.8;
      const x = horizontal ? along : across;
      const y = horizontal ? across : along;
      const hot = cut.kind === 'dirt' && Math.random() < HOT_SHARE;

      this.pieces.push({
        // Start a little way out, so the swirl is visible before it disappears into him.
        radius: Math.max(0.4, Math.hypot(x - nozzle.x, y - nozzle.y)),
        angle: Math.atan2(y - nozzle.y, x - nozzle.x),
        spin: cut.spin,
        age: 0,
        life: 0.3 + Math.random() * 0.15,
        size: Math.random() < 0.45 ? 2 : 1,
        color: pick(hot ? COLORS.hot : COLORS[cut.kind]),
        glow: hot || cut.kind === 'gem',
      });
    }

    /**
     * Move everything on by one frame.
     * @param {number} dt - Seconds since the last frame; zero while paused.
     * @param {object} nozzle - Where the cutter is, in tile coordinates.
     */
    update(dt, nozzle) {
      if (dt <= 0) {
        return;
      }

      this.cuts = this.cuts.filter((cut) => {
        cut.age += dt;

        // Fragments come off steadily while the edge crosses the cell.
        const due = Math.round(this.progress(cut) * PIECES[cut.kind]);

        while (cut.emitted < due) {
          cut.emitted += 1;
          this.emit(cut, nozzle);
        }

        return cut.age < this.slideTime;
      });

      this.pieces = this.pieces.filter((piece) => {
        piece.age += dt;
        piece.angle += piece.spin * dt;

        return piece.age < piece.life;
      });
    }

    /**
     * Draw what is left of each cell being cut. Call before the sprites, so the spaceman slides
     * over it.
     * @param {CanvasRenderingContext2D} ctx - The cave canvas.
     * @param {object} view - Where the cave sits on the canvas.
     * @param {number} view.originX - Canvas x of the cave's left edge.
     * @param {number} view.originY - Canvas y of the cave's top edge.
     * @param {number} view.tileSize - Size of a cell in canvas pixels.
     * @param {object} art - The sprite sheet.
     */
    drawUnder(ctx, { originX, originY, tileSize }, art) {
      const px = tileSize / 16;

      this.cuts.forEach((cut) => {
        const { horizontal, sign } = axisOf(cut);
        // Whole sprite pixels of the cell still uncut, on the far side of the edge.
        const left = Math.round(16 * (1 - this.progress(cut)));
        const offset = sign > 0 ? 16 - left : 0;
        const bitmap = art.get(cut.kind, 0);
        const cellX = Math.round(originX + cut.x * tileSize);
        const cellY = Math.round(originY + cut.y * tileSize);

        if (left <= 0) {
          return;
        }

        if (horizontal) {
          ctx.drawImage(
            bitmap,
            offset * px,
            0,
            left * px,
            tileSize,
            cellX + offset * px,
            cellY,
            left * px,
            tileSize,
          );
        } else {
          ctx.drawImage(
            bitmap,
            0,
            offset * px,
            tileSize,
            left * px,
            cellX,
            cellY + offset * px,
            tileSize,
            left * px,
          );
        }
      });
    }

    /**
     * Draw the laser edges and the swirling fragments. Call after the sprites.
     * @param {CanvasRenderingContext2D} ctx - The cave canvas.
     * @param {object} view - Where the cave sits on the canvas.
     * @param {number} view.originX - Canvas x of the cave's left edge.
     * @param {number} view.originY - Canvas y of the cave's top edge.
     * @param {number} view.tileSize - Size of a cell in canvas pixels.
     * @param {object} nozzle - Where the cutter is, in tile coordinates.
     */
    drawOver(ctx, { originX, originY, tileSize }, nozzle) {
      if (this.cuts.length === 0 && this.pieces.length === 0) {
        return;
      }

      const px = tileSize / 16;

      /**
       * Fill a square of sprite pixels centered on a point.
       * @param {number} x - Point, in tile coordinates.
       * @param {number} y - Point, in tile coordinates.
       * @param {number} size - Edge, in sprite pixels.
       */
      const dot = (x, y, size) => {
        const edge = Math.max(1, Math.round(size)) * px;
        const sx = Math.round((originX + x * tileSize - edge / 2) / px) * px;
        const sy = Math.round((originY + y * tileSize - edge / 2) / px) * px;

        ctx.fillRect(sx, sy, edge, edge);
      };

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      this.cuts.forEach((cut) => {
        if (this.progress(cut) >= 1) {
          return;
        }

        const { horizontal } = axisOf(cut);
        const edge = this.edgeOf(cut);
        const colors = EDGE[cut.kind];
        const flicker = 0.7 + Math.random() * 0.3;

        // The laser line across the cell, a glow with a bright core.
        for (let i = 1; i < 16; i += 1) {
          const across = (horizontal ? cut.y : cut.x) + i / 16;
          const x = horizontal ? edge : across;
          const y = horizontal ? across : edge;

          ctx.globalAlpha = 0.55 * flicker;
          ctx.fillStyle = colors.glow;
          dot(x, y, 3);
          ctx.globalAlpha = flicker;
          ctx.fillStyle = colors.core;
          dot(x, y, 1);
        }

        // A few sparks jumping off the edge.
        ctx.fillStyle = '#e8e8f4';

        for (let i = 0; i < 3; i += 1) {
          const across = (horizontal ? cut.y : cut.x) + 0.15 + Math.random() * 0.7;
          const jump = (Math.random() - 0.5) * 0.35;

          dot(horizontal ? edge + jump : across, horizontal ? across : edge + jump, 1);
        }
      });

      this.pieces.forEach((piece) => {
        const t = piece.age / piece.life;
        const radius = piece.radius * (1 - t) ** 1.6;

        ctx.globalCompositeOperation = piece.glow ? 'lighter' : 'source-over';
        ctx.globalAlpha = Math.min(1, 1.3 - t);
        ctx.fillStyle = piece.color;
        dot(
          nozzle.x + Math.cos(piece.angle) * radius,
          nozzle.y + Math.sin(piece.angle) * radius,
          piece.size * (0.4 + 0.6 * (1 - t)),
        );
      });

      ctx.restore();
    }
  }

  NS.Fx = { CutterFx };
})(window.Rockfall);
