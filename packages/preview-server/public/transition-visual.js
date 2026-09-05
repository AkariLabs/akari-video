const SVG_NS = 'http://www.w3.org/2000/svg';

// feTurbulence(type=turbulence, baseFrequency=0.9, numOctaves=2, seed=7) を
// luminanceToAlpha した α の実測 CDF（Chromium 実機・320x320・102400 画素）の逆関数。
// 添字 i は目標可視比 p = i / 32、値は 256 スロット中の可視スロット数。
// seed / baseFrequency / numOctaves を変えたらこの表も測り直すこと。
export const DISSOLVE_VISIBLE_SLOTS = Object.freeze([
  0, 20, 26, 30, 33, 36, 39, 41, 44, 46, 48, 51, 53, 55, 58, 60, 62,
  65, 67, 70, 72, 75, 78, 81, 84, 88, 92, 96, 100, 106, 112, 122, 256,
]);

export function transitionEngineBlockSize(ratio, width) {
  return Math.max(1, Math.round(ratio * width));
}

export function transitionDissolveTableValues(visibleRatio, slots) {
  const safeSlots = Math.max(0, Math.floor(Number(slots) || 0));
  const ratio = Math.max(0, Math.min(1, Number(visibleRatio) || 0));
  const tablePosition = ratio * (DISSOLVE_VISIBLE_SLOTS.length - 1);
  const lowerIndex = Math.floor(tablePosition);
  const upperIndex = Math.min(DISSOLVE_VISIBLE_SLOTS.length - 1, lowerIndex + 1);
  const fraction = tablePosition - lowerIndex;
  const calibratedSlots = DISSOLVE_VISIBLE_SLOTS[lowerIndex]
    + (DISSOLVE_VISIBLE_SLOTS[upperIndex] - DISSOLVE_VISIBLE_SLOTS[lowerIndex]) * fraction;
  const visibleSlots = Math.round(calibratedSlots * safeSlots / 256);
  return Array.from({ length: safeSlots }, (_value, index) =>
    index < visibleSlots ? '1' : '0').join(' ');
}

export function drawTransitionPixelize(canvas, outgoingSource, incomingSource, blockSize, alpha, documentRef = document) {
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return false;
  const width = Math.max(1, Number(canvas.width) || 1);
  const height = Math.max(1, Number(canvas.height) || 1);
  ctx.clearRect(0, 0, width, height);
  const block = Math.max(1, Math.round(Number(blockSize) || 1));
  const reducedWidth = Math.max(1, Math.ceil(width / block));
  const reducedHeight = Math.max(1, Math.ceil(height / block));
  const reduced = documentRef.createElement('canvas');
  reduced.width = reducedWidth;
  reduced.height = reducedHeight;
  const reducedCtx = reduced.getContext('2d');
  if (!reducedCtx) return false;
  reducedCtx.clearRect(0, 0, reducedWidth, reducedHeight);
  reducedCtx.imageSmoothingEnabled = false;
  reducedCtx.webkitImageSmoothingEnabled = false;
  const sourceDimensions = source => {
    if (!source) return null;
    const tagName = String(source.tagName || '').toLowerCase();
    if (tagName === 'video') {
      if (Number(source.readyState) < 2) return null;
      const sourceWidth = Number(source.videoWidth);
      const sourceHeight = Number(source.videoHeight);
      return sourceWidth > 0 && sourceHeight > 0
        ? { width: sourceWidth, height: sourceHeight } : null;
    }
    if (tagName === 'img') {
      const sourceWidth = Number(source.naturalWidth);
      const sourceHeight = Number(source.naturalHeight);
      return sourceWidth > 0 && sourceHeight > 0
        ? { width: sourceWidth, height: sourceHeight } : null;
    }
    return null;
  };
  const drawContained = (source, sourceAlpha) => {
    const dimensions = sourceDimensions(source);
    if (!dimensions) return false;
    const scale = Math.min(reducedWidth / dimensions.width, reducedHeight / dimensions.height);
    const drawWidth = dimensions.width * scale;
    const drawHeight = dimensions.height * scale;
    const drawX = (reducedWidth - drawWidth) / 2;
    const drawY = (reducedHeight - drawHeight) / 2;
    reducedCtx.globalAlpha = sourceAlpha;
    reducedCtx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    return true;
  };
  const outgoingDrawn = drawContained(outgoingSource, 1);
  const incomingDrawn = drawContained(incomingSource, Math.max(0, Math.min(1, Number(alpha) || 0)));
  if (!outgoingDrawn && !incomingDrawn) return false;
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  const expandedWidth = reducedWidth * block;
  const expandedHeight = reducedHeight * block;
  const offsetX = expandedWidth === width ? 0 : -Math.round((expandedWidth - width) / 2);
  const offsetY = expandedHeight === height ? 0 : -Math.round((expandedHeight - height) / 2);
  ctx.drawImage(
    reduced,
    0,
    0,
    reducedWidth,
    reducedHeight,
    offsetX,
    offsetY,
    expandedWidth,
    expandedHeight,
  );
  return true;
}

