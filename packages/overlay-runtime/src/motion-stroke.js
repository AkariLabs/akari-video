(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.akari = root.akari || {}; root.akari.motionStroke = api; }
})(typeof window === 'undefined' ? null : window, function () {
  function lineDistance(point, first, last) {
    const dx = last.x - first.x, dy = last.y - first.y;
    const length = dx * dx + dy * dy;
    if (length === 0) return Math.hypot(point.x - first.x, point.y - first.y);
    const u = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / length));
    return Math.hypot(point.x - first.x - u * dx, point.y - first.y - u * dy);
  }
  function thinIndices(points, tolerance) {
    const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let distance = -1, index = -1;
      for (let i = first + 1; i < last; i++) {
        const next = lineDistance(points[i], points[first], points[last]);
        if (next > distance) { distance = next; index = i; }
      }
      if (distance > tolerance) { keep.add(index); stack.push([first, index], [index, last]); }
    }
    return [...keep].sort((a, b) => a - b);
  }
  function strokeToXYKeyframes(samples, { fps, startFrame, durationFrames, mode = 'speed' }) {
    if (!Array.isArray(samples) || samples.length < 2 || !(fps > 0)
      || !Number.isInteger(startFrame) || !Number.isInteger(durationFrames) || durationFrames < 1) return [];
    const points = samples.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.ms));
    if (points.length < 2) return [];
    let tolerance = 2, indices;
    do { indices = thinIndices(points, tolerance); tolerance *= 1.5; } while (indices.length > 32);
    const first = points[0], last = points[points.length - 1];
    const start = Math.max(0, Math.min(durationFrames - 1, startFrame));
    const span = Math.max(1, Math.min(durationFrames - start, Math.round((last.ms - first.ms) * fps / 1000)));
    const frameOf = (index, order) => start + Math.round(span * (mode === 'uniform'
      ? order / (indices.length - 1)
      : Math.max(0, Math.min(1, (points[index].ms - first.ms) / Math.max(1, last.ms - first.ms)))));
    const result = [];
    indices.forEach((index, order) => {
      const point = points[index], next = { t: frameOf(index, order), transform: { x: point.x, y: point.y } };
      if (result.at(-1)?.t === next.t) result[result.length - 1] = next;
      else result.push(next);
    });
    if (result.length < 2) result.push({ t: start + span, transform: { x: last.x, y: last.y } });
    return result;
  }
  function positionKeyframeRange(points, fps, unit = 'seconds') {
    const times = (Array.isArray(points) ? points : [])
      .filter(point => Number.isFinite(point?.t)
        && (Number.isFinite(point.transform?.x) || Number.isFinite(point.transform?.y)))
      .map(point => unit === 'frames' ? point.t / fps : point.t);
    return times.length ? { start: Math.min(...times), end: Math.max(...times) } : null;
  }
  function createStrokeFeedback() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645';
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);'
      + 'max-width:min(90vw,600px);padding:8px 14px;pointer-events:none;z-index:2147483646;'
      + 'background:var(--theia-editorWidget-background);color:var(--theia-foreground);'
      + 'border:1px solid var(--theia-focusBorder);border-radius:6px;'
      + 'font:12px/1.5 var(--theia-ui-font-family, sans-serif);text-align:center';
    document.body.append(canvas, label);
    const draw = points => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(window.innerWidth * dpr);
      canvas.height = Math.ceil(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      if (!points.length) return;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--theia-focusBorder').trim() || '#e07836';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    };
    return { show: text => { label.textContent = text; }, draw,
      dispose: () => { canvas.remove(); label.remove(); } };
  }
  return Object.freeze({ strokeToXYKeyframes, positionKeyframeRange, createStrokeFeedback });
});
