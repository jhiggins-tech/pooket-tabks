import { concede, currentPlayer, finishDecoyPick, fire } from '../game/game';
import type { GameState, Hop, PlayerConfig } from '../game/state';
import { netLog } from './log';
import type { GameRecord, GameStore, ShotRecord } from './record';
import { applySnapshot, decodeSolid, encodeSolid, takeSnapshot, type Snapshot } from './snapshot';
import { newReplayId } from './replay';
import type { Transport } from './transport';

/** Bumped whenever the messages or the game rules change: both phones must run the same code. */
export const PROTOCOL = 6;

/**
 * A match's setup: the map's seed, the players ([host, guest]), and (a public match) the id its replay
 * is recorded under (replay.ts). (`replay` came in without a protocol bump: a phone on the version
 * before just leaves it out, and that match has no replay.)
 */
export interface MatchSetup {
  seed: number;
  players: PlayerConfig[];
  replay?: string;
}

/** What each phone picked in the lobby. */
export interface Pick {
  name: string;
  characterId: string;
}

export type NetMsg =
  | { k: 'hello'; v: number; pick: Pick }
  | { k: 'start'; seed: number; players: PlayerConfig[]; terrain: string; replay?: string }
  | { k: 'preview'; turn: number; x: number; y: number; fuel: number; angle: number; power: number; tier: number; hop: Hop | null }
  | { k: 'fire'; turn: number; snap: Snapshot }
  | { k: 'sync'; turn: number; snap: Snapshot; terrain: string }
  /** A phone that dropped out is back (on a new connection) and needs catching up. */
  | { k: 'rejoin'; v: number }
  /** The catch-up: both picks ([host, guest]), and the match as it stands (null: still in the lobby). */
  | { k: 'resume'; picks: [Pick | null, Pick | null]; setup: MatchSetup | null; snap: Snapshot | null; terrain: string | null }
  /** Leaving before the match has started: that's the end of it. */
  | { k: 'bye' }
  /** Leaving a match for now (it carries on turn by turn: it's in the game record). */
  | { k: 'away' }
  | { k: 'resign' };

/**
 * What spectators get: the latest full state (why: a match started, a shot was fired from it, or it's a
 * turn's result), complete with the match setup and terrain so they can join at any point; and the live aim.
 */
export type ViewMsg =
  | { k: 'state'; why: 'start' | 'fire' | 'sync'; seed: number; players: PlayerConfig[]; snap: Snapshot; terrain: string }
  | Extract<NetMsg, { k: 'preview' }>;

/** How often the player whose turn it is streams their aim and position to the other phone. */
const PREVIEW_INTERVAL = 1 / 15;
/** If the other phone's end-of-turn result arrives while we're still animating, apply it after this long anyway. */
const SYNC_GRACE = 4;
/** Replaying their last shot from the record (the result's already known): let it play out, within reason. */
const REPLAY_GRACE = 60;
/** Rejoining: how long to wait for the other phone to catch us up before going by the record instead. */
export const RESUME_WAIT = 2.5;

/**
 * One networked match between two phones. Host is seat 0, guest is seat 1 (who goes first is up to the game).
 *
 * Both phones run the same deterministic simulation. The phone whose turn it is is in charge of it:
 * it streams aim/driving previews, and when it fires it sends a snapshot of the state just before the
 * shot, so both phones fire from exactly the same position. When the shot has played out it sends the
 * resulting state (and terrain) and the other phone snaps to it, so any drift (different phones can
 * round maths slightly differently) never lasts beyond a turn.
 *
 * Every match also has a lasting record (`store`, see record.ts) so it can carry on turn by turn: when
 * the other phone isn't there, a phone that opens the game catches up from it (`catchUp`), and if the
 * other phone vanished mid-shot, the shot is played out here and its result recorded.
 */
export class NetSession {
  readonly localSeat: 0 | 1;
  localPick: Pick | null = null;
  remotePick: Pick | null = null;
  /** The remote side left or the connection dropped. */
  lost = false;

