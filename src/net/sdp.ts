/**
 * Squeeze a WebRTC offer/answer (a kilobyte or two of SDP) into a short, URL-safe code, and rebuild a
 * minimal data-channel SDP from it. Only what a data channel needs survives: ICE credentials, the DTLS
 * fingerprint and role, and a few UDP candidates (host / server-reflexive). Pure string code, no DOM.
 *
 * Code format (fields joined by `~`): `1~{o|a}~ufrag~pwd~fingerprint~setup~candidates`, where the
 * fingerprint is base64url, setup is `x` (actpass) / `c` (active) / `p` (passive), and candidates are
 * `h,addr,port` or `s,addr,port` joined by `*`.
 */

export type SdpKind = 'offer' | 'answer';

export interface SdpParts {
  kind: SdpKind;
  ufrag: string;
  pwd: string;
  /** SHA-256 fingerprint bytes. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  candidates: { type: 'host' | 'srflx'; address: string; port: number }[];
}

const MAX_CANDIDATES = 4;
const SETUP_CODES = { actpass: 'x', active: 'c', passive: 'p' } as const;

export function parseSdp(kind: SdpKind, sdp: string): SdpParts {
  const lines = sdp.split(/\r?\n/);
  const attr = (name: string) => lines.find((l) => l.startsWith(`a=${name}:`))?.slice(name.length + 3).trim();
  const ufrag = attr('ice-ufrag');
  const pwd = attr('ice-pwd');
  const fp = lines.find((l) => /^a=fingerprint:sha-256 /i.test(l));
  const setup = attr('setup') as SdpParts['setup'] | undefined;
  if (!ufrag || !pwd || !fp || !setup || !(setup in SETUP_CODES)) throw new Error('Not a usable WebRTC description');
  const hex = fp.split(' ')[1]!.split(':');
  const fingerprint = Uint8Array.from(hex, (h) => parseInt(h, 16));
  const candidates: SdpParts['candidates'] = [];
  for (const l of lines) {
    if (!l.startsWith('a=candidate:')) continue;
    // a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
    const f = l.slice('a=candidate:'.length).split(' ');
    const [, component, transport, , address, port, , type] = f;
    if (component !== '1' || transport?.toLowerCase() !== 'udp') continue;
    if (type !== 'host' && type !== 'srflx') continue;
    if (!address || !port || candidates.some((c) => c.address === address && c.port === +port)) continue;
    candidates.push({ type, address, port: +port });
  }
  // Host candidates first (same Wi-Fi is the main case), then the rest.
  candidates.sort((a, b) => (a.type === b.type ? 0 : a.type === 'host' ? -1 : 1));
  return { kind, ufrag, pwd, fingerprint, setup, candidates: candidates.slice(0, MAX_CANDIDATES) };
}

export function encodeParts(p: SdpParts): string {
  const cands = p.candidates.map((c) => `${c.type === 'host' ? 'h' : 's'},${c.address},${c.port}`).join('*');
  return ['1', p.kind === 'offer' ? 'o' : 'a', iceEscape(p.ufrag), iceEscape(p.pwd), toBase64Url(p.fingerprint), SETUP_CODES[p.setup], cands].join('~');
}

export function decodeParts(code: string): SdpParts {
  const f = code.trim().split('~');
  if (f.length !== 7 || f[0] !== '1' || (f[1] !== 'o' && f[1] !== 'a')) throw new Error("That code doesn't look right");
  const setup = (Object.keys(SETUP_CODES) as SdpParts['setup'][]).find((k) => SETUP_CODES[k] === f[5]);
  if (!setup) throw new Error("That code doesn't look right");
  const candidates = f[6]
    ? f[6].split('*').map((c) => {
        const parts = c.split(',');
        const port = Number(parts[2]);
        if (parts.length !== 3 || !parts[1] || !Number.isInteger(port)) throw new Error("That code doesn't look right");
        return { type: parts[0] === 'h' ? ('host' as const) : ('srflx' as const), address: parts[1], port };
      })
    : [];
  const fingerprint = fromBase64Url(f[4]!);
  if (fingerprint.length !== 32) throw new Error("That code doesn't look right");
  return { kind: f[1] === 'o' ? 'offer' : 'answer', ufrag: iceUnescape(f[2]!), pwd: iceUnescape(f[3]!), fingerprint, setup, candidates };
}

/** Rebuild a minimal SDP for a single data channel. */
export function buildSdp(p: SdpParts): string {
  const fp = [...p.fingerprint].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const cands = p.candidates.map((c, i) =>
    c.type === 'host'
      ? `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.address} ${c.port} typ host`
      : `a=candidate:${i + 1} 1 udp ${1686052607 - i} ${c.address} ${c.port} typ srflx raddr 0.0.0.0 rport 0`,
  );
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...cands,
    'a=end-of-candidates',
    `a=ice-ufrag:${p.ufrag}`,
    `a=ice-pwd:${p.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${p.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}

export function compressSdp(kind: SdpKind, sdp: string): string {
  return encodeParts(parseSdp(kind, sdp));
}

export function expandCode(code: string): { kind: SdpKind; sdp: string } {
  const p = decodeParts(code);
  return { kind: p.kind, sdp: buildSdp(p) };
}

// ICE credentials use [A-Za-z0-9+/]; swap to URL-safe characters that ICE never uses.
function iceEscape(s: string): string {
  return s.replace(/\+/g, '-').replace(/\//g, '_');
}
function iceUnescape(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("That code doesn't look right");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}
