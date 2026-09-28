import { currentPlayer, finishDecoyPick, fire } from '../game/game';
import type { GameState, Hop, PlayerConfig } from '../game/state';
import { netLog } from './log';
import { applySnapshot, decodeSolid, encodeSolid, takeSnapshot, type Snapshot } from './snapshot';
import type { Transport } from './transport';

/** Bumped whenever the messages or the game rules change: both phones must run the same code. */
export const PROTOCOL = 3;

/** What each phone picked in the lobby. */
export interface Pick {
  name: string;
  characterId: string;
}

export type NetMsg =
  | { k: 'hello'; v: number; pick: Pick }
  | { k: 'start'; seed: number; players: PlayerConfig[]; terrain: string }
  | { k: 'preview'; turn: number; x: number; y: number; fuel: number; angle: number; power: number; tier: number; hop: Hop | null }
  | { k: 'fire'; turn: number; snap: Snapshot }
  | { k: 'sync'; turn: number; snap: Snapshot; terrain: string }
  /** A phone that dropped out is back (on a new connection) and needs catching up. */
  | { k: 'rejoin'; v: number }
  /** The catch-up: both picks ([host, guest]), and the match as it stands (null: still in the lobby). */
  | { k: 'resume'; picks: [Pick | null, Pick | null]; setup: { seed: number; players: PlayerConfig[] } | null; snap: Snapshot | null; terrain: string | null }
  | { k: 'bye' };

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

/**
 * One networked match between two phones. Host is seat 0, guest is seat 1 (who goes first is up to the game).
 *
 * Both phones run the same deterministic simulation. The phone whose turn it is is in charge of it:
 * it streams aim/driving previews, and when it fires it sends a snapshot of the state just before the
 * shot, so both phones fire from exactly the same position. When the shot has played out it sends the
 * resulting state (and terrain) and the other phone snaps to it, so any drift (different phones can
 * round maths slightly differently) never lasts beyond a turn.
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

  private state: GameState | null = null;
  private setup: { seed: number; players: PlayerConfig[] } = { seed: 0, players: [] };
  /** The turn a shot was fired in (and whose it was) until its result is synced. */
  private shot: { turn: number; owner: number } | null = null;
  private pendingSync: Extract<NetMsg, { k: 'sync' }> | null = null;
  private waitedForSync = 0;
  private previewTimer = 0;
  private lastPreview = '';
  /** Rejoining: waiting to be caught up. */
  private rejoining = false;
  /** The other phone rejoined: catch it up once any shot in flight has played out. */
  private resumeWanted = false;

  constructor(
    private readonly transport: Transport,
    role: 'host' | 'guest',
  ) {
    this.localSeat = role === 'host' ? 0 : 1;
    transport.onMessage = (m) => this.receive(m as NetMsg);
    transport.onClose = () => this.drop();
    transport.onQuiet = (quiet) => {
      this.peerAway = quiet;
      this.onPeerAway(quiet);
    };
  }

  /** Back after dropping out, on a new connection: ask the other phone to catch us up. */
  rejoin(): void {
    netLog('session: rejoining');
    this.rejoining = true;
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

  /** Host: start (or restart) the match. Players are [host, guest]; colours are resolved by the caller. */
  start(seed: number, players: PlayerConfig[]): GameState {
    netLog(`session: starting a match (${players.map((p) => p.characterId).join(' vs ')})`);
    const state = this.begin(seed, players);
    const terrain = encodeSolid(state.terrain);
    this.transport.send({ k: 'start', seed, players, terrain } satisfies NetMsg);
    this.view('start', takeSnapshot(state), terrain);
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
    if (!fire(s)) return false;
    this.shot = { turn: snap.turn, owner: this.localSeat };
    netLog(`session: fired on turn ${snap.turn}`);
    this.transport.send({ k: 'fire', turn: snap.turn, snap } satisfies NetMsg);
    this.view('fire', snap, encodeSolid(s.terrain));
    return true;
  }

  /** Call once per frame after stepping the simulation. */
  tick(dt: number): void {
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
        if (this.waitedForSync >= SYNC_GRACE) this.applySync(this.pendingSync);
      }
      return;
    }
    if (this.shot.owner === this.localSeat) {
      // Our shot has played out: our result is the one that counts.
      netLog(`session: sending the result of turn ${this.shot.turn}`);
      const snap = takeSnapshot(s);
      const terrain = encodeSolid(s.terrain);
      this.transport.send({ k: 'sync', turn: s.turn, snap, terrain } satisfies NetMsg);
      this.view('sync', snap, terrain);
      this.shot = null;
    } else if (this.pendingSync) {
      this.applySync(this.pendingSync);
    }
  }

  /** Catch up a phone that rejoined, from a settled moment (not mid-shot). Our result of that turn stands. */
  private sendResume(): void {
    if (!this.resumeWanted || this.lost) return;
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

  private begin(seed: number, players: PlayerConfig[]): GameState {
    this.setup = { seed, players };
    this.state = this.onStart(seed, players);
    this.shot = null;
    this.pendingSync = null;
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
  }

  private receive(msg: NetMsg): void {
    if (this.lost) return;
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
        if (this.isHost) return;
        const s = this.begin(msg.seed, msg.players);
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
        this.localPick = msg.picks[this.localSeat] ?? this.localPick;
        this.remotePick = msg.picks[other] ?? this.remotePick;
        if (msg.setup && msg.snap && msg.terrain) {
          netLog(`session: caught up (turn ${msg.snap.turn})`);
          const s = this.begin(msg.setup.seed, msg.setup.players);
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
    }
  }

  private drop(): void {
    if (this.lost) return;
    this.lost = true;
    this.transport.close();
    this.onLost();
  }
}
