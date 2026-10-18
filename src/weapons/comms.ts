/**
 * doctorfox's Air Strike (game/airstrike.ts): who comes over the comm while the Arwings make their run, and
 * what they say. One is picked at random (seeded) each time; the caption is typed out next to their
 * portrait, mouth flapping, as in Star Fox 64. The portraits are drawn from `PILOTS` (render/draw/comm.ts).
 * Add a line: an entry in `COMMS` (any pilot, any line; keep it short enough for two lines of caption).
 */

/** How fast the caption types out (characters a second): the mouth flaps and the gabble plays while it does. */
export const TYPE_RATE = 26;

/** Who can come over the comm. */
export type PilotId = 'fox' | 'falco' | 'peppy' | 'slippy' | 'pepper' | 'rob' | 'wolf' | 'katt' | 'bill' | 'james';

/** How a pilot's portrait is drawn: fur (or plating) and its light patch, ears, muzzle, and what they wear. */
export interface PilotLook {
  name: string;
  fur: string;
  light: string;
  ears: 'pointed' | 'long' | 'round' | 'none';
  muzzle: 'fox' | 'beak' | 'toad' | 'dog' | 'robot';
  /** What they wear: a headset, General Pepper's cap, Wolf's eyepatch, James's shades. */
  wear: 'headset' | 'cap' | 'eyepatch' | 'shades';
}

export const PILOTS: Record<PilotId, PilotLook> = {
  fox: { name: 'Fox', fur: '#d97706', light: '#fef3c7', ears: 'pointed', muzzle: 'fox', wear: 'headset' },
  falco: { name: 'Falco', fur: '#2563eb', light: '#f1f5f9', ears: 'none', muzzle: 'beak', wear: 'headset' },
  peppy: { name: 'Peppy', fur: '#d6d3d1', light: '#fafaf9', ears: 'long', muzzle: 'dog', wear: 'headset' },
  slippy: { name: 'Slippy', fur: '#65a30d', light: '#ecfccb', ears: 'none', muzzle: 'toad', wear: 'headset' },
  pepper: { name: 'General Pepper', fur: '#b45309', light: '#fde68a', ears: 'round', muzzle: 'dog', wear: 'cap' },
  rob: { name: 'ROB 64', fur: '#94a3b8', light: '#e2e8f0', ears: 'none', muzzle: 'robot', wear: 'headset' },
  wolf: { name: 'Wolf', fur: '#64748b', light: '#cbd5e1', ears: 'pointed', muzzle: 'fox', wear: 'eyepatch' },
  katt: { name: 'Katt', fur: '#f472b6', light: '#fce7f3', ears: 'pointed', muzzle: 'dog', wear: 'headset' },
  bill: { name: 'Bill', fur: '#78716c', light: '#e7e5e4', ears: 'round', muzzle: 'dog', wear: 'headset' },
  james: { name: 'James', fur: '#c2410c', light: '#fed7aa', ears: 'pointed', muzzle: 'fox', wear: 'shades' },
};

/** A comm: who, and what they say. */
export interface Comm {
  pilot: PilotId;
  line: string;
}

export const COMMS: readonly Comm[] = [
  { pilot: 'peppy', line: 'Do a barrel roll!' },
  { pilot: 'peppy', line: 'Use bombs wisely!' },
  { pilot: 'peppy', line: 'Fox, that tank is a sitting duck. Light it up!' },
  { pilot: 'falco', line: 'Hey Einstein, I’m on your side!' },
  { pilot: 'falco', line: 'Leave this one to me. Showtime!' },
  { pilot: 'falco', line: 'Too slow, tank boy!' },
  { pilot: 'slippy', line: 'I got its shield readings, Fox! Go get ’em!' },
  { pilot: 'slippy', line: 'Whoa! Watch where you’re shooting!' },
  { pilot: 'fox', line: 'All ships, follow my lead!' },
  { pilot: 'fox', line: 'Star Fox, lock on to that tank!' },
  { pilot: 'pepper', line: 'Good luck, Star Fox. We’re counting on you.' },
  { pilot: 'pepper', line: 'Air support, inbound. Give ’em everything!' },
  { pilot: 'rob', line: 'Target acquired. Commencing strafing run.' },
  { pilot: 'rob', line: 'Smart bomb armed and ready.' },
  { pilot: 'wolf', line: 'Can’t let you do that, Star Fox!' },
  { pilot: 'wolf', line: 'Playtime’s over!' },
  { pilot: 'katt', line: 'Need a hand, boys? Coming in hot!' },
  { pilot: 'bill', line: 'Bill here. Husky Unit, cover Star Fox!' },
  { pilot: 'james', line: 'Never give up. Trust your instincts.' },
  { pilot: 'james', line: 'Fly straight, son. They won’t know what hit ’em.' },
];
