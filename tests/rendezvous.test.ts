import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advertise, advertTopic, Bus, hostRoom, joinRoom, newRoomCode, normaliseRoomCode, watchLobby, wifiSealer, type Advert, type PeerFactory, type PeerLike } from '../src/net/rendezvous';
import { startBroker, type TestBroker } from './support/broker';

/** Stand-in for WebRTC: an offer/answer pair "connects" once the host accepts the answer. */
class FakePeer implements PeerLike {
  onOpen = () => {};
  closed = false;
  async accept(answer: string) {
    const pair = answers.get(answer);
    if (!pair) throw new Error('bad answer');
    setTimeout(() => {
      pair.host.onOpen();
      pair.guest.onOpen();
    }, 5);
  }
  close() {
    this.closed = true;
  }
}
const offers = new Map<string, FakePeer>();
const answers = new Map<string, { host: FakePeer; guest: FakePeer }>();
let n = 0;
const factory: PeerFactory<FakePeer> = {
  async host() {
    const peer = new FakePeer();
    const code = `offer-${n++}`;
    offers.set(code, peer);
    return { peer, code };
  },
  async join(code) {
    const host = offers.get(code);
    if (!host) throw new Error('bad offer');
    const guest = new FakePeer();
    const a = `answer-${n++}`;
    answers.set(a, { host, guest });
    return { peer: guest, code: a };
  },
};

let broker: TestBroker;
beforeEach(async () => {
  broker = await startBroker();
});
afterEach(async () => {
  await broker.close();
});
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('room codes', () => {
  it('are 4 easy letters; typing is forgiving', () => {
    const c = newRoomCode();
    expect(c).toMatch(/^[A-Z]{4}$/);
    expect(normaliseRoomCode(' frog ')).toBe('FROG');
    expect(normaliseRoomCode('fr-og')).toBe('FROG');
    expect(normaliseRoomCode('FR0G')).toBe('FROG'); // a zero can only have meant O
    expect(normaliseRoomCode('F01L')).toBe('FOIL');
    expect(normaliseRoomCode('FRO')).toBeNull();
    expect(normaliseRoomCode('FROGS')).toBeNull();
  });

  it('two phones with the same code find each other; the broker only ever sees sealed data', async () => {
    const hb = await Bus.open([broker.url], 'h');
    const gb = await Bus.open([broker.url], 'g');
    let hostPeer: FakePeer | null = null;
    const room = hostRoom(hb, 'FROG', factory, (p) => (hostPeer = p));
    await new Promise((r) => setTimeout(r, 50));
    const guestPeer = await joinRoom(gb, 'FROG', factory).result;
    await until(() => !!hostPeer);
    expect(answers.get([...answers.keys()].at(-1)!)).toEqual({ host: hostPeer, guest: guestPeer });
    const wire = broker.published.map((m) => m.payload.toString('latin1')).join('');
    expect(wire).not.toContain('offer-');
    expect(wire).not.toContain('answer-');
    expect(broker.published.every((m) => !m.topic.includes('FROG'))).toBe(true);
    room.stop();
    hb.close();
    gb.close();
  });

  it('a third phone is told the game is full', async () => {
    const hb = await Bus.open([broker.url], 'h');
    hostRoom(hb, 'TOAD', factory, () => {});
    await new Promise((r) => setTimeout(r, 50));
    await joinRoom(await Bus.open([broker.url], 'g1'), 'TOAD', factory).result;
    await expect(joinRoom(await Bus.open([broker.url], 'g2'), 'TOAD', factory).result).rejects.toThrow(/two players/);
  });

  it('a code nobody is hosting gives up with a helpful message', async () => {
    const gb = await Bus.open([broker.url], 'g');
    await expect(joinRoom(gb, 'NOPE', factory, { noHostMs: 400 }).result).rejects.toThrow(/No game with code NOPE/);
  });

  it('works if some brokers are down, and says so if all are', async () => {
    const dead = 'ws://127.0.0.1:1/mqtt';
    const hb = await Bus.open([dead, broker.url], 'h', undefined, 2000);
    const gb = await Bus.open([broker.url, dead], 'g', undefined, 2000);
    let connected = false;
    hostRoom(hb, 'BARK', factory, () => (connected = true));
    await new Promise((r) => setTimeout(r, 50));
    await joinRoom(gb, 'BARK', factory).result;
    await until(() => connected);
    await expect(Bus.open([dead, dead], 'x', undefined, 1000)).rejects.toThrow(/lobby servers/);
  });
});

describe('games on your Wi-Fi', () => {
  it('a host on the same Wi-Fi shows up in the list, and drops off when it stops', async () => {
    const lan = await wifiSealer('203.0.113.7');
    const hb = await Bus.open([broker.url], 'h');
    const ad = advertise(hb, lan, { hostId: 'h1', name: 'kcaj', characterId: 'kcaj', room: 'FROG' });
    await new Promise((r) => setTimeout(r, 50));
    const gb = await Bus.open([broker.url], 'g');
    let list: Advert[] = [];
    watchLobby(gb, lan, (l) => (list = l));
    await until(() => list.length === 1);
    expect(list[0]).toMatchObject({ name: 'kcaj', room: 'FROG' });
    // Someone on a different Wi-Fi sees nothing.
    let otherList: Advert[] = [{} as Advert];
    watchLobby(await Bus.open([broker.url], 'o'), await wifiSealer('198.51.100.1'), (l) => (otherList = l));
    await until(() => otherList.length === 0);
    ad.stop();
    await until(() => list.length === 0);
  });

  it('a host that vanishes (tab closed) is taken off the list by its will', async () => {
    const lan = await wifiSealer('203.0.113.7');
    const will = { topic: advertTopic(lan, 'h2'), payload: new Uint8Array(0), retain: true };
    const hb = await Bus.open([broker.url], 'host', will);
    advertise(hb, lan, { hostId: 'h2', name: 'tones', characterId: 'tones', room: 'MUDS' });
    const gb = await Bus.open([broker.url], 'g');
    let list: Advert[] = [];
    watchLobby(gb, lan, (l) => (list = l));
    await until(() => list.length === 1);
    broker.kill('host-0');
    await until(() => list.length === 0);
  });
});
