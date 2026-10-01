import { concede, finishDecoyPick, fire } from '../game/game';
import type { GameState, Hop, PlayerConfig } from '../game/state';
import { Emitter } from '../core/emitter';
import { applyPreview, previewOf, putState, shotResolved, SYNC_GRACE, type Preview } from './follow';
import { netLog } from './log';
import type { GameRecord, GameStore, ShotRecord } from './record';
import { applySnapshot, decodeSolid, encodeSolid, takeSnapshot, type Snapshot } from './snapshot';
import { newReplayId } from './replay';
import { RULES, WIRE } from './version';
import type { Transport } from './transport';

/**
 * A match's setup: the map's seed, the players ([host, guest]), the game rules it started on (version.ts),
 * and (a public match) the id its replay is recorded under (replay.ts).
 */
export interface MatchSetup {
  seed: number;
  players: PlayerConfig[];
  rules: number;
  replay?: string;
}

/** Which phone is out of date: this one (it should reload) or the other one. */
export type Outdated = 'us' | 'them';

/** What each phone picked in the lobby. */
export interface Pick {
  name: string;
  characterId: string;
}

export type NetMsg =
  /** `v` is the wire version and `rules` the rules version (version.ts): they must match exactly. */
  | { k: 'hello'; v: number; rules: number; pick: Pick }
  | { k: 'start'; seed: number; players: PlayerConfig[]; rules: number; terrain: string; replay?: string }
  | { k: 'preview'; turn: number; x: number; y: number; fuel: number; angle: number; power: number; tier: number; hop: Hop | null }
  | { k: 'fire'; turn: number; snap: Snapshot }
  | { k: 'sync'; turn: number; snap: Snapshot; terrain: string }
  /** A phone that dropped out is back (on a new connection) and needs catching up. */
  | { k: 'rejoin'; v: number; rules: number }
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
  | Preview;

/** How often the player whose turn it is streams their aim and position to the other phone. */
const PREVIEW_INTERVAL = 1 / 15;
/** Replaying their last shot from the record (the result's already known): let it play out, within reason. */
const REPLAY_GRACE = 60;
/** Rejoining: how long to wait for the other phone to catch us up before going by the record instead. */
export const RESUME_WAIT = 2.5;

/**
 * Where a session is:
 * - lobby: connected, picks going back and forth (setPick, 'hello');
 * - rejoining: back on a new connection, waiting to be caught up by the other phone, or after RESUME_WAIT
 *   by the match's record (`fallback`), into the match or the lobby;
 * - match: a game under way (or over: a rematch starts another);
 * - ended: this phone left (for good, or for now: 'away'), the versions don't match, or the other phone
 *   left or the room went ('lost'). Nothing more is sent or taken in; the game, if any, stays to look at.
 */
type SessionPhase =
  | { k: 'lobby' }
  | { k: 'rejoining'; fallback: { rec: GameRecord; replay: boolean; waited: number } | null }
  | { k: 'match'; game: GameState }
  | { k: 'ended'; why: 'left' | 'away' | 'outdated' | 'lost'; game: GameState | null };

