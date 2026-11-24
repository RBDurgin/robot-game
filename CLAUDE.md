# Robot Game

3D mech combat game: Babylon.js + TypeScript, runs in the browser via Vite. Currently an 8 km
streamed open world with four biomes, three playable frames (light, medium, heavy) and four
factions at war over it. The player is independent: who is hostile depends on their standing.

The roadmap is in `docs/roadmap.md`, with one document per phase in `docs/phases/`. Before starting
work, read the roadmap and the document for the current phase, and settle that phase's "Decide
first" questions with the user.

## Commands

- `npm run dev`: dev server on http://localhost:5173 (port is forwarded from the dev container)
- `npm run typecheck`: TypeScript check
- `npm test`: Vitest unit tests for the simulation layer (fast, no browser)
- `npm run e2e`: Playwright tests in headless Chromium; writes screenshots to `tests/e2e/screenshots/`
- `npm run e2e:prod`: the same tests against the production build (`vite preview` on port 4173)
- `npm run build`: typecheck, third-party licences, production build to `dist/` (hosting: `docs/hosting.md`)
- `npm run check`: typecheck, unit tests and e2e in one go
- `npm run trace -- perf/<file>`: summarise a Chrome Performance trace (see "Dev tools in the game")
- `npm run models`: regenerate the game's own glb models in `public/models/` and their rows in
  `public/models/ATTRIBUTION.md` (from `scripts/make-models.mjs`)

Run `npm run check` after any gameplay change, and look at the screenshots.

## Architecture

Three layers with a strict dependency direction: `sim` knows nothing about Babylon.

- `src/sim/`: pure TypeScript game rules (movement, damage, hit volumes, AI brain, loadout, items, loot,
  the economy, terrain shape, chunk planning, site placement, sleeping mech records, the faction war,
  reputation, the mission interpreter).
  Deterministic, fixed 60 Hz step, unit-tested. New rules go here first, with tests.
- `src/game/`: Babylon integration (world, terrain streaming, physics, input, mech entity, combat,
  camera, save and save slots).
- `src/view/`: visuals and UI (procedural mech parts, terrain, effects, HUD, HTML menus, audio).
- `src/data/`: everything tunable (frames, weapons, plating, tiers and modifiers, factions and their rosters, garrisons,
  war pace and reputation, loot, prices and repair costs, the world with its regions and sites, biomes, site layouts,
  streaming distances, missions).
  Prefer changing data over changing code.

Key seams:

- `Intent` (`src/sim/intent.ts`): player input and AI both produce one; all mechs share the same code.
- `PartVisual` (`src/view/parts/PartVisual.ts`): the only interface gameplay has to a part's
  appearance. `GltfPartVisual` draws a part from a model listed in `src/data/models.ts`, with the
  procedural part underneath as its rig and fallback: model nodes `joint.<name>` follow the
  procedural node of that name, `att.<name>` nodes replace attachment points, clips
  `pose.<channel>` are scrubbed by that pose channel, and materials named primary, secondary,
  accent, metal and dark take the faction's colours.
- `FrameDef` (`src/data/frames.ts`): a frame is a data row: handling, abilities (dash charges,
  brace), hardpoints and model proportions. No frame has its own controller code.
- `Kit` (`src/sim/loadout.ts`): the weapon and plating definitions a mech is built from. An AI
  pilot's comes from a `Loadout` of part ids (`kitOf`); the player's from a `Fit` of their own
  items, each with a tier and modifiers (`fitKit` in `src/sim/items.ts`).
- Hardpoints: a `Loadout` maps hardpoint ids to weapons. Each hardpoint names the trigger that
  fires it and the section that carries it, so combat and the hangar loop over
  `frame.hardpoints` rather than naming arms.
- `WorldModel` (`src/sim/terrain.ts`): the world definition plus its generated sites, built once.
  Terrain meshes, colliders, spawns and the map are all pure functions of it.
- `TerrainStreamer` (`src/game/terrainStream.ts`): loads and unloads chunks around the player on a
  per-frame time budget. What to load is decided by the pure planner in `src/sim/chunks.ts`.
- `MechRecord` (`src/sim/population.ts`): every AI pilot in the world. `World.mechs` holds only
  the ones awake near the player; `World.population` holds all of them, and changes as the war
  moves garrisons about.
- `WarState` (`src/sim/war.ts`): who holds each site and with how many pilots, plus raids on the
  march. `stepWar` advances it every `WAR.tickSeconds` of play, deterministically, and it is
  saved. Fights near the player are played out by real mechs and reported back
  (`World.watchRaids`); everywhere else they are dice.
- `MissionDef` (`src/data/missions.ts`): a scripted mission is a data row of stages with goals.
  The interpreter in `src/sim/mission.ts` advances it from events the world emits
  (`World.emit`) and facts it asks for (`MissionFacts`). `World.mission` is the one in
  progress; its state lives in `save.missions`. The missions after the midpoint depend on the
  patron the player chose (`save.missions.patron`): ask `campaign(patron)` or `World.missions`
  for the list, not `MISSIONS`, which is only the shared first half.
