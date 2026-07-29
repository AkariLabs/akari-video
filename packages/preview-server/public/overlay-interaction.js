window.akari = window.akari || {};
window.akari.interaction = (() => {
  const stage = document.getElementById('overlay-stage');
  const SNAP_DISTANCE = 8;
  const SNAP_RELEASE_DISTANCE = 12;
  const SAFE_MARGIN_RATIO = 0.05;
  const DRAG_START = 3;
  const SCALE_MIN = 0.2;
  const SCALE_MAX = 4.0;
  const SCALE_SNAP = 0.035;

  let selected = null;
  let frame = null;
  let trackRA = null;
  let drag = null;
  let resize = null;
  let guides = { v: null, h: null };
  let writeTail = Promise.resolve();

  function stageScale() {
    const s = window.akari.stageScale ? window.akari.stageScale() : 1;
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function stageLocalPoint(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left) / stageScale(), y: (clientY - rect.top) / stageScale() };
  }

  function getTransform(el) {
    const x = parseFloat(el.style.getPropertyValue('--x')) || 0;
    const y = parseFloat(el.style.getPropertyValue('--y')) || 0;
    const s = parseFloat(el.style.getPropertyValue('--scale')) || 1;
    const r = parseFloat(el.style.getPropertyValue('--rotate')) || 0;
    return { x, y, scale: s, rotate: r };
  }

  function setTransform(el, t) {
    el.style.setProperty('--x', `${t.x}px`);
    el.style.setProperty('--y', `${t.y}px`);
    el.style.setProperty('--scale', String(t.scale));
    el.style.setProperty('--rotate', `${t.rotate}deg`);
  }

  function fragmentBounds(container) {
    const frag = container.firstElementChild;
    if (!frag) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, centerX: 0, centerY: 0 };
    const t = getTransform(container);
    const s = stageScale();
    const r = frag.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const left = (r.left - stageRect.left) / s;
    const top = (r.top - stageRect.top) / s;
    const w = r.width / s;
    const h = r.height / s;
    return { left, top, width: w, height: h, right: left + w, bottom: top + h, centerX: left + w / 2, centerY: top + h / 2 };
  }

  function outputSize() {
    if (window.akari.outputSize) return window.akari.outputSize();
    return { width: 1280, height: 720 };
  }

  function closestAxisSnap(sourcePoints, targets, previousSnap, displayScale) {
    let best = null;
    let bestDist = Infinity;
    for (const sp of sourcePoints) {
      for (const tp of targets) {
        const dist = Math.abs(sp - tp) * displayScale;
        if (previousSnap !== null && Math.abs(previousSnap.target - tp) < 0.01) {
          if (dist < SNAP_RELEASE_DISTANCE) return { target: tp, source: sp, active: true, previous: true };
        }
        if (dist < bestDist && dist < SNAP_DISTANCE) {
          bestDist = dist;
          best = { target: tp, source: sp, active: true };
        }
      }
    }
    return best || { target: null, source: 0, active: false };
  }

  function computeSnapCorrection(bounds, prevSnap) {
    const os = outputSize();
    const xTargets = [os.width * SAFE_MARGIN_RATIO, os.width / 2, os.width * (1 - SAFE_MARGIN_RATIO)];
    const yTargets = [os.height * SAFE_MARGIN_RATIO, os.height / 2, os.height * (1 - SAFE_MARGIN_RATIO)];
    const xSources = [bounds.left, bounds.centerX, bounds.right];
    const ySources = [bounds.top, bounds.centerY, bounds.bottom];
    const ds = stageScale();
    const snapX = closestAxisSnap(xSources, xTargets, prevSnap?.x ?? null, ds);
    const snapY = closestAxisSnap(ySources, yTargets, prevSnap?.y ?? null, ds);
    return {
      x: { ...snapX, correction: snapX.active ? snapX.target - snapX.source : 0 },
      y: { ...snapY, correction: snapY.active ? snapY.target - snapY.source : 0 },
    };
  }

  function showGuides(snap) {
    if (!guides.v || !guides.h) return;
    if (snap.x.active) { guides.v.style.left = `${snap.x.target}px`; guides.v.hidden = false; }
    if (snap.y.active) { guides.h.style.top = `${snap.y.target}px`; guides.h.hidden = false; }
  }

  function hideGuides() {
    if (guides.v) guides.v.hidden = true;
    if (guides.h) guides.h.hidden = true;
  }

  function ensureGuides() {
    if (!guides.v) {
      guides.v = document.createElement('div');
      guides.v.className = 'akari-interaction-snap-guide is-vertical';
      guides.v.hidden = true;
      stage.appendChild(guides.v);
    }
    if (!guides.h) {
      guides.h = document.createElement('div');
      guides.h.className = 'akari-interaction-snap-guide is-horizontal';
      guides.h.hidden = true;
      stage.appendChild(guides.h);
    }
  }

  function createFrame() {
    const el = document.createElement('div');
    el.className = 'akari-interaction-selection-frame';
    el.hidden = true;
    document.body.appendChild(el);
    for (const pos of ['nw', 'ne', 'se', 'sw']) {
      const h = document.createElement('span');
      h.className = `akari-interaction-handle is-${pos}`;
      el.appendChild(h);
    }
    return el;
  }

  function updateFrame(container) {
    if (!frame) frame = createFrame();
    const b = fragmentBounds(container);
    const s = stageScale();
    const sr = stage.getBoundingClientRect();
    frame.style.left = `${sr.left + b.left * s}px`;
    frame.style.top = `${sr.top + b.top * s}px`;
    frame.style.width = `${b.width * s}px`;
    frame.style.height = `${b.height * s}px`;
    frame.hidden = false;
  }

  function startTracking() {
    if (trackRA) cancelAnimationFrame(trackRA);
    function tick() {
      if (!selected || !frame) { trackRA = null; return; }
      updateFrame(selected);
      trackRA = requestAnimationFrame(tick);
    }
    trackRA = requestAnimationFrame(tick);
  }

  function stopTracking() {
    if (trackRA) { cancelAnimationFrame(trackRA); trackRA = null; }
  }

  function selectOverlay(container) {
    clearSelection();
    selected = container;
    container.setAttribute('data-akari-interaction-selected', 'true');
    if (!frame) frame = createFrame();
    updateFrame(container);
    startTracking();
  }

  function clearSelection() {
    hideGuides();
    stopTracking();
    if (selected) selected.removeAttribute('data-akari-interaction-selected');
    selected = null;
    if (frame) frame.hidden = true;
    if (window.akari.onSelectionChange) window.akari.onSelectionChange(null);
  }

  function containerForEvent(event) {
    let el = event.target;
    while (el && el !== stage) {
      if (el.parentElement === stage && el.hasAttribute('data-overlay-id')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function isHandle(el) {
    return el.classList.contains('akari-interaction-handle');
  }

  function findHandle(event) {
    if (!frame || frame.hidden) return null;
    let el = event.target;
    while (el) {
      if (el.parentElement === frame && el.classList.contains('akari-interaction-handle')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function overlayForEvent(event) {
    const byTarget = containerForEvent(event);
    if (byTarget && isSelectable(byTarget)) return byTarget;
    const children = stage.querySelectorAll(':scope > [data-overlay-id]');
    const sp = stageLocalPoint(event.clientX, event.clientY);
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      if (!isSelectable(c)) continue;
      const b = fragmentBounds(c);
      if (sp.x >= b.left && sp.x <= b.right && sp.y >= b.top && sp.y <= b.bottom) return c;
    }
    return byTarget && isSelectable(byTarget) ? byTarget : null;
  }

  function isSelectable(container) {
    return container && container.parentElement === stage && container.hasAttribute('data-overlay-id');
  }

  // ─── Pointer event handlers ───

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (drag || resize) return;

    const handle = findHandle(event);
    if (handle) { beginResize(handle, event); return; }

    const container = overlayForEvent(event);
    if (!container || !isSelectable(container)) { clearSelection(); return; }
    selectOverlay(container);

    const sp = stageLocalPoint(event.clientX, event.clientY);
    const t = getTransform(container);
    drag = {
      container, startX: event.clientX, startY: event.clientY,
      startPoint: sp, startTx: t,
      moved: false, snapX: null, snapY: null,
    };
    if (container.setPointerCapture) container.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (resize) { updateResize(event); return; }
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_START) return;
    drag.moved = true;
    const sp = stageLocalPoint(event.clientX, event.clientY);
    const deltaX = sp.x - drag.startPoint.x;
    const deltaY = sp.y - drag.startPoint.y;
    const t = { ...drag.startTx, x: drag.startTx.x + deltaX, y: drag.startTx.y + deltaY };
    setTransform(drag.container, t);

    const bounds = fragmentBounds(drag.container);
    const snap = computeSnapCorrection(bounds, { x: drag.snapX, y: drag.snapY });
    if (snap.x.active || snap.y.active) {
      const corrected = {
        x: t.x + snap.x.correction, y: t.y + snap.y.correction,
        scale: t.scale, rotate: t.rotate,
      };
      setTransform(drag.container, corrected);
    }
    drag.snapX = snap.x.active ? snap.x : null;
    drag.snapY = snap.y.active ? snap.y : null;
    showGuides(snap);
    if (drag.snapX || drag.snapY) {
      // re-read bounds after snap correction for guide positioning
      const cb = fragmentBounds(drag.container);
      const csnap = computeSnapCorrection(cb, { x: null, y: null });
      showGuides(csnap);
    }
  }

  function onPointerUp(event) {
    if (resize) { finishResize(event); return; }
    if (!drag) return;
    if (drag.moved) {
      const t = getTransform(drag.container);
      enqueueWrite(drag.container, { transform: { x: Math.round(t.x), y: Math.round(t.y), scale: +t.scale.toFixed(3), rotate: +t.rotate.toFixed(1) } });
    }
    if (drag.container.releasePointerCapture) drag.container.releasePointerCapture(event.pointerId);
    drag = null;
    hideGuides();
  }

  function onPointerCancel() {
    if (resize) { resize = null; }
    if (drag) {
      if (drag.container) setTransform(drag.container, drag.startTx);
      drag = null;
    }
    hideGuides();
  }

  // ─── Resize ───

  function anchorForCorner(corner) {
    const map = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
    return map[corner] || 'se';
  }

  function beginResize(handle, event) {
    const container = selected;
    if (!container) return;
    const corner = [...handle.classList].find(c => ['is-nw','is-ne','is-se','is-sw'].includes(c))?.slice(3);
    if (!corner) return;
    const anchorName = anchorForCorner(corner);
    const b = fragmentBounds(container);
    const anchor = { x: b[anchorName === 'nw' ? 'left' : anchorName === 'ne' ? 'right' : anchorName === 'sw' ? 'left' : 'right'], y: b[anchorName === 'nw' ? 'top' : anchorName === 'ne' ? 'top' : anchorName === 'sw' ? 'bottom' : 'bottom'] };
    const sp = stageLocalPoint(event.clientX, event.clientY);
    const startDist = Math.hypot(sp.x - anchor.x, sp.y - anchor.y);
    const t = getTransform(container);
    resize = { container, corner, anchor, startDist, startScale: t.scale, startTx: t };
    if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateResize(event) {
    if (!resize) return;
    const sp = stageLocalPoint(event.clientX, event.clientY);
    const dist = Math.hypot(sp.x - resize.anchor.x, sp.y - resize.anchor.y);
    let nextScale = resize.startScale * (dist / resize.startDist);
    nextScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, nextScale));
    if (Math.abs(nextScale - 1) < SCALE_SNAP) nextScale = 1;

    const t = resize.startTx;
    const ratio = nextScale / resize.startScale;
    const newX = resize.anchor.x - (resize.anchor.x - t.x) * ratio;
    const newY = resize.anchor.y - (resize.anchor.y - t.y) * ratio;
    setTransform(resize.container, { x: newX, y: newY, scale: nextScale, rotate: t.rotate });
  }

  function finishResize() {
    if (!resize) return;
    const t = getTransform(resize.container);
    enqueueWrite(resize.container, { transform: { x: Math.round(t.x), y: Math.round(t.y), scale: +t.scale.toFixed(3), rotate: +t.rotate.toFixed(1) } });
    resize = null;
  }

  // ─── Write-back ───

  function enqueueWrite(container, patch) {
    const id = container.getAttribute('data-overlay-id');
    const p = writeTail.then(async () => {
      const res = await fetch('/api/edit.json', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(applyPatch(id, patch)) });
      if (!res.ok) throw new Error(`write-back failed: HTTP ${res.status}`);
    });
    writeTail = p.catch(() => {});
    return p;
  }

  async function applyPatch(id, patch) {
    const res = await fetch('/api/summary');
    const edit = await res.json();
    const ov = edit.overlays?.find(o => String(o.id) === String(id));
    if (ov) Object.assign(ov, patch);
    if (patch.transform) ov.transform = { ...ov.transform, ...patch.transform };
    return edit;
  }

  // ─── OnClick / OnDblClick ───

  function onClick(event) {
    const container = overlayForEvent(event);
    if (container && isSelectable(container)) selectOverlay(container);
  }

  // ─── Init ───

  function init() {
    ensureGuides();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { clearSelection(); drag = null; resize = null; hideGuides(); }
    }, true);
  }

  return {
    init, selectOverlay, clearSelection,
    computeSnapCorrection, stageLocalPoint, showGuides, hideGuides,
    fragmentBounds, getTransform, setTransform,
  };
})();
