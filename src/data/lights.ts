/**
 * Mech lamps after dark. The player's headlights are one real spot light; every other mech's
 * lamps are glowing lenses and a faint beam, which cost nothing to light the scene with.
 */
import type { RGB } from "./sky";

export const LIGHTS = {
  /** AI pilots switch their lamps on when the daylight (`SkyState.light`) is below this. */
  lampsBelow: 0.6,
  /** Below this the HUD suggests the player's headlights, if they are off. */
  hintBelow: 0.45,
  /** Colour of lamps, lenses and beams. */
  color: [1, 0.93, 0.78] as RGB,
  /** The player's headlights: a spot light from the chest, along the aim. */
  headlight: {
    intensity: 2.4,
    /** Metres; the light fades to nothing here. */
    range: 110,
    /** Full cone angle, radians. */
    angle: 0.9,
    /** How fast the light falls off from the centre of the cone. */
    exponent: 2,
    /** Height above the feet, as a share of the frame's height. */
    height: 0.72,
    /** How far in front of the mech's axis, as a share of its height. */
    forward: 0.22,
    /** The beam points this far below the aim (radians), so it lights the ground ahead. */
    dip: 0.1,
    /** How much of the aim's pitch the beam follows. */
    followPitch: 0.8,
  },
  /** The beam drawn in front of every lit mech (a soft cone, no real light). */
  beam: {
    length: 15,
    /** Radius at the far end, metres (on the 4.6 m model). */
    radius: 3.2,
    /**
     * Brightness at the lamp end; it fades to nothing at the far end. With post-processing
     * (Medium and High) light adds in linear space, so a little goes a long way against the dark.
     */
    strength: 0.025,
    dip: 0.12,
  },
  /** A soft glow around each lamp that faces the camera, so lamps read at a distance. */
  flare: { radius: 0.38, strength: 0.4 },
  /** Instruments light the cockpit after dark, in this colour, at most this strongly. */
  cockpitGlow: { color: [0.22, 0.42, 0.55] as RGB, strength: 0.6 },
};
