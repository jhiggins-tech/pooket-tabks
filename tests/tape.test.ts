import { describe, expect, it } from 'vitest';
import { MatchTape } from '../src/app/tape';
import { FIXED_DT } from '../src/game/constants';
import { concede, createGame, fire, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { ReplayPlayer } from '../src/net/replay';
import { untilNextTurn } from './support/game';

const players: PlayerConfig[] = [
  { name: 'A', characterId: 'tones', colour: '#f00' },
  { name: 'B', characterId: 'kcaj', colour: '#00f' },
];

/** Play a short hotseat match on the tape: a few shots, then B resigns. */
function played(tape: MatchTape): GameState {
  const g = createGame({ seed: 77, players });
  tape.start(77, players);
  for (const [angle, power] of [[55, 70], [120, 65], [50, 75]] as const) {
    setAim(g, angle, power);
    const shot = tape.firing(g);
    expect(fire(g)).toBe(true);
    tape.shot(shot);
    untilNextTurn(g);
  }
  concede(g, 1, 'resigned');
  tape.end(g);
  return g;
}

describe('watching the match just played (MatchTape)', () => {
  it('records each shot and the end, and plays back to the same result', () => {
    const tape = new MatchTape();
    const g = played(tape);
    const replay = tape.replay!;
    expect(replay.shots.map((s) => [s.turn, s.owner])).toEqual([[1, 0], [2, 1], [3, 0]]);
    expect(replay.listing.over).toEqual({ winner: 0, endReason: 'resigned', turns: g.turn });

    const player = new ReplayPlayer(replay);
    player.onStart = (seed, p) => createGame({ seed, players: p });
    let flights = 0;
    let after: number[] = [];
    let was = '';
    for (let t = 0; t < 200 && !player.finished; t += FIXED_DT) {
      if (player.game) step(player.game, FIXED_DT);
      player.tick(FIXED_DT);
      const now = player.game?.phase ?? '';
      if (now === 'flying' && was !== 'flying') flights++;
      if (now === 'aiming' && was !== 'aiming') after = player.game!.players.map((p) => p.hp);
      was = now;
    }
    expect(player.finished).toBe(true);
    expect(flights).toBe(3);
    // Each shot played out just as it did: after the last one, everyone's health is as it was.
    expect(after).toEqual(g.players.map((p) => p.hp));
    expect(player.game!.winner?.name).toBe('A');
  });

  it("has nothing to show until the match is over, or if nothing was fired; a new match starts afresh", () => {
    const tape = new MatchTape();
    expect(tape.replay).toBeNull();
    const g = createGame({ seed: 5, players });
    tape.start(5, players);
    tape.shot(tape.firing(g)); // fired, but not over
    expect(tape.replay).toBeNull();
    concede(g, 0, 'resigned');
    tape.end(g);
    expect(tape.replay?.shots).toHaveLength(1);
    // The same shot again (played out from the record after a rejoin) replaces it.
    tape.start(5, players);
    const again = createGame({ seed: 5, players });
    tape.shot(tape.firing(again));
    tape.shot(tape.firing(again));
    concede(again, 0, 'resigned');
    tape.end(again);
    expect(tape.replay?.shots).toHaveLength(1);
    tape.clear();
    expect(tape.replay).toBeNull();
  });
});
