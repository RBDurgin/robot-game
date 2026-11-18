/** Mix and placement of the synthesised sound (src/view/audio.ts). */
export const AUDIO = {
  distance: {
    /** Metres at which a sound is at half its close-up level. */
    halfGain: 45,
    /** Metres over which the high end falls away (air absorption, roughly). */
    cutoffFalloff: 35,
    minCutoff: 900,
    /** Longest delay for distance: beyond about 170 m sounds are not held back any more. */
    maxDelay: 0.5,
    /** 0..1 how hard sounds to one side are panned. */
    panWidth: 0.85,
  },
  reverb: {
    seconds: 2,
    /** Output level of the reverb. */
    level: 0.5,
    /** Send for a sound at the listener, and for one at `farDistance` or beyond. */
    nearSend: 0.08,
    farSend: 0.6,
    farDistance: 150,
  },
  /** Servo whine of the player's suit while moving. */
  servo: { gain: 0.045, pitch: 92, pitchRise: 50 },
  /** Background wind level. */
  wind: 0.035,
  /** At most this many world sounds start within `voiceWindow` seconds; cockpit sounds always play. */
  maxVoices: 24,
  voiceWindow: 0.05,
};
