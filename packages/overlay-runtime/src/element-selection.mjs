// Pure DOM selection rules. interaction.js carries this marked body verbatim.
// BEGIN element-selection
function isRuntimeElement(element) {
  return element?.matches?.('script, style, template, [data-akari-hit-proxy], [data-akari-interaction], [data-akari-part-mask], .akari-u')
    || Boolean(element?.closest?.('[data-akari-hit-proxy], [data-akari-interaction], [data-akari-part-mask]'));
}

function elementAddress(root, element) {
  if (!root || !element || isRuntimeElement(element) || !root.contains(element)) return null;
  const id = element.getAttribute('id');
  const token = element.getAttribute('class')?.trim().split(/\s+/u).find(value => value && value !== 'akari-u');
  if (!id && !token) return null;
  const candidates = [root, ...root.querySelectorAll('*')].filter(candidate => !isRuntimeElement(candidate)
    && (id ? candidate.getAttribute('id') === id
      : candidate.getAttribute('class')?.split(/\s+/u).includes(token)));
  const index = candidates.indexOf(element);
  return index < 0 ? null : `${id ? '#' : '.'}${id || token}[${index}]`;
}

function drawsSelectionContent(element, style = getComputedStyle(element)) {
  const tag = element.tagName.toUpperCase();
  if (['BASE', 'HEAD', 'LINK', 'META', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE'].includes(tag)) return false;
  if (['AUDIO', 'CANVAS', 'EMBED', 'IFRAME', 'IMG', 'OBJECT', 'SVG', 'VIDEO'].includes(tag)) return true;
  if (element.namespaceURI === 'http://www.w3.org/2000/svg'
    && ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text', 'image'].includes(tag.toLowerCase())) return true;
  if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) return true;
  const transparent = value => {
    const color = String(value ?? '').trim().toLowerCase();
    if (!color || color === 'transparent') return true;
    const legacy = color.match(/^(?:rgba|hsla)\([^)]*,\s*([\d.]+)\)$/);
    if (legacy) return Number(legacy[1]) <= 0;
    const modern = color.match(/\/\s*([\d.]+)%?\s*\)$/);
    return Boolean(modern && Number(modern[1]) <= 0);
  };
  const shadow = String(style.boxShadow ?? '').trim().toLowerCase();
  const shadowColors = shadow.match(/(?:rgba?|hsla?|color)\([^)]*\)|transparent/g) ?? [];
  if (!transparent(style.backgroundColor) || style.backgroundImage && style.backgroundImage !== 'none'
    || shadow && shadow !== 'none' && (shadowColors.length === 0 || shadowColors.some(color => !transparent(color)))) return true;
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if (parseFloat(style[`border${side}Width`]) > 0
      && !['none', 'hidden'].includes(style[`border${side}Style`])
      && !transparent(style[`border${side}Color`])) return true;
  }
  return parseFloat(style.outlineWidth) > 0 && !['none', 'hidden'].includes(style.outlineStyle)
    && !transparent(style.outlineColor);
}

