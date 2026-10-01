import { describe, expect, it } from 'vitest';
import { seal, sealerFor, unseal } from '../src/net/seal';
import { openSealed } from '../src/net/sealed';
import { toB64 } from '../src/net/b64';
import { LatestWriter } from '../src/net/writer';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sealed values', () => {
  it('round-trip in the wire format: Infinity and NaN survive (plain JSON would make them null)', async () => {
    const s = await sealerFor('test', 'x');
    expect(await unseal(s, await seal(s, { a: Infinity, b: -Infinity, c: NaN, d: [1, 'two'] }))).toEqual({ a: Infinity, b: -Infinity, c: NaN, d: [1, 'two'] });
  });

  it("open an entry as stored ({ m, ts }); anything else, or someone else's, is null", async () => {
    const s = await sealerFor('test', 'x');
    const other = await sealerFor('test', 'y');
    const m = toB64(await seal(s, { hello: 1 }));
    expect(await openSealed(s, { m, ts: 42 })).toEqual({ value: { hello: 1 }, ts: 42 });
    expect(await openSealed(other, { m, ts: 42 })).toBeNull();
    expect(await openSealed(s, null)).toBeNull();
    expect(await openSealed(s, { ts: 1 })).toBeNull();
  });
});

describe('LatestWriter', () => {
  it('writes one at a time, and only the newest of what piled up meanwhile', async () => {
    const written: number[] = [];
    let release: () => void = () => {};
    const w = new LatestWriter<number>((v) => {
      written.push(v);
      return new Promise((r) => (release = r));
    });
    w.save(1);
    w.save(2);
    w.save(3);
    expect(written).toEqual([1]);
    release();
    await tick();
    expect(written).toEqual([1, 3]);
    release();
    await tick();
    expect(written).toEqual([1, 3]);
  });

  it('a failed write is dropped, or (retry) goes again with the next save', async () => {
    for (const retry of [false, true]) {
      const written: number[] = [];
      let fail = true;
      const w = new LatestWriter<number>(
        async (v) => {
          if (fail) throw new Error('offline');
          written.push(v);
        },
        { retry },
      );
      w.save(1);
      await tick();
      expect(written).toEqual([]);
      fail = false;
      w.save(2);
      await tick();
      // With retry, 2 replaces 1 (the newest wins); either way 2 is written.
      expect(written).toEqual([2]);
    }
  });
});
