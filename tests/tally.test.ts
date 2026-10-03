import { describe, expect, it } from 'vitest';
import { MAX_HP } from '../src/game/constants';
import { fire, selectTier, setAim } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { applySnapshot, takeSnapshot, upgradeSnapshot } from '../src/net/snapshot';
import { testGame, untilAiming, untilNextTurn } from './support/game';

/** kcaj at 200 and `who` at 500 on flat ground; kcaj fires Hyperfixate straight at them. */
function beamed(who = 'kie', hp?: number): GameState {
  const g = testGame({
    players: [
      { name: 'kcaj', colour: '#f0f', characterId: 'kcaj' },
      { name: who, colour: '#4ea8ff', characterId: who },
    ],
    xs: [200, 500],
  });
  if (hp !== undefined) g.players[1]!.hp = hp;
  selectTier(g, 1); // Hyperfixate
  setAim(g, 0, 50);
  fire(g);
  untilNextTurn(g); // the victim's turn comes up: the burn ticks
  return g;
}

describe('the stats tally', () => {
  it('counts the shot and the hit, and credits the damage (the burn too, though it ticks on the victim’s turn)', () => {
    const g = beamed();
    const [kcaj, kie] = g.tally;
    expect(kcaj!.shots).toEqual({ hyperfixate: 1 });
    expect(kcaj!.hits).toEqual({ hyperfixate: 1 });
    expect(kcaj!.dealt).toEqual({ hyperfixate: 15 + 8 });
    expect(kie!.taken).toBe(23);
    expect(MAX_HP - g.players[1]!.hp).toBe(23);
    expect(g.players[1]!.burn).toMatchObject({ by: 0, weaponId: 'hyperfixate' });
  });

  it('a miss is a shot without a hit; a kill counts once, and only the health that was there', () => {
    const g = beamed('kie', 10);
    expect(g.players[1]!.alive).toBe(false);
    expect(g.tally[0]).toMatchObject({ dealt: { hyperfixate: 10 }, kills: 1 });
    const m = testGame({
      players: [
        { name: 'kcaj', colour: '#f0f', characterId: 'kcaj' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 500],
    });
    selectTier(m, 1);
    setAim(m, 180, 50); // the other way
    fire(m);
    untilAiming(m);
    expect(m.tally[0]).toMatchObject({ shots: { hyperfixate: 1 }, hits: {}, dealt: {}, kills: 0 });
  });

  it('a jet that lands drop after drop is still one shot, one hit', () => {
    const g = testGame({
      players: [
        { name: 'tones2', colour: '#ffcc1f', characterId: 'tones' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 260],
    });
    selectTier(g, 0);
    setAim(g, 0, 75);
    fire(g);
    untilAiming(g);
    const t = g.tally[0]!;
    expect(t.shots).toEqual({ 'ten-1': 1 });
    expect(t.hits).toEqual({ 'ten-1': 1 });
    expect(t.dealt['ten-1']).toBe(MAX_HP - g.players[1]!.hp);
  });

  it('moves that do no damage themselves aren’t shots (Twins)', () => {
    const g = testGame({
      players: [
        { name: 'torikloud', colour: '#a78bfa', characterId: 'torikloud' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 800],
    });
    selectTier(g, 2);
    fire(g);
    untilAiming(g);
    expect(g.tally[0]!.shots).toEqual({});
  });

  it('a stored match from before the tally starts it at nothing, burns and all', () => {
    const g = beamed();
    const snap = takeSnapshot(g);
    delete snap.tally;
    delete snap.tallyShot;
    const burn = (snap.players as { burn: Record<string, unknown> }[])[1]!.burn;
    delete burn.by;
    delete burn.weaponId;
    applySnapshot(g, upgradeSnapshot(snap));
    expect(g.tally).toHaveLength(2);
    expect(g.tally[0]).toEqual({ shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 });
    expect(g.players[1]!.burn).toMatchObject({ by: -1, weaponId: '' });
  });
});
