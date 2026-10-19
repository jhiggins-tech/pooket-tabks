/**
 * Pictures for doctorfox's Who's That Pokémon? (game/pokemon.ts): each fetched from PokeAPI's sprites the
 * first time it's wanted (weapons/pokedex.ts `pokemonSprite`; not bundled) and kept for the session.
 * MissingNo. is drawn here instead: its famous garbled backwards-L of blocks. His phone only starts the
 * clock once the picture's `ok`, and calls the go off if it's `error` (main.ts); a picture still loading
 * after `LOAD_LIMIT` counts as an error, so a bad connection can't leave him stuck.
 */
import { MISSINGNO, pokemonSprite } from '../weapons/pokedex';

export type PictureStatus = 'loading' | 'ok' | 'error';

/** How long a picture may take to load before it's given up on (ms). */
const LOAD_LIMIT = 8000;

interface Picture {
  src: string;
  status: 'loading' | 'ok' | 'error';
  started: number;
}

const pictures = new Map<number, Picture>();

/** Pokédex number `n`'s picture (its URL, for an `<img>`), starting it loading if it isn't already. */
export function pokemonPicture(n: number): Picture {
  let pic = pictures.get(n);
  if (pic) return pic;
  if (n === MISSINGNO) {
    pic = { src: missingNoPicture(), status: 'ok', started: 0 };
  } else {
    const p: Picture = { src: pokemonSprite(n), status: 'loading', started: performance.now() };
    const img = new Image();
    img.onload = () => (p.status = 'ok');
    img.onerror = () => (p.status = 'error');
    img.src = p.src;
    pic = p;
  }
  pictures.set(n, pic);
  return pic;
}

/** Whether Pokédex number `n`'s picture is in, still loading, or not coming (an error, or too slow). */
export function pictureStatus(n: number): PictureStatus {
  const pic = pokemonPicture(n);
  if (pic.status === 'loading' && performance.now() - pic.started > LOAD_LIMIT) pic.status = 'error';
  return pic.status;
}

/** MissingNo.: a backwards L of garbled 8×8 blocks (the glitch from Red and Blue), as a data URL. */
function missingNoPicture(): string {
  const cells = 7;
  const px = 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cells * px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  let seed = 151;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      // The L: the right-hand columns all the way down, and the bottom rows all the way across.
      if (cx < 4 && cy < 4) continue;
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          const r = rand();
          ctx.fillStyle = r < 0.45 ? '#101018' : r < 0.7 ? '#e8e8f0' : r < 0.85 ? '#7c7c8c' : '#b0b0c0';
          ctx.fillRect(cx * px + x, cy * px + y, 1, 1);
        }
      }
    }
  }
  return canvas.toDataURL();
}
