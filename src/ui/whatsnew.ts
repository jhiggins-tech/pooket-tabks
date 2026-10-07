/**
 * The "What's new" popup: the latest changes, shown once per version. The newest version seen is
 * remembered in localStorage, so the popup only comes back when there's something new.
 */

import { readStore, writeStore } from '../core/storage';
import { button, dialog, el } from './dom';

export interface Release {
  /** Goes up by one per release. */
  version: number;
  title: string;
  items: string[];
}

/**
 * Newest first. Add a release (version + 1) when shipping something players will notice; testing pushes
 * (betas, work in progress) wait for a roll-up release. Version 48 went out briefly and was withdrawn
 * (garyoldmancorp's beta): phones that saw it remember 48, so the next release is 49.
 */
export const CHANGELOG: Release[] = [
  {
    version: 49,
    title: 'Fixes',
    items: [
      'torikloud’s twin now fires Sonic Boom along its own aim, as it does Debate (it was copying the main tank’s aim).',
      'tones2’s ten-2 and ten-3 hits now count in 📊 Stats, so their accuracy is right (it showed 0%). Matches from before stay as they were.',
    ],
  },
  {
    version: 47,
    title: 'Hyperfixate burns faster',
    items: ['kcaj’s Hyperfixate burn now ticks at the start of every turn, yours as well as theirs: still 8 damage three times, but it’s all dealt a round sooner.'],
  },
  {
    version: 46,
    title: '🎺 Rank-up jingles',
    items: ['Every rank has its own rank-up tune now, and they get bigger as you climb: a lone tune at the bottom, then a bass, drums and harmony join, and the sparkliest ranks add an echo, a twinkle and a shimmer. Gold, Champion and the rest each have their own.'],
  },
  {
    version: 45,
    title: 'More ranks, faster',
    items: [
      'The ladder is longer than anyone has seen. There are ranks out there that nobody knows yet: you’ll find out what they are when somebody earns one.',
      'Climbing is quicker: a win moves you at least a third of a rank, half a rank against an equal, and an upset more. The loser gives up the same. Ranks are worked out again from everyone’s matches, so yours may have changed.',
    ],
  },
  {
    version: 44,
    title: '🏆 Leaderboard',
    items: ['A leaderboard of ranked players, best rating first, with medals for the top three and your own place highlighted. It’s the first tab of 📊 Stats, or tap your insignia on the first screen.'],
  },
  {
    version: 43,
    title: 'Ranks',
    items: [
      'Competitive ranks for players signed in with Google: Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster and Champion. Everyone starts in Silver.',
      'Win or lose is all that counts: beating a higher-ranked player gets you more, losing to a lower-ranked one costs you more. Only matches both players were signed in for count.',
      'Your insignia shows by your name in matches, the lobby, the menu and the stats (the top ranks sparkle), and ranking up gets a fanfare at the end of the match.',
    ],
  },
  {
    version: 42,
    title: '📊 Stats',
    items: [
      'New on the first screen: 📊 Stats. Online matches added up: a players table (win rate, accuracy, damage, kills), every character and weapon, and your own numbers.',
      'Verified only shows just the matches both players were signed in with Google for. Matches count from now on, and the stats are updated every hour.',
    ],
  },
  {
    version: 41,
    title: 'Yolk Sucker',
    items: ['torikloud: once Twins is fired, its button becomes Yolk Sucker, a bonus move (it doesn’t use your turn) that shares the two tanks’ health out evenly. Use it as often as you like while they’re uneven.'],
  },
  {
    version: 40,
    title: 'Your turn, on every phone',
    items: ['Signed in with Google, "your turn" and "someone joined your game" now reach every phone you’re signed in on (the ones with 🔔 notifications on, and any with the game open), not just the one you last played on.'],
  },
  {
    version: 39,
    title: 'Your games, on any phone',
    items: [
      'Signed in with Google, your online matches follow you too: start one on one phone and carry it on from another (they’re under your games in the Game browser).',
      'Open a match on a second phone and that one plays; the first steps aside, with "Play here instead" to take it back.',
    ],
  },
  {
    version: 38,
    title: 'Sign in with Google',
    items: ['Optional: sign in with Google on the first screen and your name, last tank and settings follow you to your other phones. Playing without signing in works just as before.'],
  },
  {
    version: 37,
    title: 'Bigger splashback',
    items: ['tones2’s ten-1 now splashes back from three times as far: from any enemy within 12 tank-widths (was 4).'],
  },
  {
    version: 36,
    title: 'Splashback',
    items: ['tones2’s ten-1 at point-blank range splashes back now: once the jet has done 5 damage to an enemy within 4 tank-widths, it rebounds onto tones2 (no damage), knocking the aim off and killing the pressure. Further off it works as before.'],
  },
  {
    version: 35,
    title: 'tones2',
    items: ['tones is now called tones2. Same tank, same weapons.'],
  },
  {
    version: 34,
    title: 'Twins, your way',
    items: [
      'torikloud: choose where your twin appears. With Twins selected, tap the ground to move the ghost, then FIRE.',
      'The twin now aims on its own. Drag from a tank to aim it, or switch with 🎯 (above the angle).',
    ],
  },
  {
    version: 33,
    title: 'Sneak peek',
    items: ['A first look at some of the moves the coming-soon characters will bring: see their pages in ⓘ (work in progress, so they may change).'],
  },
  {
    version: 32,
    title: 'Catch the runner',
    items: ['ciarra’s Marathon runner can be shot now: an enemy shot that crosses her path goes off on her (they used to fly straight through), so she can be stopped mid-run.'],
  },
  {
    version: 31,
    title: 'Coming soon',
    items: ['Six new characters are on the way: garyoldmancorp, shotdownboyz, kiwicore, odsey, lankcity and doctorfox. Have a look in the character picker and the ⓘ info screen.'],
  },
  {
    version: 30,
    title: 'Fix',
    items: ['Fixed: on a computer, the tank dropdowns opened as white text on white.'],
  },
  {
    version: 29,
    title: 'Notifications',
    items: [
      'Tap 🔔 on the first screen to get notified when it’s your turn in an online match, or someone starts your game.',
      'On iPhone: add Pooket Tabks to your Home Screen (Share → Add to Home Screen) and open it from there first.',
    ],
  },
  {
    version: 28,
    title: 'Watch it again',
    items: [
      'When a match ends, ▶ Watch replay plays it back from the start (hotseat and online, at 1×, 2× or 4×).',
      'Rematch is gone: start a new game to play again (and pick a different tank while you’re at it).',
    ],
  },
  {
    version: 27,
    title: 'Who’s watching',
    items: [
      'Online, you can see who’s watching your match: the 👁 count in the top bar (tap it for their names).',
      'A heads-up pops up when someone starts watching.',
    ],
  },
  {
    version: 26,
    title: 'Tidier online screens',
    items: [
      'The lobby just shows who’s playing as what: the leftover character dropdown is gone (you choose your tank before hosting or joining).',
      'Fixed: a few online screens could pop back up after you’d already left them.',
    ],
  },
  {
    version: 25,
    title: 'Twin fixes',
    items: ['Fixed: sludge on torikloud’s twin now drains over a couple of seconds, like on any tank, and hits on the twin go “oof”.'],
  },
  {
    version: 24,
    title: 'Updates won’t end your games',
    items: [
      'Online matches in progress now carry on through balance updates (they used to end as “Older version”).',
      'If the other phone is on a different version, whichever is behind is asked to reload, and your match waits for it.',
    ],
  },
  {
    version: 23,
    title: 'torikloud toughens up',
    items: [
      'torikloud now starts with 150 health (everyone else has 100): two tanks are two targets. Twins splits it 75 / 75.',
      'Fixed: a Hyperfixate beam into torikloud’s twin now sets the twin burning, like the main tank.',
      'Online matches started before this update can’t carry on. Sorry!',
    ],
  },
  {
    version: 22,
    title: 'Trollogram rebalanced',
    items: [
      'kie’s holograms no longer hurt whoever hits them. Instead a hit hologram blows up: a small blast that hurts any tank nearby, friend or foe (kie too), and can set off the next one.',
      'With a brand new glitchy explosion, and a sound to match.',
      'Online matches started before this update can’t carry on (both phones need the same rules). Sorry!',
    ],
  },
  {
    version: 21,
    title: 'Replays',
    items: [
      'Tick Past matches in the Game browser to see public games that have finished, and ▶ Replay one to watch it again, shot by shot, to see what happened.',
      'Speed it up with 1× / 2× / 4×, and ↺ Watch again at the end. (Private games aren’t recorded.)',
    ],
  },
  {
    version: 20,
    title: 'Choose your tank',
    items: [
      'Hosting or joining an online game now starts with a Choose your tank screen: pick a character, see what each weapon does, then Host or Join with it.',
    ],
  },
  {
    version: 19,
    title: 'Host now, play later',
    items: [
      'A game you host stays open when you leave the Host screen: it stays in the Game browser, and the first person to join starts the match, even if you’re not there.',
      'You take your turn when you’re back (it’s in your games, and the dot on the Game browser tells you). Cancel game takes it down.',
    ],
  },
  {
    version: 18,
    title: 'A tidier start',
    items: [
      'The first screen is down to two big choices: 🌐 Game browser (host, join or watch online) and 👥 Local hotseat (two players on this phone).',
      'The Game browser is one big table: your matches first, then games to join or watch. Host a game and private codes are on the side.',
      'A dot on the Game browser counts the online turns waiting for you. Change your name with ✎ Change.',
    ],
  },
  {
    version: 17,
    title: 'Play turn by turn',
    items: [
      'Online matches no longer need you both there at once: take your turn, go back to the menu (☰), and the other player takes theirs whenever they’re back.',
      'My games on the setup screen shows your matches and whose turn it is. Opening one replays their last shot first.',
      '📣 Nudge sends them the game’s link; 🏳 Resign ends it. A turn left for 3 days is forfeited.',
    ],
  },
  {
    version: 16,
    title: 'What’s your name?',
    items: [
      'The game asks your name the first time you open it, and remembers it: it’s your name as Player 1 and in online games.',
      'Change it any time by editing Player 1’s name on the setup screen.',
    ],
  },
  {
    version: 15,
    title: 'Women in Scam 💅',
    items: [
      'larinovsky gets a fourth weapon: Women in Scam, a bonus move once a match. It doesn’t use your turn (aim and fire as usual after it).',
      'Until the end of the next enemy turn, if an enemy attack hits larinovsky’s tank, larinovsky gets a round of that weapon to use.',
    ],
  },
  {
    version: 14,
    title: 'Nap time, with cats',
    items: [
      'larinovsky’s Take a Nap now also restocks Pill Pusher and the Rizzler to full (the nap itself is still once a match).',
      'Two little cats curl up either side of larinovsky while they nap.',
    ],
  },
  {
    version: 13,
    title: 'Find a game',
    items: [
      'Join now opens a live Games list: every game waiting for a player (tap to join) and every match being played (tap to watch), on any network.',
      'Hosting? Your game is listed unless you tap 🌐 Listed in Games to make it 🔒 Private: then only your code or link gets in.',
    ],
  },
  {
    version: 12,
    title: 'No more ghost players',
    items: [
      'Opening a game link now asks “Join game?” first, so a messaging app’s link preview can’t sneak into your seat.',
      'If someone joins and vanishes before the match starts, the host’s room frees up for a real player.',
    ],
  },
  {
    version: 11,
    title: 'Pick a pill',
    items: ['larinovsky’s Pill Pusher lobs a mixed handful: a red and white capsule, a round mint tablet, a blue and yellow capsule and a lilac caplet.'],
  },
  {
    version: 10,
    title: 'Big frog energy',
    items: ['ciarra’s frog hops are much bigger: longer leaps, up cliffs no tank can climb, and twice as far on the same fuel.'],
  },
  {
    version: 9,
    title: 'The Rizzler can’t resist',
    items: ['larinovsky’s Rizzler homes in: get it within about 100px of an enemy tank and it swoops straight at them.'],
  },
  {
    version: 8,
    title: 'Dropped out? Jump back in',
    items: [
      'Online matches survive a dropped connection: the other phone waits for you, and reopening the game puts you straight back in your seat (or tap ↩ Rejoin, or type the code again).',
    ],
  },
  {
    version: 7,
    title: 'Who goes first?',
    items: ['Who goes first is now random, every match (on one phone or two).'],
  },
  {
    version: 6,
    title: 'ten-1 sprays',
    items: [
      'tones’ ten-1 sprays about while the pressure is low, and that weak dribble barely stings, so point-blank it’s no longer nearly a one-shot (about 60 at best, down from about 90). At range it hits as hard as before.',
    ],
  },
  {
    version: 5,
    title: 'Sneakier Trollograms',
    items: ['Trollogram: pick a decoy to swap into on the very turn you cast it (tap one, then DONE).'],
  },
  {
    version: 4,
    title: 'Clearer weapon info',
    items: [
      'Marathon’s info says how far a leg is (150px, about a seventh of the stage).',
      'Hyperfixate’s info says the laser stops at the ground: you need a clear line of sight.',
    ],
  },
  {
    version: 3,
    title: 'Watch a match',
    items: [
      'Spectator mode: type the code of a game that’s already under way (or tap it in the nearby list) to watch it live, view only.',
      'This “What’s new” popup, so you know what changed.',
    ],
  },
  {
    version: 2,
    title: 'Two phones, anywhere',
    items: [
      'Online play: host a game and share its 4-letter code or link, and play on two phones over any network.',
      'Games on the same Wi-Fi show up in a nearby list, so you can just tap to join.',
      'tones’ ten-1 gives its round back if it misses.',
    ],
  },
  {
    version: 1,
    title: 'Sounds and sneaky kie',
    items: [
      'Kitschy 8-bit sound effects for every attack (🔊 to mute), and a Pop Goes the Weasel tune while the weasels run.',
      'Weasels pop once they’re in the best spot, not just on contact.',
      'kie’s new kit: Weasel Pop, stacking Trollograms and Steal.',
      'Tanks can drive out of craters.',
    ],
  },
];