  onLobby: () => void = () => {};
  /** Build a fresh game for these players (both phones call createGame with the same seed). */
  onStart: (seed: number, players: PlayerConfig[]) => GameState = () => {
    throw new Error('onStart not set');
  };
  onLost: () => void = () => {};
  /** The other phone went quiet (true) or came back (false). The match waits for it; it may rejoin. */
  onPeerAway: (away: boolean) => void = () => {};
  /** Rejoined and caught up: back in the match (true), or in the lobby (false). */
  onResumed: (inMatch: boolean) => void = () => {};
  /** Whether the other phone has gone quiet. */
  peerAway = false;
  /** Spectators' feed: whatever this phone is in charge of sending (see ViewMsg). */
  onView: ((v: ViewMsg) => void) | null = null;
  /** Where the match's lasting record goes (null: nowhere, e.g. in tests over a loopback). */
  store: GameStore | null = null;
  /** Matches this phone starts are public (on the Games list): record their replays. */
  publicReplay = false;

  private state: GameState | null = null;
  private setup: MatchSetup = { seed: 0, players: [] };
  /** The turn a shot was fired in (and whose it was) until its result is synced. */
  private shot: { turn: number; owner: number } | null = null;
  private pendingSync: Extract<NetMsg, { k: 'sync' }> | null = null;
  private waitedForSync = 0;
  private syncGrace = SYNC_GRACE;
  /** The last shot that played out, and the one in flight (for the record). */
  private lastShot: ShotRecord | null = null;
  private flyingShot: ShotRecord | null = null;
  private previewTimer = 0;
  private lastPreview = '';
  /** Rejoining: waiting to be caught up. */
  private rejoining = false;
  /** The other phone rejoined: catch it up once any shot in flight has played out. */
  private resumeWanted = false;
  /** Rejoining with the match's record to fall back on, if the other phone doesn't answer in time. */
  private fallback: { rec: GameRecord; replay: boolean; waited: number } | null = null;

  constructor(
    private readonly transport: Transport,
    role: 'host' | 'guest',
  ) {
    this.localSeat = role === 'host' ? 0 : 1;
    transport.onMessage = (m) => this.receive(m as NetMsg);
    transport.onClose = () => this.drop();
    transport.onQuiet = (quiet) => this.setPeerAway(quiet);
  }

  /**
   * Back after dropping out, on a new connection: ask the other phone to catch us up. If it isn't there
   * (no answer within RESUME_WAIT) and the match has a record, carry on from that (see catchUp).
   */
  rejoin(fallback?: { rec: GameRecord; replay: boolean }): void {
    netLog('session: rejoining');
    this.rejoining = true;
    this.fallback = fallback ? { ...fallback, waited: 0 } : null;
    this.transport.send({ k: 'rejoin', v: PROTOCOL } satisfies NetMsg);
  }

  get isRejoining(): boolean {
    return this.rejoining;
  }

  get isHost(): boolean {
    return this.localSeat === 0;
  }

  get game(): GameState | null {
    return this.state;
  }

  /** Both picks are in: the host can start. */
  get ready(): boolean {
    return !!this.localPick && !!this.remotePick;
  }

  setPick(pick: Pick): void {
    this.localPick = pick;
    this.transport.send({ k: 'hello', v: PROTOCOL, pick } satisfies NetMsg);
    this.onLobby();
  }

  /**
   * Start (or restart) the match. Players are [host, guest]; colours are resolved by the caller. Usually
   * the host's to do; the guest starts it when it joins an open game whose host isn't there.
   */
  start(seed: number, players: PlayerConfig[]): GameState {
    netLog(`session: starting a match (${players.map((p) => p.characterId).join(' vs ')})`);
    const replay = this.publicReplay ? newReplayId() : undefined;
    const state = this.begin({ seed, players, replay });
    const terrain = encodeSolid(state.terrain);
    this.transport.send({ k: 'start', seed, players, terrain, replay } satisfies NetMsg);
    const snap = takeSnapshot(state);
    this.view('start', snap, terrain);
    this.record(snap, terrain);
    return state;
  }

  /** Whether this phone may act now: its own turn, and the last shot's result has arrived. */
  canAct(): boolean {
    const s = this.state;
    return !!s && !this.lost && !this.rejoining && s.current === this.localSeat && !this.awaitingSync;
  }

  get awaitingSync(): boolean {
    return this.shot !== null && this.shot.owner !== this.localSeat && this.resolved(this.shot.turn);
  }

