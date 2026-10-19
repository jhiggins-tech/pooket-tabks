import { bricksOf } from '../../game/bunker';
import type { Bunker, GameState } from '../../game/state';
import { weaponOf } from '../../weapons/registry';
import type { Draw } from './context';

/**
 * ShotDownBoyz's Prepper (game/bunker.ts): the dark inside of the bunker (behind the hills, so the brick
 * terrain is drawn over it), and while it goes up the soil thrown off the drill, each brick dropping into
 * place just before it lands in the terrain, and a puff of dust where it does. All read from
 * `Bunker.elapsed`, so every phone shows the same.
 */

/** How long a brick takes to drop into place (s), and how far it drops from (px). */
const DROP = 0.22;
const DROP_FROM = 9;

/** Cheap 0–1 hash of two integers, for the look of clods and dust. */
function h(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** The back wall: the inside of each bunker darkens as it closes (all but the slit). */
export function drawBunkerBacks(d: Draw, state: GameState): void {
  for (const p of state.players) {
    const b = p.bunker;
    if (!b) continue;
    const spec = weaponOf(b.weaponId, 'bunker').bunker;
    const k = ease((b.elapsed - spec.drillTime) / spec.buildTime);
    if (k <= 0) continue;
    const { ctx } = d;
    ctx.save();
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = '#3a1d16';
    const r = spec.inner + 0.5;
    for (const [a0, a1] of [[-10, b.slit - spec.slit / 2], [b.slit + spec.slit / 2, 190]] as const) {
      if (a1 - a0 < 1) continue;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, r, -rad(a0), -rad(a1), true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** The drilling and the building, while a bunker goes up. */
export function drawBunkerWork(d: Draw, state: GameState): void {
  for (const p of state.players) {
    const b = p.bunker;
    if (!b) continue;
    const spec = weaponOf(b.weaponId, 'bunker').bunker;
    if (b.elapsed >= spec.drillTime + spec.buildTime + 0.4) continue;
    drawClods(d, b, spec.drillTime, b.ground);
    drawBricks(d, b, b.elapsed - spec.drillTime);
  }
}

/** Grass and soil thrown off both sides while he drills (and landing for a moment after). */
function drawClods(d: Draw, b: Bunker, drillTime: number, ground: number): void {
  const { ctx } = d;
  for (let i = 0; i < 60; i++) {
    const born = h(i, 1) * (drillTime - 0.2);
    const age = b.elapsed - born;
    if (age < 0 || age > 0.8) continue;
    const side = h(i, 2) < 0.5 ? -1 : 1;
    const x = b.x + side * (9 + (25 + h(i, 3) * 45) * age);
    const y = ground - (45 + h(i, 4) * 50) * age + 120 * age * age;
    if (y > ground + 2 && age > 0.15) continue;
    ctx.fillStyle = h(i, 5) < 0.3 ? '#58aa40' : h(i, 6) < 0.5 ? '#92623a' : '#6e4a2c';
    const s = 1 + h(i, 7) * 1.4;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
}

/** Bricks about to land, dropping in from above and outside; dust where they just have. `t`: seconds into the build. */
function drawBricks(d: Draw, b: Bunker, t: number): void {
  if (t < -DROP) return;
  const { ctx } = d;
  for (const br of bricksOf(b)) {
    const until = br.land - t;
    const mid = rad((br.a0 + br.a1) / 2);
    if (until > 0 && until <= DROP) {
      // Still falling: a brick, its own shape, a little way out and up from its place.
      const k = until / DROP;
      const dx = Math.cos(mid) * k * DROP_FROM;
      const dy = -Math.sin(mid) * k * DROP_FROM - k * 6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 3);
      ctx.beginPath();
      const n = Math.max(2, Math.ceil((br.a1 - br.a0) / 3));
      for (let j = 0; j <= n; j++) {
        const a = rad(br.a0 + ((br.a1 - br.a0) * j) / n);
        ctx.lineTo(b.x + dx + Math.cos(a) * br.r1, b.y + dy - Math.sin(a) * br.r1);
      }
      for (let j = n; j >= 0; j--) {
        const a = rad(br.a0 + ((br.a1 - br.a0) * j) / n);
        ctx.lineTo(b.x + dx + Math.cos(a) * br.r0, b.y + dy - Math.sin(a) * br.r0);
      }
      ctx.closePath();
      ctx.fillStyle = '#b4553c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,217,189,0.85)';
      ctx.lineWidth = 0.55;
      ctx.stroke();
      ctx.restore();
    } else if (until <= 0 && until > -0.3) {
      // Just landed: a puff of dust off its outer face.
      const q = -until / 0.3;
      const r = br.r1 + 1 + q * 2;
      ctx.fillStyle = `rgba(230,220,200,${0.45 * (1 - q)})`;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(mid) * r, b.y - Math.sin(mid) * r, 1 + q * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
