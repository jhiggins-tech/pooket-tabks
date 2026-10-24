/**
 * kiwicore's Long Exposure on the HUD (game/camera.ts): the camera body round the viewfinder. The left grip
 * has the mode dial, WB, ISO, the flash, the lens, AF/MF and AF-ON; the right the top LCD, the main dial,
 * the shutter and the quick control dial with SET; under the viewfinder its info line (with the meter and
 * the focus dot) and the lens's focus ring. The viewfinder itself is the battlefield, drawn by the renderer
 * through the frame (render/canvas.ts); over it, the light's grade, the white balance's tint, the grain, the
 * thirds grid and the AF points. After a shot, playback (its grades, damage and a tip) or, at the end, the
 * showcase, out of the camera and over the battlefield: the best photo's grades stacking up one by one, the damage counting up and the big reveal. The controls are this phone's only while it's his turn here (input/controls.ts takes them);
 * watching, they're the same screen, untouchable, with a LIVE badge. Once it's fired, the best photo
 * shows as a print while it develops.
 */
import { bestPhoto, dialRole, exposureOf, FACTORS, gradeAt, GRADES, gradeRank, meter, overallOf, REVEAL, ringMetres, WARN } from '../../game/game';
import type { Camera, GameState, Photo } from '../../game/state';
import { APERTURES, ISOS, LENSES, MODES, SCENES, SHUTTERS, WHITE_BALANCE } from '../../weapons/camera';
import { weaponOf } from '../../weapons/registry';
import { byId, el, query } from '../../ui/dom';
import { keyed, type Part } from './part';

/** A score as a grade. */
export function grade(v: number): string {
  return GRADES[gradeRank(v)]!;
}

/** The focus ring's distance, as its window shows it. */
function metres(ring: number): string {
  const m = ringMetres(ring);
  return m === Infinity ? '∞' : `${m.toFixed(m < 10 ? 1 : 0)} m`;
}