  /** Fire for the local player: tell the other phone (with the exact pre-shot state), then fire here. */
  fire(): boolean {
    const s = this.state;
    if (!s || !this.canAct()) return false;
    const snap = takeSnapshot(s);
    // The swap target is a secret: the other phone learns where we went from the result.
    snap.swapTargetId = null;
    const terrain = encodeSolid(s.terrain);
    if (!fire(s)) return false;
    this.shot = { turn: snap.turn, owner: this.localSeat };
    netLog(`session: fired on turn ${snap.turn}`);
    this.transport.send({ k: 'fire', turn: snap.turn, snap } satisfies NetMsg);
    this.view('fire', snap, terrain);
    // In the record at once: closing the app mid-shot doesn't undo it.
    this.flyingShot = { turn: snap.turn, owner: this.localSeat, snap, terrain };
    this.record(snap, terrain);
    return true;
  }

  /** Call once per frame after stepping the simulation. */
  tick(dt: number): void {
    if (this.rejoining && this.fallback && !this.lost && (this.fallback.waited += dt) >= RESUME_WAIT) {
      const { rec, replay } = this.fallback;
      this.fallback = null;
      this.catchUp(rec, replay);
    }
    this.sendResume();
    const s = this.state;
    if (!s || this.lost) return;
    // Stream the aim while it's our turn to aim.
    if (this.canAct() && s.phase === 'aiming') {
      this.previewTimer -= dt;
      if (this.previewTimer <= 0) {
        this.previewTimer = PREVIEW_INTERVAL;
        const p = currentPlayer(s);
        const msg = { k: 'preview', turn: s.turn, x: p.x, y: p.y, fuel: p.fuel, angle: p.angle, power: p.power, tier: p.selectedTier, hop: p.hop } as const;
        const key = JSON.stringify(msg);
        if (key !== this.lastPreview) {
          this.lastPreview = key;
          this.transport.send(msg satisfies NetMsg);
          this.onView?.(msg);
        }
      }
    }
    if (!this.shot || !this.resolved(this.shot.turn)) {
      // Still playing out. A result that's already arrived gets a grace period, then wins anyway.
      if (this.pendingSync) {
        this.waitedForSync += dt;
        if (this.waitedForSync >= this.syncGrace) this.applySync(this.pendingSync);
      }
      return;
    }
    if (this.shot.owner === this.localSeat || (!this.pendingSync && this.peerAway)) {
      // Our shot has played out (or theirs has, and they've gone before sending its result): this
      // result is the one that counts.
      netLog(`session: ${this.shot.owner === this.localSeat ? 'sending' : 'recording'} the result of turn ${this.shot.turn}`);
      const snap = takeSnapshot(s);
      const terrain = encodeSolid(s.terrain);
      if (this.shot.owner === this.localSeat) this.transport.send({ k: 'sync', turn: s.turn, snap, terrain } satisfies NetMsg);
      this.view('sync', snap, terrain);
      this.shot = null;
      this.lastShot = this.flyingShot;
      this.flyingShot = null;
      this.record(snap, terrain);
    } else if (this.pendingSync) {
      this.applySync(this.pendingSync);
    }
  }

  /**
   * Opened the match with nobody else there: carry on from its record. A shot left in flight is played out
   * here; otherwise, with `replay`, their last shot is shown again before snapping to how things stand.
   */
  catchUp(rec: GameRecord, replay: boolean): void {
    netLog(`session: catching up from the record (turn ${rec.snap.turn}${rec.flying ? ', a shot in flight' : replay && rec.last ? ', replaying their shot' : ''})`);
    this.rejoining = false;
    this.fallback = null;
    const pickOf = (i: number): Pick | null => {
      const p = rec.setup.players[i];
      return p ? { name: p.name, characterId: p.characterId } : null;
    };
    this.localPick = pickOf(this.localSeat) ?? this.localPick;
    this.remotePick = pickOf(this.localSeat === 0 ? 1 : 0) ?? this.remotePick;
    const s = this.begin(rec.setup);
    this.lastShot = rec.last;
    const from = rec.flying ?? (replay ? rec.last : null);
    if (from) {
      applySnapshot(s, from.snap);
      s.terrain.patchSolid(decodeSolid(from.terrain, s.terrain.solid.length));
      fire(s);
      this.shot = { turn: from.turn, owner: from.owner };
      if (rec.flying) this.flyingShot = rec.flying;
      else {
        this.pendingSync = { k: 'sync', turn: rec.snap.turn, snap: rec.snap, terrain: rec.terrain };
        this.syncGrace = REPLAY_GRACE;
      }
    } else {
      applySnapshot(s, rec.snap);
      s.terrain.patchSolid(decodeSolid(rec.terrain, s.terrain.solid.length));
    }
    this.setPeerAway(true);
    this.onResumed(true);
  }

