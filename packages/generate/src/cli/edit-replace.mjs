function round(value) {
  return Number(value.toFixed(6));
}

export function planReplacement({ item: _item, sourceEntry: _sourceEntry, actualDurationS, cutsDurationS }) {
  if (!Number.isFinite(actualDurationS) || actualDurationS < 0
    || !Number.isFinite(cutsDurationS) || cutsDurationS <= 0) {
    throw new Error("差し替え尺は有限の正数である必要があります");
  }
  const mismatch_s = round(Math.abs(actualDurationS - cutsDurationS));
  const shorter = actualDurationS < cutsDurationS;
  return {
    in: 0,
    out: round(shorter ? actualDurationS : cutsDurationS),
    freeze: shorter
      ? { at_sec: round(actualDurationS), duration_sec: round(cutsDurationS - actualDurationS) }
      : null,
    mismatch_s,
    warn: mismatch_s > 0.5,
  };
}

function visitItems(items, callback) {
  for (const item of items ?? []) {
    if (callback(item)) return item;
    if (Array.isArray(item.items)) {
      const found = visitItems(item.items, callback);
      if (found) return found;
    }
  }
  return null;
}

export function findItem(edit, itemId) {
  for (const track of edit.tracks ?? []) {
    const found = visitItems(track.items, (item) => item.id === itemId);
    if (found) return found;
  }
  return null;
}

export function applyReplacement(project, { itemId, mp4RelativePath, plan }) {
  const item = findItem(project.edit, itemId);
  if (!item) throw new Error(`item が見つかりません: ${itemId}`);
  if (item.source?.kind !== "media") throw new Error(`item は media ではありません: ${itemId}`);
  const sourceId = `gen-${itemId}-video`;
  const existing = project.edit.sources.find((source) => source.id === sourceId);
  if (existing) {
    existing.path = mp4RelativePath;
    existing.proxy = null;
  } else {
    project.edit.sources.push({ id: sourceId, path: mp4RelativePath, proxy: null });
  }
  item.source = {
    ...item.source,
    src: sourceId,
    in: plan.in,
    out: plan.out,
    freeze: plan.freeze,
    mute: true,
  };
  return { item, sourceId };
}
