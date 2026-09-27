/**
 * Codes travel as links (`…/pooket-tabks/#join=CODE` and `#answer=CODE`) so a phone's own camera app
 * can scan them. A reply link opened that way lands in a new tab; it hands the code to the game tab
 * that's waiting for it via localStorage and a BroadcastChannel (same origin, same browser).
 */

const RELAY_KEY = 'pooket-tabks.net.answer';
const CHANNEL = 'pooket-tabks.net';

export function gameUrl(): string {
  return location.origin + location.pathname;
}

export function joinLink(code: string): string {
  return `${gameUrl()}#join=${code}`;
}

/** A room link: opening it joins that room (one trip, no reply needed). */
export function roomLink(code: string): string {
  return `${gameUrl()}#room=${code}`;
}

export function answerLink(code: string): string {
  return `${gameUrl()}#answer=${code}`;
}

/** Pull a code out of a pasted/scanned link or bare code. */
export function extractCode(text: string): { kind: 'join' | 'answer' | 'room' | 'bare'; code: string } {
  const t = text.trim();
  const m = /#(join|answer|room)=([^\s#]+)/.exec(t);
  if (m) return { kind: m[1] as 'join' | 'answer' | 'room', code: decodeURIComponent(m[2]!) };
  return { kind: 'bare', code: t };
}

/** A code this page was opened with (`#join=` / `#answer=` / `#room=`), removed from the address bar. */
export function takeHashCode(): { kind: 'join' | 'answer' | 'room'; code: string } | null {
  const found = extractCode(location.hash);
  if (found.kind === 'bare') return null;
  history.replaceState(null, '', location.pathname + location.search); // drop just the code
  return { kind: found.kind, code: found.code };
}

/** In a tab the camera app opened: pass the reply code to the waiting game tab. */
export function relayAnswer(code: string): void {
  try {
    localStorage.setItem(RELAY_KEY, JSON.stringify({ code, t: Date.now() }));
  } catch {
    /* storage unavailable */
  }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ answer: code });
    ch.close();
  } catch {
    /* not supported */
  }
}

/** In the host's game tab: listen for a relayed reply code. Returns a function that stops listening. */
export function listenForAnswer(onCode: (code: string) => void): () => void {
  let done = false;
  const deliver = (code: string) => {
    if (done) return;
    done = true;
    stop();
    onCode(code);
  };
  const check = () => {
    try {
      const raw = localStorage.getItem(RELAY_KEY);
      if (!raw) return;
      const { code, t } = JSON.parse(raw) as { code: string; t: number };
      if (Date.now() - t > 10 * 60_000) return; // stale
      localStorage.removeItem(RELAY_KEY);
      deliver(code);
    } catch {
      /* ignore */
    }
  };
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const code = (e.data as { answer?: string }).answer;
      if (code) {
        try {
          localStorage.removeItem(RELAY_KEY);
        } catch {
          /* ignore */
        }
        deliver(code);
      }
    };
  } catch {
    /* not supported */
  }
  // iOS may pause this tab while the camera app is up: check again whenever it comes back.
  const onVisible = () => document.visibilityState === 'visible' && check();
  window.addEventListener('storage', check);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, 1000);
  function stop(): void {
    ch?.close();
    window.removeEventListener('storage', check);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  }
  try {
    localStorage.removeItem(RELAY_KEY); // anything already there is from an old attempt
  } catch {
    /* ignore */
  }
  return () => {
    done = true;
    stop();
  };
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Can this browser read QR codes from the camera itself (Android Chrome can; iOS Safari can't)? */
export async function canScanInApp(): Promise<boolean> {
  const BD = (window as unknown as { BarcodeDetector?: { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    return (await BD.getSupportedFormats?.())?.includes('qr_code') ?? true;
  } catch {
    return false;
  }
}

/** Scan a QR code with the back camera into `video`. Resolves with its text; call the returned cancel to stop. */
export function scanQr(video: HTMLVideoElement): { result: Promise<string>; cancel: () => void } {
  let stream: MediaStream | null = null;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const result = (async () => {
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    const detector = new Ctor({ formats: ['qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (stopped) {
      cancel();
      throw new Error('cancelled');
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    while (!stopped) {
      try {
        const found = await detector.detect(video);
        if (found[0]?.rawValue) {
          cancel();
          return found[0].rawValue;
        }
      } catch {
        /* frame not ready */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('cancelled');
  })();
  return { result, cancel };
}
