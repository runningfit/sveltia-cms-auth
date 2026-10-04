/**
 * Background music for Rockfall.
 *
 * A tiny sequencer and a handful of synth voices, all built on Web Audio at runtime, so the songs
 * cost a few kilobytes of text rather than megabytes of audio. Songs are written as bars of 16
 * steps: a note name plays, `-` holds the note before it, and `.` is a rest. Drum lanes use `x`.
 *
 * The same scheduling code drives live playback and offline rendering, so a preview rendered to
 * a file sounds exactly like the game.
 */
window.Rockfall = window.Rockfall || {};

(function initMusic(NS) {
  /** Seconds of music scheduled ahead of the audio clock while playing live. */
  const LOOKAHEAD = 0.15;
  /** How often the live scheduler wakes up, in milliseconds. */
  const PUMP_MS = 25;
  /** Note names to semitones above C. */
  const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /**
   * Turn a note name such as `C#5` or `Bb3` into a frequency in hertz.
   * @param {string} name - Note name with octave.
   * @returns {number} Frequency in hertz.
   */
  const frequency = (name) => {
    const [, letter, accidental, octave] = name.match(/^([A-G])(#|b)?(-?\d)$/);
    const shift = { '#': 1, b: -1 }[accidental] || 0;
    const midi = (Number(octave) + 1) * 12 + SEMITONES[letter] + shift;

    return 440 * 2 ** ((midi - 69) / 12);
  };

  /**
   * Synth voices. Each describes oscillators, a filter and an envelope; `send` is how much goes
   * to the echo.
   */
  const VOICES = {
    softLead: {
      wave: 'square',
      cutoff: 1900,
      attack: 0.012,
      decay: 0.25,
      sustain: 0.55,
      release: 0.14,
      gain: 0.13,
      vibrato: 5,
      send: 0.35,
    },
    bell: {
      wave: 'sine',
      fmRatio: 3.5,
      fmDepth: 1.6,
      attack: 0.003,
      decay: 0.7,
      sustain: 0.0,
      release: 0.5,
      gain: 0.26,
      send: 0.45,
    },
    whistle: {
      wave: 'triangle',
      cutoff: 6000,
      attack: 0.025,
      decay: 0.2,
      sustain: 0.8,
      release: 0.1,
      gain: 0.17,
      vibrato: 9,
      send: 0.25,
    },
    blip: {
      wave: 'square',
      cutoff: 2600,
      attack: 0.002,
      decay: 0.09,
      sustain: 0,
      release: 0.06,
      gain: 0.035,
      send: 0.55,
    },
    sparkle: {
      wave: 'sine',
      fmRatio: 4,
      fmDepth: 0.8,
      attack: 0.002,
      decay: 0.25,
      sustain: 0,
      release: 0.2,
      gain: 0.07,
      send: 0.5,
    },
    pluckBass: {
      wave: 'triangle',
      second: 'square',
      secondGain: 0.25,
      cutoff: 900,
      attack: 0.004,
      decay: 0.22,
      sustain: 0.45,
      release: 0.08,
      gain: 0.3,
      send: 0,
    },
    subBass: {
      wave: 'triangle',
      cutoff: 700,
      attack: 0.03,
      decay: 0.4,
      sustain: 0.85,
      release: 0.3,
      gain: 0.17,
      send: 0,
    },
    funkBass: {
      wave: 'square',
      cutoff: 500,
      filterEnv: 1500,
      attack: 0.003,
      decay: 0.16,
      sustain: 0.35,
      release: 0.05,
      gain: 0.16,
      send: 0,
    },
    warmPad: {
      wave: 'sawtooth',
      detune: 9,
      cutoff: 850,
      attack: 0.6,
      decay: 1,
      sustain: 0.9,
      release: 0.9,
      gain: 0.022,
      send: 0.2,
    },
    glassPad: {
      wave: 'triangle',
      detune: 6,
      cutoff: 2600,
      attack: 0.9,
      decay: 1,
      sustain: 0.9,
      release: 1.1,
      gain: 0.025,
      send: 0.3,
    },
    stabPad: {
      wave: 'sawtooth',
      detune: 7,
      cutoff: 1500,
      attack: 0.008,
      decay: 0.18,
      sustain: 0.15,
      release: 0.1,
      gain: 0.05,
      send: 0.15,
    },
  };

  /**
   * Make the shared bits of a mix: master level, compressor, an echo the lead and arpeggios can
   * feed, and a buffer of noise for the drums.
   * @param {BaseAudioContext} ctx - Audio context, live or offline.
   * @param {AudioNode} out - Where the mix goes.
   * @param {number} echoTime - Echo delay in seconds.
   * @param {number} [level] - Overall level, so every song plays at about the same loudness.
   * @returns {object} The bus.
   */
  const makeBus = (ctx, out, echoTime, level = 1) => {
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    const send = ctx.createGain();
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);

    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.random() * 2 - 1;
    }

    master.gain.value = 0.9 * level;
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    delay.delayTime.value = echoTime;
    feedback.gain.value = 0.33;
    tone.type = 'lowpass';
    tone.frequency.value = 1700;
    master.connect(comp);
    comp.connect(out);
    send.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(master);

    return { ctx, master, send, noise, out: master };
  };

  /**
   * Play one synth note.
   * @param {object} bus - The mix to play into.
   * @param {object} voice - Voice settings from VOICES.
   * @param {number} freq - Frequency in hertz.
   * @param {number} time - Start time on the audio clock.
   * @param {number} length - How long the note is held, in seconds.
   * @param {number} [velocity] - Loudness from 0 to 1.
   */
  const playNote = (bus, voice, freq, time, length, velocity = 1) => {
    const { ctx } = bus;
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const end = time + length;
    const stopAt = end + voice.release * 3 + 0.05;
    const peak = voice.gain * velocity;
    const oscillators = [];

    filter.type = 'lowpass';
    filter.frequency.value = voice.cutoff || 20000;

    if (voice.filterEnv) {
      filter.frequency.setValueAtTime(voice.cutoff + voice.filterEnv, time);
      filter.frequency.setTargetAtTime(voice.cutoff, time, voice.decay / 2);
    }

    const tunings = voice.detune ? [-voice.detune, voice.detune] : [0];

    tunings.forEach((cents) => {
      const osc = ctx.createOscillator();

      osc.type = voice.wave;
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(filter);
      oscillators.push(osc);
    });

    if (voice.second) {
      const osc = ctx.createOscillator();
      const level = ctx.createGain();

      osc.type = voice.second;
      osc.frequency.value = freq;
      level.gain.value = voice.secondGain;
      osc.connect(level);
      level.connect(filter);
      oscillators.push(osc);
    }

    if (voice.fmRatio) {
      // A second sine wobbling the first gives the glassy, bell-like tone.
      const mod = ctx.createOscillator();
      const depth = ctx.createGain();

      mod.frequency.value = freq * voice.fmRatio;
      depth.gain.setValueAtTime(freq * voice.fmDepth, time);
      depth.gain.setTargetAtTime(freq * voice.fmDepth * 0.2, time, voice.decay / 2);
      mod.connect(depth);
      oscillators.forEach((osc) => depth.connect(osc.frequency));
      oscillators.push(mod);
    }

    if (voice.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();

      lfo.frequency.value = 5.2;
      depth.gain.setValueAtTime(0, time);
      depth.gain.linearRampToValueAtTime(voice.vibrato, time + 0.25);
      lfo.connect(depth);
      oscillators.forEach((osc) => depth.connect(osc.detune));
      oscillators.push(lfo);
    }

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + voice.attack);
    env.gain.setTargetAtTime(peak * voice.sustain, time + voice.attack, voice.decay / 3);
    env.gain.setTargetAtTime(0, Math.max(end, time + voice.attack), voice.release / 3);
    filter.connect(env);
    env.connect(bus.out);

    if (voice.send) {
      const send = ctx.createGain();

      send.gain.value = voice.send;
      env.connect(send);
      send.connect(bus.send);
    }

    oscillators.forEach((osc) => {
      osc.start(time);
      osc.stop(stopAt);
    });
  };

  /**
   * Drum sounds. Each takes the bus, a start time and a loudness.
   */
  const DRUMS = {
    /**
     * Play a kick drum.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    kick: (bus, time, level) => {
      const { ctx } = bus;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
      env.gain.setValueAtTime(0.55 * level, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.connect(env);
      env.connect(bus.out);
      osc.start(time);
      osc.stop(time + 0.32);
    },
    /**
     * Play a snare.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    snare: (bus, time, level) => {
      DRUMS.noise(bus, time, {
        type: 'bandpass',
        freq: 1800,
        q: 0.8,
        length: 0.14,
        gain: 0.55 * level,
      });
    },
    /**
     * Play a rim click.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    rim: (bus, time, level) => {
      DRUMS.noise(bus, time, {
        type: 'bandpass',
        freq: 3200,
        q: 4,
        length: 0.035,
        gain: 0.7 * level,
      });
    },
    /**
     * Play a closed hi-hat.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    hat: (bus, time, level) => {
      DRUMS.noise(bus, time, {
        type: 'highpass',
        freq: 7500,
        q: 0.7,
        length: 0.03,
        gain: 0.12 * level,
      });
    },
    /**
     * Play a shaker.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    shaker: (bus, time, level) => {
      DRUMS.noise(bus, time, {
        type: 'bandpass',
        freq: 6000,
        q: 1.2,
        length: 0.05,
        gain: 0.09 * level,
      });
    },
    // The dig: a soft, earthy crunch, like a shovel going into dirt.
    /**
     * Play the dig crunch.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {number} level - Loudness from 0 to 1.
     */
    crunch: (bus, time, level) => {
      DRUMS.noise(bus, time, {
        type: 'lowpass',
        freq: 650,
        q: 1.5,
        length: 0.09,
        gain: 0.45 * level,
      });
    },
    /**
     * Play a filtered burst of noise, the basis of every drum but the kick.
     * @param {object} bus - The mix to play into.
     * @param {number} time - Start time on the audio clock.
     * @param {object} sound - How the burst is shaped.
     * @param {string} sound.type - Filter type.
     * @param {number} sound.freq - Filter frequency in hertz.
     * @param {number} sound.q - Filter resonance.
     * @param {number} sound.length - Length in seconds.
     * @param {number} sound.gain - Peak level.
     */
    noise: (bus, time, { type, freq, q, length, gain }) => {
      const { ctx } = bus;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      source.buffer = bus.noise;
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      env.gain.setValueAtTime(gain, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + length);
      source.connect(filter);
      filter.connect(env);
      env.connect(bus.out);
      source.start(time, Math.random() * 0.5);
      source.stop(time + length + 0.02);
    },
  };

  /** Drum lanes a bar can use. */
  const DRUM_LANES = ['kick', 'snare', 'rim', 'hat', 'shaker', 'crunch'];
  /** Melodic lanes a bar can use, each played with the song's voice of the same name. */
  const NOTE_LANES = ['bass', 'lead', 'arp'];
  /**
   * Split a 16 step pattern into tokens.
   * @param {string} pattern - Space separated note tokens.
   * @returns {string[]} Sixteen tokens.
   */
  const tokens = (pattern) => pattern.trim().split(/\s+/);

  /**
   * Schedule everything that starts on one step of one bar.
   * @param {object} bus - The mix to play into.
   * @param {object} song - The song.
   * @param {object} bar - The bar being played.
   * @param {number} step - Step within the bar, 0 to 15.
   * @param {number} time - When the step starts on the audio clock.
   */
  const playStep = (bus, song, bar, step, time) => {
    const stepLength = 60 / song.bpm / 4;

    DRUM_LANES.forEach((lane) => {
      if (bar[lane] && bar[lane][step] === 'x') {
        DRUMS[lane](bus, time, song.drumLevel || 1);
      }
    });

    NOTE_LANES.forEach((lane) => {
      if (!bar[lane]) {
        return;
      }

      const notes = tokens(bar[lane]);
      const note = notes[step];

      if (note === '.' || note === '-') {
        return;
      }

      let held = 1;

      while (notes[step + held] === '-') {
        held += 1;
      }

      playNote(bus, VOICES[song.voices[lane]], frequency(note), time, held * stepLength * 0.92);
    });

    // Chords: held for the bar, or struck on the steps marked in `hits`.
    if (bar.chord) {
      const hits = bar.hits || 'x...............';

      if (hits[step] === 'x') {
        let held = 1;

        while (step + held < 16 && hits[step + held] !== 'x') {
          held += 1;
        }

        bar.chord.forEach((note) => {
          playNote(bus, VOICES[song.voices.chord], frequency(note), time, held * stepLength);
        });
      }
    }
  };

  /**
   * When a step starts, allowing for swing on the off-beat sixteenths.
   * @param {object} song - The song.
   * @param {number} barStart - When the bar starts.
   * @param {number} step - Step within the bar.
   * @returns {number} Start time of the step.
   */
  const stepTime = (song, barStart, step) => {
    const stepLength = 60 / song.bpm / 4;

    return barStart + step * stepLength + (step % 2 ? (song.swing || 0) * stepLength : 0);
  };

  /**
   * Plays songs live, looping, on an audio context it is handed.
   */
  class MusicPlayer {
    /**
     * Start silent.
     */
    constructor() {
      this.ctx = null;
      this.output = null;
      this.song = null;
      this.timer = null;
      this.volume = 0.8;
      this.onStep = null;
    }

    /**
     * Use an audio context, for instance the one the sound effects already unlocked.
     * @param {AudioContext} ctx - The audio context.
     * @param {AudioNode} [destination] - Where the music goes; the speakers by default.
     */
    attach(ctx, destination) {
      this.ctx = ctx;
      this.destination = destination || ctx.destination;
    }

    /**
     * Start a song from the top, stopping whatever was playing.
     * @param {object} song - A song from SONGS.
     */
    play(song) {
      this.stop();

      if (!this.ctx) {
        return;
      }

      this.song = song;
      this.output = this.ctx.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(this.destination);
      this.bus = makeBus(this.ctx, this.output, (3 * 60) / song.bpm / 4, song.level);
      this.barIndex = 0;
      this.step = 0;
      this.barStart = this.ctx.currentTime + 0.08;
      this.timer = window.setInterval(() => this.pump(), PUMP_MS);
      this.pump();
    }

    /**
     * Schedule whatever falls inside the lookahead window.
     */
    pump() {
      const { song } = this;
      const horizon = this.ctx.currentTime + LOOKAHEAD;

      while (stepTime(song, this.barStart, this.step) < horizon) {
        const time = stepTime(song, this.barStart, this.step);

        playStep(this.bus, song, song.bars[this.barIndex], this.step, time);

        if (this.onStep) {
          const { barIndex, step } = this;
          const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);

          window.setTimeout(() => this.onStep && this.onStep(barIndex, step), delay);
        }

        this.step += 1;

        if (this.step === 16) {
          this.step = 0;
          this.barStart += (16 * 60) / song.bpm / 4;
          this.barIndex += 1;

          if (this.barIndex >= song.bars.length) {
            this.barIndex = song.loopFrom || 0;
          }
        }
      }
    }

    /**
     * Fade out and stop.
     */
    stop() {
      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }

      if (this.output) {
        const { output } = this;
        const now = this.ctx.currentTime;

        output.gain.setTargetAtTime(0, now, 0.08);
        window.setTimeout(() => output.disconnect(), 600);
        this.output = null;
      }

      this.song = null;
    }

    /**
     * Set the music volume.
     * @param {number} volume - From 0 to 1.
     */
    setVolume(volume) {
      this.volume = volume;

      if (this.output) {
        this.output.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
      }
    }

    /**
     * Whether a song is playing.
     * @returns {boolean} True while playing.
     */
    get playing() {
      return Boolean(this.timer);
    }
  }

  /**
   * Render a stretch of a song to an audio buffer, for previews and tests.
   * @param {object} song - A song from SONGS.
   * @param {number} seconds - How much to render.
   * @param {number} [sampleRate] - Sample rate of the result.
   * @returns {Promise<AudioBuffer>} The rendered audio.
   */
  const render = (song, seconds, sampleRate = 44100) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
    const bus = makeBus(ctx, ctx.destination, (3 * 60) / song.bpm / 4, song.level);
    const barLength = (16 * 60) / song.bpm / 4;
    let barIndex = 0;

    for (let barStart = 0.05; barStart < seconds; barStart += barLength) {
      for (let step = 0; step < 16; step += 1) {
        playStep(bus, song, song.bars[barIndex], step, stepTime(song, barStart, step));
      }

      barIndex += 1;

      if (barIndex >= song.bars.length) {
        barIndex = song.loopFrom || 0;
      }
    }

    return ctx.startRendering();
  };

  // ---------------------------------------------------------------------------------------
  // The songs.
  // ---------------------------------------------------------------------------------------

  /**
   * Deep Seam: a laid-back dig groove in A minor. A plucked bass that bounces around the root,
   * a shovel crunch on the off-beats, warm pads, and a four note hook that keeps coming back.
   */
  const deepSeam = (() => {
    const chords = {
      Am: ['A3', 'C4', 'E4', 'G4', 'B4'],
      F: ['F3', 'A3', 'C4', 'E4'],
      C: ['G3', 'B3', 'C4', 'E4'],
      G: ['G3', 'B3', 'D4', 'E4'],
    };

    const bass = {
      Am: 'A2 . . A3 . . A2 . . . A2 . C3 . E3 .',
      F: 'F2 . . F3 . . F2 . . . F2 . A2 . C3 .',
      C: 'C2 . . C3 . . C2 . . . C2 . E2 . G2 .',
      G: 'G2 . . G3 . . G2 . . . G2 . B2 . D3 .',
    };

    const arp = {
      Am: 'A4 . E5 . C5 . E5 . A4 . E5 . C5 . G5 .',
      F: 'F4 . C5 . A4 . C5 . F4 . C5 . A4 . E5 .',
      C: 'G4 . E5 . C5 . E5 . G4 . E5 . C5 . B4 .',
      G: 'G4 . D5 . B4 . D5 . G4 . D5 . B4 . E5 .',
    };

    const groove = {
      kick: 'x.....x...x.....',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      crunch: '.......x.......x',
    };

    const quiet = { hat: 'x.x.x.x.x.x.x.x.', crunch: '.......x.......x' };

    /**
     * Build a full bar: the chord's pad and bass, the groove, and a lead line.
     * @param {string} chord - Chord name.
     * @param {string} lead - Lead pattern.
     * @param {object} [extra] - Extra lanes for this bar.
     * @returns {object} The bar.
     */
    const bar = (chord, lead, extra = {}) => ({
      chord: chords[chord],
      bass: bass[chord],
      lead,
      ...groove,
      ...extra,
    });

    return {
      id: 'deepSeam',
      key: 'A minor',
      level: 0.9,
      title: 'Deep Seam',
      mood: 'Chill dig groove: plucky bass, a shovel crunch on the off-beat, a hook you can hum.',
      bpm: 86,
      swing: 0.12,
      voices: { lead: 'softLead', bass: 'pluckBass', arp: 'blip', chord: 'warmPad' },
      loopFrom: 2,
      bars: [
        { chord: chords.Am, bass: bass.Am, ...quiet },
        { chord: chords.F, bass: bass.F, ...quiet },
        bar('Am', 'E5 - - D5 E5 - - - A4 - - - - - - -'),
        bar('F', 'C5 - - B4 C5 - - - A4 - - - G4 - A4 -'),
        bar('C', 'E5 - - D5 E5 - - - G5 - - - E5 - D5 -'),
        bar('G', 'D5 - - - - - - - - - - - . . . .'),
        bar('Am', 'E5 - - D5 E5 - - - A4 - - - - - - -'),
        bar('F', 'C5 - - B4 C5 - - - A4 - - - G4 - A4 -'),
        bar('C', 'E5 - - D5 E5 - - - G5 - - - E5 - D5 -'),
        bar('G', 'D5 - - - B4 - - - A4 - - - - - . .'),
        bar('Am', 'A5 - . A5 G5 - E5 - . . E5 - D5 - E5 -', { arp: arp.Am }),
        bar('F', 'C5 - - - . . A4 - C5 - D5 - E5 - - -', { arp: arp.F }),
        bar('C', 'G5 - . G5 E5 - D5 - . . C5 - D5 - E5 -', { arp: arp.C }),
        bar('G', 'D5 - - - - - - - . . . . . . . .', { arp: arp.G }),
        bar('Am', 'E5 - - D5 E5 - - - A4 - - - - - - -'),
        bar('F', 'C5 - - B4 C5 - - - A4 - - - G4 - A4 -'),
        bar('C', 'E5 - - D5 E5 - - - G5 - - - E5 - D5 -'),
        bar('G', 'D5 - - - B4 - - - A4 - - - - - . .'),
        { chord: chords.Am, bass: bass.Am, ...quiet, arp: arp.Am },
        { chord: chords.G, bass: bass.G, ...quiet, arp: arp.G },
      ],
    };
  })();

  /**
   * Crystal Cavern: dreamy and sparkly in C major. Bell arpeggios ripple over soft pads and a
   * long, low bass, with a floating bell melody and a lydian sparkle on the F chord.
   */
  const crystalCavern = (() => {
    const chords = {
      C: ['C4', 'E4', 'G4', 'B4'],
      Am: ['A3', 'C4', 'E4', 'G4'],
      F: ['F3', 'A3', 'C4', 'E4'],
      G: ['G3', 'B3', 'D4', 'G4'],
    };

    const bass = {
      C: 'C2 - - - - - - - - - - - G2 - - -',
      Am: 'A1 - - - - - - - - - - - E2 - - -',
      F: 'F1 - - - - - - - - - - - C2 - - -',
      G: 'G1 - - - - - - - D2 - - - G2 - - -',
    };

    const arp = {
      C: 'C5 E5 G5 B5 G5 E5 C5 E5 G5 B5 C6 B5 G5 E5 G5 E5',
      Am: 'A4 C5 E5 G5 E5 C5 A4 C5 E5 G5 A5 G5 E5 C5 E5 C5',
      F: 'F4 A4 C5 E5 C5 A4 F4 A4 C5 E5 F5 E5 C5 A4 C5 A4',
      G: 'G4 B4 D5 G5 D5 B4 G4 B4 D5 G5 B5 G5 D5 B4 D5 B4',
    };

    const beat = { kick: 'x.......x.......', rim: '............x...', shaker: 'x.x.x.x.x.x.x.x.' };

    /**
     * Build a full bar: the chord's pad and bass, the groove, and a lead line.
     * @param {string} chord - Chord name.
     * @param {string} lead - Lead pattern.
     * @param {object} [extra] - Extra lanes for this bar.
     * @returns {object} The bar.
     */
    const bar = (chord, lead, extra = {}) => ({
      chord: chords[chord],
      bass: bass[chord],
      arp: arp[chord],
      lead,
      ...beat,
      ...extra,
    });

    return {
      id: 'crystalCavern',
      key: 'C major',
      level: 0.9,
      title: 'Crystal Cavern',
      mood: 'Dreamy and sparkly: rippling bell arpeggios, soft pads, a floating melody.',
      bpm: 96,
      swing: 0,
      voices: { lead: 'bell', bass: 'subBass', arp: 'sparkle', chord: 'glassPad' },
      loopFrom: 2,
      bars: [
        { chord: chords.C, bass: bass.C, arp: arp.C },
        { chord: chords.Am, bass: bass.Am, arp: arp.Am, shaker: 'x.x.x.x.x.x.x.x.' },
        bar('C', 'G5 - - - E5 - - - D5 - E5 - - - - -'),
        bar('Am', 'C5 - - - - - - - A4 - C5 - D5 - - -'),
        bar('F', 'E5 - - - F#5 - - - G5 - - - E5 - - -'),
        bar('G', 'D5 - - - - - - - - - - - . . . .'),
        bar('C', 'C6 - . B5 - . G5 - . . A5 - G5 - E5 -'),
        bar('Am', 'G5 - - - - - . . E5 - G5 - A5 - - -'),
        bar('F', 'B5 - - - A5 - G5 - - - E5 - G5 - - -'),
        bar('G', 'A5 - - - - - G5 - - - - - . . . .'),
        bar('C', 'G5 - - - E5 - - - D5 - E5 - - - - -'),
        bar('Am', 'C5 - - - - - - - A4 - C5 - D5 - - -'),
        bar('F', 'E5 - - - F#5 - - - G5 - - - E5 - - -'),
        bar('G', 'D5 - - - E5 - - - C5 - - - - - . .'),
        { chord: chords.F, bass: bass.F, arp: arp.F, shaker: 'x.x.x.x.x.x.x.x.' },
        { chord: chords.G, bass: bass.G, arp: arp.G, shaker: 'x.x.x.x.x.x.x.x.' },
      ],
    };
  })();

  /**
   * Rockslide Shuffle: bouncy and swung in D dorian. A funky octave bass, punchy chord stabs, a
   * busy hat, and a whistled tune with a call and an answer.
   */
  const rockslideShuffle = (() => {
    const chords = {
      Dm: ['D4', 'F4', 'A4', 'C5'],
      G: ['G3', 'B3', 'D4', 'F4'],
      Bb: ['Bb3', 'D4', 'F4', 'A4'],
      C: ['C4', 'E4', 'G4'],
      A: ['A3', 'C#4', 'E4', 'G4'],
    };

    const bass = {
      Dm: 'D2 . D3 . . D2 . C3 . D2 . . A2 . C3 .',
      G: 'G2 . G3 . . G2 . F3 . G2 . . D3 . F3 .',
      Bb: 'Bb1 . Bb2 . . Bb1 . A2 . Bb1 . . F2 . A2 .',
      C: 'C2 . C3 . . C2 . B2 . C2 . . G2 . B2 .',
      A: 'A1 . A2 . . A1 . G2 . A1 . . E2 . G2 .',
    };

    const beat = {
      kick: 'x.....x...x..x..',
      snare: '....x.......x...',
      hat: 'x.xxx.xxx.xxx.xx',
      crunch: '..x.......x.....',
      hits: '...x..x.......x.',
    };

    /**
     * Build a full bar: the chord's stabs and bass, the groove, and a lead line.
     * @param {string} chord - Chord name.
     * @param {string} lead - Lead pattern.
     * @returns {object} The bar.
     */
    const bar = (chord, lead) => ({ chord: chords[chord], bass: bass[chord], lead, ...beat });

    return {
      id: 'rockslideShuffle',
      key: 'D dorian',
      level: 1.04,
      title: 'Rockslide Shuffle',
      mood: 'Bouncy and swung: funky bass, chord stabs, a whistled tune with a call and answer.',
      bpm: 106,
      swing: 0.2,
      voices: { lead: 'whistle', bass: 'funkBass', arp: 'blip', chord: 'stabPad' },
      loopFrom: 2,
      bars: [
        { bass: bass.Dm, hat: beat.hat, crunch: beat.crunch },
        { bass: bass.G, hat: beat.hat, crunch: beat.crunch, kick: 'x.....x...x.x.x.' },
        bar('Dm', 'A4 . C5 . D5 - . F5 - - E5 - D5 . C5 .'),
        bar('G', 'D5 - - . . . B4 . C5 . D5 . . . . .'),
        bar('Dm', 'A4 . C5 . D5 - . F5 - - G5 - F5 . E5 .'),
        bar('G', 'D5 - - - - - - - . . . . . . . .'),
        bar('Bb', 'F5 - - . D5 - . F5 - . G5 - F5 . D5 .'),
        bar('C', 'E5 - - - . . C5 . D5 . E5 . G5 - - .'),
        bar('Dm', 'F5 - - . D5 - . A4 - - . . C5 . D5 .'),
        bar('A', 'E5 - - - C#5 - - - . . . . . . . .'),
        bar('Dm', 'A4 . C5 . D5 - . F5 - - E5 - D5 . C5 .'),
        bar('G', 'D5 - - . . . B4 . C5 . D5 . . . . .'),
        bar('Dm', 'A4 . C5 . D5 - . F5 - - G5 - F5 . E5 .'),
        bar('G', 'D5 - - - F5 - - - A5 - - - . . . .'),
      ],
    };
  })();

  const SONGS = [deepSeam, crystalCavern, rockslideShuffle];

  NS.Music = { MusicPlayer, SONGS, render, frequency, tokens };
})(window.Rockfall);
