import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MqttClient } from '../src/net/mqtt';
import { seal, sealerFor, unseal } from '../src/net/seal';
import { startBroker, type TestBroker } from './support/broker';

let broker: TestBroker;
beforeEach(async () => {
  broker = await startBroker();
});
afterEach(async () => {
  await broker.close();
});

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function client(id: string) {
  const c = new MqttClient(broker.url, { clientId: id });
  const got: { topic: string; text: string }[] = [];
  c.onMessage = (topic, payload) => got.push({ topic, text: new TextDecoder().decode(payload) });
  await c.connect();
  return { c, got };
}
const bytes = (s: string) => new TextEncoder().encode(s);

describe('MQTT client', () => {
  it('connects, subscribes with wildcards and receives what others publish', async () => {
    const a = await client('a');
    const b = await client('b');
    a.c.subscribe('pt/room/+/x');
    await new Promise((r) => setTimeout(r, 50));
    b.c.publish('pt/room/42/x', bytes('hello'));
    b.c.publish('pt/room/42/y', bytes('not for a'));
    b.c.publish('pt/room/42/x', bytes('x'.repeat(300))); // multi-byte length
    await until(() => a.got.length >= 2);
    expect(a.got).toEqual([
      { topic: 'pt/room/42/x', text: 'hello' },
      { topic: 'pt/room/42/x', text: 'x'.repeat(300) },
    ]);
    a.c.close();
    b.c.close();
  });

  it('retained messages reach late subscribers, and an empty one clears them', async () => {
    const a = await client('a');
    a.c.publish('pt/lobby/h1', bytes('game 1'), true);
    a.c.publish('pt/lobby/h2', bytes('game 2'), true);
    a.c.publish('pt/lobby/h2', new Uint8Array(0), true);
    await new Promise((r) => setTimeout(r, 50));
    const b = await client('b');
    b.c.subscribe('pt/lobby/+');
    await until(() => b.got.length >= 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.got).toEqual([{ topic: 'pt/lobby/h1', text: 'game 1' }]);
    a.c.close();
    b.c.close();
  });

  it("the broker publishes our will if we vanish, but not if we say goodbye", async () => {
    const watcher = await client('w');
    watcher.c.subscribe('pt/will/#');
    const willOf = (id: string) => ({ topic: `pt/will/${id}`, payload: bytes(`${id} gone`), retain: false });
    const polite = new MqttClient(broker.url, { clientId: 'polite', will: willOf('polite') });
    await polite.connect();
    polite.close();
    const rude = new MqttClient(broker.url, { clientId: 'rude', will: willOf('rude') });
    let closed = false;
    rude.onClose = () => (closed = true);
    await rude.connect();
    await new Promise((r) => setTimeout(r, 50));
    broker.kill('rude'); // its network drops
    await until(() => closed);
    expect(watcher.got.map((g) => g.text)).toEqual(['rude gone']);
  });

  it('fails fast when the broker is unreachable', async () => {
    const c = new MqttClient('ws://127.0.0.1:1/mqtt', { clientId: 'x' });
    await expect(c.connect(2000)).rejects.toThrow();
  });
});

describe('sealing', () => {
  it('only the same secret finds and opens a message', async () => {
    const a = await sealerFor('room', 'FROG');
    const b = await sealerFor('room', 'FROG');
    const other = await sealerFor('room', 'TOAD');
    expect(a.topic).toBe(b.topic);
    expect(a.topic).not.toBe(other.topic);
    expect(a.topic).not.toContain('FROG');
    const box = await seal(a, { t: 'offer', code: '1~o~...' });
    expect(new TextDecoder().decode(box)).not.toContain('offer');
    expect(await unseal(b, box)).toEqual({ t: 'offer', code: '1~o~...' });
    expect(await unseal(other, box)).toBeNull();
    expect(await unseal(a, new Uint8Array(5))).toBeNull();
  });
});
