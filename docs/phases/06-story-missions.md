# Phase 6: Story missions

**Status: in progress.** Size: 3 to 4 sessions. Depends on: phase 4.

## Goal

Authored missions and characters on top of the sandbox: a short campaign with a beginning, middle and end, plus repeatable contracts.

## Why now

The world, factions and progression exist by this point. Story gives them direction and gives the player a reason to visit all of it.

## Decide first

1. Premise and tone. The user writes or approves a one-page outline before any mission is built.
2. Who the player is, and whether they speak.
3. Length. Suggested: five to seven missions, two to three hours.
4. Does the campaign pick a side in the war, or let the player choose?

## Decisions (settled 2026-11-16)

1. **Premise: "The Signal".** The Listening Dish wakes, something in the Fallen Carrier answers,
   and every faction races for it. The one-page outline is `docs/story-outline.md`; approved
   by the user on 2026-11-16.
2. **The player speaks.** A defined pilot with short lines on the radio. No branching dialogue.
3. **Six missions, about two hours:** one of each mission type.
4. **The player chooses a side at the midpoint.** The first three missions are shared; the
   patron chosen then decides who briefs and who helps in the last three, and the ending.

## What is built so far

- Step 1. A mission is a `MissionDef` in `src/data/missions.ts`: stages, each with goals (all
  must be met), optional ways to fail (any one), things to do on entry (radio lines, a notice)
  and a waypoint. `src/sim/mission.ts` is the interpreter: `startMission`, `missionEvent`,
  `stepMission`, and `missionProblems`, which a unit test runs over every mission written.
  A stage can wait on: a site cleared, the player in or out of a place, mechs destroyed (by
  tag, faction, site or killer), items collected, a site captured, time elapsed, the player
  destroyed.
- Step 2. The world reports mech destroyed, site cleared, site captured, item collected and
  player destroyed through `World.emit`; `World.onEvent` listens in. Places and timers are
  asked about each step rather than sent as events (`MissionFacts`), so a goal still counts if
  it was already true when the stage began.
- Step 7. The outpost mission is the first row of `MISSIONS` (`first-outpost`); `World.phase`
  and its special cases are gone. The mission in progress and the list of those done are in
  the save (version 4). Its text is unchanged for now and is rewritten with the campaign.
- Step 3, most of it. Radio lines queue and show one at a time on the HUD (`World.say`, timing
  in `FEEL`); lines left over from a stage are dropped when the mission moves on. A mission that
  does not start by itself is on offer at any base the player can use: the objective line and
  compass say so, and B opens its briefing (who is asking, what for, what it pays) to accept or
  leave. The summary at the end lists what was paid. A mission log and portraits are still to do.
- Step 4, the first three types. A stage can bring in a squad (`spawn`): pilots from a faction's
  roster, starting at a place or walking in to it from a bearing, optionally hostile or allied
  whatever the player's standing, optionally already hunting. They are ordinary `MechRecord`s
  with a `mission` tag, so `destroyed` goals can count them. They are not saved: a mission picked
  up from a save starts its current stage again (`resumeMission`), so stages are checkpoints.
  Failing ends the mission; it is on offer again at a base.
- Step 5, three of six. "Clear Signal" (assault: the outpost mission, now with its radio lines),
  "Listening Post" (recon: reach the Dish and visit three masts past a Combine survey team) and
  "The Needle" (defend: three waves at the spire, failed by leaving it or being destroyed).

Still to build: the patron choice after mission 3 and what it changes; a tagged pickup (the key
in mission 4); a friendly suit that follows a route (mission 5); a named enemy with their own
build (mission 6); markers in the world for mission places (the masts are only compass points
so far); contracts; the mission log.

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

- [x] Story outline approved
- [x] Mission data format and interpreter with tests
- [x] Event feed from the world
- [ ] Comms, briefing and log UI (comms and briefing done; log to do)
- [ ] Mission type templates (assault, recon, defend done; salvage run, escort, duel to do)
- [x] Slice mission converted
- [ ] Campaign missions built: 3 of 6
- [ ] Generated contracts
- [x] Mission data validation test
- [ ] User playthrough and sign-off
