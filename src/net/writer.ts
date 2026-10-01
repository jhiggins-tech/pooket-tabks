/**
 * Writes the newest of a stream of values, one write at a time (a record, a spectator feed slot): a value
 * saved while a write is in flight waits, and only the newest waiting one is written after it. A write
 * that fails is dropped, or with `retry` goes with the next save (not straight away: no hammering the
 * server when it's struggling).
 */
export class LatestWriter<T> {
  private latest: T | null = null;
  private busy = false;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly opts: { retry?: boolean; failed?: (e: unknown) => void } = {},
  ) {}

  save(value: T): void {
    this.latest = value;
    void this.flush();
  }

  private async flush(): Promise<void> {
    const value = this.latest;
    if (value === null || this.busy) return;
    this.busy = true;
    this.latest = null;
    let ok = false;
    try {
      await this.write(value);
      ok = true;
    } catch (e) {
      this.opts.failed?.(e);
      if (this.opts.retry) this.latest ??= value;
    } finally {
      this.busy = false;
    }
    if (ok && this.latest !== null) void this.flush();
  }
}
