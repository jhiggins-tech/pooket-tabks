import { maskAddress, netLog } from './log';

/** Free public STUN: it tells a phone its network's public address. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * This network's public address, as STUN sees it (phones on the same Wi-Fi usually share one), used
 * to find games on the same Wi-Fi. Null if STUN can't be reached in time.
 */
export async function publicAddress(timeoutMs = 3000): Promise<string | null> {
  const found = await probePublicAddress(timeoutMs);
  netLog(`wifi: public address ${found ? maskAddress(found) : 'unknown (no STUN reply)'}`);
  return found;
}

async function probePublicAddress(timeoutMs: number): Promise<string | null> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  try {
    pc.createDataChannel('probe');
    return await new Promise<string | null>((resolve) => {
      let v6: string | null = null;
      const timer = setTimeout(() => resolve(v6), timeoutMs);
      pc.addEventListener('icecandidate', (e) => {
        const c = e.candidate?.candidate;
        if (!c) {
          clearTimeout(timer);
          resolve(v6);
          return;
        }
        const f = c.split(' ');
        if (f[7] !== 'srflx') return;
        const ip = f[4]!;
        if (ip.includes(':')) v6 ??= ip.split(':').slice(0, 4).join(':'); // an IPv6 /64 is the network
        else {
          clearTimeout(timer);
          resolve(ip); // IPv4 preferred: the whole Wi-Fi shares it
        }
      });
      void pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
}
