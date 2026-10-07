// Canvas handle geometry. All coordinates are output pixels unless displayScale is supplied.
globalThis.akariHandleGeometry = (() => {
  const normalizeAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;
  function snapAngle(angle, disabled = false, step = 45, tolerance = 4) {
    const value = normalizeAngle(angle);
    const target = normalizeAngle(Math.round(value / step) * step);
    return !disabled && Math.abs(normalizeAngle(value - target)) <= tolerance ? target : value;
  }
  function axisLock(dx, dy, enabled) {
    if (!enabled) return { x: dx, y: dy };
    return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };
  }
  function rotationAroundPoint(pose, pivot, fixed, deltaDegrees) {
    const radians = deltaDegrees * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const dx = fixed.x - pivot.x, dy = fixed.y - pivot.y;
    return { x: pose.x + dx - (c * dx - s * dy),
      y: pose.y + dy - (s * dx + c * dy) };
  }
  function anchoredScales({ anchor, dragged, pointer, rotation = 0, scaleX = 1, scaleY = 1, edge = null, min = .2, max = 4 }) {
    const radians = rotation * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const local = point => ({ x: c * (point.x - anchor.x) + s * (point.y - anchor.y),
      y: -s * (point.x - anchor.x) + c * (point.y - anchor.y) });
    const original = local(dragged), now = local(pointer);
    const clamp = n => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 1));
    if (edge === 'e' || edge === 'w') return { scaleX: clamp(scaleX * now.x / original.x), scaleY };
    if (edge === 'n' || edge === 's') return { scaleX, scaleY: clamp(scaleY * now.y / original.y) };
    const ratio = (now.x * original.x + now.y * original.y)
      / (original.x * original.x + original.y * original.y);
    const uniform = clamp(Math.min(scaleX, scaleY) * ratio) / Math.min(scaleX, scaleY);
    return { scaleX: clamp(scaleX * uniform), scaleY: clamp(scaleY * uniform) };
  }
  function anchorPreservingPosition({ anchor, pivot, rotation = 0, ratioX = 1, ratioY = 1 }) {
    const radians = rotation * Math.PI / 180;
    const c = Math.cos(radians), s = Math.sin(radians);
    const dx = anchor.x - pivot.x, dy = anchor.y - pivot.y;
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;
    return { x: anchor.x - c * ratioX * lx + s * ratioY * ly,
      y: anchor.y - s * ratioX * lx - c * ratioY * ly };
  }
  // 他の素材への吸着は、揃えとして意味のある組み合わせ（中央どうし・同じ辺どうし・隣接する辺）
  // だけに絞る。辺と中央の交差まで候補にすると、小さい素材ほど近くに候補がひしめいて飛び移る。
  // 添字は coordinates() の並び（0: 左/上, 1: 中央, 2: 右/下）。
  const ITEM_PAIRS = new Set(['0:0', '1:1', '2:2', '0:2', '2:0']);
  const CENTER_EDGE_PAIRS = new Set(['1:0', '1:2', '0:1', '2:1']);
  // 吸着距離（表示px）。画面中央と他の素材は 6px、画面の端は 4px。
  // 端と素材の距離は options で上書きできる。
  const CANVAS_EDGE_TOLERANCE = 4;
  const ITEM_TOLERANCE = 6;
  // 保持中の吸着先から乗り換えるのは、この差以上に近い候補が現れたとき（または、より近い画面の端・中央）。
  const SWITCH_MARGIN = 2;
  // options.previous: 直前に吸着していた先（{x, y}）。
  // options.fast: 素早く動かしている最中（true か軸別の {x, y}）。その軸では新しく吸着しない。
  function snapBounds(moving, others, canvas, displayScale = 1, tolerance = 6, options = {}) {
    const edgeTolerance = Number.isFinite(options.edgeTolerance) ? options.edgeTolerance
      : Math.min(tolerance, CANVAS_EDGE_TOLERANCE);
    const itemTolerance = Number.isFinite(options.itemTolerance) ? options.itemTolerance
      : Math.min(tolerance, ITEM_TOLERANCE);
    const coordinates = (b, axis) => axis === 'x'
      ? [b.left, (b.left + b.right) / 2, b.right]
      : [b.top, (b.top + b.bottom) / 2, b.bottom];
    const pick = axis => {
      const own = coordinates(moving, axis);
      const coefficients = options.sourceCoefficients?.[axis];
      const size = axis === 'x' ? canvas.width : canvas.height;
      const previous = options.previous?.[axis] ?? null;
      const fast = typeof options.fast === 'object' && options.fast !== null
        ? Boolean(options.fast[axis]) : Boolean(options.fast);
      const targets = [
        ...[0, size / 2, size].map((value, targetIndex) => ({ value, kind: 'canvas', bounds: null, targetIndex })),
        ...others.flatMap(bounds => coordinates(bounds, axis)
          .map((value, targetIndex) => ({ value, kind: 'item', bounds, targetIndex })))
      ];
      const initial = options.initialBounds && coordinates(options.initialBounds, axis);
      // A resize must be able to leave a guide that its own edge/centre occupied
      // on pointerdown. Otherwise that initial alignment solves back to the old size.
      const startedOnTarget = (sourceIndex, target) => initial
        && Math.abs(initial[sourceIndex] - target.value) * displayScale <= .5;
      const limitFor = target => target.kind === 'item' ? itemTolerance
        : target.targetIndex === 1 ? tolerance : edgeTolerance;
      // いったん吸着した先は、その吸着距離を超えて離れるまで保つ。近くの別候補へ毎回
      // 選び直すと、素早いドラッグで候補から候補へ飛び移って見える。
      let held = null;
      if (previous && Number.isInteger(previous.sourceIndex) && Number.isFinite(previous.target)
        && (!coefficients || Math.abs(coefficients[previous.sourceIndex]) > 1e-9)
        && (!options.centerPriority?.[axis] || previous.sourceIndex === 1)) {
        const kept = targets.find(target => target.kind === previous.kind
          && Math.abs(target.value - previous.target) <= 1e-6
          && !startedOnTarget(previous.sourceIndex, target));
        const correction = previous.target - own[previous.sourceIndex];
        if (kept && Number.isFinite(correction) && Math.abs(correction) * displayScale <= limitFor(kept)) {
          held = { ...previous, correction, bounds: kept.bounds, distance: Math.abs(correction) * displayScale };
        }
      }
      const finish = snap => snap && { ...snap, guide: guideFor(axis, moving, snap.bounds, canvas) };
      if (fast) return finish(held);
      const candidates = [];
      own.forEach((source, sourceIndex) => targets.forEach(target => {
        if (coefficients && !(Math.abs(coefficients[sourceIndex]) > 1e-9)) return;
        if (startedOnTarget(sourceIndex, target)) return;
        if (target.kind === 'item' && !ITEM_PAIRS.has(sourceIndex + ':' + target.targetIndex)
          && !(options.centerToItemEdges && CENTER_EDGE_PAIRS.has(sourceIndex + ':' + target.targetIndex))) return;
        const correction = target.value - source;
        const distance = Math.abs(correction) * displayScale;
        if (distance > limitFor(target)) return;
        candidates.push({ correction, target: target.value, sourceIndex, targetIndex: target.targetIndex,
          kind: target.kind, bounds: target.bounds, distance });
      }));
      // Congruent shapes produce the same correction for left/centre/right (or top/centre/bottom).
      // If the canvas centre lies 1-2 px from the other shape's centre, an earlier canvas
      // magnet otherwise wins and leaves the two shapes visibly misaligned.
      if (options.preferMatchingItem) {
        const matching = candidates.filter(candidate => candidate.kind === 'item'
          && candidate.sourceIndex === 1 && candidate.targetIndex === 1
          && Math.abs((own[2] - own[0])
            - (coordinates(candidate.bounds, axis)[2] - coordinates(candidate.bounds, axis)[0]))
            * displayScale <= .5);
        if (matching.length) {
          const closest = matching.reduce((best, candidate) =>
            candidate.distance < best.distance ? candidate : best);
          return finish(closest);
        }
      }
      // 保持中でも、はっきり近い候補や、より近い画面の端・中央へは乗り換える
      // （素材の辺に掴まったまま画面中央へ合わせられない、を防ぐ）。
      // Prefer a line's ink centre when it reaches a guide, but retain stroke-edge snaps elsewhere.
      const eligible = options.centerPriority?.[axis] && candidates.some(candidate => candidate.sourceIndex === 1)
        ? candidates.filter(candidate => candidate.sourceIndex === 1) : candidates;
      const pool = held && !options.nearest ? eligible.filter(candidate => candidate.distance + SWITCH_MARGIN <= held.distance
        || (candidate.kind === 'canvas' && held.kind !== 'canvas' && candidate.distance < held.distance)) : eligible;
      if (held && pool.length === 0) return finish(held);
      let best = null;
      const equalDistance = options.nearest ? 1e-6 : .5;
      for (const candidate of pool) {
        const visiblyEqual = best && Math.abs(candidate.distance - best.distance) <= equalDistance;
        const edge = snap => snap.sourceIndex !== 1 || snap.targetIndex !== 1;
        if (!best || candidate.distance < best.distance - equalDistance ||
          (visiblyEqual && candidate.kind === 'canvas' && best.kind !== 'canvas') ||
          (visiblyEqual && candidate.kind === best.kind && edge(candidate) && !edge(best))) best = candidate;
      }
      return finish(best);
    };
    return { x: pick('x'), y: pick('y') };
  }
  // at(s) supplies the visible bounds at scale s. Each edge and centre must be affine
  // in s; this also covers a rotated rectangle while its rotation stays fixed.
  function snapScale({ scale, at, others = [], canvas, displayScale = 1, tolerance = 6,
    previous = null, initialBounds = null, options = {}, clamp = value => value }) {
    if (!Number.isFinite(scale) || typeof at !== 'function') return null;
    const bounds = at(scale);
    const next = at(scale + 1);
    if (!bounds || !next) return null;
    const coefficients = {};
    for (const [axis, first, last] of [['x', 'left', 'right'], ['y', 'top', 'bottom']]) {
      const a = next[first] - bounds[first], b = next[last] - bounds[last];
      coefficients[axis] = [a, (a + b) / 2, b];
    }
    const snaps = snapBounds(bounds, others, canvas, displayScale, tolerance,
      { ...options, previous, initialBounds, sourceCoefficients: coefficients });
    const choices = ['x', 'y'].flatMap(axis => {
      const snap = snaps[axis];
      if (!snap) return [];
      const coefficient = coefficients[axis][snap.sourceIndex];
      const solved = clamp(scale + snap.correction / coefficient);
      return Number.isFinite(solved) && Math.abs(solved - (scale + snap.correction / coefficient)) < 1e-6
        ? [{ axis, snap, solved, distance: Math.abs(snap.correction) * displayScale }] : [];
    });
    choices.sort((a, b) => a.distance - b.distance);
    const chosen = choices[0];
    return { scale: chosen?.solved ?? scale,
      snapX: chosen?.axis === 'x' ? chosen.snap : null,
      snapY: chosen?.axis === 'y' ? chosen.snap : null };
  }
  function guideFor(axis, moving, other, canvas) {
    return axis === 'x'
      ? { start: other ? Math.min(moving.top, other.top) : 0,
        end: other ? Math.max(moving.bottom, other.bottom) : canvas.height }
      : { start: other ? Math.min(moving.left, other.left) : 0,
        end: other ? Math.max(moving.right, other.right) : canvas.width };
  }
  function snapEndpoint(point, others, canvas, displayScale = 1, tolerance = 6, options = {}) {
    // 線の端点は 1 点（左・中央・右が同じ値）なので、組み合わせを絞っても相手のどの辺・中央へも届く。
    // 端点を相手の角へ正確に置く用途のため、吸着距離は従来どおり画面の端・中央と同じにする。
    return snapBounds({ left: point.x, right: point.x, top: point.y, bottom: point.y },
      others, canvas, displayScale, tolerance, { itemTolerance: tolerance, edgeTolerance: tolerance, ...options });
  }
  function solveLineEndpoint(fixed, pointer, others, canvas, displayScale = 1, disabled = false,
    anglePointer = pointer) {
    if (!disabled) {
      const snap = snapEndpoint(pointer, others, canvas, displayScale);
      if (snap.x || snap.y) return { point: { x: pointer.x + (snap.x?.correction ?? 0),
        y: pointer.y + (snap.y?.correction ?? 0) }, snap };
    }
    const dx = pointer.x - fixed.x, dy = pointer.y - fixed.y;
    const pointerAngle = normalizeAngle(Math.atan2(anglePointer.y - fixed.y,
      anglePointer.x - fixed.x) * 180 / Math.PI);
    const target = normalizeAngle(Math.round(pointerAngle / 45) * 45);
    if (disabled || Math.abs(normalizeAngle(pointerAngle - target)) > 4) {
      return { point: pointer, snap: { x: null, y: null } };
    }
    const length = Math.hypot(dx, dy);
    return { point: { x: fixed.x + length * Math.cos(target * Math.PI / 180),
      y: fixed.y + length * Math.sin(target * Math.PI / 180) }, snap: { x: null, y: null } };
  }
  function lineTransform({ fixed, originalMoving, moving, movingEndpoint, stageCenter, pose }) {
    const oldLength = Math.hypot(originalMoving.x - fixed.x, originalMoving.y - fixed.y);
    const newLength = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
    if (!(oldLength > 0) || !(newLength > 0)) return null;
    const oldAngle = (pose.rotate ?? 0) * Math.PI / 180;
    const newAngle = Math.atan2(
      movingEndpoint === 'start' ? fixed.y - moving.y : moving.y - fixed.y,
      movingEndpoint === 'start' ? fixed.x - moving.x : moving.x - fixed.x);
    const oldScaleX = pose.scaleX ?? pose.scale ?? 1;
    const oldScaleY = pose.scaleY ?? pose.scale ?? 1;
    const newScaleX = oldScaleX * newLength / oldLength;
    const fx = fixed.x - stageCenter.x - (pose.x ?? 0);
    const fy = fixed.y - stageCenter.y - (pose.y ?? 0);
    const lx = (Math.cos(oldAngle) * fx + Math.sin(oldAngle) * fy) / oldScaleX;
    const ly = (-Math.sin(oldAngle) * fx + Math.cos(oldAngle) * fy) / oldScaleY;
    return {
      x: fixed.x - stageCenter.x - (Math.cos(newAngle) * newScaleX * lx - Math.sin(newAngle) * oldScaleY * ly),
      y: fixed.y - stageCenter.y - (Math.sin(newAngle) * newScaleX * lx + Math.cos(newAngle) * oldScaleY * ly),
      scaleX: newScaleX, scaleY: oldScaleY, rotate: normalizeAngle(newAngle * 180 / Math.PI)
    };
  }
  return { normalizeAngle, snapAngle, axisLock, rotationAroundPoint,
    anchoredScales, anchorPreservingPosition,
    snapBounds, snapScale, snapEndpoint, solveLineEndpoint, lineTransform };
})();
