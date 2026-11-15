/**
 * All sound is synthesised with WebAudio, so the game ships no audio files.
 * Browsers only allow audio after a user gesture: call unlock() from a click or key press.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private thrustGain: GainNode | null = null;
  private volume = 0.6;

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

      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;

      // Continuous thruster rumble, silent until setThrust raises it.
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      this.thrustGain = ctx.createGain();
      this.thrustGain.gain.value = 0;
      src.connect(filter).connect(this.thrustGain).connect(this.master);
      src.start();
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

  /** Quieter with distance from the listener. */
  private static falloff(distance: number): number {
    return 1 / (1 + distance / 45);
  }

  private burst(opts: { duration: number; gain: number; filter: number; type?: BiquadFilterType }): void {
    if (!this.ctx || !this.master || !this.noise || opts.gain < 0.004) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type ?? "lowpass";
    filter.frequency.value = opts.filter;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + opts.duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, opts.duration);
  }

  private tone(freqFrom: number, freqTo: number, duration: number, gainValue: number, type: OscillatorType = "square", delay = 0): void {
    if (!this.ctx || !this.master || gainValue < 0.004) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  shot(kind: "hitscan" | "projectile", heavy: boolean, distance: number): void {
    const k = Sfx.falloff(distance);
    if (kind === "projectile") {
      this.burst({ duration: 0.35, gain: 0.5 * k, filter: 700 });
      this.tone(160, 60, 0.3, 0.25 * k, "sawtooth");
    } else if (heavy) {
      this.burst({ duration: 0.3, gain: 0.6 * k, filter: 1800 });
      this.tone(220, 50, 0.25, 0.35 * k, "sawtooth");
    } else {
      this.burst({ duration: 0.07, gain: 0.3 * k, filter: 3200, type: "bandpass" });
      this.tone(900, 240, 0.06, 0.12 * k);
    }
  }

  explosion(distance: number, size: number): void {
    const k = Sfx.falloff(distance) * Math.min(1.4, size / 7);
    this.burst({ duration: 0.9, gain: 0.9 * k, filter: 420 });
    this.tone(90, 30, 0.6, 0.5 * k, "sine");
  }

  /** `strength` 0..1: a rifle round is a tick, a shell is a clang. */
  hitTaken(strength: number): void {
    this.burst({ duration: 0.1 + 0.12 * strength, gain: 0.25 + 0.35 * strength, filter: 1400, type: "bandpass" });
    if (strength > 0.4) this.tone(140, 60, 0.18, 0.3 * strength, "sine");
  }

  /** Hit confirmation; `strength` 0..1 by damage dealt. */
  hitLanded(strength: number): void {
    this.tone(1400, 1100, 0.05, 0.08 + 0.1 * strength, "sine");
  }

  /** Kill confirmation: two rising notes, distinct from an ordinary hit. */
  kill(): void {
    this.tone(660, 700, 0.09, 0.16, "triangle");
    this.tone(990, 1050, 0.16, 0.16, "triangle", 0.09);
  }

  /** One foot planting. `weight` 0..1 grows with speed. */
  footstep(weight: number, distance: number): void {
    const k = Sfx.falloff(distance) * (0.55 + 0.45 * weight);
    this.burst({ duration: 0.11, gain: 0.3 * k, filter: 260 });
    this.tone(70, 42, 0.09, 0.22 * k, "sine");
  }

  /** Touchdown after a jump or fall. `strength` 0..1 by impact speed. */
  land(strength: number, distance: number): void {
    const k = Sfx.falloff(distance) * (0.4 + 0.6 * strength);
    this.burst({ duration: 0.3 + 0.25 * strength, gain: 0.7 * k, filter: 320 });
    this.tone(85, 32, 0.28 + 0.2 * strength, 0.6 * k, "sine");
  }

  /** Heat is close to the cap: a single warning pip. */
  heatWarning(): void {
    this.tone(880, 880, 0.08, 0.1, "square");
  }

  /** Weapons locked out: a three-note falling alarm. */
  overheat(): void {
    for (let i = 0; i < 3; i++) this.tone(740 - i * 110, 700 - i * 110, 0.13, 0.16, "square", i * 0.16);
  }

  /** Weapons back online after an overheat. */
  cooled(): void {
    this.tone(520, 780, 0.12, 0.1, "triangle");
  }

  pickup(): void {
    this.tone(520, 1040, 0.18, 0.15, "triangle");
  }

  ui(): void {
    this.tone(700, 880, 0.07, 0.08, "triangle");
  }

  /** 0..1 thruster loudness for the player's jets and boost. */
  setThrust(level: number): void {
    if (this.ctx && this.thrustGain) this.thrustGain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.05);
  }
}
