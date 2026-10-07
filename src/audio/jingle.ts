import type { Jingle, Rank } from '../stats/ranks';
import { arp, midi, type Synth, type ToneOpts } from './chip';
import { parseDrums, parsePart, partSteps } from './score';

/** Rank-up jingles (stats/ranks.ts gives each rank its score; ui/rankup.ts is the moment they play for). */

/** The tune's voices, at levels that sound alike (thinner pulses and the triangle are quieter). */
const LEAD_VOICES: Record<Jingle['voice'], Pick<ToneOpts, 'duty' | 'wave' | 'vol'>> = {
  square: { duty: 0.5, vol: 0.15 },
  reed: { duty: 0.25, vol: 0.16 },
  thin: { duty: 0.125, vol: 0.22 },
  flute: { wave: 'triangle', vol: 0.26 },
};

/**
 * A rank-up jingle (stats/ranks.ts): the rank's score, every part it has (the tune, then bass on a
 * triangle, harmony on thin pulses, noise drums), and on top what its sparkle adds: an echo of the tune
 * (1), a twinkle over the last note (2), the tune doubled a hair out of tune for a chorus, and a shimmer of
 * noise (3). Returns how long it lasts (s).
 */
export function rankJingle(s: Synth, rank: Pick<Rank, 'jingle' | 'sparkle'>): number {
  const j = rank.jingle;
  const step = 15 / j.bpm;
  const lead = parsePart(j.lead);
  const end = partSteps(j.lead) * step;
  const final = [...lead].reverse().find((n) => n.pitches.length);
  const voice = LEAD_VOICES[j.voice];
  for (const n of lead) {
    const [p] = n.pitches;
    if (p === undefined) continue;
    const last = n === final;
    const held = n.len >= 4;
    const tone: ToneOpts = {
      ...voice,
      at: n.at * step,
      dur: n.len * step * (last ? 1 : 0.95) + (last ? 0.3 : 0),
      from: midi(p),
      to: n.slideTo === undefined ? undefined : midi(n.slideTo),
      vibrato: held && n.slideTo === undefined ? [5.5, midi(p) * 0.012] : undefined,
      env: held ? [[0, 1], [0.3, 0.8], [1, 0]] : [[0, 1], [0.7, 0.75], [1, 0]],
    };
    s.tone(tone);
    if (rank.sparkle >= 1) s.tone({ ...tone, at: tone.at! + step * 3, duty: 0.125, wave: undefined, vol: 0.04 });
    if (rank.sparkle >= 3) s.tone({ ...tone, from: tone.from * 1.006, to: tone.to && tone.to * 1.006, duty: 0.5, wave: undefined, vol: 0.05 });
  }
  if (j.bass) {
    for (const n of parsePart(j.bass)) {
      for (const p of n.pitches) s.tone({ at: n.at * step, dur: n.len * step * 0.9, from: midi(p), wave: 'triangle', vol: 0.22, env: [[0, 1], [0.8, 0.7], [1, 0]] });
    }
  }
  if (j.harmony) {
    for (const n of parsePart(j.harmony)) {
      const vol = 0.07 / Math.max(1, n.pitches.length - 0.5);
      for (const p of n.pitches) s.tone({ at: n.at * step, dur: n.len * step * 0.95, from: midi(p), duty: 0.125, vol, env: [[0, 1], [0.15, 0.7], [0.85, 0.6], [1, 0]] });
    }
  }
  if (j.drums) {
    for (const hit of parseDrums(j.drums)) {
      const at = hit.at * step;
      for (const d of hit.drums) {
        if (d === 'k') {
          s.tone({ at, dur: 0.09, from: 160, to: 45, wave: 'triangle', vol: 0.28 });
          s.noise({ at, dur: 0.03, rate: 0.25, vol: 0.06 });
        } else if (d === 's') s.noise({ at, dur: 0.11, rate: 0.55, vol: 0.09 });
        else if (d === 'h') s.noise({ at, dur: 0.035, rate: 1, vol: 0.04 });
        else s.noise({ at, dur: Math.max(0.6, hit.len * step), rate: 0.9, to: 0.45, vol: 0.07 });
      }
    }
  }
  const top = final?.pitches[0];
  if (rank.sparkle >= 2 && top !== undefined && final) {
    const third = j.minor ? 15 : 16;
    arp(s, [top + 12, top + third, top + 19, top + 24], 0.05, { at: final.at * step + 0.25, duty: 0.125, vol: 0.06 });
    if (rank.sparkle >= 3) arp(s, [top + 24, top + 12 + third, top + 19, top + 12], 0.05, { at: final.at * step + 0.55, duty: 0.125, vol: 0.04 });
  }
  if (rank.sparkle >= 3 && final) s.noise({ at: final.at * step, dur: 0.8, rate: 0.95, to: 0.6, vol: 0.05 });
  return end + 0.3;
}
