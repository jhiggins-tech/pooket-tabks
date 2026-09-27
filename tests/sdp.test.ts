import { describe, expect, it } from 'vitest';
import { buildSdp, compressSdp, decodeParts, expandCode, parseSdp } from '../src/net/sdp';

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';

// Trimmed from real browser offers (Chrome with mDNS host candidates, Safari with raw IPs, Firefox).
const chrome = [
  'v=0',
  'o=- 3456789012345678901 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 51234 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.7',
  'a=candidate:1467250027 1 udp 2122260223 0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local 51234 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:1467250027 1 tcp 1518280447 0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local 9 typ host tcptype active generation 0',
  'a=candidate:842163049 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1 network-cost 10',
  'a=ice-ufrag:Xy+Z',
  'a=ice-pwd:aB3/dE6fG9hI2jK5lM8nO1pQ',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

const safariAnswer = [
  'v=0',
  'o=- 1234 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 60000 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.23',
  'a=candidate:3 1 udp 2113937151 192.168.1.23 60000 typ host generation 0',
  'a=candidate:4 1 udp 2113939711 fd00::1c2b:3a4d 60001 typ host generation 0',
  'a=candidate:5 1 udp 1677729535 198.51.100.9 60000 typ srflx raddr 192.168.1.23 rport 60000',
  'a=candidate:6 1 udp 16777215 198.51.100.200 3478 typ relay raddr 0.0.0.0 rport 0',
  'a=ice-ufrag:q9Rs',
  'a=ice-pwd:Tu7vWx8yZa1bCd2eFg3hIj4k',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\n');

describe('SDP codes', () => {
  it('pulls out just what a data channel needs', () => {
    const p = parseSdp('offer', chrome);
    expect(p.ufrag).toBe('Xy+Z');
    expect(p.pwd).toBe('aB3/dE6fG9hI2jK5lM8nO1pQ');
    expect(p.setup).toBe('actpass');
    expect(p.fingerprint).toHaveLength(32);
    // UDP only (no TCP), host first, deduplicated.
    expect(p.candidates).toEqual([
      { type: 'host', address: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local', port: 51234 },
      { type: 'srflx', address: '203.0.113.7', port: 51234 },
    ]);
  });

  it('drops relay candidates and keeps IPv6 hosts', () => {
    const p = parseSdp('answer', safariAnswer);
    expect(p.candidates.map((c) => c.type)).toEqual(['host', 'host', 'srflx']);
    expect(p.candidates[1]!.address).toBe('fd00::1c2b:3a4d');
    expect(p.setup).toBe('active');
  });

  it('is short and URL-safe', () => {
    const code = compressSdp('offer', chrome);
    expect(code.length).toBeLessThan(200);
    expect(code).toMatch(/^[A-Za-z0-9\-_.~,*:]+$/);
    expect(encodeURIComponent(code).length).toBeLessThan(code.length + 12); // barely any escaping
  });

  it('round-trips: the rebuilt SDP carries the same credentials, fingerprint, role and candidates', () => {
    for (const [kind, sdp] of [['offer', chrome], ['answer', safariAnswer]] as const) {
      const code = compressSdp(kind, sdp);
      const back = expandCode(code);
      expect(back.kind).toBe(kind);
      const again = parseSdp(kind, back.sdp);
      expect(again).toEqual(parseSdp(kind, sdp));
      expect(back.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
      expect(back.sdp).toContain(`a=fingerprint:sha-256 ${FP}`);
      expect(back.sdp.endsWith('\r\n')).toBe(true);
      expect(compressSdp(kind, buildSdp(decodeParts(code)))).toBe(code);
    }
  });

  it('rejects junk with a friendly error', () => {
    for (const bad of ['', 'hello', '1~o~a~b~c~x~', '2~o~a~b~AAAA~x~h,1.2.3.4,5']) expect(() => expandCode(bad)).toThrow(/doesn't look right/);
    expect(() => parseSdp('offer', 'v=0\r\n')).toThrow();
  });
});
