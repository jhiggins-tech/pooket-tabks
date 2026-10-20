import { concede, finishDecoyPick, fire } from '../game/game';
import type { GameState, PlayerConfig } from '../game/state';
import { Emitter } from '../core/emitter';
import type { MatchChannel } from './channel';
import { applyPreview, LIVE, previewOf, putState, ResultBuffer, type Preview } from './follow';
import { netLog } from './log';
import { recordCompat, type GameRecord, type GameStore, type ShotRecord } from './record';
import { encodeSolid, takeSnapshot, type Snapshot } from './snapshot';
import { newReplayId } from './replay';
import { otherSeat, seatOf } from './seat';
import { RULES, WIRE } from './version';
import { randomId } from './rooms';

/**
 * A match's setup: the map's seed, the players ([host, guest]), the game rules it started on (version.ts),
 * who went first (the guest: whoever joins has the first go), and (a public match) the id its replay is
 * recorded under (replay.ts).
 */
export interface MatchSetup {
  seed: number;
  players: PlayerConfig[];
  rules: number;
  first: number;
  replay?: string;
}

/** Which phone is out of date: this one (it should reload) or the other one. */
export type Outdated = 'us' | 'them';

/** Who's playing, as which character (the host's comes from its open offer). */
export interface Pick {
  name: string;
  characterId: string;
  /** Signed in with Google: their stats key (stats/summary.ts `playerKey`), so the other phone can show their rank. */
  key?: string;
}

/** Just who and as which character (a pick or a player, without the rest). */
export function brief(p: { name: string; characterId: string }): { name: string; characterId: string } {
  return { name: p.name, characterId: p.characterId };
}

/**
 * What spectators get: the latest full state (why: a match started, a shot was fired from it, or it's a
 * turn's result), complete with the match setup and terrain so they can join at any point; and the live
 * aim (which the other player's phone follows too).
 */
export type ViewMsg =
  | { k: 'state'; why: 'start' | 'fire' | 'sync'; seed: number; players: PlayerConfig[]; snap: Snapshot; terrain: string }
  | Preview;

/** How a move played out: the state after it (a turn's result). */
interface Result {
  snap: Snapshot;
  terrain: string;
}

/** A move playing out here: its turn, whose, and its number. */
interface Playing {
  turn: number;
  owner: number;
  seq: number;
}

/** How often the player whose turn it is streams their aim and position to the other phone. */
const PREVIEW_INTERVAL = 1 / 15;
/** Replaying a move whose result is already known: let it play out, within reason. */
const REPLAY_GRACE = 60;
/** A move replayed before another (missed while away) is moved on from after this long, played out or not. */
const MOVE_MAX = 30;
/** A move being replayed: its aim, shown for this long before it's fired. */
const SHOW_AIM = 1;
/**
 * The other player's shot has played out here but its result hasn't come: if they're not here (their phone
 * went away mid-shot), record it as it played out here; if they are, give them this long first.
 */
const ORPHAN_WAIT = 15;

/** What a session tells the screens (NetSession.on). */
export interface SessionEvents extends Record<string, unknown[]> {
  /** The match is over for this phone: the room has gone. */
  lost: [];
  /** A newer version of the game wrote the match's record: this phone has to reload first. */
  outdated: [who: Outdated];
  /** The other player has gone (true: not got the match open) or is here (false). */
  peerAway: [away: boolean];
  /** A move is fired (by either phone, or played out from the record): the state just before it. */
  shot: [shot: ShotRecord];
}

/**
 * One online match on this phone: a seat in a room, played turn by turn through the match's record
 * (record.ts), which both phones follow (`MatchChannel`, channel.ts). There's no lobby and no handshake:
 * the guest starts the match as it joins (`start`), and either phone opens it whenever (`open`).
 *
 * Both phones run the same deterministic simulation. The phone whose turn it is is in charge of it: it
 * streams its aim (the live aim, `view`), and when it fires it writes the record with the exact state just
 * before the move, so every phone plays it out from the same place; when it has played out it writes the
 * result, and every other phone snaps to it, so any drift (different phones can round maths slightly
 * differently) never lasts beyond a move. A phone that opens the match plays out the other player's moves
 * it hasn't seen (`seen`) before it snaps to how things stand.
 *
 * If the shooter's phone goes away mid-shot, the shot (in the record as fired) is played out by whichever
 * phone has the match open next, and its result recorded from there; the record's numbering (`n`) makes
 * sure only one result ever counts.
 */
