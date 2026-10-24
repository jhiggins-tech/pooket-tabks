/**
 * kiwicore's Long Exposure on the HUD (game/camera.ts): the camera body round the viewfinder. The left grip
 * has the mode dial, WB, ISO, the flash, the lens, AF/MF and AF-ON; the right the top LCD, the main dial,
 * the shutter and the quick control dial with SET; under the viewfinder its info line (with the meter and
 * the focus dot) and the lens's focus ring. The viewfinder itself is the battlefield, drawn by the renderer
 * through the frame (render/canvas.ts); over it, the light's grade, the white balance's tint, the grain, the
 * thirds grid and the AF points. After a shot, playback (its grades, damage and a tip) or, at the end, the
 * card. The controls are this phone's only while it's his turn here (input/controls.ts takes them);
 * watching, they're the same screen, untouchable, with a LIVE badge. Once it's fired, the best photo
 * shows as a print while it develops.
 */
import { bestPhoto, dialRole, exposureOf, FACTORS, meter, ringMetres } from '../../game/game';
import type { Camera, GameState, Photo } from '../../game/state';
import { APERTURES, ISOS, LENSES, MODES, SCENES, SHUTTERS, WHITE_BALANCE } from '../../weapons/camera';
import { weaponOf } from '../../weapons/registry';
import { byId, el, query } from '../../ui/dom';
import { keyed, type Part } from './part';

/** A score as a grade. */
export function grade(v: number): string {
  return v >= 0.95 ? 'A+' : v >= 0.85 ? 'A' : v >= 0.7 ? 'B' : v >= 0.55 ? 'C' : 'D';
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
  const viewfinder = keyed(
    (state, ctx) => {
      const c = state.camera;
      if (!c || c.outro !== null) return '';
      const m = meter(state, c);
      return [JSON.stringify({ ...c, t: 0, x: 0, y: 0, left: Math.ceil(c.left) }), m.scores[1]! >= 0.95 && !!m.subject, Math.round(m.err * 10), Math.round(m.mireds), ctx.remote].join('|');
    },
    (state, ctx) => {
      const c = state.camera;
      const on = !!c && c.outro === null && state.phase === 'shooting';
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
      left.classList.toggle('low', c.left <= 5);
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
    playback.hidden = c.view === 'aim';
    if (c.view === 'aim') return;
    const shots = weaponOf(c.weaponId, 'camera').camera.shots;
    const best = bestPhoto(c);
    const title = $('.cam-pb-title');
    const rows = $('.cam-pb-rows');
    const next = $('[data-cam="next"]') as HTMLButtonElement;
    const keep = $('[data-cam="keep"]') as HTMLButtonElement;
    if (c.view === 'review') {
      const p = c.photos.at(-1)!;
      title.replaceChildren(el('b', undefined, `PLAYBACK · SHOT ${c.photos.length} OF ${shots}`), el('span', undefined, p.settings));
      rows.replaceChildren(...p.scores.map((v, i) => scoreRow(FACTORS[i]!, v)));
      damage(p);
      $('.cam-pb-tip').textContent = (p.auto ? 'Time ran out, so the shutter fired. ' : '') + p.tip;
      next.hidden = false;
      next.textContent = `Next shot (${shots - c.photos.length} left)`;
      keep.textContent = `Keep best: ${best?.damage ?? 0}`;
    } else {
      title.replaceChildren(el('b', undefined, 'MEMORY CARD · THE BEST SHOT COUNTS'), el('span'));
      rows.replaceChildren(...c.photos.map((p, i) => cardRow(p, i, p === best)));
      damage(best!);
      $('.cam-pb-tip').textContent = remote ? '' : 'The best photo lands on whoever’s in it.';
      next.hidden = true;
      keep.textContent = `Use the best shot (${best?.damage ?? 0})`;
    }
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
      printPart.update(state, ctx);
    },
    reset: () => {
      viewfinder.reset();
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

function cardRow(p: Photo, i: number, best: boolean): HTMLElement {
  const row = el('div', `cam-pb-shot${best ? ' best' : ''}`);
  const overall = p.mark ? grade(p.scores.reduce((a, b) => a * b, 1) ** (1 / p.scores.length)) : '—';
  row.append(el('span', 'cam-pb-name', `Shot ${i + 1}${best ? ' · BEST' : ''}`), el('small', undefined, p.settings), el('b', undefined, overall), el('b', 'big', String(p.damage)));
  return row;
}
