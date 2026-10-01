/** Typed events with any number of listeners: `on` returns the function that removes the listener. */
export class Emitter<Events extends Record<string, unknown[]>> {
  private readonly listeners: { [E in keyof Events]?: ((...args: Events[E]) => void)[] } = {};

  on<E extends keyof Events>(event: E, fn: (...args: Events[E]) => void): () => void {
    (this.listeners[event] ??= []).push(fn);
    return () => {
      this.listeners[event] = this.listeners[event]?.filter((f) => f !== fn);
    };
  }

  /** Call each listener, in the order they were added. */
  emit<E extends keyof Events>(event: E, ...args: Events[E]): void {
    for (const fn of this.listeners[event] ?? []) fn(...args);
  }
}
