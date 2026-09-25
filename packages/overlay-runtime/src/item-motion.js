/* Pure item motion evaluator. Times are output seconds; keyframe t is in frames unless keyframeUnit is "seconds". */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.akari = root.akari || {}; root.akari.itemMotion = api; }
})(typeof window === 'undefined' ? null : window, function () {
  const number = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const clamp = v => Math.max(0, Math.min(1, v));
  const axes = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity'];
  const read = (point, axis) => axis === 'opacity' ? point.opacity
    : axis === 'scaleX' || axis === 'scaleY'
      ? point.transform?.[axis] ?? point.transform?.scale : point.transform?.[axis];
  function ease(name, value) {
    const u = clamp(value);
    if (name === 'hold') return u < 1 ? 0 : 1;
    if (u === 0 || u === 1) return u;
    const polynomial = /^(in|out|in-out)-(quad|cubic|quart)$/.exec(name ?? '');
    if (polynomial) {
      const power = polynomial[2] === 'quad' ? 2 : polynomial[2] === 'cubic' ? 3 : 4;
      if (polynomial[1] === 'in') return u ** power;
      if (polynomial[1] === 'out') return 1 - (1 - u) ** power;
      return u < .5 ? (2 * u) ** power / 2 : 1 - (2 * (1 - u)) ** power / 2;
    }
    if (name === 'ease-in-out' || name === 'in-out-cubic') return u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    if (name === 'in-expo') return 2 ** (10 * u - 10);
    if (name === 'out-expo') return 1 - 2 ** (-10 * u);
    if (name === 'in-out-expo') return u < .5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2;
    const back = 1.70158;
    if (name === 'in-back') return (back + 1) * u ** 3 - back * u ** 2;
    if (name === 'out-back') return 1 + (back + 1) * (u - 1) ** 3 + back * (u - 1) ** 2;
    if (name === 'in-out-back') {
      const c = back * 1.525;
      return u < .5 ? (2 * u) ** 2 * ((c + 1) * 2 * u - c) / 2
        : ((2 * u - 2) ** 2 * ((c + 1) * (2 * u - 2) + c) + 2) / 2;
    }
    if (name === 'out-bounce') {
      const n = 7.5625, d = 2.75;
      if (u < 1 / d) return n * u * u;
      if (u < 2 / d) return n * (u - 1.5 / d) ** 2 + .75;
      if (u < 2.5 / d) return n * (u - 2.25 / d) ** 2 + .9375;
      return n * (u - 2.625 / d) ** 2 + .984375;
    }
    if (name === 'out-elastic') return 2 ** (-10 * u) * Math.sin((10 * u - .75) * (2 * Math.PI / 3)) + 1;
    const bezier = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)\s*\)$/.exec(name ?? '');
    if (bezier) {
      const [x1, y1, x2, y2] = bezier.slice(1).map(Number);
      if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) {
        const coordinate = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
        let low = 0, high = 1;
        for (let i = 0; i < 48; i++) {
          const t = (low + high) / 2;
          if (coordinate(t, x1, x2) < u) low = t;
          else high = t;
        }
        return coordinate((low + high) / 2, y1, y2);
      }
    }
    return u;
  }
  function keyframeValue(item, axis, localSeconds, fallback) {
    const fps = number(item.fps, 30);
    const t = item.keyframeUnit === 'seconds' ? localSeconds : localSeconds * fps;
    const points = (Array.isArray(item.keyframes) ? item.keyframes : [])
      .filter(p => p && Number.isFinite(p.t) && Number.isFinite(read(p, axis)))
      .slice().sort((a, b) => a.t - b.t);
    if (!points.length) return fallback;
    if (t <= points[0].t) return read(points[0], axis);
    const last = points[points.length - 1];
    if (t >= last.t) return read(last, axis);
    for (let i = 1; i < points.length; i++) {
      const b = points[i], a = points[i - 1];
      if (t > b.t) continue;
      const names = b.easing;
      const name = typeof names === 'string' ? names : names?.[axis] ?? names?.transform?.[axis] ?? names?.transform;
      const u = ease(name, (t - a.t) / (b.t - a.t || 1));
      return read(a, axis) + (read(b, axis) - read(a, axis)) * u;
    }
    return fallback;
  }
  function base(item, localSeconds) {
    const statics = item.transform ?? {};
    const result = {};
    for (const axis of axes) {
      const fallback = axis === 'opacity' ? number(item.opacity, 1)
        : number(statics[axis], axis.startsWith('scale') ? number(statics.scale, 1) : 0);
      result[axis] = keyframeValue(item, axis, localSeconds, fallback);
    }
    for (const axis of ['scaleX', 'scaleY']) {
      if (statics[axis] === undefined && !(Array.isArray(item.keyframes) ? item.keyframes : [])
        .some(point => Number.isFinite(point?.transform?.[axis]))) {
        result[axis] = result.scale;
      }
    }
    return result;
  }
  function effect(motion, localSeconds, duration, fps) {
    const result = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };
    if (!motion || duration <= 0) return result;
    for (const seat of ['in', 'out']) {
      const spec = motion[seat];
      const span = number(spec?.duration, 0) / fps;
      if (!spec || !Number.isFinite(span) || span <= 0) continue;
      const progress = seat === 'in' ? localSeconds / span : 1 - (duration - localSeconds) / span;
      const hidden = seat === 'in' ? 1 - ease(spec.ease, progress) : ease(spec.ease, progress);
      const amount = number(spec.amount, ({ scale: .2, pop: .25, zoom: .55, twirl: 200 })[spec.preset] ?? 40);
      switch (spec.preset) {
        case 'fade': result.opacity *= clamp(1 - hidden); break;
        case 'slide-up': result.dy += hidden * amount; break;
        case 'slide-down': result.dy -= hidden * amount; break;
        case 'slide-left': result.dx += hidden * amount; break;
        case 'slide-right': result.dx -= hidden * amount; break;
        case 'scale': result.scale *= 1 - hidden * amount; break;
        case 'pop': result.scale *= Math.max(.01, 1 - hidden * (1 - amount)); result.opacity *= clamp(1 - hidden); break;
        case 'zoom': result.scale *= 1 + hidden * amount; result.opacity *= clamp(1 - hidden); break;
        case 'twirl': result.rotate -= hidden * amount; result.scale *= 1 - hidden * .65;
          result.opacity *= clamp(1 - hidden); break;
        case 'wipe': {
          const width = clamp(1 - hidden);
          result.reveal = { x: 0, y: 0, w: Math.min(result.reveal?.w ?? 1, width), h: 1 };
          break;
        }
      }
    }
    const loop = motion.loop;
    const period = number(loop?.period, 0) / fps;
    if (loop && Number.isFinite(period) && period > 0) {
      const phase = ease(loop.ease, ((localSeconds % period + period) % period) / period);
      if (loop.preset === 'pulse') result.scale *= 1 + number(loop.amount, .05) * Math.sin(2 * Math.PI * phase);
      if (loop.preset === 'float') result.dy += number(loop.amount, 6) * Math.sin(2 * Math.PI * phase);
      if (loop.preset === 'spin') result.rotate += 360 * phase * number(loop.amount, 1);
      if (loop.preset === 'blink') result.opacity *= clamp(1 - number(loop.amount, .75) * (phase > .55 ? 1 : 0));
      if (loop.preset === 'jiggle') {
        const strength = number(loop.amount, 1);
        result.dx += Math.sin(18 * Math.PI * phase) * 4 * strength;
        result.rotate += Math.sin(12 * Math.PI * phase) * 2.5 * strength;
      }
    }
    return result;
  }
  function compose(parent, child) {
    const angle = parent.rotate * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const scale = parent.scale;
    const a = parent.reveal, b = child.reveal;
    const reveal = a && b ? (() => {
      const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
      return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
        h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
    })() : a ?? b;
    return {
      ...child,
      x: parent.x + scale * (cos * child.x - sin * child.y),
      y: parent.y + scale * (sin * child.x + cos * child.y),
      scale: scale * child.scale,
      scaleX: parent.scaleX * child.scaleX,
      scaleY: parent.scaleY * child.scaleY,
      rotate: parent.rotate + child.rotate,
      opacity: parent.opacity * child.opacity,
      ...(reveal ? { reveal } : {}),
    };
  }
  function local(item, t) {
    const localSeconds = t - number(item.at, 0);
    const value = base(item, localSeconds);
    const fx = effect(item.motion, localSeconds, number(item.duration, 0), number(item.fps, 30));
    return { x: value.x + fx.dx, y: value.y + fx.dy,
      scale: value.scale * fx.scale, scaleX: value.scaleX * fx.scale,
      scaleY: value.scaleY * fx.scale, rotate: value.rotate + fx.rotate,
      opacity: value.opacity * fx.opacity, ...(fx.reveal ? { reveal: fx.reveal } : {}) };
  }
  function evaluateItemMotion(item, t, parentChain = []) {
    let value = local(item, t);
    for (const parent of parentChain) value = compose(local(parent, t), value);
    return { ...value, opacity: clamp(value.opacity) };
  }
  function evaluateOverlayMotion(record, t, fps) {
    const item = record.motionSource
      ? { ...record.motionSource, fps }
      : { at: number(record.start, 0), duration: number(record.duration, 0), fps,
        keyframeUnit: record.keyframeUnit ?? 'frames', transform: record.transform,
        opacity: record.opacity, keyframes: record.keyframes, motion: record.motion };
    const parents = (record.motionParents ?? []).map(parent => ({ ...parent, fps }));
    return evaluateItemMotion(item, t, parents);
  }
  function motionRevealCss(state) {
    const box = state.reveal;
    return box ? 'inset(' + (box.y * 100) + '% ' + ((1 - box.x - box.w) * 100)
      + '% ' + ((1 - box.y - box.h) * 100) + '% ' + (box.x * 100) + '%)' : '';
  }
  function invertItemMotionPosition(item, t, parentChain, finalX, finalY) {
    let x = finalX, y = finalY;
    for (const parent of [...parentChain].reverse()) {
      const p = local(parent, t), angle = -p.rotate * Math.PI / 180;
      const dx = x - p.x, dy = y - p.y, scale = p.scale;
      if (!Number.isFinite(scale) || Math.abs(scale) < Number.EPSILON) {
        throw new Error('親の拡縮を逆算できません');
      }
      x = (Math.cos(angle) * dx - Math.sin(angle) * dy) / scale;
      y = (Math.sin(angle) * dx + Math.cos(angle) * dy) / scale;
    }
    const fx = effect(item.motion, t - number(item.at, 0), number(item.duration, 0), number(item.fps, 30));
    return { x: x - fx.dx, y: y - fx.dy };
  }
  function dragItemMotionPosition(item, t, parentChain, visibleStart, dx, dy) {
    const visible = { x: visibleStart.x + dx, y: visibleStart.y + dy };
    return { visible, base: invertItemMotionPosition(item, t, parentChain, visible.x, visible.y) };
  }
  return Object.freeze({ evaluateItemMotion, evaluateOverlayMotion, motionRevealCss,
    invertItemMotionPosition, dragItemMotionPosition });
});
