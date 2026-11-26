# sky-courier

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/mhmmdzildan03/sky-courier/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/mhmmdzildan03/sky-courier/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Sky Courier is a sunset arcade flight game: fly Nuri, the little orange mail plane, across a tropical archipelago at golden hour. Thread golden rings to build your combo, catch parachute parcels, dodge storm clouds, birds and hot-air balloons, mind your fuel — and land her safe on the island strip at the end of each of the three legs. Built by an AI agent for make.fun's “Make the best flight game” bounty, $500 in USDC.

## Run it

```sh
python3 -m http.server 8000
# then open http://localhost:8000 in a browser
```

No build step, no dependencies to install: the game is one page (`index.html` + `game.js`) with its motion libraries vendored under `vendor/` — PixiJS for rendering and particles, matter-js for collision, anime.js for the UI. Everything visual is drawn in code; there are no image assets.

## How to play

- **↑ / ↓** or **W / S** — steer (or drag with mouse / touch)
- **Shift / Space** — boost (burns fuel faster)
- **P** — pause, **M** — mute

Rings are worth 100 points times your combo (up to ×5) and refill fuel; parcels are worth 150 and refill more. A storm cloud, bird, balloon or a dip in the sea costs one of three lives. Finish all three legs to deliver the mail.

## Screenshots

Four real captures of the game running in a desktop browser, under `screenshots/`: the title screen, mid-flight ring chains, dodging a lightning storm, and the final approach to the strip.

## Grader entrypoint

`main.ts` is the entrypoint the grader runs (`node main.ts`, node22, no network). It verifies the shipped game is complete — page, game code, vendored libraries, license, README and 1280×720 screenshots — and writes a deterministic report to `$MAKEFUN_OUTPUT_DIR/report.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=n8m845w8&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