  /** Give up the match: the other player wins. */
  resign(): void {
    const s = this.state;
    if (!s || this.lost || s.phase === 'gameover') return;
    netLog('session: resigning');
    concede(s, this.localSeat, 'resigned');
    this.transport.send({ k: 'resign' } satisfies NetMsg);
    this.settled();
  }

  /** Nobody's moved for three days: whoever's turn it is loses. */
  forfeit(): void {
    const s = this.state;
    if (!s || s.phase === 'gameover') return;
    netLog(`session: ${s.players[s.current]?.name ?? 'someone'} ran out of time`);
    concede(s, s.current, 'timeout');
    this.settled();
  }

  /** Leave the match for now (it carries on turn by turn): tell the other phone, keep the room. */
  away(): void {
    if (this.lost) return;
    netLog('session: leaving the match for now');
    this.transport.send({ k: 'away' } satisfies NetMsg);
    this.lost = true;
    (this.transport.detach ?? this.transport.close).call(this.transport);
  }

  /** The match ended between shots (resigned, out of time): record how it stands. */
  private settled(): void {
    const s = this.state!;
    const snap = takeSnapshot(s);
    const terrain = encodeSolid(s.terrain);
    this.shot = null;
    this.pendingSync = null;
    this.flyingShot = null;
    this.view('sync', snap, terrain);
    this.record(snap, terrain);
  }

  private record(snap: Snapshot, terrain: string): void {
    if (!this.store || !this.state) return;
    this.store.save({ v: PROTOCOL, setup: this.setup, snap, terrain, last: this.lastShot, flying: this.flyingShot });
  }

  /** Carrying on without them (the guest started the match with the host away). */
  assumeAway(): void {
    this.setPeerAway(true);
  }

  private setPeerAway(away: boolean): void {
    if (this.peerAway === away) return;
    this.peerAway = away;
    this.onPeerAway(away);
  }

  /** Catch up a phone that rejoined, from a settled moment (not mid-shot). Our result of that turn stands. */
  private sendResume(): void {
    // (Still being caught up ourselves: answer once we are.)
    if (!this.resumeWanted || this.lost || this.rejoining) return;
    const s = this.state;
    if (s && s.phase !== 'aiming' && s.phase !== 'gameover') return;
    this.resumeWanted = false;
    this.shot = null;
    this.pendingSync = null;
    const picks: [Pick | null, Pick | null] = this.isHost ? [this.localPick, this.remotePick] : [this.remotePick, this.localPick];
    const snap = s ? takeSnapshot(s) : null;
    if (snap) snap.swapTargetId = null; // still a secret
    netLog(`session: catching the other phone up${s ? ` (turn ${s.turn})` : ' (lobby)'}`);
    this.transport.send({
      k: 'resume',
      picks,
      setup: s ? this.setup : null,
      snap,
      terrain: s ? encodeSolid(s.terrain) : null,
    } satisfies NetMsg);
  }

  leave(): void {
    if (this.lost) return;
    this.transport.send({ k: 'bye' } satisfies NetMsg);
    this.lost = true;
    this.transport.close();
  }

  /** The turn a shot was fired in is over (the next turn has come up, or the game has ended). */
  private resolved(turn: number): boolean {
    const s = this.state!;
    return s.phase === 'gameover' || (s.turn > turn && s.phase === 'aiming');
  }

  private view(why: 'start' | 'fire' | 'sync', snap: Snapshot, terrain: string): void {
    this.onView?.({ k: 'state', why, seed: this.setup.seed, players: this.setup.players, snap, terrain });
  }

  private begin(setup: MatchSetup): GameState {
    this.setup = setup;
    this.state = this.onStart(setup.seed, setup.players);
    this.shot = null;
    this.pendingSync = null;
    this.syncGrace = SYNC_GRACE;
    this.lastShot = null;
    this.flyingShot = null;
    this.lastPreview = '';
    return this.state;
  }

