export function dbToGain(db) {
  return Math.pow(10, (db ?? 0) / 20);
}

export function resolveSfxWindow(declaration, bufferDuration) {
  const sourceIn = Number.isFinite(declaration?.in) && declaration.in > 0 ? declaration.in : 0;
  const sourceOut = Number.isFinite(declaration?.out) && declaration.out > 0
    ? Math.min(bufferDuration, declaration.out) : bufferDuration;
  const trimmed = Math.max(0, sourceOut - sourceIn);
  const declaredDuration = Number.isFinite(declaration?.duration) && declaration.duration > 0
    ? declaration.duration : null;
  return {
    sourceIn,
    effectiveDuration: declaredDuration === null ? trimmed : Math.min(trimmed, declaredDuration),
  };
}

export function scheduleSfxAt(node, outputTime) {
  const localT = Math.max(0, outputTime - node.t);
  return {
    when: 0,
    offset: node.sourceIn + localT,
    duration: Math.max(0, node.effectiveDuration - localT),
  };
}
