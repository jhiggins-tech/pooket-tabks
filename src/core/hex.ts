/**
 * Bytes as lowercase hex, and SHA-256 in hex: the ids and keys the database goes by (room topics, push
 * subscriptions, stats keys and fingerprints, seat and replay ids). Pinned by tests/hashes.test.ts.
 * Import-free, so Node runs it as is too (the stats sender, through stats/summary.ts).
 */

/** Two lowercase hex digits a byte. */
export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of `text` (UTF-8), all 64 hex digits. A key that keeps only the first n bytes slices it to 2n digits. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
