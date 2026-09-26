import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { createGame, currentPlayer, explode, fire, isAimless, selectTier, setAim, step, targetAt } from '../src/game/game';
import type { GameState, Projectile } from '../src/game/state';
import { DICTIONARIES } from '../src/weapons/dictionaries';
import { debate, shell, sonicBoom } from '../src/weapons/registry';

const players = [
  { name: 'torikloud', colour: '#a78bfa', characterId: 'torikloud' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(seed = 70): GameState {
  const g = createGame({ seed, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  g.players[0]!.x = 200;
  g.players[1]!.x = 800;
  for (const p of g.players) p.y = 400;
  return g;
}

function resolve(g: GameState, onTick?: () => void): void {
  for (let t = 0; t < 20 && g.phase === 'flying'; t += FIXED_DT) {
    step(g, FIXED_DT);
    onTick?.();
  }
}

function pass(g: GameState): void {
  g.phase = 'settling';
  g.settleTimer = 0;
  step(g, FIXED_DT);
}

/** Words shown when Debate was fired. */
let lastWords: string[] = [];

/** Fire Debate and collect every letter round, in order. */
function fireDebate(g: GameState): Projectile[] {
  selectTier(g, 0);
  setAim(g, 50, 60);
  fire(g);
  lastWords = g.floaters.filter((f) => f.text.startsWith('“')).map((f) => f.text.slice(1, -1));
  const seen: Projectile[] = [];
  resolve(g, () => g.projectiles.forEach((p) => !seen.includes(p) && seen.push(p)));
  return seen;
}

/** Give torikloud a twin at x = 450. */
function withTwin(g: GameState): void {
  selectTier(g, 2);
  fire(g);
  resolve(g);
  const tw = g.players[0]!.twin!;
  tw.x = 450;
  tw.y = 400;
  for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
  pass(g); // kie
  expect(currentPlayer(g).name).toBe('torikloud');
}

describe('dictionaries', () => {
  it('legal and social work words, all plain letters, in a spread of lengths', () => {
    for (const list of Object.values(DICTIONARIES)) {
      expect(list.length).toBeGreaterThan(30);
      for (const w of list) expect(w).toMatch(/^[a-z]+$/);
      const lengths = list.map((w) => w.length);
      expect(Math.min(...lengths)).toBeLessThanOrEqual(4);
      expect(Math.max(...lengths)).toBeGreaterThanOrEqual(11);
    }
  });
});

describe('Debate', () => {
  it("is torikloud's tier 1", () => {
    expect(game().players[0]!.loadout).toEqual(['debate', 'sonic-boom', 'twins']);
  });

  it('fires a random legal word one letter at a time, and shows the word', () => {
    const g = game();
    const letters = fireDebate(g);
    const word = letters.map((p) => p.glyph).join('');
    expect(DICTIONARIES.legal).toContain(word);
    expect(lastWords).toEqual([word]);
    expect(g.players[0]!.ammo[0]).toBe(4);
  });

  it('different draws give different words, and longer words throw more letters', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) counts.add(fireDebate(game(seed)).length);
    expect(counts.size).toBeGreaterThan(3);
  });

  it('each letter is a small blast, so more letters on target means more damage', () => {
    const g = game();
    const kie = g.players[1]!;
    selectTier(g, 0);
    fire(g);
    g.bursts = [];
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, debate, 0);
    expect(MAX_HP - kie.hp).toBe(debate.damage);
  });
});

describe('Twins', () => {
  it('needs no aiming; a second tank appears and the health is split between them', () => {
    const g = game();
    const tori = g.players[0]!;
    tori.hp = 81;
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
    fire(g);
    expect(tori.twin).not.toBeNull();
    expect(tori.hp + tori.twin!.hp).toBe(81);
    expect(Math.abs(tori.hp - tori.twin!.hp)).toBeLessThanOrEqual(1);
    expect(Math.abs(tori.twin!.x - tori.x)).toBeGreaterThanOrEqual(70);
    expect(tori.twin!.y).toBe(g.terrain.surfaceY(tori.twin!.x));
  });

  it('the twin fires the same weapon with the same aim and power, arguing from social work', () => {
    const g = game();
    withTwin(g);
    const letters = fireDebate(g);
    // Two words were argued: one legal (main tank), one social work (twin).
    expect(lastWords).toHaveLength(2);
    expect(DICTIONARIES.legal).toContain(lastWords[0]);
    expect(DICTIONARIES['social-work']).toContain(lastWords[1]);
    expect(letters.length).toBe(lastWords[0]!.length + lastWords[1]!.length);
    // The twin's letters come out of its own barrel, on the same heading.
    const twinLetters = letters.filter((p) => p.glyphColour === debate.words!.twinColour);
    expect(twinLetters.map((p) => p.glyph).join('')).toBe(lastWords[1]);
    expect(g.players[0]!.ammo[0]).toBe(4); // one round of ammo for both
  });

  it('each tank has its own health: hits on the twin come off its bar', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    const main = tori.hp;
    const twinHp = tori.twin!.hp;
    expect(targetAt(g, 450, 392)?.kind).toBe('twin');
    explode(g, 450, 392, shell, 1);
    expect(tori.hp).toBe(main);
    expect(tori.twin?.hp ?? 0).toBeLessThan(twinHp);
  });

  it('losing one tank leaves the other fighting; losing both loses the game', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    // Main tank destroyed: the twin carries on as torikloud.
    tori.hp = 5;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(tori.alive).toBe(true);
    expect(tori.twin).toBeNull();
    expect(tori.x).toBe(450);
    // Then that one too.
    tori.hp = 5;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(tori.alive).toBe(false);
  });
});

describe('Sonic Boom crossover', () => {
  /** kie placed where both tanks' arcs overlap, beyond a lone boom's range. */
  function boomAt(twin: boolean, kieX: number): number {
    const g = game(71);
    if (twin) withTwin(g);
    const kie = g.players[1]!;
    kie.x = kieX;
    kie.y = 400;
    selectTier(g, 1);
    setAim(g, 0, 40); // lone range: 150 + 350 * 0.4 = 290px
    fire(g);
    resolve(g);
    return MAX_HP - kie.hp;
  }

  it('where the twins’ waves cross they phase: focused damage', () => {
    const lone = boomAt(false, 470);
    const pair = boomAt(true, 470);
    // Both booms reach, and the overlap hits harder than two plain booms would.
    expect(pair).toBeGreaterThan(lone * 2);
  });

  it('…and extra range beyond a single boom', () => {
    const range = 150 + (350 * 40) / 100;
    expect(boomAt(false, 200 + range + 60)).toBe(0);
    expect(boomAt(true, 200 + range + 60)).toBeGreaterThan(0);
  });

  it('the overlapping stretches of the waves are shown phasing', async () => {
    const g = game(72);
    withTwin(g);
    selectTier(g, 1);
    setAim(g, 0, 60);
    fire(g);
    const { boomPhaseArcs } = await import('../src/game/game');
    let seen = 0;
    resolve(g, () => (seen += boomPhaseArcs(g).length));
    expect(seen).toBeGreaterThan(0);
    expect(sonicBoom.sonic!.waves).toBe(4);
  });
});
