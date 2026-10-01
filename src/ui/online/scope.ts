/**
 * One attempt at something online (opening the Game browser, hosting, joining, rejoining, watching): what
 * to stop when it's abandoned, and whether it still is the current one. Async steps check `alive` when
 * they come back; leaving runs every `onEnd` (newest first), once.
 */
export class Scope {
  private ends: (() => void)[] = [];
  private live = true;

  get alive(): boolean {
    return this.live;
  }

  /** Run `fn` when this ends (straight away if it already has). Returns a function that drops it. */
  onEnd(fn: () => void): () => void {
    if (!this.live) {
      fn();
      return () => {};
    }
    this.ends.push(fn);
    return () => {
      this.ends = this.ends.filter((f) => f !== fn);
    };
  }

  end(): void {
    if (!this.live) return;
    this.live = false;
    const ends = this.ends.reverse();
    this.ends = [];
    for (const fn of ends) fn();
  }
}
