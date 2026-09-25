export interface ControlHandlers {
  canAim(): boolean;
  setAim(angle: number, power: number): void;
  adjust(dAngle: number, dPower: number): void;
  fire(): void;
}

const DRAG_DEADZONE_PX = 10;
/** Pull length for 100% power, as a fraction of the screen's short side (~110px on a phone). */
const FULL_POWER_DRAG_FRACTION = 0.3;
const MIN_FULL_POWER_DRAG_PX = 80;

/**
 * Slingshot maths: a pull of (dx, dy) screen px from the touch start (screen y down)
 * aims the opposite way. Returns null inside the deadzone.
 */
export function dragToAim(
  dx: number,
  dy: number,
  fullPowerPx: number,
): { angle: number; power: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < DRAG_DEADZONE_PX) return null;
  let angle = (Math.atan2(dy, -dx) * 180) / Math.PI;
  if (angle < 0) angle = angle < -90 ? 180 : 0; // pulled upward: clamp to horizon
  const power = Math.min(100, ((len - DRAG_DEADZONE_PX) / fullPowerPx) * 100);
  return { angle, power };
}

export function fullPowerDragPx(viewportW: number, viewportH: number): number {
  return Math.max(MIN_FULL_POWER_DRAG_PX, Math.min(viewportW, viewportH) * FULL_POWER_DRAG_FRACTION);
}

/**
 * Touch-first controls.
 * - Slingshot: drag anywhere on the playfield and pull back; the shot goes the
 *   opposite way to the drag, and drag length sets power.
 * - Hold-to-repeat +/- buttons for fine adjustment.
 * - A big FIRE button (release never fires, so hotseat mis-taps are harmless).
 */
export function bindControls(canvas: HTMLCanvasElement, h: ControlHandlers): void {
  let drag: { id: number; x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!h.canAim() || drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !h.canAim()) return;
    const aim = dragToAim(
      e.clientX - drag.x,
      e.clientY - drag.y,
      fullPowerDragPx(window.innerWidth, window.innerHeight),
    );
    if (aim) h.setAim(aim.angle, aim.power);
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
