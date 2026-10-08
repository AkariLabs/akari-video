// インタラクション層
// 契約: docs/planning/contract-2026-07-13-m1-m4.md §M3
window.akari = window.akari || {};

window.akari.interaction = (() => {
// A pointer gesture belongs to one controller at a time.
function canBeginPointerInteraction(owner) { return owner == null; }
let pointerOwner = null;
function setPointerOwner(owner) {
  if (owner == null) { pointerOwner = null; return; }
  if (pointerOwner != null && pointerOwner !== owner) return false;
  pointerOwner = owner;
  return true;
}
function releasePointerOwner(owner) {
  if (pointerOwner !== owner) return false;
  pointerOwner = null;
  return true;
}

// BEGIN selection-scope
function lineage(tree, id) {
  const nodes = new Map(tree.map(node => [node.id, node]));
  const result = [], visited = new Set();
  while (id != null && nodes.has(id) && !visited.has(id)) {
    visited.add(id);
    result.unshift(id);
    id = nodes.get(id).parentId;
  }
  return result;
}

function resolveScopedSelection(tree, scopeId, hitLeafId, { deep = false } = {}) {
  const path = lineage(tree, hitLeafId);
  if (!path.length) return { selectId: hitLeafId, scopeId };
  if (deep) return { selectId: hitLeafId, scopeId: path.at(-2) ?? null };
  // Keep the nearest enclosing scope that also contains this hit.
  const scopes = lineage(tree, scopeId);
  while (scopeId !== null && (!path.includes(scopeId) || scopeId === hitLeafId)) {
    scopes.pop();
    scopeId = scopes.at(-1) ?? null;
  }
  return { selectId: path[path.indexOf(scopeId) + 1], scopeId };
}

function enterScope(tree, selectedId, hitLeafId) {
  const node = tree.find(candidate => candidate.id === selectedId);
  if (!node || node.kind === "leaf") {
    return { selectId: selectedId, scopeId: node?.parentId ?? null };
  }
  const path = lineage(tree, hitLeafId);
  const selectId = path.includes(selectedId) && hitLeafId !== selectedId
    ? path[path.indexOf(selectedId) + 1]
    : tree.find(candidate => candidate.parentId === selectedId)?.id ?? null;
  return { selectId, scopeId: selectedId };
}

function exitScope(tree, selectedId, scopeId, floorScopeId = null) {
  if (scopeId === floorScopeId || scopeId === null) {
    return { selectId: null, scopeId: floorScopeId };
  }
  const path = lineage(tree, scopeId);
  if (floorScopeId !== null && !path.includes(floorScopeId)) {
    return { selectId: null, scopeId: floorScopeId };
  }
  return { selectId: scopeId, scopeId: path.at(-2) ?? floorScopeId };
}

function descendantLeafIds(tree, id) {
  return tree.filter(node => node.kind === "leaf" && lineage(tree, node.id).includes(id))
    .map(node => node.id);
}
function shouldHandleScopeEscape(selectedId, scopeId, floorScopeId) {
  return selectedId !== null || scopeId !== floorScopeId;
}

function lazyBagForScope(tree, scopeId) {
  const node = tree.find(candidate => candidate.id === scopeId);
  return node?.kind === "bag" && node.lazy === true ? node.id : null;
}

function nextCycleCandidate(candidates, currentId) {
  if (!candidates.length) return null;
  return candidates[(candidates.indexOf(currentId) + 1) % candidates.length];
}

// Toggle only immediate siblings in the current scope; preserve insertion order.
function toggleScopedSelection(tree, selectedIds, scopeId, next) {
  const sibling = id => tree.some(node => node.id === id && node.parentId === scopeId);
  const additive = next.scopeId === scopeId && sibling(next.selectId) && selectedIds.every(sibling);
  const ids = additive
    ? selectedIds.includes(next.selectId) ? selectedIds.filter(id => id !== next.selectId) : [...selectedIds, next.selectId]
    : next.selectId === null ? [] : [next.selectId];
  return { selectedIds: ids, selectId: ids.at(-1) ?? null, scopeId: next.scopeId };
}

// Client-space AABBs. Touching an edge counts as a hit.
function marqueeHits(candidates, rect) {
  if (!rect) return [];
  return candidates.filter(({ bounds }) => bounds
    && bounds.left <= rect.right && bounds.right >= rect.left
    && bounds.top <= rect.bottom && bounds.bottom >= rect.top).map(({ id }) => id);
}

// END selection-scope

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

// BEGIN element-geometry
function elementAxes(center, xProbe, yProbe) {
  return { x: { x: xProbe.x - center.x, y: xProbe.y - center.y },
    y: { x: yProbe.x - center.x, y: yProbe.y - center.y } };
}

function elementPoint(geometry, horizontal, vertical) {
  return { x: geometry.center.x + horizontal * geometry.width * geometry.axes.x.x / 2
      + vertical * geometry.height * geometry.axes.y.x / 2,
    y: geometry.center.y + horizontal * geometry.width * geometry.axes.x.y / 2
      + vertical * geometry.height * geometry.axes.y.y / 2 };
}

function elementHandlePoints(geometry, name) {
  const signs = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0],
    nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[name];
  if (!signs) return null;
  return { dragged: elementPoint(geometry, ...signs),
    anchor: elementPoint(geometry, -signs[0], -signs[1]), signs };
}

function elementBoxSize(width, height, name, delta, shift) {
  const signs = elementHandlePoints({ center: { x: 0, y: 0 }, width, height,
    axes: { x: { x: 1, y: 0 }, y: { x: 0, y: 1 } } }, name)?.signs;
  if (!signs) return { width, height };
  let nextWidth = signs[0] ? Math.max(4, width + signs[0] * delta.x) : width;
  let nextHeight = signs[1] ? Math.max(4, height + signs[1] * delta.y) : height;
  if (signs[0] && signs[1] && !shift) {
    const ratio = Math.max(4 / width, 4 / height,
      (width * nextWidth + height * nextHeight) / (width * width + height * height));
    nextWidth = width * ratio;
    nextHeight = height * ratio;
  }
  return { width: Math.round(nextWidth * 100) / 100,
    height: Math.round(nextHeight * 100) / 100 };
}

function elementLocalDelta(screen, axes) {
  const determinant = axes.x.x * axes.y.y - axes.y.x * axes.x.y;
  if (Math.abs(determinant) < 1e-6) return { x: 0, y: 0 };
  return { x: (screen.x * axes.y.y - screen.y * axes.y.x) / determinant,
    y: (screen.y * axes.x.x - screen.x * axes.x.y) / determinant };
}

function elementAngle(value, shift) {
  const angle = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round((shift ? Math.round(angle / 15) * 15 : angle) * 100) / 100;
}

function elementHandleLayout(width, height) {
  return { hideHorizontalEdges: width < 30, hideVerticalEdges: height < 30,
    outsideX: width < 36, outsideY: height < 36,
    cornerOffsetX: width < 36 ? 14 : 0, cornerOffsetY: height < 36 ? 14 : 0,
    rotateTop: -32 };
}

function elementBoxCompanions(style, parentStyle, width, height) {
  const result = {};
  if (style.boxSizing !== 'border-box') result['box-sizing'] = 'border-box';
  if (style.display === 'inline') result.display = 'inline-block';
  if (['flex', 'inline-flex'].includes(parentStyle?.display) && style.flex !== '0 0 auto') result.flex = '0 0 auto';
  if (width !== null) {
    if (Number.parseFloat(style.minWidth) > width) result['min-width'] = '0px';
    if (Number.parseFloat(style.maxWidth) < width) result['max-width'] = 'none';
  }
  if (height !== null) {
    if (Number.parseFloat(style.minHeight) > height) result['min-height'] = '0px';
    if (Number.parseFloat(style.maxHeight) < height) result['max-height'] = 'none';
  }
  return result;
}
// END element-geometry

  const stage = document.getElementById("overlay-stage");
  const dragStartDistance = 4;
  const SNAP_DISTANCE = 6;
  const SNAP_RELEASE_DISTANCE = 6;
  const DEFAULT_OUTPUT_WIDTH = 1280;
  const DEFAULT_OUTPUT_HEIGHT = 720;
  const NON_RENDERED_HIT_ELEMENTS = new Set([
    "BASE",
    "HEAD",
    "LINK",
    "META",
    "NOSCRIPT",
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "TITLE",
  ]);
  const REPLACED_HIT_ELEMENTS = new Set([
    "AUDIO",
    "CANVAS",
    "EMBED",
    "IFRAME",
    "IMG",
    "OBJECT",
    "SVG",
    "VIDEO",
  ]);
  const SVG_PAINT_ELEMENTS = new Set([
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use", "text", "image",
  ]);
  const SVG_DEFINITION_ELEMENTS = new Set([
    "defs", "symbol", "pattern", "clippath", "mask", "marker",
  ]);

  // 舞台は出力動画ピクセルの論理サイズを scale() でペイン内の動画矩形へ貼り付ける。
  // 通常の座標変換は stageLocalPoint() を使い、この倍率は異常系の退避と selftest に使う。
  function stageScaleFactor() {
    const scale = window.akari.stageScale?.();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  // M3 拡縮ハンドル（ビューワー UI ラウンド §3）: uniform scale のクランプとスナップ。
  // 設計ノート（notes-2026-07-14-viewer-ui-round.md）は 0.2〜4.0 を明記しているが、
  // 実装依頼テキストは 0.2〜5.0 と記載していた。設計ノートを SSOT として 4.0 を採用する
  // （差分として成果報告に明記）。
  const SCALE_MIN = 0.2;
  const SCALE_MAX = 4.0;
  const SCALE_SNAP_TOLERANCE = 0.035; // ±3.5% で等倍にスナップ

  let selectedOverlay = null;
  let selectedId = null;
  let selectedIds = [];
  let elementFocus = null;
  let elementGeometryCache = null;
  let elementNudge = null;
  let elementNudgeTimer = null;
  let scopeId = null;
  let floorScopeId = window.akari.state?.selectionFloor ?? null;
  scopeId = floorScopeId;
  let groupSelection = false;
  let selectionFrame = null;
  let elementHandlePlacementFrame = null;
  let selectionTrackingFrame = null;
  let activeDrag = null;
  let activeResize = null;
  let activeRotate = null;
  function reportLiveValues(id, values, clear = false) {
    if (!id || typeof window.akari?.reportLiveValues !== 'function') return;
    window.akari.reportLiveValues({ id, ...(clear ? { clear: true } : { values }) });
  }
  function reportLivePose(gesture) {
    if (!gesture || !gesture.moved) return;
    const pose = gesture.group
      ? gesture.pose ?? { ...gesture.transform, x: gesture.startX + gesture.dx,
        y: gesture.startY + gesture.dy }
      : readTransform(gesture.container);
    reportLiveValues(gesture.overlayId, { x: pose.x, y: pose.y,
      scale: pose.scale, scaleX: pose.scaleX ?? pose.scale,
      scaleY: pose.scaleY ?? pose.scale, rotate: pose.rotate });
  }
  let activeLine = null;
  let rotationBadge = null;
  let handleHint = null;
  let activeEdit = null;
  let editCaret = null;
  let editCaretAnimation = null;
  let selftestOverlayOverride = null;
  let verticalSnapGuide = null;
  let horizontalSnapGuide = null;
  let extraSnapTargets = null;
  let nudge = null;
  let nudgeTimer = null;
  let lastClick = null;
  let clickOrigin = null;
  let pendingBlank = null;
  let marqueeFrame = null;
  let hoverFrame = null;
  let hoverTick = null;
  let hoverEvent = null;

  // 当たり判定規約は断片の inline style へ一時的に pointer-events を置く。
  // テキスト編集で断片 HTML を保存するときに作者の元指定へ戻せるよう、初回値だけ保持する。
  const hitPolicyOriginalPointerEvents = new WeakMap();
  const hitPolicyAppliedContainers = new WeakSet();
  const hitPolicyTimes = new WeakMap();
  const staleHitPolicyContainers = new Set();
  const pausedHitPolicyContainers = new Set();
  let pausedHitPolicyTimer = null;
  let lastPointerHitPolicyRefresh = -Infinity;

  function hitPolicyOperationBusy() {
    return Boolean(activeEdit || activeDrag || activeResize || activeRotate || activeLine
      || marqueeFrame || pointerOwner != null);
  }

  function schedulePausedHitPolicyRefresh(delay = 120) {
    if (typeof setTimeout !== 'function') return;
    if (pausedHitPolicyTimer !== null) clearTimeout(pausedHitPolicyTimer);
    pausedHitPolicyTimer = setTimeout(flushPausedHitPolicies, delay);
  }

  // runtime は可視コンテナの時刻だけを記録する。CSS の読み取りはここでは行わない。
  function markOverlayHitPolicyStale(container, localTimeMs, paused = false, reentered = false,
    animationReady = null) {
    if (!container) return;
    let state = hitPolicyTimes.get(container);
    if (!state) {
      state = { current: localTimeMs, measured: null, paused: null };
      hitPolicyTimes.set(container, state);
    }
    const timeChanged = state.current !== localTimeMs;
    const enteredPause = paused && state.paused !== true;
    state.current = localTimeMs;
    state.paused = paused;
    if (reentered) {
      state.measured = null;
      hitPolicyAppliedContainers.delete(container);
    }
    if (state.measured !== localTimeMs) staleHitPolicyContainers.add(container);
    // pause()/currentTime の pending 補正はこの tick の測定より後に解決し得る。
    // 暫定 apply が stale を消しても、停止後の一回は別の印で必ず残す。
    if (paused && (reentered || timeChanged || enteredPause)) pausedHitPolicyContainers.add(container);
    if (!paused) pausedHitPolicyContainers.delete(container);
    if (paused && pausedHitPolicyContainers.size) {
      // スクラブ中は連続 tick をまとめ、停止後にポインタ無しで確定する。
      schedulePausedHitPolicyRefresh();
    }
    if (paused && (reentered || timeChanged || enteredPause) && animationReady?.then) {
      const expectedState = state;
      animationReady.then(() => {
        if (hitPolicyTimes.get(container) !== expectedState || !state.paused
          || state.current !== localTimeMs) return;
        // ready 後の currentTime 補正が 120ms の測定より遅れた場合も追い付く。
        const alreadyRefreshed = !pausedHitPolicyContainers.has(container);
        pausedHitPolicyContainers.add(container);
        schedulePausedHitPolicyRefresh(alreadyRefreshed ? 0 : 120);
      });
    }
  }

  function flushPausedHitPolicies() {
    pausedHitPolicyTimer = null;
    if (pausedHitPolicyContainers.size === 0) return;
    if (hitPolicyOperationBusy()) {
      // 編集・ジェスチャーが終わるまで印を保持する。
      pausedHitPolicyTimer = setTimeout(flushPausedHitPolicies, 120);
      return;
    }
    refreshStaleHitPolicies(true);
  }

  function refreshStaleHitPolicies(includePaused = false) {
    if (hitPolicyOperationBusy()) return false;
    let refreshed = false;
    const candidates = includePaused ? pausedHitPolicyContainers : staleHitPolicyContainers;
    for (const container of candidates) {
      if (includePaused) pausedHitPolicyContainers.delete(container);
      if (!container.isConnected || container.style.visibility === 'hidden') {
        staleHitPolicyContainers.delete(container);
        continue;
      }
      invalidateOverlayHitPolicy(container);
      applyOverlayHitPolicy(container);
      refreshed = true;
    }
    return refreshed;
  }

  function forgetOverlayHitPolicyTracking(container) {
    staleHitPolicyContainers.delete(container);
    pausedHitPolicyContainers.delete(container);
    hitPolicyTimes.delete(container);
    hitPolicyAppliedContainers.delete(container);
  }

  // overlay_write は操作順を保存する。selftest は今回の書き込みをこの記録から待つ。
  let writeTail = Promise.resolve();
  let writeGeneration = 0;
  let lastTransformWrite = null;
  const pendingDragTransforms = new Map();
  let activeModelPose = null;
  function endDragGesture() {
    window.akari.reportGesture?.('end');
    window.akari.flushPendingGestureModel?.();
  }

  // A model message may have been prepared before the write that just completed.
  // Keep the visible pose until the model actually contains that write.
  function protectModelSummary(next) {
    if (!next || !Array.isArray(next.overlays)) return next;
    const active = activeDrag && !activeDrag.group && activeDrag.overlayId
      ? { container: activeDrag.container, transform: readTransform(activeDrag.container) } : null;
    activeModelPose = active;
    const overlays = next.overlays.map(overlay => {
      const pending = overlay.id === activeDrag?.overlayId ? active : pendingDragTransforms.get(overlay.id);
      if (!pending) return overlay;
      if (pending === active) return { ...overlay,
        transform: { ...overlay.transform, ...pending.transform } };
      const matches = pending.keyframes
        ? JSON.stringify(overlay.keyframes) !== pending.beforeKeyframes
        : Number(overlay.transform?.x ?? 0) === pending.transform.x
          && Number(overlay.transform?.y ?? 0) === pending.transform.y;
      if (pending.saved && matches) {
        pendingDragTransforms.delete(overlay.id);
        delete pending.container.dataset.akariMotionDragging;
        return overlay;
      }
      return { ...overlay, transform: { ...overlay.transform, ...pending.transform } };
    });
    const tree = Array.isArray(next.tree) ? next.tree.map(node => {
      const pending = node.id === activeDrag?.overlayId ? active : pendingDragTransforms.get(node.id);
      return pending && node.kind === 'leaf'
        ? { ...node, transform: { ...node.transform, ...pending.transform } } : node;
    }) : next.tree;
    return { ...next, overlays, tree };
  }

  function restorePendingDragTransforms() {
    for (const [id, pending] of pendingDragTransforms) {
      if (pending.container.isConnected === false) {
        pending.container = containerById(id) ?? pending.container;
        if (pending.keyframes) pending.container.dataset.akariMotionDragging = 'true';
      }
      pending.container.style.setProperty('--x', `${pending.transform.x}px`);
      pending.container.style.setProperty('--y', `${pending.transform.y}px`);
    }
    if (activeModelPose) {
      activeModelPose.container.style.setProperty('--x', `${activeModelPose.transform.x}px`);
      activeModelPose.container.style.setProperty('--y', `${activeModelPose.transform.y}px`);
      activeModelPose = null;
    }
  }

  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function resultText(result) {
    if (result === undefined) return "undefined";
    if (result === null) return "null";
    if (typeof result === "string") return result;

    try {
      return JSON.stringify(result) ?? String(result);
    } catch {
      return String(result);
    }
  }

  function reportWriteError(kind, overlayId, error) {
    console.error(`${kind} の永続化に失敗しました (${overlayId}):`, error);
  }

  function captureWriteContext() {
    return {
      editPath: window.akari.state?.editPath ?? null,
      engine: window.akari.engine ?? null,
    };
  }

  function enqueueWrite(context, overlayId, patch, kind) {
    const generation = ++writeGeneration;
    const promise = writeTail.then(() => {
      if (!context.editPath) {
        throw new Error("編集中の edit.json がありません");
      }
      if (typeof context.engine?.overlayWrite !== "function") {
        throw new Error("overlayWrite を利用できません");
      }

      return context.engine.overlayWrite(context.editPath, overlayId, patch);
    });

    // 失敗後も後続の操作を流しつつ、呼び出し側には元の成否を返す。
    writeTail = promise.catch(() => undefined);
    promise.catch((error) => reportWriteError(kind, overlayId, error));

    return { generation, overlayId, promise };
  }

  function enqueueWriteBatch(context, writes) {
    const generation = ++writeGeneration;
    const promise = writeTail.then(() => {
      if (!context.editPath) throw new Error("編集中の edit.json がありません");
      if (typeof context.engine?.overlayWriteBatch !== 'function') throw new Error('overlayWriteBatch を利用できません');
      return context.engine.overlayWriteBatch(writes);
    });
    writeTail = promise.catch(() => undefined);
    return { generation, promise };
  }

  function selectionKind() { return selectedIds.length > 1 ? 'multi' : groupSelection ? 'group' : 'leaf'; }
  function collectiveSelection() { return groupSelection || selectedIds.length > 1; }
  function selectionMembers() { return [...new Set(selectedIds.flatMap(id => visibleMembers(id)))]; }
  function markSelectionMembers() {
    const members = new Set(selectionMembers());
    for (const element of stage?.children ?? []) {
      if (members.has(element)) {
        if (!element.hasAttribute('data-akari-interaction-selected')) element.setAttribute('data-akari-interaction-selected', 'true');
      } else element.removeAttribute('data-akari-interaction-selected');
    }
  }

  function findOverlayContainer(target) {
    if (!stage || !(target instanceof Node)) return null;

    let element = target instanceof Element ? target : target.parentElement;
    while (element && element !== stage) {
      if (
        element.parentElement === stage &&
        element.hasAttribute("data-overlay-id")
      ) {
        return element;
      }
      element = element.parentElement;
    }

    return null;
  }

  function contentBounds(element, container) {
    return selectionContentBounds(element, {
      container,
      visibleRect: (rect, node) => visibleFragmentRect(rect, node, container),
      rawRect: node => node.tagName.toUpperCase() === "CANVAS"
        ? (canvasHasDecoration(node) ? node.getBoundingClientRect()
          : window.akari.threeRuntime?.contentBounds?.(node)
            ?? measureCanvasBounds(node) ?? node.getBoundingClientRect())
        : node.getBoundingClientRect(),
    });
  }
  function selectionOptions(root) {
    return { boundsFor: element => contentBounds(element, root?.parentElement) };
  }

  // 断片ルートは「inset:0 全画面ラッパー + flex/絶対配置」パターン（overlay-authoring
  // 規約・text-behind-person.md 等）を許容するため、ルート自身の矩形がコンテナ（断片の
  // 親 = [data-overlay-id] 要素。overlay-runtime.js の mount() が inset:0 で全画面付与）
  // をほぼ覆う場合は「ルート＝見た目上の透明な位置決めラッパー」とみなし、可視子孫の
  // union へフォールバックする。マット動画等で子孫側も実際に全画面を占める場合は
  // union も自然に全画面へ収束する（= 見た目どおりで正しい）。
  const FULL_CONTAINER_COVERAGE_RATIO = 0.98;

  function looksLikeFullContainerWrapper(rect, containerRect) {
    if (!containerRect || !(containerRect.width > 0) || !(containerRect.height > 0)) {
      return false;
    }
    return (
      rect.width >= containerRect.width * FULL_CONTAINER_COVERAGE_RATIO &&
      rect.height >= containerRect.height * FULL_CONTAINER_COVERAGE_RATIO
    );
  }

  function legacyFragmentBounds(container) {
    const root = fragmentRoot(container);
    if (!root) return null;

    const rootRect = visibleFragmentRect(root.getBoundingClientRect(), root, container);
    const containerRect = container.getBoundingClientRect();
    if (
      rootRect && !["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName.toUpperCase()) &&
      [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
        Number.isFinite
      ) &&
      rootRect.width > 0 &&
      rootRect.height > 0 &&
      !looksLikeFullContainerWrapper(rootRect, containerRect) &&
      !(root.tagName.toLowerCase() === 'svg' && root.querySelector('g[clip-path], g[mask]')) &&
      root.tagName.toUpperCase() !== "CANVAS"
    ) {
      return {
        left: rootRect.left,
        top: rootRect.top,
        right: rootRect.right,
        bottom: rootRect.bottom,
        width: rootRect.width,
        height: rootRect.height,
      };
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const candidates = [];
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (NON_RENDERED_HIT_ELEMENTS.has(element.tagName.toUpperCase())
        || SVG_DEFINITION_ELEMENTS.has(element.tagName.toLowerCase())
        || [...SVG_DEFINITION_ELEMENTS].some(tag => element.closest(tag))
        || element.closest("[data-akari-interaction]")
        || !isPaintedElement(element, container)) continue;
      // An SVG viewport clips its children, but is not itself painted when it only
      // contains geometry. Let the clipped geometry determine the visible box.
      if (element.tagName.toLowerCase() === 'svg'
        && element.querySelector([...SVG_PAINT_ELEMENTS].join(','))
        && transparentColor(getComputedStyle(element).backgroundColor)) continue;
      const rawRect = element.tagName.toUpperCase() === "CANVAS"
        ? (canvasHasDecoration(element) ? element.getBoundingClientRect()
          : window.akari.threeRuntime?.contentBounds?.(element)
            ?? measureCanvasBounds(element) ?? element.getBoundingClientRect())
        : element.getBoundingClientRect();
      const rect = visibleFragmentRect(rawRect, element, container);
      if (!rect) continue;
      candidates.push({ element, rect });
    }
    for (const { element, rect } of candidates) {
      // 透明な全画面位置決め要素だけを縮み包む。背景/画像等の実体は残す。
      if (looksLikeFullContainerWrapper(rect, containerRect)
        && !drawsOwnContent(element, getComputedStyle(element))
        && candidates.some((candidate) => candidate.element !== element
          && element.contains(candidate.element)
          && !looksLikeFullContainerWrapper(candidate.rect, containerRect))) continue;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }

    if (![left, top, right, bottom].every(Number.isFinite)) {
      // 可視子孫が一つも無い（ルート自身が唯一のコンテンツ、かつ全画面ラッパー疑い）
      // 場合、選択そのものを失わせるより「全画面でも」ルート自身の矩形を使う方が実用的。
      if (
        rootRect && !["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName.toUpperCase()) &&
        [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
          Number.isFinite
        ) &&
        rootRect.width > 0 &&
        rootRect.height > 0
      ) {
        return {
          left: rootRect.left,
          top: rootRect.top,
          right: rootRect.right,
          bottom: rootRect.bottom,
          width: rootRect.width,
          height: rootRect.height,
        };
      }
      return null;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function fragmentBounds(container) {
    const root = fragmentRoot(container);
    if (!root) return null;
    if (drawsOwnContent(root, getComputedStyle(root))) return legacyFragmentBounds(container);
    return contentBounds(root, container) ?? legacyFragmentBounds(container);
  }

  function svgReferenceRect(element, value) {
    const id = String(value ?? '').match(/url\(["']?(?:[^#)]*#)([^)"']+)["']?\)/)?.[1];
    const svg = element.namespaceURI === 'http://www.w3.org/2000/svg'
      ? (element.closest('svg') ?? element.ownerSVGElement) : null;
    const reference = id && svg && [...svg.querySelectorAll('[id]')]
      .find(node => node.id === id);
    if (!reference || !element.getScreenCTM) return null;
    try {
      const shapes = [...reference.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, use, text, image')];
      const boxes = shapes.filter(shape => typeof shape.getBBox === 'function')
        .map(shape => shape.getBBox()).filter(box => box.width > 0 && box.height > 0);
      if (!boxes.length) return null;
      const box = { x: Math.min(...boxes.map(item => item.x)),
        y: Math.min(...boxes.map(item => item.y)),
        width: Math.max(...boxes.map(item => item.x + item.width)) - Math.min(...boxes.map(item => item.x)),
        height: Math.max(...boxes.map(item => item.y + item.height)) - Math.min(...boxes.map(item => item.y)) };
      const matrix = element.getScreenCTM();
      if (!matrix || !(box.width > 0) || !(box.height > 0)) return null;
      const points = [
        [box.x, box.y], [box.x + box.width, box.y],
        [box.x, box.y + box.height], [box.x + box.width, box.y + box.height],
      ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f }));
      return { left: Math.min(...points.map(point => point.x)),
        top: Math.min(...points.map(point => point.y)),
        right: Math.max(...points.map(point => point.x)),
        bottom: Math.max(...points.map(point => point.y)) };
    } catch { return null; }
  }

  function visibleFragmentRect(rect, element, container) {
    if (!rect || ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
      || !(rect.width > 0) || !(rect.height > 0)) return null;
    let { left, top, right, bottom } = rect;
    for (let node = element; node && node !== container; node = node.parentElement) {
      const style = getComputedStyle(node);
      const svgViewport = node.tagName.toLowerCase() === 'svg';
      const containPaint = /\b(?:paint|content|strict)\b/.test(style.contain ?? '');
      const overflowX = style.overflowX || style.overflow;
      const overflowY = style.overflowY || style.overflow;
      const clipX = containPaint || svgViewport || overflowX !== 'visible';
      const clipY = containPaint || svgViewport || overflowY !== 'visible';
      if (clipX || clipY) {
        const clip = node.getBoundingClientRect();
        if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      for (const value of [style.clipPath, style.maskImage, node.getAttribute('clip-path'), node.getAttribute('mask')]) {
        const clip = svgReferenceRect(node, value);
        if (!clip) continue;
        left = Math.max(left, clip.left); top = Math.max(top, clip.top);
        right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
      }
      if (right <= left || bottom <= top) return null;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function isPaintedElement(element, container) {
    const style = getComputedStyle(element);
    if (["hidden", "collapse"].includes(style.visibility)) return false;
    for (let node = element; node && node !== container; node = node.parentElement) {
      const ancestorStyle = getComputedStyle(node);
      if (ancestorStyle.display === "none" || Number(ancestorStyle.opacity) === 0) return false;
    }
    return true;
  }

  const canvasSnapshots = new WeakMap();
  const alphaHitCanvases = new WeakSet();
  const forwardedCanvasEvents = new WeakSet();
  const CANVAS_ALPHA_THRESHOLD = 16;

  // Three の内容枠申告と同じ描画直後にコピーする。preserveDrawingBuffer=false の
  // バッファが提示後に消えても読める。GPU→CPU の 1px 読み出しはクリック時だけ。
  function captureCanvasContent(canvas) {
    try {
      let copy = canvasSnapshots.get(canvas);
      if (!copy) copy = document.createElement("canvas");
      if (copy.width !== canvas.width) copy.width = canvas.width;
      if (copy.height !== canvas.height) copy.height = canvas.height;
      const context = copy.getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, copy.width, copy.height);
      context.drawImage(canvas, 0, 0);
      canvasSnapshots.set(canvas, copy);
    } catch {
      canvasSnapshots.delete(canvas);
    }
  }

  function readableCanvas(canvas) {
    const copy = canvasSnapshots.get(canvas);
    if (copy && copy.width === canvas.width && copy.height === canvas.height) return copy;
    if (canvas.getContext("2d")) return canvas;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    // 未保存の WebGL バッファは「透明」ではなく「読めない」。従来の当たりへ退避する。
    if (!gl || gl.isContextLost() || !gl.getContextAttributes()?.preserveDrawingBuffer) return null;
    return canvas;
  }

  function canvasClientGeometry(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = canvas.offsetWidth, height = canvas.offsetHeight;
    if (!window.DOMMatrix || !(width > 0 && height > 0)) return null;
    let matrix = new window.DOMMatrix();
    for (let node = canvas; node instanceof Element; node = node.parentElement) {
      const transform = getComputedStyle(node).transform;
      if (transform && transform !== "none") {
        const parentMatrix = new window.DOMMatrix(transform);
        if (!parentMatrix.is2D) return null;
        matrix = parentMatrix.multiply(matrix);
      }
    }
    // rect 中心が transform-origin/translate を含む平行移動をすべて吸収する。
    return { rect, width, height, matrix };
  }

  function canvasClientBounds(canvas, box) {
    const rect = canvas.getBoundingClientRect();
    const geometry = canvasClientGeometry(canvas);
    const points = [];
    for (const x of [box.left, box.right]) {
      for (const y of [box.top, box.bottom]) {
        if (geometry) {
          const point = geometry.matrix.transformPoint({
            x: (x - 0.5) * geometry.width, y: (y - 0.5) * geometry.height,
          });
          points.push({ x: rect.left + rect.width / 2 + point.x - geometry.matrix.e,
            y: rect.top + rect.height / 2 + point.y - geometry.matrix.f });
        } else points.push({ x: rect.left + x * rect.width, y: rect.top + y * rect.height });
      }
    }
    const left = Math.min(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    const right = Math.max(...points.map(point => point.x));
    const bottom = Math.max(...points.map(point => point.y));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function canvasAlphaAtPoint(canvas, clientX, clientY) {
    try {
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0 && canvas.width > 0 && canvas.height > 0)) return 255;
      let x = (clientX - rect.left) / rect.width;
      let y = (clientY - rect.top) / rect.height;
      const geometry = canvasClientGeometry(canvas);
      if (geometry) {
        const point = geometry.matrix.inverse().transformPoint({
          x: clientX - rect.left - rect.width / 2 + geometry.matrix.e,
          y: clientY - rect.top - rect.height / 2 + geometry.matrix.f,
        });
        x = point.x / geometry.width + 0.5;
        y = point.y / geometry.height + 0.5;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 255;
      if (x < 0 || y < 0 || x >= 1 || y >= 1) return 0;
      // CSS の背景/枠も canvas 自身の描画。ビットマップが透明でも素通ししない。
      if (canvasHasDecoration(canvas)) return 255;
      const source = readableCanvas(canvas);
      if (!source) return 255;
      const sample = document.createElement("canvas");
      sample.width = sample.height = 1;
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(source, Math.floor(x * source.width), Math.floor(y * source.height), 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    } catch {
      return 255;
    }
  }

  function canvasHasDecoration(canvas) {
    // CANVAS の置換要素扱いだけを除外し、同じ背景/枠/影ルールを使う。
    return drawsOwnContent({ tagName: "DIV", childNodes: [] }, getComputedStyle(canvas));
  }

  function measureCanvasBounds(canvas) {
    try {
      if (canvasHasDecoration(canvas)) return null;
      const source = readableCanvas(canvas);
      if (!source || !(source.width > 0 && source.height > 0)) return null;
      const sample = document.createElement("canvas");
      const scale = Math.min(1, 320 / Math.max(source.width, source.height));
      sample.width = Math.max(1, Math.round(source.width * scale));
      sample.height = Math.max(1, Math.round(source.height * scale));
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(source, 0, 0, sample.width, sample.height);
      const data = context.getImageData(0, 0, sample.width, sample.height).data;
      let x0 = sample.width, y0 = sample.height, x1 = -1, y1 = -1;
      for (let y = 0; y < sample.height; y++) {
        for (let x = 0; x < sample.width; x++) {
          if (data[(y * sample.width + x) * 4 + 3] <= CANVAS_ALPHA_THRESHOLD) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 < 0) return null;
      return canvasClientBounds(canvas, { left: x0 / sample.width, top: y0 / sample.height,
        right: (x1 + 1) / sample.width, bottom: (y1 + 1) / sample.height });
    } catch {
      return null;
    }
  }

  function passTransparentCanvasEvent(event) {
    if (forwardedCanvasEvents.has(event) || !alphaHitCanvases.has(event.target)
      || canvasAlphaAtPoint(event.target, event.clientX, event.clientY) > CANVAS_ALPHA_THRESHOLD) return;
    const hidden = [];
    let target = event.target;
    try {
      // 重なった透明 canvas も順に外し、実際の DOM z 順で下の素材を選ぶ。
      while (target && alphaHitCanvases.has(target)
        && canvasAlphaAtPoint(target, event.clientX, event.clientY) <= CANVAS_ALPHA_THRESHOLD) {
        hidden.push(target);
        target.style.setProperty("pointer-events", "none", "important");
        target = document.elementFromPoint(event.clientX, event.clientY);
      }
      if (!target || target === event.target) return;
      const EventType = event.type.startsWith("pointer") ? PointerEvent : MouseEvent;
      const forwarded = new EventType(event.type, event);
      forwardedCanvasEvents.add(forwarded);
      event.stopImmediatePropagation();
      if (event.cancelable) event.preventDefault();
      target.dispatchEvent(forwarded);
    } finally {
      for (const canvas of hidden) canvas.style.setProperty("pointer-events", "auto", "important");
    }
  }

  function transparentColor(value) {
    const color = String(value ?? "").trim().toLowerCase();
    if (!color || color === "transparent") return true;
    const legacyAlpha = color.match(/^(?:rgba|hsla)\([^)]*,\s*([\d.]+)\)$/);
    if (legacyAlpha) return Number(legacyAlpha[1]) <= 0;
    const modernAlpha = color.match(/\/\s*([\d.]+)%?\s*\)$/);
    return Boolean(modernAlpha && Number(modernAlpha[1]) <= 0);
  }

  function visibleShadow(value) {
    const shadow = String(value ?? "").trim().toLowerCase();
    if (!shadow || shadow === "none") return false;
    const colors =
      shadow.match(/(?:rgba?|hsla?|color)\([^)]*\)|transparent/g) ?? [];
    return colors.length === 0 || colors.some((color) => !transparentColor(color));
  }

  function hasDirectText(element) {
    return Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ""
    );
  }

  function drawsOwnContent(element, style) {
    const tag = element.tagName.toUpperCase();
    if (NON_RENDERED_HIT_ELEMENTS.has(tag)) return false;
    if (REPLACED_HIT_ELEMENTS.has(tag)) return true;
    if (hasDirectText(element)) return true;
    if (!transparentColor(style.backgroundColor)) return true;
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    if (visibleShadow(style.boxShadow)) return true;

    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (
        parseFloat(style[`border${side}Width`]) > 0 &&
        !["none", "hidden"].includes(style[`border${side}Style`]) &&
        !transparentColor(style[`border${side}Color`])
      ) {
        return true;
      }
    }

    return (
      parseFloat(style.outlineWidth) > 0 &&
      !["none", "hidden"].includes(style.outlineStyle) &&
      !transparentColor(style.outlineColor)
    );
  }

  function setHitPointerEvents(element, value) {
    if (!hitPolicyOriginalPointerEvents.has(element)) {
      hitPolicyOriginalPointerEvents.set(element, {
        value: element.style.getPropertyValue("pointer-events"),
        priority: element.style.getPropertyPriority("pointer-events"),
      });
    }
    // 作者 CSS に旧来の pointer-events 指定が残っていても、逃げ道を data-akari-hit へ
    // 一本化するためランタイム規約を優先する。保存時は上の記録から元指定へ戻す。
    element.style.setProperty("pointer-events", value, "important");
  }

  const HIT_PROXY_SELECTOR = '[data-akari-hit-proxy="1"]';
  const SHAPE_LINE_HIT_WIDTH_PX = 13;
  const shapeLineHitContainers = new Set();
  const hitProxyScreenScales = new WeakMap();

  function isHitProxy(element) {
    return element?.getAttribute?.('data-akari-hit-proxy') === '1';
  }

  function removeHitProxies(root) {
    if (isHitProxy(root) && typeof root.remove === 'function') root.remove();
    for (const proxy of root.querySelectorAll?.(HIT_PROXY_SELECTOR) ?? []) {
      if (isHitProxy(proxy) && typeof proxy.remove === 'function') proxy.remove();
    }
  }

  function syncLineHitProxy(element) {
    const previous = element.nextElementSibling;
    if (isHitProxy(previous)) previous.remove();
    const proxy = element.cloneNode(false);
    proxy.removeAttribute('id');
    proxy.removeAttribute('stroke-dasharray');
    for (const attribute of [...proxy.attributes]) {
      if (attribute.name.startsWith('marker-') || attribute.name.startsWith('data-line-')) {
        proxy.removeAttribute(attribute.name);
      }
    }
    proxy.setAttribute('data-akari-hit-proxy', '1');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.setAttribute('fill', 'none');
    proxy.setAttribute('stroke', 'transparent');
    proxy.removeAttribute('vector-effect');
    proxy.setAttribute('stroke-linecap', 'round');
    proxy.setAttribute('stroke-linejoin', 'round');
    for (const [name, value] of [
      ['fill', 'none'], ['stroke', 'transparent'], ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['stroke-dasharray', 'none'], ['marker-start', 'none'], ['marker-mid', 'none'],
      ['marker-end', 'none'],
    ]) proxy.style.setProperty(name, value, 'important');
    proxy.style.setProperty('vector-effect', 'none', 'important');
    proxy.style.setProperty('pointer-events', 'stroke', 'important');
    element.after(proxy);
  }

  function lineHitScreenScale(source) {
    const isLine = source.tagName.toLowerCase() === 'line';
    let normalX = 0, normalY = 1;
    if (isLine) {
      const dx = Number(source.getAttribute('x2')) - Number(source.getAttribute('x1'));
      const dy = Number(source.getAttribute('y2')) - Number(source.getAttribute('y1'));
      const length = Math.hypot(dx, dy);
      if (!(length > 0)) return 0;
      normalX = -dy / length;
      normalY = dx / length;
    }
    const matrix = source.getScreenCTM?.();
    if (matrix) {
      if (isLine) return Math.hypot(matrix.a * normalX + matrix.c * normalY,
        matrix.b * normalX + matrix.d * normalY);
      return Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
    }
    const svg = source.ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    const width = svg?.viewBox?.baseVal?.width || Number(svg?.getAttribute('width'));
    const height = svg?.viewBox?.baseVal?.height || Number(svg?.getAttribute('height'));
    const scaleX = rect?.width / width, scaleY = rect?.height / height;
    if (isLine) return Math.hypot(scaleX * normalX, scaleY * normalY);
    return Math.min(scaleX, scaleY);
  }

  function updateShapeLineHitProxyWidths() {
    if (shapeLineHitContainers.size === 0) return;
    for (const container of shapeLineHitContainers) {
      if (!container.isConnected) {
        shapeLineHitContainers.delete(container);
        continue;
      }
      const proxies = container.querySelectorAll(HIT_PROXY_SELECTOR);
      if (proxies.length === 0) {
        shapeLineHitContainers.delete(container);
        continue;
      }
      for (const proxy of proxies) {
        const source = proxy.previousElementSibling;
        if (!source || isHitProxy(source)) continue;
        const scale = lineHitScreenScale(source);
        if (!(scale > 0) || !Number.isFinite(scale) || hitProxyScreenScales.get(proxy) === scale) continue;
        const originalWidth = Number.parseFloat(getComputedStyle(source).strokeWidth) || 0;
        const width = Math.max(SHAPE_LINE_HIT_WIDTH_PX / scale, originalWidth);
        proxy.setAttribute('stroke-width', String(width));
        proxy.style.setProperty('stroke-width', String(width), 'important');
        hitProxyScreenScales.set(proxy, scale);
      }
    }
  }

  // 全画面の外側コンテナと断片ルートは素通しにし、実際に背景・枠・影・文字・置換要素を
  // 描く可視の子孫だけを拾う。data-akari-hit は最寄りの指定を配下へ継承し、機械判定より
  // 優先する。字幕が 1,000 件級でも全件を走査しないよう、runtime は可視コンテナの
  // 初回・停止後・ポインタ入力時だけ適用し、再生 tick では時刻の印だけを付ける。
  function fragmentRootCoversContainer(element, container) {
    const rootRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (!(rootRect.width > 0) || !(rootRect.height > 0)
      || !(containerRect.width > 0) || !(containerRect.height > 0)) {
      return false;
    }
    return rootRect.width >= containerRect.width * 0.98
      && rootRect.height >= containerRect.height * 0.98;
  }

  function applyOverlayHitPolicy(container) {
    if (!container || hitPolicyAppliedContainers.has(container)) return;

    shapeLineHitContainers.delete(container);
    if (container.dataset.role === 'shape-line') removeHitProxies(container);
    setHitPointerEvents(container, "none");

    function visit(element, inheritedDirective, ancestorPainted, isFragmentRoot) {
      if (isHitProxy(element)) return;
      const tag = element.tagName.toLowerCase();
      if (SVG_DEFINITION_ELEMENTS.has(tag)) return;
      const declared = element.getAttribute("data-akari-hit");
      const directive = ["pass", "catch"].includes(declared)
        ? declared
        : inheritedDirective;
      const style = getComputedStyle(element);
      const participatesInPaint =
        ancestorPainted && style.display !== "none" && Number(style.opacity) > 0;
      const isVisible =
        participatesInPaint && !["hidden", "collapse"].includes(style.visibility);

      let pointerEvents = "none";
      if (isVisible && directive === "catch") {
        pointerEvents = "auto";
      } else if (
        isVisible &&
        directive !== "pass" &&
        (!isFragmentRoot || !fragmentRootCoversContainer(element, container)) &&
        drawsOwnContent(element, style)
      ) {
        pointerEvents = "auto";
      }
      if (tag === 'svg') {
        pointerEvents = 'none';
      } else if (element.namespaceURI === 'http://www.w3.org/2000/svg' && isVisible && !directive) {
        pointerEvents = SVG_PAINT_ELEMENTS.has(tag) ? 'visiblePainted' : 'none';
      }
      // 明示 catch/pass は優先。自動判定の canvas は window 捕捉でアルファを検査する。
      alphaHitCanvases.delete(element);
      if (element.tagName === "CANVAS" && pointerEvents === "auto" && !directive) {
        alphaHitCanvases.add(element);
      }
      setHitPointerEvents(element, pointerEvents);

      if (container.dataset.role === 'shape-line'
        && isVisible && !directive && ['line', 'path'].includes(element.tagName.toLowerCase())
        && !element.closest('defs, marker, clipPath, mask, pattern, symbol')
        && ((style.stroke !== 'none' && !transparentColor(style.stroke)
          && Number.parseFloat(style.strokeWidth) > 0)
          || (element.tagName.toLowerCase() === 'path' && style.fill !== 'none'
            && !transparentColor(style.fill)))) {
        syncLineHitProxy(element);
        shapeLineHitContainers.add(container);
      }

      for (const child of [...element.children]) {
        visit(child, directive, participatesInPaint, false);
      }
    }

    for (const root of container.children) visit(root, null, true, true);
    hitPolicyAppliedContainers.add(container);
    const state = hitPolicyTimes.get(container);
    if (state) state.measured = state.current;
    staleHitPolicyContainers.delete(container);
    updateShapeLineHitProxyWidths();
  }

  function invalidateOverlayHitPolicy(container) {
    if (container) hitPolicyAppliedContainers.delete(container);
  }

  function restoreHitPolicyStyles(cloneRoot, liveRoot) {
    removeHitProxies(cloneRoot);
    const clones = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
    const liveElements = [liveRoot, ...Array.from(liveRoot.querySelectorAll("*"))
      .filter(element => !isHitProxy(element))];
    for (let index = 0; index < liveElements.length; index += 1) {
      const original = hitPolicyOriginalPointerEvents.get(liveElements[index]);
      const clone = clones[index];
      if (!original || !clone) continue;
      if (original.value) {
        clone.style.setProperty("pointer-events", original.value, original.priority);
      } else {
        clone.style.removeProperty("pointer-events");
        if (!clone.getAttribute("style")) clone.removeAttribute("style");
      }
    }
  }

  // 旧ホストとの公開 API 互換のため呼び口は残す。当たり判定は
  // applyOverlayHitPolicy() の pointer-events 規約だけで完結し、描画を切る
  // clip-path は一切書かない。
  function syncOverlayHitRegion() {}

  function outputSize() {
    const output = window.akari.state?.summary?.output;
    const width = Number(output?.width);
    const height = Number(output?.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : DEFAULT_OUTPUT_WIDTH,
      height:
        Number.isFinite(height) && height > 0 ? height : DEFAULT_OUTPUT_HEIGHT,
    };
  }

  function createSnapGuide(axis) {
    const guide = document.createElement("div");
    guide.className = `akari-interaction-snap-guide is-${axis}`;
    guide.setAttribute("data-akari-interaction", `snap-guide-${axis}`);
    guide.setAttribute("aria-hidden", "true");
    guide.hidden = true;
    return guide;
  }

  function ensureSnapGuides() {
    if (!stage) return null;

    if (
      !verticalSnapGuide?.isConnected ||
      verticalSnapGuide.parentElement !== document.body
    ) {
      verticalSnapGuide = createSnapGuide("vertical");
      document.body.appendChild(verticalSnapGuide);
    }
    if (
      !horizontalSnapGuide?.isConnected ||
      horizontalSnapGuide.parentElement !== document.body
    ) {
      horizontalSnapGuide = createSnapGuide("horizontal");
      document.body.appendChild(horizontalSnapGuide);
    }

    return { vertical: verticalSnapGuide, horizontal: horizontalSnapGuide };
  }

  function hideSnapGuides() {
    if (verticalSnapGuide) verticalSnapGuide.hidden = true;
    if (horizontalSnapGuide) horizontalSnapGuide.hidden = true;
  }

  function showSnapGuides(snapX, snapY) {
    if (!snapX && !snapY) {
      hideSnapGuides();
      return;
    }

    const guides = ensureSnapGuides();
    if (!guides) return;

    // 外周ターゲットは 0 / width / height だが、ガイドは -0.5px
    // translate で線の中心を合わせる。overflow:hidden にクリップされないよう、
    // 表示位置だけをステージ内側へ半ピクセルクランプする。
    const { width, height } = outputSize();
    const stageRect = stage.getBoundingClientRect();
    const sx = stageRect.width / width, sy = stageRect.height / height;
    const clampGuidePosition = (target, extent) =>
      Math.min(Math.max(target, 0.5), Math.max(0.5, extent - 0.5));

    guides.vertical.hidden = !snapX;
    if (snapX) {
      guides.vertical.style.left = `${stageRect.left + clampGuidePosition(snapX.target, width) * sx}px`;
      guides.vertical.classList.toggle('is-item', snapX.kind === 'item');
      guides.vertical.style.top = `${stageRect.top + (snapX.guide?.start ?? 0) * sy}px`;
      guides.vertical.style.bottom = 'auto';
      guides.vertical.style.height = `${((snapX.guide?.end ?? height) - (snapX.guide?.start ?? 0)) * sy}px`;
    }

    guides.horizontal.hidden = !snapY;
    if (snapY) {
      guides.horizontal.style.top = `${stageRect.top + clampGuidePosition(snapY.target, height) * sy}px`;
      guides.horizontal.classList.toggle('is-item', snapY.kind === 'item');
      guides.horizontal.style.left = `${stageRect.left + (snapY.guide?.start ?? 0) * sx}px`;
      guides.horizontal.style.right = 'auto';
      guides.horizontal.style.width = `${((snapY.guide?.end ?? width) - (snapY.guide?.start ?? 0)) * sx}px`;
    }
  }

  function overlayForEvent(event) {
    const eventTargetOverlay = findOverlayContainer(event.target);
    if (eventTargetOverlay && !isSelectable(eventTargetOverlay)) {
      return eventTargetOverlay;
    }
    if (
      selftestOverlayOverride &&
      eventTargetOverlay === selftestOverlayOverride
    ) {
      return selftestOverlayOverride;
    }
    return isSelectable(eventTargetOverlay) ? eventTargetOverlay : null;
  }

  function firstOverlayContainer() {
    if (!stage) return null;
    return (
      Array.from(stage.children).find((element) =>
        element.hasAttribute("data-overlay-id")
      ) ?? null
    );
  }

  function fragmentRoot(container) {
    return (
      Array.from(container.children).find(
        (element) => !element.hasAttribute("data-akari-interaction")
      ) ?? null
    );
  }

  // 素材の選択・ドラッグをまとめて止めるスイッチ。既定は有効なので shell / store は挙動不変。
  // Web UI は編集モードでない間これを false にする。後から選択を畳む方式だと、捕捉フェーズで
  // 既に始まったドラッグが生き残り「枠は出ないのに動かせる」状態になる（実機 2026-08-07）。
  let interactionEnabled = true;
  function setEnabled(next) {
    interactionEnabled = next !== false;
    if (!interactionEnabled) { clearMarquee(); clearSelection(); }
  }

  function isSelectable(container) {
    if (
      !stage ||
      !container ||
      !container.isConnected ||
      container.parentElement !== stage ||
      !container.hasAttribute("data-overlay-id")
    ) {
      return false;
    }

    return getComputedStyle(container).visibility !== "hidden";
  }

  // 2026-08-07 オーナー裁定・確定: role==="background" は
  // 「選択・削除はできるが、ドラッグ・拡縮では動かせない」種別（mount() が dataset.role を立てる。
  // preview-server の app.js / shell の overlay-runtime.js 双方）。要件の本質は「ずれたら直せる」
  // ではなく「ずらせない」なので、ドラッグ/リサイズの開始点そのものを isSelectable とは別に
  // isMovable で塞ぐ（選択自体は isSelectable のまま生かす）。
  function isBackgroundRole(container) {
    return Boolean(container?.dataset?.role === "background");
  }

  // edit.json の locked も「選べるが動かせない」（シェルは window.akari.lockedIds に id を置く）。
  function isLockedItem(container) {
    return isBackgroundRole(container) || Boolean(window.akari.lockedIds?.has?.(container?.dataset?.overlayId));
  }

  function isMovable(container) {
    return isSelectable(container) && !isLockedItem(container);
  }

  function cssVariableText(container, name) {
    const inlineValue = container.style.getPropertyValue(name).trim();
    if (inlineValue) return inlineValue;
    return getComputedStyle(container).getPropertyValue(name).trim();
  }

  function cssVariableNumber(container, name, fallback) {
    const value = Number.parseFloat(cssVariableText(container, name));
    return Number.isFinite(value) ? value : fallback;
  }

  function readTransform(container) {
    const scale = cssVariableNumber(container, "--scale", 1);
    const hasAxis = ["--scale-x", "--scale-y"].some(name => container.style.getPropertyValue(name).trim());
    const scaleX = cssVariableNumber(container, "--scale-x", scale);
    const scaleY = cssVariableNumber(container, "--scale-y", scale);
    return {
      x: cssVariableNumber(container, "--x", 0),
      y: cssVariableNumber(container, "--y", 0),
      scale: hasAxis && scaleX === scaleY ? scaleX : scale,
      ...(hasAxis && scaleX !== scaleY ? { scaleX, scaleY } : {}),
      rotate: cssVariableNumber(container, "--rotate", 0),
    };
  }

  function createSelectionFrame() {
    const frame = document.createElement("div");
    frame.className = "akari-interaction-selection-frame";
    frame.setAttribute("data-akari-interaction", "selection-frame");

    for (const corner of ["nw", "ne", "se", "sw"]) {
      const handle = document.createElement("span");
      handle.className = `akari-interaction-handle is-${corner}`;
      handle.setAttribute("data-akari-interaction", "selection-handle");
      handle.setAttribute("aria-hidden", "true");
      frame.appendChild(handle);
    }
    for (const edge of ["n", "e", "s", "w"]) {
      const handle = document.createElement("span");
      handle.className = `akari-interaction-handle is-edge is-${edge}`;
      handle.setAttribute("data-akari-interaction", "selection-handle");
      handle.setAttribute("aria-hidden", "true");
      frame.appendChild(handle);
    }
    for (const endpoint of ['start', 'end']) {
      const handle = document.createElement('span');
      handle.className = `akari-interaction-handle is-line-${endpoint}`;
      handle.hidden = true;
      handle.style.display = 'none';
      handle.setAttribute('data-akari-interaction', 'selection-handle');
      handle.setAttribute('aria-label', endpoint === 'start' ? '線の始点' : '線の終点');
      frame.appendChild(handle);
    }

    for (const [kind, label, path] of [
      ['rotate', '回転', '<path d="M19 7v5h-5M5 17v-5h5"/><path d="M6.7 9A7 7 0 0 1 19 12M17.3 15A7 7 0 0 1 5 12"/>'],
      ['move', '移動', '<path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3m-3 17-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m17-3-3-3m3 3-3 3"/>'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `akari-interaction-handle akari-interaction-action is-${kind}`;
      button.setAttribute('data-akari-interaction', 'selection-handle');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.style.cssText = `top:auto;bottom:-38px;left:${kind === 'rotate' ? 'calc(50% - 27px)' : 'calc(50% + 2px)'};width:25px;height:25px;transform:none;`;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
      frame.appendChild(button);
    }

    return frame;
  }

  function isTelopOverlay(container) {
    if (!container) return false;
    if (container.dataset.akariTelop === 'true') return true;
    const overlay = window.akari.state?.summary?.overlays?.find(
      item => item.id === container.dataset.overlayId);
    const source = overlay?.sourcePath || container.dataset.sourcePath || container.dataset.akariSourcePath || '';
    return /(?:^|[\\/])overlay[\\/]telop-[^\\/]+(?:[\\/]|$)/i.test(source)
      || /^telop-/.test(container.dataset.overlayId || '');
  }

  // A shape line is laid out in a wide SVG, although only its centreline and
  // caps are painted. Measure those points in client pixels instead of using
  // the SVG's rotated, axis-aligned bounding box.
  function lineFrameGeometry(container) {
    if (container?.dataset.role !== 'shape-line') return null;
    const svg = container.querySelector('svg');
    const body = svg?.querySelector('line:not([data-akari-hit-proxy]), path:not([data-akari-hit-proxy])');
    const matrix = svg?.getScreenCTM?.();
    const width = svg?.viewBox?.baseVal?.width || Number(svg?.getAttribute('width'));
    const y = body?.tagName.toLowerCase() === 'line'
      ? Number(body.getAttribute('y1')) : (svg?.viewBox?.baseVal?.height || Number(svg?.getAttribute('height'))) / 2;
    if (!body || !matrix || !(width > 0) || !Number.isFinite(y)) return null;
    const point = (x, yy, m = matrix) => ({ x: m.a * x + m.c * yy + m.e,
      y: m.b * x + m.d * yy + m.f });
    const start = point(0, y), end = point(width, y);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(length > 0)) return null;
    const nx = -(end.y - start.y) / length, ny = (end.x - start.x) / length;
    const stroke = Number(body.getAttribute('stroke-width')) || 4;
    const visibleStroke = stroke * Math.hypot(matrix.c, matrix.d);
    let paintedWidth = visibleStroke;
    if (body.tagName.toLowerCase() === 'path') {
      try {
        const bounds = body.getBBox();
        paintedWidth = Math.max(paintedWidth, bounds.height * Math.hypot(matrix.c, matrix.d));
      } catch { /* unpainted path */ }
    }
    for (const cap of svg.children) {
      if (cap === body || cap.tagName.toLowerCase() === 'defs' || cap.hasAttribute('data-akari-hit-proxy')) continue;
      const capMatrix = cap.getScreenCTM?.();
      let bounds;
      try { bounds = cap.getBBox?.(); } catch { /* unpainted cap */ }
      if (!capMatrix || !bounds || !(bounds.width > 0 || bounds.height > 0)) continue;
      const projections = [
        point(bounds.x, bounds.y, capMatrix), point(bounds.x + bounds.width, bounds.y, capMatrix),
        point(bounds.x, bounds.y + bounds.height, capMatrix),
        point(bounds.x + bounds.width, bounds.y + bounds.height, capMatrix),
      ].map(p => (p.x - start.x) * nx + (p.y - start.y) * ny);
      paintedWidth = Math.max(paintedWidth, 2 * Math.max(...projections.map(Math.abs)),
        Math.max(stroke * 3.75, 12) * Math.hypot(matrix.c, matrix.d));
    }
    const endPadding = 4;
    const frameWidth = length + 2 * endPadding;
    const frameHeight = Math.max(paintedWidth, 6) + 6;
    const centerX = (start.x + end.x) / 2, centerY = (start.y + end.y) / 2;
    return { left: centerX - frameWidth / 2, top: centerY - frameHeight / 2,
      width: frameWidth, height: frameHeight, angle: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
      endPadding, start, end };
  }

  function refreshSelectionFrame() {
    if (collectiveSelection()) { refreshGroupFrame(); return; }
    if (!stage || !isSelectable(selectedOverlay)) return;

    const transform = readTransform(selectedOverlay);
    const lineRect = lineFrameGeometry(selectedOverlay);
    const focused = focusedElement();
    const focusedGeometry = focused ? focusedSelectionGeometry(focused) : null;
    const focusedWidth = focusedGeometry && focusedGeometry.width * Math.hypot(focusedGeometry.axes.x.x, focusedGeometry.axes.x.y);
    const focusedHeight = focusedGeometry && focusedGeometry.height * Math.hypot(focusedGeometry.axes.y.x, focusedGeometry.axes.y.y);
    const focusedAngle = focusedGeometry && Math.atan2(focusedGeometry.axes.x.y, focusedGeometry.axes.x.x) * 180 / Math.PI;
    const rect = focusedGeometry ? { left: focusedGeometry.center.x - focusedWidth / 2,
      top: focusedGeometry.center.y - focusedHeight / 2, width: focusedWidth, height: focusedHeight }
      : selectedOverlay.dataset.role === 'shape-line' ? lineRect
      : transform.rotate ? unrotatedLeafBounds(selectedOverlay) : fragmentBounds(selectedOverlay);
    if (!rect) {
      if (selectionFrame) selectionFrame.hidden = true;
      return;
    }

    if (!selectionFrame?.isConnected) {
      selectionFrame = createSelectionFrame();
      // 舞台には scale() が付いており、transform は position:fixed の包含ブロックを
      // 作る（= 舞台内に置くと fixed がクライアント座標でなく舞台基準になり、位置も
      // 大きさも倍率で歪む）。選択枠はクライアント座標の矩形（fragmentBounds）を
      // そのまま使うため、transform を持たない祖先へ置く必要がある。
      // ㉑ 実機で発見・是正: 旧実装は「stage.parentElement」（テストハーネスでは
      // transform 無しの #preview-pane）へ置いていたが、本番シェルでは同じ階層が
      // #zoom-layer（プレビューズーム用に常時 transform: translate() scale() を
      // 持つ — 100% ズームでも scale(1) が設定される）で、これ自体が新たな
      // containing block を作ってしまい選択枠が本来の位置から系統的にズレる
      // （実測: 100% ズームで表示px換算 約36px×46pxの一定オフセット、機能
      // （選択・ドラッグ・拡縮）は fragmentBounds の生値を直接使うため無傷だが
      // 視覚表示だけがズレる）。document.body は transform を持たない保証がある
      // ため、そこへ固定する（listenerRoot 側も同じ理由で document 全体へ広げ済み、
      // ハンドラ内部の対象絞り込みは変更なし = 既存コメントの「祖先を広げても
      // 誤発火は無い」という設計判断のまま）。
      document.body.appendChild(selectionFrame);
    }

    // 背景・ロック中は動かせない選択であることを視覚でも伝える（拡縮ハンドルを消し、枠を破線にする。
    // interaction.css の .is-locked）。isMovable ではなく isLockedItem を見るのは、
    // 選択自体は許すが移動系操作だけを塞ぐという役割分担を CSS 側にも一致させるため。
    if (!focused && elementHandlePlacementFrame === selectionFrame) {
      const replacement = createSelectionFrame();
      selectionFrame.replaceWith(replacement);
      selectionFrame = replacement;
      elementHandlePlacementFrame = null;
    }
    selectionFrame.classList.toggle("is-locked", isLockedItem(selectedOverlay));
    selectionFrame.classList.toggle('is-busy', Boolean(activeDrag || activeResize || activeRotate || activeLine));
    selectionFrame.classList.toggle('is-moving', Boolean(activeDrag || activeRotate));
    selectionFrame.classList.toggle('is-text', selectedOverlay.dataset.role === 'text');
    selectionFrame.classList.toggle('is-telop', isTelopOverlay(selectedOverlay));
    selectionFrame.classList.toggle('is-line', selectedOverlay.dataset.role === 'shape-line');
    if (focused) elementHandlePlacementFrame = selectionFrame;
    selectionFrame.classList.toggle('is-element-focus', Boolean(focused));
    if (window.akari.capabilities?.elementSelection === true) {
      for (const handle of selectionFrame.querySelectorAll('.akari-interaction-handle')) {
        if (!focused) {
          continue;
        }
        const layout = elementHandleLayout(focusedWidth, focusedHeight);
        const name = [...handle.classList].find(token => /^is-(?:n|e|s|w|nw|ne|se|sw|rotate|move)$/.test(token))?.slice(3);
        handle.style.display = name === 'move' || (isSelectionContainer(focused) && name !== 'rotate') ||
          (['n', 's'].includes(name) && layout.hideHorizontalEdges) ||
          (['e', 'w'].includes(name) && layout.hideVerticalEdges) ? 'none' : '';
        if (name === 'rotate') {
          Object.assign(handle.style, { top: `${layout.rotateTop}px`, bottom: 'auto',
            left: '50%', transform: 'translate(-50%, -50%)' });
        } else if (name && name.length === 2) {
          const x = name.includes('w') ? -layout.cornerOffsetX : layout.cornerOffsetX;
          const y = name.includes('n') ? -layout.cornerOffsetY : layout.cornerOffsetY;
          if (x || y) handle.style.translate = `${x}px ${y}px`;
          else handle.style.removeProperty('translate');
        } else if (['n', 's', 'e', 'w'].includes(name)) {
          const x = name === 'w' ? -layout.cornerOffsetX : name === 'e' ? layout.cornerOffsetX : 0;
          const y = name === 'n' ? -layout.cornerOffsetY : name === 's' ? layout.cornerOffsetY : 0;
          if (x || y) handle.style.translate = `${x}px ${y}px`;
          else handle.style.removeProperty('translate');
        }
        if (name && name !== 'move' && name !== 'rotate') {
          const directions = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
          const base = name.length === 2
            ? (name === 'ne' || name === 'sw' ? 3 : 1)
            : name === 'n' || name === 's' ? 2 : 0;
          handle.style.cursor = directions[((base + Math.round(focusedAngle / 45)) % 4 + 4) % 4];
        }
      }
    }
    for (const endpoint of selectionFrame.querySelectorAll('.is-line-start, .is-line-end')) {
      endpoint.hidden = selectedOverlay.dataset.role !== 'shape-line';
      endpoint.style.display = selectedOverlay.dataset.role === 'shape-line' ? '' : 'none';
    }
    selectionFrame.dataset.akariSelectionKind = 'leaf';

    const usableRect =
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0;

    selectionFrame.hidden = !usableRect;
    if (!usableRect) return;

    selectionFrame.style.left = `${rect.left}px`;
    selectionFrame.style.top = `${rect.top}px`;
    selectionFrame.style.width = `${rect.width}px`;
    selectionFrame.style.height = `${rect.height}px`;
    selectionFrame.style.setProperty('--akari-line-end-inset', `${lineRect?.endPadding ?? 0}px`);
    if (lineRect) {
      selectionFrame.style.transformOrigin = 'center';
      selectionFrame.style.transform = `rotate(${lineRect.angle}deg)`;
      return;
    }
    const pivot = leafPivotClient(transform);
    selectionFrame.style.transformOrigin = focused ? 'center' : pivot
      ? `${pivot.x - rect.left}px ${pivot.y - rect.top}px` : 'center';
    selectionFrame.style.transform = focused ? `rotate(${focusedAngle}deg)` : transform.rotate ? `rotate(${transform.rotate}deg)` : '';
  }

  function trackSelectionFrame() {
    selectionTrackingFrame = null;
    if (collectiveSelection()) {
      refreshGroupFrame();
      selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
      return;
    }
    if (!selectedOverlay && selectedId && (selectionTree().length || elementFocus?.overlayId === selectedId)) {
      if (selectionTree().length && !treeNode(selectedId)) { clearSelection(); publishScopedSelection(); return; }
      const replacement = containerById(selectedId);
      if (replacement) {
        selectedOverlay = replacement;
        replacement.setAttribute('data-akari-interaction-selected', 'true');
        reconcileElementFocus();
      } else {
        selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
        return;
      }
    }
    if (!selectedOverlay) return;
    if (!selectedOverlay.isConnected && elementFocus?.overlayId === selectedId) {
      selectedOverlay = containerById(selectedId);
      if (!selectedOverlay) { selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame); return; }
      selectedOverlay.setAttribute('data-akari-interaction-selected', 'true');
      reconcileElementFocus();
    }
    if (!isSelectable(selectedOverlay)) {
      handleSelectedOverlayUnavailable(selectedOverlay);
      return;
    }

    reconcileElementFocus();
    refreshSelectionFrame();
    selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
  }

  function startSelectionTracking() {
    if (selectionTrackingFrame === null) {
      selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
    }
  }

  function clearSelection() {
    const hadElementFocus = window.akari.capabilities?.elementSelection === true && Boolean(selectedElementFocus());
    flushElementNudge();
    elementFocus = null;
    if (activeRotate) cancelRotate();
    if (activeLine) finishLineEndpoint(true);
    flushNudge();
    hideHover();
    if (selectionTrackingFrame !== null) {
      cancelAnimationFrame(selectionTrackingFrame);
      selectionTrackingFrame = null;
    }
    for (const element of stage?.children ?? []) element.removeAttribute('data-akari-interaction-selected');
    selectedOverlay?.removeAttribute("data-akari-interaction-selected");
    selectedOverlay = null;
    selectedId = null;
    selectedIds = [];
    groupSelection = false;

    selectionFrame?.remove();
    selectionFrame = null;
    hideSnapGuides();
    if (hadElementFocus) renderScopeBreadcrumb();
  }

  function handleSelectedOverlayUnavailable(container) {
    if (selectedOverlay !== container) return;
    const replacement = selectedId && containerById(selectedId);
    if (replacement && replacement !== container) {
      selectedOverlay = replacement;
      replacement.setAttribute('data-akari-interaction-selected', 'true');
      reconcileElementFocus();
      startSelectionTracking();
      return;
    }
    if ((selectionTree().length && treeNode(selectedId) || elementFocus?.overlayId === selectedId) && !container.isConnected) {
      selectedOverlay = null;
      if (selectionFrame) selectionFrame.hidden = true;
      startSelectionTracking();
      return;
    }

    if (activeDrag?.container === container) cancelDrag();
    if (activeResize?.container === container) cancelResize();
    if (activeRotate?.container === container) cancelRotate();
    if (activeEdit?.container === container) void commitEdit();
    clearSelection();
    publishScopedSelection();
  }

  function selectOverlay(container) {
    if (!isSelectable(container)) return false;

    if (selectedOverlay !== container || selectedIds.length > 1) {
      const nextId = container.dataset.overlayId ?? null;
      if (elementFocus?.overlayId === nextId && selectedId === nextId
        && selectedIds.length === 1 && !groupSelection) {
        selectedOverlay?.removeAttribute('data-akari-interaction-selected');
        selectedOverlay = container;
        selectedOverlay.setAttribute('data-akari-interaction-selected', 'true');
        reconcileElementFocus();
      } else {
        clearSelection();
        selectedOverlay = container;
        selectedId = nextId;
        selectedIds = selectedId === null ? [] : [selectedId];
        selectedOverlay.setAttribute("data-akari-interaction-selected", "true");
      }
    }

    refreshSelectionFrame();
    startSelectionTracking();
    return true;
  }

  function canFocusElement(container) {
    if (window.akari.capabilities?.elementSelection !== true || !container || selectedIds.length > 1) return false;
    return window.akari.state?.summary?.overlays?.some(overlay => overlay.id === container.dataset.overlayId
      && overlay.elementSelection === true) === true;
  }
  function focusedElement() {
    if (!selectedElementFocus() || !selectedOverlay) return null;
    const root = fragmentRoot(selectedOverlay);
    return elementByAddress(root, elementFocus.ref);
  }
  function selectedElementFocus() {
    return elementFocus?.overlayId === selectedId
      && (!selectedOverlay || selectedOverlay.dataset.overlayId === selectedId) ? elementFocus : null;
  }
  function reconcileElementFocus() {
    if (!selectedElementFocus()) return;
    const root = fragmentRoot(selectedOverlay);
    if (!root) return;
    const ref = elementFocus.ref;
    const element = elementByAddress(root, ref);
    if (!element) { focusElement(null); return; }
    if (selectedOverlay?.isConnected && !selectableElement(root, element, stage?.getBoundingClientRect(), selectionOptions(root))) {
      requestAnimationFrame(() => {
        if (elementFocus?.ref === ref && selectedOverlay?.isConnected) {
          const currentRoot = fragmentRoot(selectedOverlay);
          const current = elementByAddress(currentRoot, ref);
          if (!current || !selectableElement(currentRoot, current, stage?.getBoundingClientRect(), selectionOptions(currentRoot))) focusElement(null);
        }
      });
    }
  }
  function focusElement(element, { notify = true } = {}) {
    const root = fragmentRoot(selectedOverlay);
    if (element && !selectableElement(root, element, stage?.getBoundingClientRect(), selectionOptions(root))) element = null;
    const ref = element && elementAddress(root, element);
    const next = ref ? { overlayId: selectedId, ref, tag: element.tagName.toLowerCase(),
      label: elementLabel(root, element) } : null;
    if (elementFocus?.ref === next?.ref && elementFocus?.overlayId === next?.overlayId) return;
    flushElementNudge();
    elementFocus = next;
    refreshSelectionFrame();
    publishScopedSelection(notify);
  }
  function focusElementAt(container, event) {
    if (event.isTrusted === false) return;
    if (!canFocusElement(container) || selectedOverlay !== container || collectiveSelection()) {
      if (elementFocus) focusElement(null);
      return;
    }
    const root = fragmentRoot(container);
    const hit = event.target instanceof Element && root?.contains(event.target) ? event.target
      : document.elementsFromPoint(event.clientX, event.clientY).find(element => root?.contains(element)) ?? null;
    focusElement(nearestSelectableElement(root, hit, stage?.getBoundingClientRect(), selectionOptions(root)));
  }
  function focusElementAtPoint(overlayId, clientX, clientY, attempt = 0) {
    if (window.akari.capabilities?.elementSelection !== true || !Number.isFinite(clientX)
      || !Number.isFinite(clientY) || typeof overlayId !== 'string') return false;
    if (selectedId !== overlayId || !containerById(overlayId)) {
      if (attempt < 2) requestAnimationFrame(() => focusElementAtPoint(overlayId, clientX, clientY, attempt + 1));
      return false;
    }
    if (selectedIds.length > 1 || collectiveSelection()) return false;
    const container = containerById(overlayId);
    if (!canFocusElement(container)) return false;
    if (selectedOverlay !== container) selectOverlay(container);
    const root = fragmentRoot(container);
    if (!root) {
      if (attempt < 2) requestAnimationFrame(() => focusElementAtPoint(overlayId, clientX, clientY, attempt + 1));
      return false;
    }
    const hit = document.elementsFromPoint(clientX, clientY).find(element => root.contains(element)) ?? null;
    focusElement(nearestSelectableElement(root, hit, stage?.getBoundingClientRect(), selectionOptions(root)));
    return true;
  }

  function selectionTree() {
    const tree = window.akari.state?.summary?.tree;
    return Array.isArray(tree) ? tree : [];
  }

  function treeNode(id) { return selectionTree().find(node => node.id === id); }
  function containerById(id) {
    return Array.from(stage?.children ?? []).find(element => element.dataset?.overlayId === id) ?? null;
  }
  function visibleMembers(id = selectedId) {
    const ids = new Set(descendantLeafIds(selectionTree(), id).map(leafId => {
      const parent = treeNode(treeNode(leafId)?.parentId);
      return parent?.lazy && containerById(parent.id) ? parent.id : leafId;
    }));
    if (containerById(id)) ids.add(id);
    return [...ids].map(containerById).filter(container => {
      if (!isSelectable(container)) return false;
      const style = getComputedStyle(container);
      return style.display !== 'none' && Number(style.opacity) !== 0;
    });
  }
  function unionBounds(containers) {
    const boxes = containers.map(fragmentBounds).filter(rect => rect?.width > 0 && rect?.height > 0);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map(rect => rect.left)), top = Math.min(...boxes.map(rect => rect.top));
    const right = Math.max(...boxes.map(rect => rect.right)), bottom = Math.max(...boxes.map(rect => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function refreshGroupFrame() {
    markSelectionMembers();
    const rect = activeRotate?.group && activeRotate.overlayId === selectedId
      ? activeRotate.startRect : unionBounds(selectionMembers());
    if (!rect) { if (selectionFrame) selectionFrame.hidden = true; return; }
    if (!selectionFrame?.isConnected) {
      selectionFrame = createSelectionFrame();
      document.body.appendChild(selectionFrame);
    }
    if (selectionKind() === 'multi') {
      for (const element of selectionFrame.querySelectorAll('.akari-interaction-handle, .akari-interaction-rotate-stem')) element.remove();
    } else if (!selectionFrame.querySelector('.akari-interaction-handle')) {
      const replacement = createSelectionFrame();
      selectionFrame.replaceWith(replacement);
      selectionFrame = replacement;
    }
    selectionFrame.dataset.akariSelectionKind = selectionKind();
    selectionFrame.classList.remove('is-line');
    selectionFrame.classList.toggle('is-locked', selectionMembers().some(member => !isMovable(member)));
    selectionFrame.classList.toggle('is-busy', Boolean(activeDrag || activeResize || activeRotate));
    selectionFrame.classList.toggle('is-moving', Boolean(activeDrag || activeRotate));
    selectionFrame.style.transformOrigin = 'center';
    selectionFrame.style.transform = activeRotate?.group && activeRotate.overlayId === selectedId
      ? `rotate(${activeRotate.angle}deg)` : '';
    selectionFrame.hidden = false;
    Object.assign(selectionFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
  }
  let breadcrumbResizeObserver = null;
  let breadcrumbHoverActive = false;
  let breadcrumbHoverSuppressedAt = null;
  function clearBreadcrumbHover() {
    if (!breadcrumbHoverActive) return;
    hideHover();
  }
  function breadcrumbBounds(target) {
    if (target.kind === 'stage') return { rect: stage?.getBoundingClientRect() };
    if (target.kind === 'node') {
      const node = treeNode(target.id);
      const leaf = containerById(target.id);
      const lineRect = leaf && lineFrameGeometry(leaf);
      const rect = node?.kind !== 'leaf' ? unionBounds(visibleMembers(target.id))
        : lineRect ?? (leaf ? fragmentBounds(leaf) : null);
      return { rect, angle: lineRect?.angle ?? null };
    }
    if (target.kind === 'item') {
      const container = containerById(target.id);
      return { rect: container ? fragmentBounds(container) : null };
    }
    const element = target.element?.isConnected ? target.element
      : elementByAddress(fragmentRoot(containerById(target.overlayId)), target.ref);
    if (!element?.isConnected) return null;
    const geometry = focusedSelectionGeometry(element);
    const width = geometry.width * Math.hypot(geometry.axes.x.x, geometry.axes.x.y);
    const height = geometry.height * Math.hypot(geometry.axes.y.x, geometry.axes.y.y);
    return { rect: { left: geometry.center.x - width / 2, top: geometry.center.y - height / 2,
      width, height }, angle: Math.atan2(geometry.axes.x.y, geometry.axes.x.x) * 180 / Math.PI };
  }
  function renderScopeBreadcrumb() {
    const nav = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
    if (!nav) return;
    if (!breadcrumbResizeObserver && typeof ResizeObserver !== 'undefined' && nav.parentElement) {
      breadcrumbResizeObserver = new ResizeObserver(() => renderScopeBreadcrumb());
      breadcrumbResizeObserver.observe(nav.parentElement);
    }
    clearBreadcrumbHover();
    const entries = [];
    const append = (label, action, target) => entries.push({ label, action, target });
    if (selectedElementFocus() && selectedOverlay) {
      append('全体', () => { clearSelection(); publishScopedSelection(); }, { kind: 'stage' });
      for (const id of lineage(selectionTree(), scopeId)) {
        append(treeNode(id)?.label ?? id, () => applyScopedSelection({ selectId: id, scopeId: treeNode(id)?.parentId ?? null }),
          { kind: 'node', id });
      }
      const name = window.akari.state?.summary?.overlays?.find(overlay => overlay.id === selectedId)?.name ?? selectedId;
      append(name, () => focusElement(null), { kind: 'item', id: selectedId });
      const root = fragmentRoot(selectedOverlay);
      const path = [];
      for (let node = focusedElement(); node && node !== root; node = node.parentElement) {
        if (selectableElement(root, node, stage?.getBoundingClientRect(), selectionOptions(root))) path.unshift(node);
      }
      for (const node of path) append(elementLabel(root, node), () => focusElement(node),
        { kind: 'element', element: node, overlayId: selectedId, ref: elementAddress(root, node) });
    } else if (scopeId !== floorScopeId && selectionTree().length) {
      const path = lineage(selectionTree(), scopeId);
      const ids = floorScopeId === null ? [null, ...path] : path.slice(path.indexOf(floorScopeId));
      ids.forEach(id => append(id === null ? '全体' : treeNode(id)?.label ?? id, () => {
        const hit = descendantLeafIds(selectionTree(), selectedId)[0] ?? selectedId;
        const next = resolveScopedSelection(selectionTree(), id, hit);
        applyScopedSelection({ scopeId: id, selectId: next.scopeId === id ? next.selectId : null });
      }, id === null ? { kind: 'stage' } : { kind: 'node', id }));
    }
    nav.replaceChildren();
    nav.hidden = entries.length === 0;
    if (nav.hidden) return;
    const separator = () => {
      const span = document.createElement('span');
      span.className = 'akari-breadcrumb-separator'; span.textContent = ' › ';
      return span;
    };
    const button = entry => {
      const node = document.createElement('button');
      node.type = 'button'; node.textContent = entry.label;
      const show = () => {
        let geometry;
        try { geometry = breadcrumbBounds(entry.target); } catch { return; }
        if (!geometry?.rect || geometry.rect.width <= 0 || geometry.rect.height <= 0) return;
        breadcrumbHoverActive = true;
        showHoverFrame(geometry.rect, geometry.angle ?? null, entry.target.id ?? '', true);
      };
      node.addEventListener('pointerenter', () => {
        if (!breadcrumbHoverSuppressedAt) show();
      });
      node.addEventListener('pointermove', event => {
        const point = breadcrumbHoverSuppressedAt;
        if (!point || Math.hypot(event.clientX - point.x, event.clientY - point.y) < 1) return;
        breadcrumbHoverSuppressedAt = null;
        show();
      });
      node.addEventListener('focus', show);
      node.addEventListener('pointerleave', () => {
        if (node.isConnected) breadcrumbHoverSuppressedAt = null;
        clearBreadcrumbHover();
      });
      node.addEventListener('blur', clearBreadcrumbHover);
      node.addEventListener('click', event => {
        breadcrumbHoverSuppressedAt = { x: event.clientX, y: event.clientY };
        clearBreadcrumbHover(); entry.action();
      });
      return node;
    };
    const add = (entry, index) => {
      if (index) nav.appendChild(separator());
      nav.appendChild(button(entry));
    };
    entries.forEach(add);
    const buttons = [...nav.querySelectorAll('button')];
    const widths = buttons.map(node => node.getBoundingClientRect().width);
    const separatorWidth = nav.querySelector('.akari-breadcrumb-separator')?.getBoundingClientRect().width ?? 0;
    const available = Math.max(0, nav.parentElement.getBoundingClientRect().width - 16);
    if (widths.reduce((sum, width) => sum + width, 0) + separatorWidth * (entries.length - 1) <= available) return;
    if (entries.length < 4) {
      const each = Math.max(3 * 10, (available - separatorWidth * (entries.length - 1) - widths[0]) / Math.max(1, entries.length - 1));
      buttons.slice(1).forEach(node => { node.style.maxWidth = `${each}px`; });
      return;
    }
    const ellipsis = document.createElement('span');
    ellipsis.textContent = '…'; ellipsis.setAttribute('aria-hidden', 'true');
    nav.appendChild(ellipsis);
    const ellipsisWidth = ellipsis.getBoundingClientRect().width;
    ellipsis.remove();
    let start = entries.length - 2;
    let used = widths[0] + widths[start] + widths[start + 1] + ellipsisWidth + 3 * separatorWidth;
    while (start > 2 && used + widths[start - 1] + separatorWidth <= available) {
      start--; used += widths[start] + separatorWidth;
    }
    nav.replaceChildren();
    add(entries[0], 0);
    nav.appendChild(separator()); nav.appendChild(ellipsis);
    for (let index = start; index < entries.length; index++) add(entries[index], index);
    if (used > available) {
      const tails = [...nav.querySelectorAll('button')].slice(1);
      const tailWidth = Math.max(30, (available - widths[0] - ellipsisWidth - 3 * separatorWidth) / tails.length);
      tails.forEach(node => { node.style.maxWidth = `${tailWidth}px`; });
    }
  }
  function publishScopedSelection(notify = true) {
    syncLazyBag();
    renderScopeBreadcrumb();
    window.dispatchEvent(new CustomEvent('akari-preview-scope-selection', { detail: { notify } }));
  }
  let requestedBagId = null;
  function syncLazyBag() {
    const bagId = lazyBagForScope(selectionTree(), scopeId);
    if (bagId === requestedBagId || !window.akari.requestBagExpansion) return;
    requestedBagId = bagId;
    window.akari.requestBagExpansion(bagId);
  }
  function scopedHitId(container, event) {
    const id = container?.dataset.overlayId;
    if (!treeNode(id)?.lazy) return id;
    // The unexpanded bag still has the original named DOM. Resolve the hit
    // there before asking the host to replace it with masked part mounts.
    const candidates = [event.target, ...document.elementsFromPoint(event.clientX, event.clientY)];
    const part = candidates.map(element => element instanceof Element
      ? element.closest('[data-akari-part]') : null).find(element => element && container.contains(element));
    const partId = part?.getAttribute('data-akari-part') ?? null;
    const childId = partId === null ? null : id + '#' + partId;
    return treeNode(childId) ? childId : id;
  }
  function applyScopedSelection(next, { notify = true } = {}) {
    const previousId = selectedId;
    const previousIds = [...selectedIds];
    const previousScopeId = scopeId;
    const wasMultiple = selectedIds.length > 1;
    const tree = selectionTree();
    if (floorScopeId !== null && next.selectId !== null
      && !lineage(tree, next.selectId).includes(floorScopeId)) return false;
    if (floorScopeId !== null && next.scopeId !== floorScopeId
      && !lineage(tree, next.scopeId).includes(floorScopeId)) next = { ...next, scopeId: floorScopeId };
    const node = treeNode(next.selectId);
    scopeId = next.scopeId;
    if (node && node.kind !== 'leaf') {
      clearSelection();
      selectedId = node.id;
      selectedIds = [node.id];
      groupSelection = true;
      refreshSelectionFrame();
      startSelectionTracking();
    } else if (next.selectId === null) clearSelection();
    else if (!selectOverlay(containerById(next.selectId))) {
      if (!node?.lazy || lazyBagForScope(tree, scopeId) !== node.parentId) {
        scopeId = previousScopeId;
        return false;
      }
      clearSelection();
      selectedId = node.id;
      selectedIds = [node.id];
      startSelectionTracking(); // Rebind to the leaf after the host response mounts it.
    }
    const unchangedMultiRepresentative = (wasMultiple || selectedIds.length > 1) && previousId === selectedId;
    const changedSetOrScope = previousScopeId !== scopeId || previousIds.length !== selectedIds.length
      || previousIds.some((id, index) => id !== selectedIds[index]);
    publishScopedSelection(notify && (!unchangedMultiRepresentative || changedSetOrScope));
    return true;
  }
  function selectScopedHit(container, event) {
    const id = scopedHitId(container, event);
    if (!id) return false;
    const next = resolveScopedSelection(selectionTree(), scopeId, id,
      { deep: Boolean(event.metaKey || event.ctrlKey) });
    if (!event.shiftKey) return applyScopedSelection(next);
    if (floorScopeId !== null && !lineage(selectionTree(), next.selectId).includes(floorScopeId)) return false;
    const selection = toggleScopedSelection(selectionTree(), selectedIds, scopeId, next);
    if (selection.selectedIds.length < 2) return applyScopedSelection(selection);
    return setScopedMultiSelection(selection.selectedIds, selection.scopeId);
  }
  function setScopedMultiSelection(ids, nextScopeId) {
    if (ids.length < 2) return false;
    const unchanged = scopeId === nextScopeId && ids.length === selectedIds.length
      && ids.every((id, index) => id === selectedIds[index]);
    if (unchanged) return true;
    clearSelection();
    scopeId = nextScopeId;
    selectedIds = [...ids];
    selectedId = ids.at(-1);
    refreshSelectionFrame();
    startSelectionTracking();
    publishScopedSelection();
    return true;
  }

  function marqueeCandidates() {
    return selectionTree().filter(node => node.parentId === scopeId
      && (floorScopeId === null || lineage(selectionTree(), node.id).includes(floorScopeId)))
      .map(node => {
        const leaf = containerById(node.id);
        return { id: node.id, bounds: node.kind === 'leaf'
          ? leaf ? fragmentBounds(leaf) : null : unionBounds(visibleMembers(node.id)) };
      })
      .filter(candidate => candidate.bounds);
  }
  function marqueeRect(start, end) {
    const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x), bottom = Math.max(start.y, end.y);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function clearMarquee() {
    pendingBlank = null;
    marqueeFrame?.remove();
    marqueeFrame = null;
    for (const element of stage?.children ?? []) element.removeAttribute('data-akari-interaction-marquee-hit');
  }
  function updateMarquee(event) {
    const pending = pendingBlank;
    if (!pending) return;
    if (!marqueeFrame) {
      marqueeFrame = document.createElement('div');
      marqueeFrame.setAttribute('data-akari-ui', 'preview-marquee');
      marqueeFrame.setAttribute('aria-hidden', 'true');
      Object.assign(marqueeFrame.style, { position: 'fixed', pointerEvents: 'none',
        boxSizing: 'border-box', border: '1px solid var(--akari-accent, #4da3ff)',
        background: 'rgba(77, 163, 255, 0.14)', zIndex: '91' });
      document.body.appendChild(marqueeFrame);
    }
    const rect = marqueeRect(pending, { x: event.clientX, y: event.clientY });
    Object.assign(marqueeFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
    const ids = marqueeHits(marqueeCandidates(), rect);
    pending.hits = ids;
    const members = new Set(ids.flatMap(id => visibleMembers(id)));
    for (const element of stage?.children ?? []) {
      if (members.has(element)) element.setAttribute('data-akari-interaction-marquee-hit', 'true');
      else element.removeAttribute('data-akari-interaction-marquee-hit');
    }
  }
  function finishMarquee(event) {
    const pending = pendingBlank;
    if (!pending) return;
    if (!pending.started) {
      clearMarquee();
      if (!pending.release) return;
      if (activeEdit) void commitEdit();
      applyScopedSelection({ selectId: null,
        scopeId: pending.bagExit !== undefined ? pending.bagExit : pending.scopeId });
      return;
    }
    updateMarquee(event);
    const hits = pending.hits ?? [];
    const sibling = id => treeNode(id)?.parentId === pending.scopeId;
    const additive = pending.shift && selectedIds.every(sibling) && scopeId === pending.scopeId;
    const ids = additive ? [...selectedIds, ...hits.filter(id => !selectedIds.includes(id))] : hits;
    clearMarquee();
    if (!ids.length) {
      if (!pending.shift) applyScopedSelection({ selectId: null, scopeId: pending.scopeId });
    } else if (ids.length === 1) applyScopedSelection({ selectId: ids[0], scopeId: pending.scopeId });
    else setScopedMultiSelection(ids, pending.scopeId);
  }
  function selectFromTimeline(id) {
    if (!selectionTree().length) return false;
    if (id === selectedId) return true; // Selection echo must not reset drill-in.
    if (id === null) return applyScopedSelection({ selectId: null, scopeId }, { notify: false });
    const node = treeNode(id);
    if (!node) return false;
    return applyScopedSelection({ selectId: id, scopeId: node.parentId }, { notify: false });
  }
  function setSelectionFloor(id) {
    if (!selectionTree().length) { floorScopeId = null; scopeId = null; return; }
    if (id !== null && typeof id !== 'string') return;
    if (activeDrag) cancelDrag();
    if (activeResize) cancelResize();
    if (activeRotate) cancelRotate();
    if (activeEdit) void commitEdit();
    floorScopeId = id;
    scopeId = id;
    clearSelection();
    publishScopedSelection(false);
  }
  function beginGroupDrag(event, container) {
    const members = selectionMembers().map(element => ({ element, transform: readTransform(element) }));
    if (!members.length || (selectedIds.length > 1 && members.some(member => !isMovable(member.element)))) return;
    const world = treeNode(selectedId)?.transform ?? {};
    activeDrag = { group: true, targets: movementTargets(), container, members, overlayId: selectedId, pointerId: event.pointerId,
      startClientX: event.clientX, startClientY: event.clientY,
      startStagePoint: stageLocalPoint(event.clientX, event.clientY),
      startX: world.x ?? 0, startY: world.y ?? 0, dx: 0, dy: 0,
      snapX: null, snapY: null, snapMotion: beginSnapMotion(fragmentVideoBounds(container)), moved: false, duplicate: event.altKey,
      writeContext: captureWriteContext() };
    try { container.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
  }
  function moveGroupMembers(drag, dx, dy) {
    drag.dx = dx; drag.dy = dy;
    for (const { element, transform } of drag.members) {
      element.style.setProperty('--x', `${transform.x + dx}px`);
      element.style.setProperty('--y', `${transform.y + dy}px`);
    }
    refreshGroupFrame();
  }

  // Keep this classic-script copy identical to world-delta.mjs.
  // BEGIN world-delta
  function worldDelta(oldPose, newPose) {
    const scale = (newPose.scale ?? 1) / (oldPose.scale ?? 1);
    const rotate = (newPose.rotate ?? 0) - (oldPose.rotate ?? 0);
    const radians = rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const oldX = oldPose.x ?? 0, oldY = oldPose.y ?? 0;
    return { scale, rotate,
      x: (newPose.x ?? 0) - scale * (cosine * oldX - sine * oldY),
      y: (newPose.y ?? 0) - scale * (sine * oldX + cosine * oldY) };
  }

  function applyWorldDelta(delta, childWorld) {
    const radians = delta.rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const x = childWorld.x ?? 0, y = childWorld.y ?? 0;
    return { ...childWorld,
      x: delta.x + delta.scale * (cosine * x - sine * y),
      y: delta.y + delta.scale * (sine * x + cosine * y),
      scale: (childWorld.scale ?? 1) * delta.scale,
      ...(childWorld.scaleX === undefined ? {} : { scaleX: childWorld.scaleX * delta.scale }),
      ...(childWorld.scaleY === undefined ? {} : { scaleY: childWorld.scaleY * delta.scale }),
      rotate: (childWorld.rotate ?? 0) + delta.rotate };
  }
  // END world-delta

  function syncLeafTransformOnSuccess(record, overlayId, transform) {
    record.promise.then(() => {
      const node = treeNode(overlayId);
      if (node?.kind === 'leaf') node.transform = { ...transform };
    }, () => undefined);
  }

  function syncGroupDescendants(overlayId, oldPose, newPose, members) {
    const delta = worldDelta(oldPose, newPose);
    const memberWorlds = new Map(members.map(member => [member.element.dataset.overlayId, member.transform]));
    const tree = selectionTree();
    for (const node of tree) {
      if (node.id === overlayId || !lineage(tree, node.id).includes(overlayId)) continue;
      const world = node.transform ?? memberWorlds.get(node.id);
      if (world) node.transform = applyWorldDelta(delta, world);
    }
  }

  function setWorldTransform(element, transform) {
    element.style.setProperty('--x', `${transform.x}px`);
    element.style.setProperty('--y', `${transform.y}px`);
    element.style.setProperty('--scale', String(transform.scale));
    element.style.setProperty('--rotate', `${transform.rotate}deg`);
    if (transform.scaleX !== undefined) element.style.setProperty('--scale-x', String(transform.scaleX));
    if (transform.scaleY !== undefined) element.style.setProperty('--scale-y', String(transform.scaleY));
  }

  function groupPoseAt(gesture, nextPose) {
    gesture.pose = nextPose;
    const delta = worldDelta(gesture.oldPose, nextPose);
    for (const member of gesture.members) {
      setWorldTransform(member.element, applyWorldDelta(delta, member.transform));
    }
    if (!activeRotate?.group) refreshGroupFrame();
  }

  function restoreGroupPose(gesture) {
    for (const member of gesture.members) setWorldTransform(member.element, member.transform);
    selectionFrame.style.transform = '';
    refreshGroupFrame();
  }

  function finishGroupTransform(gesture) {
    const node = treeNode(gesture.overlayId);
    const previous = node?.transform;
    const transform = { x: gesture.pose.x, y: gesture.pose.y,
      scale: gesture.pose.scale, rotate: gesture.pose.rotate };
    const applied = { ...previous, ...transform };
    if (node) node.transform = applied;
    const record = enqueueWrite(gesture.writeContext, gesture.overlayId, { transform }, 'transform');
    record.promise.then(() => syncGroupDescendants(gesture.overlayId, previous ?? {}, applied, gesture.members),
      () => undefined);
    record.promise.catch(error => {
      if (node?.transform === applied) node.transform = previous;
      restoreGroupPose(gesture);
      reportWriteError('transform', gesture.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
  }
  function moveGroupDrag(drag, dx, dy, disabled, lockedAxis = null) {
    moveGroupMembers(drag, dx, dy);
    const rect = unionBounds(drag.members.map(member => member.element).filter(isSelectable));
    const tl = rect && stageLocalPoint(rect.left, rect.top), br = rect && stageLocalPoint(rect.right, rect.bottom);
    if (disabled || !tl || !br) { drag.snapX = null; drag.snapY = null; hideSnapGuides(); return; }
    const bounds = { left: tl.x, top: tl.y, right: br.x, bottom: br.y,
      centerX: (tl.x + br.x) / 2, centerY: (tl.y + br.y) / 2 };
    const snap = computeSnapCorrection(bounds, { x: drag.snapX, y: drag.snapY, motion: drag.snapMotion },
      { kind: 'group', ids: drag.members.map(member => member.element.dataset.overlayId) });
    drag.snapMotion = snap.motion;
    if (lockedAxis === 'x') snap.y = null;
    if (lockedAxis === 'y') snap.x = null;
    drag.snapX = snap.x; drag.snapY = snap.y;
    moveGroupMembers(drag, dx + (snap.x?.correction ?? 0), dy + (snap.y?.correction ?? 0));
    showSnapGuides(snap.x, snap.y);
  }
  function movementTargets() {
    return selectedIds.map(id => {
      const node = treeNode(id);
      const container = containerById(id);
      const transform = node?.kind === 'leaf' && container ? readTransform(container) : node?.transform ?? {};
      return { id, node, previousTransform: node?.transform, x: transform.x ?? 0, y: transform.y ?? 0 };
    });
  }
  function finishGroupDrag(drag) {
    if (!drag.moved || (Math.abs(drag.dx) < .5 && Math.abs(drag.dy) < .5)) {
      moveGroupMembers(drag, 0, 0); return null;
    }
    const targets = drag.targets ?? [{ id: drag.overlayId, node: treeNode(drag.overlayId),
      previousTransform: treeNode(drag.overlayId)?.transform, x: drag.startX, y: drag.startY }];
    if (drag.duplicate && targets.length === 1) {
      const target = targets[0];
      const transform = { x: target.x + drag.dx, y: target.y + drag.dy };
      moveGroupMembers(drag, 0, 0);
      const record = enqueueWrite(drag.writeContext, target.id,
        { transform, duplicate: true }, 'transform');
      lastTransformWrite = record;
      return record;
    }
    const writes = targets.map(target => {
      const transform = { x: target.x + drag.dx, y: target.y + drag.dy };
      target.appliedTransform = target.node?.kind === 'leaf' && containerById(target.id)
        ? readTransform(containerById(target.id)) : { ...target.previousTransform, ...transform };
      if (target.node) target.node.transform = target.appliedTransform;
      return { overlayId: target.id, patch: { transform } };
    });
    const record = writes.length > 1 ? enqueueWriteBatch(drag.writeContext, writes)
      : enqueueWrite(drag.writeContext, writes[0].overlayId, writes[0].patch, 'transform');
    record.promise.then(() => {
      for (const target of targets) {
        if (target.node?.kind === 'group') {
          syncGroupDescendants(target.id, target.previousTransform ?? {}, target.appliedTransform, drag.members);
        }
      }
    }, () => undefined);
    record.promise.catch(error => {
      for (const target of targets) {
        if (target.node?.transform === target.appliedTransform) target.node.transform = target.previousTransform;
      }
      moveGroupMembers(drag, 0, 0);
      reportWriteError('transform', drag.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
  }

  function parseElementTranslate(value) {
    const parts = String(value ?? '').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?px/giu) ?? [];
    return { x: Number.parseFloat(parts[0]) || 0, y: Number.parseFloat(parts[1]) || 0 };
  }
  const elementDecimal = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });
  function formatElementNumber(value) {
    return elementDecimal.format(Math.round((value + Number.EPSILON) * 100) / 100 || 0);
  }
  function formatElementTranslate(x, y) {
    return `${formatElementNumber(x)}px ${formatElementNumber(y)}px`;
  }
  function elementScreenGeometry(element) {
    const rect = element.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const style = getComputedStyle(element);
    const size = { width: element.offsetWidth || Number.parseFloat(style.width) || rect.width,
      height: element.offsetHeight || Number.parseFloat(style.height) || rect.height };
    const stageRect = stage?.getBoundingClientRect();
    const ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const computed = getComputedStyle(node);
      ancestors.push([computed.translate, computed.rotate, computed.scale, computed.transform,
        computed.transformOrigin, node.getAttribute('style')]);
    }
    const signature = JSON.stringify([rect.left, rect.top, rect.width, rect.height,
      size.width, size.height, style.translate, style.rotate, style.scale, style.transform,
      style.transformOrigin, element.getAttribute('style'), selectedOverlay?.getAttribute('style'),
      stageRect && [stageRect.left, stageRect.top, stageRect.width, stageRect.height], ancestors]);
    if (elementGeometryCache?.element === element && elementGeometryCache.signature === signature) {
      return elementGeometryCache.geometry;
    }
    const original = element.style.translate;
    const base = parseElementTranslate(style.translate);
    element.style.translate = `${base.x + 1}px ${base.y}px`;
    const xRect = element.getBoundingClientRect();
    element.style.translate = `${base.x}px ${base.y + 1}px`;
    const yRect = element.getBoundingClientRect();
    element.style.translate = original;
    const axes = elementAxes(center,
      { x: xRect.left + xRect.width / 2, y: xRect.top + xRect.height / 2 },
      { x: yRect.left + yRect.width / 2, y: yRect.top + yRect.height / 2 });
    if (Math.hypot(axes.x.x, axes.x.y) < 0.01 || Math.hypot(axes.y.x, axes.y.y) < 0.01) {
      axes.x = { x: rect.width / size.width, y: 0 };
      axes.y = { x: 0, y: rect.height / size.height };
    }
    const scale = style.scale === 'none' ? [1, 1] : style.scale.split(/\s+/u).map(Number);
    const own = new DOMMatrix().rotate(Number.parseFloat(style.rotate) || 0)
      .scale(scale[0] || 1, scale[1] || scale[0] || 1)
      .multiply(new DOMMatrix(style.transform === 'none' ? undefined : style.transform));
    const baseX = axes.x, baseY = axes.y;
    axes.x = { x: baseX.x * own.a + baseY.x * own.b,
      y: baseX.y * own.a + baseY.y * own.b };
    axes.y = { x: baseX.x * own.c + baseY.x * own.d,
      y: baseX.y * own.c + baseY.y * own.d };
    const geometry = { center, axes, width: size.width, height: size.height };
    elementGeometryCache = { element, signature, geometry };
    return geometry;
  }
  function focusedSelectionGeometry(element) {
    const geometry = elementScreenGeometry(element);
    if (!isSelectionContainer(element)) return geometry;
    const container = selectedOverlay ?? element.parentElement;
    const bounds = contentBounds(element, container);
    if (!bounds) return geometry;
    const scaleX = Math.hypot(geometry.axes.x.x, geometry.axes.x.y);
    const scaleY = Math.hypot(geometry.axes.y.x, geometry.axes.y.y);
    if (!(scaleX > 0 && scaleY > 0)) return geometry;
    const ux = { x: geometry.axes.x.x / scaleX, y: geometry.axes.x.y / scaleX };
    const uy = { x: geometry.axes.y.x / scaleY, y: geometry.axes.y.y / scaleY };
    const angle = Math.abs(Math.atan2(ux.y, ux.x));
    if (angle < 0.001) return { ...geometry,
      center: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
      width: bounds.width / scaleX, height: bounds.height / scaleY };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of element.querySelectorAll('*')) {
      if (!drawsSelectionContent(node) || !isPaintedElement(node, container)) continue;
      const rect = visibleFragmentRect(node.getBoundingClientRect(), node, container);
      if (!rect) continue;
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const dx = center.x - geometry.center.x, dy = center.y - geometry.center.y;
      const x = dx * ux.x + dy * ux.y, y = dx * uy.x + dy * uy.y;
      const halfX = (node.offsetWidth || rect.width / scaleX) * scaleX / 2;
      const halfY = (node.offsetHeight || rect.height / scaleY) * scaleY / 2;
      minX = Math.min(minX, x - halfX); maxX = Math.max(maxX, x + halfX);
      minY = Math.min(minY, y - halfY); maxY = Math.max(maxY, y + halfY);
    }
    if (!Number.isFinite(minX)) return geometry;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    return { ...geometry, center: { x: geometry.center.x + midX * ux.x + midY * uy.x,
      y: geometry.center.y + midX * ux.y + midY * uy.y },
    width: (maxX - minX) / scaleX, height: (maxY - minY) / scaleY };
  }
  function focusedSelectionRect(element) {
    const geometry = focusedSelectionGeometry(element);
    const width = geometry.width * Math.hypot(geometry.axes.x.x, geometry.axes.x.y);
    const height = geometry.height * Math.hypot(geometry.axes.y.x, geometry.axes.y.y);
    return { left: geometry.center.x - width / 2, top: geometry.center.y - height / 2,
      right: geometry.center.x + width / 2, bottom: geometry.center.y + height / 2,
      width, height };
  }
  function moveElementPointTo(gesture, horizontal, vertical, target) {
    const geometry = elementScreenGeometry(gesture.element);
    const point = elementPoint(geometry, horizontal, vertical);
    if (Math.hypot(target.x - point.x, target.y - point.y) <= 0.2) return;
    moveElementToCenter(gesture, geometry.center.x + target.x - point.x,
      geometry.center.y + target.y - point.y);
  }
  const elementInlineProperties = ['width', 'height', 'rotate', 'translate', 'display',
    'box-sizing', 'min-width', 'min-height', 'max-width', 'max-height', 'flex'];
  function snapshotElementInline(element) {
    return Object.fromEntries(elementInlineProperties.map(name => [name,
      [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]]));
  }
  function restoreElementInline(element, snapshot) {
    for (const [name, [value, priority]] of Object.entries(snapshot)) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  }
  function elementWriteStyle(gesture, dimensionNames = []) {
    const style = {};
    for (const name of dimensionNames) {
      style[name] = `${formatElementNumber(Number.parseFloat(gesture.element.style.getPropertyValue(name)))}px`;
    }
    for (const name of elementInlineProperties) {
      if (name === 'translate' || dimensionNames.includes(name)) continue;
      const now = gesture.element.style.getPropertyValue(name);
      if (now && now !== gesture.originalInline[name][0]) {
        style[name] = name === 'rotate' ? `${formatElementNumber(Number.parseFloat(now))}deg` : now;
      }
    }
    const translate = formatElementTranslate(gesture.x, gesture.y);
    if (translate !== formatElementTranslate(gesture.startX, gesture.startY)) style.translate = translate;
    return style;
  }
  function beginElementGesture(event, handleEl) {
    const element = focusedElement();
    if (!element || !elementFocus) return null;
    hideSnapGuides();
    const before = elementScreenGeometry(element);
    const originalInline = snapshotElementInline(element);
    const computed = getComputedStyle(element);
    const startStyle = Object.fromEntries(['boxSizing', 'display', 'flex', 'minWidth', 'minHeight',
      'maxWidth', 'maxHeight'].map(name => [name, computed[name]]));
    const source = window.akari.state?.summary?.overlays?.find(overlay => overlay.id === selectedId);
    const declared = source?.elements?.[elementFocus.ref]?.style ?? {};
    const translate = parseElementTranslate(declared.translate ?? computed.translate);
    const gesture = { element, elementRef: elementFocus.ref, elementTag: elementFocus.tag,
      container: selectedOverlay, overlayId: selectedId, handleEl, pointerId: event.pointerId,
      originalInline, startStyle, parentStyle: element.parentElement
        ? { display: getComputedStyle(element.parentElement).display } : null,
      startGeometry: before, startClientX: event.clientX, startClientY: event.clientY,
      startWidth: Number.parseFloat(declared.width) || before.width,
      startHeight: Number.parseFloat(declared.height) || before.height,
      x: translate.x, y: translate.y, startX: translate.x, startY: translate.y,
      moved: false, writeContext: captureWriteContext() };
    if (startStyle.display === 'inline') {
      element.style.display = 'inline-block';
      const next = element.getBoundingClientRect();
      if (Math.hypot(next.left + next.width / 2 - before.center.x,
        next.top + next.height / 2 - before.center.y) > 0.2) {
        moveElementToCenter(gesture, before.center.x, before.center.y);
      }
    }
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
    return gesture;
  }
  function showElementHandleHint(event, label) {
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = label;
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);
  }
  function beginElementResize(event, handleEl) {
    if (activeEdit) void commitEdit();
    const gesture = beginElementGesture(event, handleEl);
    if (!gesture) return;
    const name = [...handleEl.classList].find(token => /^is-(?:n|e|s|w|nw|ne|se|sw)$/.test(token))?.slice(3);
    if (!name) { restoreElementInline(gesture.element, gesture.originalInline); return; }
    gesture.name = name;
    gesture.anchor = elementHandlePoints(gesture.startGeometry, name).anchor;
    activeResize = gesture;
    showElementHandleHint(event, name.length === 2 ? '大きさ' : ['n', 's'].includes(name) ? '高さ' : '幅');
    refreshSelectionFrame();
  }
  function updateElementResize(event) {
    const resize = activeResize;
    const delta = elementLocalDelta({ x: event.clientX - resize.startClientX,
      y: event.clientY - resize.startClientY }, resize.startGeometry.axes);
    const size = elementBoxSize(resize.startWidth, resize.startHeight, resize.name, delta, event.shiftKey);
    const dimensionNames = resize.name.length === 2 ? ['width', 'height']
      : ['n', 's'].includes(resize.name) ? ['height'] : ['width'];
    const companions = elementBoxCompanions(resize.startStyle, resize.parentStyle,
      dimensionNames.includes('width') ? size.width : null,
      dimensionNames.includes('height') ? size.height : null);
    for (const name of elementInlineProperties) {
      if (['translate', 'rotate', 'width', 'height'].includes(name)) continue;
      const [original, priority] = resize.originalInline[name];
      if (companions[name]) resize.element.style.setProperty(name, companions[name]);
      else if (original) resize.element.style.setProperty(name, original, priority);
      else resize.element.style.removeProperty(name);
    }
    if (dimensionNames.includes('width')) resize.element.style.width = `${size.width}px`;
    if (dimensionNames.includes('height')) resize.element.style.height = `${size.height}px`;
    const signs = elementHandlePoints(resize.startGeometry, resize.name).signs;
    moveElementPointTo(resize, -signs[0], -signs[1], resize.anchor);
    resize.moved = Math.abs(size.width - resize.startWidth) > 0.01
      || Math.abs(size.height - resize.startHeight) > 0.01;
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    refreshSelectionFrame();
    if (event.cancelable) event.preventDefault();
  }
  function finishElementGesture(gesture, dimensions = []) {
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(gesture);
    if (!gesture.moved) {
      restoreElementInline(gesture.element, gesture.originalInline);
      refreshSelectionFrame();
      return null;
    }
    const style = elementWriteStyle(gesture, dimensions);
    const record = enqueueWrite(gesture.writeContext, gesture.overlayId,
      { element: { ref: gesture.elementRef, tag: gesture.elementTag, style } }, 'element');
    record.promise.catch(() => {
      restoreElementInline(gesture.element, gesture.originalInline);
      refreshSelectionFrame();
    });
    refreshSelectionFrame();
    return record;
  }
  function cancelElementGesture(gesture) {
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(gesture);
    restoreElementInline(gesture.element, gesture.originalInline);
    refreshSelectionFrame();
  }
  function beginElementRotate(event, handleEl) {
    if (activeEdit) void commitEdit();
    const gesture = beginElementGesture(event, handleEl);
    if (!gesture) return;
    const geometry = elementScreenGeometry(gesture.element);
    const source = window.akari.state?.summary?.overlays?.find(overlay => overlay.id === selectedId);
    const declared = source?.elements?.[elementFocus.ref]?.style?.rotate;
    gesture.startRotate = Number.parseFloat(declared ?? getComputedStyle(gesture.element).rotate) || 0;
    gesture.center = geometry.center;
    gesture.startAngle = Math.atan2(event.clientY - geometry.center.y, event.clientX - geometry.center.x);
    activeRotate = gesture;
    showElementHandleHint(event, '回転');
  }
  function updateElementRotate(event) {
    const rotation = activeRotate;
    const currentAngle = Math.atan2(event.clientY - rotation.center.y, event.clientX - rotation.center.x);
    const degrees = rotation.startRotate + (currentAngle - rotation.startAngle) * 180 / Math.PI;
    const angle = elementAngle(degrees, event.shiftKey);
    rotation.element.style.rotate = `${angle}deg`;
    const rect = rotation.element.getBoundingClientRect();
    if (Math.hypot(rect.left + rect.width / 2 - rotation.center.x,
      rect.top + rect.height / 2 - rotation.center.y) > 0.2) {
      moveElementToCenter(rotation, rotation.center.x, rotation.center.y);
    }
    rotation.moved = Math.abs(angle - rotation.startRotate) > 0.01;
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    refreshSelectionFrame();
    if (event.cancelable) event.preventDefault();
  }
  function moveElementToCenter(gesture, targetX, targetY) {
    const element = gesture.element;
    const center = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const write = (x, y) => { element.style.translate = `${x}px ${y}px`; };
    for (let attempt = 0; attempt < 4; attempt++) {
      write(gesture.x, gesture.y);
      const current = center();
      const rx = targetX - current.x, ry = targetY - current.y;
      if (Math.hypot(rx, ry) <= 0.2) break;
      write(gesture.x + 1, gesture.y);
      const xProbe = center();
      write(gesture.x, gesture.y + 1);
      const yProbe = center();
      const ax = xProbe.x - current.x, ay = xProbe.y - current.y;
      const bx = yProbe.x - current.x, by = yProbe.y - current.y;
      const determinant = ax * by - ay * bx;
      if (Math.abs(determinant) < 0.000001) break;
      gesture.x += (rx * by - ry * bx) / determinant;
      gesture.y += (ry * ax - rx * ay) / determinant;
    }
    write(gesture.x, gesture.y);
  }
  function flushElementNudge() {
    clearTimeout(elementNudgeTimer);
    elementNudgeTimer = null;
    const gesture = elementNudge;
    elementNudge = null;
    if (!gesture) return;
    const translate = formatElementTranslate(gesture.x, gesture.y);
    if (Math.abs(gesture.x - gesture.startX) < 0.5 && Math.abs(gesture.y - gesture.startY) < 0.5
      || translate === formatElementTranslate(gesture.startX, gesture.startY)) {
      gesture.element.style.translate = gesture.originalInline;
      if (gesture.originalDisplay !== undefined) gesture.element.style.display = gesture.originalDisplay;
      refreshSelectionFrame();
      return;
    }
    const style = { translate };
    if (gesture.originalDisplay !== undefined) style.display = 'inline-block';
    enqueueWrite(gesture.writeContext, gesture.overlayId,
      { element: { ref: gesture.ref, tag: gesture.tag,
        style } }, 'element').promise.catch(() => {
      gesture.element.style.translate = gesture.originalInline;
      if (gesture.originalDisplay !== undefined) gesture.element.style.display = gesture.originalDisplay;
      refreshSelectionFrame();
    });
  }
  function flushNudge() {
    flushElementNudge();
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    const session = nudge;
    nudge = null;
    if (!session || (!session.dx && !session.dy)) return;
    if (session.group) { finishGroupDrag(session); return; }
    const transform = { ...session.transform,
      x: session.startX + session.dx, y: session.startY + session.dy };
    const record = enqueueWrite(session.writeContext, session.overlayId, { transform }, 'transform');
    syncLeafTransformOnSuccess(record, session.overlayId, transform);
    lastTransformWrite = record;
    record.promise.catch(() => {
      const current = readTransform(session.container);
      if (current.x !== transform.x || current.y !== transform.y) return;
      session.container.style.setProperty('--x', `${session.startX}px`);
      session.container.style.setProperty('--y', `${session.startY}px`);
      refreshSelectionFrame();
    });
  }

  function isControl(target) {
    return target instanceof Element
      && (target.isContentEditable || target.closest('input, textarea, select, button, [role="textbox"]'));
  }

  function handleNudge(event) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || !interactionEnabled || !selectedId || activeEdit || activeDrag || activeResize
      || event.metaKey || event.ctrlKey || event.altKey || !document.hasFocus()) return false;
    if (isControl(event.target) || isControl(document.activeElement)) return false;
    if (elementFocus && focusedElement()) {
      if (!elementNudge) {
        const element = focusedElement();
        const source = window.akari.state?.summary?.overlays?.find(overlay => overlay.id === selectedId);
        const current = parseElementTranslate(source?.elements?.[elementFocus.ref]?.style?.translate
          ?? getComputedStyle(element).translate);
        elementNudge = { element, ref: elementFocus.ref, tag: elementFocus.tag,
          originalInline: element.style.translate, startX: current.x, startY: current.y,
          x: current.x, y: current.y, overlayId: selectedId, writeContext: captureWriteContext() };
        if (getComputedStyle(element).display === 'inline') {
          elementNudge.originalDisplay = element.style.display;
          const before = element.getBoundingClientRect();
          element.style.display = 'inline-block';
          moveElementToCenter(elementNudge, before.left + before.width / 2,
            before.top + before.height / 2);
        }
      }
      const step = event.shiftKey ? 10 : 1;
      const rect = elementNudge.element.getBoundingClientRect();
      const scale = stage?.getBoundingClientRect().width / outputSize().width || 1;
      moveElementToCenter(elementNudge, rect.left + rect.width / 2 + delta[0] * step * scale,
        rect.top + rect.height / 2 + delta[1] * step * scale);
      clearTimeout(elementNudgeTimer);
      elementNudgeTimer = setTimeout(flushElementNudge, 400);
      refreshSelectionFrame();
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      return true;
    }
    const members = collectiveSelection() ? selectionMembers() : [selectedOverlay];
    if (!members.length || members.some(element => !isMovable(element))) return false;
    if (nudge && nudge.overlayId !== selectedId) flushNudge();
    if (!nudge) {
      const transform = collectiveSelection() ? treeNode(selectedId)?.transform ?? {} : readTransform(selectedOverlay);
      nudge = { group: collectiveSelection(), targets: collectiveSelection() ? movementTargets() : null, overlayId: selectedId, container: selectedOverlay,
        members: members.map(element => ({ element, transform: readTransform(element) })),
        transform, startX: transform.x ?? 0, startY: transform.y ?? 0, dx: 0, dy: 0,
        moved: true, writeContext: captureWriteContext() };
    }
    const step = event.shiftKey ? 10 : 1;
    nudge.dx += delta[0] * step; nudge.dy += delta[1] * step;
    for (const { element, transform } of nudge.members) {
      element.style.setProperty('--x', `${transform.x + nudge.dx}px`);
      element.style.setProperty('--y', `${transform.y + nudge.dy}px`);
    }
    hideHover();
    refreshSelectionFrame();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(flushNudge, 400);
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    return true;
  }

  function cycleCandidates(event) {
    const candidates = [];
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const container = findOverlayContainer(element);
      if (!isSelectable(container)) continue;
      const next = resolveScopedSelection(selectionTree(), scopeId, scopedHitId(container, { clientX: event.clientX, clientY: event.clientY, target: element }));
      if (next.scopeId !== scopeId || !next.selectId || candidates.includes(next.selectId)) continue;
      if (floorScopeId !== null && !lineage(selectionTree(), next.selectId).includes(floorScopeId)) continue;
      candidates.push(next.selectId);
    }
    return candidates;
  }

  function hideHover() {
    breadcrumbHoverActive = false;
    hoverEvent = null;
    if (hoverTick !== null) cancelAnimationFrame(hoverTick);
    hoverTick = null;
    if (hoverFrame) {
      hoverFrame.hidden = true;
      hoverFrame.removeAttribute('data-breadcrumb-hover');
    }
  }
  function showHoverFrame(rect, angle = null, overlayId = '', breadcrumb = false, ariaHidden = true) {
    if (!hoverFrame) {
      hoverFrame = document.createElement('div');
      hoverFrame.setAttribute('data-akari-ui', 'preview-hover-frame');
      if (ariaHidden) hoverFrame.setAttribute('aria-hidden', 'true');
      Object.assign(hoverFrame.style, { position: 'fixed', pointerEvents: 'none',
        boxSizing: 'border-box', border: '1px solid var(--akari-accent, #4da3ff)',
        opacity: '0.45', zIndex: '90' });
      document.body.appendChild(hoverFrame);
    }
    if (breadcrumb) hoverFrame.setAttribute('data-breadcrumb-hover', 'true');
    else hoverFrame.removeAttribute('data-breadcrumb-hover');
    hoverFrame.dataset.overlayId = overlayId;
    hoverFrame.hidden = false;
    Object.assign(hoverFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      transform: angle === null ? '' : `rotate(${angle}deg)` });
  }
  function scheduleHover(event) {
    if (breadcrumbHoverActive) return;
    if (!interactionEnabled || activeDrag || activeResize || activeEdit || event.buttons) { hideHover(); return; }
    hoverEvent = event;
    if (hoverTick !== null) return;
    hoverTick = requestAnimationFrame(() => {
      hoverTick = null;
      if (breadcrumbHoverActive) { hoverEvent = null; return; }
      const event = hoverEvent;
      if (!event || activeDrag || activeResize || activeEdit) { hideHover(); return; }
      const container = overlayForEvent(event);
      const elementHit = window.akari.capabilities?.elementSelection === true && canFocusElement(container);
      const scoped = elementHit && selectionTree().length
        ? resolveScopedSelection(selectionTree(), scopeId, scopedHitId(container, event),
          { deep: Boolean(event.metaKey || event.ctrlKey) }) : null;
      if (elementHit && !event.shiftKey
        && (!scoped || scoped.selectId === container.dataset.overlayId)) {
        const root = fragmentRoot(container);
        const hit = event.target instanceof Element && root?.contains(event.target) ? event.target : null;
        const element = nearestSelectableElement(root, hit, stage?.getBoundingClientRect(), selectionOptions(root));
        const rect = element ? focusedSelectionRect(element) : fragmentBounds(container);
        if (!rect || selectedOverlay === container
          && selectedElementFocus()?.ref === elementAddress(root, element)) { hideHover(); return; }
        showHoverFrame(rect, null, container.dataset.overlayId, false, false);
        return;
      }
      const next = isSelectable(container) && resolveScopedSelection(selectionTree(), scopeId,
        scopedHitId(container, event), { deep: Boolean(event.metaKey || event.ctrlKey) });
      if (!next || selectedIds.includes(next.selectId) || selectionMembers().includes(container) || (floorScopeId !== null
        && !lineage(selectionTree(), next.selectId).includes(floorScopeId))) { hideHover(); return; }
      const node = treeNode(next.selectId);
      const leaf = containerById(next.selectId);
      const lineRect = leaf && lineFrameGeometry(leaf);
      const rect = node && node.kind !== 'leaf' ? unionBounds(visibleMembers(next.selectId))
        : leaf?.dataset.role === 'shape-line' ? lineRect : leaf ? fragmentBounds(leaf) : null;
      if (!rect) { hideHover(); return; }
      showHoverFrame(rect, lineRect?.angle ?? null, next.selectId);
    });
  }

  function releasePointer(drag) {
    try {
      if (drag.container.hasPointerCapture?.(drag.pointerId)) {
        drag.container.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }
  }

  function cancelDrag() {
    if (!activeDrag) return;

    const drag = activeDrag;
    clearDragSettleTimer(drag);
    reportLiveValues(drag.overlayId, undefined, true);
    activeDrag = null;
    if (drag.element) {
      drag.element.style.translate = drag.originalInline;
      if (drag.originalDisplay !== undefined) drag.element.style.display = drag.originalDisplay;
      releasePointer(drag);
      refreshSelectionFrame();
      return;
    }
    if (drag.group) {
      moveGroupMembers(drag, 0, 0);
      releasePointer(drag); hideSnapGuides(); return;
    }
    drag.container.style.setProperty("--x", `${drag.startX}px`);
    drag.container.style.setProperty("--y", `${drag.startY}px`);
    if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
    releasePointer(drag);
    hideSnapGuides();
    refreshSelectionFrame();
    endDragGesture();
  }

  function finishDrag() {
    if (!activeDrag) return null;

    const drag = activeDrag;
    clearDragSettleTimer(drag);
    activeDrag = null;
    releasePointer(drag);
    hideSnapGuides();

    if (drag.element) {
      const rect = drag.element.getBoundingClientRect();
      const displayScale = stage?.getBoundingClientRect().width / outputSize().width || 1;
      const outputDx = (rect.left + rect.width / 2 - drag.startCenterX) / displayScale;
      const outputDy = (rect.top + rect.height / 2 - drag.startCenterY) / displayScale;
      const translate = formatElementTranslate(drag.x, drag.y);
      if (!drag.moved || (Math.abs(outputDx) < 0.5 && Math.abs(outputDy) < 0.5)
        || translate === formatElementTranslate(drag.startX, drag.startY)) {
        drag.element.style.translate = drag.originalInline;
        if (drag.originalDisplay !== undefined) drag.element.style.display = drag.originalDisplay;
        refreshSelectionFrame();
        return null;
      }
      const style = { translate };
      if (drag.originalDisplay !== undefined) style.display = 'inline-block';
      const record = enqueueWrite(drag.writeContext, drag.overlayId,
        { element: { ref: drag.elementRef, tag: drag.elementTag,
          style } }, 'element');
      record.promise.catch(() => {
        drag.element.style.translate = drag.originalInline;
        if (drag.originalDisplay !== undefined) drag.element.style.display = drag.originalDisplay;
        refreshSelectionFrame();
      });
      return record;
    }

    if (drag.group) return finishGroupDrag(drag);
    if (!drag.moved) {
      endDragGesture();
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      return null;
    }

    const transform = readTransform(drag.container);
    // 位置が実質変わっていないなら書かない。drag.moved は「動き始めたか」しか見ていないので、
    // しきい値を越えてから元の位置へ戻して離すと、変化ゼロのまま書き込みが走っていた
    // （実機 2026-08-07: 移動量 0.00004px の transform が edit.json に残留）。
    // 出力座標で 0.5px 未満 = 目にも見えないし、意図した調整でもない。
    const WRITE_EPSILON_PX = 0.5;
    if (
      Math.abs(transform.x - drag.startX) < WRITE_EPSILON_PX &&
      Math.abs(transform.y - drag.startY) < WRITE_EPSILON_PX
    ) {
      endDragGesture();
      // 端数を残さないよう開始値へ戻し、何も書かずに終える
      drag.container.style.setProperty("--x", `${drag.startX}px`);
      drag.container.style.setProperty("--y", `${drag.startY}px`);
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      refreshSelectionFrame();
      return null;
    }
    const patch = drag.motionDriven && !drag.duplicate ? { x: transform.x, y: transform.y } : transform;
    const record = enqueueWrite(
      drag.writeContext,
      drag.overlayId,
      { transform: patch, ...(drag.duplicate ? { duplicate: true } : {}) },
      "transform"
    );
    const source = window.akari.state?.summary?.overlays?.find(item => item.id === drag.overlayId);
    const pending = { container: drag.container, transform,
      keyframes: Array.isArray(source?.keyframes),
      beforeKeyframes: JSON.stringify(source?.keyframes), saved: false };
    pendingDragTransforms.set(drag.overlayId, pending);
    if (pending.keyframes) drag.container.dataset.akariMotionDragging = 'true';
    record.promise.then(() => { pending.saved = true; }, () => {
      if (pendingDragTransforms.get(drag.overlayId) === pending) {
        pending.failedWhileLatest = true;
        pendingDragTransforms.delete(drag.overlayId);
        delete drag.container.dataset.akariMotionDragging;
      }
    });
    record.promise.then(() => window.akari.reportGesture?.('saved'), () => undefined)
      .finally(endDragGesture);
    if (drag.duplicate) {
      drag.container.style.setProperty('--x', `${drag.startX}px`);
      drag.container.style.setProperty('--y', `${drag.startY}px`);
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      refreshSelectionFrame();
    } else {
      syncLeafTransformOnSuccess(record, drag.overlayId, transform);
      if (drag.motionDriven) record.promise.catch(() => {
        if (!pending.failedWhileLatest) return;
        delete drag.container.dataset.akariMotionDragging;
        drag.container.style.setProperty('--x', `${drag.startX}px`);
        drag.container.style.setProperty('--y', `${drag.startY}px`);
        refreshSelectionFrame();
      });
    }
    lastTransformWrite = record;
    return record;
  }

  // ---- 拡縮ハンドル（M3、ビューワー UI ラウンド §3） ----
  // コンテナは #overlay-stage 直下で inset:0（= ステージ全体を覆う全画面ボックス）
  // であり、断片自体はその内部で任意の位置（画面下部中央の字幕、左上のコーナー
  // キャプション等）に絶対配置される。かつて「コンテナ中心とポインタの距離比」で
  // scale していたが、その「コンテナ中心」は常にステージ中心であり、断片の実際の
  // 見た目の位置とは無関係だった（オーナー実機報告: 左上寄りの断片で拡縮の向き・
  // 原点がずれる）。
  //
  // 修正: 基準を選択中オーバーレイの実表示矩形（fragmentBounds = 断片ルートの実測
  // getBoundingClientRect）にし、ドラッグしているハンドルの対角コーナーをアンカー
  // とする。アンカーからの距離比で次の scale を決める。
  //
  // transform-origin は M2 の既定値（コンテナ中心）から動かさない。描画後アンカー A
  // の中心からのローカルベクトルを V、開始時の translate / scale を T0 / S0 と
  // すると、断片側の回転済みベクトルは (V - T0) / S0。新しい scale S1 でも A を
  // 固定する translate は次式になる（回転は V に既に含まれるため明示計算は不要）。
  //   T1 = V - (S1 / S0) * (V - T0)
  // ドラッグ中もこの T1 を --x/--y へ反映し、保存値だけで同じ見た目を再現する。

  function findHandleElement(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-akari-interaction="selection-handle"]');
  }

  // stageScale のキャッシュ値ではなく、その時点の描画矩形とレイアウト寸法から
  // クライアント座標のアンカーを動画座標へ戻す。ズーム・全画面切替後も stale な
  // 基準矩形を使わないよう、補正が必要になるたびに呼び出す。
  function stageLocalPoint(clientX, clientY) {
    if (!stage) return null;

    const rect = stage.getBoundingClientRect();
    const layoutWidth = stage.clientWidth;
    const layoutHeight = stage.clientHeight;
    if (
      ![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(
        Number.isFinite
      ) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      layoutWidth <= 0 ||
      layoutHeight <= 0
    ) {
      return null;
    }

    const scaleX = rect.width / layoutWidth;
    const scaleY = rect.height / layoutHeight;
    if (!(scaleX > 0) || !(scaleY > 0)) return null;

    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top) / scaleY,
      centerX: layoutWidth / 2,
      centerY: layoutHeight / 2,
    };
  }

  // stageLocalPoint() と同じ scaleX（表示px / 出力px）を、単独の倍率として返す。
  // プレビューズーム（#zoom-layer の scale）と #overlay-stage 自身の frameScale の
  // 両方を stage.getBoundingClientRect() が反映済みなので、この一値だけで
  // 「見た目 8px 相当」を出力px単位のしきい値へ正規化できる（M2 のスナップしきい値の
  // ズーム非対応を解消する本実装の核）。
  function currentDisplayScale() {
    if (!stage) return 1;

    const rect = stage.getBoundingClientRect();
    const layoutWidth = stage.clientWidth;
    if (!(rect.width > 0) || !(layoutWidth > 0)) return 1;

    const scale = rect.width / layoutWidth;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function fragmentVideoBounds(container) {
    if (container?.dataset?.role === 'shape-line') {
      const transform = readTransform(container);
      const left = rotatedLeafCorners(container, null, transform, 'w');
      const right = rotatedLeafCorners(container, null, transform, 'e');
      const a = left && stageLocalPoint(left.dragged.x, left.dragged.y);
      const b = right && stageLocalPoint(right.dragged.x, right.dragged.y);
      if (a && b) {
        const stroke = Number(container.querySelector('line:not([data-akari-hit-proxy])')?.getAttribute('stroke-width')) || 1;
        const radius = stroke * Math.abs(transform.scaleY ?? transform.scale) / 2;
        const bounds = { left: Math.min(a.x, b.x) - radius, right: Math.max(a.x, b.x) + radius,
          top: Math.min(a.y, b.y) - radius, bottom: Math.max(a.y, b.y) + radius };
        return { ...bounds, centerX: (bounds.left + bounds.right) / 2,
          centerY: (bounds.top + bounds.bottom) / 2 };
      }
    }
    const rect = fragmentBounds(container);
    if (!rect) return null;

    const topLeft = stageLocalPoint(rect.left, rect.top);
    const bottomRight = stageLocalPoint(rect.right, rect.bottom);
    if (!topLeft || !bottomRight) return null;

    const bounds = {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
    if (!Object.values(bounds).every(Number.isFinite)) return null;

    return {
      ...bounds,
      centerX: (bounds.left + bounds.right) / 2,
      centerY: (bounds.top + bounds.bottom) / 2,
    };
  }

  // distance/release のしきい値は「表示px（見た目）」で評価する。sources/targets は
  // 出力px（stage-local）単位のため、比較の直前だけ scale（=currentDisplayScale()）を
  // 掛けて表示px化する。実際に --x/--y へ加える correction 自体は出力px単位のまま
  // （見た目と保存値の両方が正しくなる: M2 ㉒ のズーム非対応解消）。
  function closestAxisSnap(sources, targets, activeSnap, scale) {
    const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

    if (activeSnap) {
      const source = sources[activeSnap.sourceIndex];
      const target = targets[activeSnap.targetIndex];
      const correction = target - source;
      if (
        Number.isFinite(correction) &&
        Math.abs(correction) * displayScale <= SNAP_RELEASE_DISTANCE
      ) {
        return { ...activeSnap, correction, target };
      }
    }

    let closest = null;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const correction = targets[targetIndex] - sources[sourceIndex];
        const displayDistance = Math.abs(correction) * displayScale;
        if (
          displayDistance <= SNAP_DISTANCE &&
          (!closest || displayDistance < Math.abs(closest.correction) * displayScale)
        ) {
          closest = {
            sourceIndex,
            targetIndex,
            correction,
            target: targets[targetIndex],
          };
        }
      }
    }
    return closest;
  }

  // キャンバス外周 + センター縦横の共通吸着ターゲット。
  // 移動と四隅 resize の候補がずれないよう、並びを含めここを単一正本にする。
  function canvasSnapTargets() {
    const { width, height } = outputSize();
    return {
      x: [0, width / 2, width],
      y: [0, height / 2, height],
    };
  }

  // 共通吸着候補を、出力px単位の bounds
  // {left,top,right,bottom,centerX,centerY} から計算する。overlays のドラッグに限らず、
  // resize・layers[]・cut/caption のドラッグからも共通で呼べるよう window.akari.interaction
  // 経由でも公開する（㉒ スナップ統一の単一正本）。
  // 素早く動かしている最中は、その軸で新しく吸着しない（通り過ぎる候補ごとにカクッと引っかかって、
  // 掴んだ素材がジャンプしたように見えるため）。速さは動かしている素材の中心の表示px/ms を軸ごとに、
  // 時間基準の移動平均でならして測る。止める閾値と戻す閾値を分けて、境目でばたつかないようにする。
  // 状態は吸着結果（motion）に載せて返し、呼び出し元が次回の previousSnap として渡す = ドラッグごとに閉じる。
  const FAST_SNAP_START_SPEED = 0.6;
  const FAST_SNAP_END_SPEED = 0.35;
  const SNAP_SPEED_SMOOTHING_MS = 50;
  function nextSnapMotion(bounds, previous) {
    const now = performance.now();
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2;
    if (!previous || !Number.isFinite(previous.at)) {
      return { at: now, x, y, speedX: 0, speedY: 0, fastX: false, fastY: false };
    }
    const elapsed = now - previous.at;
    if (!(elapsed > 0)) return previous;
    const scale = currentDisplayScale();
    const alpha = 1 - Math.exp(-elapsed / SNAP_SPEED_SMOOTHING_MS);
    const speedX = previous.speedX + alpha * (Math.abs(x - previous.x) * scale / elapsed - previous.speedX);
    const speedY = previous.speedY + alpha * (Math.abs(y - previous.y) * scale / elapsed - previous.speedY);
    return { at: now, x, y, speedX, speedY,
      fastX: previous.fastX ? speedX > FAST_SNAP_END_SPEED : speedX > FAST_SNAP_START_SPEED,
      fastY: previous.fastY ? speedY > FAST_SNAP_END_SPEED : speedY > FAST_SNAP_START_SPEED };
  }

  // ドラッグ開始時（pointerdown）の位置で速度の起点を作る。最初の move から実速度で判定できる。
  function beginSnapMotion(bounds) {
    return bounds ? nextSnapMotion(bounds, null) : null;
  }

  function setExtraSnapTargets(provider) {
    extraSnapTargets = typeof provider === 'function' ? provider : null;
  }

  function snapTargetsFor(moving = null) {
    const selected = new Set((!moving || ['shape', 'html', 'line', 'group'].includes(moving.kind)
      ? [selectedOverlay, ...selectionMembers()] : []).filter(Boolean));
    const ids = new Set([moving?.id, ...(moving?.ids ?? [])].filter(Boolean));
    const others = stage ? Array.from(stage.children)
      .filter(element => isSelectable(element) && !selected.has(element)
        && !ids.has(element.dataset?.overlayId))
      .map(fragmentVideoBounds).filter(Boolean) : [];
    const extra = extraSnapTargets?.(moving);
    if (Array.isArray(extra)) others.push(...extra.filter(item => item
      && [item.left, item.right, item.top, item.bottom].every(Number.isFinite)));
    return others;
  }

  function computeScaleSnap({ scale, at, previous = null, movingItem = null,
    initialBounds = null, movingEdges = null, clamp = value => value }) {
    const solved = globalThis.akariHandleGeometry?.snapScale({ scale, at,
      others: snapTargetsFor(movingItem), canvas: outputSize(), displayScale: currentDisplayScale(),
      previous, initialBounds, movingEdges, clamp });
    showSnapGuides(solved?.snapX, solved?.snapY);
    return solved;
  }

  function computeSnapCorrection(bounds, previousSnap, movingItem = null) {
    if (!bounds) return { x: null, y: null };
    if (!globalThis.akariHandleGeometry) {
      const targets = canvasSnapTargets();
      return { x: closestAxisSnap([bounds.left, bounds.centerX, bounds.right], targets.x,
        previousSnap?.x ?? null, currentDisplayScale()),
      y: closestAxisSnap([bounds.top, bounds.centerY, bounds.bottom], targets.y,
        previousSnap?.y ?? null, currentDisplayScale()) };
    }
    // 動かしている素材自身（単体選択・グループ/複数選択のメンバー）は吸着先にしない。
    const others = snapTargetsFor(movingItem);
    const motion = nextSnapMotion(bounds, previousSnap?.motion);
    const line = movingItem?.kind === 'line';
    const centerPriority = line ? { x: true, y: true } : null;
    const snap = globalThis.akariHandleGeometry.snapBounds(bounds, others, outputSize(), currentDisplayScale(), 6,
      { previous: previousSnap, fast: { x: motion.fastX, y: motion.fastY }, centerPriority,
        centerToItemEdges: ['line', 'html', 'caption', 'layer', 'cut'].includes(movingItem?.kind),
        nearest: movingItem?.kind === 'layer' || movingItem?.kind === 'cut',
        preferMatchingItem: movingItem?.kind === 'shape' });
    return { ...snap, motion };
  }

  function applyDragSnapping(drag, rawX, rawY, disabled, lockedAxis = null) {
    drag.container.style.setProperty("--x", `${rawX}px`);
    drag.container.style.setProperty("--y", `${rawY}px`);

    if (disabled) {
      drag.snapX = null;
      drag.snapY = null;
      hideSnapGuides();
      return;
    }

    const bounds = fragmentVideoBounds(drag.container);
    if (!bounds) {
      drag.snapX = null;
      drag.snapY = null;
      hideSnapGuides();
      return;
    }

    const snap = computeSnapCorrection(bounds, { x: drag.snapX, y: drag.snapY, motion: drag.snapMotion },
      { kind: drag.container.dataset.role === 'shape-line' ? 'line'
        : drag.container.dataset.role === 'shape' ? 'shape' : 'html' });
    drag.snapMotion = snap.motion;
    if (lockedAxis === 'x') snap.y = null;
    if (lockedAxis === 'y') snap.x = null;
    drag.snapX = snap.x;
    drag.snapY = snap.y;

    if (drag.snapX) {
      drag.container.style.setProperty(
        "--x",
        `${rawX + drag.snapX.correction}px`
      );
    }
    if (drag.snapY) {
      drag.container.style.setProperty(
        "--y",
        `${rawY + drag.snapY.correction}px`
      );
    }
    showSnapGuides(drag.snapX, drag.snapY);
  }

  function anchorPreservingTranslate({
    startX,
    startY,
    startScale,
    scale,
    anchorStageX,
    anchorStageY,
  }) {
    if (
      !stage ||
      !Number.isFinite(startScale) ||
      startScale === 0 ||
      !Number.isFinite(anchorStageX) ||
      !Number.isFinite(anchorStageY)
    ) {
      return null;
    }

    const dx = anchorStageX - stage.clientWidth / 2;
    const dy = anchorStageY - stage.clientHeight / 2;
    const scaleRatio = scale / startScale;
    return {
      x: dx - scaleRatio * (dx - startX),
      y: dy - scaleRatio * (dy - startY),
    };
  }

  function handleCorner(handleEl) {
    for (const corner of ["nw", "ne", "se", "sw"]) {
      if (handleEl.classList.contains(`is-${corner}`)) return corner;
    }
    return null;
  }

  function handleEdge(handleEl) {
    if (!handleEl.classList.contains('is-edge')) return null;
    return ['n', 'e', 's', 'w'].find(edge => handleEl.classList.contains(`is-${edge}`)) ?? null;
  }

  // アンカーは「ドラッグしているハンドルの対角コーナー」（例: se ハンドルなら nw）。
  function cornerAnchorPoint(rect, corner) {
    switch (corner) {
      case "nw":
        return { x: rect.right, y: rect.bottom };
      case "ne":
        return { x: rect.left, y: rect.bottom };
      case "se":
        return { x: rect.left, y: rect.top };
      case "sw":
        return { x: rect.right, y: rect.top };
      default:
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }

  // cornerAnchorPoint() の対角（アンカー）ではなく、実際にドラッグしているハンドル
  // 自身のコーナー座標（resize スナップの対象点）。
  function namedCornerPoint(rect, corner) {
    switch (corner) {
      case "nw":
        return { x: rect.left, y: rect.top };
      case "ne":
        return { x: rect.right, y: rect.top };
      case "se":
        return { x: rect.right, y: rect.bottom };
      case "sw":
        return { x: rect.left, y: rect.bottom };
      default:
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }

  function edgePoint(rect, edge, opposite = false) {
    const side = opposite ? { n: 's', e: 'w', s: 'n', w: 'e' }[edge] : edge;
    switch (side) {
      case 'n': return { x: rect.left + rect.width / 2, y: rect.top };
      case 'e': return { x: rect.right, y: rect.top + rect.height / 2 };
      case 's': return { x: rect.left + rect.width / 2, y: rect.bottom };
      default: return { x: rect.left, y: rect.top + rect.height / 2 };
    }
  }

  function clampScale(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
  }

  function unrotatedLeafBounds(container) {
    const previous = container.style.getPropertyValue('--rotate');
    container.style.setProperty('--rotate', '0deg');
    const rect = fragmentBounds(container);
    if (previous) container.style.setProperty('--rotate', previous);
    else container.style.removeProperty('--rotate');
    return rect;
  }

  function leafPivotClient(transform) {
    if (!stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const displayX = stageRect.width / stage.clientWidth;
    const displayY = stageRect.height / stage.clientHeight;
    return { x: stageRect.left + stageRect.width / 2 + transform.x * displayX,
      y: stageRect.top + stageRect.height / 2 + transform.y * displayY };
  }

  function rotatedLeafCorners(container, corner, transform, edge = null) {
    if (!transform.rotate) return null;
    const rect = unrotatedLeafBounds(container);
    if (!rect) return null;
    const stageRect = stage.getBoundingClientRect();
    const displayX = stageRect.width / stage.clientWidth;
    const displayY = stageRect.height / stage.clientHeight;
    const pivot = leafPivotClient(transform);
    const radians = transform.rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const rotatePoint = point => {
      // The unrotated bounds already include axis scale. CSS applies R after S,
      // so rotate those displayed corners around the same pivot without S^-1.
      const dx = (point.x - pivot.x) / displayX, dy = (point.y - pivot.y) / displayY;
      return { x: pivot.x + displayX * (cosine * dx - sine * dy),
        y: pivot.y + displayY * (sine * dx + cosine * dy) };
    };
    return { anchor: rotatePoint(edge ? edgePoint(rect, edge, true) : cornerAnchorPoint(rect, corner)),
      dragged: rotatePoint(edge ? edgePoint(rect, edge) : namedCornerPoint(rect, corner)) };
  }

  function releaseResizePointer(resize) {
    try {
      if (resize.handleEl?.hasPointerCapture?.(resize.pointerId)) {
        resize.handleEl.releasePointerCapture(resize.pointerId);
      }
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }
  }

  function lineEndpointArtwork(container, pose) {
    const svg = container.querySelector('svg');
    if (!svg) return null;
    const body = Array.from(svg.children).find(child =>
      child.tagName.toLowerCase() === 'line' && child.getAttribute('data-akari-hit-proxy') !== '1');
    if (!body) return null;
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    if (!(width > 0) || !(height > 0)) return null;
    const scaleX = pose.scaleX ?? pose.scale;
    const scaleY = pose.scaleY ?? pose.scale;
    const parts = Array.from(svg.children).filter(child => child !== body &&
      child.getAttribute('data-akari-hit-proxy') !== '1' && child.tagName.toLowerCase() !== 'defs');
    const groups = parts.map((part, index) => {
      const existing = part.getAttribute('data-line-cap');
      let end = existing === 'end';
      if (!existing) {
        if (parts.length === 2) end = index === 1;
        else {
          const box = part.getBBox();
          end = box.x + box.width / 2 > width / 2;
        }
      }
      const group = existing ? part : document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (!existing) {
        const proxy = part.nextElementSibling?.getAttribute('data-akari-hit-proxy') === '1'
          ? part.nextElementSibling : null;
        part.parentNode.insertBefore(group, part);
        group.appendChild(part);
        if (proxy) group.appendChild(proxy);
      }
      return { group, transient: !existing, originalTransform: group.getAttribute('transform'),
        x: end ? width : 0, y: height / 2 };
    });
    return { body, x1: body.getAttribute('x1'), x2: body.getAttribute('x2'),
      width, scaleX, scaleY, groups };
  }

  function updateLineEndpointArtwork(artwork, scaleX, scaleY) {
    if (!artwork || !(scaleX > 0) || !(scaleY > 0)) return;
    const x1 = Number(artwork.x1) * artwork.scaleX / scaleX;
    const x2 = artwork.width - (artwork.width - Number(artwork.x2)) * artwork.scaleX / scaleX;
    artwork.body.setAttribute('x1', String(x1));
    artwork.body.setAttribute('x2', String(Math.max(x1, x2)));
    const proxy = artwork.body.nextElementSibling;
    if (proxy?.getAttribute('data-akari-hit-proxy') === '1') {
      proxy.setAttribute('x1', artwork.body.getAttribute('x1'));
      proxy.setAttribute('x2', artwork.body.getAttribute('x2'));
    }
    for (const part of artwork.groups) {
      const sx = part.transient ? artwork.scaleX / scaleX : 1 / scaleX;
      const sy = part.transient ? artwork.scaleY / scaleY : 1 / scaleY;
      part.group.setAttribute('transform', `translate(${part.x} ${part.y}) scale(${sx} ${sy})${
        part.transient ? ` translate(${-part.x} ${-part.y})` : ''}`);
    }
  }

  function restoreLineEndpointArtwork(artwork) {
    if (!artwork) return;
    artwork.body.setAttribute('x1', artwork.x1);
    artwork.body.setAttribute('x2', artwork.x2);
    const proxy = artwork.body.nextElementSibling;
    if (proxy?.getAttribute('data-akari-hit-proxy') === '1') {
      proxy.setAttribute('x1', artwork.x1);
      proxy.setAttribute('x2', artwork.x2);
    }
    for (const part of artwork.groups) {
      if (part.transient) part.group.replaceWith(...part.group.childNodes);
      else if (part.originalTransform === null) part.group.removeAttribute('transform');
      else part.group.setAttribute('transform', part.originalTransform);
    }
  }

  function beginLineEndpoint(event, handleEl) {
    if (!selectedOverlay || !globalThis.akariHandleGeometry) return;
    const pose = readTransform(selectedOverlay);
    const geometry = lineFrameGeometry(selectedOverlay);
    const start = rotatedLeafCorners(selectedOverlay, null, pose, 'w');
    const end = rotatedLeafCorners(selectedOverlay, null, pose, 'e');
    const rect = unrotatedLeafBounds(selectedOverlay);
    const left = geometry?.start ?? start?.dragged ?? (rect && edgePoint(rect, 'w'));
    const right = geometry?.end ?? end?.dragged ?? (rect && edgePoint(rect, 'e'));
    if (!left || !right) return;
    const a = stageLocalPoint(left.x, left.y), b = stageLocalPoint(right.x, right.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!a || !b || !pointer) return;
    const movingEndpoint = handleEl.classList.contains('is-line-start') ? 'start' : 'end';
    activeLine = { container: selectedOverlay, overlayId: selectedId, pose,
      fixed: movingEndpoint === 'start' ? b : a,
      originalMoving: movingEndpoint === 'start' ? a : b,
      movingEndpoint, handleEl, pointerId: event.pointerId,
      pointerOffset: { x: (movingEndpoint === 'start' ? a : b).x - pointer.x,
        y: (movingEndpoint === 'start' ? a : b).y - pointer.y },
      moved: false, artwork: lineEndpointArtwork(selectedOverlay, pose),
      writeContext: captureWriteContext() };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = '線の長さと向き';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function updateLineEndpoint(event) {
    const line = activeLine;
    if (!line || event.pointerId !== line.pointerId) return;
    const point = stageLocalPoint(event.clientX, event.clientY);
    if (!point) return;
    const others = snapTargetsFor({ kind: 'line', id: line.overlayId });
    const solved = globalThis.akariHandleGeometry.solveLineEndpoint(line.fixed,
      { x: point.x + line.pointerOffset.x, y: point.y + line.pointerOffset.y },
      others, outputSize(), currentDisplayScale(), event.metaKey || event.ctrlKey, point);
    const pose = globalThis.akariHandleGeometry.lineTransform({ fixed: line.fixed,
      originalMoving: line.originalMoving, moving: solved.point,
      movingEndpoint: line.movingEndpoint,
      stageCenter: { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, pose: line.pose });
    if (!pose) return;
    line.container.style.setProperty('--x', `${pose.x}px`);
    line.container.style.setProperty('--y', `${pose.y}px`);
    line.container.style.setProperty('--scale-x', String(pose.scaleX));
    line.container.style.setProperty('--scale-y', String(pose.scaleY));
    updateLineEndpointArtwork(line.artwork, pose.scaleX, pose.scaleY);
    line.container.style.setProperty('--rotate', `${pose.rotate}deg`);
    line.moved = true;
    showSnapGuides(solved.snap.x, solved.snap.y);
    if (event.cancelable) event.preventDefault();
  }

  function finishLineEndpoint(cancelled = false) {
    const line = activeLine;
    if (!line) return null;
    activeLine = null;
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(line);
    hideSnapGuides();
    if (cancelled || !line.moved) {
      restoreLineEndpointArtwork(line.artwork);
      for (const [name, value] of [['--x', `${line.pose.x}px`], ['--y', `${line.pose.y}px`],
        ['--scale', String(line.pose.scale)], ['--rotate', `${line.pose.rotate}deg`]]) {
        line.container.style.setProperty(name, value);
      }
      if (line.pose.scaleX === undefined) line.container.style.removeProperty('--scale-x');
      else line.container.style.setProperty('--scale-x', String(line.pose.scaleX));
      if (line.pose.scaleY === undefined) line.container.style.removeProperty('--scale-y');
      else line.container.style.setProperty('--scale-y', String(line.pose.scaleY));
      refreshSelectionFrame();
      return null;
    }
    const transform = readTransform(line.container);
    const record = enqueueWrite(line.writeContext, line.overlayId, { transform }, 'transform');
    syncLeafTransformOnSuccess(record, line.overlayId, transform);
    lastTransformWrite = record;
    return record;
  }

  function beginResize(event, container, handleEl) {
    if (selectedElementFocus() && focusedElement()) {
      beginElementResize(event, handleEl);
      return;
    }
    if (isTelopOverlay(container) && handleEdge(handleEl)) return;
    if (activeEdit) void commitEdit();

    // 断片の実表示矩形（ステージ全体=コンテナの矩形ではなく、実際に見えている
    // 断片ルートの矩形）を基準にする。取得できない異常系のみコンテナ矩形へ退避。
    const visualRect = fragmentBounds(container) ?? container.getBoundingClientRect();
    const corner = handleCorner(handleEl);
    const edge = handleEdge(handleEl);
    const transform = readTransform(container);
    const rotated = rotatedLeafCorners(container, corner, transform, edge);
    const anchorClient = rotated?.anchor ?? (edge ? edgePoint(visualRect, edge, true) : cornerAnchorPoint(visualRect, corner));
    const draggedClient = rotated?.dragged ?? (edge ? edgePoint(visualRect, edge) : namedCornerPoint(visualRect, corner));
    const anchor = stageLocalPoint(anchorClient.x, anchorClient.y);
    const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!anchor || !dragged || !pointer) return;

    const pointerOffsetX = rotated ? dragged.x - pointer.x : 0;
    const pointerOffsetY = rotated ? dragged.y - pointer.y : 0;
    const startDistance = Math.hypot(pointer.x + pointerOffsetX - anchor.x,
      pointer.y + pointerOffsetY - anchor.y);

    activeResize = {
      container,
      handleEl,
      overlayId: container.dataset.overlayId ?? "",
      pointerId: event.pointerId,
      corner,
      edge,
      rotation: transform.rotate * Math.PI / 180,
      anchorStageX: anchor.x,
      anchorStageY: anchor.y,
      draggedStageX: dragged.x,
      draggedStageY: dragged.y,
      startDistance: startDistance || 1, // 0除算回避（アンカーとハンドルが重なる異常系向け保険）
      pointerOffsetX,
      pointerOffsetY,
      startScale: transform.scale,
      startScaleX: transform.scaleX ?? transform.scale,
      startScaleY: transform.scaleY ?? transform.scale,
      startBounds: fragmentVideoBounds(container),
      axisCss: [container.style.getPropertyValue("--scale-x"), container.style.getPropertyValue("--scale-y")],
      startX: transform.x,
      startY: transform.y,
      snapX: null,
      snapY: null,
      moved: false,
      writeContext: captureWriteContext(),
    };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = isTelopOverlay(container) ? 'サイズ'
      : edge ? (container.dataset.role === 'text' ? '折り返し幅' : '形を伸ばす') : '大きさ';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);

    try {
      handleEl.setPointerCapture?.(event.pointerId);
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }

    if (event.cancelable) event.preventDefault();
  }

  function beginGroupResize(event, handleEl) {
    if (activeEdit) void commitEdit();
    const members = selectionMembers().map(element => ({ element, transform: readTransform(element) }));
    if (!members.length || members.some(member => !isMovable(member.element))) return;
    const rect = unionBounds(members.map(member => member.element));
    if (!rect) return;
    const corner = handleCorner(handleEl);
    const anchorClient = cornerAnchorPoint(rect, corner);
    const draggedClient = namedCornerPoint(rect, corner);
    const anchor = stageLocalPoint(anchorClient.x, anchorClient.y);
    const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!anchor || !dragged || !pointer) return;
    const world = treeNode(selectedId)?.transform ?? {};
    const oldPose = { x: world.x ?? 0, y: world.y ?? 0, scale: world.scale ?? 1,
      rotate: world.rotate ?? 0 };
    activeResize = { group: true, overlayId: selectedId, members, oldPose, pose: oldPose,
      handleEl, pointerId: event.pointerId, anchorStageX: anchor.x, anchorStageY: anchor.y,
      draggedStageX: dragged.x, draggedStageY: dragged.y,
      startDistance: Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) || 1,
      startScale: oldPose.scale, snapX: null, snapY: null, moved: false,
      startBounds: (() => { const tl = stageLocalPoint(rect.left, rect.top);
        const br = stageLocalPoint(rect.right, rect.bottom);
        return tl && br ? { left: tl.x, top: tl.y, right: br.x, bottom: br.y } : null; })(),
      writeContext: captureWriteContext() };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = '大きさ';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function beginRotate(event, handleEl) {
    if (selectedElementFocus() && focusedElement()) {
      beginElementRotate(event, handleEl);
      return;
    }
    if (activeEdit) void commitEdit();
    const group = groupSelection;
    const members = group ? selectionMembers().map(element => ({ element, transform: readTransform(element) })) : [];
    if (group && (!members.length || members.some(member => !isMovable(member.element)))) return;
    const rect = group ? unionBounds(members.map(member => member.element)) : fragmentBounds(selectedOverlay);
    if (!rect) return;
    const center = stageLocalPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!center || !pointer) return;
    const current = group ? treeNode(selectedId)?.transform ?? {} : readTransform(selectedOverlay);
    const oldPose = { x: current.x ?? 0, y: current.y ?? 0, scale: current.scale ?? 1,
      rotate: current.rotate ?? 0 };
    activeRotate = { group, overlayId: selectedId, container: selectedOverlay, members,
      handleEl, pointerId: event.pointerId, oldPose, pose: oldPose, startRect: rect,
      center, pivot: { x: stage.clientWidth / 2 + oldPose.x, y: stage.clientHeight / 2 + oldPose.y },
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      angle: 0, moved: false, writeContext: captureWriteContext() };
    rotationBadge = document.createElement('div');
    rotationBadge.className = 'akari-interaction-angle';
    rotationBadge.setAttribute('data-akari-interaction', 'rotation-angle');
    document.body.appendChild(rotationBadge);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function updateRotate(event) {
    const rotation = activeRotate;
    if (!rotation || event.pointerId !== rotation.pointerId) return;
    if (rotation.element) { updateElementRotate(event); return; }
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!pointer) return;
    let angle = (Math.atan2(pointer.y - rotation.center.y, pointer.x - rotation.center.x)
      - rotation.startAngle) * 180 / Math.PI;
    const absolute = rotation.oldPose.rotate + angle;
    const normalized = ((absolute + 180) % 360 + 360) % 360 - 180;
    const target = Math.round(normalized / 45) * 45;
    const snapped = globalThis.akariHandleGeometry?.snapAngle(absolute, event.metaKey || event.ctrlKey)
      ?? (!(event.metaKey || event.ctrlKey) && Math.abs(normalized - target) <= 4 ? target : normalized);
    angle = ((snapped - rotation.oldPose.rotate + 180) % 360 + 360) % 360 - 180;
    rotation.angle = angle;
    if (rotationBadge) {
      rotationBadge.textContent = `${Math.round(globalThis.akariHandleGeometry?.normalizeAngle(rotation.oldPose.rotate + angle)
        ?? rotation.oldPose.rotate + angle)}°`;
      rotationBadge.style.left = `${event.clientX + 15}px`;
      rotationBadge.style.top = `${event.clientY + 17}px`;
    }
    const tangent = Math.atan2(event.clientY - (stage.getBoundingClientRect().top + rotation.center.y * currentDisplayScale()),
      event.clientX - (stage.getBoundingClientRect().left + rotation.center.x * currentDisplayScale())) * 180 / Math.PI + 90;
    const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="rotate(${Math.round(tangent)} 16 16)" fill="none" stroke="white" stroke-width="2"><path d="M5 16a11 11 0 0 1 19-7m3 7a11 11 0 0 1-19 7"/><path d="m21 8 4 1-1-4M11 24l-4-1 1 4"/></g></svg>`;
    document.body.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") 16 16, crosshair`;
    if (rotation.group) {
      const theta = angle * Math.PI / 180, cosine = Math.cos(theta), sine = Math.sin(theta);
      const cx = rotation.center.x - stage.clientWidth / 2;
      const cy = rotation.center.y - stage.clientHeight / 2;
      const dx = cx - rotation.oldPose.x, dy = cy - rotation.oldPose.y;
      groupPoseAt(rotation, { ...rotation.oldPose, rotate: rotation.oldPose.rotate + angle,
        x: cx - (cosine * dx - sine * dy), y: cy - (sine * dx + cosine * dy) });
      selectionFrame.style.transform = `rotate(${angle}deg)`;
    } else {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate + angle}deg`);
      const radians = angle * Math.PI / 180;
      const dx = rotation.center.x - rotation.pivot.x;
      const dy = rotation.center.y - rotation.pivot.y;
      const next = globalThis.akariHandleGeometry?.rotationAroundPoint(rotation.oldPose,
        rotation.pivot, rotation.center, angle) ?? {
          x: rotation.oldPose.x + dx - (Math.cos(radians) * dx - Math.sin(radians) * dy),
          y: rotation.oldPose.y + dy - (Math.sin(radians) * dx + Math.cos(radians) * dy),
        };
      rotation.container.style.setProperty('--x', `${next.x}px`);
      rotation.container.style.setProperty('--y', `${next.y}px`);
    }
    rotation.moved = Math.abs(angle) > .01;
    if (event.cancelable) event.preventDefault();
  }

  function cancelRotate() {
    if (!activeRotate) return;
    const rotation = activeRotate;
    if (rotation.element) {
      activeRotate = null;
      cancelElementGesture(rotation);
      return;
    }
    reportLiveValues(rotation.overlayId, undefined, true);
    activeRotate = null;
    rotationBadge?.remove(); rotationBadge = null;
    document.body.style.cursor = '';
    releaseResizePointer(rotation);
    if (rotation.group) restoreGroupPose(rotation);
    else {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate}deg`);
      rotation.container.style.setProperty('--x', `${rotation.oldPose.x}px`);
      rotation.container.style.setProperty('--y', `${rotation.oldPose.y}px`);
      refreshSelectionFrame();
    }
  }

  function finishRotate() {
    if (!activeRotate) return null;
    const rotation = activeRotate;
    activeRotate = null;
    if (rotation.element) return finishElementGesture(rotation);
    rotationBadge?.remove(); rotationBadge = null;
    document.body.style.cursor = '';
    releaseResizePointer(rotation);
    if (rotation.group) {
      selectionFrame.style.transform = '';
      refreshGroupFrame();
      return rotation.moved ? finishGroupTransform(rotation) : null;
    }
    if (!rotation.moved) return null;
    const current = readTransform(rotation.container);
    const transform = { x: current.x, y: current.y, rotate: current.rotate };
    const record = enqueueWrite(rotation.writeContext, rotation.overlayId,
      { transform }, 'transform');
    syncLeafTransformOnSuccess(record, rotation.overlayId, readTransform(rotation.container));
    record.promise.catch(error => {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate}deg`);
      rotation.container.style.setProperty('--x', `${rotation.oldPose.x}px`);
      rotation.container.style.setProperty('--y', `${rotation.oldPose.y}px`);
      refreshSelectionFrame();
      reportWriteError('transform', rotation.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
  }

  function computeAnchorResizeSnap({
    anchorStageX,
    anchorStageY,
    draggedStageX,
    draggedStageY,
    startScale,
    scale,
    snapX,
    snapY,
    startBounds,
    movingItem,
  }) {
    if (!(Math.abs(startScale) > 1e-6)) return null;
    if (!globalThis.akariHandleGeometry?.snapScale) {
      // Older hosts load interaction.js alone. Keep their canvas-only path through
      // the same movement correction entry point until handle geometry is loaded.
      const point = { x: anchorStageX + (draggedStageX - anchorStageX) * scale / startScale,
        y: anchorStageY + (draggedStageY - anchorStageY) * scale / startScale };
      const snap = computeSnapCorrection({ left: point.x, right: point.x,
        centerX: point.x, top: point.y, bottom: point.y, centerY: point.y },
      { x: snapX, y: snapY }, movingItem);
      const choices = [['x', draggedStageX - anchorStageX], ['y', draggedStageY - anchorStageY]]
        .flatMap(([axis, distance]) => snap[axis] && Math.abs(distance) > 1e-9
          ? [{ axis, distance: Math.abs(snap[axis].correction),
            scale: clampScale(scale + snap[axis].correction * startScale / distance) }] : []);
      choices.sort((a, b) => a.distance - b.distance);
      const chosen = choices[0];
      const result = { scale: chosen?.scale ?? scale,
        snapX: chosen?.axis === 'x' ? snap.x : null,
        snapY: chosen?.axis === 'y' ? snap.y : null };
      showSnapGuides(result.snapX, result.snapY);
      return result;
    }
    const base = startBounds ?? { left: Math.min(anchorStageX, draggedStageX),
      right: Math.max(anchorStageX, draggedStageX),
      top: Math.min(anchorStageY, draggedStageY),
      bottom: Math.max(anchorStageY, draggedStageY) };
    const at = value => {
      const ratio = value / startScale;
      return { left: anchorStageX + (base.left - anchorStageX) * ratio,
        right: anchorStageX + (base.right - anchorStageX) * ratio,
        top: anchorStageY + (base.top - anchorStageY) * ratio,
        bottom: anchorStageY + (base.bottom - anchorStageY) * ratio };
    };
    return computeScaleSnap({ scale, at, previous: { x: snapX, y: snapY }, movingItem,
      initialBounds: base,
      movingEdges: { x: draggedStageX < anchorStageX ? 0 : 2,
        y: draggedStageY < anchorStageY ? 0 : 2 },
      clamp: clampScale });
  }

  function applyResizeSnap(resize, scale) {
    const solved = computeAnchorResizeSnap({
      anchorStageX: resize.anchorStageX,
      anchorStageY: resize.anchorStageY,
      draggedStageX: resize.draggedStageX,
      draggedStageY: resize.draggedStageY,
      startScale: resize.startScale,
      scale,
      snapX: resize.snapX,
      snapY: resize.snapY,
      startBounds: resize.startBounds,
      movingItem: { kind: resize.group ? 'group' : resize.container.dataset.role === 'shape' ? 'shape' : 'html',
        id: resize.overlayId, ids: resize.group ? resize.members.map(member => member.element.dataset.overlayId) : [] },
    });
    if (!solved) return null;
    resize.snapX = solved.snapX;
    resize.snapY = solved.snapY;
    return solved.scale;
  }

  function applyResizeTransformAt(resize, scaleValue) {
    // pointerdown 時に確定した対角コーナー（stage-local）と開始 transform だけを使う。
    // stage-local 値なので、ズームや全画面切替で client 矩形が変われば表示位置は自然に
    // 追従する一方、断片自身の前フレームの変形結果は次の基準へ混ざらない。
    if (isTelopOverlay(resize.container)) {
      const uniform = clampScale(Math.sqrt(resize.startScaleX * resize.startScaleY)
        * scaleValue / resize.startScale);
      applyAxisResize(resize, uniform, uniform);
      resize.container.style.setProperty('--scale', String(uniform));
      return true;
    }
    const translate = anchorPreservingTranslate({
      startX: resize.startX,
      startY: resize.startY,
      startScale: resize.startScale,
      scale: scaleValue,
      anchorStageX: resize.anchorStageX,
      anchorStageY: resize.anchorStageY,
    });
    if (!translate) return false;

    resize.container.style.setProperty("--x", `${translate.x}px`);
    resize.container.style.setProperty("--y", `${translate.y}px`);
    resize.container.style.setProperty("--scale", String(scaleValue));
    if (resize.axisCss.some(Boolean)) {
      resize.container.style.setProperty("--scale-x", String(resize.startScaleX * scaleValue / resize.startScale));
      resize.container.style.setProperty("--scale-y", String(resize.startScaleY * scaleValue / resize.startScale));
    } else {
      resize.container.style.removeProperty('--scale-x');
      resize.container.style.removeProperty('--scale-y');
    }
    return true;
  }

  function axisResizePosition(resize, ratioX, ratioY) {
    const cosine = Math.cos(resize.rotation), sine = Math.sin(resize.rotation);
    const dx = resize.anchorStageX - stage.clientWidth / 2 - resize.startX;
    const dy = resize.anchorStageY - stage.clientHeight / 2 - resize.startY;
    const localX = cosine * dx + sine * dy;
    const localY = -sine * dx + cosine * dy;
    return {
      x: resize.anchorStageX - stage.clientWidth / 2
        - (cosine * ratioX * localX - sine * ratioY * localY),
      y: resize.anchorStageY - stage.clientHeight / 2
        - (sine * ratioX * localX + cosine * ratioY * localY),
    };
  }

  function applyAxisResize(resize, scaleX, scaleY) {
    const position = axisResizePosition(resize,
      scaleX / resize.startScaleX, scaleY / resize.startScaleY);
    resize.container.style.setProperty('--x', `${position.x}px`);
    resize.container.style.setProperty('--y', `${position.y}px`);
    resize.container.style.setProperty('--scale-x', String(scaleX));
    resize.container.style.setProperty('--scale-y', String(scaleY));
  }

  function axisResizeSnap(resize, axis, scaleX, scaleY) {
    const scale = axis === 'x' ? scaleX : scaleY;
    const at = value => {
      applyAxisResize(resize, axis === 'x' ? value : scaleX, axis === 'y' ? value : scaleY);
      return fragmentVideoBounds(resize.container);
    };
    const solved = computeScaleSnap({ scale, at,
      movingItem: { kind: 'shape', id: resize.overlayId },
      previous: { x: resize.snapX, y: resize.snapY }, initialBounds: resize.startBounds,
      movingEdges: axis === 'x' ? { x: resize.edge === 'w' ? 0 : 2 }
        : { y: resize.edge === 'n' ? 0 : 2 },
      clamp: clampScale });
    resize.snapX = solved?.snapX ?? null;
    resize.snapY = solved?.snapY ?? null;
    return solved?.scale ?? scale;
  }

  function updateAxisResize(resize, event, pointer) {
    if (isTelopOverlay(resize.container)) return;
    const cosine = Math.cos(resize.rotation), sine = Math.sin(resize.rotation);
    const dx = pointer.x + resize.pointerOffsetX - resize.anchorStageX;
    const dy = pointer.y + resize.pointerOffsetY - resize.anchorStageY;
    const startDx = resize.draggedStageX - resize.anchorStageX;
    const startDy = resize.draggedStageY - resize.anchorStageY;
    const x0 = cosine * startDx + sine * startDy;
    const y0 = -sine * startDx + cosine * startDy;
    const useX = !resize.edge || resize.edge === 'e' || resize.edge === 'w';
    const useY = !resize.edge || resize.edge === 'n' || resize.edge === 's';
    let scaleX = useX && Math.abs(x0) > 1e-6
      ? clampScale(resize.startScaleX * (cosine * dx + sine * dy) / x0) : resize.startScaleX;
    let scaleY = useY && Math.abs(y0) > 1e-6
      ? clampScale(resize.startScaleY * (-sine * dx + cosine * dy) / y0) : resize.startScaleY;
    if (event.metaKey || event.ctrlKey) {
      resize.snapX = null; resize.snapY = null; hideSnapGuides();
    } else if (resize.edge) {
      if (useX) scaleX = axisResizeSnap(resize, 'x', scaleX, scaleY);
      else scaleY = axisResizeSnap(resize, 'y', scaleX, scaleY);
    } else {
      // A corner changes both axes; solve one uniform multiplier for its visible box.
      const factor = scaleX / resize.startScaleX;
      const solved = computeAnchorResizeSnap({ anchorStageX: resize.anchorStageX,
        anchorStageY: resize.anchorStageY, draggedStageX: resize.draggedStageX,
        draggedStageY: resize.draggedStageY, startScale: 1, scale: factor,
        startBounds: resize.startBounds, snapX: resize.snapX, snapY: resize.snapY,
        movingItem: { kind: 'shape', id: resize.overlayId } });
      if (solved && !event.metaKey && !event.ctrlKey) {
        scaleX = resize.startScaleX * solved.scale;
        scaleY = resize.startScaleY * solved.scale;
        resize.snapX = solved.snapX; resize.snapY = solved.snapY;
      }
    }
    applyAxisResize(resize, scaleX, scaleY);
    resize.moved = Math.abs(scaleX - resize.startScaleX) > 1e-6
      || Math.abs(scaleY - resize.startScaleY) > 1e-6;
    if (event.cancelable) event.preventDefault();
  }

  function updateResize(event) {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    if (resize.element) { updateElementResize(event); return; }

    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!pointer) return;
    if (!resize.group && !resize.edge && globalThis.akariHandleGeometry) {
      const scales = globalThis.akariHandleGeometry.anchoredScales({
        anchor: { x: resize.anchorStageX, y: resize.anchorStageY },
        dragged: { x: resize.draggedStageX, y: resize.draggedStageY },
        pointer: { x: pointer.x + resize.pointerOffsetX, y: pointer.y + resize.pointerOffsetY },
        rotation: resize.rotation * 180 / Math.PI,
        scaleX: resize.startScaleX, scaleY: resize.startScaleY,
      });
      const uniform = isTelopOverlay(resize.container)
        ? Math.sqrt(scales.scaleX * scales.scaleY) : null;
      const nextX = uniform ?? scales.scaleX;
      const nextY = uniform ?? scales.scaleY;
      let snappedX = nextX, snappedY = nextY;
      if (event.metaKey || event.ctrlKey) {
        resize.snapX = null; resize.snapY = null; hideSnapGuides();
      } else {
        const movingItem = { kind: resize.container.dataset.role === 'shape' ? 'shape' : 'html',
          id: resize.overlayId };
        const telop = isTelopOverlay(resize.container);
        const solved = telop ? computeScaleSnap({ scale: nextX,
          at: value => { applyAxisResize(resize, value, value);
            return fragmentVideoBounds(resize.container); },
          previous: { x: resize.snapX, y: resize.snapY }, movingItem,
          initialBounds: resize.startBounds,
          movingEdges: { x: resize.corner?.includes('w') ? 0 : 2,
            y: resize.corner?.includes('n') ? 0 : 2 }, clamp: clampScale })
          : computeAnchorResizeSnap({ anchorStageX: resize.anchorStageX,
            anchorStageY: resize.anchorStageY, draggedStageX: resize.draggedStageX,
            draggedStageY: resize.draggedStageY, startScale: 1,
            scale: nextX / resize.startScaleX, startBounds: resize.startBounds,
            snapX: resize.snapX, snapY: resize.snapY, movingItem });
        if (solved) {
          snappedX = telop ? solved.scale : resize.startScaleX * solved.scale;
          snappedY = telop ? solved.scale : resize.startScaleY * solved.scale;
          resize.snapX = solved.snapX; resize.snapY = solved.snapY;
        }
      }
      applyAxisResize(resize, snappedX, snappedY);
      resize.moved = Math.abs(snappedX - resize.startScaleX) > 1e-6
        || Math.abs(snappedY - resize.startScaleY) > 1e-6;
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (!resize.group && resize.edge && !isTelopOverlay(resize.container)) {
      updateAxisResize(resize, event, pointer);
      return;
    }
    const currentDistance = Math.hypot(
      pointer.x + (resize.pointerOffsetX ?? 0) - resize.anchorStageX,
      pointer.y + (resize.pointerOffsetY ?? 0) - resize.anchorStageY
    );
    if (!Number.isFinite(currentDistance)) return;

    let nextScale = resize.startScale * (currentDistance / resize.startDistance);
    nextScale = clampScale(nextScale);
    if (Math.abs(nextScale - 1) <= SCALE_SNAP_TOLERANCE) nextScale = 1;

    if (resize.group) {
      if (event.metaKey || event.ctrlKey) {
        resize.snapX = null; resize.snapY = null; hideSnapGuides();
      } else {
        const snapped = applyResizeSnap(resize, nextScale);
        if (snapped !== null) nextScale = snapped;
      }
      const position = anchorPreservingTranslate({ startX: resize.oldPose.x,
        startY: resize.oldPose.y, startScale: resize.startScale, scale: nextScale,
        anchorStageX: resize.anchorStageX, anchorStageY: resize.anchorStageY });
      if (!position) return;
      groupPoseAt(resize, { ...resize.oldPose, ...position, scale: nextScale });
      resize.moved = Math.abs(nextScale - resize.startScale) > 1e-6;
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (!applyResizeTransformAt(resize, nextScale)) return;

    if (event.metaKey || event.ctrlKey) {
      resize.snapX = null;
      resize.snapY = null;
      hideSnapGuides();
    } else {
      const snappedScale = applyResizeSnap(resize, nextScale);
      if (snappedScale !== null) {
        applyResizeTransformAt(resize, snappedScale);
      }
    }

    resize.moved = true;
    if (event.cancelable) event.preventDefault();
  }

  function cancelResize() {
    if (!activeResize) return;

    const resize = activeResize;
    if (resize.element) {
      activeResize = null;
      cancelElementGesture(resize);
      return;
    }
    reportLiveValues(resize.overlayId, undefined, true);
    activeResize = null;
    handleHint?.remove(); handleHint = null;
    if (resize.group) {
      releaseResizePointer(resize);
      hideSnapGuides();
      restoreGroupPose(resize);
      return;
    }
    resize.container.style.setProperty("--x", `${resize.startX}px`);
    resize.container.style.setProperty("--y", `${resize.startY}px`);
    resize.container.style.setProperty("--scale", String(resize.startScale));
    ["--scale-x", "--scale-y"].forEach((css, index) => {
      if (resize.axisCss[index]) resize.container.style.setProperty(css, resize.axisCss[index]);
      else resize.container.style.removeProperty(css);
    });
    releaseResizePointer(resize);
    hideSnapGuides();
    refreshSelectionFrame();
  }

  function finishResize() {
    if (!activeResize) return null;

    const resize = activeResize;
    activeResize = null;
    if (resize.element) return finishElementGesture(resize,
      resize.name.length === 2 ? ['width', 'height'] : ['n', 's'].includes(resize.name) ? ['height'] : ['width']);
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(resize);
    hideSnapGuides();

    if (resize.group) {
      if (!resize.moved) { restoreGroupPose(resize); return null; }
      return finishGroupTransform(resize);
    }

    if (!resize.moved) return null;

    const transform = readTransform(resize.container);
    if (resize.edge === 'e' || resize.edge === 'w') {
      if (!resize.axisCss[1]) delete transform.scaleY;
    } else if (resize.edge && !resize.axisCss[0]) {
      delete transform.scaleX;
    }
    if (transform.scaleX !== undefined && transform.scaleX === transform.scaleY) {
      transform.scale = transform.scaleX;
      delete transform.scaleX;
      delete transform.scaleY;
    }
    const record = enqueueWrite(
      resize.writeContext,
      resize.overlayId,
      { transform },
      "transform"
    );
    syncLeafTransformOnSuccess(record, resize.overlayId, transform);
    lastTransformWrite = record;
    return record;
  }

  function eventHitsElement(event, element) {
    if (event.target instanceof Node && element.contains(event.target)) {
      return true;
    }

    const rect = element.getBoundingClientRect();
    return (
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY) &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function onPointerDown(event) {
    if (!interactionEnabled || !canBeginPointerInteraction(pointerOwner)) return;
    event = correctedHitPolicyEvent(event);
    if (event.button !== 0 || activeDrag || activeResize || activeRotate || activeLine) return;
    if (selectedId && stage && event.target instanceof Element) {
      const bounds = stage.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      const protectedTarget = event.target.closest('button, [role="button"], input, textarea, select, a[href], '
        + '[data-akari-interaction], [data-akari-ui="preview-scope-breadcrumb"], '
        + '.caption-row-plate, #caption-select-box, #layer-select-box, #cut-select-box, '
        + '.transport-controls, [role="menu"]');
      if (outside && !protectedTarget) { clearSelection(); publishScopedSelection(); return; }
    }
    flushNudge();
    hideHover();
    clickOrigin = { selectedId, scopeId, moved: false, hadMultiple: selectedIds.length > 1 };

    if (event.target instanceof Element && event.target.closest('[data-akari-ui="preview-scope-breadcrumb"]')) return;
    if (selectionTree().length) {
      const handle = findHandleElement(event.target);
      if (handle) {
        if (selectedIds.length > 1) return;
        if (handle.classList.contains('is-line-start') || handle.classList.contains('is-line-end')) {
          beginLineEndpoint(event, handle); return;
        }
        if (groupSelection) {
          if (handle.classList.contains('is-rotate')) beginRotate(event, handle);
          else if (handle.classList.contains('is-move')) beginGroupDrag(event, selectedOverlay);
          else beginGroupResize(event, handle);
        } else if (isMovable(selectedOverlay)) {
          if (handle.classList.contains('is-rotate')) beginRotate(event, handle);
          else if (handle.classList.contains('is-move')) beginLeafDrag(event, selectedOverlay);
          else beginResize(event, selectedOverlay, handle);
        }
        return;
      }
      const hit = overlayForEvent(event);
      const stageRect = stage?.getBoundingClientRect();
      const insideStage = stageRect && event.clientX >= stageRect.left && event.clientX <= stageRect.right
        && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom;
      const fallbackBlank = insideStage && !activeEdit
        && !(event.target instanceof Element && event.target.closest('button, [role="button"], input, textarea, select, a[href], [data-akari-interaction]'));
      const canMarquee = !isSelectable(hit) && !event.altKey && (window.akari.shouldStartPreviewMarquee
        ? window.akari.shouldStartPreviewMarquee(event) : fallbackBlank);
      if (!isSelectable(hit) && (canMarquee || insideStage)) {
        const bag = treeNode(scopeId);
        pendingBlank = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          shift: event.shiftKey, scopeId, marquee: canMarquee, release: Boolean(insideStage),
          bagExit: bag?.kind === 'bag' && bag.lazy
            && scopeId !== floorScopeId ? bag.parentId : undefined, started: false, hits: [] };
        return;
      }
      if (!isSelectable(hit)) {
        return;
      }
      if (activeEdit?.container === hit && eventHitsElement(event, activeEdit.element)) return;
      clickOrigin.scopedHit = true;
      if (activeEdit) void commitEdit();
      if (window.akari.capabilities?.elementSelection === true && event.isTrusted && !event.shiftKey) {
        const root = fragmentRoot(hit);
        const target = event.target instanceof Element && root?.contains(event.target)
          ? nearestSelectableElement(root, event.target, stage?.getBoundingClientRect(), selectionOptions(root)) : null;
        clickOrigin.hitId = hit.dataset.overlayId;
        clickOrigin.elementRef = target ? elementAddress(root, target) : null;
      }
      const next = resolveScopedSelection(selectionTree(), scopeId, scopedHitId(hit, event),
        { deep: Boolean(event.metaKey || event.ctrlKey) });
      // Preserve the set while pressing an already selected sibling, so a plain
      // drag moves the set. A stationary click collapses it in onClick.
      const keepSet = selectedIds.length > 1 && !event.shiftKey && !event.metaKey && !event.ctrlKey
        && next.scopeId === scopeId && selectedIds.includes(next.selectId);
      if (!keepSet && !selectScopedHit(hit, event)) return;
      if (collectiveSelection()) { beginGroupDrag(event, hit); return; }
      if (!selectedOverlay || (window.akari.capabilities?.elementSelection === true
        ? selectedId !== hit.dataset.overlayId : selectedOverlay !== hit)) return;
      if (!event.shiftKey) {
        const focused = focusedElement();
        if (focused && isSelectionContainer(focused) && focused.contains(event.target)) {
          clickOrigin.preservedContainer = true;
        } else if (clickOrigin?.hitId === selectedId) {
          focusElement(elementByAddress(fragmentRoot(selectedOverlay), clickOrigin.elementRef));
        } else focusElementAt(selectedOverlay, event);
      } else if (selectedElementFocus()) focusElement(null);
      if (window.akari.capabilities?.elementSelection === true && clickOrigin) {
        clickOrigin.hitId = selectedId;
        clickOrigin.elementRef = selectedElementFocus()?.ref ?? null;
      }
      // Continue the existing leaf drag with the already-resolved container.
    }
    const handleEl = findHandleElement(event.target);
    if (handleEl) {
      if (!isMovable(selectedOverlay)) return;
      if (handleEl.classList.contains('is-line-start') || handleEl.classList.contains('is-line-end')) {
        beginLineEndpoint(event, handleEl); return;
      }
      if (handleEl.classList.contains('is-rotate')) beginRotate(event, handleEl);
      else if (handleEl.classList.contains('is-move')) beginLeafDrag(event, selectedOverlay);
      else beginResize(event, selectedOverlay, handleEl);
      return;
    }

    const container = overlayForEvent(event);
    if (!isSelectable(container)) {
      if (selectedOverlay && stage && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const stageRect = stage.getBoundingClientRect();
        if (event.clientX >= stageRect.left && event.clientX <= stageRect.right
          && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom) {
          if (activeEdit) void commitEdit();
          clearSelection();
        }
      }
      return;
    }

    selectOverlay(container);
    if (!event.shiftKey) {
      const focused = focusedElement();
      if (focused && isSelectionContainer(focused) && focused.contains(event.target)) {
        clickOrigin.preservedContainer = true;
      } else focusElementAt(container, event);
    }
    else if (selectedElementFocus()) focusElement(null);
    if (window.akari.capabilities?.elementSelection === true && clickOrigin) {
      clickOrigin.hitId = selectedId;
      clickOrigin.elementRef = selectedElementFocus()?.ref ?? null;
    }

    if (
      activeEdit?.container === container &&
      eventHitsElement(event, activeEdit.element)
    ) {
      return;
    }

    if (activeEdit) void commitEdit();

    // 背景（role==="background"）は選択できるが動かせない。選択はここまでで完了させ、
    // ドラッグは開始しない（isSelectable のみで isMovable を通さないと、選択直後に
    // pointermove が来た瞬間 activeDrag が動き出してしまう）。
    if (!isMovable(container)) return;

    beginLeafDrag(event, container);
  }

  function beginLeafDrag(event, container) {
    if (!container || !isMovable(container)) return;
    if (elementFocus && selectedOverlay === container && focusedElement()) {
      const element = focusedElement();
      const rect = element.getBoundingClientRect();
      const originalInline = element.style.translate;
      const source = window.akari.state?.summary?.overlays?.find(overlay => overlay.id === selectedId);
      const declared = source?.elements?.[elementFocus.ref]?.style?.translate;
      const computed = getComputedStyle(element).translate;
      const initial = parseElementTranslate(declared ?? computed);
      activeDrag = { element, elementRef: elementFocus.ref, elementTag: elementFocus.tag, container,
        overlayId: selectedId, pointerId: event.pointerId, startClientX: event.clientX,
        startClientY: event.clientY, startCenterX: rect.left + rect.width / 2,
        startCenterY: rect.top + rect.height / 2, startX: initial.x, startY: initial.y,
        x: initial.x, y: initial.y,
        originalInline, moved: false, writeContext: captureWriteContext() };
      if (getComputedStyle(element).display === 'inline') {
        activeDrag.originalDisplay = element.style.display;
        element.style.display = 'inline-block';
        moveElementToCenter(activeDrag, activeDrag.startCenterX, activeDrag.startCenterY);
      }
      try { container.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
      return;
    }
    const transform = readTransform(container);
    window.akari.reportGesture?.('begin');
    const motionDriven = container.dataset.akariMotionDriven === 'true';
    if (motionDriven) container.dataset.akariMotionDragging = 'true';
    activeDrag = {
      container,
      overlayId: container.dataset.overlayId ?? "",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startStagePoint: stageLocalPoint(event.clientX, event.clientY),
      startX: transform.x,
      startY: transform.y,
      snapX: null,
      snapY: null,
      snapMotion: beginSnapMotion(fragmentVideoBounds(container)),
      moved: false,
      duplicate: event.altKey,
      motionDriven,
      writeContext: captureWriteContext(),
    };
    hideSnapGuides();

    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      // synthetic drag は window 側の move/up リスナーで継続する。
    }
  }

  function clearDragSettleTimer(drag) {
    if (drag?.settleTimer != null && typeof clearTimeout === 'function') clearTimeout(drag.settleTimer);
    if (drag) drag.settleTimer = null;
  }

  function scheduleDragSettle(drag, event, settled) {
    if (settled || typeof setTimeout !== 'function') return;
    drag.settleTimer = setTimeout(() => {
      drag.settleTimer = null;
      if (activeDrag === drag) onPointerMove(event, true);
    }, 96);
  }

  function onPointerMove(event, settled = false) {
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) {
      const dx = event.clientX - pendingBlank.x, dy = event.clientY - pendingBlank.y;
      if (!pendingBlank.started && dx * dx + dy * dy > dragStartDistance * dragStartDistance) {
        if (clickOrigin) clickOrigin.moved = true;
        if (!pendingBlank.marquee) clearMarquee();
        else {
          pendingBlank.started = true;
          if (activeEdit) void commitEdit();
        }
      }
      if (pendingBlank?.started) {
        updateMarquee(event);
        if (event.cancelable) event.preventDefault();
        return;
      }
    }
    scheduleHover(event);
    if (activeLine && event.pointerId === activeLine.pointerId) {
      updateLineEndpoint(event); return;
    }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      updateRotate(event);
      reportLivePose(activeRotate);
      return;
    }
    if (activeResize && event.pointerId === activeResize.pointerId) {
      updateResize(event);
      reportLivePose(activeResize);
      return;
    }

    const drag = activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDragSettleTimer(drag);

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    if (
      !drag.moved &&
      deltaX * deltaX + deltaY * deltaY < dragStartDistance * dragStartDistance
    ) {
      return;
    }

    drag.moved = true;
    if (clickOrigin) clickOrigin.moved = true;
    if (drag.element) {
      moveElementToCenter(drag, drag.startCenterX + deltaX, drag.startCenterY + deltaY);
      refreshSelectionFrame();
      if (event.cancelable) event.preventDefault();
      return;
    }
    // 始点と現在点をその時点の舞台矩形で動画座標へ戻す。ズーム・全画面切替が
    // ドラッグ中に入っても、stale な倍率で --x/--y を計算しない。
    const currentStagePoint = stageLocalPoint(event.clientX, event.clientY);
    const scale = stageScaleFactor();
    const videoDeltaX =
      drag.startStagePoint && currentStagePoint
        ? currentStagePoint.x - drag.startStagePoint.x
        : deltaX / scale;
    const videoDeltaY =
      drag.startStagePoint && currentStagePoint
        ? currentStagePoint.y - drag.startStagePoint.y
        : deltaY / scale;
    const lockedAxis = event.shiftKey
      ? Math.abs(videoDeltaX) >= Math.abs(videoDeltaY) ? 'x' : 'y' : null;
    if (drag.group) {
      const locked = globalThis.akariHandleGeometry?.axisLock(videoDeltaX, videoDeltaY, event.shiftKey)
        ?? (event.shiftKey && Math.abs(videoDeltaX) >= Math.abs(videoDeltaY)
          ? { x: videoDeltaX, y: 0 }
          : event.shiftKey ? { x: 0, y: videoDeltaY } : { x: videoDeltaX, y: videoDeltaY });
      moveGroupDrag(drag, locked.x, locked.y, event.metaKey || event.ctrlKey, lockedAxis);
      reportLivePose(drag);
      scheduleDragSettle(drag, event, settled);
      if (event.cancelable) event.preventDefault();
      return;
    }
    const locked = globalThis.akariHandleGeometry?.axisLock(videoDeltaX, videoDeltaY, event.shiftKey)
      ?? (event.shiftKey && Math.abs(videoDeltaX) >= Math.abs(videoDeltaY)
        ? { x: videoDeltaX, y: 0 }
        : event.shiftKey ? { x: 0, y: videoDeltaY } : { x: videoDeltaX, y: videoDeltaY });
    applyDragSnapping(
      drag,
      drag.startX + locked.x,
      drag.startY + locked.y,
      event.metaKey || event.ctrlKey,
      lockedAxis
    );
    reportLivePose(drag);
    scheduleDragSettle(drag, event, settled);

    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event) {
    if (activeLine && event.pointerId === activeLine.pointerId) {
      finishLineEndpoint(); return;
    }
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) {
      const dx = event.clientX - pendingBlank.x, dy = event.clientY - pendingBlank.y;
      if (!pendingBlank.started && dx * dx + dy * dy > dragStartDistance * dragStartDistance) {
        if (clickOrigin) clickOrigin.moved = true;
        if (!pendingBlank.marquee) clearMarquee();
        else pendingBlank.started = true;
      }
      if (pendingBlank) { finishMarquee(event); return; }
    }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      finishRotate();
      return;
    }
    if (activeResize && event.pointerId === activeResize.pointerId) {
      finishResize();
      return;
    }
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    clearDragSettleTimer(activeDrag);
    if (activeDrag.moved && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      onPointerMove(event, true);
    }
    finishDrag();
  }

  function onPointerCancel(event) {
    if (activeLine && event.pointerId === activeLine.pointerId) {
      finishLineEndpoint(true); return;
    }
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) { clearMarquee(); return; }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      cancelRotate();
      return;
    }
    if (activeResize && event.pointerId === activeResize.pointerId) {
      cancelResize();
      return;
    }
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    cancelDrag();
  }

  function hasDirectText(element) {
    return Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
  }

  // 多層積み断片（overlay-authoring telop.md「多層テキスト断片と data-mirror 規約」）:
  // 縁取り・影・裏打ち等でテキストを複製した層は data-mirror="text" を持つ。
  // これらは直接テキストを持っていても編集候補から除外し、断片ごとに残る唯一の
  // 直接テキスト層（最前面の fill 層）だけが編集対象になるようにする。
  function isMirrorTextLayer(element) {
    return (
      element instanceof Element && element.getAttribute("data-mirror") === "text"
    );
  }

  function canEditText(element) {
    if (!(element instanceof HTMLElement) || !hasDirectText(element)) return false;
    if (isMirrorTextLayer(element)) return false;

    return ![
      "INPUT",
      "NOSCRIPT",
      "SCRIPT",
      "STYLE",
      "TEMPLATE",
      "TEXTAREA",
    ].includes(element.tagName);
  }

  function textElementAt(container, event) {
    const root = fragmentRoot(container);
    if (!root) return null;
    const editingTarget = candidate => {
      const splitHost = window.akari.textSplit?.closestHost?.(candidate);
      return splitHost && root.contains(splitHost) && !isMirrorTextLayer(splitHost)
        ? splitHost : candidate;
    };

    let candidate = event.target instanceof Element ? event.target : null;
    while (candidate && candidate !== container) {
      if (root.contains(candidate) && canEditText(candidate)) return editingTarget(candidate);
      if (candidate === root) break;
      candidate = candidate.parentElement;
    }

    // pointer-events:none の断片でも、描画矩形からテキスト要素を見つける。
    const elements = [root, ...root.querySelectorAll("*")];
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index];
      if (!canEditText(element)) continue;

      const rect = element.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return editingTarget(element);
      }
    }

    return null;
  }

  // ミラー同期のスコープ特定: 編集層の直近の祖先のうち、data-mirror="text" 層を
  // 子孫に持つ最初のもの。既定は編集層の親要素（PoC 由来の積層断片は fill 層と
  // ミラー層が同じ積層コンテナ = 親要素の直下に並ぶ — telop.md 参照）。container
  // （[data-overlay-id]）を超えて他のオーバーレイ側へは探しに行かない。
  function mirrorSyncScope(container, element) {
    let scope = element.parentElement;
    while (scope && scope !== container) {
      if (scope.querySelector('[data-mirror="text"]')) return scope;
      scope = scope.parentElement;
    }
    return element.parentElement;
  }

  // 編集層の textContent を同一 stack 内の全ミラー層へコピーする（P0-R 契約 §2）。
  // 呼び出し元は input / compositionend のたびに、および保存直前の安全網として
  // commitEdit からも呼ぶ。
  function syncMirrorLayers(container, element) {
    const scope = mirrorSyncScope(container, element);
    if (!scope) return;

    const mirrors = scope.querySelectorAll('[data-mirror="text"]');
    if (!mirrors.length) return;

    const text = element.textContent ?? "";
    for (const mirror of mirrors) {
      if (mirror.textContent !== text) mirror.textContent = text;
    }
  }

  function slotNameForElement(element) {
    if (!(element instanceof Element)) return null;
    const name = element.getAttribute("data-akari-slot");
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  function syncSlotInstances(container, element, slotName) {
    if (!slotName) return;
    const text = element.textContent ?? "";
    for (const slot of container.querySelectorAll("[data-akari-slot]")) {
      if (slot !== element && slot.getAttribute("data-akari-slot") === slotName) {
        slot.textContent = text;
      }
    }
  }

  function restoreAttribute(element, name, hadAttribute, value) {
    if (hadAttribute) {
      element.setAttribute(name, value);
    } else {
      element.removeAttribute(name);
    }
  }

  function serializeFragment(container) {
    const root = fragmentRoot(container);
    if (!root) throw new Error("オーバーレイ断片のルート要素がありません");

    const clone = root.cloneNode(true);
    restoreHitPolicyStyles(clone, root);
    clone.removeAttribute("data-akari-interaction");
    clone.removeAttribute("data-akari-interaction-editing");
    for (const element of clone.querySelectorAll("[data-akari-interaction]")) {
      element.remove();
    }
    for (const element of clone.querySelectorAll(
      "[data-akari-interaction-editing]"
    )) {
      element.removeAttribute("data-akari-interaction-editing");
    }

    return clone.outerHTML;
  }

  function cancelEdit() {
    if (!activeEdit) return;
    const edit = activeEdit;
    // Clear before blur: cancellation must never enter the commit/write path.
    activeEdit = null;
    stopEditCaret();
    for (const snapshot of edit.originalContents) {
      snapshot.element.innerHTML = snapshot.html;
      restoreAttribute(snapshot.element, "data-akari-split-units",
        snapshot.hadSplitUnits, snapshot.splitUnits);
    }
    restoreAttribute(edit.element, "contenteditable",
      edit.hadContentEditable, edit.contentEditableValue);
    restoreAttribute(edit.element, "spellcheck", edit.hadSpellcheck, edit.spellcheckValue);
    restoreAttribute(edit.element, "data-akari-interaction-editing",
      edit.hadEditingMarker, edit.editingMarkerValue);
    if (document.activeElement === edit.element) edit.element.blur();
    invalidateOverlayHitPolicy(edit.container);
    applyOverlayHitPolicy(edit.container);
    syncOverlayHitRegion(edit.container);
    refreshSelectionFrame();
  }

  function commitEdit({ blur = true } = {}) {
    if (!activeEdit) return Promise.resolve(undefined);

    const edit = activeEdit;
    activeEdit = null;
    stopEditCaret();

    const restoreOriginalContents = () => {
      for (const snapshot of edit.originalContents) {
        snapshot.element.innerHTML = snapshot.html;
        restoreAttribute(snapshot.element, "data-akari-split-units",
          snapshot.hadSplitUnits, snapshot.splitUnits);
      }
      invalidateOverlayHitPolicy(edit.container);
      applyOverlayHitPolicy(edit.container);
      syncOverlayHitRegion(edit.container);
    };

    if ((edit.element.textContent ?? "") === edit.originalText) {
      restoreOriginalContents();
      restoreAttribute(edit.element, "contenteditable",
        edit.hadContentEditable, edit.contentEditableValue);
      restoreAttribute(edit.element, "spellcheck", edit.hadSpellcheck, edit.spellcheckValue);
      restoreAttribute(edit.element, "data-akari-interaction-editing",
        edit.hadEditingMarker, edit.editingMarkerValue);
      if (blur && document.activeElement === edit.element) edit.element.blur();
      return Promise.resolve(undefined);
    }

    const restoreOnWriteFailure = promise => {
      promise.catch(() => {
        if (activeEdit?.container !== edit.container) restoreOriginalContents();
      });
      return promise;
    };

    // source.text replaces the whole named part. A nested/ancestor/unrelated
    // text element must never flatten that structure or serialize its mask.
    // Slots keep their existing params route, including inside a part overlay.
    if (edit.part && !edit.slotName && edit.element !== edit.partElement) {
      edit.fragment.replaceWith(edit.originalFragment);
      invalidateOverlayHitPolicy(edit.container);
      applyOverlayHitPolicy(edit.container);
      syncOverlayHitRegion(edit.container);
      const error = new Error("この部品は文字を 1 つだけ持つ形にしてください");
      reportWriteError("text", edit.overlayId, error);
      window.akari.showWriteError?.(error);
      const failure = Promise.reject(error);
      failure.catch(() => undefined);
      return failure;
    }

    // 保存直前の安全網: input/compositionend を取りこぼした場合でも、確定した
    // 編集層のテキストで全ミラー層を同期してから書き出す（P0-R 契約 §3）。
    syncMirrorLayers(edit.container, edit.element);

    // 編集開始時に畳んだテキスト分割を、確定したテキストで分割し直す（--i を振り直す）。
    // ミラー同期の後に行う（ミラー層は素のテキストを保つ）。
    if (edit.splitHost) window.akari.textSplit?.apply?.(edit.splitHost);

    restoreAttribute(
      edit.element,
      "contenteditable",
      edit.hadContentEditable,
      edit.contentEditableValue
    );
    restoreAttribute(
      edit.element,
      "spellcheck",
      edit.hadSpellcheck,
      edit.spellcheckValue
    );
    restoreAttribute(
      edit.element,
      "data-akari-interaction-editing",
      edit.hadEditingMarker,
      edit.editingMarkerValue
    );

    if (blur && document.activeElement === edit.element) edit.element.blur();

    // テキスト編集で描画要素が変わり得るため、pointer-events 規約を適用し直す。
    invalidateOverlayHitPolicy(edit.container);
    applyOverlayHitPolicy(edit.container);
    syncOverlayHitRegion(edit.container);

    if (edit.slotName) {
      const record = enqueueWrite(
        edit.writeContext,
        edit.overlayId,
        { params: { [edit.slotName]: edit.element.textContent ?? "" } },
        "params"
      );
      return restoreOnWriteFailure(record.promise);
    }

    if (edit.part) {
      const record = enqueueWrite(
        edit.writeContext,
        edit.overlayId,
        { text: edit.element.textContent ?? "" },
        "text"
      );
      return restoreOnWriteFailure(record.promise);
    }

    let html;
    try {
      html = serializeFragment(edit.container);
    } catch (error) {
      restoreOriginalContents();
      reportWriteError("html", edit.overlayId, error);
      const failure = Promise.reject(error);
      failure.catch(() => undefined);
      return failure;
    }

    const record = enqueueWrite(
      edit.writeContext,
      edit.overlayId,
      { html },
      "html"
    );
    return restoreOnWriteFailure(record.promise);
  }

  function updateEditCaret() {
    if (!editCaret || !activeEdit) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed) {
      editCaret.style.display = 'none';
      return;
    }
    const range = selection.getRangeAt(0);
    if (!activeEdit.element.contains(range.startContainer)) {
      editCaret.style.display = 'none';
      return;
    }

    let rect = range.getClientRects()[0];
    if (!rect || (!rect.width && !rect.height)) rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      const parent = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement : range.startContainer;
      const parentRect = parent?.getBoundingClientRect?.();
      if (!parentRect?.height) {
        editCaret.style.display = 'none';
        return;
      }
      rect = { left: range.startOffset ? parentRect.right : parentRect.left,
        top: parentRect.top, height: parentRect.height };
    }
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !rect.height) {
      editCaret.style.display = 'none';
      return;
    }

    editCaret.style.left = `${rect.left}px`;
    editCaret.style.top = `${rect.top}px`;
    editCaret.style.height = `${rect.height}px`;
    editCaret.style.display = 'block';
    editCaretAnimation?.cancel();
    editCaretAnimation = editCaret.animate?.([
      { opacity: 1 }, { opacity: 1, offset: .5 },
      { opacity: 0, offset: .5001 }, { opacity: 0 },
    ], { duration: 1060, iterations: Infinity }) ?? null;
  }

  function stopEditCaret() {
    if (typeof document.removeEventListener !== 'function') return;
    document.removeEventListener('selectionchange', updateEditCaret);
    document.removeEventListener('compositionupdate', updateEditCaret, true);
    window.removeEventListener('resize', updateEditCaret);
    window.removeEventListener('scroll', updateEditCaret, true);
    editCaretAnimation?.cancel();
    editCaretAnimation = null;
    editCaret?.remove();
    editCaret = null;
  }

  function startEditCaret() {
    stopEditCaret();
    // Keep this UI node outside the fragment so serialization cannot save it.
    editCaret = document.createElement('div');
    editCaret.className = 'akari-interaction-edit-caret';
    editCaret.setAttribute('data-akari-interaction', 'edit-caret');
    editCaret.style.cssText = 'position:fixed;width:2px;background:#4dbeff;box-shadow:0 0 0 1px rgba(0,0,0,.55);pointer-events:none;z-index:2147483647;display:none;';
    document.body.appendChild(editCaret);
    document.addEventListener('selectionchange', updateEditCaret);
    document.addEventListener('compositionupdate', updateEditCaret, true);
    window.addEventListener('resize', updateEditCaret);
    window.addEventListener('scroll', updateEditCaret, true);
    updateEditCaret();
  }

  function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtPoint(element, x, y) {
    const selection = window.getSelection();
    if (!selection || !Number.isFinite(x) || !Number.isFinite(y)) return false;

    const positions = [];
    try {
      const position = document.caretPositionFromPoint?.(x, y);
      if (position) positions.push([position.offsetNode, position.offset]);
    } catch {
      // Continue with the other browser API.
    }
    try {
      const range = document.caretRangeFromPoint?.(x, y);
      if (range) positions.push([range.startContainer, range.startOffset]);
    } catch {
      // Geometry remains available when caret hit testing is unsupported.
    }
    for (const [node, offset] of positions) {
      if (!node || !element.contains(node)) continue;
      try {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      } catch {
        // A stale point can describe a node that was removed by split collapse.
      }
    }

    // Use the edited text's own glyph boxes when hit testing chooses another layer.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let nearest = null;
    let textNode;
    while ((textNode = walker.nextNode())) {
      const value = textNode.textContent ?? '';
      const rtl = getComputedStyle(textNode.parentElement).direction === 'rtl';
      for (let index = 0; index < value.length; index++) {
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        for (const rect of range.getClientRects()) {
          if (!rect.width && !rect.height) continue;
          const above = Math.max(rect.top - y, 0, y - rect.bottom);
          for (const [boundary, edge] of [[index, rtl ? rect.right : rect.left], [index + 1, rtl ? rect.left : rect.right]]) {
            const distance = Math.hypot(edge - x, above);
            if (!nearest || distance < nearest.distance) nearest = { node: textNode, offset: boundary, distance };
          }
        }
      }
    }
    if (!nearest) return false;
    range.setStart(nearest.node, nearest.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function beginEdit(container, element, point) {
    flushNudge();
    hideHover();
    if (activeEdit?.element === element) {
      element.focus({ preventScroll: true });
      return;
    }
    if (activeEdit) void commitEdit();

    // Capture before split collapse or input synchronization. Keep each mirror
    // and slot's own markup, even when its initial text differs from the editor.
    const splitHost = window.akari.textSplit?.closestHost?.(element);
    const slotName = slotNameForElement(element);
    const affected = new Set([element, ...(splitHost ? [splitHost] : []),
      ...(mirrorSyncScope(container, element)?.querySelectorAll('[data-mirror="text"]') ?? []),
      ...[...container.querySelectorAll('[data-akari-slot]')]
        .filter(slot => slotName && slot.getAttribute('data-akari-slot') === slotName)]);
    const originalContents = [...affected]
      .filter(candidate => ![...affected].some(parent => parent !== candidate && parent.contains(candidate)))
      .map(candidate => {
        const clone = candidate.cloneNode(true);
        restoreHitPolicyStyles(clone, candidate);
        return { element: candidate, html: clone.innerHTML,
          hadSplitUnits: candidate.hasAttribute('data-akari-split-units'),
          splitUnits: candidate.getAttribute('data-akari-split-units') ?? '' };
      });
    activeEdit = {
      originalContents,
      originalText: element.textContent ?? "",
      container,
      element,
      overlayId: container.dataset.overlayId ?? "",
      hadContentEditable: element.hasAttribute("contenteditable"),
      contentEditableValue: element.getAttribute("contenteditable") ?? "",
      hadSpellcheck: element.hasAttribute("spellcheck"),
      spellcheckValue: element.getAttribute("spellcheck") ?? "",
      hadEditingMarker: element.hasAttribute("data-akari-interaction-editing"),
      editingMarkerValue:
        element.getAttribute("data-akari-interaction-editing") ?? "",
      slotName: slotNameForElement(element),
      writeContext: captureWriteContext(),
    };

    const part = window.akari.state?.summary?.overlays?.find(
      overlay => overlay.id === activeEdit.overlayId
    )?.part;
    if (typeof part === "string" && part && !activeEdit.slotName) {
      const fragment = fragmentRoot(container);
      activeEdit.part = part;
      activeEdit.partElement = [fragment, ...fragment.querySelectorAll("[data-akari-part]")]
        .find(candidate => candidate.getAttribute("data-akari-part") === part);
      activeEdit.fragment = fragment;
      // Snapshot before split collapse, mirror synchronization, or any typing.
      // Remove injected hit styles so the restored clone can acquire its own
      // hit-policy bookkeeping instead of treating them as author CSS.
      activeEdit.originalFragment = fragment.cloneNode(true);
      restoreHitPolicyStyles(activeEdit.originalFragment, fragment);
    }

    // テキスト分割断片（data-akari-split）は編集中だけ素のテキストへ畳む。
    // <span class="akari-u"> のまま contenteditable にすると、打鍵で span が
    // 割れる・消える・キャレットが単位境界で飛ぶ、といった壊れ方をするため。
    // 確定時（commitEdit）に分割し直す（contract-2026-08-15-telop-motion-grammar-v0 §4）。
    if (splitHost) {
      activeEdit.splitHost = splitHost;
      window.akari.textSplit.collapse(splitHost);
    }

    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "false");
    element.setAttribute("data-akari-interaction-editing", "true");
    element.focus({ preventScroll: true });
    if (!point || !placeCaretAtPoint(element, point.x, point.y)) placeCaretAtEnd(element);
    startEditCaret();
  }

  function onClick(event) {
    if (!interactionEnabled || activeEdit) return;
    event = correctedHitPolicyEvent(event);
    const hit = overlayForEvent(event);
    // pointerdown already toggled. Do not toggle twice or update the cycle clock.
    if (event.shiftKey && clickOrigin?.scopedHit) {
      event.stopPropagation(); clickOrigin = null; return;
    }
    // The shell's forced stage-click report would duplicate the representative
    // notification already published by this set transition. Leave UI clicks alone.
    if (isSelectable(hit) && (selectedIds.length > 1 || clickOrigin?.hadMultiple)) event.stopPropagation();
    if (clickOrigin?.moved) { clickOrigin = null; lastClick = null; return; }
    if (!isSelectable(hit)) { if (!event.shiftKey) lastClick = null; return; }
    const now = performance.now();
    const origin = clickOrigin ?? { selectedId, scopeId };
    const canCycle = event.detail === 1 && !event.shiftKey && !event.metaKey && !event.ctrlKey
      && !event.altKey && !origin.moved && lastClick && lastClick.scopeId === scopeId
      && origin.scopeId === scopeId && now - lastClick.time <= 600
      && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= 6;
    const nextId = canCycle ? nextCycleCandidate(cycleCandidates(event), origin.selectedId) : null;
    if (nextId) applyScopedSelection({ selectId: nextId, scopeId });
    else if (selectionTree().length) selectScopedHit(hit, event);
    else selectOverlay(hit);
    if (window.akari.capabilities?.elementSelection === true
      && event.isTrusted && !event.shiftKey && selectedOverlay) {
      if (clickOrigin?.preservedContainer) focusElementAt(selectedOverlay, event);
      else if (!nextId && clickOrigin?.hitId === selectedId) {
        focusElement(elementByAddress(fragmentRoot(selectedOverlay), clickOrigin.elementRef));
      } else focusElementAt(selectedOverlay, event);
    }
    if (event.shiftKey) { clickOrigin = null; return; }
    lastClick = event.detail === 1 && !origin.moved && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
      ? { x: event.clientX, y: event.clientY, scopeId, time: now } : null;
    clickOrigin = null;
  }

  function onDoubleClick(event) {
    if (!interactionEnabled) return;
    lastClick = null;
    hideHover();
    if (selectedIds.length > 1) {
      const hit = overlayForEvent(event);
      if (!isSelectable(hit)) return;
      applyScopedSelection(resolveScopedSelection(selectionTree(), scopeId, scopedHitId(hit, event)));
    }
    if (selectionTree().length && groupSelection) {
      const hit = overlayForEvent(event);
      if (!isSelectable(hit)) return;
      applyScopedSelection(enterScope(selectionTree(), selectedId, scopedHitId(hit, event)));
      event.preventDefault(); event.stopPropagation();
      return;
    }
    const container = overlayForEvent(event);
    if (!isSelectable(container)) return;

    const element = textElementAt(container, event);
    if (!element) return;

    selectOverlay(container);
    beginEdit(container, element, { x: event.clientX, y: event.clientY });
    if (event.cancelable) event.preventDefault();
  }

  function onBlur(event) {
    if (activeEdit && event.target === activeEdit.element) {
      void commitEdit({ blur: false });
    }
  }

  // 文字確定（input）/ IME 確定（compositionend）のたびにミラー層へ同期する
  // （P0-R 契約 §2）。IME 変換中の中間状態も input が発火する環境ではそのまま
  // コピーしてよい（ミラー層は mount() が aria-hidden="true" を付与済み）。
  function onEditableInput(event) {
    if (!activeEdit || event.target !== activeEdit.element) return;
    syncMirrorLayers(activeEdit.container, activeEdit.element);
    syncSlotInstances(
      activeEdit.container,
      activeEdit.element,
      activeEdit.slotName
    );
    updateEditCaret();
  }

  function onKeyDown(event) {
    if (!canBeginPointerInteraction(pointerOwner)) return;
    if (event.isComposing) return;
    if (selectedElementFocus() && !activeEdit) {
      const stop = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
      if (event.key === 'Escape' && activeDrag) { cancelDrag(); stop(); return; }
      if (event.key === 'Escape' && activeResize) { cancelResize(); stop(); return; }
      if (event.key === 'Escape' && activeRotate) { cancelRotate(); stop(); return; }
      if (event.key === 'Escape' || event.key === 'Enter' && event.shiftKey) {
        const root = fragmentRoot(selectedOverlay);
        const parent = nearestSelectableElement(root, focusedElement()?.parentElement,
          stage?.getBoundingClientRect(), selectionOptions(root));
        focusElement(parent); stop(); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace'
        || (event.key.toLowerCase() === 'x' && (event.metaKey || event.ctrlKey)))
        && !isControl(event.target) && !isControl(document.activeElement)) {
        window.akari.showWriteError?.('要素は削除できません（Esc でアイテムを選ぶと削除できます）');
        stop(); return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !activeEdit && !selectedElementFocus()
      && selectedOverlay && canFocusElement(selectedOverlay)) {
      const root = fragmentRoot(selectedOverlay);
      const first = firstSelectableElement(root, stage?.getBoundingClientRect(), selectionOptions(root));
      if (first) {
        focusElement(first);
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        return;
      }
    }
    if (handleNudge(event)) return;
    if (selectionTree().length) {
      if (event.key === 'Enter' && event.target instanceof Element
        && event.target.closest('[data-akari-ui="preview-scope-breadcrumb"]')) return;
      const handled = () => {
        event.preventDefault();
        // Theia pre/main.js installs handleInnerKeydown on window in BUBBLE
        // phase (without a defaultPrevented guard). We run in capture phase.
        // stopImmediatePropagation also covers a key targeted at window itself.
        event.stopPropagation(); event.stopImmediatePropagation();
      };
      if (event.key === 'Escape') {
        if (pendingBlank?.started) { clearMarquee(); handled(); return; }
        if (activeDrag) { cancelDrag(); handled(); return; }
        if (activeResize) { cancelResize(); handled(); return; }
        if (activeLine) { finishLineEndpoint(true); handled(); return; }
        if (activeRotate) { cancelRotate(); handled(); return; }
        if (activeEdit) { cancelEdit(); handled(); return; }
        if (selectedIds.length > 1) {
          applyScopedSelection({ selectId: selectedId, scopeId }); handled(); return;
        }
        if (shouldHandleScopeEscape(selectedId, scopeId, floorScopeId)) {
          applyScopedSelection(exitScope(selectionTree(), selectedId, scopeId, floorScopeId), { notify: false });
          handled(); return;
        }
        // Idle at the floor: let Theia forward this key to the timeline,
        // which owns the next (focus-mode) step.
        return;
      }
      if (event.key === 'Enter') {
        if (activeEdit) {
          if (event.target === activeEdit.element) { void commitEdit(); handled(); }
          return;
        }
        if (selectedIds.length > 1) applyScopedSelection({ selectId: selectedId, scopeId });
        if (event.shiftKey && (selectedId !== null || scopeId !== floorScopeId)) {
          applyScopedSelection(exitScope(selectionTree(), selectedId, scopeId, floorScopeId));
          handled(); return;
        }
        if (groupSelection) {
          applyScopedSelection(enterScope(selectionTree(), selectedId)); handled(); return;
        }
        if (selectedOverlay) {
          const root = fragmentRoot(selectedOverlay);
          const text = root && [root, ...root.querySelectorAll('*')].find(canEditText);
          if (text) { beginEdit(selectedOverlay, text); handled(); }
        }
        return;
      }
    }
    if (
      event.key === "Enter" &&
      activeEdit &&
      event.target === activeEdit.element &&
      !event.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void commitEdit();
      return;
    }

    if (
      event.key !== "Escape" ||
      (!selectedOverlay && !activeDrag && !activeResize && !activeEdit)
    ) {
      isolateEditKey(event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (activeDrag) cancelDrag();
    if (activeResize) cancelResize();
    if (activeEdit) { cancelEdit(); event.stopImmediatePropagation(); return; }
    clearSelection();
  }

  function isolateEditKey(event) {
    if (event.isComposing || !activeEdit || event.target !== activeEdit.element) return;
    if (event.type === 'keyup') updateEditCaret();
    // Keep native contenteditable input, deletion, caret motion and shortcuts.
    // Theia forwards keys from window bubble, including keyup used to commit
    // timeline nudges. Only propagation must stop; never preventDefault here.
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function selftest() {
    let container = null;
    let beforeValue = null;
    let beforeText = "n/a";
    let afterText = "n/a";
    let dragWriteResultText = "not-run";
    let resizeWriteResultText = "not-run";
    let resizeDetail = "not-run";
    let resizeSetupTransform = null;
    let resizeWriteCommitted = false;

    try {
      if (!stage) throw new Error("#overlay-stage が見つかりません");
      if (typeof PointerEvent !== "function") {
        throw new Error("PointerEvent を利用できません");
      }
      if (!window.akari.state?.editPath) {
        throw new Error("編集中の edit.json がありません");
      }

      container = firstOverlayContainer();
      if (!container) throw new Error("オーバーレイがありません");
      if (!isSelectable(container)) {
        throw new Error("最初のオーバーレイは表示中ではありません");
      }

      if (activeDrag) cancelDrag();
      if (activeResize) cancelResize();
      if (activeEdit) await commitEdit();
      clearSelection();

      beforeText = cssVariableText(container, "--x") || "(empty)";
      beforeValue = cssVariableNumber(container, "--x", 0);

      const rootRect = fragmentBounds(container);
      const startClientX = Number.isFinite(rootRect?.left)
        ? rootRect.left + rootRect.width / 2
        : 100;
      const startClientY = Number.isFinite(rootRect?.top)
        ? rootRect.top + rootRect.height / 2
        : 100;

      const pointerId = 73013;
      const generationBefore = writeGeneration;
      const dragStageScale = stageScaleFactor();
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
      };

      selftestOverlayOverride = container;
      try {
        container.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: startClientX,
            clientY: startClientY,
          })
        );
        if (selectedOverlay !== container) {
          throw new Error("クリックで選択できませんでした");
        }

        container.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...common,
            buttons: 1,
            clientX: startClientX,
            clientY: startClientY,
          })
        );
        container.dispatchEvent(
          new PointerEvent("pointermove", {
            ...common,
            metaKey: true,
            buttons: 1,
            clientX: startClientX + 60,
            clientY: startClientY,
          })
        );
        container.dispatchEvent(
          new PointerEvent("pointerup", {
            ...common,
            buttons: 0,
            clientX: startClientX + 60,
            clientY: startClientY,
          })
        );
      } finally {
        selftestOverlayOverride = null;
        if (activeDrag?.container === container) cancelDrag();
      }

      const write = lastTransformWrite;
      if (
        !write ||
        write.generation <= generationBefore ||
        write.overlayId !== container.dataset.overlayId
      ) {
        throw new Error("ドラッグの overlayWrite が開始されませんでした");
      }

      try {
        const result = await write.promise;
        dragWriteResultText = resultText(result);
      } catch (error) {
        dragWriteResultText = `rejected(${errorText(error)})`;
        throw error;
      }

      afterText = cssVariableText(container, "--x") || "(empty)";
      const afterValue = cssVariableNumber(container, "--x", 0);
      const movedBy = afterValue - beforeValue;
      // クライアント +60px のドラッグは、動画座標では 60 ÷ 舞台倍率 px の移動になる
      const expectedMove = 60 / dragStageScale;
      const dragOk = Math.abs(movedBy - expectedMove) < 0.001;

      // 既定サンプルの scale=1 だけでは開始倍率の除算漏れを検出できないため、
      // 実際の PointerEvent resize は明示的に非等倍から開始する。
      resizeSetupTransform = readTransform(container);
      container.style.setProperty("--scale", "1.5");
      refreshSelectionFrame();

      const resizeBeforeRect = fragmentBounds(container);
      if (
        !resizeBeforeRect ||
        ![
          resizeBeforeRect.left,
          resizeBeforeRect.top,
          resizeBeforeRect.right,
          resizeBeforeRect.bottom,
          resizeBeforeRect.width,
          resizeBeforeRect.height,
        ].every(Number.isFinite) ||
        resizeBeforeRect.width <= 0 ||
        resizeBeforeRect.height <= 0
      ) {
        throw new Error("拡縮前の断片矩形を取得できませんでした");
      }

      const resizeHandle = selectionFrame?.querySelector(
        ".akari-interaction-handle.is-se"
      );
      if (!(resizeHandle instanceof HTMLElement)) {
        throw new Error("se 拡縮ハンドルが見つかりません");
      }

      const resizeStartScale = cssVariableNumber(container, "--scale", 1);
      const resizeStartClientX = resizeBeforeRect.right;
      const resizeStartClientY = resizeBeforeRect.bottom;
      const anchorBeforeX = resizeBeforeRect.left;
      const anchorBeforeY = resizeBeforeRect.top;
      const resizePointerId = 73014;
      const resizeGenerationBefore = writeGeneration;
      const resizeCommon = {
        ...common,
        pointerId: resizePointerId,
      };

      try {
        resizeHandle.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...resizeCommon,
            buttons: 1,
            clientX: resizeStartClientX,
            clientY: resizeStartClientY,
          })
        );
        resizeHandle.dispatchEvent(
          new PointerEvent("pointermove", {
            ...resizeCommon,
            metaKey: true,
            buttons: 1,
            clientX: resizeStartClientX + 40,
            clientY: resizeStartClientY + 40,
          })
        );
        resizeHandle.dispatchEvent(
          new PointerEvent("pointerup", {
            ...resizeCommon,
            buttons: 0,
            clientX: resizeStartClientX + 40,
            clientY: resizeStartClientY + 40,
          })
        );
      } finally {
        if (activeResize?.container === container) cancelResize();
      }

      const resizeWrite = lastTransformWrite;
      if (
        !resizeWrite ||
        resizeWrite.generation <= resizeGenerationBefore ||
        resizeWrite.overlayId !== container.dataset.overlayId
      ) {
        throw new Error("拡縮の overlayWrite が開始されませんでした");
      }

      try {
        const result = await resizeWrite.promise;
        resizeWriteResultText = resultText(result);
        resizeWriteCommitted = true;
      } catch (error) {
        resizeWriteResultText = `rejected(${errorText(error)})`;
        throw error;
      }

      const resizeStartDistance = Math.hypot(
        resizeStartClientX - anchorBeforeX,
        resizeStartClientY - anchorBeforeY
      );
      const resizeEndDistance = Math.hypot(
        resizeStartClientX + 40 - anchorBeforeX,
        resizeStartClientY + 40 - anchorBeforeY
      );
      let expectedScale = clampScale(
        resizeStartScale * (resizeEndDistance / resizeStartDistance)
      );
      if (Math.abs(expectedScale - 1) <= SCALE_SNAP_TOLERANCE) {
        expectedScale = 1;
      }

      const actualScale = cssVariableNumber(container, "--scale", NaN);
      const resizeAfterRect = fragmentBounds(container);
      if (!resizeAfterRect) {
        throw new Error("拡縮後の断片矩形を取得できませんでした");
      }
      const anchorDrift = Math.hypot(
        resizeAfterRect.left - anchorBeforeX,
        resizeAfterRect.top - anchorBeforeY
      );
      const scaleOk =
        Number.isFinite(actualScale) &&
        Math.abs(actualScale - expectedScale) < 0.001;
      const anchorOk = Number.isFinite(anchorDrift) && anchorDrift < 1;
      const resizeOk = scaleOk && anchorOk;
      resizeDetail =
        `--scale: ${resizeStartScale} -> ${actualScale} ` +
        `(expected ${expectedScale}); nw drift: ${anchorDrift}px; ` +
        `overlayWrite: ${resizeWriteResultText}`;

      const ok = dragOk && resizeOk;
      const detail =
        `--x: ${beforeText} -> ${afterText}; ` +
        `moved: ${movedBy}px (expected ${expectedMove}px); ` +
        `overlayWrite: ${dragWriteResultText}; resize: ${resizeDetail}`;

      return { ok, detail };
    } catch (error) {
      selftestOverlayOverride = null;
      if (activeDrag?.container === container) cancelDrag();
      if (activeResize?.container === container) cancelResize();
      if (container && resizeSetupTransform && !resizeWriteCommitted) {
        container.style.setProperty("--x", `${resizeSetupTransform.x}px`);
        container.style.setProperty("--y", `${resizeSetupTransform.y}px`);
        container.style.setProperty("--scale", String(resizeSetupTransform.scale));
        container.style.setProperty("--rotate", `${resizeSetupTransform.rotate}deg`);
        refreshSelectionFrame();
      }
      if (container) {
        afterText = cssVariableText(container, "--x") || "(empty)";
      }
      return {
        ok: false,
        detail:
          `--x: ${beforeText} -> ${afterText}; ` +
          `drag overlayWrite: ${dragWriteResultText}; ` +
          `resize: ${resizeDetail}; ` +
          `resize overlayWrite: ${resizeWriteResultText}; ` +
          `error: ${errorText(error)}`,
      };
    }
  }

  // リスナーの付け先は stage 自体ではなく「stage と選択枠の共通祖先」にする。
  // 選択枠の拡縮ハンドルは舞台の外にあるため、stage にしかリスナーが無いと
  // 捕捉フェーズが舞台を経由せずハンドル上の pointerdown が拾えない
  // （本日の実機回帰: 拡縮ハンドルが効かない）。
  // ハンドラ内部は findOverlayContainer / findHandleElement で対象を絞っている
  // ため、祖先を広げても他要素（#drop-hint 等）への誤発火は無い
  // （#drop-hint は動画ロード後 display:none で hit-test から外れる）。
  // ㉑ 実機是正: 選択枠は document.body 直下（上記 refreshSelectionFrame 参照、
  // 本番シェルの #zoom-layer が常時 transform を持つための移設）に統一したため、
  // listenerRoot も document 全体へ揃える（stage.parentElement のままだと
  // body 直下のハンドルが capture フェーズの対象外になり拾えなくなる）。
  const listenerRoot = document;

  // host の document/祖先捕捉より先に retarget する。click も通して再選択を防ぐ。
  for (const type of ["pointerdown", "pointerup", "click", "dblclick"]) {
    window.addEventListener(type, passTransparentCanvasEvent, true);
  }
  const correctedHitPolicyEvents = new WeakMap();
  let redirectedHitPolicyClick = null;
  function pointerInsideStage(event) {
    if (!stage || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const rect = stage.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }
  function trustedEventAtTarget(event, target) {
    // 合成 Event は isTrusted=false になり E2 の焦点を失う。元の信頼済み
    // イベントを保ったまま、選択処理に見せる target だけ現在の hit-test にする。
    return new Proxy(event, { get(original, key) {
      if (key === 'target') return target;
      const value = Reflect.get(original, key, original);
      return typeof value === 'function' ? value.bind(original) : value;
    } });
  }
  function correctHitPolicyEvent(event, target) {
    correctedHitPolicyEvents.set(event, target);
    // Window capture の後続ホストにも素の HTML hit と同じ target を見せる。
    // Event 自体は元の信頼済みイベントなので、再生停止や混在選択は一度だけ走る。
    try { Object.defineProperty(event, 'target', { configurable: true, value: target }); }
    catch { /* document 側は WeakMap の target へフォールバックする。 */ }
  }
  function correctedHitPolicyEvent(event) {
    const target = correctedHitPolicyEvents.get(event);
    return target && event.target !== target ? trustedEventAtTarget(event, target) : event;
  }
  function stopCorrectedHitPolicyPropagation(event) {
    // window のホスト捕捉は通し、古い preview-stage への下流だけ止める。
    if (findOverlayContainer(correctedHitPolicyEvents.get(event))) event.stopPropagation();
  }
  window.addEventListener('pointermove', event => {
    if (!pointerInsideStage(event) || !staleHitPolicyContainers.size
      || hitPolicyOperationBusy()) return;
    const now = performance.now();
    if (now - lastPointerHitPolicyRefresh < 125) return;
    if (!refreshStaleHitPolicies()) return;
    lastPointerHitPolicyRefresh = now;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && target !== event.target) correctHitPolicyEvent(event, target);
  }, true);
  window.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !pointerInsideStage(event) || hitPolicyOperationBusy()) return;
    redirectedHitPolicyClick = null;
    if (!refreshStaleHitPolicies()) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === event.target) return;
    redirectedHitPolicyClick = { x: event.clientX, y: event.clientY };
    correctHitPolicyEvent(event, target);
  }, true);
  window.addEventListener('click', event => {
    if (!redirectedHitPolicyClick) return;
    const redirect = redirectedHitPolicyClick;
    redirectedHitPolicyClick = null;
    if (Math.hypot(event.clientX - redirect.x, event.clientY - redirect.y) > 6) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === event.target) return;
    correctHitPolicyEvent(event, target);
  }, true);
  listenerRoot.addEventListener('pointermove', updateShapeLineHitProxyWidths, true);
  listenerRoot.addEventListener('pointerdown', updateShapeLineHitProxyWidths, true);
  window.addEventListener('resize', updateShapeLineHitProxyWidths);
  listenerRoot.addEventListener("click", onClick, true);
  listenerRoot.addEventListener("pointerdown", onPointerDown, true);
  listenerRoot.addEventListener("click", stopCorrectedHitPolicyPropagation, true);
  listenerRoot.addEventListener("pointerdown", stopCorrectedHitPolicyPropagation, true);
  listenerRoot.addEventListener("dblclick", onDoubleClick, true);
  listenerRoot.addEventListener("blur", onBlur, true);
  listenerRoot.addEventListener("input", onEditableInput, true);
  listenerRoot.addEventListener("compositionend", onEditableInput, true);
  listenerRoot.addEventListener(
    "dragstart",
    (event) => {
      if (
        activeEdit &&
        event.target instanceof Node &&
        activeEdit.element.contains(event.target)
      ) {
        return;
      }
      if (isSelectable(findOverlayContainer(event.target))) event.preventDefault();
    },
    true
  );

  if (stage) {
    if (typeof ResizeObserver !== 'undefined') {
      const hitProxyResizeObserver = new ResizeObserver(updateShapeLineHitProxyWidths);
      hitProxyResizeObserver.observe(stage);
      if (stage.parentElement) hitProxyResizeObserver.observe(stage.parentElement);
    }
    // オーバーレイコンテナの増減監視は舞台限定でよい（選択枠自体は監視不要）。
    new MutationObserver(() => {
      if (selectedOverlay && !isSelectable(selectedOverlay)) {
        handleSelectedOverlayUnavailable(selectedOverlay);
      }
    }).observe(stage, { childList: true });
  }

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", isolateEditKey, true);
  window.addEventListener("keypress", isolateEditKey, true);
  window.addEventListener('blur', () => { clearMarquee(); flushNudge(); hideHover(); lastClick = null; });
  document.addEventListener('pointerleave', hideHover);

  function libraryApplyHitTest(x, y, fallbackCut, requestedKind) {
    const contains = rect => rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right
      && y >= rect.top && y <= rect.bottom;
    const visible = element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const captions = [...document.querySelectorAll('.caption-row-plate[data-caption-key]')].reverse();
    for (const plate of requestedKind === 'lut' ? [] : captions) {
      if (!visible(plate)) continue;
      const face = plate.querySelector('.akari-caption__plate') || plate;
      const rect = face.getBoundingClientRect();
      if (contains(rect)) return { kind: 'caption', id: plate.dataset.captionKey, rect };
    }
    const layers = [...document.querySelectorAll('[data-akari-layer-id]')]
      .filter(visible).sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
    for (const layer of layers) {
      const rect = layer.getBoundingClientRect();
      if (contains(rect)) return { kind: 'layer', id: layer.dataset.akariLayerId, rect };
    }
    if (fallbackCut?.id && contains(fallbackCut.rect)) return fallbackCut;
    return null;
  }

  return {
    protectModelSummary,
    restorePendingDragTransforms,
    get pointerOwner() { return pointerOwner; },
    get activePointerOperation() { return Boolean(activeDrag || activeResize || activeRotate || activeLine || marqueeFrame); },
    canBeginPointerInteraction,
    setPointerOwner,
    releasePointerOwner,
    get selectedId() { return selectedId; },
    get elementFocus() { return selectedElementFocus(); },
    clearElementFocus() { if (selectedElementFocus()) focusElement(null, { notify: false }); },
    focusElementAtPoint,
    get selectedIds() { return [...selectedIds]; },
    get selectionKind() { return selectionKind(); },
    get scopeId() { return scopeId; },
    get floorScopeId() { return floorScopeId; },
    get activeEdit() { return Boolean(activeEdit); },
    get hasSelectionTree() { return selectionTree().length > 0; },
    libraryApplyHitTest,
    selectFromTimeline,
    setSelectionFloor,
    selftest,
    fragmentBounds,
    lineFrameGeometry,
    canvasAlphaAtPoint,
    canvasClientBounds,
    captureCanvasContent,
    // ㉒ スナップ統一: layers[] / cut / caption のドラッグ実装（akari-preview-open-handler.ts、
    // 別パッケージ）が同じしきい値・座標系・ガイド線を再利用するための共有 API。
    // overlays[] 自身のドラッグ/拡縮（上の内部関数群）も同じ実装を通る（単一正本）。
    stageLocalPoint,
    computeSnapCorrection,
    computeScaleSnap,
    snapTargetsFor,
    setExtraSnapTargets,
    showSnapGuides,
    hideSnapGuides,
    outputSize,
    currentDisplayScale,
    anchorPreservingTranslate,
    computeAnchorResizeSnap,
    // ㉑ 素通し: overlay-runtime.js の tick() が可視化タイミングで呼ぶ。
    applyOverlayHitPolicy,
    invalidateOverlayHitPolicy,
    markOverlayHitPolicyStale,
    forgetOverlayHitPolicyTracking,
    syncOverlayHitRegion,
    // Web UI（preview-server）が編集モードを抜けるときに選択枠を畳むための公開口
    // （Phase 2-4 一本化。shell では未使用の追加 export で挙動不変）。
    clearSelection,
    // Web UI が編集モードに合わせて素材操作そのものを止めるための公開口。
    setEnabled,
  };
})();
