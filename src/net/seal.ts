/**
 * The game server's database is open to anyone with its address, so everything we put there is sealed
 * with AES-GCM under a key derived from a shared secret (the room code, or the Wi-Fi's public address),
 * at a path that's a hash of it: without the secret you can't find the messages, let alone read them. (A 4-letter room code
 * won't stop a determined attacker; it's to keep casual eyes out of a game lobby, not a bank.)
 */

const enc = new TextEncoder();

export interface Sealer {
  /** Hex topic segment derived from the secret. */
  topic: string;
  key: CryptoKey;
}

export async function sealerFor(purpose: string, secret: string): Promise<Sealer> {
  const subtle = globalThis.crypto.subtle;
  const t = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`pooket-tabks/topic/${purpose}/${secret}`)));
  const k = await subtle.digest('SHA-256', enc.encode(`pooket-tabks/key/${purpose}/${secret}`));
  const key = await subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic: [...t.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(''), key };
}

export async function seal(s: Sealer, msg: unknown): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, s.key, enc.encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

/** The message, or null if it isn't ours (wrong key, tampered, junk). */
export async function unseal(s: Sealer, bytes: Uint8Array): Promise<unknown> {
  if (bytes.length < 13) return null;
  try {
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, s.key, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
