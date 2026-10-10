import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * torikloud's tier 1: indirect fire of a random legal word, one letter at a time. Longer words mean
 * more letters, so more damage: it's the luck of the draw. A twin argues from social work instead.
 */
export const debate = {
  id: 'debate',
  name: 'Debate',
  shortName: 'Debate',
  info:
    'Lobs a random legal word, one letter at a time; each letter is a small blast (up to 7). Longer words hit harder: the luck of the draw. A twin argues in social-work words.',
  blastRadius: 12,
  damage: 7,
  burst: { count: 1, interval: 0.12, powerJitter: 0.05 },
  words: { main: 'legal', twin: 'social-work', mainColour: '#ffd166', twinColour: '#7de2d1' },
  spin: 6,
  trail: false,
} satisfies WeaponDef;

/**
 * torikloud's tier 2: pulses of disruptor sound radiate in arcs from the barrel, straight through
 * terrain. Close targets catch the whole arc; distant ones only a sliver. A kookaburra looks down
 * from the clouds as it fires. With a twin, where the two tanks' waves cross they phase together:
 * extra range and focused damage there.
 */
export const sonicBoom = {
  id: 'sonic-boom',
  name: 'Sonic Boom',
  shortName: 'Sonic Boom',
  info:
    '4 waves of sound along your aim, straight through terrain without digging; power sets the range. Close targets catch the whole wave (12 each), far ones only a sliver. With Twins, crossing waves phase for ×1.5 damage and range.',
  kind: 'sonic',
  sonic: { waves: 4, interval: 0.22, speed: 320, halfAngleDeg: 30, minRange: 150, maxRange: 500, damage: 12, refDistance: 80 },
  friendlyFire: false,
  colour: '#c9b6ff',
  apparition: 'kookaburra',
} satisfies WeaponDef;

/**
 * torikloud's tier 3: a twin tank appears and his HP is split between them; the twin mirrors his shots.
 * (Two tanks are two targets, so torikloud starts with more health: 150.) Spent, the slot becomes Yolk
 * Sucker (game/copies.ts): a bonus move that evens out the two tanks' health.
 */
export const twins = {
  id: 'twins',
  name: 'Twins',
  shortName: 'Twins',
  info:
    'Tap the ground to choose where a second tank appears (anywhere but right beside an enemy), then FIRE: torikloud’s HP is split between the two. The twin fires every shot too, with its own aim: drag from a tank to aim it, or switch with 🎯 (◀ ▶ drive whichever tank you’re aiming, on the one tank of fuel). He’s out only when both are gone. Once Twins is fired its button becomes Yolk Sucker: a bonus move (it doesn’t use the turn) that pools the two tanks’ health and shares it out evenly, as often as you like while they’re uneven.',
  kind: 'twin',
  colour: '#a78bfa',
} satisfies WeaponDef;

export const torikloud = kit(
  {
    id: 'torikloud',
    name: 'torikloud',
    blurb: 'Debate, Sonic Boom and a twin to argue alongside.',
    colours: ['#a78bfa', '#818cf8', '#e879f9'],
    maxHp: 150,
  },
  [debate, sonicBoom, twins],
);
