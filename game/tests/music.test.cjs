// Music checks: `node game/tests/music.test.cjs`.
//
// Every song pattern is well formed, and the jukebox shuffles, steps and suspends as it should.
// Web Audio is not available in Node, so the jukebox drives a stand-in player here.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'js');
const sandbox = { window: {}, Math, console, performance: { now: () => 0 } };

vm.createContext(sandbox);
['music.js', 'jukebox.js'].forEach((file) =>
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file }),
);

const { Music, Jukebox } = sandbox.window.Rockfall;
const { SONGS, frequency, tokens } = Music;
let failures = 0;

/** Report one assertion. */
const check = (name, condition, extra = '') => {
  if (condition) {
    console.log('ok  :', name);
  } else {
    failures += 1;
    console.log('FAIL:', name, extra);
  }
};

// --- Songs ---------------------------------------------------------------------------------
check('there are three songs', SONGS.length === 3, SONGS.length);

SONGS.forEach((song) => {
  const problems = [];

  song.bars.forEach((bar, i) => {
    ['bass', 'lead', 'arp'].forEach((lane) => {
      if (!bar[lane]) {
        return;
      }

      const steps = tokens(bar[lane]);

      if (steps.length !== 16) {
        problems.push(`bar ${i} ${lane} has ${steps.length} steps`);
      }

      steps.forEach((note, step) => {
        if (note === '-' && (step === 0 || steps[step - 1] === '.')) {
          problems.push(`bar ${i} ${lane} holds nothing at step ${step}`);
        } else if (note !== '.' && note !== '-') {
          try {
            const hz = frequency(note);

            if (!(hz > 20 && hz < 5000)) {
              problems.push(`bar ${i} ${lane} note ${note} is out of range`);
            }
          } catch {
            problems.push(`bar ${i} ${lane} has a bad note ${note}`);
          }
        }
      });
    });
    ['kick', 'snare', 'rim', 'hat', 'shaker', 'crunch', 'hits'].forEach((lane) => {
      if (bar[lane] && !/^[x.]{16}$/.test(bar[lane])) {
        problems.push(`bar ${i} ${lane} is not 16 steps of x and .`);
      }
    });
    (bar.chord || []).forEach((note) => {
      try {
        frequency(note);
      } catch {
        problems.push(`bar ${i} has a bad chord note ${note}`);
      }
    });
  });

  check(`${song.title} patterns are well formed`, problems.length === 0, problems.join('; '));
  check(
    `${song.title} has a loop after its intro`,
    song.loopFrom > 0 && song.loopFrom < song.bars.length,
  );
  check(
    `${song.title} has a voice for every lane`,
    ['lead', 'bass', 'chord'].every((lane) => song.voices[lane]),
  );
});

// --- Jukebox -------------------------------------------------------------------------------
/** A stand-in for MusicPlayer that remembers what it was asked to do. */
const fakePlayer = () => ({
  playing: false,
  song: null,
  plays: 0,
  play(song) {
    this.playing = true;
    this.song = song;
    this.plays += 1;
  },
  stop() {
    this.playing = false;
    this.song = null;
  },
  setVolume() {},
});

let clock = 0;
const announced = [];
const player = fakePlayer();
const box = new Jukebox.Jukebox({
  player,
  onSong: (song) => announced.push(song.id),
  now: () => clock,
});

check('shuffle is the default', box.mode === 'shuffle');
box.step(1);
check('nothing plays before sound is allowed', !player.playing);
box.step(-1);
box.start();
check('starting plays a tune and announces it', player.playing && announced.length === 1);

const first = box.song;

clock = 5000;
box.newCave();
check('a new cave keeps a tune that only just began', box.song === first);

let repeats = 0;
let previous = box.song;
const heard = new Set([previous.id]);

for (let i = 0; i < 60; i += 1) {
  clock += 25000;
  box.newCave();

  if (box.song === previous) {
    repeats += 1;
  }

  previous = box.song;
  heard.add(previous.id);
}

check('shuffle never plays the same tune twice in a row', repeats === 0, `${repeats} repeats`);
check('shuffle gets round every tune', heard.size === SONGS.length, [...heard].join(', '));

const order = [];

for (let i = 0; i < Jukebox.CHOICES.length; i += 1) {
  order.push(box.step(1));
}

check(
  'the arrows step through every setting and wrap round',
  JSON.stringify(order) === JSON.stringify([...Jukebox.CHOICES.slice(1), 'shuffle']),
  order.join(' > '),
);

box.step(1);
check('picking a tune plays that tune', box.mode === 'deepSeam' && player.song.id === 'deepSeam');
clock += 60000;
box.newCave();
check('a chosen tune stays on through new caves', player.song.id === 'deepSeam');

const countBefore = announced.length;

box.suspend();
check('going out of sight stops the music', !player.playing);
box.resume();
check('coming back plays the same tune again', player.playing && player.song.id === 'deepSeam');
check('coming back does not announce the tune again', announced.length === countBefore);

while (box.mode !== 'off') {
  box.step(1);
}

check('off is silent', !player.playing && box.label().mode === 'Music off');
box.suspend();
box.resume();
check('off stays silent after coming back', !player.playing);

const stale = new Jukebox.Jukebox({ player: fakePlayer(), mode: 'someOldTune' });

check('an unknown saved setting falls back to shuffle', stale.mode === 'shuffle');

console.log(failures === 0 ? '\nALL MUSIC TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