- `ContractSpec` (`src/sim/contracts.ts`): repeatable work generated from the war and the
  player's standing (`contractsOnOffer`). `contractDef` makes an ordinary `MissionDef` of one,
  with an id starting `contract:`; the spec, not the def, is what is saved.
- Hostility: `World.hostile(a, b)` is the one question to ask. Between AI factions it is fixed
  (`areHostile`); with the player it follows `save.standing` (`src/sim/reputation.ts`).

- Controls: actions and default keys are data in `src/data/controls.ts`; the player's bindings
  are `settings.bindings`. Read input by action (`input.held("jump")`, `input.onAction`), never
  by key code, and name keys in text through `input.keyName(action)` (or `{key:action}` in
  mission text).

## Things that are easy to get wrong

- Import Babylon core from `src/babylon.ts`, never from `"@babylonjs/core"` (that pulls in the
  whole engine, about 5 MB more). A class not exported there yet gets a line there, from its own
  module. A scene feature that fails at run time with "needs to be imported" or an undefined
  method on `Scene` needs its side-effect module added there too.
- The first mission begins with training stages (`training: true`). The e2e helper `startGame`
  skips them; pass `{ training: true }` to keep them.
- A mech that wakes is not in `World.mechs` at once: it is built hidden, warmed, shown a few
  meshes per frame, and joins about ten frames later (`World.waking`).

- Ask `heightAt` for where the ground is, never `sampleTerrain`. The ground is the terrain shape
  sampled on a 6.4 m grid, and on sharp crests it is a metre or two below the shape itself.
- Terrain exists only near the player. Anything placed far away (a mech, a crate) has no ground
  under it until its chunk loads: check `terrain.hasGround` first. Moving the player with
  `player.teleport` is safe: the surroundings are loaded before physics next runs.
- Not every mech is an enemy. `World.enemies` is only those hostile to the player; `World.others`
  is every other mech. A garrison is written as jobs (`GARRISONS`) filled from the holder's
  `roster`, so what stands at a site depends on who holds it.
- The war runs during e2e tests and can change who holds a site. Tests that depend on ownership
  set `world.warPaused = true` first.
- A site's `troops` in the war and its living garrison records must agree. Change one through
  the other: `setTroops`/`clearSite` after kills, `syncGarrison` after the war changes a site
  the player cannot see. Never rebuild the garrison of a site the player is near.
- `WAR.observeRange` must stay beyond `STREAM.mechSleep`, so no awake mech belongs to a site the
  war is resolving by dice. A unit test checks it.
- Saves from before phase 4 have no `war` or `standing`: the war starts fresh around their
  `held` and `cleared` lists. `save.held` is now a mirror of the bases the war says are the
  player's.
- Enemies are asleep (not in `World.mechs`) until the player is within `STREAM.mechWake` metres.
  Tests that need enemies go near them first (`approachOutpost` in `tests/e2e/helpers.ts`).
- Streaming distances in `src/data/streaming.ts` depend on each other: fog must end inside the
  loaded terrain and colliders must reach past the mech sleep distance. Unit tests check both.
- Terrain colliders are Havok heightfields, whose row order is not the obvious one; use
  `addHeightfieldCollider` rather than building one by hand.
- Mech character controllers own a Havok body. "World" raycasts must use the collision layers in
  `src/game/physics.ts` (`raycastWorld`), or they stop on mech capsules. Mech hits are resolved
  analytically in `src/sim/hit.ts`.
- The dev container has no GPU: headless Chromium renders in software (10-25 fps). That is fine
  for correctness and screenshots but says nothing about real performance or game feel.
- Headless Chromium stalls after taking pointer lock, so `PlayerInput.lockPointer` is skipped when
  `navigator.webdriver` is set. Tests drive the mech through `world.intentOverride` and the
  `window.__game` debug handle instead of real mouse input.
- `node_modules` is shared between the macOS host and the Linux dev container. TypeScript, rolldown
  and lightningcss ship one native package per platform, so tools fail in whichever environment did
  not run the install. Add the missing platform's packages next to the existing ones (same versions
  as `package-lock.json`) rather than reinstalling, which can remove the other platform's.
- The player's `MechEntity` is replaced when the frame changes in the hangar, so do not hold on
  to `world.player` across a deploy.
- Beam weapons give `damage` and `heat` per second, not per shot.
- A new save has only the medium frame. Tests that need another frame or shoulder mounts use
  `?arsenal` (which unlocks everything) or put ids in `save.unlocks`.
- Enemy strength and loot quality follow the `danger` of the region a pilot's site is in. The
  home base and the first outpost must stay in a danger 1 region; a unit test checks it.
- Repairs cost scrap (`src/sim/economy.ts`), on respawn and on deploying from a hangar. Tests that
  compare scrap across either must allow for the bill.
- The hangar's shop changes `save.scrap` and `save.inventory` in place while the bench build is
  still unsaved, so selling checks both the bench build and `save.fit`.
- The player's parts are items with their own numbers. Read a weapon's stats from the mounted
  weapon's `def` (or `fitKit`), not from `WEAPONS[id]`, which is only the plain Mk I part.
  `mech.loadout` still names part ids, for looks and for what a wreck drops.
