const DEFAULT_MAX_CHARACTERS = 13;

export function generateCaptionOverlays(captions, cuts, options = {}) {
  const maximum = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const overlays = [];

  for (const caption of captions) {
    const ranges = sourceRangeToTimeline(caption.start, caption.end, cuts);
    for (const [index, range] of ranges.entries()) {
      overlays.push({
        id: `${caption.id}-${String(index + 1).padStart(2, "0")}`,
        html: renderCaptionFragment(caption.text, { maximum }),
        start: range.start,
        duration: range.duration,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        vars: {},
        generatedFrom: caption.id,
      });
    }
  }

  return overlays;
}

export function sourceRangeToTimeline(start, end, cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start }];
  }

  const ranges = [];
  let timelineCursor = 0;
  for (const cut of cuts) {
    const overlapStart = Math.max(start, cut.in);
    const overlapEnd = Math.min(end, cut.out);
    if (overlapEnd > overlapStart) {
      ranges.push({
        start: timelineCursor + overlapStart - cut.in,
        duration: overlapEnd - overlapStart,
      });
    }
    timelineCursor += cut.out - cut.in;
  }
  return ranges;
}

export function renderCaptionFragment(text, options = {}) {
  const maximum = options.maximum ?? DEFAULT_MAX_CHARACTERS;
  const lines = splitCaptionLines(text, maximum);
  const markup = lines
    .map((line) => `<p class="akari-caption__line">${escapeHtml(line)}</p>`)
    .join("");

  return `<div class="akari-caption">
  <style>
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: var(--caption-font-size, 38px);
      font-weight: 700;
      line-height: 1.42;
      text-align: center;
    }
    .akari-caption__plate {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--caption-bottom, 7%);
      display: flex;
      flex-direction: column;
      gap: var(--plate-gap, 4px);
      opacity: 1;
      animation: akari-caption-fade 180ms ease-out both;
    }
    .akari-caption__line {
      width: max-content;
      max-width: 92%;
      margin: 0 auto;
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, rgba(8, 12, 22, 0.74));
      white-space: pre;
    }
    @keyframes akari-caption-fade {
      from { opacity: 0; transform: translateY(0.18em); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <div class="akari-caption__plate">${markup}</div>
</div>`;
}

export function splitCaptionLines(text, maximum = DEFAULT_MAX_CHARACTERS) {
  const explicit = String(text).split(/\r?\n/u);
  const lines = [];
  for (const value of explicit) {
    const characters = Array.from(value);
    if (characters.length === 0) {
      lines.push("");
      continue;
    }
    for (let index = 0; index < characters.length; index += maximum) {
      lines.push(characters.slice(index, index + maximum).join(""));
    }
  }
  return lines;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
