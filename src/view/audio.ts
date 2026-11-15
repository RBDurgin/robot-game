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
      this.master.connect(ctx.destination);

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

  private tone(freqFrom: number, freqTo: number, duration: number, gainValue: number, type: OscillatorType = "square"): void {
    if (!this.ctx || !this.master || gainValue < 0.004) return;
    const t = this.ctx.currentTime;
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

  hitTaken(): void {
    this.burst({ duration: 0.12, gain: 0.35, filter: 1400, type: "bandpass" });
  }

  hitLanded(): void {
    this.tone(1400, 1100, 0.05, 0.08, "sine");
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
