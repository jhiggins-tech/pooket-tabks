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
  { pilot: 'peppy', line: 'Fox, you’re becoming more like your father.' },
  { pilot: 'peppy', line: 'Use the boost to get through!' },
  { pilot: 'peppy', line: 'Don’t give up now, Fox!' },
  { pilot: 'peppy', line: 'Your father helped me like that too.' },
  { pilot: 'falco', line: 'Don’t get cocky, Fox. I’ve got this one.' },
  { pilot: 'falco', line: 'I’m going in. Cover me!' },
  { pilot: 'falco', line: 'That tank’s history. Next!' },
  { pilot: 'falco', line: 'Just stay out of my way, Fox.' },
  { pilot: 'slippy', line: 'Fox! Get this guy off me!' },
  { pilot: 'slippy', line: 'Wow, that tank’s armour is huge!' },
  { pilot: 'slippy', line: 'Thanks, Fox! I owe you one!' },
  { pilot: 'slippy', line: 'Uh-oh. I think it’s angry now.' },
  { pilot: 'fox', line: 'I’m not gonna lose to you!' },
  { pilot: 'fox', line: 'Everybody stay alert.' },
  { pilot: 'fox', line: 'Got it! Bombs away!' },
  { pilot: 'fox', line: 'Star Fox, standing by.' },
  { pilot: 'pepper', line: 'Our only hope is you, Star Fox!' },
  { pilot: 'pepper', line: 'The fate of Lylat rests on this strike.' },
  { pilot: 'pepper', line: 'Destroy that tank, and quickly!' },
  { pilot: 'rob', line: 'Supply ship en route.' },
  { pilot: 'rob', line: 'Enemy armour detected. Engaging.' },
  { pilot: 'rob', line: 'Bomb trajectory calculated.' },
  { pilot: 'wolf', line: 'Andross has ordered us to take you down.' },
  { pilot: 'wolf', line: 'You’re good, but I’m better!' },
  { pilot: 'wolf', line: 'This is Star Wolf. Stay out of our way!' },
  { pilot: 'katt', line: 'Is that any way to greet a girl?' },
  { pilot: 'katt', line: 'Long time no see, Falco!' },
  { pilot: 'bill', line: 'Fox, this is Bill. We’ve got your back!' },
  { pilot: 'bill', line: 'Husky Unit, form up on Star Fox!' },
  { pilot: 'james', line: 'You’re getting good, Fox. Real good.' },
];
