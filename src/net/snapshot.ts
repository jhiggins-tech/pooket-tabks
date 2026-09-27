import type { Terrain } from '../core/terrain';
import type { GameState } from '../game/state';
import { fromB64, toB64 } from './b64';
import { decodeMsg, encodeMsg } from './wire';

/**
 * Network snapshots: the whole game state except the terrain (sent separately as a compact solid
 * mask) and local-only cosmetics (sound cues, playing tunes). Plain JSON-safe data.
 */
export type Snapshot = Record<string, unknown> & { rng: number; winner: number | null; turn: number };

const LOCAL_ONLY = new Set(['terrain', 'sfx', 'tunes', 'rng', 'winner']);

export function takeSnapshot(state: GameState): Snapshot {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (!LOCAL_ONLY.has(k)) out[k] = v;
  out.rng = state.rng.state;
  out.winner = state.winner ? state.winner.id : null;
  // A deep copy in wire format (keeps Infinity/NaN, which plain JSON would turn into null).
  return decodeMsg(encodeMsg(out)) as Snapshot;
}

/** Overwrite `state` with a snapshot (terrain and local cosmetics are left alone). */
export function applySnapshot(state: GameState, snap: Snapshot): void {
  const copy = decodeMsg(encodeMsg(snap)) as Snapshot;
  for (const [k, v] of Object.entries(copy)) {
    if (LOCAL_ONLY.has(k)) continue;
    (state as unknown as Record<string, unknown>)[k] = v;
  }
  state.rng.state = copy.rng;
  state.winner = copy.winner === null ? null : (state.players[copy.winner] ?? null);
}

/** The terrain's solid mask, run-length encoded (row by row, alternating empty/solid runs) as base64url. */
export function encodeSolid(t: Terrain): string {
  const bytes: number[] = [];
  const push = (n: number) => {
    // LEB128 varint.
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
  };
  let cur = 0;
  let run = 0;
  for (const v of t.solid) {
    if (v === cur) run++;
    else {
      push(run);
      cur = v;
      run = 1;
    }
  }
  push(run);
  return toB64(Uint8Array.from(bytes));
}

export function decodeSolid(code: string, size: number): Uint8Array {
  const bytes = fromB64(code);
  const mask = new Uint8Array(size);
  let i = 0;
  let cur = 0;
  let p = 0;
  while (p < bytes.length && i < size) {
    let n = 0;
    let shift = 0;
    let b: number;
    do {
      b = bytes[p++]!;
      n |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (cur) mask.fill(1, i, Math.min(size, i + n));
    i += n;
    cur ^= 1;
  }
  return mask;
}