  private applySync(msg: Extract<NetMsg, { k: 'sync' }>): void {
    const s = this.state!;
    netLog(`session: applying the other phone's result (now turn ${msg.snap.turn})`);
    applySnapshot(s, msg.snap);
    s.terrain.patchSolid(decodeSolid(msg.terrain, s.terrain.solid.length));
    this.shot = null;
    this.pendingSync = null;
    this.waitedForSync = 0;
    this.syncGrace = SYNC_GRACE;
    this.lastShot = this.flyingShot ?? this.lastShot;
    this.flyingShot = null;
  }

  private receive(msg: NetMsg): void {
    if (this.lost) return;
    // Anything from them means they're here (after catching up from the record, we assumed not).
    if (msg.k !== 'away') this.setPeerAway(false);
    // Rejoining: anything from before we're caught up is stale.
    if (this.rejoining && msg.k !== 'resume' && msg.k !== 'rejoin' && msg.k !== 'bye') return;
    switch (msg.k) {
      case 'hello':
        netLog(`session: hello from the other phone (${msg.pick.characterId})`);
        if (msg.v !== PROTOCOL) {
          netLog(`session: other phone runs protocol ${msg.v}, this one ${PROTOCOL}`);
          this.drop();
          return;
        }
        this.remotePick = msg.pick;
        this.onLobby();
        return;
      case 'start': {
        // Usually the host starts; the guest does if it joined while the host was away.
        if (this.isHost && this.state) return;
        const s = this.begin({ seed: msg.seed, players: msg.players, replay: msg.replay });
        // Same seed, same map, but make sure (maths can round differently between phones).
        s.terrain.patchSolid(decodeSolid(msg.terrain, s.terrain.solid.length));
        return;
      }
      case 'preview': {
        const s = this.state;
        if (!s || msg.turn !== s.turn || s.phase !== 'aiming' || s.current === this.localSeat) return;
        const p = currentPlayer(s);
        Object.assign(p, { x: msg.x, y: msg.y, fuel: msg.fuel, angle: msg.angle, power: msg.power, selectedTier: msg.tier, hop: msg.hop });
        return;
      }
      case 'fire': {
        const s = this.state;
        if (!s) return;
        netLog(`session: the other phone fired on turn ${msg.turn}`);
        // Their shot supersedes anything still pending from before.
        this.pendingSync = null;
        applySnapshot(s, msg.snap);
        this.flyingShot = { turn: msg.turn, owner: s.current, snap: msg.snap, terrain: encodeSolid(s.terrain) };
        fire(s);
        this.shot = { turn: msg.turn, owner: s.current };
        return;
      }
      case 'sync':
        if (!this.state) return;
        this.pendingSync = msg;
        this.waitedForSync = 0;
        finishDecoyPick(this.state); // they've finished picking a decoy, if they were
        return;
      case 'rejoin':
        netLog('session: the other phone is back and rejoining');
        if (msg.v !== PROTOCOL) {
          netLog(`session: other phone runs protocol ${msg.v}, this one ${PROTOCOL}`);
          this.drop();
          return;
        }
        this.transport.restart?.();
        this.resumeWanted = true;
        this.sendResume();
        return;
      case 'resume': {
        if (!this.rejoining) return;
        this.rejoining = false;
        const other = this.isHost ? 1 : 0;
        this.fallback = null;
        this.localPick = msg.picks[this.localSeat] ?? this.localPick;
        this.remotePick = msg.picks[other] ?? this.remotePick;
        if (msg.setup && msg.snap && msg.terrain) {
          netLog(`session: caught up (turn ${msg.snap.turn})`);
          const s = this.begin(msg.setup);
          applySnapshot(s, msg.snap);
          s.terrain.patchSolid(decodeSolid(msg.terrain, s.terrain.solid.length));
          this.onResumed(true);
        } else {
          netLog('session: caught up (lobby)');
          this.onResumed(false);
        }
        return;
      }
      case 'bye':
        netLog('session: the other phone left');
        this.drop();
        return;
      case 'away':
        netLog('session: the other phone left the match for now');
        this.setPeerAway(true);
        return;
      case 'resign': {
        const s = this.state;
        if (!s) return;
        netLog('session: the other phone resigned');
        concede(s, this.localSeat === 0 ? 1 : 0, 'resigned');
        this.shot = null;
        this.pendingSync = null;
        return;
      }
    }
  }

  private drop(): void {
    if (this.lost) return;
    this.lost = true;
    this.transport.close();
    this.onLost();
  }
}
