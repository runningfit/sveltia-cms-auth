/**
 * The jukebox for Rockfall: decides what music plays. By default it shuffles, with a different
 * tune for each new cave; the player can also pick one tune or turn the music off.
 */
window.Rockfall = window.Rockfall || {};

(function initJukebox(NS) {
  const { SONGS } = NS.Music;
  /** Music settings in the order the arrows step through them. */
  const CHOICES = ['shuffle', ...SONGS.map((song) => song.id), 'off'];
  /** Seconds a tune plays before a new cave may swap it for another in shuffle. */
  const MIN_PLAY = 20;

  /**
   * Decides what plays: a random tune that changes with each new cave, one chosen tune, or
   * nothing. It drives a MusicPlayer and reports what it is doing through callbacks.
   */
  class Jukebox {
    /**
     * Set up, silent until audio is allowed.
     * @param {object} options - Settings.
     * @param {MusicPlayer} options.player - Plays the songs.
     * @param {string} [options.mode] - `shuffle`, a song id, or `off`.
     * @param {(song: object) => void} [options.onSong] - Called when a new tune starts.
     * @param {() => void} [options.onChange] - Called whenever the mode or the tune changes.
     * @param {() => number} [options.now] - Clock in milliseconds, replaceable for tests.
     */
    constructor({ player, mode, onSong, onChange, now }) {
      this.player = player;
      this.mode = CHOICES.includes(mode) ? mode : 'shuffle';
      this.onSong = onSong || (() => {});
      this.onChange = onChange || (() => {});
      this.now = now || (() => performance.now());
      this.song = null;
      this.startedAt = 0;
      this.ready = false;
      this.suspended = false;
    }

    /**
     * Pick the tune the current mode wants.
     * @param {boolean} fresh - In shuffle, whether to move on to a different tune.
     * @returns {object|null} The song, or null for silence.
     */
    pick(fresh) {
      if (this.mode === 'off') {
        return null;
      }

      if (this.mode !== 'shuffle') {
        return SONGS.find((song) => song.id === this.mode);
      }

      if (!fresh && this.song) {
        return this.song;
      }

      const others = SONGS.filter((song) => song !== this.song);

      return others[Math.floor(Math.random() * others.length)];
    }

    /**
     * Switch to a tune, or to silence.
     * @param {object|null} song - The song to play, or null.
     * @param {boolean} [announce] - Whether to report it as a new tune.
     */
    playSong(song, announce = true) {
      if (!song) {
        this.player.stop();
        this.song = null;
        this.onChange();

        return;
      }

      if (song === this.song && this.player.playing) {
        return;
      }

      this.player.play(song);
      this.song = song;
      this.startedAt = this.now();

      if (announce) {
        this.onSong(song);
      }

      this.onChange();
    }

    /**
     * Note that audio is now allowed, without starting anything yet.
     */
    enable() {
      this.ready = true;
    }

    /**
     * Start playing, if audio is allowed and nothing is playing yet.
     */
    start() {
      this.enable();

      if (!this.suspended && !this.player.playing) {
        this.playSong(this.pick(false));
      }
    }

    /**
     * A new cave has started. In shuffle, move on to another tune, unless the current one only
     * just began.
     */
    newCave() {
      if (!this.ready || this.suspended || this.mode !== 'shuffle') {
        return;
      }

      if (this.now() - this.startedAt > MIN_PLAY * 1000) {
        this.playSong(this.pick(true));
      }
    }

    /**
     * Step to the next or previous music setting and play it.
     * @param {number} direction - 1 for the next setting, -1 for the previous one.
     * @returns {string} The new mode.
     */
    step(direction) {
      const index = CHOICES.indexOf(this.mode);

      this.mode = CHOICES[(index + direction + CHOICES.length) % CHOICES.length];

      if (this.ready && !this.suspended) {
        this.playSong(this.pick(this.mode === 'shuffle'));
      } else {
        this.onChange();
      }

      return this.mode;
    }

    /**
     * Go quiet while the game is out of sight, remembering what was playing.
     */
    suspend() {
      this.suspended = true;
      this.player.stop();
    }

    /**
     * Pick up again when the game comes back into sight.
     */
    resume() {
      this.suspended = false;

      if (!this.ready) {
        return;
      }

      const song = this.mode === 'shuffle' && this.song ? this.song : this.pick(false);

      this.song = null;
      this.playSong(song, false);
    }

    /**
     * Words for the music setting and what is playing.
     * @returns {object} The setting's name and, in shuffle, the tune playing.
     */
    label() {
      if (this.mode === 'off') {
        return { mode: 'Music off', now: '' };
      }

      if (this.mode === 'shuffle') {
        return { mode: 'Shuffle', now: this.song && this.player.playing ? this.song.title : '' };
      }

      return { mode: SONGS.find((song) => song.id === this.mode).title, now: '' };
    }
  }

  NS.Jukebox = { Jukebox, CHOICES, MIN_PLAY };
})(window.Rockfall);
