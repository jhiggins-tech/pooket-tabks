import { FUEL_PER_MATCH } from '../game/constants';
import { isBonus, weaponOf } from '../weapons/registry';
import { AMMO_PER_TIER } from '../characters/roster';
import { aimedTank, canSuckYolk, currentPlayer, decoyPickLeft, heistIndex, hologramsOf, isAimless, jetCharge, pendingTwinSpot, weaponForTier, YOLK_SUCKER, yolkTier } from '../game/game';
import { getCharacter } from '../characters/roster';
import { getWeapon } from '../weapons/registry';
import type { GameState, Player } from '../game/state';

/**
 * Keeps the DOM overlay in sync with game state. Each part keeps its own key and is touched only when that
 * changes: readouts (angle, power, fuel) every time they move, the name chips and weapon buttons only when
 * what they show changes (chips are kept and patched, so the health bars animate), the rest per turn.
 */
export class Hud {
  private readonly playersEl = byId('players');
  private readonly angleEl = byId('angle');
  private readonly powerEl = byId('power');
  private readonly aimSwitch = byId('aim-switch');
  private readonly bannerEl = byId('turn-banner');
  private readonly fireEl = byId<HTMLButtonElement>('fire');
  private readonly weaponsEl = byId('weapons');
  private readonly hintEl = byId('hint');
  private readonly fuelEl = byId('fuel-fill');
  private readonly fuelLabel = document.querySelector<HTMLElement>('.fuel small')!;
  private readonly driveEl = document.querySelector<HTMLElement>('.drive')!;
  private readonly gameOverEl = byId('gameover');
  private readonly winnerEl = byId('winner');
  private readonly heistEl = byId('heist');
  /** The last key each part was drawn for. */
  private readonly keys = { readouts: '', status: '', chips: '', chipsShape: '', weapons: '', heist: '', turn: '' };
  /** The name chips, kept between updates (rebuilt when the players or their number of bars change). */
  private chips: { el: HTMLElement; fills: HTMLElement[]; badges: HTMLElement; badgeKey: string }[] = [];
  /** Set in an online match: which seat is this phone's, and whether it's waiting for the other's result. */
  online: { localSeat: number; syncing: boolean } | null = null;

  update(state: GameState): void {
    const p = currentPlayer(state);
    const picking = decoyPickLeft(state);
    // Online: when it isn't this phone's turn, the controls step aside and it just watches.
    const remote = !!this.online && (state.current !== this.online.localSeat || this.online.syncing);
    this.updateReadouts(state, p, remote);
    this.updateStatus(state, p, picking, remote);
    this.updateChips(state, p);
    this.updateWeapons(state, p);
    this.updateHeist(state);
    this.updateTurn(state, p);
  }

  /** Angle, power and fuel: they move while you aim and drive, so they're just text and a width. */
  private updateReadouts(state: GameState, p: Player, remote: boolean): void {
    // torikloud with a twin: the readouts are for whichever tank is being aimed, and the switch picks which.
    const aim = aimedTank(p);
    const twin = !!p.twin && state.phase === 'aiming' && !remote && !isAimless(state);
    const key = `${aim.angle}|${aim.power}|${Math.round(p.fuel)}|${p.characterId}|${state.phase}|${twin}|${p.aimTwin}`;
    if (key === this.keys.readouts) return;
    this.keys.readouts = key;
    this.angleEl.textContent = angleLabel(aim.angle);
    this.powerEl.textContent = `${aim.power}`;
    this.aimSwitch.hidden = !twin;
    this.aimSwitch.textContent = p.aimTwin && p.twin ? '🎯 Twin' : '🎯 Main tank';
    this.aimSwitch.setAttribute('aria-pressed', String(p.aimTwin && !!p.twin));
    this.fuelEl.style.width = `${(p.fuel / FUEL_PER_MATCH) * 100}%`;
    this.fuelLabel.textContent = getCharacter(p.characterId).movement === 'hop' ? 'HOPS' : 'FUEL';
    const empty = p.fuel <= 0.5;
    this.driveEl.dataset.empty = String(empty);
    for (const b of this.driveEl.querySelectorAll('button')) b.disabled = state.phase !== 'aiming' || empty;
  }

