export interface ControlHandlers {
  canAim(): boolean;
  setAim(angle: number, power: number): void;
  adjust(dAngle: number, dPower: number): void;
  fire(): void;
}

const DRAG_DEADZONE_PX = 10;

/**
 * Touch-first controls.
 * - Slingshot: drag anywhere on the playfield and pull back; the shot goes the
 *   opposite way to the drag, and drag length sets power.
 * - Hold-to-repeat +/- buttons for fine adjustment.
 * - A big FIRE button (release never fires, so hotseat mis-taps are harmless).
 */
export function bindControls(canvas: HTMLCanvasElement, h: ControlHandlers): void {
  let drag: { id: number; x: number; y: number } | null = null;

  const fullPowerDragPx = () => Math.max(120, Math.min(window.innerWidth, window.innerHeight) * 0.55);

  canvas.addEventListener('pointerdown', (e) => {
    if (!h.canAim() || drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !h.canAim()) return;
    const dx = drag.x - e.clientX;
    const dy = drag.y - e.clientY;
    const len = Math.hypot(dx, dy);
    if (len < DRAG_DEADZONE_PX) return;
    let angle = (Math.atan2(-dy, dx) * 180) / Math.PI; // screen y is down
    if (angle < 0) angle = angle < -90 ? 180 : 0; // pulled upward: clamp to horizon
    const power = Math.min(100, ((len - DRAG_DEADZONE_PX) / fullPowerDragPx()) * 100);
    h.setAim(angle, power);
  });

  const endDrag = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-adjust]')) {
    const [da, dp] = (btn.dataset.adjust ?? '0,0').split(',').map(Number) as [number, number];
    bindRepeat(btn, () => {
      if (h.canAim()) h.adjust(da, dp);
    });
  }

  document.getElementById('fire')?.addEventListener('click', () => {
    if (h.canAim()) h.fire();
  });
}

/** Fires once on press, then accelerates while held. */
function bindRepeat(btn: HTMLElement, action: () => void): void {
  let timer: number | undefined;
  const stop = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    action();
    let delay = 320;
    const tick = () => {
      action();
      delay = Math.max(40, delay * 0.8);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('lostpointercapture', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