export function createTransitionPixelizeReadyHooks(rerender) {
  const listeners = new Map();
  const reset = () => {
    for (const [element, eventListeners] of listeners) {
      for (const [eventName, listener] of eventListeners) {
        element.removeEventListener(eventName, listener);
      }
    }
    listeners.clear();
  };
  const arm = element => {
    if (!element) return;
    const tagName = String(element.tagName || '').toLowerCase();
    const eventNames = tagName === 'video' ? ['loadeddata', 'seeked'] : tagName === 'img' ? ['load'] : [];
    if (eventNames.length === 0) return;
    let eventListeners = listeners.get(element);
    if (!eventListeners) {
      eventListeners = new Map();
      listeners.set(element, eventListeners);
    }
    for (const eventName of eventNames) {
      if (eventListeners.has(eventName)) continue;
      const listener = () => {
        reset();
        rerender();
      };
      eventListeners.set(eventName, listener);
      element.addEventListener(eventName, listener, { once: true });
    }
  };
  return { arm, reset };
}

function setTransitionMask(element, value) {
  const mask = value && value !== 'none' ? value : '';
  element.style.maskImage = mask;
  element.style.webkitMaskImage = mask;
}

function joinedTransform(base, transition) {
  return [base, transition].filter(Boolean).join(' ');
}