  /** The page's state flags, the hint line and FIRE / DONE. */
  private updateStatus(state: GameState, p: Player, picking: number | null, remote: boolean): void {
    const countdown = jetCountdown(state);
    const decoys = hologramsOf(state, p.id).length;
    const key = [
      state.phase,
      state.current,
      state.turn,
      picking === null ? '' : Math.ceil(picking),
      state.swapTargetId,
      countdown,
      decoys,
      p.selectedTier,
      p.ammo[p.selectedTier],
      p.loadout[p.selectedTier],
      !!p.twin,
      p.hp,
      p.twin?.hp,
      remote,
      this.online?.syncing,
    ].join('|');
    if (key === this.keys.status) return;
    this.keys.status = key;
    const aimless = isAimless(state);
    document.body.dataset.phase = state.phase;
    document.body.dataset.remote = String(remote);
    document.body.dataset.aimless = String(aimless);
    document.body.dataset.charging = String(countdown !== null);
    document.body.dataset.picking = String(picking !== null && !remote);
    document.body.dataset.turn = String(state.turn);
    document.body.style.setProperty('--player-colour', p.colour);
    this.hintEl.textContent = remote && this.online?.syncing
      ? 'Syncing…'
      : remote && state.phase !== 'gameover'
      ? `${p.name} is ${state.phase === 'aiming' ? 'aiming' : 'firing'}…`
      : state.phase === 'stealing'
      ? ''
      : picking !== null
      ? `${state.swapTargetId !== null ? 'Swapping into that decoy' : 'Tap a decoy to swap into it'} · DONE when ready (${Math.ceil(picking)})`
      : countdown !== null
      ? `ten-2 charging… ${countdown}`
      : isBonus(weaponForTier(p, p.selectedTier)) || p.selectedTier === yolkTier(p)
      ? 'Bonus move: FIRE it, then take your turn'
      : pendingTwinSpot(state) !== null
      ? 'Tap the ground to place your twin, then FIRE'
      : aimless
      ? 'No aiming needed. Just FIRE'
      : p.twin
      ? 'Drag from a tank to aim it · 🎯 switches tank'
      : decoys > 0
        ? state.swapTargetId !== null
          ? 'Swapping to that decoy after you fire'
          : 'Drag to aim · tap a decoy to swap after firing'
        : 'Drag & pull back to aim';
    // Just after casting Trollogram, FIRE becomes DONE: finished picking a decoy to swap into.
    const done = picking !== null && !remote;
    this.fireEl.textContent = done ? 'DONE' : 'FIRE';
    const yolk = p.selectedTier === yolkTier(p);
    this.fireEl.disabled = !done && (state.phase !== 'aiming' || (yolk ? !canSuckYolk(p) : (p.ammo[p.selectedTier] ?? 0) <= 0));
  }

  /** A chip per player: name, status badges, and one health bar (two once Twins has split it). */
  private updateChips(state: GameState, current: Player): void {
    const shape = state.players.map((pl) => `${pl.name}|${pl.colour}|${pl.twin ? 2 : 1}`).join('/');
    if (shape !== this.keys.chipsShape) {
      this.keys.chipsShape = shape;
      this.keys.chips = '';
      this.chips = state.players.map((pl) => {
        const el = document.createElement('div');
        el.className = 'chip';
        el.style.setProperty('--c', pl.colour);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = pl.name;
        const badges = document.createElement('span');
        name.append(badges);
        const bar = document.createElement('span');
        bar.className = 'bars';
        const fills = (pl.twin ? [0, 1] : [0]).map(() => {
          const track = document.createElement('span');
          track.className = 'hp';
          const fill = document.createElement('span');
          track.append(fill);
          bar.append(track);
          return fill;
        });
        el.append(name, bar);
        return { el, fills, badges, badgeKey: '' };
      });
      this.playersEl.replaceChildren(...this.chips.map((c) => c.el));
    }
    const key = state.players
      .map((pl) => `${pl.hp}/${pl.twin?.hp}/${pl.maxHp}/${pl.alive}/${pl === current && state.phase !== 'gameover'}/${badgeKey(pl)}`)
      .join('|');
    if (key === this.keys.chips) return;
    this.keys.chips = key;
    state.players.forEach((pl, i) => {
      const chip = this.chips[i]!;
      chip.el.classList.toggle('active', pl === current && state.phase !== 'gameover');
      chip.el.classList.toggle('dead', !pl.alive);
      const full = pl.twin ? pl.maxHp / 2 : pl.maxHp;
      [pl.hp, pl.twin?.hp ?? 0].forEach((hp, k) => {
        if (chip.fills[k]) chip.fills[k].style.width = `${(hp / full) * 100}%`;
      });
      const bk = badgeKey(pl);
      if (bk !== chip.badgeKey) {
        chip.badgeKey = bk;
        chip.badges.replaceChildren(...badgesOf(pl));
      }
    });
  }

