# Phase 9: Living world

**Status: in progress.** Size: 3 to 4 sessions. Depends on: phase 4.

## Goal

A world that changes while the player is in it: day and night, storms that cross the map, and
things happening between the sites that are worth going after.

## Why now

The war, the campaign and the release work are built. The world is still the same light and the
same weather all the time, and between sites nothing moves except raids nobody sees. This phase
makes the open world worth roaming.

## Decide first

1. How long a day lasts.
2. How much night and weather change play, beyond looks.
3. Which world events.
4. Whether missions care about time and weather.

### Decided (2026-11-22)

1. **A 20-minute day**: about 13 minutes of daylight, 5 of night, and a minute each of dawn and
   dusk.
2. **A moderate effect.** Night and storms shorten how far AI pilots see. Headlights, firing, jump
   jets and heat make a mech easier to see. Storms shorten the player's radar. The HUD stays
   readable.
3. **Three events:** convoys between a faction's sites (ambush them for loot), supply drops that
   factions race the player for, and storm fronts that move across the map.
4. **Missions may use the sky but don't have to.** A stage can set the time or the weather, and a
   goal can wait for one. The existing missions stay as they are.

## Build steps

1. **Sky clock.** Time of day is a pure function of one saved clock (`src/sim/sky.ts`), with
   keyframes for the sun, moon, light and fog tint in `src/data/sky.ts`. Save version 6. Lights,
   fog tint and a sky dome follow it. Dev parameters `?time=` and `?weather=`.
2. **Night.** Player headlights (one spot light made at start-up, so switching it on never
   recompiles materials), a `lights` action, lamps on AI mechs, cockpit glow.
3. **Storm fronts.** Fronts are a pure function of the world seed and the clock
   (`src/sim/weather.ts`): rain in the basin and highlands, dust on the salt flats and in the
   ruins. Weather only ever thickens the fog. Particles, audio, the fronts on the map.
4. **Visibility.** AI sight range from light, weather and how exposed the target is; radar range
   from weather.
5. **Convoys.** A faction's supply column on the march in the war state, played out by real pilots
   near the player: a slow hauler and escorts. Destroying the hauler drops a rich crate.
6. **Supply drops.** A crate lands somewhere and is announced; nearby factions send pilots to claim
   it.
7. **Mission hooks.** A stage's `sky` (set time and weather on entry) and a `sky` goal. Optionally,
   convoy contracts.
8. **Playtest.**

## What is built so far

- Step 1 (sky clock). The time of day is `save.sky` (save version 6): seconds of play, plus an
  `offset` for time a mission skips. `src/sim/sky.ts` turns it into a time of day (`timeOfDay`)
  and that into lights, colours and how well things can be seen (`skyAt`), from keyframes in
  `src/data/sky.ts`. The day keyframe is the light the game always had, so a clear noon looks
  unchanged. A new game (and an older save) starts mid-morning. The clock runs only in play.
  The sun swings across the sky from sunrise to sunset and hands over to a dim blue moon at
  night, at the dimmest moment so the jump in shadows is hard to see. The fog and the clear
  colour are tinted by the time of day. Medium and High have a gradient sky dome with stars
  (`src/view/skyDome.ts`), whose horizon is the fog colour. `?time=dusk` (or `noon`, `night`,
  `dawn`, `morning`, or a fraction of a day) sets the time and holds it;
  `__game.world.setTime("night")` does the same from the console, and `world.skyPaused` stops
  the clock. The e2e helper `startGame` holds every test at noon unless it passes `sky: false`.
- Step 2 (night). The player's headlights are one spot light (`headlight`) made in
  `World.create` before any material, so every shader is compiled with it; off is intensity 0,
  and switching on recompiles nothing. It shines from the chest along the aim. The `lights`
  action (T, right-stick click) toggles it; `World.headlightsOn` holds the choice across refits
  and `MechEntity.lights` says whether a mech's lamps are on (for the visibility rules of step 4).
  Every mech has two lamps beside the canopy (`src/view/lamps.ts`): dark lenses, which light
  up with a camera-facing flare and a faint additive beam. These are not lights, so any number
  are cheap. AI pilots switch theirs on when the daylight drops below `LIGHTS.lampsBelow`
  (dusk to dawn). The HUD suggests the headlights once it is properly dark. The cockpit has its
  own copies of the part materials and glows blue-grey from its instruments after dark. Tuning
  is in `src/data/lights.ts`. With post-processing (Medium, High) additive light blends in
  linear space, so beams look several times stronger than their alpha; they are tuned for
  Medium and are fainter on Low.

## Out of scope

Seasons, temperature affecting heat, a thermal vision mode, real lights on every mech.

## Key files and seams

- Lights in `World.create` and fog in `World.updateFog` (`src/game/world.ts`).
- Shadows and post-processing in `src/view/graphics.ts`.
- AI sight in `src/sim/ai/brain.ts` (`detectRange`, `loseRange`) and `src/game/aiController.ts`.
- The war state and its raids in `src/sim/war.ts`, observed by `World.watchRaids`.
- The map in `src/view/mapView.ts`, radar blips and the compass in the HUD.

## Verification

- Unit tests: the sky is continuous across midnight; the same seed and time give the same weather;
  fog with weather never ends past the biome's; sight is shorter at night and in storms and
  longer for a lit target; convoys and drops step deterministically and survive a save; the save
  migration; every mission's `sky` validates.
- E2E: night and storm screenshots, an ambushed convoy, a claimed drop, a mission stage that sets
  dusk. Existing tests run with the sky pinned to a clear noon.
- In a real browser: frame rate in a storm on each preset, whether night is readable, and how
  often events come up.

## Exit criteria

- Day turns to night and back, and storms come and go, without a hitch.
- Night and storms change how a fight is approached.
- Convoys and supply drops appear and are worth chasing.

## Checklist

- [x] Decisions settled
- [x] Sky clock, lights, fog tint, sky dome
- [x] Night: headlights and lamps
- [ ] Storm fronts
- [ ] Visibility rules
- [ ] Convoys
- [ ] Supply drops
- [ ] Mission hooks
- [ ] User playtest