- Saves live in IndexedDB, one per slot (`SaveStore` in `src/game/saveStore.ts`); writes are
  queued, not immediate. Anything that reloads the page goes through `World.reload`, which waits
  for them. E2E tests may still seed `localStorage["robot-game-save-v1"]`: with every slot empty
  it is taken as the old single save and moved into slot 1.
- When the save format changes, bump `SAVE_VERSION` and add a step to `MIGRATIONS`; do not edit an
  old step.
- Saves written before phase 2 have `armL`/`armR` in the loadout and no frame, and saves from
  before phase 3 have no position or world progress. All of those count as version 1, and
  `parseSave` in `src/game/save.ts` reads them; keep it that way.
- A new mission, stage or goal is data: add it to `MISSIONS` and run the unit tests, which
  check every site, place and stage it names. The story outline is `docs/story-outline.md`.
- Pilots a mission brings in (`spawn`) are `MechRecord`s with `mission` set and a `siteId` that
  is no site (it names that playing of the mission). Code that looks a record's site up must
  allow for that, as it does for raiders. They are not saved: a loaded mission restarts its
  current stage.
- A patron's missions are written once in `patronMissions` and must keep the same ids, stages
  and goals for every patron; only the words, the briefer and the pay differ. The unit tests
  validate the campaign for each patron.
- A squad that lasts across stages (the engineer under escort) is spawned with `keep` in every
  stage it is alive in. Without that, a mission resumed from a save at a later stage has no
  such squad.
- Things a mission leaves to pick up (`drop`) wait for the ground under them to load, and like
  its squads are not saved.
- A mission's summary screen stops the clock (`mode` is "complete"), as do the briefing and
  every menu. E2E tests must not `waitTicks` after the step that ends a mission.
- A site a mission is waiting to see cleared is frozen in the war (`awaitedSites`), so only
  the player can clear it.
- The time of day runs during play (`save.sky`, `src/sim/sky.ts`). The e2e helper `startGame`
  holds it at noon; pass `{ sky: false }` to let it run, and use `world.setTime` to change it.
  Weather and night may only bring the fog in closer, never push it out past a biome's own.
- Feedback strength (shake, landing thresholds, heat warning) is data in `src/data/feel.ts`.
- A procedural part's node names are how models find their joints (`hip_l`, `knee_r`, `pivot`,
  `forearm`, `jet_l`...). Renaming one breaks the models that follow it; `GltfPartVisual` warns.
- Every file in `public/models/` needs a row in its `ATTRIBUTION.md`; a unit test fails otherwise.
  Rows between the `generated` markers are rewritten by `npm run models`.
- The HUD is drawn by a second camera on its own layer (`Graphics`), so post-processing leaves it
  sharp. Any other full-screen GUI texture must use that layer too, or it is processed and
  blurred with the scene.
- Graphics quality (`src/data/quality.ts`) is a saved setting. Structures that should cast sun
  shadows are marked with `castsShadow`; mechs are added automatically.
- Sounds take a world position (or null for the player's own cockpit), not a distance: `Sfx`
  places them relative to the camera.
- A gamepad's B button presses the button marked with `back()` in `src/view/screens.ts`. A new
  screen that can be left without choosing should mark its close button that way.
- Angles: yaw 0 faces +Z, positive yaw turns toward +X, positive pitch looks up.

## Dev tools in the game

Backquote (`) toggles a stats overlay and live sliders for the player frame's handling values.

Open the game with `?procedural` in the URL to draw every mech part procedurally instead of from
its model (for before-and-after comparisons). `__game.world.cameraRig.showcase = { yaw: 0.6,
distance: 9, height: 1.2 }` looks at the player's mech from a fixed angle (null to stop), and
`__game.world.graphics.apply("high")` switches the graphics preset.

Open the game with `?time=night` (or `dusk`, `dawn`, `noon`, a fraction of a day) to set the time
of day and hold it; `__game.world.setTime("dusk")` does the same from the console.

Open the game with `?arsenal` in the URL to stock the hangar with two of every weapon and plating
and unlock every frame and mount.

B at a base opens the briefing for the mission on offer, C the contract board; L opens the
mission log anywhere. From the console,
`__game.world.save.missions.done.push("first-outpost")` skips a mission when none is in
progress: the next one is on offer at once. After "the-needle", B at a base opens the patrons'
offers instead; `__game.world.choosePatron("wardens")` takes one from the console.

M opens the world map, which shows who holds what and the player's standing. From the console,
`__game.world.war` is the war's state and `__game.world.save.standing.wardens = 50` changes a
standing. From the browser console, `__game.world.player.teleport({x, y, z}, 0)`
goes anywhere (use `__game.world.heightAt(x, z)` for `y`).

Profiling: open the game with `?profile` in the URL. It records per-frame timings and counters
(`src/game/perf.ts`) and the dev server saves them to `perf/` (ignored by git) each time a menu
opens, so play, then press Esc. `npm run trace -- perf/<file>` summarises the file. With
`?profile=devtools` the same spans also go to Chrome's Performance panel, and a trace saved from
there can be summarised the same way; untick Screenshots there, which costs about 25 fps.