  /** The weapon buttons: rebuilt only when the loadout, rounds, selection or phase change. */
  private updateWeapons(state: GameState, p: Player): void {
    const yolk = yolkTier(p);
    const key = `${p.id}|${p.loadout.join(',')}|${p.ammo.join(',')}|${p.selectedTier}|${state.phase === 'aiming'}|${yolk}|${canSuckYolk(p)}`;
    if (key === this.keys.weapons) return;
    this.keys.weapons = key;
    this.weaponsEl.replaceChildren(
      ...p.loadout.map((_, tier) => {
        const w = weaponForTier(p, tier);
        const left = p.ammo[tier] ?? 0;
        const btn = document.createElement('button');
        btn.className = 'weapon';
        btn.dataset.tier = String(tier);
        btn.classList.toggle('selected', tier === p.selectedTier);
        btn.setAttribute('aria-pressed', String(tier === p.selectedTier));
        const name = document.createElement('span');
        name.className = 'wname';
        if (tier === yolk) {
          // torikloud's spent Twins: Yolk Sucker, a bonus move as often as there's health to even out.
          const ok = canSuckYolk(p);
          btn.classList.add('yolk');
          btn.disabled = !ok || state.phase !== 'aiming';
          btn.setAttribute('aria-label', `${YOLK_SUCKER.name}, bonus move${ok ? '' : ': health already even'}`);
          name.textContent = YOLK_SUCKER.name;
          name.classList.add('long');
          const note = document.createElement('span');
          note.className = 'pips bonus';
          note.textContent = ok ? 'bonus' : 'even';
          btn.append(name, note);
          return btn;
        }
        btn.disabled = left <= 0 || state.phase !== 'aiming';
        btn.setAttribute('aria-label', `${w.name}, ${left} left`);
        name.textContent = w.shortName;
        name.classList.toggle('long', w.shortName.length > 8);
        name.classList.toggle('longer', w.shortName.length > 11);
        btn.append(name, pips(left, AMMO_PER_TIER[tier] ?? left));
        return btn;
      }),
    );
  }

  /** The turn banner (once per turn) and the game over card. */
  private updateTurn(state: GameState, p: Player): void {
    const key = `${state.turn}|${state.phase === 'gameover'}|${state.phase === 'aiming'}|${this.online?.localSeat}`;
    if (key === this.keys.turn) return;
    const newTurn = key.split('|').slice(0, 2).join('|') !== this.keys.turn.split('|').slice(0, 2).join('|');
    this.keys.turn = key;
    if (newTurn && state.phase === 'aiming') {
      this.bannerEl.textContent = this.online && state.current === this.online.localSeat ? 'Your turn!' : `${p.name}'s turn`;
      this.bannerEl.style.color = p.colour;
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth; // restart the CSS animation
      this.bannerEl.classList.add('show');
    }
    this.gameOverEl.hidden = state.phase !== 'gameover';
    if (state.phase === 'gameover') {
      this.winnerEl.textContent = state.winner ? `${state.winner.name} wins!` : 'Draw!';
      const loser = state.players.find((q) => q !== state.winner);
      if (state.endReason && loser) {
        const why = document.createElement('small');
        why.className = 'end-reason';
        why.textContent = state.endReason === 'resigned' ? `${loser.name} resigned` : `${loser.name} ran out of time`;
        this.winnerEl.append(why);
      }
      this.winnerEl.style.color = state.winner?.colour ?? '#fff';
    }
  }

  /** kie's Steal: the victim's weapons as cards, one lit at a time, slowing down until one is stolen. */
  private updateHeist(state: GameState): void {
    const h = state.heist;
    const key = h ? `${heistIndex(h)}|${h.locked}|${state.players[h.victimId]!.ammo.join(',')}` : '';
    if (key === this.keys.heist) return;
    this.keys.heist = key;
    this.heistEl.hidden = !h;
    if (!h) return;
    const thief = state.players[h.thiefId]!;
    const victim = state.players[h.victimId]!;
    this.heistEl.style.setProperty('--thief', thief.colour);
    this.heistEl.style.setProperty('--victim', victim.colour);
    this.heistEl.classList.toggle('locked', h.locked);
    const [title, cards, result] = [...this.heistEl.children] as HTMLElement[];
    title!.replaceChildren(name(thief.name, thief.colour), ' is stealing from ', name(victim.name, victim.colour), '…');
    const lit = heistIndex(h);
    cards!.replaceChildren(
      ...h.options.map((id, tier) => {
        const w = getWeapon(id);
        const card = document.createElement('div');
        card.className = 'heist-card';
        // The stolen round comes off their pips the moment it lands.
        const shown = victim.ammo[tier] ?? 0;
        card.classList.toggle('empty', shown <= 0 && !(h.locked && tier === h.victimTier));
        card.classList.toggle('lit', tier === lit);
        card.classList.toggle('stolen', h.locked && tier === h.victimTier);
        const wname = document.createElement('span');
        wname.className = 'wname';
        wname.textContent = w.shortName;
        card.append(wname, pips(shown, AMMO_PER_TIER[tier] ?? shown));
        return card;
      }),
    );
    result!.textContent = h.locked ? `${thief.name} stole ${getWeapon(h.options[h.victimTier]!).shortName}!` : '• • •';
    result!.classList.toggle('rolling', !h.locked);
  }