export class NetSession {
  readonly localSeat: 0 | 1;
  localPick: Pick | null = null;
  remotePick: Pick | null = null;

  /** Build a fresh game for these players (every phone calls createGame with the same seed and first player). */
  onStart: (seed: number, players: PlayerConfig[], first: number) => GameState = () => {
    throw new Error('onStart not set');
  };
  /** Whether the other player hasn't got the match open (until we hear otherwise, they haven't). */
  peerAway = true;
  /** Where else this phone's records go (a public match's replay). */
  store: GameStore | null = null;
  /** A match this phone starts is public (on the Games list): record its replay. */
  publicReplay = false;

  private readonly events = new Emitter<SessionEvents>();
  private phase: SessionPhase = { k: 'idle' };
  private setup: MatchSetup = { seed: 0, players: [], rules: RULES, first: 0 };
  /** This session's id: its records say it wrote them (so it knows its own when they come back). */
  private readonly id = randomId();
  /** The newest record's number (and whether this phone wrote it), and how many moves the match has had. */
  private n = 0;
  private wroteN = false;
  private fired = 0;
  /** The moves since the other player last moved (the record's `moves`). */
  private moves: ShotRecord[] = [];
  /** The move in flight whose result is this phone's to record: its own (or theirs, if they've gone). */
  private flying: ShotRecord | null = null;
  /** The other player's move playing out here (its record, for recording its result if they've gone). */
  private flyingIn: ShotRecord | null = null;
  /** The newest move played out here (or on its way to be), and the newest seen played out to the end. */
  private played = 0;
  private seenSeq = 0;
  /** The move playing out here, and the result for it once it's in (or known already). */
  private readonly shots = new ResultBuffer<Result, Playing>();
  /**
   * Moves still to play out here after the one playing (missed while away), and how things stood after
   * the last of them (null: its result is still to come). A move being replayed shows its aim for a moment
   * first (`aiming`).
   */
  private queue: ShotRecord[] = [];
  private after: Result | null = null;
  private aiming: { move: ShotRecord; wait: number } | null = null;
  /** How long the move playing out here (one of several to replay) has been going. */
  private moveClock = 0;
  /** How long the other player's move has been played out here with no result from them. */
  private orphaned = 0;
  /** Playing out moves this phone missed (it can skip them). */
  private catchingUp = false;
  private previewTimer = 0;
  private lastPreview = '';

  constructor(
    private readonly channel: MatchChannel,
    role: 'host' | 'guest',
  ) {
    this.localSeat = seatOf(role);
    channel.onRecord = (rec) => this.receive(rec);
    channel.onAim = (p) => {
      const s = this.state;
      if (s && s.current !== this.localSeat && !this.busy) applyPreview(s, p);
    };
    channel.onPresence = (here) => this.setPeerAway(!here);
    channel.onClose = () => this.drop();
    channel.start();
  }

  /** Listen for one of the session's events (see SessionEvents); returns the function that stops listening. */
  on<E extends keyof SessionEvents>(event: E, fn: (...args: SessionEvents[E]) => void): () => void {
    return this.events.on(event, fn);
  }

  /** Over for this phone: it left (for now), stood aside for the player's other phone, needs an update, or the room went. */
  get ended(): boolean {
    return this.phase.k === 'ended';
  }

  get isHost(): boolean {
    return this.localSeat === 0;
  }

  get game(): GameState | null {
    return this.phase.k === 'idle' ? null : this.phase.game;
  }

  /** The game, while the match is on (not once this phone has left it). */
  private get state(): GameState | null {
    return this.phase.k === 'match' ? this.phase.game : null;
  }

  /** The match's setup (seed, players, the rules it started on, who went first). */
  get matchSetup(): MatchSetup {
    return this.setup;
  }

  /** The newest move this phone has seen played out (kept with its seat: what it missed is replayed when it's back). */
  get seen(): number {
    return this.seenSeq;
  }

  /** Playing out the other player's moves this phone missed (`skip` jumps to how things stand). */
  get replaying(): boolean {
    return this.catchingUp && !this.ended;
  }

