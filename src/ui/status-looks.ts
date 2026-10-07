import type { Player } from '../game/state';
import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';

/**
 * How each status (game/statuses.ts) shows: its badge by the player's name in the HUD (render/hud.ts: the
 * icon, its class in style.css and its tooltip) and its line on the info screen (ui/info.ts), which takes
 * its numbers from the weapon that puts it on, so they can't drift from the kit.
 */

/** One badge by a player's name: its class, what it says, its tooltip, and its colour if not the class's. */
export interface Badge {
  cls: string;
  text: string;
  title: string;
  colour?: string;
}

/** A status's badge on one tank: its tooltip, and what follows the icon (a count), if anything. */
interface Mark {
  title: string;
  count?: number;
  colour?: string;
}

interface StatusLook {
  /** The badge's class (style.css). */
  cls: string;
  icon: string;
  /** What it's called on the info screen. */
  name: string;
  /** The weapon that puts it on (named on the info screen, and where its numbers come from). */
  weapon: string;
  /** The info screen's explanation, from that weapon. */
  info: (w: WeaponDef) => string;
  /** The badges a (living) player has for it: none, or one per tank it's on. */
  badges: (pl: Player) => Mark[];
}

/** "half" for 0.5, else a percentage. */
const share = (m: number) => (m === 0.5 ? 'half' : `${Math.round(m * 100)}%`);

/** Every status's look, in the order the badges show. */
const LOOKS: StatusLook[] = [
  {
    cls: 'tattoo',
    icon: '✒',
    name: 'Tattooed',
    weapon: 'tattoo-gun',
    info: (w) => `takes +${Math.round((w.tattoo!.multiplier - 1) * 100)}% damage from everything for ${w.tattoo!.turns} turns.`,
    badges: (pl) => (pl.tattoo ? [{ title: 'Tattooed: takes extra damage' }] : []),
  },
  {
    cls: 'scam',
    icon: '💅',
    name: 'Scamming',
    weapon: 'women-in-scam',
    info: () => 'an enemy attack that hits them this coming turn earns them a round of it.',
    badges: (pl) => (pl.scam ? [{ title: 'Women in Scam: an enemy hit this turn earns a round of it' }] : []),
  },
  {
    cls: 'pinned',
    icon: '📌',
    name: 'Pinned',
    weapon: 'sew',
    info: () => 'can’t move on their next turn.',
    badges: (pl) => (pl.pinned ? [{ title: 'Pinned: can’t move next turn' }] : []),
  },
  {
    cls: 'again',
    icon: '☕',
    name: 'Caffeinated',
    weapon: 'diced-coffee',
    info: () => 'goes again after this turn; the enemy’s next turn is skipped.',
    badges: (pl) => (pl.extraTurn ? [{ title: 'Diced Coffee: goes again after this turn' }] : []),
  },
  {
    cls: 'cooked',
    icon: '🍳',
    name: 'Cooked',
    weapon: 'the-rizzler',
    info: (w) => `everything they fire next turn does ${share(w.debuff!.offenceMultiplier)} damage.`,
    badges: (pl) => (pl.cooked ? [{ title: `Cooked: ${share(pl.cooked.multiplier)} damage ${pl.cooked.active ? 'this' : 'next'} turn` }] : []),
  },
  {
    // One mark per burning tank (the main tank, the twin, or both).
    cls: 'burn',
    icon: '✦',
    name: 'Burning',
    weapon: 'hyperfixate',
    info: (w) => `takes damage at the start of each of the next ${w.dot!.turns} turns, anyone’s.`,
    badges: (pl) =>
      [pl.burn, pl.twin?.burn].flatMap((b) =>
        b ? [{ count: b.turnsLeft, title: `Burning: ${b.damagePerTurn} damage for ${b.turnsLeft} more turns`, colour: b.colour }] : [],
      ),
  },
];

/** The info screen's list, in its own order. */
const INFO_ORDER = ['burn', 'cooked', 'tattoo', 'pinned', 'scam', 'again'];

/** A player's badges, in order (none once they're out). */
export function badgesOf(pl: Player): Badge[] {
  if (!pl.alive) return [];
  return LOOKS.flatMap((l) => l.badges(pl).map((m) => ({ cls: l.cls, text: ` ${l.icon}${m.count ?? ''}`, title: m.title, ...(m.colour ? { colour: m.colour } : {}) })));
}

/** What a player's badges show, as a string (for telling when they've changed). */
export function badgeKey(pl: Player): string {
  return badgesOf(pl)
    .map((b) => `${b.cls}:${b.text}:${b.title}:${b.colour ?? ''}`)
    .join('|');
}

/** The info screen's Status effects: [icon, "Name (Weapon): what it does"]. */
export function statusInfo(): [string, string][] {
  return INFO_ORDER.map((cls) => {
    const l = LOOKS.find((x) => x.cls === cls)!;
    const w = getWeapon(l.weapon);
    return [l.icon, `${l.name} (${w.name}): ${l.info(w)}`];
  });
}
