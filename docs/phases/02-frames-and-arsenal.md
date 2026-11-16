# Phase 2: Frames and arsenal

**Status: built, waiting for the user playtest.** Size: 2 to 3 sessions. Depends on: phase 1.

## Goal

Make build choices matter: three frames that play differently, more weapon families, and enemies that use them.

## Why now

The hangar and loot only become interesting when there is more than one frame and a wider spread of weapons. It is also the cheapest large gain, since frames and weapons are mostly data.

## Decide first

1. How different should frames be: subtle variations, or distinct roles (scout, line, siege)?
2. Should each frame have a signature ability, or differ only in numbers?
3. Does the player start with all three frames, or earn the others? (Unlocking itself is phase 5; this decides what the hangar shows now.)

## Decisions (settled 2026-11-15)

1. Frames have distinct roles: Kite (light, scout), Warden (medium, line), Bastion (heavy, siege).
2. Signature abilities: the Kite stores two dash charges; the Bastion braces when it stands still
   (less damage taken, tighter spread). The Warden has none.
3. All three frames can be chosen in the hangar now. Phase 5 adds the locks.

## What was built

- Frames, hardpoints, abilities and model proportions are rows in `src/data/frames.ts`.
- A loadout is `{ weapons: { [hardpoint]: weapon }, plating }`. The heavy frame adds two shoulder
  mounts, fired with E or the middle mouse button, which only take weapons marked `shoulder`.
- New weapons: SG-5 Scatter Gun, LB-3 Lance Beam, SR-8 Seeker Rack. Their rules (pellet spread,
  beam pulses, lock-on, missile steering) are in `src/sim/weapons.ts`.
- Enemy squads mix all three frames, with the AI roles in `AI_ROLES` (`src/sim/ai/brain.ts`).
- New weapons are only found as salvage. Open the game with `?arsenal` to stock the hangar with
  two of everything for a playtest.

## Build steps

1. **Light and heavy frames.** Add rows to `FRAMES` in `src/data/frames.ts`. Light: fast, low armor, low capacity. Heavy: slow, high armor, high capacity, more heat capacity. Tune each with the backquote panel.
2. **Frame abilities, data-driven.** Add optional fields to `FrameDef` and handle them in `src/sim/mech.ts`. Suggested: light gets a second dash charge; heavy gets a brace stance that cuts recoil and incoming damage while stationary.
3. **Visual variants.** Parameterise the procedural parts in `src/view/parts/proceduralParts.ts` (proportions, part sets) so each frame has its own silhouette. Hit volumes in `src/sim/hit.ts` already scale with frame height; add per-frame width if silhouettes differ a lot.
4. **Hardpoints.** Generalise `Loadout` in `src/data/loadouts.ts` from two arms to a list of hardpoints per frame, so the heavy frame can carry shoulder weapons. Update `src/sim/loadout.ts`, the hangar in `src/view/screens.ts`, and fire controls in `src/game/input.ts`.
5. **New weapon families** in `src/data/weapons.ts` and `src/game/combat.ts`:
   - Beam: continuous damage while held, heavy heat.
   - Scatter: several pellets, strong up close.
   - Guided missile: needs a lock held on a target, then tracks.
6. **Enemy variety.** Squads in `src/data/encounters.ts` mix frames. Add role presets to `AiConfig` in `src/sim/ai/brain.ts` (skirmisher keeps moving, line holds range, heavy support stays back).
7. **Hangar.** Choose a frame, compare stats side by side, see which hardpoints it has.

## Out of scope

Unlocking and buying frames (phase 5). Imported models (phase 7).

## Key files and seams

- `FrameDef` in `src/data/frames.ts`: frames are data rows.
- `stepMech` in `src/sim/mech.ts`: the only place movement rules live.
- `PartVisual` in `src/view/parts/PartVisual.ts`: visuals vary without touching gameplay.
- `loadoutStats` and `loadoutProblems` in `src/sim/loadout.ts`: weight and validity rules.
- Save format in `src/game/save.ts`: the loadout shape changes, so loading must tolerate old saves.

## Verification

- Unit tests: each frame's handling limits, abilities, hardpoint validation, new weapon rules (beam heat, pellet spread, lock-on).
- E2E: switch frame in the hangar and deploy; a fight against a mixed squad.
- Screenshots of all three frames side by side.
- User playtest of each frame.

## Exit criteria

- Three frames that the user agrees feel distinct.
- At least seven weapons across four families.
- Enemy squads field more than one frame.
- Old saves still load.

## Checklist

- [x] Frame differences and abilities agreed
- [x] Light frame data (numbers are first guesses: tune in the playtest)
- [x] Heavy frame data (numbers are first guesses: tune in the playtest)
- [x] Frame abilities in sim with tests
- [x] Visual variants
- [x] Hardpoint list replaces fixed arms
- [x] Beam weapon
- [x] Scatter weapon
- [x] Guided missile and lock-on
- [x] Mixed enemy squads and AI roles
- [x] Hangar frame selection
- [ ] User playtest and sign-off