  /**
   * Start the match: the guest does, as it joins (players are [host, guest], their colours worked out by
   * the caller). The guest has the first go: whoever joins has something to do straight away.
   */
  start(seed: number, players: PlayerConfig[]): GameState {
    netLog(`session: starting a match (${players.map((p) => p.characterId).join(' vs ')})`);
    const replay = this.publicReplay ? newReplayId() : undefined;
    const s = this.begin({ seed, players, rules: RULES, first: this.localSeat, ...(replay ? { replay } : {}) });
    this.save('start');
    return s;
  }

  /**
   * Open the match from its record (`seen`: the newest move this phone saw played out, last time it had it
   * open). The other player's moves since then are played out again, then it carries on from how things
   * stand; a move left in flight (its phone went away mid-shot) is played out here, and its result recorded.
   */
  open(rec: GameRecord, seen = 0): GameState | null {
    if (this.outdated(rec)) return null;
    netLog(`session: opening the match (turn ${rec.snap.turn}, ${rec.fired} moves${rec.flying ? `, move ${rec.flying.seq} in flight` : ''}; seen ${seen})`);
    const s = this.begin(rec.setup);
    this.n = rec.n;
    this.fired = rec.fired;
    this.moves = rec.moves;
    this.played = this.seenSeq = seen;
    const missed = rec.moves.filter((m) => m.seq > seen && m.owner !== this.localSeat);
    // (A move left in flight always plays out: whoever fired it, and whether or not it was seen to begin.)
    const fly = rec.flying;
    if (fly?.owner === this.localSeat) this.flying = fly; // ours: its result is ours to record
    if (!missed.length && !fly) {
      putState(s, rec.snap, rec.terrain);
      this.played = this.seenSeq = rec.fired;
      return s;
    }
    this.catchingUp = missed.length > 0;
    this.play([...missed, ...(fly ? [fly] : [])], fly ? null : rec);
    this.played = Math.max(this.played, rec.fired);
    return s;
  }

  /** Whether this phone may act now: its own turn, and nothing of the other player's still to play out here. */
  canAct(): boolean {
    const s = this.state;
    return !!s && s.current === this.localSeat && !this.busy && !this.awaitingSync;
  }

  /** The other player's move has played out here, and its result hasn't come yet. */
  get awaitingSync(): boolean {
    const { shot } = this.shots;
    return shot !== null && shot.owner !== this.localSeat && this.shots.resolved(this.game);
  }

  /** Playing out the other player's moves here (one is under way, or more are to come). */
  private get busy(): boolean {
    const { shot } = this.shots;
    return this.queue.length > 0 || this.aiming !== null || (shot !== null && shot.owner !== this.localSeat && !this.shots.resolved(this.game));
  }

  /** Fire for the local player: into the record (with the exact state just before it), and here. */
  fire(): boolean {
    const s = this.state;
    if (!s || !this.canAct()) return false;
    // The swap target is a secret: the other phone learns where we went from the result.
    const snap = this.sharedSnapshot(s);
    const terrain = encodeSolid(s.terrain);
    if (!fire(s)) return false;
    const seq = ++this.fired;
    this.played = this.seenSeq = seq;
    this.shots.reset(); // (anything of theirs is done with: it's our move now)
    this.flyingIn = null;
    // In the record at once: closing the app mid-shot doesn't undo it.
    this.flying = { turn: snap.turn, owner: this.localSeat, seq, snap, terrain };
    this.shots.fired({ turn: snap.turn, owner: this.localSeat, seq });
    netLog(`session: fired move ${seq} on turn ${snap.turn}`);
    this.save('fire');
    this.events.emit('shot', this.flying);
    return true;
  }

  /** Jump past the other player's moves being replayed: to how things stand (or to their move in flight). */
  skip(): void {
    const s = this.state;
    if (!s || !this.catchingUp) return;
    netLog('session: skipping the replay');
    this.catchingUp = false;
    const known = this.after ?? (this.queue.length || this.aiming ? null : this.shots.pending);
    const last = this.queue.at(-1) ?? this.aiming?.move ?? null;
    this.queue = [];
    this.aiming = null;
    this.after = null;
    if (known) this.applyResult(known);
    else if (last) this.launch(s, last); // their move in flight: from just before it, at once
  }

  /** Call once per frame after stepping the simulation. */
  tick(dt: number): void {
    const s = this.state;
    if (!s) return;
    this.streamAim(s, dt);
    this.playOn(s, dt);
    this.settle(s, dt);
  }