export function camera(): Part {
  const root = byId('camera');
  const $ = (sel: string) => query(`#camera ${sel}`);
  const ring = $('.cam-ring-input') as HTMLInputElement;
  const playback = $('.cam-playback');
  const print = byId('camera-print');
  const frame = byId('camera-vf');
  let photos = -1;
  const count = el('span', 'cam-count');
  frame.append(count);
  const showcase = byId('camera-showcase');
  const viewfinder = keyed(
    (state, ctx) => {
      const c = state.camera;
      if (!c || c.outro !== null) return '';
      const m = meter(state, c);
      return [JSON.stringify({ ...c, t: 0, x: 0, y: 0, reveal: 0, left: Math.ceil(c.left) }), m.scores[1]! >= 0.95 && !!m.subject, Math.round(m.err * 10), Math.round(m.mireds), ctx.remote].join('|');
    },
    (state, ctx) => {
      const c = state.camera;
      const on = !!c && c.outro === null && c.view !== 'card' && state.phase === 'shooting';
      root.hidden = !on;
      if (!c || !on) {
        photos = -1;
        return;
      }
      const owner = state.players[c.playerId]!;
      root.classList.toggle('remote', ctx.remote);
      const mode = MODES[c.mode]!;
      const lens = LENSES[c.lens]!;
      const { ap, sh } = exposureOf(c);
      const m = meter(state, c);
      const wb = WHITE_BALANCE[c.wb]!;
      const light = SCENES[c.scene]!;
      // The left grip.
      root.style.setProperty('--dial', `${-c.mode * 50}deg`);
      $('.cam-mode').setAttribute('aria-label', `Mode dial: ${mode.id}`);
      [...$('.cam-mode-ring').children].forEach((s, i) => s.classList.toggle('on', i === c.mode));
      $('[data-cam="fn:wb"]').classList.toggle('on', c.fn === 'wb');
      $('[data-cam="fn:iso"]').classList.toggle('on', c.fn === 'iso');
      $('[data-cam="flash"]').classList.toggle('on', c.flash);
      const lensBtn = $('.cam-lens');
      lensBtn.replaceChildren(String(lens.mm), el('small', undefined, 'mm'));
      lensBtn.setAttribute('aria-label', `Swap lens, now ${lens.name}`);
      root.classList.toggle('af', c.af);
      $('.cam-help').textContent = ctx.remote ? `${owner.name} is shooting` : c.fn ? `Turn a dial to set ${c.fn === 'iso' ? 'ISO' : 'white balance'}. SET when done.` : 'Drag the viewfinder to look round.';
      // The viewfinder's overlays: the light, the white balance, the grain.
      root.style.setProperty('--grade', light.grade);
      root.style.setProperty('--grade-a', String(light.strength));
      root.style.setProperty('--tint', m.mireds > 0 ? '#ff8a1f' : '#2f6bff');
      root.style.setProperty('--tint-a', String(Math.min(0.5, Math.abs(m.mireds) / 200)));
      root.style.setProperty('--grain', String(m.noise * 0.12));
      $('.cam-scene').textContent = `${lens.name} · ${light.name}`;
      const left = $('.cam-left');
      left.textContent = `${Math.ceil(c.left)}s`;
      left.classList.toggle('low', c.left <= WARN);
      // 3, 2, 1: big in the viewfinder.
      const n = Math.ceil(c.left);
      count.textContent = c.view === 'aim' && n <= 3 && n > 0 ? String(n) : '';
      count.classList.remove('tick');
      if (count.textContent) {
        void count.offsetWidth;
        count.classList.add('tick');
      }
      $('.cam-live').textContent = ctx.remote ? `LIVE · ${owner.name} is lining up a shot` : '';
      // The info line and the top LCD.
      const av = `F${APERTURES[ap]}`;
      $('.cam-i-mode').textContent = mode.id;
      $('.cam-i-tv').textContent = SHUTTERS[sh]!.label;
      $('.cam-i-av').textContent = av;
      root.style.setProperty('--needle', `${50 + (Math.max(-2, Math.min(2, -m.err)) / 2) * 50}%`);
      $('.cam-i-iso').textContent = `ISO${ISOS[c.iso]}`;
      $('.cam-i-flash').textContent = c.flash ? 'ϟ' : '';
      $('.cam-i-dot').classList.toggle('on', m.scores[1]! >= 0.95 && !!m.subject);
      $('.cam-l-tv').textContent = SHUTTERS[sh]!.lcd;
      $('.cam-l-av').textContent = av;
      $('.cam-l-iso').textContent = `ISO ${ISOS[c.iso]}`;
      $('.cam-l-iso').classList.toggle('on', c.fn === 'iso');
      $('.cam-l-wb').textContent = wb.lcd;
      $('.cam-l-wb').classList.toggle('on', c.fn === 'wb');
      $('.cam-l-mode').textContent = `${mode.id} ${c.af ? 'AF' : 'MF'}`;
      $('.cam-l-shots').textContent = `[${weaponOf(c.weaponId, 'camera').camera.shots - c.photos.length}]`;
      $('.cam-dial-role.main').textContent = `MAIN DIAL · ${dialRole(c, 'main')}`;
      $('.cam-dial-role.quick').textContent = `QUICK DIAL · ${dialRole(c, 'quick')}`;
      // The focus ring.
      $('.cam-ring-label b').textContent = metres(c.ring);
      if (document.activeElement !== ring || ctx.remote) ring.value = String(c.ring);
      ring.disabled = c.af || ctx.remote;
      $('.cam-ring-note').textContent = c.af ? 'AF: use AF-ON' : 'MF';
      for (const b of root.querySelectorAll<HTMLButtonElement>('button')) b.disabled = ctx.remote;
      // A photo just taken: the shutter blinks (white, with the flash).
      if (photos >= 0 && c.photos.length > photos) {
        frame.classList.remove('blink', 'flash');
        void frame.offsetWidth;
        frame.classList.add('blink');
        frame.classList.toggle('flash', !!c.photos.at(-1)?.flash);
      }
      photos = c.photos.length;
      showPlayback(c, ctx.remote);
    },
  );
  function showPlayback(c: Camera, remote: boolean): void {
    playback.hidden = c.view !== 'review';
    if (c.view !== 'review') return;
    const shots = weaponOf(c.weaponId, 'camera').camera.shots;
    const best = bestPhoto(c);
    const title = $('.cam-pb-title');
    const rows = $('.cam-pb-rows');
    const next = $('[data-cam="next"]') as HTMLButtonElement;
    const keep = $('[data-cam="keep"]') as HTMLButtonElement;
    const p = c.photos.at(-1)!;
    title.replaceChildren(el('b', undefined, `PLAYBACK · SHOT ${c.photos.length} OF ${shots}`), el('span', undefined, p.settings));
    rows.replaceChildren(...p.scores.map((v, i) => scoreRow(FACTORS[i]!, v)));
    damage(p);
    $('.cam-pb-tip').textContent = (p.auto ? 'Time ran out, so the shutter fired. ' : '') + p.tip;
    next.textContent = `Next shot (${shots - c.photos.length} left)`;
    keep.textContent = `Keep best: ${best?.damage ?? 0}`;
    for (const b of [next, keep]) b.disabled = remote;
  }
  function damage(p: Photo): void {
    const d = $('.cam-pb-damage b');
    d.textContent = String(p.damage);
    d.className = p.damage >= 60 ? 'great' : p.damage >= 30 ? 'good' : '';
    const tags = $('.cam-pb-tags');
    tags.replaceChildren(
      el('span', undefined, 'damage'),
      ...(p.perfect ? [el('span', 'perfect', `PERFECT SHOT`)] : []),
      ...(p.capped ? [el('span', 'capped', `${p.settings.split(' ')[0]} mode: capped`)] : []),
      ...(p.flash && p.mark ? [el('span', 'blind', 'Flash: they’re blinded next turn')] : []),
    );
  }
  // The showcase: built when the card goes up, then moved along by its clock.
  let tiles: HTMLElement[] = [];
  const buildShowcase = keyed(
    (state) => {
      const c = state.camera;
      return c && c.outro === null && c.view === 'card' && state.phase === 'shooting' ? `${c.playerId}|${c.photos.length}` : '';
    },
    (state) => {
      const c = state.camera;
      const best = c && c.view === 'card' && c.outro === null ? bestPhoto(c) : null;
      showcase.hidden = !best;
      if (!c || !best) return;
      const shots = weaponOf(c.weaponId, 'camera').camera.shots;
      const chips = c.photos.map((p, i) => el('span', `cam-sc-chip${p === best ? ' best' : ''}`, `Shot ${i + 1} · ${p.damage}${p === best ? ' ★' : ''}`));
      tiles = best.scores.map((v, i) => {
        const t = el('div', `cam-sc-tile g${gradeRank(v)}`);
        t.append(el('small', undefined, FACTORS[i]!), el('b', undefined, grade(v)));
        return t;
      });
      const overall = el('div', `cam-sc-overall g${best.mark ? gradeRank(overallOf(best)) : 0}`);
      overall.append(el('small', undefined, 'OVERALL'), el('b', undefined, best.mark ? grade(overallOf(best)) : '—'));
      const dmg = el('div', `cam-sc-damage${best.damage >= 60 ? ' great' : best.damage > 0 ? ' good' : ''}`);
      dmg.append(el('b', undefined, '0'), el('small', undefined, best.damage > 0 ? 'damage' : 'nothing in the frame'));
      const total = el('div', 'cam-sc-total');
      total.append(overall, dmg);
      const tags = el('p', 'cam-sc-tags');
      if (best.perfect) tags.append(el('span', 'perfect', 'PERFECT SHOT'));
      if (best.capped) tags.append(el('span', 'capped', `${best.settings.split(' ')[0]} mode: capped`));
      if (best.flash && best.mark) tags.append(el('span', 'blind', 'Flash: they’re blinded next turn'));
      const shotsRow = el('div', 'cam-sc-shots');
      shotsRow.append(...chips);
      const grades = el('div', 'cam-sc-grades');
      grades.append(...tiles);
      const keep = el('button', 'cam-sc-keep');
      keep.dataset.cam = 'keep';
      const head = el('div', 'cam-sc-head');
      head.append(el('p', 'cam-sc-title', `MEMORY CARD · BEST OF ${Math.min(shots, c.photos.length)}`), shotsRow);
      showcase.replaceChildren(head, grades, total, tags, keep);
      showcase.classList.toggle('perfect', best.perfect);
    },
  );
  const moveShowcase = keyed(
    (state, ctx) => {
      const c = state.camera;
      return c && !showcase.hidden && c.view === 'card' ? `${Math.round(c.reveal * 30)}|${c.reveal >= REVEAL.end}|${ctx.remote}` : '';
    },
    (state, ctx) => {
      const c = state.camera;
      const best = c && bestPhoto(c);
      if (!c || !best || showcase.hidden) return;
      const r = c.reveal;
      tiles.forEach((t, i) => t.classList.toggle('in', r >= gradeAt(i)));
      showcase.querySelector('.cam-sc-overall')!.classList.toggle('in', r >= REVEAL.overall);
      const p = Math.max(0, Math.min(1, (r - REVEAL.count) / (REVEAL.counted - REVEAL.count)));
      const dmg = showcase.querySelector('.cam-sc-damage')!;
      dmg.classList.toggle('in', r >= REVEAL.count);
      dmg.querySelector('b')!.textContent = String(Math.round(best.damage * (1 - (1 - p) ** 3)));
      showcase.classList.toggle('big', r >= REVEAL.big);
      const keep = showcase.querySelector<HTMLButtonElement>('.cam-sc-keep')!;
      const ended = r >= REVEAL.end;
      keep.disabled = ctx.remote;
      keep.classList.toggle('primary', ended);
      keep.textContent = ctx.remote ? (ended ? `${state.players[c.playerId]!.name} is firing it` : 'The best shot') : ended ? `Fire it: ${best.damage}` : 'Skip ▸▸';
    },
  );
  const printPart = keyed(
    (state) => {
      const c = state.camera;
      return c && c.outro !== null ? `${c.playerId}|${c.photos.length}` : '';
    },
    (state) => {
      const c = state.camera;
      const best = c && c.outro !== null ? bestPhoto(c) : null;
      print.hidden = !best;
      if (!best) return;
      print.querySelector('b')!.textContent = `📸 ${best.damage}`;
      print.querySelector('span')!.textContent = best.mark ? best.settings : 'Nothing in the frame';
    },
  );
  return {
    update: (state: GameState, ctx) => {
      viewfinder.update(state, ctx);
      buildShowcase.update(state, ctx);
      moveShowcase.update(state, ctx);
      printPart.update(state, ctx);
    },
    reset: () => {
      viewfinder.reset();
      buildShowcase.reset();
      moveShowcase.reset();
      printPart.reset();
    },
  };
}

function scoreRow(name: string, v: number): HTMLElement {
  const row = el('div', 'cam-pb-row');
  const bar = el('span', 'cam-pb-bar');
  const fill = el('i');
  fill.style.width = `${Math.round(v * 100)}%`;
  fill.className = v >= 0.95 ? 'great' : v >= 0.7 ? 'good' : 'poor';
  bar.append(fill);
  row.append(el('span', 'cam-pb-name', name), bar, el('b', undefined, grade(v)));
  return row;
}
