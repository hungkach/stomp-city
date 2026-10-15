# Stomp City: notes for Claude

Kaiju smash fitness game, third person from behind the monster: march to stomp forward, turn to steer, punch, hook and stomp buildings in 3 rounds of 3 minutes with 60 s rest. Play: https://hungkach.github.io/stomp-city/

## How this repo works

- `src/index.html` is the game. Edit it, then `npm run build` writes the playable page to `index.html` at the repo root (GitHub Pages serves that). Commit both.
- `engine/` is a locked copy of rep-engine from `hungkach/body-arcade`; `engine/SOURCE.json` says which commit. Never edit `engine/` here. Engine changes happen in body-arcade, then this game takes them with `node scripts/update-engine.mjs ../body-arcade` when Mark chooses.
- `npm test` must pass before every push; it also fails if `index.html` is out of date with a fresh build.
- No dependencies. Single self-contained HTML file. Plain canvas.
- `window.__game` exposes state for headless browser checks.

## Engine contract

- Read `engine.signals()` each frame; subscribe with `engine.on(event)`. Never touch landmarks.
- Touch demo mode (`engine.enable_demo(container)`) must keep the game fully playable; it emits the same events as the camera.
- Engine spec: https://claude.ai/code/artifact/a394f929-94ab-43c0-b06c-4d4b2cc50559

## Hard constraints

- Phone or iPad only, no accessories; living room preset, phone propped about 4 ft away, knees-up framing.
- Fitness first: the game names its S&C payoff, matches a work-to-rest rhythm, sessions 10 to 20 minutes.
- Names stay neutral and fitness oriented.

## Working with Mark

- He tests on his phone and often works from mobile: short replies, lead with the answer, committed recommendations.
- Decision logic and pseudocode as Python if/elif/else blocks with instructions in comments.
- No em dashes and no all-caps emphasis in docs or chat; sentence case.

## Status and next steps

- First playable version done with touch controls: movement, smashing, bump damage, combos, time bonuses capped at 5 minutes a round, rest screen, summary with S&C payoff.
- Engine 0.2.0: steering reads `signals().turn` (torso turn, already deadzoned, -1 to 1) times `T.turnRate`; demo shows only jab, cross, hook and stomp via `enable_demo(container, { buttons })`.
- Speed comes from `engine.locomotion()` (scaled by `T.walkSpeed`), so stops and runs follow the engine state machine; `turn_around` plays a 180 spin; summary logs run time.
- Camera: calibration, marching, running, turn steering and turn around work. Punches and stomps need the engine's strike and stomp detectors (body-arcade milestone 3); the game already listens for those events.
