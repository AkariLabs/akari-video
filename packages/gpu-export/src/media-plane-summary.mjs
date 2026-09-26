// OSR の buildMediaPlaneSummary と同じ入力射影。帯を切る規則そのものは
// edit-store の partitionPreviewMediaPlanes だけが持つ。
export function buildMediaPlaneSummary(edit, internal, overlays, captionZ) {
  const tracks = internal?.tracks ?? [];
  const itemTrackId = Object.create(null);
  const visit = (item, trackId) => {
    if (item?.id != null) itemTrackId[String(item.id)] = trackId;
    for (const child of item?.children ?? item?.items ?? []) visit(child, trackId);
  };
  for (const track of tracks) for (const item of track.items ?? []) visit(item, track.id);

  const hasGroupedCaption = (items, insideGroup = false) => (items ?? []).some(item =>
    (insideGroup && ["caption", "captions"].includes(item.source?.kind))
    || hasGroupedCaption(item.children ?? item.items, insideGroup || item.source?.kind === "group"));
  const expanded = tracks.some(track => hasGroupedCaption(track.items));
  const itemStackZ = Object.create(null);
  const trackStackZ = Object.create(null);
  if (expanded) {
    let z = 0;
    const stack = items => {
      for (const item of items ?? []) {
        if (item.id) itemStackZ[String(item.id)] = z;
        z++;
        stack(item.children ?? item.items);
      }
    };
    for (const track of tracks) {
      trackStackZ[String(track.id)] = z++;
      stack(track.items);
    }
  }
  const itemIdForRecord = record => {
    const id = String(record?.id ?? "");
    const candidates = [id, String(record?.parentId ?? ""), id.split("::")[0], id.split("#")[0]];
    return candidates.find(candidate => Object.hasOwn(itemTrackId, candidate));
  };
  const mediaEntry = (item, index, prefix) => {
    const id = String(item?.id ?? `${prefix}-${index}`);
    const trackId = itemTrackId[id];
    return { id, trackId, renderTrack: trackId !== undefined ? tracks.findIndex(track => track.id === trackId)
      : Number.isInteger(item?.renderTrack) ? item.renderTrack
        : Number.isInteger(item?.track) ? item.track : 0 };
  };
  const cuts = (edit.cuts ?? []).map((item, index) => mediaEntry(item, index, "cut"));
  const layers = (edit.layers ?? []).map((item, index) => mediaEntry(item, index, "layer"));
  const barrierZ = overlays.map(overlay => {
    const itemId = itemIdForRecord(overlay);
    if (itemId !== undefined && Number.isInteger(itemStackZ[itemId])) return itemStackZ[itemId];
    const z = Number.isInteger(overlay.z) ? overlay.z : captionZ;
    return expanded && z < tracks.length ? trackStackZ[String(tracks[z].id)] ?? z : z;
  });
  return {
    timelineTracks: tracks.map(track => ({ id: track.id })),
    ...(expanded ? { itemStackZ, trackStackZ } : {}),
    cutsById: Object.fromEntries(cuts.map(cut => [cut.id, cut])),
    layers: [...cuts, ...layers],
    barrierZ,
  };
}
