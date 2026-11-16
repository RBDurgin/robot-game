# Roadmap

A 3D open-world game where the player pilots a robotic exoskeleton suit and fights rival factions in similar suits. Built with Babylon.js and TypeScript, running in the browser. All content is original.

The vertical slice (phase 0) is done. The phases below take it to a full game. Each phase has its own document with build steps, questions to settle first, and a checklist.

## Phases

| # | Phase | Goal | Depends on | Size (sessions) | Status |
|---|---|---|---|---|---|
| 0 | [Vertical slice](phases/00-vertical-slice.md) | One zone, one frame, one enemy faction, full mission loop | none | done | Done |
| 1 | [Feel and foundations](phases/01-feel-and-foundations.md) | Tune by playtest, fix real-browser issues, tidy the repo | 0 | 1 to 2 | Done |
| 2 | [Frames and arsenal](phases/02-frames-and-arsenal.md) | Light and heavy frames, new weapon families, enemy variety | 1 | 2 to 3 | Done |
| 3 | [Open world](phases/03-open-world.md) | Streaming terrain, biomes, points of interest, map, fast travel | 1 | 3 to 4 | Done |
| 4 | [Living faction war](phases/04-faction-war.md) | More factions, territory that changes hands, reputation | 3 | 3 to 4 | Done |
| 5 | [Progression and economy](phases/05-progression-and-economy.md) | Spend scrap, part tiers, unlocks, robust saves | 2 | 2 to 3 | Done |
| 6 | [Story missions](phases/06-story-missions.md) | Scripted missions, dialogue, a short campaign | 4 | 3 to 4 | Not started |
| 7 | [Assets and presentation](phases/07-assets-and-presentation.md) | Imported models, animation, lighting, audio, gamepad | 2 | 2 to 4, can run alongside | Not started |
| 8 | [Release readiness](phases/08-release-readiness.md) | Performance, accessibility, tutorial, packaging | 6 | 1 to 2 | Not started |

Sizes are rough guesses in working sessions, not commitments.

## Order and dependencies

- **1 comes first.** Tuning and real-browser findings affect everything built afterwards.
- **2 before 5.** Progression needs frames and weapons worth unlocking.
- **3 before 4.** Faction territory needs a world larger than one zone.
- **4 before 6.** Story missions hang off the factions and the state of the war.
- **7 is flexible.** It can start any time after phase 2 and run alongside other phases, one part at a time.
- **2 and 3 are independent of each other.** Recommended order is 2 then 3, because frames are cheaper and make every later playtest more interesting. Swap them if the open world matters more.

## Working rules for every phase

1. **Simulation first.** New rules go in `src/sim/` as pure TypeScript with unit tests, then get wired into `src/game/` and `src/view/`.
2. **Data over code.** Anything tunable lives in `src/data/`. A new frame, weapon or faction should be a new data row wherever possible.
3. **Keep the layer direction.** `sim` never imports Babylon. `view` is reached through interfaces such as `PartVisual`.
4. **Verify each step.** Run `npm run typecheck`, `npm test` and `npm run e2e`, and look at the screenshots, before calling a step done.
5. **The user judges feel.** The dev container renders in software, so performance, handling and difficulty can only be assessed by playing in a real browser. Every phase ends with a playtest.
6. **Original content only.** No names, characters, art, music or levels from existing games.

## How to run a phase in a new session

1. Read this file and the phase document.
2. Settle the phase's "Decide first" questions with the user before writing code.
3. Work the build steps in order. Each ends in something runnable.
4. Tick the checklist in the phase document as steps are verified.
5. When the exit criteria are met, update the status in the table above.

## Known gaps carried forward

These were not verifiable in the dev container at the end of phase 0 and are picked up in phase 1:

- Game feel and real frame rate.
- Real mouse look and pause on Esc (tests skip mouse capture, see `CLAUDE.md`).
- How the synthesised audio sounds.
- Whether a real fight is fair.
