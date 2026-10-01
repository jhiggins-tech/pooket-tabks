/**
 * The first screen: who's playing (✎ Change), the Game browser (a dot on its corner counts the online
 * turns waiting for you; a line under it says how many games are open or live) and Local hotseat, plus
 * Weapons & how to play and What's new.
 */

import { byId } from './dom';

export class Landing {
  private readonly root = byId('setup');
  private readonly name = byId('you-name');
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
