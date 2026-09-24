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
  function snapBounds(moving, others, canvas, displayScale = 1, tolerance = 6) {
    const coordinates = (b, axis) => axis === 'x'
      ? [b.left, (b.left + b.right) / 2, b.right]
      : [b.top, (b.top + b.bottom) / 2, b.bottom];
    const pick = axis => {
      const own = coordinates(moving, axis);
      const targets = [
        ...[0, (axis === 'x' ? canvas.width : canvas.height) / 2, axis === 'x' ? canvas.width : canvas.height]
          .map(value => ({ value, kind: 'canvas', bounds: null })),
        ...others.flatMap(bounds => coordinates(bounds, axis).map(value => ({ value, kind: 'item', bounds })))
      ];
      let best = null;
      own.forEach((source, sourceIndex) => targets.forEach(target => {
        const correction = target.value - source;
        const distance = Math.abs(correction) * displayScale;
        if (distance > tolerance) return;
        if (!best || distance < best.distance - 1e-7 ||
          (Math.abs(distance - best.distance) < 1e-7 && target.kind === 'canvas' && best.kind !== 'canvas')) {
          best = { correction, target: target.value, sourceIndex, kind: target.kind,
            bounds: target.bounds, distance };
        }
      }));
      if (!best) return null;
      const other = best.bounds;
      best.guide = axis === 'x'
        ? { start: other ? Math.min(moving.top, other.top) : 0,
          end: other ? Math.max(moving.bottom, other.bottom) : canvas.height }
        : { start: other ? Math.min(moving.left, other.left) : 0,
          end: other ? Math.max(moving.right, other.right) : canvas.width };
      return best;
    };
    return { x: pick('x'), y: pick('y') };
  }
  function snapEndpoint(point, others, canvas, displayScale = 1, tolerance = 6) {
    return snapBounds({ left: point.x, right: point.x, top: point.y, bottom: point.y },
      others, canvas, displayScale, tolerance);
  }
  function solveLineEndpoint(fixed, pointer, others, canvas, displayScale = 1, disabled = false) {
    if (!disabled) {
      const snap = snapEndpoint(pointer, others, canvas, displayScale);
      if (snap.x || snap.y) return { point: { x: pointer.x + (snap.x?.correction ?? 0),
        y: pointer.y + (snap.y?.correction ?? 0) }, snap };
    }
    const dx = pointer.x - fixed.x, dy = pointer.y - fixed.y;
    const angle = snapAngle(Math.atan2(dy, dx) * 180 / Math.PI, disabled);
    const length = Math.hypot(dx, dy);
    return { point: { x: fixed.x + length * Math.cos(angle * Math.PI / 180),
      y: fixed.y + length * Math.sin(angle * Math.PI / 180) }, snap: { x: null, y: null } };
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
  return { normalizeAngle, snapAngle, axisLock, anchoredScales, anchorPreservingPosition,
    snapBounds, snapEndpoint, solveLineEndpoint, lineTransform };
})();
