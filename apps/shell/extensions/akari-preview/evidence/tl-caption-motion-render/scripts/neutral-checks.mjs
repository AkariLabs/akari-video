// Choose a frame with no visible motion. Rows without such a frame are explicit exclusions.
const displacedEnd = new Set(['news-ticker', 'marquee-left', 'crawl-up', 'wobble']);

export function neutralCheck(row) {
  if (row.animation.loop) return { included: false, reason: 'loop が表示区間全体で動く' };
  if (displacedEnd.has(row.animation.in?.id)) return { included: false, reason: '入口の終端が中立姿勢ではない' };
  // Per-grapheme gradient segments can shift a few anti-aliased color samples;
  // their glyph bounds and ink occupancy must still agree with the still cue.
  const rich = row.style?.fill !== undefined || row.style?.strokes !== undefined;
  // A finished typewriter followed by a future exit animation has a small
  // glyph-edge raster difference, even though every grapheme is fully opaque.
  const typewriterWithExit = row.animation.in?.id === 'typewriter' && !!row.animation.out;
  return { included: true, offset: 1.5,
    tolerance: rich ? { changed: 200, mean: 1 }
      : typewriterWithExit ? { changed: 800, mean: 1.2 } : { changed: 100, mean: 1 } };
}

export function neutralPass(delta) {
  return delta.changed <= delta.tolerance.changed && delta.mean <= delta.tolerance.mean;
}
