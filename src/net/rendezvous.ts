import { MqttClient } from './mqtt';
import { seal, sealerFor, unseal, type Sealer } from './seal';

/**
 * Finding the other phone without a server of our own: free public MQTT brokers relay a few sealed
 * messages (the WebRTC offer and answer) between two phones that share a room code, or that are on the
 * same Wi-Fi (same public address). Once the data channel opens, the brokers are done with.
 */

/** Free public brokers (WebSocket over TLS). Several at once, so one being down doesn't matter. */
export const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

const PREFIX = 'pooket-tabks/v1';
/** Room codes: 4 letters (letters only, so a typed 0 or 1 can only mean O or I). */
export const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const KNOCK_EVERY_MS = 1500;
const NO_HOST_MS = 12_000;
const CONNECT_MS = 20_000;
const ADVERT_EVERY_MS = 30_000;
/** Adverts older than this are from a host that's gone (their "will" didn't reach us). */
const ADVERT_STALE_MS = 90_000;

/** The bits of a WebRTC peer the rendezvous needs (the real Peer, or a fake in tests). */
export interface PeerLike {
  onOpen: () => void;
  accept(answerCode: string): Promise<void>;
  close(): void;
}
export interface PeerFactory<P extends PeerLike> {
  host(): Promise<{ peer: P; code: string }>;
  join(offerCode: string): Promise<{ peer: P; code: string }>;
}

export function randomId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function newRoomCode(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return [...b].map((x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
}

/** Tidy up a typed room code ("fr0g " → "FROG"); null if it can't be one. */
export function normaliseRoomCode(text: string): string | null {
  const c = text.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z]/g, '');
  return c.length === 4 && [...c].every((ch) => ROOM_ALPHABET.includes(ch)) ? c : null;
}

/** A connection to several brokers at once, presenting them as one (duplicates dropped). */
export class Bus {
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  private readonly filters: string[] = [];
  private readonly seen = new Map<string, number>();

  private constructor(private readonly clients: MqttClient[]) {}

  /** Connect to the brokers; resolves as soon as one accepts (the rest keep trying). */
  static open(urls: string[], clientId: string, will?: { topic: string; payload: Uint8Array; retain: boolean }, timeoutMs = 6000): Promise<Bus> {
    const clients = urls.map((url, i) => new MqttClient(url, { clientId: `${clientId}-${i}`, will }));
    const bus = new Bus(clients);
    return new Promise((resolve, reject) => {
      let failed = 0;
      let done = false;
      for (const c of clients) {
        c.onMessage = (t, p) => bus.receive(t, p);
        c.connect(timeoutMs).then(
          () => {
            for (const f of bus.filters) c.subscribe(f);
            if (!done) {
              done = true;
              resolve(bus);
            }
          },
          () => {
            if (++failed === clients.length && !done) {
              done = true;
              reject(new Error("Couldn't reach the lobby servers (is this phone online?)"));
            }
          },
        );
      }
    });
  }

  get connected(): boolean {
    return this.clients.some((c) => c.isConnected);
  }

  subscribe(filter: string): void {
    this.filters.push(filter);
    for (const c of this.clients) if (c.isConnected) c.subscribe(filter);
  }

  publish(topic: string, payload: Uint8Array, retain = false): void {
    for (const c of this.clients) if (c.isConnected) c.publish(topic, payload, retain);
  }

  close(): void {
    for (const c of this.clients) c.close();
  }

  private receive(topic: string, payload: Uint8Array): void {
    // The same message arrives once per broker: pass it on once.
    const key = `${topic}|${payload.length}|${Array.from(payload.subarray(0, 24)).join(',')}`;
    const now = Date.now();
    for (const [k, t] of this.seen) if (now - t > 5000) this.seen.delete(k);
    if (this.seen.has(key)) return;
    this.seen.set(key, now);
    this.onMessage(topic, payload);
  }
}

type RoomMsg =
  | { t: 'knock'; from: string }
  | { t: 'offer'; from: string; to: string; code: string }
  | { t: 'answer'; from: string; to: string; code: string }
  | { t: 'busy'; from: string; to: string };

async function roomChannel(bus: Bus, code: string, me: string, onMsg: (m: RoomMsg) => void) {
  const sealer = await sealerFor('room', code);
  const topic = `${PREFIX}/r/${sealer.topic}`;
  const prev = bus.onMessage;
  bus.onMessage = (t, p) => {
    if (t !== topic) return prev(t, p);
    void unseal(sealer, p).then((m) => {
      const msg = m as RoomMsg | null;
      if (msg && typeof msg === 'object' && msg.from !== me && (!('to' in msg) || msg.to === me)) onMsg(msg);
    });
  };
  bus.subscribe(topic);
  return { send: async (m: RoomMsg) => bus.publish(topic, await seal(sealer, m)) };
}

