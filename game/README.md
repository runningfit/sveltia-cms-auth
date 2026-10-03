# Rockfall

A browser remake of _Rockfall_, the 1991 Acorn Archimedes cave game by Eterna — one of the many descendants of Boulder Dash that appeared on 8 and 16 bit machines. You dig through the earth, collect the gems, dodge the rocks you dislodge, and get out through the exit before the clock runs down.

It runs from a plain folder of static files with no build step and no dependencies, and it is meant to be played with a thumb as happily as with a keyboard.

## Playing it

Once GitHub Pages is switched on for this repository (Settings → Pages → Source: **GitHub Actions**), every push to `main` that touches `game/` publishes the game to:

**https://runningfit.github.io/sveltia-cms-auth/**

The deploy runs the tests below first and publishes only the playable files, not the tests or these notes. You can also run the "Deploy Rockfall to GitHub Pages" workflow by hand from the Actions tab.

To play locally, open `index.html` in a browser or serve the folder:

```sh
npx http-server game -p 8080   # then open http://localhost:8080
```

### On your phone

The game installs to the home screen and runs full screen, and once it has been opened online it plays with no connection at all.

- **Android (Chrome):** tap the ⤓ button in the status bar, or Chrome's menu → _Add to home screen_.
- **iPhone (Safari):** tap Share → _Add to Home Screen_. Safari has no install prompt, so the ⤓ button does not appear there.

Updates arrive by themselves and all at once. Every deploy stamps the release into `sw.js`, so the phone notices a new version, downloads the whole release in the background, and only switches to it once it has every file; it never runs a mix of two releases. If the game is on its start or game over screen when the download finishes it reloads into the new release straight away; mid-game it carries on, and the new release is there the next time the game is opened.

### Controls

| Action       | Keyboard           | Touch                                       |
| ------------ | ------------------ | ------------------------------------------- |
| Dig and move | Arrow keys or WASD | The joystick or d-pad, or swipe on the cave |
| Drop a bomb  | Space              | The ● key, or double tap the cave           |
| Pause        | P or Esc           | The ▮▮ button                               |
| Sound on/off | M                  | The ♫ button                                |
| Restart cave | R (costs a miner)  | —                                           |

On a phone there are two on screen controls; pick one with the **Joystick / D-pad** switch on the start and pause screens, and the choice is remembered.

- **Joystick** (the default) floats: put your thumb down anywhere in the bottom left and the stick centers under it, then hold it over to keep walking. If your thumb runs past the edge the stick follows it, so a short pull back is always enough to turn around.
- **D-pad** responds across its whole square rather than just on the arrows: whichever side of the center your thumb is on is the way you go.

Both hold on to the direction you are going until your thumb clearly moves to another, so a thumb resting near a diagonal does not jitter between two directions. Swiping on the cave itself also steers, in either mode: press anywhere on the cave, drag the way you want, and keep holding. A quick double tap on the cave drops a bomb; a swipe never counts as a tap, so steering will not set one off by accident.

## Rules of the cave

- **Gems** open the exit once you have the quota shown in the status bar. Gems collected after the quota are worth double.
- **Rocks and gems fall** when the earth beneath them is dug away, and they roll off the top of other rocks, gems and brick. Anything falling on your head kills you — once a rock is falling you cannot outrun it.
- **Rocks push** sideways into empty space, so a wall of rock can be shifted one cell at a time.
- **Monsters** wander the open caves at random. Drop a rock on one and it bursts into gems; touch one and you both go up.
- **Pulsators** follow the cave walls rather than wandering, and are worth nothing — trap them or stay out of their way.
- **Bombs** are picked up by walking over them and dropped in front of you with Space. The fuse is about two seconds and the blast clears a three by three hole through earth, brick, rock and anything alive in it, including you.
- **Steel walls** survive everything. Brick does not.
- **The clock** kills you when it reaches zero; whatever is left on it when you escape is worth 5 points a second.

An extra miner arrives every 5000 points. The best score of the session is kept in local storage.

Caves A and B are hand drawn to teach digging and rock pushing. Everything after that is generated from a seed derived from the cave number, so cave G is always the same cave G, and the caves never run out. Each generated cave is flood filled before it is handed over, to prove the gem quota and the exit can actually be reached; in the rare case a cave seals its own exit off, a corridor is dug to it.

## Layout

| Path                   | What it holds                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| `index.html`           | The page, the status bar, the panels and the touch controls       |
| `manifest.webmanifest` | App name, colors and icons for installing to the home screen      |
| `sw.js`                | Service worker that caches the game for offline play              |
| `icons/`               | Home screen icons, rendered from the game's own gem sprite        |
| `css/style.css`        | Cabinet styling, responsive layout, the on screen pad             |
| `js/art.js`            | The palette and every sprite, drawn on a 16×16 pixel grid in code |
| `js/audio.js`          | Web Audio sound effects, generated at runtime                     |
| `js/levels.js`         | The hand drawn caves and the seeded cave generator                |
| `js/engine.js`         | The cave simulation: gravity, creatures, bombs, explosions        |
| `js/input.js`          | Keyboard, the on screen pad and the thumb stick                   |
| `js/game.js`           | Render loop, scrolling viewport, score, lives and panels          |
| `sprites.html`         | A development page that renders every sprite frame at 64 pixels   |
| `tests/`               | Node tests that run the simulation headlessly                     |

There is no bundler on purpose: the scripts are plain classic scripts sharing a `window.Rockfall` namespace, so the game also runs straight off the filesystem (without offline support, which needs a web server).

If you add a file the game loads, add it to the `SHELL` list in `sw.js` too; `pwa.test.cjs` fails until you do, because a single missing file stops the offline copy from installing. Leave the `const VERSION = 'dev';` line in `sw.js` exactly as it is: the deploy rewrites it to name each release.

## Tests

```sh
node game/tests/rules.test.cjs   # gravity, digging, pushing, bombs, deaths
node game/tests/caves.test.cjs   # every cave has a reachable quota and exit, plus a bot play through
node game/tests/pwa.test.cjs     # the offline cache, the page and the manifest agree with the files
```

All three are plain Node scripts that load the game modules into a sandbox with a stub `window`, so they need nothing installed.
