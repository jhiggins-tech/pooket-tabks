import { decodeMsg, encodeMsg } from './wire';

/** A two-way message pipe to the other player (a WebRTC data channel, or an in-memory pair in tests). */
export interface Transport {
  send(msg: unknown): void;
  onMessage: (msg: unknown) => void;
  onClose: () => void;
  close(): void;
}

/** Two connected in-memory transports, delivering asynchronously like a real network. For tests. */
export function loopback(): [Transport, Transport] {
  const make = (): Transport & { peer?: Transport } => ({
    send(msg) {
      const to = this.peer!;
      const copy = decodeMsg(encodeMsg(msg)); // exactly what goes over the wire
      queueMicrotask(() => to.onMessage(copy));
    },
    onMessage: () => {},
    onClose: () => {},
    close() {
      const to = this.peer!;
      queueMicrotask(() => to.onClose());
    },
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
