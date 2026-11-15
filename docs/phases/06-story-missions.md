# Phase 6: Story missions

**Status: not started.** Size: 3 to 4 sessions. Depends on: phase 4.

## Goal

Authored missions and characters on top of the sandbox: a short campaign with a beginning, middle and end, plus repeatable contracts.

## Why now

The world, factions and progression exist by this point. Story gives them direction and gives the player a reason to visit all of it.

## Decide first

1. Premise and tone. The user writes or approves a one-page outline before any mission is built.
2. Who the player is, and whether they speak.
3. Length. Suggested: five to seven missions, two to three hours.
4. Does the campaign pick a side in the war, or let the player choose?

## Build steps

1. **Mission scripting as data.** A mission is a list of stages with objectives, triggers, spawns and lines of dialogue. A small interpreter in `src/sim/` advances stages from game events. Pure and unit-tested, so missions can be checked without the renderer.
2. **Event feed.** The world emits events the interpreter listens to: mech destroyed, area entered, item collected, timer elapsed, site captured. Generalises the hard-coded `phase` logic in `src/game/world.ts`.
3. **Comms and log UI.** Dialogue lines with a speaker name and portrait placeholder; briefing and debriefing screens; a mission log. Extends `src/view/hud/hud.ts` and `src/view/screens.ts`.
4. **Mission types.** Assault, defend, escort, recon, salvage run, duel. Each is a reusable template the campaign and contracts both use.
5. **The campaign.** Build the agreed missions, each at a distinct place in the world, introducing a frame, weapon family or faction as it goes.
6. **Contracts.** Repeatable missions generated from the state of the faction war (defend a threatened region, raid a strong one), paid in scrap and reputation.
7. **Convert the slice mission.** Re-express "clear the outpost and return" as the first scripted mission, proving the system on something known to work.

## Out of scope

Voice acting, cutscenes, branching dialogue trees. Keep choices to which missions and which side.

## Key files and seams

- Mission flow in `src/game/world.ts` (`phase`, `completeMission`, `onKill`).
- `notify` and the objective line in the HUD.
- `SquadDef` in `src/data/encounters.ts` for scripted spawns.
- Territory and reputation from phase 4.

## Verification

- Unit tests: interpreter advances, fails and completes correctly for each objective and trigger type; every mission's data validates (no unreachable stages, all referenced places and squads exist).
- E2E: play the first mission through with scripted input; one test per mission type.
- User playthrough of the whole campaign.

## Exit criteria

- The campaign can be played start to finish.
- Contracts appear and reflect the war.
- A new mission can be added by writing data, without touching engine code.

## Checklist

- [ ] Story outline approved
- [ ] Mission data format and interpreter with tests
- [ ] Event feed from the world
- [ ] Comms, briefing and log UI
- [ ] Mission type templates
- [ ] Slice mission converted
- [ ] Campaign missions built: __ of __
- [ ] Generated contracts
- [ ] Mission data validation test
- [ ] User playthrough and sign-off