export const LATEST = CHANGELOG[0]!.version;
export const WHATS_NEW_KEY = 'pooket.whatsNew';

/** The releases to show someone who last saw `seen` (none yet: just the latest). */
export function unseenReleases(seen: number | null, log: Release[] = CHANGELOG): Release[] {
  if (seen === null) return log.slice(0, 1);
  return log.filter((r) => r.version > seen);
}

export function readSeen(): number | null {
  const v = Number.parseInt(readStore(WHATS_NEW_KEY) ?? '', 10);
  return Number.isFinite(v) ? v : null;
}

function markSeen(): void {
  writeStore(WHATS_NEW_KEY, String(LATEST)); // (storage unavailable: it'll just show again)
}

export class WhatsNew {
  private readonly root = dialog('whatsnew', 'What’s new');
  private readonly body = el('div', 'whatsnew-body');

  constructor() {
    const card = el('div', 'whatsnew-card');
    const ok = button('Got it', () => this.close(), 'big');
    ok.id = 'whatsnew-ok';
    card.append(el('h2', undefined, 'What’s new'), this.body, ok);
    this.root.append(card);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show what's changed since this phone last looked, if anything. */
  showUnseen(): void {
    const seen = readSeen();
    if (seen !== null && seen >= LATEST) return;
    this.open(unseenReleases(seen));
  }

  /** Open on the given releases (default: all of them, newest first). */
  open(releases: Release[] = CHANGELOG): void {
    this.body.replaceChildren(
      ...releases.map((r) => {
        const section = el('section');
        const list = el('ul');
        for (const item of r.items) list.append(el('li', undefined, item));
        section.append(el('h3', undefined, r.title), list);
        return section;
      }),
    );
    this.root.hidden = false;
    this.body.scrollTop = 0;
  }

  close(): void {
    this.root.hidden = true;
    markSeen();
  }
}