  /** Give up the match: the other player wins. */
  resign(): void {
    const s = this.state;
    if (!s || s.phase === 'gameover') return;
    netLog('session: resigning');
    concede(s, this.localSeat, 'resigned');
    this.overNow();
  }

  /** Nobody's moved for three days: whoever's turn it is loses. */
  forfeit(): void {
    const s = this.state;
    if (!s || s.phase === 'gameover') return;
    netLog(`session: ${s.players[s.current]?.name ?? 'someone'} ran out of time`);
    concede(s, s.current, 'timeout');
    this.overNow();
  }

  /** Leave the match for now (it carries on turn by turn): stop following it, the room as it is. */
  away(): void {
    if (this.ended) return;
    netLog('session: leaving the match for now');
    this.end('away');
    this.channel.close(true);
  }

  /**
   * This player has opened the match on another phone, which has taken the seat (rooms.ts `watchSeat`):
   * stop here without a word (the other phone is the one playing now), leaving the room as it is.
   */
  standDown(): void {
    if (this.ended) return;
    netLog('session: standing aside for this player’s other phone');
    this.end('away');
    this.channel.close(false);
  }

  /** Stream the aim while it's our turn to aim. */
  private streamAim(s: GameState, dt: number): void {
    if (!this.canAct() || !LIVE.has(s.phase)) return;
    this.previewTimer -= dt;
    if (this.previewTimer > 0) return;
    this.previewTimer = PREVIEW_INTERVAL;
    const msg = previewOf(s);
    const key = JSON.stringify(msg);
    if (key === this.lastPreview) return;
    this.lastPreview = key;
    this.channel.view(msg);
  }

  /**
   * The other player's moves to play out here, in order; `then`: how things stood after the last (null:
   * its result is still to come). Catching up, they're played one after another; otherwise (they're here,
   * playing) a newer move overtakes whatever of theirs is still playing out: it was fired from after it.
   */
  private play(moves: ShotRecord[], then: Result | null): void {
    const s = this.state!;
    this.played = Math.max(this.played, ...moves.map((m) => m.seq));
    const last = moves.at(-1);
    if (last && last.owner !== this.localSeat && !then) this.flyingIn = last;
    if (this.catchingUp && (this.busy || this.queue.length)) {
      this.queue.push(...moves);
      this.after = then;
      return;
    }
    this.queue = moves.slice(1);
    this.after = then;
    const first = moves[0];
    if (!first) return;
    if (this.catchingUp) this.aiming = { move: first, wait: SHOW_AIM };
    else this.launch(s, first);
    if (this.catchingUp) this.showAim(s, first);
  }

  /** Put everything as it was just before a move (showing its aim, a replay's first moment). */
  private showAim(s: GameState, move: ShotRecord): void {
    this.shots.reset();
    putState(s, move.snap, move.terrain);
  }

  /** Fire a move here, from just before it. */
  private launch(s: GameState, move: ShotRecord): void {
    netLog(`session: playing out move ${move.seq} (turn ${move.turn})`);
    this.aiming = null;
    this.shots.reset();
    putState(s, move.snap, move.terrain);
    this.events.emit('shot', move);
    fire(s);
    finishDecoyPick(s); // which decoy they swapped into (if any) shows from the result
    this.shots.fired({ turn: move.turn, owner: move.owner, seq: move.seq });
    this.moveClock = 0;
    this.orphaned = 0;
    if (!this.queue.length && this.after) {
      this.shots.known(this.after, REPLAY_GRACE);
      this.after = null;
    }
  }

  /** Moves being replayed: show each one's aim for a moment, fire it, and on to the next once it has played out. */
  private playOn(s: GameState, dt: number): void {
    if (this.aiming) {
      if ((this.aiming.wait -= dt) <= 0) this.launch(s, this.aiming.move);
      return;
    }
    if (!this.queue.length || !this.shots.shot) return;
    this.moveClock += dt;
    const done = (this.moveClock > 0.5 && (s.phase === 'aiming' || s.phase === 'gameover')) || this.moveClock > MOVE_MAX;
    if (!done) return;
    const next = this.queue.shift()!;
    if (this.catchingUp) {
      this.aiming = { move: next, wait: SHOW_AIM };
      this.showAim(s, next);
    } else this.launch(s, next);
  }

