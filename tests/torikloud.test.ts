import { describe, expect, it } from 'vitest';
import { MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { aimTwin, canSuckYolk, currentPlayer, explode, fire, isAimless, pendingTwinSpot, placeTwin, selectTier, setAim, targetAt, yolkTier } from '../src/game/game';
import { TANK_HALF_WIDTH } from '../src/game/constants';
import { drainToxin } from '../src/game/gunk';
import { doseTarget } from '../src/game/tanks';
import { applySnapshot, takeSnapshot, upgradeSnapshot } from '../src/net/snapshot';
import type { GameState, Projectile } from '../src/game/state';
import { DICTIONARIES } from '../src/weapons/dictionaries';
import { debate, hyperfixate, sonicBoom, tattooGun, theRizzler } from '../src/characters/kits';
import { shell } from '../src/weapons/registry';
import { applyPreview, previewOf } from '../src/net/follow';
import { hold, passTurn, testGame, untilAiming, untilNextTurn, whileFlying } from './support/game';

const players = [
  { name: 'torikloud', colour: '#a78bfa', characterId: 'torikloud' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(seed = 70): GameState {
  return testGame({ seed, players, xs: [200, 800] });
}

/** Words shown when Debate was fired. */
let lastWords: string[] = [];

/** Fire Debate and collect every letter round, in order. */
function fireDebate(g: GameState): Projectile[] {
  selectTier(g, 0);
  setAim(g, 50, 60);
  fire(g);
  lastWords = g.fx.floaters.filter((f) => f.text.startsWith('“')).map((f) => f.text.slice(1, -1));
  const seen: Projectile[] = [];
  whileFlying(g, () => g.projectiles.forEach((p) => !seen.includes(p) && seen.push(p)));
  return seen;
}

/** Give torikloud a twin at x = 450. */
function withTwin(g: GameState): void {
  selectTier(g, 2);
  fire(g);
  whileFlying(g);
  const tw = g.players[0]!.twin!;
  tw.x = 450;
  tw.y = 400;
  untilAiming(g, 3);
  passTurn(g); // kie
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

  it('the twin goes where torikloud puts it: a suggested spot (no dice rolled), or a tapped one if allowed', () => {
    const g = game(); // torikloud at 200, kie at 800
    const tori = g.players[0]!;
    expect(pendingTwinSpot(g)).toBeNull(); // not with Twins selected
    selectTier(g, 2);
    const rng = g.rng.state;
    const suggested = pendingTwinSpot(g)!;
    expect(g.rng.state).toBe(rng); // just looking doesn't touch the match's randomness
    expect(Math.abs(suggested - tori.x)).toBeGreaterThanOrEqual(TANK_HALF_WIDTH * 8);
    expect(suggested).toBeLessThan(tori.x); // away from kie, there's room
    // Not right beside an enemy, nor on a tank, nor off the edge.
    expect(placeTwin(g, 800 - TANK_HALF_WIDTH * 3)).toBe(false);
    expect(placeTwin(g, tori.x + 5)).toBe(false);
    expect(placeTwin(g, 2)).toBe(false);
    expect(pendingTwinSpot(g)).toBe(suggested);
    // Anywhere else is fine, even in front of kie.
    expect(placeTwin(g, 600)).toBe(true);
    expect(pendingTwinSpot(g)).toBe(600);
    fire(g);
    expect(tori.twin!.x).toBe(600);
    expect(tori.twinSpot).toBeNull();
    expect(pendingTwinSpot(g)).toBeNull();
  });

  it('drives too: ◀ ▶ move whichever tank is being aimed (🎯), both on the one tank of fuel', () => {
    const g = game(); // flat ground: torikloud at 200, the twin at 450, kie at 800
    withTwin(g);
    const tori = g.players[0]!;
    const twin = tori.twin!;
    const fuel = tori.fuel;
    hold(g, 1, 0.5); // the main tank
    const went = tori.x - 200;
    expect(went).toBeGreaterThan(10);
    expect(twin.x).toBe(450);
    aimTwin(g, true);
    hold(g, -1, 0.5); // now the twin, as fast
    expect(twin.x).toBeCloseTo(450 - went, 5);
    expect(tori.x).toBe(200 + went);
    expect(twin.y).toBe(g.terrain.surfaceY(twin.x)); // along the ground
    expect(tori.fuel).toBeCloseTo(fuel - 2 * went, 5);
    // The other phone sees it drive (the aim previews carry where the twin is).
    const other = game();
    withTwin(other);
    applyPreview(other, previewOf(g));
    expect([other.players[0]!.twin!.x, other.players[0]!.twin!.y]).toEqual([twin.x, twin.y]);
    // Back to the main tank.
    aimTwin(g, false);
    hold(g, 1, 0.25);
    expect(tori.x).toBeGreaterThan(200 + went);
    expect(twin.x).toBeCloseTo(450 - went, 5);
  });

  it('the twin bumps into its own main tank and enemies alike, runs out with the fuel, and stays put when pinned', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    const twin = tori.twin!;
    tori.fuel = 1000; // (plenty, for now)
    aimTwin(g, true);
    hold(g, -1, 20); // towards the main tank at 200
    expect(twin.x).toBeGreaterThanOrEqual(200 + TANK_HALF_WIDTH * 2 - 1);
    expect(twin.x).toBeLessThan(200 + TANK_HALF_WIDTH * 2 + 2);
    const kie = g.players[1]!;
    kie.x = 320;
    hold(g, 1, 20); // and back, into kie
    expect(twin.x).toBeLessThanOrEqual(320 - TANK_HALF_WIDTH * 2 + 1);
    expect(twin.x).toBeGreaterThan(320 - TANK_HALF_WIDTH * 2 - 2);
    kie.x = 800;
    tori.fuel = 100;
    const from = twin.x;
    hold(g, 1, 30); // as far as the fuel goes
    expect(twin.x - from).toBeCloseTo(100, 5);
    expect(tori.fuel).toBeCloseTo(0, 5);
    const at = twin.x;
    hold(g, 1, 1);
    expect(twin.x).toBe(at);
    // Pinned (Sew): neither tank moves.
    const h = game();
    withTwin(h);
    h.players[0]!.pinned = { active: true };
    aimTwin(h, true);
    hold(h, -1, 1);
    aimTwin(h, false);
    hold(h, 1, 1);
    expect([h.players[0]!.x, h.players[0]!.twin!.x]).toEqual([200, 450]);
  });

  it('the twin aims on its own: it starts with the main tank’s aim, then each tank keeps its own', () => {
    const g = game();
    const tori = g.players[0]!;
    setAim(g, 70, 55);
    withTwin(g);
    expect(tori.twin).toMatchObject({ angle: 70, power: 55 });
    aimTwin(g, true);
    setAim(g, 120, 30);
    expect(tori.twin).toMatchObject({ angle: 120, power: 30 });
    expect([tori.angle, tori.power]).toEqual([70, 55]);
    aimTwin(g, false);
    setAim(g, 40, 80);
    expect([tori.angle, tori.power]).toEqual([40, 80]);
    expect(tori.twin).toMatchObject({ angle: 120, power: 30 });
    // Each fires along its own aim (Debate letters, ±1° of jitter).
    selectTier(g, 0);
    fire(g);
    // Each letter's heading as it leaves the barrel.
    const fired = new Map<Projectile, number>();
    const heading = (p: Projectile) => (Math.atan2(-p.vy, p.vx) * 180) / Math.PI;
    whileFlying(g, () => g.projectiles.forEach((p) => !fired.has(p) && fired.set(p, heading(p))));
    const from = (colour: string) => [...fired].filter(([p]) => p.glyphColour === colour).map(([, h]) => h);
    const twinHeadings = from(debate.words!.twinColour);
    const mainHeadings = from(debate.words!.mainColour);
    expect(twinHeadings.length).toBeGreaterThan(0);
    expect(mainHeadings.length).toBeGreaterThan(0);
    for (const h of twinHeadings) expect(Math.abs(h - 120)).toBeLessThan(5);
    for (const h of mainHeadings) expect(Math.abs(h - 40)).toBeLessThan(5);
  });

  it('a twin that takes over from a destroyed main tank keeps its own aim', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    aimTwin(g, true);
    setAim(g, 150, 20);
    tori.hp = 5;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(tori.twin).toBeNull();
    expect([tori.x, tori.angle, tori.power]).toEqual([450, 150, 20]);
    setAim(g, 100, 50); // aiming the (only) tank again
    expect([tori.angle, tori.power]).toEqual([100, 50]);
  });

  it('the twin fires the same weapon, arguing from social work', () => {
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
    expect(targetAt(g, 450, 392)).toMatchObject({ kind: 'tank', tank: g.players[0]!.twin });
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

/** Aim both of torikloud's tanks the same way (each tank keeps its own aim), the main tank last. */
function aimBoth(g: GameState, angle: number, power: number): void {
  if (g.players[0]!.twin) {
    aimTwin(g, true);
    setAim(g, angle, power);
    aimTwin(g, false);
  }
  setAim(g, angle, power);
}

describe('Sonic Boom crossover', () => {
  /** kie placed where both tanks' arcs overlap, beyond a lone boom's range. */
  function boomAt(twin: boolean, kieX: number): number {
    const g = game(71);
    if (twin) withTwin(g);
    const kie = g.players[1]!;
    kie.x = kieX;
    kie.y = 400;
    selectTier(g, 1);
    aimBoth(g, 0, 40); // lone range: 150 + 350 * 0.4 = 290px
    fire(g);
    whileFlying(g);
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

  it('each tank booms along its own aim: the twin with its angle and power, not the main tank’s', () => {
    const g = game(71);
    withTwin(g);
    const tori = g.players[0]!;
    const kie = g.players[1]!;
    selectTier(g, 1);
    aimTwin(g, true);
    setAim(g, 180, 100); // the twin booms back towards the left edge, at full range
    aimTwin(g, false);
    setAim(g, 0, 20); // the main tank booms right, short
    fire(g);
    const spec = sonicBoom.sonic!;
    const [main, twin] = g.booms;
    expect(g.booms).toHaveLength(2);
    expect(main!.angle).toBeCloseTo(0);
    expect(main!.range).toBeCloseTo(spec.minRange + (spec.maxRange - spec.minRange) * 0.2);
    expect(twin!.angle).toBeCloseTo(Math.PI);
    expect(twin!.range).toBeCloseTo(spec.maxRange);
    expect(twin!.x).toBeLessThan(tori.twin!.x); // out of the twin's own barrel, pointing left
    // kie, right of the twin and beyond the main tank's short range, is out of both arcs: unharmed.
    kie.x = 700;
    kie.y = 400;
    whileFlying(g);
    expect(kie.hp).toBe(MAX_HP);
  });

  it('the twin’s boom reaches an enemy along the twin’s aim, wherever the main tank points', () => {
    const g = game(71);
    withTwin(g);
    const kie = g.players[1]!;
    kie.x = 650; // 200px right of the twin, 450px right of the main tank (beyond its reach)
    kie.y = 400;
    selectTier(g, 1);
    aimTwin(g, true);
    setAim(g, 0, 40);
    aimTwin(g, false);
    setAim(g, 180, 40); // the main tank booms away from kie
    fire(g);
    whileFlying(g);
    expect(kie.hp).toBeLessThan(MAX_HP);
  });

  it('the overlapping stretches of the waves are shown phasing', async () => {
    const g = game(72);
    withTwin(g);
    selectTier(g, 1);
    aimBoth(g, 0, 60);
    fire(g);
    const { boomPhaseArcs } = await import('../src/game/game');
    let seen = 0;
    whileFlying(g, () => (seen += boomPhaseArcs(g).length));
    expect(seen).toBeGreaterThan(0);
    expect(sonicBoom.sonic!.waves).toBe(4);
  });
});

describe("torikloud's health, and statuses on the twin", () => {
  /** torikloud (with a twin at x = 450) against kcaj, kcaj to play. */
  function versusKcaj(): GameState {
    const g = testGame({
      seed: 70,
      players: [players[0]!, { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' }],
      xs: [200, 800],
    });
    withTwin(g);
    passTurn(g); // torikloud
    expect(currentPlayer(g).name).toBe('kcaj');
    return g;
  }

  it('starts with 150 health (two tanks are two targets); Twins splits it 75 / 75', () => {
    const g = game();
    const [tori, kie] = g.players as [GameState['players'][0], GameState['players'][0]];
    expect(tori.hp).toBe(150);
    expect(tori.maxHp).toBe(150);
    expect(kie.hp).toBe(MAX_HP);
    selectTier(g, 2);
    fire(g);
    expect([tori.hp, tori.twin!.hp]).toEqual([75, 75]);
  });

  it('a Hyperfixate beam into the twin sets the twin burning, and it burns as the next turn comes up', () => {
    const g = versusKcaj();
    const [tori, kcaj] = g.players as [GameState['players'][0], GameState['players'][0]];
    const tw = tori.twin!;
    tw.x = kcaj.x - 150; // level with kcaj, in the line of fire
    tw.y = kcaj.y;
    tori.x = 20;
    selectTier(g, 1);
    setAim(g, 180, 50);
    fire(g);
    expect(g.beams[0]!.hitTank).toBe(true);
    expect(tw.hp).toBe(75 - hyperfixate.damage);
    expect(tw.burn).toMatchObject({ damagePerTurn: hyperfixate.dot!.damagePerTurn, turnsLeft: hyperfixate.dot!.turns });
    expect(tori.burn).toBeNull();
    const main = tori.hp;
    untilNextTurn(g); // torikloud's turn comes up: the twin burns, not the main tank
    expect(currentPlayer(g)).toBe(tori);
    expect(tw.hp).toBe(75 - hyperfixate.damage - hyperfixate.dot!.damagePerTurn);
    expect(tori.hp).toBe(main);
    expect(tw.burn!.turnsLeft).toBe(hyperfixate.dot!.turns - 1);
  });

  it("a burning twin that takes over from a destroyed main tank keeps burning; the main tank's burn goes with it", () => {
    const g = versusKcaj();
    const tori = g.players[0]!;
    tori.burn = { damagePerTurn: 4, turnsLeft: 2, colour: '#f00', by: -1, weaponId: '' };
    tori.twin!.burn = { damagePerTurn: 9, turnsLeft: 3, colour: '#0f0', by: -1, weaponId: '' };
    tori.hp = 5;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(tori.twin).toBeNull();
    expect(tori.burn).toMatchObject({ damagePerTurn: 9, turnsLeft: 3 });
  });

  it('hits on the twin cook and tattoo torikloud (all of him), shown on the twin', () => {
    const g = versusKcaj();
    const tori = g.players[0]!;
    const tw = tori.twin!;
    explode(g, tw.x, tw.y - TANK_BODY_HEIGHT, theRizzler, 1);
    expect(tori.cooked).toMatchObject({ active: false });
    const cooked = g.fx.floaters.find((f) => f.text === 'COOKED')!;
    expect(Math.abs(cooked.x - tw.x)).toBeLessThan(20);
    explode(g, tw.x, tw.y - TANK_BODY_HEIGHT, tattooGun, 1);
    expect(tori.tattoo).not.toBeNull();
    // Tattooed: the main tank takes the extra damage too.
    const before = tori.hp;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(before - tori.hp).toBe(Math.round(shell.damage * tattooGun.tattoo!.multiplier));
  });

  it("gunk on the twin drains as toxin, like on the main tank, and stops the turn until it's drained", () => {
    const g = versusKcaj();
    const tw = g.players[0]!.twin!;
    const target = targetAt(g, tw.x, tw.y - TANK_BODY_HEIGHT)!;
    doseTarget(target, 6, 3, '#9be22d');
    expect(tw.toxin).toBe(6);
    expect(tw.hp).toBe(75);
    drainToxin(g, 1);
    expect(tw.toxin).toBeCloseTo(3);
    expect(tw.soak).toBeCloseTo(3);
  });

  it("a twin taking over from a destroyed main tank brings its own soak, toxin and burn; the main tank's go with it", () => {
    const g = versusKcaj();
    const tori = g.players[0]!;
    Object.assign(tori, { soak: 5, toxin: 4, burn: { damagePerTurn: 4, turnsLeft: 2, colour: '#f00' } });
    Object.assign(tori.twin!, { soak: 1, toxin: 2, toxinRate: 7 });
    tori.hp = 5;
    explode(g, tori.x, tori.y - TANK_BODY_HEIGHT, shell, 1);
    expect(tori.twin).toBeNull();
    expect(tori).toMatchObject({ x: 450, soak: 1, toxin: 2, toxinRate: 7, burn: null });
  });

  it('a stored match from before twins aimed on their own carries on (the twin takes the main tank’s aim)', () => {
    const g = versusKcaj();
    const tori = g.players[0]!;
    const snap = takeSnapshot(g);
    const p0 = (snap.players as Record<string, unknown>[])[0]!;
    const twin = p0.twin as Record<string, unknown>;
    delete twin.angle;
    delete twin.power;
    delete p0.aimTwin;
    delete p0.twinSpot;
    applySnapshot(g, upgradeSnapshot(snap));
    expect(tori.twin).toMatchObject({ angle: tori.angle, power: tori.power });
    expect([tori.aimTwin, tori.twinSpot]).toEqual([false, null]);
  });

  it('a stored match from before twins had toxin carries on (its snapshot is filled in)', () => {
    const g = versusKcaj();
    const snap = takeSnapshot(g);
    const twin = (snap.players as { twin: Record<string, unknown> }[])[0]!.twin;
    delete twin.toxin;
    delete twin.toxinRate;
    applySnapshot(g, upgradeSnapshot(snap));
    expect(g.players[0]!.twin).toMatchObject({ toxin: 0, toxinRate: 0 });
  });
});

describe('Yolk Sucker (the spent Twins slot)', () => {
  it('is only there once Twins has been fired, while the twin stands', () => {
    const g = game();
    const tori = g.players[0]!;
    expect(yolkTier(tori)).toBe(-1); // Twins still loaded
    withTwin(g);
    expect(yolkTier(tori)).toBe(2);
    expect(g.players[1]!.loadout.length && yolkTier(g.players[1]!)).toBe(-1); // nobody else
    tori.twin = null; // (the twin destroyed)
    expect(yolkTier(tori)).toBe(-1);
    expect(selectTier(g, 2)).toBe(false);
  });

  it('greyed out while the health is even (or one apart): nothing to select, nothing to fire', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    expect(tori.hp).toBe(tori.twin!.hp); // 75 / 75 from the split
    expect(canSuckYolk(tori)).toBe(false);
    expect(selectTier(g, 2)).toBe(false);
    tori.hp = 48;
    tori.twin!.hp = 47;
    expect(canSuckYolk(tori)).toBe(false);
    tori.selectedTier = 2; // even if it were somehow selected
    expect(fire(g)).toBe(false);
    expect(tori.hp + tori.twin!.hp).toBe(95);
  });

  it('pools the health and shares it out like Twins, as a bonus move: same turn, aim and fire after', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    tori.hp = 70;
    tori.twin!.hp = 25;
    const { turn, current } = g;
    const ammo = [...tori.ammo];
    expect(selectTier(g, 2)).toBe(true);
    expect(isAimless(g)).toBe(true);
    expect(fire(g)).toBe(true);
    expect([tori.hp, tori.twin!.hp]).toEqual([48, 47]); // odd pool: the twin gets the half rounded down
    expect(g.phase).toBe('aiming');
    expect([g.turn, g.current]).toEqual([turn, current]);
    expect(tori.ammo).toEqual(ammo); // no rounds spent
    expect(tori.selectedTier).toBe(0); // back on a weapon with rounds
    expect(g.sfx.some((e) => e.cue === 'yolk')).toBe(true);
    expect(g.fx.floaters.map((f) => f.text)).toEqual(expect.arrayContaining(['-22', '+22', 'YOLK SUCKED 🥚']));
    expect(g.fx.splashes.length).toBeGreaterThan(0);
    // Even now: greyed out until the health drifts apart again.
    expect(canSuckYolk(tori)).toBe(false);
    // The turn goes on as usual.
    fireDebate(g);
    untilNextTurn(g);
    expect(g.turn).toBe(turn + 1);
  });

  it('works the other way round too, and again on a later turn', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    tori.hp = 10;
    tori.twin!.hp = 60;
    selectTier(g, 2);
    fire(g);
    expect([tori.hp, tori.twin!.hp]).toEqual([35, 35]);
    fireDebate(g);
    untilNextTurn(g);
    passTurn(g); // kie
    expect(currentPlayer(g)).toBe(tori);
    tori.twin!.hp = 20;
    expect(selectTier(g, 2)).toBe(true);
    fire(g);
    expect([tori.hp, tori.twin!.hp]).toEqual([28, 27]);
  });

  it('leaves statuses on the tank they’re on', () => {
    const g = game();
    withTwin(g);
    const tori = g.players[0]!;
    tori.twin!.burn = { damagePerTurn: 4, turnsLeft: 2, colour: '#ff6a00', ownerId: 1 } as never;
    tori.hp = 60;
    tori.twin!.hp = 20;
    selectTier(g, 2);
    fire(g);
    expect(tori.twin!.burn).toBeTruthy();
    expect(tori.burn ?? null).toBeNull();
  });

  it('online, the other phone replays it from the same state and agrees', () => {
    const a = game();
    withTwin(a);
    const tori = a.players[0]!;
    tori.hp = 64;
    tori.twin!.hp = 11;
    selectTier(a, 2);
    const before = takeSnapshot(a);
    expect(fire(a)).toBe(true);
    const b = game();
    applySnapshot(b, upgradeSnapshot(JSON.parse(JSON.stringify(before))));
    expect(fire(b)).toBe(true);
    expect([b.players[0]!.hp, b.players[0]!.twin!.hp]).toEqual([tori.hp, tori.twin!.hp]);
    expect(b.players[0]!.selectedTier).toBe(tori.selectedTier);
  });
});
