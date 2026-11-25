import { AUDIO } from "../data/audio";

/** A point in the world a sound comes from; null for sounds in the player's own cockpit. */
export type SoundAt = { x: number; y: number; z: number } | null;

/** Where a sound sits relative to the listener, worked out once when it starts. */
interface Placement {
  /** Seconds before it is heard: sound travels at about 343 m/s. */
  delay: number;
  gain: number;
  /** Low-pass cutoff: distance takes the top off a sound. */
  cutoff: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  /** How much goes to the reverb. */
  wet: number;
}

const NEAR: Placement = { delay: 0, gain: 1, cutoff: 20000, pan: 0, wet: AUDIO.reverb.nearSend };

/**
 * All sound is synthesised with WebAudio, so the game ships no audio files. Sounds in the world
 * are placed relative to the listener (the camera): panned by bearing, quieter, duller and later
 * with distance, with more reverb the further away they are. Every sound is a few layers (a
 * transient, a body and a tail) so it reads at a distance as well as up close.
 *
 * Browsers only allow audio after a user gesture: call unlock() from a click or key press.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private thrust: { rumble: GainNode; hiss: GainNode } | null = null;
  private servo: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: GainNode | null = null;
  private rain: GainNode | null = null;
  private volume = 0.6;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Start times of recent voices, to cap how many begin at once in a big fight. */
  private recent: number[] = [];

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      // A limiter on the output: a squad firing at once plus an explosion must not clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(ctx.destination);

      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = Sfx.impulse(ctx, AUDIO.reverb.seconds);
      const reverbOut = ctx.createGain();
      reverbOut.gain.value = AUDIO.reverb.level;
      this.reverb.connect(reverbOut).connect(this.master);

      this.thrust = this.startThrust(ctx);
      this.servo = this.startServo(ctx);
      this.wind = this.startWind(ctx);
      this.rain = this.startRain(ctx);
    } catch {
      this.ctx = null; // No audio device or API: stay silent.
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  /** Where the ears are: the camera position and the way it faces. Call every frame. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw };
  }

  // --- Sounds ---

  shot(kind: "hitscan" | "projectile" | "beam", heavy: boolean, at: SoundAt): void {
    const v = this.voice(at);
    if (!v) return;
    const { bus, t } = v;
    if (kind === "beam") {
      this.osc(bus, t, { type: "sawtooth", f0: 880, f1: 820, dur: 0.09, gain: 0.07 });
      this.osc(bus, t, { type: "square", f0: 1760, f1: 1700, dur: 0.06, gain: 0.025 });
      this.noise_(bus, t, { dur: 0.06, gain: 0.08, filter: "bandpass", freq: 5200, q: 2 });
    } else if (kind === "projectile") {
      this.noise_(bus, t, { dur: 0.025, gain: 0.25, filter: "highpass", freq: 3500 });
      this.osc(bus, t, { type: "sine", f0: 95, f1: 38, dur: 0.22, gain: 0.5 });
      this.noise_(bus, t, { dur: 0.5, gain: 0.32, filter: "bandpass", freq: 450, freqEnd: 2400, q: 1.2, attack: 0.03 });
    } else if (heavy) {
      this.noise_(bus, t, { dur: 0.09, gain: 0.75, filter: "bandpass", freq: 1700, q: 0.9 });
      this.osc(bus, t, { type: "sine", f0: 115, f1: 34, dur: 0.38, gain: 0.6 });
      this.osc(bus, t, { type: "sawtooth", f0: 230, f1: 55, dur: 0.22, gain: 0.14 });
      this.noise_(bus, t, { dur: 0.9, gain: 0.22, filter: "lowpass", freq: 520, attack: 0.01 });
    } else {
      this.noise_(bus, t, { dur: 0.05, gain: 0.5, filter: "bandpass", freq: 2900, q: 1.2 });
      this.osc(bus, t, { type: "square", f0: 1150, f1: 300, dur: 0.04, gain: 0.07 });
      this.osc(bus, t, { type: "sine", f0: 165, f1: 55, dur: 0.14, gain: 0.32 });
      this.noise_(bus, t, { dur: 0.35, gain: 0.1, filter: "lowpass", freq: 900, attack: 0.01 });
    }
  }

  explosion(at: SoundAt, size: number): void {
    const v = this.voice(at, Math.min(1.4, size / 7));
    if (!v) return;
    const { bus, t } = v;
    this.noise_(bus, t, { dur: 0.12, gain: 0.8, filter: "bandpass", freq: 1300, q: 0.8 });
    this.osc(bus, t, { type: "sine", f0: 72, f1: 24, dur: 0.95, gain: 0.9 });
    this.noise_(bus, t, { dur: 1.7, gain: 0.7, filter: "lowpass", freq: 300, attack: 0.02 });
    // Debris: a scatter of small cracks over the next half second.
    for (let i = 0; i < 7; i++) {
      this.noise_(bus, t + 0.08 + Math.random() * 0.6, { dur: 0.03, gain: 0.07, filter: "highpass", freq: 2200 + Math.random() * 2000 });
    }
  }

  /** The player's suit is hit. `strength` 0..1: a rifle round is a tick, a shell is a clang. */
  hitTaken(strength: number): void {
    const v = this.voice(null);
    if (!v) return;
    const { bus, t } = v;
    this.noise_(bus, t, { dur: 0.08 + 0.1 * strength, gain: 0.25 + 0.35 * strength, filter: "bandpass", freq: 1500, q: 1.1 });
    // Armour rings: two inharmonic partials.
    this.osc(bus, t, { type: "triangle", f0: 520, f1: 505, dur: 0.15 + 0.3 * strength, gain: 0.05 + 0.1 * strength });
    this.osc(bus, t, { type: "triangle", f0: 787, f1: 770, dur: 0.1 + 0.2 * strength, gain: 0.03 + 0.06 * strength });
    if (strength > 0.35) this.osc(bus, t, { type: "sine", f0: 140, f1: 55, dur: 0.22, gain: 0.35 * strength });
  }

  /** Hit confirmation; `strength` 0..1 by damage dealt. */
  hitLanded(strength: number): void {
    const v = this.voice(null);
    if (!v) return;
    this.osc(v.bus, v.t, { type: "sine", f0: 1400, f1: 1100, dur: 0.05, gain: 0.08 + 0.1 * strength });
  }

  /** Kill confirmation: two rising notes, distinct from an ordinary hit. */
  kill(): void {
    const v = this.voice(null);
    if (!v) return;
    this.osc(v.bus, v.t, { type: "triangle", f0: 660, f1: 700, dur: 0.09, gain: 0.16 });
    this.osc(v.bus, v.t + 0.09, { type: "triangle", f0: 990, f1: 1050, dur: 0.16, gain: 0.16 });
  }

  /**
   * One foot planting: a thump, a metallic clank and a hiss of hydraulics. `weight` 0..1 grows
   * with speed; `mass` 0..1 runs from the light frame to the heavy one, which sounds deeper.
   */
  footstep(weight: number, mass: number, at: SoundAt): void {
    const v = this.voice(at, 0.55 + 0.45 * weight);
    if (!v) return;
    const { bus, t } = v;
    const clank = (300 - 120 * mass) * (0.97 + Math.random() * 0.06);
    this.osc(bus, t, { type: "sine", f0: 78 - 25 * mass, f1: 40 - 12 * mass, dur: 0.12 + 0.05 * mass, gain: 0.32 + 0.1 * mass });
    this.noise_(bus, t, { dur: 0.09, gain: 0.22, filter: "lowpass", freq: 300 });
    this.osc(bus, t + 0.005, { type: "triangle", f0: clank, f1: clank * 0.97, dur: 0.09, gain: 0.05 });
    this.osc(bus, t + 0.005, { type: "triangle", f0: clank * 1.47, f1: clank * 1.43, dur: 0.06, gain: 0.03 });
    this.noise_(bus, t + 0.04, { dur: 0.1, gain: 0.025 + 0.02 * weight, filter: "highpass", freq: 3200, attack: 0.03 });
  }

  /** Touchdown after a jump or fall. `strength` 0..1 by impact speed. */
  land(strength: number, at: SoundAt): void {
    const v = this.voice(at, 0.4 + 0.6 * strength);
    if (!v) return;
    const { bus, t } = v;
    this.osc(bus, t, { type: "sine", f0: 88, f1: 30, dur: 0.3 + 0.25 * strength, gain: 0.65 });
    this.noise_(bus, t, { dur: 0.35 + 0.3 * strength, gain: 0.6, filter: "lowpass", freq: 330 });
    this.osc(bus, t + 0.01, { type: "triangle", f0: 190, f1: 180, dur: 0.22, gain: 0.07 });
    this.osc(bus, t + 0.01, { type: "triangle", f0: 283, f1: 270, dur: 0.16, gain: 0.05 });
    this.noise_(bus, t + 0.08, { dur: 0.25, gain: 0.05, filter: "highpass", freq: 2800, attack: 0.05 });
  }

  /** Heat is close to the cap: a single warning pip. */
  heatWarning(): void {
    this.ui_((bus, t) => this.osc(bus, t, { type: "square", f0: 880, f1: 880, dur: 0.08, gain: 0.1 }));
  }

  /** Weapons locked out: a three-note falling alarm. */
  overheat(): void {
    this.ui_((bus, t) => {
      for (let i = 0; i < 3; i++) this.osc(bus, t + i * 0.16, { type: "square", f0: 740 - i * 110, f1: 700 - i * 110, dur: 0.13, gain: 0.16 });
    });
  }

  /** Weapons back online after an overheat. */
  cooled(): void {
    this.ui_((bus, t) => this.osc(bus, t, { type: "triangle", f0: 520, f1: 780, dur: 0.12, gain: 0.1 }));
  }

  pickup(): void {
    this.ui_((bus, t) => this.osc(bus, t, { type: "triangle", f0: 520, f1: 1040, dur: 0.18, gain: 0.15 }));
  }

  ui(): void {
    this.ui_((bus, t) => this.osc(bus, t, { type: "triangle", f0: 700, f1: 880, dur: 0.07, gain: 0.08 }));
  }

  /** 0..1 thruster loudness for the player's jets and boost. */
  setThrust(level: number): void {
    if (!this.ctx || !this.thrust) return;
    const t = this.ctx.currentTime;
    this.thrust.rumble.gain.setTargetAtTime(level * 0.32, t, 0.05);
    this.thrust.hiss.gain.setTargetAtTime(level * 0.07, t, 0.04);
  }

  /** 0..1 how hard the player's suit is moving: the servos whine higher and louder with it. */
  setServo(level: number): void {
    if (!this.ctx || !this.servo) return;
    const t = this.ctx.currentTime;
    const s = AUDIO.servo;
    this.servo.gain.gain.setTargetAtTime(level * s.gain, t, 0.12);
    this.servo.osc.frequency.setTargetAtTime(s.pitch + level * s.pitchRise, t, 0.2);
    this.servo.filter.frequency.setTargetAtTime(350 + level * 500, t, 0.2);
  }

  /** Weather where the player is, 0..1 each: rain hisses, and any storm raises the wind. */
  setWeather(rain: number, dust: number): void {
    if (!this.ctx || !this.wind || !this.rain) return;
    const t = this.ctx.currentTime;
    const storm = Math.min(1, rain + dust);
    this.wind.gain.setTargetAtTime(AUDIO.wind * (1 + AUDIO.weather.wind * storm), t, 0.8);
    this.rain.gain.setTargetAtTime(AUDIO.weather.rain * rain, t, 0.8);
  }

  /** Thunder `delay` seconds after the flash (sound is slower than light), `strength` 0..1. */
  thunder(delay: number, strength: number): void {
    const v = this.voice(null, 1, delay + 6);
    if (!v) return;
    const { bus } = v;
    const t = v.t + delay;
    const g = AUDIO.weather.thunder * strength;
    // A near strike cracks first; a far one is only the roll.
    if (delay < 1.5) this.noise_(bus, t, { dur: 0.25, gain: g * 0.8, filter: "bandpass", freq: 1400, q: 0.7 });
    this.noise_(bus, t + 0.05, { dur: 2.6 + delay * 0.4, gain: g, filter: "lowpass", freq: 260, attack: 0.15 });
    this.osc(bus, t, { type: "sine", f0: 55, f1: 28, dur: 2.2, gain: g * 0.6, attack: 0.2 });
    for (let i = 0; i < 3; i++) this.noise_(bus, t + 0.5 + Math.random() * 1.6, { dur: 0.8, gain: g * 0.4, filter: "lowpass", freq: 420, attack: 0.1 });
  }

  // --- Building blocks ---

  /**
   * A bus for one sound at a place in the world, and when it starts. Null when silent, too
   * quiet to hear, or when too many sounds began in the last instant.
   */
  private voice(at: SoundAt, loudness = 1, hold = 3): { bus: AudioNode; t: number } | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.reverb) return null;
    const p = at ? this.place(at) : NEAR;
    if (p.gain * loudness < 0.01) return null;
    const now = ctx.currentTime;
    this.recent = this.recent.filter((t) => now - t < AUDIO.voiceWindow);
    if (this.recent.length >= AUDIO.maxVoices && at) return null;
    this.recent.push(now);

    const input = ctx.createGain();
    input.gain.value = p.gain * loudness;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = p.cutoff;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    input.connect(filter).connect(pan).connect(this.master);
    const send = ctx.createGain();
    send.gain.value = p.wet;
    pan.connect(send).connect(this.reverb);
    // Let the graph go once the longest layer (and the reverb) has finished.
    window.setTimeout(() => {
      input.disconnect();
      send.disconnect();
    }, (p.delay + hold) * 1000);
    return { bus: input, t: now + p.delay };
  }

  private ui_(play: (bus: AudioNode, t: number) => void): void {
    const v = this.voice(null);
    if (v) play(v.bus, v.t);
  }

  private place(at: { x: number; y: number; z: number }): Placement {
    const l = this.listener;
    const dx = at.x - l.x;
    const dy = at.y - l.y;
    const dz = at.z - l.z;
    const d = Math.hypot(dx, dy, dz);
    const flat = Math.hypot(dx, dz) || 1;
    // The listener's right is (cos yaw, 0, -sin yaw); close sounds are not panned hard.
    const side = (dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / flat;
    const a = AUDIO.distance;
    return {
      delay: Math.min(a.maxDelay, d / 343),
      gain: 1 / (1 + d / a.halfGain),
      cutoff: Math.max(a.minCutoff, 20000 / (1 + d / a.cutoffFalloff)),
      pan: side * a.panWidth * Math.min(1, d / 6),
      wet: AUDIO.reverb.nearSend + (AUDIO.reverb.farSend - AUDIO.reverb.nearSend) * Math.min(1, d / AUDIO.reverb.farDistance),
    };
  }

  private osc(bus: AudioNode, t: number, o: { type: OscillatorType; f0: number; f1: number; dur: number; gain: number; attack?: number }): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    const g = this.envelope(t, o.gain, o.dur, o.attack ?? 0.002);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private noise_(
    bus: AudioNode,
    t: number,
    o: { dur: number; gain: number; filter: BiquadFilterType; freq: number; freqEnd?: number; q?: number; attack?: number },
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    if (o.q) filter.Q.value = o.q;
    const g = this.envelope(t, o.gain, o.dur, o.attack ?? 0.002);
    src.connect(filter).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  /** A gain that rises over `attack` and dies away exponentially by `dur`. */
  private envelope(t: number, peak: number, dur: number, attack: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    return g;
  }

  /** Two seconds of decaying stereo noise with a few early echoes: open ground with hills around. */
  private static impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const time = i / ctx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-time * 3.2) * (time < 0.02 ? time / 0.02 : 1);
      }
      for (const echo of [0.11, 0.23, 0.41]) {
        const at = Math.floor((echo + ch * 0.013) * ctx.sampleRate);
        for (let i = 0; i < 400 && at + i < length; i++) data[at + i]! += (Math.random() * 2 - 1) * 0.5 * Math.exp(-echo * 4) * (1 - i / 400);
      }
    }
    return ir;
  }

  private loop(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  /** Jets: a low rumble and a hiss, silent until setThrust raises them. */
  private startThrust(ctx: AudioContext): { rumble: GainNode; hiss: GainNode } {
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 420;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    this.loop(ctx).connect(rumbleFilter).connect(rumble).connect(this.master!);
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 2600;
    hissFilter.Q.value = 0.7;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    this.loop(ctx).connect(hissFilter).connect(hiss).connect(this.master!);
    return { rumble, hiss };
  }

  /** The suit's servos: a filtered buzz with a slight wobble, silent while standing still. */
  private startServo(ctx: AudioContext): { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = AUDIO.servo.pitch;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 3;
    wobble.connect(depth).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 350;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master!);
    osc.start();
    wobble.start();
    return { osc, gain, filter };
  }

  /** Wind: band-passed noise whose pitch and level drift slowly. */
  private startWind(ctx: AudioContext): GainNode {
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.6;
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.07;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 160;
    drift.connect(driftDepth).connect(filter.frequency);
    const gain = ctx.createGain();
    gain.gain.value = AUDIO.wind;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.045;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = AUDIO.wind * 0.6;
    swell.connect(swellDepth).connect(gain.gain);
    this.loop(ctx).connect(filter).connect(gain).connect(this.master!);
    drift.start();
    swell.start();
    return gain;
  }

  /** Rain: a high, soft hiss over a duller patter, silent until setWeather raises it. */
  private startRain(ctx: AudioContext): GainNode {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const hiss = ctx.createBiquadFilter();
    hiss.type = "bandpass";
    hiss.frequency.value = 5200;
    hiss.Q.value = 0.5;
    this.loop(ctx).connect(hiss).connect(gain);
    const patter = ctx.createBiquadFilter();
    patter.type = "lowpass";
    patter.frequency.value = 1100;
    const patterGain = ctx.createGain();
    patterGain.gain.value = 0.6;
    this.loop(ctx).connect(patter).connect(patterGain).connect(gain);
    gain.connect(this.master!);
    return gain;
  }
}