  /** The move playing out here: once it has, its result (theirs), or ours (our move, or theirs with them gone). */
  private settle(s: GameState, dt: number): void {
    const shot = this.shots.shot;
    if (!shot || this.queue.length || this.aiming) return;
    const pending = this.shots.pending;
    // A bonus move (or free action) settles back into the same turn: done once it's back to aiming.
    const backToAiming = s.phase === 'aiming' && s.turn === shot.turn;
    if (shot.owner !== this.localSeat) {
      if (pending && (this.shots.resolved(s) || (backToAiming && turnOf(pending) === shot.turn))) return this.applyResult(pending);
      if (!this.shots.resolved(s)) {
        // Still playing out. A result that's already arrived gets a grace period, then wins anyway.
        const due = this.shots.due(dt);
        if (due) this.applyResult(due);
        return;
      }
      // Played out here with no result from them: they've gone (or are taking far too long).
      this.orphaned += dt;
      if (this.peerAway || this.orphaned > ORPHAN_WAIT) this.ownResult(s, this.flyingIn);
      return;
    }
    if (this.shots.resolved(s)) this.ownResult(s, this.flying);
    else if (backToAiming && this.flying) this.ownBonus(s);
  }

  /** A move's result as it played out here is the one that counts: into the record (and out to spectators). */
  private ownResult(s: GameState, move: ShotRecord | null): void {
    netLog(`session: recording ${move?.owner === this.localSeat ? 'our' : 'their'} move's result (now turn ${s.turn})`);
    if (move) this.moves = [...(this.moves.at(-1)?.owner === move.owner ? this.moves.filter((m) => m.seq < move.seq) : []), move];
    this.flying = this.flyingIn = null;
    this.shots.settledHere();
    this.seenSeq = Math.max(this.seenSeq, this.played);
    this.catchingUp = false;
    this.save('sync');
  }

  /** Our bonus move (or free action) has played out, and it's still our turn: how things stand now goes in the record. */
  private ownBonus(s: GameState): void {
    netLog(`session: our bonus move has played out (turn ${s.turn})`);
    this.flying = null;
    this.shots.settledHere();
    this.save('sync');
  }

  /** Snap to the other player's result. */
  private applyResult(r: Result): void {
    const s = this.state!;
    netLog(`session: applying their result (now turn ${turnOf(r)})`);
    putState(s, r.snap, r.terrain);
    this.shots.applied();
    this.flyingIn = null;
    this.seenSeq = Math.max(this.seenSeq, this.played);
    this.catchingUp = false;
  }

  /** The match ended between moves (resigned, out of time): no move in flight, and into the record. */
  private overNow(): void {
    this.queue = [];
    this.after = null;
    this.aiming = null;
    this.flying = this.flyingIn = null;
    this.shots.reset();
    this.catchingUp = false;
    this.save('sync');
  }

  /** A record written by someone (this phone's own come back too, and are passed over). */
  private receive(rec: GameRecord): void {
    if (this.phase.k !== 'match' || rec.by === this.id) return;
    // Older than ours, or the one we have; but the same number as one we wrote is the other phone's
    // write winning the race to it: theirs stands.
    if (rec.n < this.n || (rec.n === this.n && !this.wroteN)) return;
    if (this.outdated(rec)) return;
    const s = this.state!;
    this.n = rec.n;
    this.wroteN = false;
    this.fired = Math.max(this.fired, rec.fired);
    this.moves = rec.moves;
    netLog(`session: record #${rec.n} in (turn ${rec.snap.turn}${rec.flying ? `, move ${rec.flying.seq} in flight` : ''})`);
    const result: Result = { snap: rec.snap, terrain: rec.terrain };
    // Our move in flight, overtaken (they recorded it, thinking us gone): their record stands.
    if (this.flying && rec.fired >= this.flying.seq && rec.flying?.seq !== this.flying.seq) this.flying = null;
    const fresh = [...rec.moves, ...(rec.flying ? [rec.flying] : [])].filter((m) => m.seq > this.played && m.owner !== this.localSeat);
    if (rec.snap.phase === 'gameover' && !fresh.length) {
      // Over (resigned, or out of time): that's how it ended, whatever's playing out here.
      return this.over(s, result, rec.fired);
    }
    if (fresh.length) return this.play(fresh, rec.flying && fresh.at(-1) === rec.flying ? null : result);
    if (rec.flying) return; // (a move already playing out here: its result is still to come)
    const shot = this.shots.shot;
    if (this.queue.length || this.aiming) this.after = result;
    else if (shot && shot.owner !== this.localSeat) {
      this.shots.resultIn(result);
      finishDecoyPick(s); // they've finished picking a decoy, if they were
    } else {
      // Nothing of theirs playing out here: how things stand (their bonus move settled, or they recorded
      // our move's result first, thinking us gone).
      this.flying = null;
      this.shots.reset();
      putState(s, rec.snap, rec.terrain);
      this.seenSeq = Math.max(this.seenSeq, rec.fired);
    }
  }

