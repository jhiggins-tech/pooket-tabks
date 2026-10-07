import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from '../src/net/rooms';
import { newReplayId } from '../src/net/replay';
import { seal, sealerFor, unseal } from '../src/net/seal';
import { subId } from '../src/push/client';
import { digest, playerKey, type MatchSummary } from '../src/stats/summary';

// Every hash and id the database (and other phones, and older builds) depends on, pinned to fixed
// values: changing how any of them is worked out would lose rooms, subscriptions, stats or replays.

afterEach(() => vi.restoreAllMocks());

describe('hashes stored data depends on', () => {
  it("a player's stats key: the first 8 bytes of SHA-256('pooket-tabks/stats/' + uid)", async () => {
    expect(await playerKey('uid-ann')).toBe('a:569f3ad7bc7527cb');
    expect(await playerKey('ünï€😀')).toBe('a:a0ba27aa5097063c');
  });

  it("a match summary's fingerprint: SHA-256 of its canonical JSON, all 32 bytes", async () => {
    const summary: MatchSummary = {
      v: 1,
      id: `${'ab'.repeat(12)}-k1`,
      rules: 20,
      turns: 7,
      endReason: null,
      winner: 0,
      players: [
        { name: 'Ann', characterId: 'kcaj', tally: { shots: { shell: 3 }, hits: { shell: 2 }, dealt: { shell: 40 }, taken: 10, self: 0, kills: 1 } },
        { name: 'Bö', characterId: 'kie', tally: { shots: {}, hits: {}, dealt: {}, taken: 40, self: 5, kills: 0 } },
      ],
    };
    expect(await digest(summary)).toBe('53416c19bd5df6e9d855057b04295fa513591b62ccf70d720378a6a7a5a48a05');
  });

  it("a push subscription's key: the first 16 bytes of SHA-256(endpoint)", async () => {
    expect(await subId('https://push.example/endpoint/1')).toBe('98c3cdc6e9487570ea9a75ef53c68f9d');
  });

  it("a room's topic: the first 12 bytes of SHA-256('pooket-tabks/topic/<purpose>/<secret>'); its key all of the key hash", async () => {
    const room = await sealerFor('room', 'FROG');
    expect(room.topic).toBe('c9f9647c8239f08fd920a92a');
    expect((await sealerFor('lobby', 'pooket')).topic).toBe('1016c4337e7a368ee1eea48f');
    // The AES key is SHA-256('pooket-tabks/key/room/FROG'), raw.
    const raw = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('pooket-tabks/key/room/FROG'));
    const key = await globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    expect(await unseal({ topic: room.topic, key }, await seal(room, { hi: 1 }))).toEqual({ hi: 1 });
  });
});

describe('random ids, as hex', () => {
  /** Make the next getRandomValues fill in 0x00, 0x0f, 0x10, 0xab, 0xff, then counting up from 1. */
  const fixedBytes = () =>
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      const b = new Uint8Array(a!.buffer, a!.byteOffset, a!.byteLength);
      b.forEach((_, i) => (b[i] = [0x00, 0x0f, 0x10, 0xab, 0xff][i] ?? i - 4));
      return a;
    });

  it('a seat id: 8 random bytes', () => {
    fixedBytes();
    expect(randomId()).toBe('000f10abff010203');
  });

  it('a replay id: 12 random bytes', () => {
    fixedBytes();
    expect(newReplayId()).toBe('000f10abff01020304050607');
  });
});
