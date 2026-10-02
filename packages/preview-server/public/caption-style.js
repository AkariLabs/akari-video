export const MANAGED_CAPTION_STYLE_VARIABLES = Object.freeze([
  '--caption-color',
  '--caption-font-size',
  '--caption-font-family',
  '--caption-font-weight',
  '--caption-font-style',
  '--caption-text-decoration',
  '--caption-letter-spacing',
  '--caption-text-transform',
  '--caption-writing-mode',
  '--caption-line-height',
  '--caption-rich-fill-color',
  '--caption-rich-fill-image',
  '--caption-rich-fill-size',
  '--caption-rich-fill-position',
  '--caption-tok-rich-fill-color',
  '--caption-tok-rich-fill-image',
  '--caption-tok-rich-fill-size',
  '--caption-tok-rich-fill-position',
  '--caption-text-shadow',
  '--caption-stroke',
  '--caption-webkit-text-stroke',
  '--caption-paint-order',
  '--caption-top',
  '--caption-bottom',
  '--caption-translate',
  '--caption-left',
  '--caption-right',
  '--caption-width',
  '--caption-line-width',
  '--caption-justify-content',
  '--caption-align-items',
  '--caption-line-margin',
  '--caption-line-max-width',
  '--caption-text-align',
  '--plate-bg',
  '--plate-radius',
  '--plate-pad-x',
  '--plate-pad-y',
  '--plate-block-pad-x',
  '--plate-block-pad-y',
  '--plate-ext-bg',
  '--plate-ext-radius',
  '--plate-ext-width',
  '--plate-ext-height',
  '--plate-offset-x',
  '--plate-offset-y',
  '--plate-block-bg',
  '--plate-block-radius',
]);

/** Replace the complete managed variable set so style from the prior cue cannot leak. */
export function replaceCaptionStyleVariables(style, values = {}) {
  for (const name of MANAGED_CAPTION_STYLE_VARIABLES) style.removeProperty(name);
  for (const [name, value] of Object.entries(values)) style.setProperty(name, String(value));
}

export const CAPTION_RICH_LAYER_CSS = '.akari-caption--rich .akari-caption__tok{position:relative;-webkit-text-fill-color:transparent;-webkit-text-stroke:0 transparent;text-shadow:none;}.akari-caption--rich .akari-caption__run,.akari-caption--rich .akari-caption__char{position:relative;}.akari-caption--rich .akari-caption__rich-segment{position:relative;display:inline-block;vertical-align:baseline;white-space:pre;}.akari-caption--rich .akari-caption__rich-shadow,.akari-caption--rich .akari-caption__rich-stroke{position:absolute;inset:0;white-space:pre;pointer-events:none;text-decoration:none;}.akari-caption--rich .akari-caption__rich-fill{position:relative;white-space:pre;pointer-events:none;text-decoration:none;}.akari-caption--rich .akari-caption__rich-shadow{color:transparent;-webkit-text-fill-color:transparent;-webkit-text-stroke:0 transparent;text-shadow:var(--caption-text-shadow,none);}.akari-caption--rich .akari-caption__rich-stroke{color:transparent;-webkit-text-fill-color:transparent;-webkit-text-stroke:var(--caption-rich-stroke-width) var(--caption-rich-stroke-color);paint-order:stroke fill;text-shadow:none;transform:translate(var(--caption-rich-stroke-offset-x,0em),var(--caption-rich-stroke-offset-y,0em));}.akari-caption--rich .akari-caption__rich-fill{color:var(--caption-tok-rich-fill-color,var(--caption-rich-fill-color,var(--caption-color,#fff)));background-image:var(--caption-tok-rich-fill-image,var(--caption-rich-fill-image,none));background-size:var(--caption-tok-rich-fill-size,var(--caption-rich-fill-size,100% 100%));background-position:var(--caption-tok-rich-fill-position,var(--caption-rich-fill-position,0 0));-webkit-background-clip:text;-webkit-text-fill-color:var(--caption-tok-rich-fill-color,var(--caption-rich-fill-color,var(--caption-color,#fff)));-webkit-text-stroke:0 transparent;text-shadow:none;paint-order:stroke fill;}.akari-caption--rich .akari-caption__run[style*="color:"] .akari-caption__rich-fill{color:inherit;background-image:none;-webkit-text-fill-color:currentColor;}.akari-caption--rich .akari-caption__run[style*="-webkit-text-stroke:"][style*="px"] .akari-caption__rich-stroke{display:none;}.akari-caption--rich .akari-caption__run[style*="-webkit-text-stroke:"][style*="px"] .akari-caption__rich-fill{-webkit-text-stroke:inherit;}.akari-caption--rich .akari-caption__tok--karaoke-done .akari-caption__rich-fill{background-image:none;-webkit-text-fill-color:var(--caption-highlight-color,#ffd94a);}.akari-caption--rich .akari-caption__tok--karaoke-smooth::after{display:none;}.akari-caption--rich .akari-caption__tok--karaoke-smooth .akari-caption__rich-fill::after{content:attr(data-karaoke-text);position:absolute;inset:0;white-space:pre;background-image:none;color:var(--caption-highlight-color,#ffd94a);-webkit-text-fill-color:var(--caption-highlight-color,#ffd94a);animation:akari-caption-karaoke-wipe var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}';