  /** Straight to how it ended. */
  private over(s: GameState, r: Result, fired: number): void {
    this.queue = [];
    this.after = null;
    this.aiming = null;
    this.flying = this.flyingIn = null;
    this.shots.reset();
    this.catchingUp = false;
    putState(s, r.snap, r.terrain);
    this.played = this.seenSeq = Math.max(this.played, fired);
  }

  /** A record from a newer version of the game: this phone has to reload before it can carry on. */
  private outdated(rec: GameRecord): boolean {
    if (recordCompat(rec) !== 'newer') return false;
    netLog(`session: the record was written by a newer version (wire ${rec.v}, rules ${rec.rules}; this one ${WIRE} / ${RULES})`);
    this.end('outdated');
    this.channel.close(true);
    this.events.emit('outdated', 'us');
    return true;
  }

  /**
   * Into the record (as number `n + 1`), out to spectators, and to the replay (a public match). Between
   * moves the record has the state as it stands; with a move just fired, the state it was fired from.
   */
  private save(why: 'start' | 'fire' | 'sync'): void {
    const s = this.state;
    if (!s) return;
    const snap = why === 'fire' && this.flying ? this.flying.snap : takeSnapshot(s);
    const terrain = why === 'fire' && this.flying ? this.flying.terrain : encodeSolid(s.terrain);
    const rec: GameRecord = {
      v: WIRE,
      rules: RULES,
      n: ++this.n,
      by: this.id,
      setup: this.setup,
      snap,
      terrain,
      fired: this.fired,
      moves: this.moves,
      flying: this.flying,
    };
    this.wroteN = true;
    this.channel.save(rec);
    this.store?.save(rec);
    this.channel.view({ k: 'state', why, seed: this.setup.seed, players: this.setup.players, snap, terrain });
  }

  /** The state as the other phone may see it: the swap target is a secret (it learns it from the result). */
  private sharedSnapshot(s: GameState): Snapshot {
    const snap = takeSnapshot(s);
    snap.swapTargetId = null;
    return snap;
  }

  private setPeerAway(away: boolean): void {
    if (this.peerAway === away) return;
    this.peerAway = away;
    this.events.emit('peerAway', away);
  }

  private begin(setup: MatchSetup): GameState {
    this.setup = setup;
    const pick = (p: PlayerConfig | undefined): Pick | null => (p ? { ...brief(p), ...(p.key ? { key: p.key } : {}) } : null);
    this.localPick = pick(setup.players[this.localSeat]) ?? this.localPick;
    this.remotePick = pick(setup.players[otherSeat(this.localSeat)]) ?? this.remotePick;
    const game = this.onStart(setup.seed, setup.players, setup.first);
    this.phase = { k: 'match', game };
    this.shots.reset();
    this.queue = [];
    this.after = null;
    this.aiming = null;
    this.lastPreview = '';
    return game;
  }

  private drop(): void {
    if (this.ended) return;
    this.end('lost');
    this.channel.close(false);
    this.events.emit('lost');
  }

  private end(why: 'away' | 'outdated' | 'lost'): void {
    this.phase = { k: 'ended', why, game: this.game };
    netLog(`session: ended (${why})`);
  }
}

/** Where a session is: no match yet, the match (played or watched here), or done with it on this phone. */
type SessionPhase = { k: 'idle' } | { k: 'match'; game: GameState } | { k: 'ended'; why: 'away' | 'outdated' | 'lost'; game: GameState | null };

/** The turn a result leaves the match on. */
const turnOf = (r: Result): number => (r.snap as { turn?: number }).turn ?? 0;