/** What a session tells the screens (NetSession.on). */
export interface SessionEvents extends Record<string, unknown[]> {
  /** Picks changed (ours or theirs): the lobby shows them. */
  lobby: [];
  /** The match is over for good: the other phone left before it started, or the room has gone. */
  lost: [];
  /** The other phone runs another version of the game: one of them has to reload first. */
  outdated: [who: Outdated];
  /** The other phone went quiet (true) or came back (false). The match waits for it; it may rejoin. */
  peerAway: [away: boolean];
  /** Rejoined and caught up: back in the match (true), or in the lobby (false). */
  resumed: [inMatch: boolean];
  /** Spectators' feed: whatever this phone is in charge of sending (see ViewMsg). */
  view: [v: ViewMsg];
}

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

  /** Build a fresh game for these players (both phones call createGame with the same seed). */
  onStart: (seed: number, players: PlayerConfig[]) => GameState = () => {
    throw new Error('onStart not set');
  };
  /** Whether the other phone has gone quiet. */
  peerAway = false;
  /** Where the match's lasting record goes (null: nowhere, e.g. in tests over a loopback). */
  store: GameStore | null = null;
  /** Matches this phone starts are public (on the Games list): record their replays. */
  publicReplay = false;

  private readonly events = new Emitter<SessionEvents>();
  private phase: SessionPhase = { k: 'lobby' };
  private setup: MatchSetup = { seed: 0, players: [], rules: RULES };
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
  /** The other phone rejoined: catch it up once any shot in flight has played out. */
  private resumeWanted = false;

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
    this.phase = { k: 'rejoining', fallback: fallback ? { ...fallback, waited: 0 } : null };
    this.transport.send({ k: 'rejoin', v: WIRE, rules: RULES } satisfies NetMsg);
  }

  /** Listen for one of the session's events (see SessionEvents); returns the function that stops listening. */
  on<E extends keyof SessionEvents>(event: E, fn: (...args: SessionEvents[E]) => void): () => void {
    return this.events.on(event, fn);
  }

  get isRejoining(): boolean {
    return this.phase.k === 'rejoining';
  }

  /** Over for this phone: it left, the versions don't match, or the other phone left or the room went. */
  get lost(): boolean {
    return this.phase.k === 'ended';
  }

  get isHost(): boolean {
    return this.localSeat === 0;
  }

  get game(): GameState | null {
    return this.phase.k === 'match' || this.phase.k === 'ended' ? this.phase.game : null;
  }

  /** The game, while the match is on (not once this phone has left it). */
  private get state(): GameState | null {
    return this.phase.k === 'match' ? this.phase.game : null;
  }

  /** Both picks are in: the host can start. */
  get ready(): boolean {
    return !!this.localPick && !!this.remotePick;
  }

  setPick(pick: Pick): void {
    this.localPick = pick;
    this.transport.send({ k: 'hello', v: WIRE, rules: RULES, pick } satisfies NetMsg);
    this.events.emit('lobby');
  }

  /**
   * Start (or restart) the match. Players are [host, guest]; colours are resolved by the caller. Usually
   * the host's to do; the guest starts it when it joins an open game whose host isn't there.
   */
  start(seed: number, players: PlayerConfig[]): GameState {
    netLog(`session: starting a match (${players.map((p) => p.characterId).join(' vs ')})`);
    const replay = this.publicReplay ? newReplayId() : undefined;
    const state = this.begin({ seed, players, rules: RULES, replay });
    const terrain = encodeSolid(state.terrain);
    this.transport.send({ k: 'start', seed, players, rules: RULES, terrain, replay } satisfies NetMsg);
    const snap = takeSnapshot(state);
    this.view('start', snap, terrain);
    this.record(snap, terrain);
    return state;
  }

  /** Whether this phone may act now: its own turn, and the last shot's result has arrived. */
  canAct(): boolean {
    const s = this.state;
    return !!s && s.current === this.localSeat && !this.awaitingSync;
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
    const { phase } = this;
    if (phase.k === 'rejoining' && phase.fallback && (phase.fallback.waited += dt) >= RESUME_WAIT) this.catchUp(phase.fallback.rec, phase.fallback.replay);
    const s = this.state;
    if (s) {
      this.streamAim(s, dt);
      this.settleShot(s, dt);
    }
    // After the shot's settled: a phone that rejoined is caught up with the turn's result, not before it.
    this.sendResume();
  }

  /** Stream the aim while it's our turn to aim. */
  private streamAim(s: GameState, dt: number): void {
    if (this.canAct() && s.phase === 'aiming') {
      this.previewTimer -= dt;
      if (this.previewTimer <= 0) {
        this.previewTimer = PREVIEW_INTERVAL;
        const msg = previewOf(s);
        const key = JSON.stringify(msg);
        if (key !== this.lastPreview) {
          this.lastPreview = key;
          this.transport.send(msg satisfies NetMsg);
          this.events.emit('view', msg);
        }
      }
    }
  }

  /** A shot that has played out: send (or record) our result, or take theirs. */
  private settleShot(s: GameState, dt: number): void {
    if (!this.shot || !this.resolved(this.shot.turn)) {
      // Still playing out. A result that's already arrived gets a grace period, then wins anyway.
      if (this.pendingSync) {
        this.waitedForSync += dt;
        if (this.waitedForSync >= this.syncGrace) this.applySync(this.pendingSync);
      }
      return;
    }
    // Our shot has played out (or theirs has, and they've gone before sending its result): this
    // result is the one that counts.
    if (this.shot.owner === this.localSeat || (!this.pendingSync && this.peerAway)) this.ownResult(s, this.shot);
    else if (this.pendingSync) this.applySync(this.pendingSync);
  }

  /** The shot's result as it played out here is the one that counts: send it (our shot), show it and record it. */
  private ownResult(s: GameState, shot: { turn: number; owner: number }): void {
    netLog(`session: ${shot.owner === this.localSeat ? 'sending' : 'recording'} the result of turn ${shot.turn}`);
    const snap = takeSnapshot(s);
    const terrain = encodeSolid(s.terrain);
    if (shot.owner === this.localSeat) this.transport.send({ k: 'sync', turn: s.turn, snap, terrain } satisfies NetMsg);
    this.view('sync', snap, terrain);
    this.shot = null;
    this.lastShot = this.flyingShot;
    this.flyingShot = null;
    this.record(snap, terrain);
  }

  /**
   * Opened the match with nobody else there: carry on from its record. A shot left in flight is played out
   * here; otherwise, with `replay`, their last shot is shown again before snapping to how things stand.
   */
  catchUp(rec: GameRecord, replay: boolean): void {
    netLog(`session: catching up from the record (turn ${rec.snap.turn}${rec.flying ? ', a shot in flight' : replay && rec.last ? ', replaying their shot' : ''})`);
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
      putState(s, from.snap, from.terrain);
      fire(s);
      this.shot = { turn: from.turn, owner: from.owner };
      if (rec.flying) this.flyingShot = rec.flying;
      else {
        this.pendingSync = { k: 'sync', turn: rec.snap.turn, snap: rec.snap, terrain: rec.terrain };
        this.syncGrace = REPLAY_GRACE;
      }
    } else {
      putState(s, rec.snap, rec.terrain);
    }
    this.setPeerAway(true);
    this.events.emit('resumed', true);
  }

  /** Give up the match: the other player wins. */
  resign(): void {
    const s = this.state;
    if (!s || s.phase === 'gameover') return;
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
    this.end('away');
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
    this.store.save({ v: WIRE, rules: RULES, setup: this.setup, snap, terrain, last: this.lastShot, flying: this.flyingShot });
  }

  /** Carrying on without them (the guest started the match with the host away). */
  assumeAway(): void {
    this.setPeerAway(true);
  }

  private setPeerAway(away: boolean): void {
    if (this.peerAway === away) return;
    this.peerAway = away;
    this.events.emit('peerAway', away);
  }

  /** Catch up a phone that rejoined, from a settled moment (not mid-shot). Our result of that turn stands. */
  private sendResume(): void {
    // (Still being caught up ourselves: answer once we are.)
    if (!this.resumeWanted || this.phase.k === 'ended' || this.phase.k === 'rejoining') return;
    const s = this.state;
    if (s && s.phase !== 'aiming' && s.phase !== 'gameover') return;
    this.resumeWanted = false;
    if (s && this.shot && this.resolved(this.shot.turn)) {
      // Their shot has played out here: their result if it's come, else ours (they dropped out before sending it).
      if (this.pendingSync) this.applySync(this.pendingSync);
      else this.ownResult(s, this.shot);
    }
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
    this.end('left');
    this.transport.close();
  }

  /** The turn a shot was fired in is over (the next turn has come up, or the game has ended). */
  private resolved(turn: number): boolean {
    const g = this.game;
    return !!g && shotResolved(g, turn);
  }

  private view(why: 'start' | 'fire' | 'sync', snap: Snapshot, terrain: string): void {
    this.events.emit('view', { k: 'state', why, seed: this.setup.seed, players: this.setup.players, snap, terrain });
  }

  private begin(setup: MatchSetup): GameState {
    this.setup = setup;
    const game = this.onStart(setup.seed, setup.players);
    this.phase = { k: 'match', game };
    this.shot = null;
    this.pendingSync = null;
    this.syncGrace = SYNC_GRACE;
    this.lastShot = null;
    this.flyingShot = null;
    this.lastPreview = '';
    return game;
  }

  private applySync(msg: Extract<NetMsg, { k: 'sync' }>): void {
    const s = this.state!;
    netLog(`session: applying the other phone's result (now turn ${msg.snap.turn})`);
    putState(s, msg.snap, msg.terrain);
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
    if (this.phase.k === 'rejoining' && msg.k !== 'resume' && msg.k !== 'rejoin' && msg.k !== 'bye') return;
    switch (msg.k) {
      case 'hello':
        netLog(`session: hello from the other phone (${msg.pick.characterId})`);
        if (this.mismatched(msg)) return;
        this.remotePick = msg.pick;
        this.events.emit('lobby');
        return;
      case 'start': {
        // Usually the host starts; the guest does if it joined while the host was away.
        if (this.isHost && this.state) return;
        const s = this.begin({ seed: msg.seed, players: msg.players, rules: msg.rules, replay: msg.replay });
        // Same seed, same map, but make sure (maths can round differently between phones).
        s.terrain.patchSolid(decodeSolid(msg.terrain, s.terrain.solid.length));
        return;
      }
      case 'preview':
        if (this.state && this.state.current !== this.localSeat) applyPreview(this.state, msg);
        return;
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
        if (this.mismatched(msg)) return;
        this.transport.restart?.();
        this.resumeWanted = true;
        this.sendResume();
        return;
      case 'resume': {
        if (this.phase.k !== 'rejoining') return;
        const other = this.isHost ? 1 : 0;
        this.localPick = msg.picks[this.localSeat] ?? this.localPick;
        this.remotePick = msg.picks[other] ?? this.remotePick;
        if (msg.setup && msg.snap && msg.terrain) {
          netLog(`session: caught up (turn ${msg.snap.turn})`);
          const s = this.begin(msg.setup);
          putState(s, msg.snap, msg.terrain);
          this.events.emit('resumed', true);
        } else {
          netLog('session: caught up (lobby)');
          this.phase = { k: 'lobby' };
          this.events.emit('resumed', false);
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

  /**
   * The other phone runs another version (wire or rules): no playing together. Whoever's older is told to
   * reload (the site always serves the latest).
   */
  private mismatched(msg: { v: number; rules?: number }): boolean {
    if (msg.v === WIRE && msg.rules === RULES) return false;
    const who: Outdated = msg.v > WIRE || (msg.rules ?? 0) > RULES ? 'us' : 'them';
    netLog(`session: other phone runs wire ${msg.v} rules ${msg.rules ?? '?'}, this one ${WIRE} / ${RULES}: ${who === 'us' ? 'this phone' : 'the other phone'} needs to reload`);
    // Not the end of the match: leave the room as it is, to carry on once both are up to date.
    this.end('outdated');
    (this.transport.detach ?? this.transport.close).call(this.transport);
    this.events.emit('outdated', who);
    return true;
  }

  private drop(): void {
    if (this.lost) return;
    this.end('lost');
    this.transport.close();
    this.events.emit('lost');
  }

  private end(why: Extract<SessionPhase, { k: 'ended' }>['why']): void {
    this.phase = { k: 'ended', why, game: this.game };
    netLog(`session: ended (${why})`);
  }
}
