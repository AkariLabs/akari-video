const visualKinds = new Set(['media', 'html', 'shape', 'telop', 'filter', 'group', 'captions', 'caption']);

export function isSourceCompatibleWithLane(lane, kind) {
  return lane === 'audio' ? kind === 'media' : lane === 'visual' && visualKinds.has(kind);
}

export function isInlineOverlayHtml(value) {
  return typeof value === 'string' && value.trimStart().startsWith('<');
}
