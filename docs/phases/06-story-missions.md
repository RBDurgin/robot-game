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

- The patron choice. Once "The Needle" is done, no mission is on offer until the player has
  heard the offers at a base (B) and taken one. The patrons are rows in `src/data/patrons.ts`;
  who asks and what taking one does to standing are in `src/sim/patron.ts`. Brandt and Sorrel
  ask only if their faction is not hostile; Lys always asks, because the campaign has the
  player destroy seven Syndicate suits just before, which would otherwise rule her out every
  time. Taking a patron makes their faction an ally (standing raised to at least `alliedAt`)
  and costs 10 with each of the others who asked. The choice is in the save (version 5) and
  cannot be undone.
- The second half of the campaign is written once and filled in per patron: `patronMissions`
  in `src/data/missions.ts` takes the patron and returns their missions (who briefs, what they
  say, what it pays), and `campaign(patron)` is the whole list for a player. Ids are the same
  whoever the patron is.
- Step 4, salvage run. A stage can leave something to be picked up (`drop`): a gold crate with
  a tag that `collected` goals can wait for. It is not saved, and goes when the mission ends.
  A stage with a time limit can show it (`{time}` in the objective).
- A place that is only a spot on the ground (a mast, a piece of wreck) has a beacon while it is
  the waypoint: a column of light and a ring at the place's radius (`src/view/placeMarker.ts`).
- Step 5, four of six. "Dead Reckoning" (salvage run): search three parts of a wreck at the
  Broken Span past Combine salvagers, take the command key, and get clear within 150 seconds
  while two more Combine teams close in.

- Step 4, escort. A squad can walk a `route` once instead of circling a place, be `passive`
  (never fights), wait for the player (`waitFor` metres), be tougher than usual (`tough`), and
  last across stages (`keep`: each stage names it again with where it should be by then, so a
  mission resumed at that stage has it). A stage can wait for a squad to reach a place
  (`arrived`). The brain's part is three flags on `AiView`: `passive`, `oneWay`, `hold`.
- Step 4, duel. A squad can be one named pilot with their own build (`ace`), with their damage
  scaled (`deadly`). A mission can pay in parts (`reward.items`).
- Step 5, six of six. "Long Walk" (escort): meet the patron's engineer at the Broken Span and
  bring them 2.8 km east to the Fallen Carrier past two Combine pickets and a guard on the
  hull, where the patron's pilots join the fight; failed if the engineer is destroyed.
  "Kestrel One" (duel): Varga makes her offer at the hull, then fights alone in her own build;
  failed if the player is destroyed. The ending (radio lines and summary) and the part handed
  over depend on the patron.

- Step 6, contracts. `contractsOnOffer` in `src/sim/contracts.ts` reads the war and the
  player's standing and returns up to three `ContractSpec`s: for each faction that is not
  hostile to the player, a raid on the strongest enemy site next to one of its own, and a
  defence of its own most threatened site (one with a raid marching on it, or else the most
  enemy pilots next door). The board turns over every `CONTRACTS.refreshTicks` war ticks.
  `contractDef` turns a spec into an ordinary `MissionDef`: a raid waits for the site to be
  cleared; a defence is two waves from the enemy's side, void if the player leaves. C at a
  base opens the board. A contract pays scrap (more in dangerous regions) and standing with
  the giver, does not count toward the campaign, and can be taken alongside it. The spec of
  the one in progress is saved (`save.missions.contract`). Pay is in `src/data/contracts.ts`.
- Step 3, the log. L opens the mission log anywhere: what is in hand, who the player flies
  for, and the campaign missions finished with their summaries. Portraits are left to phase 7.

Everything in the build steps is built. What is left is the playthrough.

To check by playing:

- Dead Reckoning: whether 150 seconds and a 380 m ring make the escape tense or trivial in
  each frame.
- Long Walk: the pace. The engineer is the patron's "scout" (a light suit for the Drifters and
  the Syndicate, a medium for the Wardens) and walks at full walking speed, so the walk is
  about four to five and a half minutes plus the fights. Also whether it gets stuck on terrain
  on the way (it has only the usual hop to get unstuck), and whether 110 m is the right
  distance for it to wait at.
- Kestrel One: whether Varga (three times the armour, one and a half times the damage, a
  skirmisher's movement) is a fair fight in each frame.
- Whether the beacon reads well at a distance in a real browser.
- Contracts: whether the pay is worth the trip next to salvage, and whether a defence with the
  garrison's help is too easy.

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
- [x] Comms, briefing and log UI
- [x] Mission type templates (all six done)
- [x] Slice mission converted
- [x] Patron choice at the midpoint
- [x] Campaign missions built: 6 of 6
- [x] Generated contracts
- [x] Mission data validation test
- [ ] User playthrough and sign-off
