const WINDOW_SECONDS = 5;

/**
 * Rolling frame-time statistics for the developer overlay. The average hides stutter, so
 * this also reports the "1% low": the frame rate of the slowest 1% of recent frames.
 */
export class FrameStats {
  private readonly frames: number[] = [];
  private total = 0;
  private text = "…";
  private sinceRefresh = 0;

  add(frameSeconds: number): void {
    if (frameSeconds <= 0) return;
    this.frames.push(frameSeconds);
    this.total += frameSeconds;
    while (this.total > WINDOW_SECONDS && this.frames.length > 1) this.total -= this.frames.shift()!;
    this.sinceRefresh += frameSeconds;
  }

  /** e.g. "118 avg · 96 low (1%) · worst 14.2 ms". Recomputed a few times a second. */
  summary(): string {
    if (this.sinceRefresh < 0.25 || this.frames.length === 0) return this.text;
    this.sinceRefresh = 0;
    const sorted = [...this.frames].sort((a, b) => b - a);
    const slowest = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 100)));
    const lowDt = slowest.reduce((sum, dt) => sum + dt, 0) / slowest.length;
    const avg = this.frames.length / this.total;
    this.text = `${avg.toFixed(0)} avg · ${(1 / lowDt).toFixed(0)} low (1%) · worst ${(sorted[0]! * 1000).toFixed(1)} ms`;
    return this.text;
  }
}
