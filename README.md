# stomp-city

Kaiju smash fitness game, third person from behind the monster. Play: https://hungkach.github.io/stomp-city/

## Now playable (touch controls)

- March to walk the monster forward, lean to turn, jab or cross to smash what's in front, hook to swipe a wide arc, stomp to flatten everything nearby.
- Walking into a building still damages it.
- 3 rounds of 3 minutes. Each building dropped adds 1 s (2 s once the combo reaches 3), capped at 5 minutes a round. 60 s rest between rounds; the city regenerates each round.
- Summary names the S&C payoff: conditioning time, single-leg power from stomps, upper-body power from punches and hooks.

## Camera mode

Calibration and lean turning work now. Marching, punches and stomps on camera need the milestone 2 and 3 detectors; the game reads them through `engine.on('step' | 'strike' | 'stomp')`, so nothing here changes when they land.

## Engine needs from later milestones

- Detectors: `step`, `strike` (jab, cross, hook), `stomp`.
- A demo-mode option to choose which touch buttons show (this game hides the unused ones by button label for now).

## Repo layout

| Path | What it is |
| --- | --- |
| `src/index.html` | The game source |
| `index.html` | Built, playable page (GitHub Pages serves it) |
| `engine/` | Locked copy of rep-engine; `engine/SOURCE.json` names the body-arcade commit |
| `build/build.mjs` | Inlines the engine into `src/index.html` and writes `index.html` |
| `scripts/update-engine.mjs` | Takes a newer engine from a body-arcade checkout, then rebuilds |
| `test/` | Build and engine checks |

```
npm run build                      # rebuild index.html after editing src/
npm test                           # must pass before pushing
npm run update-engine ../body-arcade   # take engine updates, only when you choose
```