export function createTransitionVisualApplicator({
  stage,
  incomingElement,
  plate,
  fallbackLabel,
  rerender,
  documentRef = document,
}) {
  let activeEngine = 'none';
  let lastOutgoing = null;
  const readyHooks = createTransitionPixelizeReadyHooks(rerender);

  const removeEngineElements = () => {
    readyHooks.reset();
    documentRef.getElementById('transition-engine-filters')?.remove();
    documentRef.getElementById('transition-pixelize-canvas')?.remove();
  };

  const ensureEngineFilters = zIndex => {
    const existing = documentRef.getElementById('transition-engine-filters');
    if (existing) {
      existing.style.zIndex = String(zIndex);
      return {
        blur: documentRef.getElementById('akari-transition-hblur-node'),
        dissolveTable: documentRef.getElementById('akari-transition-dissolve-table'),
      };
    }
    const svg = documentRef.createElementNS(SVG_NS, 'svg');
    svg.id = 'transition-engine-filters';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.zIndex = String(zIndex);
    const defs = documentRef.createElementNS(SVG_NS, 'defs');
    const blurFilter = documentRef.createElementNS(SVG_NS, 'filter');
    blurFilter.id = 'akari-transition-hblur';
    blurFilter.setAttribute('x', '-10%');
    blurFilter.setAttribute('y', '-10%');
    blurFilter.setAttribute('width', '120%');
    blurFilter.setAttribute('height', '120%');
    const blur = documentRef.createElementNS(SVG_NS, 'feGaussianBlur');
    blur.id = 'akari-transition-hblur-node';
    blur.setAttribute('stdDeviation', '0 0');
    blur.setAttribute('edgeMode', 'duplicate');
    blurFilter.appendChild(blur);
    const dissolveFilter = documentRef.createElementNS(SVG_NS, 'filter');
    dissolveFilter.id = 'akari-transition-dissolve';
    dissolveFilter.setAttribute('x', '0%');
    dissolveFilter.setAttribute('y', '0%');
    dissolveFilter.setAttribute('width', '100%');
    dissolveFilter.setAttribute('height', '100%');
    dissolveFilter.setAttribute('color-interpolation-filters', 'sRGB');
    const turbulence = documentRef.createElementNS(SVG_NS, 'feTurbulence');
    turbulence.setAttribute('type', 'turbulence');
    turbulence.setAttribute('baseFrequency', '0.9');
    turbulence.setAttribute('numOctaves', '2');
    turbulence.setAttribute('seed', '7');
    turbulence.setAttribute('result', 'noise');
    const luminance = documentRef.createElementNS(SVG_NS, 'feColorMatrix');
    luminance.setAttribute('in', 'noise');
    luminance.setAttribute('type', 'luminanceToAlpha');
    luminance.setAttribute('result', 'noiseAlpha');
    const transfer = documentRef.createElementNS(SVG_NS, 'feComponentTransfer');
    transfer.setAttribute('in', 'noiseAlpha');
    transfer.setAttribute('result', 'mask');
    const dissolveTable = documentRef.createElementNS(SVG_NS, 'feFuncA');
    dissolveTable.id = 'akari-transition-dissolve-table';
    dissolveTable.setAttribute('type', 'discrete');
    dissolveTable.setAttribute('tableValues', transitionDissolveTableValues(0, 256));
    transfer.appendChild(dissolveTable);
    const composite = documentRef.createElementNS(SVG_NS, 'feComposite');
    composite.setAttribute('in', 'SourceGraphic');
    composite.setAttribute('in2', 'mask');
    composite.setAttribute('operator', 'in');
    dissolveFilter.append(turbulence, luminance, transfer, composite);
    defs.append(blurFilter, dissolveFilter);
    svg.appendChild(defs);
    stage.appendChild(svg);
    return { blur, dissolveTable };
  };

  const ensurePixelizeCanvas = zIndex => {
    let canvas = documentRef.getElementById('transition-pixelize-canvas');
    if (!canvas) {
      canvas = documentRef.createElement('canvas');
      canvas.id = 'transition-pixelize-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      stage.appendChild(canvas);
    }
    canvas.style.zIndex = String(zIndex);
    return canvas;
  };

  const reset = () => {
    if (lastOutgoing) {
      const { element, transform, opacity, zIndex } = lastOutgoing;
      element.style.transform = transform;
      element.style.opacity = opacity;
      element.style.zIndex = zIndex;
      element.style.filter = element.dataset.akariAdjustFilter || '';
      setTransitionMask(element, 'none');
      element.dataset.akariTransitionType = '';
      element.dataset.akariTransitionProgress = '';
    }
    lastOutgoing = null;
    incomingElement.style.display = 'none';
    incomingElement.style.opacity = '0';
    incomingElement.style.clipPath = 'none';
    incomingElement.style.transform = '';
    incomingElement.style.transformOrigin = '';
    incomingElement.style.filter = incomingElement.dataset.akariAdjustFilter || '';
    incomingElement.style.zIndex = '';
    setTransitionMask(incomingElement, 'none');
    incomingElement.dataset.akariTransitionType = '';
    incomingElement.dataset.akariTransitionProgress = '';
    plate.style.opacity = '0';
    plate.style.visibility = 'hidden';
    fallbackLabel.textContent = '';
    fallbackLabel.style.display = 'none';
    fallbackLabel.dataset.akariTransitionFallback = '';
    activeEngine = 'none';
    removeEngineElements();
  };

  const apply = ({
    visual,
    type,
    outgoingElement,
    outgoingBaseTransform = '',
    incomingBaseTransform = '',
    incomingTransformOrigin = '',
    outgoingBaseOpacity = 1,
    incomingBaseOpacity = 1,
    outgoingZ = 0,
    incomingZ = 1,
    outgoingFilter,
    incomingFilter,
    width,
    height,
  }) => {
    if (lastOutgoing && lastOutgoing.element !== outgoingElement) reset();
    if (activeEngine !== visual.engine) {
      removeEngineElements();
      activeEngine = visual.engine;
    }
    lastOutgoing = {
      element: outgoingElement,
      transform: outgoingBaseTransform,
      opacity: String(outgoingBaseOpacity),
      zIndex: String(outgoingZ),
    };
    const engineZ = Math.max(outgoingZ, incomingZ) + 1;
    const engineFilters = visual.engine === 'directional-blur' || visual.engine === 'noise-dissolve'
      ? ensureEngineFilters(engineZ) : null;
    if (visual.engine === 'directional-blur' && engineFilters?.blur) {
      engineFilters.blur.setAttribute('stdDeviation', `${visual.blurStdDeviationRatio * width} 0`);
    } else if (visual.engine === 'noise-dissolve' && engineFilters?.dissolveTable) {
      engineFilters.dissolveTable.setAttribute(
        'tableValues',
        transitionDissolveTableValues(visual.dissolveVisibleRatio, 256),
      );
    }

    outgoingElement.style.opacity = String(outgoingBaseOpacity * visual.outgoingOpacity);
    outgoingElement.style.transform = joinedTransform(outgoingBaseTransform, visual.outgoingTransform);
    outgoingElement.style.filter = typeof outgoingFilter === 'string'
      ? outgoingFilter
      : visual.engine === 'directional-blur'
        ? 'url(#akari-transition-hblur)'
        : (visual.outgoingFilter === 'none' ? '' : visual.outgoingFilter);
    setTransitionMask(outgoingElement, visual.outgoingMask);
    outgoingElement.style.zIndex = String(visual.zSwap ? engineZ : outgoingZ);

    incomingElement.style.display = 'block';
    incomingElement.style.opacity = String(incomingBaseOpacity * visual.incomingOpacity);
    incomingElement.style.clipPath = visual.incomingClipPath;
    incomingElement.style.transformOrigin = incomingTransformOrigin;
    incomingElement.style.transform = joinedTransform(incomingBaseTransform, visual.incomingTransform);
    incomingElement.style.filter = typeof incomingFilter === 'string'
      ? incomingFilter
      : visual.engine === 'directional-blur'
        ? 'url(#akari-transition-hblur)'
        : visual.engine === 'noise-dissolve'
          ? 'url(#akari-transition-dissolve)'
          : (visual.incomingFilter === 'none' ? '' : visual.incomingFilter);
    setTransitionMask(incomingElement, visual.incomingMask);
    incomingElement.style.zIndex = String(incomingZ);

    if (visual.engine === 'pixelize') {
      readyHooks.arm(outgoingElement);
      readyHooks.arm(incomingElement);
      const canvas = ensurePixelizeCanvas(engineZ);
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const blockSize = transitionEngineBlockSize(visual.pixelBlockRatio, width);
      canvas.style.display = drawTransitionPixelize(
        canvas,
        outgoingElement,
        incomingElement,
        blockSize,
        visual.progress,
        documentRef,
      ) ? 'block' : 'none';
    }

    const progressText = visual.progress.toFixed(3);
    outgoingElement.dataset.akariTransitionType = type;
    outgoingElement.dataset.akariTransitionProgress = progressText;
    incomingElement.dataset.akariTransitionType = type;
    incomingElement.dataset.akariTransitionProgress = progressText;
    plate.style.background = visual.plateColor;
    plate.style.opacity = String(visual.plateOpacity);
    plate.style.visibility = visual.plateOpacity > 0 ? 'visible' : 'hidden';
    fallbackLabel.textContent = visual.fallbackLabel;
    fallbackLabel.style.display = visual.fallbackLabel ? 'block' : 'none';
    fallbackLabel.dataset.akariTransitionFallback = visual.fallbackLabel ? type : '';
  };

  return Object.freeze({ apply, reset });
}