/** The preview server receives resolved variables, but owns the cue's DOM nodes. */
export function applyRichCaptionLayers(host, style) {
  if (!style || (style.fill === undefined && style.strokes === undefined)) {
    host.classList.remove('akari-caption--rich');
    delete host.dataset.richPatternId;
    delete host.dataset.richPatternBg;
    return;
  }
  host.classList.add('akari-caption--rich');
  host.dataset.richFillType = style.fill?.type || 'solid';
  if (style.fill?.type === 'pattern') {
    host.dataset.richPatternId = style.fill.pattern.id;
    if (typeof style.fill.pattern.bg === 'object') host.dataset.richPatternBg = 'gradient';
    else delete host.dataset.richPatternBg;
  } else {
    delete host.dataset.richPatternId;
    delete host.dataset.richPatternBg;
  }
  let css = host.querySelector('style[data-akari-rich-caption]');
  if (!css) {
    css = document.createElement('style');
    css.dataset.akariRichCaption = '';
    css.textContent = CAPTION_RICH_LAYER_CSS;
    host.appendChild(css);
  }
  const font = Number(style.size_px) || 38;
  const strokes = Array.isArray(style.strokes) ? style.strokes
    : style.stroke ? [{ color: style.stroke.color || '#000000', width_px: style.stroke.width_px ?? 1.5 }] : [];
  const em = value => `${Number(value.toFixed(6))}em`;
  for (const line of host.querySelectorAll('.akari-caption__line,.akari-caption__resolved-line')) {
    if (!line.querySelector('.akari-caption__tok')) {
      if ([...line.childNodes].every(node => node.nodeType === Node.TEXT_NODE)) {
        const source = line.textContent || '';
        line.textContent = '';
        for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(source)) {
          const token = document.createElement('span');
          token.className = 'akari-caption__tok';
          token.textContent = part.segment;
          line.appendChild(token);
        }
      } else {
        const token = document.createElement('span');
        token.className = 'akari-caption__tok';
        while (line.firstChild) token.appendChild(line.firstChild);
        line.appendChild(token);
      }
    }
    for (const token of line.querySelectorAll('.akari-caption__tok')) {
      const walker = document.createTreeWalker(token, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const value = node.textContent || '';
        if (!value) continue;
        const segment = document.createElement('span');
        segment.className = 'akari-caption__rich-segment';
        node.parentNode.insertBefore(segment, node);
        const layer = (name, hidden = true) => {
          const span = document.createElement('span');
          span.className = `akari-caption__rich-${name}`;
          if (hidden) span.setAttribute('aria-hidden', 'true');
          span.textContent = value;
          segment.appendChild(span);
          return span;
        };
        layer('shadow');
        for (const stroke of strokes) {
          const span = layer('stroke');
          span.style.setProperty('--caption-rich-stroke-color', stroke.color);
          span.style.setProperty('--caption-rich-stroke-width', em(2 * stroke.width_px / font));
          span.style.setProperty('--caption-rich-stroke-offset-x', em((stroke.offset_x || 0) / font));
          span.style.setProperty('--caption-rich-stroke-offset-y', em((stroke.offset_y || 0) / font));
        }
        layer('fill', false).dataset.karaokeText = value;
        node.remove();
      }
    }
  }
  alignRichFillPhase(host);
  document.fonts.ready.then(() => alignRichFillPhase(host));
}

function alignRichFillPhase(root) {
  const fillType = root.getAttribute('data-rich-fill-type');
  const gradient = fillType === 'gradient';
  const pattern = fillType === 'pattern';
  const patternGradient = pattern && root.getAttribute('data-rich-pattern-bg') === 'gradient';
  const thunder = root.getAttribute('data-rich-pattern-id') === 'thunder';
  for (const line of root.querySelectorAll('.akari-caption__line,.akari-caption__resolved-line')) {
    const lineRect = line.getBoundingClientRect();
    for (const fill of line.querySelectorAll('.akari-caption__rich-fill')) {
      const rect = fill.getBoundingClientRect();
      const x = Number((lineRect.left - rect.left).toFixed(3));
      const y = Number((lineRect.top - rect.top).toFixed(3));
      const patternPosition = `${Number((x + (thunder ? 4 : 0)).toFixed(3))}px ${Number((y + (thunder ? 2 : 0)).toFixed(3))}px`;
      fill.style.setProperty('--caption-rich-fill-position', patternGradient
        ? `${patternPosition}, ${x}px ${y}px`
        : pattern ? patternPosition : `${x}px ${y}px`);
      if (gradient) fill.style.setProperty('--caption-rich-fill-size',
        `${Number(lineRect.width.toFixed(3))}px ${Number(lineRect.height.toFixed(3))}px`);
      if (patternGradient) {
        const tile = getComputedStyle(fill).backgroundSize.split(',')[0];
        fill.style.setProperty('--caption-rich-fill-size',
          `${tile}, ${Number(lineRect.width.toFixed(3))}px ${Number(lineRect.height.toFixed(3))}px`);
      }
    }
  }
}
