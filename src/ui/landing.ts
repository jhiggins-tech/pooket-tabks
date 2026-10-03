/**
 * The first screen: who's playing (✎ Change), the Game browser (a dot on its corner counts the online
 * turns waiting for you; a line under it says how many games are open or live) and Local hotseat, plus
 * Weapons & how to play and What's new.
 */

import type { Rank } from '../stats/ranks';
import { byId } from './dom';
import { insignia } from './insignia';

export class Landing {
  private readonly root = byId('setup');
  private readonly name = byId('you-name');
  private readonly rank = byId('you-rank');
  private readonly dot = byId('turns-dot');
  private readonly counts = byId('browser-counts');

  constructor(on: { browser: () => void; hotseat: () => void; changeName: () => void }) {
    byId('open-browser').addEventListener('click', on.browser);
    byId('open-hotseat').addEventListener('click', on.hotseat);
    byId('you-change').addEventListener('click', on.changeName);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  setName(name: string): void {
    this.name.textContent = name;
  }

  /** Signed in and ranked: their insignia by the name. */
  setRank(rank: Rank | null): void {
    if ((this.rank.dataset.rank ?? '') === (rank?.id ?? '')) return;
    this.rank.dataset.rank = rank?.id ?? '';
    this.rank.replaceChildren(...(rank ? [insignia(rank, 'md')] : []));
  }

  /** Online matches where it's this phone's turn. */
  setTurnsWaiting(n: number): void {
    this.dot.hidden = n <= 0;
    this.dot.textContent = String(n);
    this.dot.setAttribute('aria-label', `${n} ${n === 1 ? 'turn' : 'turns'} waiting for you`);
  }

  /** Games on the public list: waiting for a player, and under way. */
  setCounts(waiting: number, live: number): void {
    const parts = [...(waiting ? [`${waiting} waiting`] : []), ...(live ? [`${live} live`] : [])];
    this.counts.hidden = parts.length === 0;
    this.counts.textContent = parts.join(' · ');
  }
}
