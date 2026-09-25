import { describe, expect, it } from 'vitest';
import { dragToAim, fullPowerDragPx } from '../src/input/controls';

describe('slingshot drag', () => {
  // Pixel 7 landscape CSS viewport.
  const full = fullPowerDragPx(863, 360);

  it('reaches full power within about a third of a landscape phone screen height', () => {
    expect(full).toBeLessThanOrEqual(360 * 0.3);
    expect(dragToAim(-full, full, full)!.power).toBe(100);
  });

  it('ignores tiny drags', () => {
    expect(dragToAim(3, 4, full)).toBeNull();
  });

  it('aims opposite to the pull', () => {
    expect(dragToAim(-50, 50, full)!.angle).toBeCloseTo(45); // pull down-left -> up-right
    expect(dragToAim(50, 50, full)!.angle).toBeCloseTo(135); // pull down-right -> up-left
    expect(dragToAim(0, 50, full)!.angle).toBeCloseTo(90); // pull straight down -> straight up
  });

  it('aims all the way round: pulling up aims down', () => {
    expect(dragToAim(-50, -50, full)!.angle).toBeCloseTo(315); // pull up-left -> down-right
    expect(dragToAim(50, -50, full)!.angle).toBeCloseTo(225); // pull up-right -> down-left
    expect(dragToAim(0, -50, full)!.angle).toBeCloseTo(270); // pull straight up -> straight down
    expect(dragToAim(-50, 0, full)!.angle).toBeCloseTo(0);
  });

  it('scales power linearly past the deadzone and caps at 100', () => {
    const half = dragToAim(0, 10 + full / 2, full)!;
    expect(half.power).toBeCloseTo(50);
    expect(dragToAim(0, full * 3, full)!.power).toBe(100);
  });
});