  reset(): void {
    for (const k of Object.keys(this.keys) as (keyof Hud['keys'])[]) this.keys[k] = '';
  }
}

/** Whole seconds left on the current player's ten-2 charge, or null. */
function jetCountdown(state: GameState): number | null {
  const p = currentPlayer(state);
  const jet = state.jets.find((j) => j.playerId === p.id);
  if (jetCharge(state, p.id) === null || !jet) return null;
  return Math.max(1, Math.ceil(weaponOf(jet.weaponId, 'jetpack').jetpack.chargeTime - jet.elapsed));
}

/**
 * Show aim as elevation above (+) or below (−) the horizon, on the side the barrel points:
 * 45 → "45° ▸", 135 → "◂ 45°", 330 → "−30° ▸", 210 → "◂ −30°", 90 → "90° ▴", 270 → "90° ▾".
 */
export function angleLabel(angle: number): string {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  if (a === 90) return '90° ▴';
  if (a === 270) return '90° ▾';
  const fmt = (e: number) => (e < 0 ? `−${-e}°` : `${e}°`);
  if (a < 90) return `${fmt(a)} ▸`;
  if (a > 270) return `${fmt(a - 360)} ▸`;
  return `◂ ${fmt(180 - a)}`;
}

/**
 * The badges by a player's name, one per status they have (game/statuses.ts), in this order: what shows,
 * its tooltip, and its class (style.css).
 */
const BADGES: { cls: string; of: (pl: Player) => { text: string; title: string; colour?: string }[] }[] = [
  { cls: 'tattoo', of: (pl) => (pl.tattoo ? [{ text: ' ✒', title: 'Tattooed: takes extra damage' }] : []) },
  { cls: 'scam', of: (pl) => (pl.scam ? [{ text: ' 💅', title: 'Women in Scam: an enemy hit this turn earns a round of it' }] : []) },
  { cls: 'pinned', of: (pl) => (pl.pinned ? [{ text: ' 📌', title: 'Pinned: can’t move next turn' }] : []) },
  {
    cls: 'cooked',
    of: (pl) => (pl.cooked ? [{ text: ' 🍳', title: pl.cooked.active ? 'Cooked: half damage this turn' : 'Cooked: half damage next turn' }] : []),
  },
  {
    // One mark per burning tank (the main tank, the twin, or both).
    cls: 'burn',
    of: (pl) =>
      [pl.burn, pl.twin?.burn].flatMap((b) =>
        b ? [{ text: ` ✦${b.turnsLeft}`, title: `Burning: ${b.damagePerTurn} damage for ${b.turnsLeft} more turns`, colour: b.colour }] : [],
      ),
  },
];

/** What a player's badges show (for telling when they've changed), without building them. */
function badgeKey(pl: Player): string {
  if (!pl.alive) return '';
  return `${pl.tattoo ? 't' : ''}${pl.scam ? 's' : ''}${pl.pinned ? 'p' : ''}${pl.cooked ? (pl.cooked.active ? 'C' : 'c') : ''}${pl.burn?.turnsLeft ?? ''}/${pl.twin?.burn?.turnsLeft ?? ''}`;
}

function badgesOf(pl: Player): HTMLElement[] {
  if (!pl.alive) return [];
  return BADGES.flatMap((b) =>
    b.of(pl).map((x) => {
      const span = document.createElement('span');
      span.className = b.cls;
      span.textContent = x.text;
      span.title = x.title;
      if (x.colour) span.style.color = x.colour;
      return span;
    }),
  );
}

/** Rounds left as pips: ●●○ */
function pips(left: number, max: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'pips';
  el.textContent = '●'.repeat(left) + '○'.repeat(Math.max(0, max - left));
  return el;
}

function name(text: string, colour: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = text;
  b.style.color = colour;
  return b;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}
