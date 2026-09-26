/** World is a fixed 2.2:1 landscape box, scaled to fit the phone screen. */
export const WORLD_W = 1100;
export const WORLD_H = 500;

export const GRAVITY = 400; // px/s²
export const MAX_SPEED = 720; // px/s at 100% power (just over one screen of range)

export const TANK_HALF_WIDTH = 11;
export const TANK_BODY_HEIGHT = 8;
export const TANK_HIT_RADIUS = 11;
export const BARREL_LENGTH = 18;

export const MAX_HP = 100;
export const SETTLE_TIME = 0.8; // s pause after the last impact before the turn passes
export const FIXED_DT = 1 / 120;

/** Fuel for the whole match, in px of driving. It never refills, so spend it wisely. */
export const FUEL_PER_MATCH = 250;
export const DRIVE_SPEED = 32; // px/s
/** Highest lip or bump a driving tank rolls over in one go. */
export const DRIVE_CLIMB = 7;
/**
 * Steepest sustained climb (rise per px, 1 = 45°), judged over the next DRIVE_LOOKAHEAD px, so a
 * short bump is fine but a steep hill stops the tank.
 */
export const DRIVE_MAX_SLOPE = 1;
export const DRIVE_LOOKAHEAD = 14;
/**
 * Steeper climbs are still fine if they're short: when the ground within DRIVE_SCRAMBLE_REACH px ahead
 * tops out no more than DRIVE_SCRAMBLE px above the tank (a crater wall, a bank), it scrambles up.
 */
export const DRIVE_SCRAMBLE = 30;
export const DRIVE_SCRAMBLE_REACH = 40;
