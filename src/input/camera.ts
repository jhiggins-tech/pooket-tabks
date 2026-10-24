import type { CameraAction } from '../game/game';
import { byId } from '../ui/dom';

/**
 * Long Exposure's camera body (render/hud/camera.ts draws it): its buttons (`data-cam`), the two dials
 * (drag along the main dial, round the quick one, or tap either side of them for a notch), the focus
 * ring, and dragging the viewfinder to look round. Everything goes to `act` while `can()` says this phone
 * is shooting.
 */
export interface CameraHandlers {
  can(): boolean;
  act(a: CameraAction): void;
  /** The viewfinder dragged by (dx, dy) screen CSS px. */
  pan(dx: number, dy: number): void;
}

/** How far along the main dial a notch is (CSS px), and round the quick dial (radians). */
const MAIN_NOTCH = 20;
const QUICK_NOTCH = Math.PI / 6;
/** Less than this much movement and it was a tap (CSS px; radians). */
const TAP_SLOP = 6;
const TAP_TURN = 0.12;

export function bindCamera(h: CameraHandlers): void {
  const root = byId('camera');
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cam]');
    if (!btn || btn.disabled || !h.can()) return;
    const [k, fn] = btn.dataset.cam!.split(':') as [CameraAction['k'], string | undefined];
    h.act(k === 'fn' ? { k, fn: fn as 'iso' | 'wb' } : ({ k } as CameraAction));
  });

  const ring = root.querySelector<HTMLInputElement>('.cam-ring-input')!;
  ring.addEventListener('input', () => {
    if (h.can()) h.act({ k: 'focus', ring: Number(ring.value) });
  });

  // Looking round: drag the viewfinder.
  const frame = byId('camera-vf');
  let pan: { id: number; x: number; y: number } | null = null;
  frame.addEventListener('pointerdown', (e) => {
    if (!h.can()) return;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    h.pan(e.clientX - pan.x, e.clientY - pan.y);
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const endPan = (e: PointerEvent) => {
    if (pan?.id === e.pointerId) pan = null;
  };
  frame.addEventListener('pointerup', endPan);
  frame.addEventListener('pointercancel', endPan);

  for (const dialEl of root.querySelectorAll<HTMLElement>('.cam-dial')) {
    const dial = dialEl.dataset.dial as 'main' | 'quick';
    let drag: { id: number; x: number; last: number; angle: number; turned: number; moved: number } | null = null;
    const notch = (d: 1 | -1) => {
      h.act({ k: 'dial', dial, d });
      // The dial turns a little under the finger.
      const turned = Number(dialEl.dataset.turned ?? 0) + d;
      dialEl.dataset.turned = String(turned);
      dialEl.style.setProperty('--turned', String(turned));
    };
    const angleOf = (e: PointerEvent) => {
      const r = dialEl.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    dialEl.addEventListener('pointerdown', (e) => {
      if (!h.can()) return;
      dialEl.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, last: e.clientX, angle: angleOf(e), turned: 0, moved: 0 };
    });
    dialEl.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (dial === 'main') {
        const dx = e.clientX - drag.last;
        drag.moved += Math.abs(dx);
        if (Math.abs(dx) >= MAIN_NOTCH) {
          notch(dx > 0 ? 1 : -1);
          drag.last = e.clientX;
        }
        return;
      }
      const a = angleOf(e);
      let da = a - drag.angle;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      drag.angle = a;
      drag.turned += da;
      drag.moved += Math.abs(da);
      while (drag.turned >= QUICK_NOTCH) {
        notch(1);
        drag.turned -= QUICK_NOTCH;
      }
      while (drag.turned <= -QUICK_NOTCH) {
        notch(-1);
        drag.turned += QUICK_NOTCH;
      }
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const tapped = drag.moved < (dial === 'main' ? TAP_SLOP : TAP_TURN);
      drag = null;
      if (!tapped || e.type === 'pointercancel' || !h.can()) return;
      const r = dialEl.getBoundingClientRect();
      notch(e.clientX >= r.left + r.width / 2 ? 1 : -1);
    };
    dialEl.addEventListener('pointerup', end);
    dialEl.addEventListener('pointercancel', end);
    // A keyboard: the arrow keys turn it.
    dialEl.addEventListener('keydown', (e) => {
      if (!h.can()) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') notch(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') notch(-1);
      else return;
      e.preventDefault();
    });
  }
}