function selectionVisibleRect(rect, element, container) {
  if (!rect || !(rect.width > 0 && rect.height > 0)) return null;
  let { left, top, right, bottom } = rect;
  for (let node = element; node && node !== container; node = node.parentElement) {
    const style = getComputedStyle(node);
    const paint = /\b(?:paint|content|strict)\b/.test(style.contain ?? '');
    const clipX = paint || node.tagName.toLowerCase() === 'svg' || (style.overflowX || style.overflow) !== 'visible';
    const clipY = paint || node.tagName.toLowerCase() === 'svg' || (style.overflowY || style.overflow) !== 'visible';
    if (clipX || clipY) {
      const clip = node.getBoundingClientRect();
      if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    if (right <= left || bottom <= top) return null;
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function selectionContentBounds(element, options = {}) {
  if (!element) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of [element, ...element.querySelectorAll('*')]) {
    if (node.closest('[data-akari-interaction]') || node.closest('defs, symbol, pattern, clipPath, mask, marker')) continue;
    let visible = true;
    for (let ancestor = node; ancestor && ancestor !== options.container; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
        || Number(style.opacity) === 0) { visible = false; break; }
    }
    if (!visible || !drawsSelectionContent(node)) continue;
    if (node.tagName.toLowerCase() === 'svg'
      && node.querySelector('path, rect, circle, ellipse, line, polyline, polygon, use, text, image')
      && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') continue;
    const raw = options.rawRect?.(node) ?? node.getBoundingClientRect();
    const rect = options.visibleRect ? options.visibleRect(raw, node)
      : selectionVisibleRect(raw, node, options.container);
    if (!rect || !(rect.width > 0 && rect.height > 0)) continue;
    left = Math.min(left, rect.left); top = Math.min(top, rect.top);
    right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
  }
  return Number.isFinite(left) ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}

function selectableContentBranches(root, element, outputRect) {
  let count = 0;
  const visit = node => {
    if (count > 1) return;
    const style = getComputedStyle(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
      || Number(style.opacity) === 0 || isRuntimeElement(node)) return;
    const rect = node.getBoundingClientRect();
    if (node !== element && elementAddress(root, node) && rect.width > 1 && rect.height > 1
      && drawsSelectionContent(node) && (!outputRect || rect.width < outputRect.width * 0.95
        || rect.height < outputRect.height * 0.95)) { count++; return; }
    for (const child of node.children) visit(child);
  };
  for (const child of element.children) visit(child);
  return count;
}

function isSelectionContainer(element) {
  return Boolean(element?.children?.length) && !drawsSelectionContent(element);
}

function selectionBoundsFor(element, options) {
  const memo = options.boundsMemo ??= new Map();
  if (!memo.has(element)) memo.set(element,
    options.boundsFor ? options.boundsFor(element) : selectionContentBounds(element));
  return memo.get(element);
}

function hasUncoveredPaintedContent(root, element, outputRect, options) {
  const visit = node => {
    if (node.closest('[data-akari-interaction], defs, symbol, pattern, clipPath, mask, marker')) return false;
    if (selectableElement(root, node, outputRect, options)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && Number(getComputedStyle(node).opacity) !== 0
      && drawsSelectionContent(node)) return true;
    return [...node.children].some(visit);
  };
  return [...element.children].some(visit);
}

function selectableContainer(root, element, outputRect, bounds, options = {}) {
  if (!isSelectionContainer(element)) return true;
  if (!bounds) return false;
  // Keep an animated wrapper reachable while one of its painted phases is visible.
  if (hasUncoveredPaintedContent(root, element, outputRect, options)) return true;
  if (selectableContentBranches(root, element, outputRect) <= 1) return false;
  const box = element.getBoundingClientRect();
  return !(outputRect && (box.width >= outputRect.width * 0.5 || box.height >= outputRect.height * 0.5)
    && (box.width >= bounds.width * 1.5 || box.height >= bounds.height * 1.5));
}

function selectableElement(root, element, outputRect, options = {}) {
  const memo = options.selectableMemo ??= new Map();
  if (memo.has(element)) return memo.get(element);
  if (!root || !element || element === root || !root.contains(element) || isRuntimeElement(element)
    || element.closest('svg') !== (element.tagName.toLowerCase() === 'svg' ? element : null)
    || !elementAddress(root, element)) { memo.set(element, false); return false; }
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 1 && rect.height > 1)) { memo.set(element, false); return false; }
  for (let ancestor = element; ancestor && root.contains(ancestor); ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      memo.set(element, false); return false;
    }
  }
  const bounds = selectionBoundsFor(element, options);
  const coverage = bounds ?? rect;
  const replaced = ['img', 'video', 'canvas', 'svg'].includes(element.tagName.toLowerCase());
  const eligible = (replaced || !outputRect || coverage.width < outputRect.width * 0.95
    || coverage.height < outputRect.height * 0.95)
    && selectableContainer(root, element, outputRect, bounds, options);
  memo.set(element, eligible);
  return eligible;
}

function nearestSelectableElement(root, hit, outputRect, options = {}) {
  options = { ...options, selectableMemo: new Map(), boundsMemo: new Map() };
  for (let element = hit; element && element !== root; element = element.parentElement) {
    if (selectableElement(root, element, outputRect, options)) return element;
  }
  return null;
}

function firstSelectableElement(root, outputRect, options = {}) {
  options = { ...options, selectableMemo: new Map(), boundsMemo: new Map() };
  return [root, ...root.querySelectorAll('*')].find(element => selectableElement(root, element, outputRect, options)) ?? null;
}

function elementByAddress(root, ref) {
  if (!root || typeof ref !== 'string') return null;
  return [root, ...root.querySelectorAll('*')].find(element => elementAddress(root, element) === ref) ?? null;
}

function elementLabel(root, element) {
  const ref = elementAddress(root, element);
  if (!ref) return '';
  if (ref.startsWith('#')) return ref.slice(0, ref.lastIndexOf('['));
  const name = ref.slice(1, ref.lastIndexOf('['));
  const siblings = [...element.parentElement.children].filter(sibling => sibling.getAttribute('class')?.split(/\s+/u).includes(name));
  return siblings.length > 1 ? `${name} ${siblings.indexOf(element) + 1}` : name;
}
// END element-selection
export { isRuntimeElement, elementAddress, drawsSelectionContent, selectionContentBounds,
  isSelectionContainer, selectableContainer, selectableElement, nearestSelectableElement,
  firstSelectableElement, elementByAddress, elementLabel };
