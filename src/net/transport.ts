import { decodeMsg, encodeMsg } from './wire';

/** A two-way message pipe to the other player (through a Firebase room, or an in-memory pair in tests). */
export interface Transport {
  send(msg: unknown): void;
  onMessage: (msg: unknown) => void;
  /** The pipe is gone for good (the room closed, or the other end closed it). */
  onClose: () => void;
  /** The other phone has gone quiet (true: nothing heard for a while) or is back (false). */
  onQuiet?: (quiet: boolean) => void;
  /** Start a fresh outgoing stream, for the other phone rejoining on a new connection. */
  restart?(): void;
  /** Stop using the pipe but leave the room as it is (the match carries on without this phone). */
  detach?(): void;
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
    detach() {
      this.send = () => {};
    },
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
