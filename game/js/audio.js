/**
 * Tiny Web Audio synthesizer for Rockfall.
 *
 * Every sound is generated at runtime, so the game stays a single self-contained folder with no
 * binary assets to load.
 */
window.Rockfall = window.Rockfall || {};

(function initAudio(NS) {
  /** Level of the sound effects. */
  const EFFECTS_LEVEL = 0.4;
  /** Level of the music channel. The songs are mixed loud, so this keeps them under the effects. */
  const MUSIC_LEVEL = 0.26;

  /**
   * A bank of short procedural sound effects.
   */
  class Sfx {
    /**
     * Create the bank in a suspended state; the audio context is built on the first gesture.
     */
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.musicOut = null;
      this.noiseBuffer = null;
    }

    /**
     * Create or resume the audio context. Browsers require this to happen inside a user gesture.
     */
    unlock() {
      const Ctor = window.AudioContext || window.webkitAudioContext;

      if (!Ctor) {
        return;
      }

      if (!this.ctx) {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : EFFECTS_LEVEL;
        this.master.connect(this.ctx.destination);
        // The music has its own channel, set under the effects so digging still cuts through.
        this.musicOut = this.ctx.createGain();
        this.musicOut.gain.value = this.muted ? 0 : MUSIC_LEVEL;
        this.musicOut.connect(this.ctx.destination);
        this.noiseBuffer = this.createNoise();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    /**
     * Build a one second buffer of white noise, reused by the percussive effects.
     * @returns {AudioBuffer} The noise buffer.
     */
    createNoise() {
      const { sampleRate } = this.ctx;
      const buffer = this.ctx.createBuffer(1, sampleRate, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }

      return buffer;
    }

    /**
     * Toggle muting.
     * @returns {boolean} The new muted state.
     */
    toggleMute() {
      this.muted = !this.muted;

      if (this.master) {
        this.master.gain.value = this.muted ? 0 : EFFECTS_LEVEL;
        this.musicOut.gain.value = this.muted ? 0 : MUSIC_LEVEL;
      }

      return this.muted;
    }

    /**
     * Play a pitched blip.
     * @param {object} options - Tone settings.
     * @param {number} options.from - Start frequency in hertz.
     * @param {number} [options.to] - End frequency in hertz.
     * @param {number} [options.length] - Duration in seconds.
     * @param {string} [options.type] - Oscillator waveform.
     * @param {number} [options.gain] - Peak gain.
     */
    tone({ from, to = from, length = 0.09, type = 'square', gain = 0.5 }) {
      if (!this.ctx || this.muted) {
        return;
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(from, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + length);
      osc.connect(env);
      env.connect(this.master);
      osc.start(now);
      osc.stop(now + length + 0.02);
    }

    /**
     * Play a filtered burst of noise.
     * @param {object} options - Noise settings.
     * @param {number} [options.length] - Duration in seconds.
     * @param {number} [options.from] - Start cutoff frequency in hertz.
     * @param {number} [options.to] - End cutoff frequency in hertz.
     * @param {number} [options.gain] - Peak gain.
     */
    noise({ length = 0.2, from = 1800, to = 200, gain = 0.5 }) {
      if (!this.ctx || this.muted) {
        return;
      }

      const now = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();

      source.buffer = this.noiseBuffer;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + length);
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + length);
      source.connect(filter);
      filter.connect(env);
      env.connect(this.master);
      source.start(now);
      source.stop(now + length);
    }

    /**
     * Play the effect matching a game event.
     * @param {string} event - Event name emitted by the cave simulation.
     */
    play(event) {
      switch (event) {
        case 'dig':
          this.noise({ length: 0.07, from: 900, to: 300, gain: 0.25 });
          break;
        case 'gem':
          this.tone({ from: 880, to: 1760, length: 0.11, type: 'square', gain: 0.32 });
          break;
        case 'push':
          this.noise({ length: 0.14, from: 500, to: 120, gain: 0.35 });
          break;
        case 'land':
          this.noise({ length: 0.08, from: 380, to: 90, gain: 0.22 });
          break;
        case 'pickup':
          this.tone({ from: 300, to: 700, length: 0.12, type: 'triangle', gain: 0.35 });
          break;
        case 'drop':
          this.tone({ from: 500, to: 180, length: 0.12, type: 'sawtooth', gain: 0.3 });
          break;
        case 'boom':
          this.noise({ length: 0.5, from: 2400, to: 60, gain: 0.7 });
          this.tone({ from: 160, to: 40, length: 0.42, type: 'sawtooth', gain: 0.4 });
          break;
        case 'open':
          this.tone({ from: 523, to: 1046, length: 0.3, type: 'triangle', gain: 0.35 });
          break;
        case 'exit':
          [523, 659, 784, 1046].forEach((hz, i) => {
            window.setTimeout(() => this.tone({ from: hz, length: 0.16, gain: 0.35 }), i * 110);
          });
          break;
        case 'death':
          this.tone({ from: 320, to: 40, length: 0.8, type: 'sawtooth', gain: 0.4 });
          break;
        case 'tick':
          this.tone({ from: 1400, length: 0.04, type: 'square', gain: 0.14 });
          break;
        default:
          break;
      }
    }
  }

  NS.Sfx = Sfx;
})(window.Rockfall);
