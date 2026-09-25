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