/** Host a room: answer the first phone that knocks with an offer; resolve its peer once connected. */
export function hostRoom<P extends PeerLike>(bus: Bus, code: string, factory: PeerFactory<P>, onConnected: (peer: P) => void): { stop: () => void } {
  const me = randomId();
  let guest: string | null = null;
  let offer: Promise<{ peer: P; code: string }> | null = null;
  let accepted = false;
  let stopped = false;
  let giveUp: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    void offer?.then(({ peer }) => peer.close());
    guest = null;
    offer = null;
    accepted = false;
  };
  const ready = roomChannel(bus, code, me, async (m) => {
    if (stopped) return;
    const ch = await ready;
    if (m.t === 'knock') {
      if (guest && guest !== m.from) return void ch.send({ t: 'busy', from: me, to: m.from });
      guest = m.from;
      if (!offer) {
        offer = factory.host();
        void offer.then(({ peer }) => {
          peer.onOpen = () => {
            if (giveUp) clearTimeout(giveUp);
            if (!stopped) onConnected(peer);
          };
        });
      }
      const { code: offerCode } = await offer;
      if (guest === m.from) void ch.send({ t: 'offer', from: me, to: m.from, code: offerCode });
    } else if (m.t === 'answer' && m.from === guest && offer && !accepted) {
      accepted = true;
      const { peer } = await offer;
      await peer.accept(m.code).catch(() => reset());
      // If it doesn't connect, free the room for another try.
      giveUp = setTimeout(() => !stopped && reset(), CONNECT_MS);
    }
  });
  return {
    stop: () => {
      stopped = true;
      if (giveUp) clearTimeout(giveUp);
      if (!accepted) void offer?.then(({ peer }) => peer.close());
    },
  };
}

/** Join a room by code. Resolves with the connected peer. */
export function joinRoom<P extends PeerLike>(
  bus: Bus,
  code: string,
  factory: PeerFactory<P>,
  opts: { noHostMs?: number; connectMs?: number } = {},
): { result: Promise<P>; cancel: () => void } {
  const me = randomId();
  let cancel = () => {};
  const result = new Promise<P>((resolve, reject) => {
    let answering: Promise<{ peer: P; code: string }> | null = null;
    let host = '';
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (err: Error | null, peer?: P) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      clearInterval(knocking);
      if (err) {
        void answering?.then(({ peer: p }) => p.close());
        reject(err);
      } else resolve(peer!);
    };
    cancel = () => finish(new Error('cancelled'));
    const ready = roomChannel(bus, code, me, async (m) => {
      if (finished) return;
      const ch = await ready;
      if (m.t === 'busy') finish(new Error('That game already has two players.'));
      else if (m.t === 'offer' && !answering) {
        host = m.from;
        timers.push(setTimeout(() => finish(new Error("Couldn't connect. Are both phones on the same Wi-Fi?")), opts.connectMs ?? CONNECT_MS));
        answering = factory.join(m.code);
        try {
          const { peer, code: answer } = await answering;
          peer.onOpen = () => finish(null, peer);
          // Keep sending the answer until the channel opens (a message can go astray).
          const send = () => !finished && void ch.send({ t: 'answer', from: me, to: host, code: answer });
          send();
          timers.push(setInterval(send, KNOCK_EVERY_MS) as unknown as ReturnType<typeof setTimeout>);
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });
    const knock = () =>
      void ready.then((ch) => {
        if (!answering && !finished) void ch.send({ t: 'knock', from: me });
      });
    const knocking = setInterval(knock, KNOCK_EVERY_MS);
    knock();
    timers.push(setTimeout(() => !answering && finish(new Error(`No game with code ${code}. Check it, and that the host is still on the Host screen.`)), opts.noHostMs ?? NO_HOST_MS));
  });
  return { result, cancel: () => cancel() };
}

/** A game on the lobby list. */
export interface Advert {
  hostId: string;
  name: string;
  characterId: string;
  room: string;
  ts: number;
}

export async function wifiSealer(lanId: string): Promise<Sealer> {
  return sealerFor('wifi', lanId);
}

export function advertTopic(s: Sealer, hostId: string): string {
  return `${PREFIX}/w/${s.topic}/${hostId}`;
}

/** Host: keep a game on the Wi-Fi lobby list (retained, refreshed) until stopped. */
export function advertise(bus: Bus, s: Sealer, ad: Omit<Advert, 'ts'>): { stop: () => void } {
  const topic = advertTopic(s, ad.hostId);
  const put = async () => bus.publish(topic, await seal(s, { ...ad, ts: Date.now() }), true);
  void put();
  const timer = setInterval(() => void put(), ADVERT_EVERY_MS);
  return {
    stop: () => {
      clearInterval(timer);
      bus.publish(topic, new Uint8Array(0), true); // off the list
    },
  };
}

/** Joiner: watch the Wi-Fi lobby list. */
export function watchLobby(bus: Bus, s: Sealer, onList: (games: Advert[]) => void): { stop: () => void } {
  const base = `${PREFIX}/w/${s.topic}/`;
  const games = new Map<string, Advert>();
  const emit = () => onList([...games.values()].filter((g) => Date.now() - g.ts < ADVERT_STALE_MS).sort((a, b) => b.ts - a.ts));
  const prev = bus.onMessage;
  bus.onMessage = (t, p) => {
    if (!t.startsWith(base)) return prev(t, p);
    const hostId = t.slice(base.length);
    if (p.length === 0) {
      games.delete(hostId);
      emit();
      return;
    }
    void unseal(s, p).then((m) => {
      const ad = m as Advert | null;
      if (!ad || ad.hostId !== hostId || typeof ad.room !== 'string') return;
      games.set(hostId, ad);
      emit();
    });
  };
  bus.subscribe(`${base}+`);
  const timer = setInterval(emit, 5000);
  emit();
  return { stop: () => clearInterval(timer) };
}
