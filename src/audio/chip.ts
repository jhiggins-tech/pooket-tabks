/**
 * A tiny Game Boy-flavoured synth on Web Audio: pulse waves (12.5 / 25 / 50% duty) and a triangle for
 * tones, plus crunchy LFSR noise, with stepped pitch sweeps and simple volume envelopes. No samples.
 */

export type Duty = 0.125 | 0.25 | 0.5;

export interface ToneOpts {
  /** Seconds from now. */
  at?: number;
  dur: number;
  /** Start and end frequency in Hz (slides between them). */
  from: number;
  to?: number;
  duty?: Duty;
  wave?: 'pulse' | 'triangle';
  vol?: number;
  /** Quantise the slide into this many steps, like a hardware pitch sweep. */
  steps?: number;
  /** Wobble: [rate Hz, depth Hz]. */
  vibrato?: [number, number];
  /** Volume envelope as [time 0..1, level 0..1] points; default is a straight fade out. */
  env?: [number, number][];
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  vol?: number;
  /** Playback rate: lower is crunchier and lower pitched. */
  rate?: number;
  /** Slide the rate to this by the end. */
  to?: number;
  env?: [number, number][];
}

/** A scheduled sound that can be cut off early. */
export interface Voice {
  cut(): void;
}

/** What a sound recipe can play. The real Chip, or a recorder in tests. */
export interface Synth {
  tone(o: ToneOpts): Voice | void;
  noise(o: NoiseOpts): Voice | void;
}

/** Frequency of a MIDI note (69 = A4 = 440 Hz). */
export function midi(n: number): number {
  return 440 * 2 ** ((n - 69) / 12);
}

const MASTER_VOLUME = 0.5;

export class Chip implements Synth {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly pulses = new Map<number, PeriodicWave>();
  private muted = false;

  /** Pass an OfflineAudioContext to render sounds to a buffer (previews, tests). */
  constructor(private readonly offline?: OfflineAudioContext) {}

  /** Browsers only allow audio after a user gesture: call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!this.offline && !Ctor) return;
      const ctx: BaseAudioContext = this.offline ?? new Ctor();
      const comp = ctx.createDynamicsCompressor(); // keeps a pill storm from clipping
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(comp).connect(ctx.destination);
      this.noiseBuf = lfsrNoise(ctx);
      this.ctx = ctx;
    }
    const live = this.ctx as AudioContext;
    if (!this.offline && live.state === 'suspended') void live.resume();
  }

  get ready(): boolean {
    return !!this.ctx && (!!this.offline || this.ctx.state === 'running') && !this.muted;
  }

  /** Audio clock in seconds (0 before unlocking). */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setValueAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime);
  }

  tone(o: ToneOpts): Voice | void {
    const { ctx, master } = this;
    if (!ctx || !master || !this.ready) return;
    const t0 = ctx.currentTime + 0.01 + (o.at ?? 0);
    const osc = ctx.createOscillator();
    if (o.wave === 'triangle') osc.type = 'triangle';
    else osc.setPeriodicWave(this.pulse(o.duty ?? 0.5));
    const to = o.to ?? o.from;
    const f = osc.frequency;
    if (o.steps && to !== o.from) {
      for (let i = 0; i <= o.steps; i++) f.setValueAtTime(o.from * (to / o.from) ** (i / o.steps), t0 + (o.dur * i) / o.steps);
    } else {
      f.setValueAtTime(o.from, t0);
      if (to !== o.from) f.exponentialRampToValueAtTime(to, t0 + o.dur);
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato[0];
      const depth = ctx.createGain();
      depth.gain.value = o.vibrato[1];
      lfo.connect(depth).connect(f);
      lfo.start(t0);
      lfo.stop(t0 + o.dur + 0.02);
    }
    const g = this.envelope(t0, o.dur, o.vol ?? 0.2, o.env);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
    return this.voice(osc, g);
  }

  noise(o: NoiseOpts): Voice | void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf || !this.ready) return;
    const t0 = ctx.currentTime + 0.01 + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const rate = o.rate ?? 1;
    src.playbackRate.setValueAtTime(rate, t0);
    if (o.to !== undefined && o.to !== rate) src.playbackRate.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    const g = this.envelope(t0, o.dur, o.vol ?? 0.2, o.env);
    src.connect(g).connect(master);
    src.start(t0, Math.random() * noiseBuf.duration);
    src.stop(t0 + o.dur + 0.02);
    return this.voice(src, g);
  }

  /** A handle that silences a sound right now (abruptly, on purpose). */
  private voice(node: AudioScheduledSourceNode, g: GainNode): Voice {
    return {
      cut: () => {
        const now = this.ctx!.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
        try {
          node.stop(now);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  private envelope(t0: number, dur: number, vol: number, env?: [number, number][]): GainNode {
    const g = this.ctx!.createGain();
    const gain = g.gain;
    if (env) {
      gain.setValueAtTime(0, t0);
      for (const [t, v] of env) gain.linearRampToValueAtTime(Math.max(0, v) * vol, t0 + t * dur);
    } else {
      gain.setValueAtTime(vol, t0);
      gain.linearRampToValueAtTime(0, t0 + dur);
    }
    return g;
  }

  /** A pulse wave with the given duty cycle (the Game Boy's square channels). */
  private pulse(duty: number): PeriodicWave {
    let wave = this.pulses.get(duty);
    if (!wave) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      wave = this.ctx!.createPeriodicWave(real, imag);
      this.pulses.set(duty, wave);
    }
    return wave;
  }
}

/** One second of 15-bit LFSR noise, each bit held for a few samples: the crunchy Game Boy hiss. */
function lfsrNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let lfsr = 0x7fff;
  const hold = 4;
  for (let i = 0; i < data.length; i++) {
    if (i % hold === 0) {
      const bit = (lfsr ^ (lfsr >> 1)) & 1;
      lfsr = (lfsr >> 1) | (bit << 14);
    }
    data[i] = lfsr & 1 ? 0.8 : -0.8;
  }
  return buf;
}

/** A quick run of notes (MIDI numbers), `step` s apart. */
export function arp(s: Synth, notes: number[], step: number, o: { at?: number; dur?: number; duty?: 0.125 | 0.25 | 0.5; vol?: number; wave?: 'pulse' | 'triangle' } = {}): void {
  notes.forEach((n, i) =>
    s.tone({ at: (o.at ?? 0) + i * step, dur: o.dur ?? step * 0.9, from: midi(n), duty: o.duty ?? 0.25, vol: o.vol ?? 0.14, wave: o.wave }),
  );
}
