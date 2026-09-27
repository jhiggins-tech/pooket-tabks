/**
 * The wire format for messages between phones: JSON, plus the numbers plain JSON can't carry
 * (Infinity, -Infinity, NaN), which the game state does use.
 */
export function encodeMsg(msg: unknown): string {
  return JSON.stringify(msg, (_, v: unknown) => {
    if (typeof v !== 'number' || Number.isFinite(v)) return v;
    return Number.isNaN(v) ? '~nan' : v > 0 ? '~inf' : '~-inf';
  });
}

export function decodeMsg(text: string): unknown {
  return JSON.parse(text, (_, v: unknown) => (v === '~inf' ? Infinity : v === '~-inf' ? -Infinity : v === '~nan' ? NaN : v));
}
