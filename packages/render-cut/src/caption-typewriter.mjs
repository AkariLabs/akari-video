// Pure HTML transformation shared by the output preview and the OSR caption sheet.
// Each grapheme has its own paused step animation; seeking the caption clock reveals whole graphemes.
export function typewriterStepTiming(count, index, enterDuration, exitDuration, overlayDuration) {
  return {
    inDelay: enterDuration * (index + 1) / count,
    outDelay: Math.max(0, overlayDuration - exitDuration) + exitDuration * index / count,
  };
}

export function typewriterDurations(animation, overlayDuration) {
  const maximum = Math.max(.05, overlayDuration);
  return {
    enterDuration: Math.min(animation?.in?.duration_sec ?? .6, maximum),
    exitDuration: Math.min(animation?.out?.duration_sec ?? .6, maximum),
  };
}

export function decorateTypewriterHtml(html, animation, overlayDuration) {
  const entrance = animation?.in?.id === 'typewriter';
  const exit = animation?.out?.id === 'typewriter';
  if (!entrance && !exit) return html;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const chunks = [];
  const pattern = /(<p class="akari-caption__line"[^>]*>)([\s\S]*?)(<\/p>)/gu;
  const split = value => {
    const units = [];
    for (const token of value.match(/&(?:#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);|[^&]+|&/gu) || []) {
      if (token.startsWith('&') && token.endsWith(';')) units.push(token);
      else units.push(...[...segmenter.segment(token)].map(part => part.segment));
    }
    return units;
  };
  html.replace(pattern, (_whole, open, content, close) => {
    const parts = content.split(/(<[^>]+>)/gu);
    chunks.push({ open, close, parts: parts.map(part => part.startsWith('<') ? part : split(part)) });
    return _whole;
  });
  const count = chunks.reduce((total, chunk) => total + chunk.parts.reduce((n, part) => n + (Array.isArray(part) ? part.length : 0), 0), 0);
  if (!count) return html;
  // This function is serialized into the preview webview with toString(). Keep its
  // timing calculation self-contained: a production minifier renames module helpers.
  const maximum = Math.max(.05, overlayDuration);
  const enterDuration = Math.min(animation?.in?.duration_sec ?? .6, maximum);
  const exitDuration = Math.min(animation?.out?.duration_sec ?? .6, maximum);
  let index = 0;
  const rendered = chunks.map(chunk => chunk.open + chunk.parts.map(part => {
    if (!Array.isArray(part)) return part;
    return part.map(char => {
      const i = index++;
      const inDelay = enterDuration * (i + 1) / count;
      const outDelay = Math.max(0, overlayDuration - exitDuration) + exitDuration * i / count;
      let value = char;
      if (exit) value = `<span class="akari-caption__type-char" style="animation:akari-typewriter-char-out .01s ${outDelay.toFixed(6)}s linear both paused">${value}</span>`;
      if (entrance) value = `<span class="akari-caption__type-char" style="animation:akari-typewriter-char-in .01s ${inDelay.toFixed(6)}s linear both paused">${value}</span>`;
      return value;
    }).join('');
  }).join('') + chunk.close);
  let position = 0;
  const body = html.replace(pattern, () => rendered[position++]);
  const css = '.akari-caption__type-char{display:inline}'
    + '@keyframes akari-typewriter-char-in{from{opacity:0}to{opacity:1}}'
    + '@keyframes akari-typewriter-char-out{from{opacity:1}to{opacity:0}}';
  return body.replace('</style>', css + '</style>');
}

// A motion declaration alone must not switch a resolved cue to the styled look.
export function stripAnimationOnlyLookVars(style, vars) {
  if (!style?.animation || Object.keys(style).some(key => key !== 'animation') || !vars) return vars;
  const result = { ...vars };
  delete result['--caption-paint-order'];
  delete result['--caption-text-shadow'];
  return result;
}

export function isTypewriterOnlyAnimation(animation) {
  const slots = ['in', 'loop', 'out'].map(kind => animation?.[kind]).filter(Boolean);
  return slots.length > 0 && slots.every(slot => slot.id === 'typewriter');
}
