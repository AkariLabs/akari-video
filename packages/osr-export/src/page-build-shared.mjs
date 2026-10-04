import { readFile } from "node:fs/promises";
import { resolveLutPath } from "../../render-cut/src/render-inputs.mjs";

export function effectiveAdjustLutRef(item) {
  if (item?.adjust?.sections?.lut === false) return null;
  const ref = item?.adjust?.lut?.lut;
  return typeof ref === "string" && ref !== "" ? ref : null;
}

export function hasEffectiveItemAdjust(edit) {
  return [...(edit?.cuts ?? []), ...(edit?.layers ?? [])].some((item) => {
    const adjust = item?.adjust;
    const basic = item?.adjust?.sections?.basic === false ? null : item?.adjust?.basic;
    const hasBasic = basic && Object.values(basic).some((value) => Number.isFinite(value) && Math.abs(value) > 1e-6);
    const intensity = Number(item?.adjust?.lut?.intensity ?? 1);
    // Match kernel normalization and identity tolerances without a runtime dependency.
    const clamp01 = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const hasWheels = adjust?.sections?.wheels !== false
      && ['lift', 'gamma', 'gain', 'offset'].some(wheel =>
        ['r', 'g', 'b'].some(channel => {
          const value = adjust?.wheels?.[wheel]?.[channel];
          return Number.isFinite(value) && value !== 0;
        }));
    const hasCurves = adjust?.sections?.curves !== false
      && ['master', 'r', 'g', 'b'].some(channel => {
        const raw = adjust?.curves?.[channel];
        if (raw == null) return false;
        const points = raw.map(point => ({ in: clamp01(point.in), out: clamp01(point.out) }))
          .sort((a, b) => a.in - b.in);
        return !(points.length === 2
          && Math.abs(points[0].in) < 1e-5 && Math.abs(points[0].out) < 1e-5
          && Math.abs(points[1].in - 1) < 1e-5 && Math.abs(points[1].out - 1) < 1e-5);
      });
    const hasHue = adjust?.sections?.hue !== false
      && ['hue', 'sat', 'luma'].some(channel =>
        (adjust?.hue?.[channel] ?? []).some(point =>
          Math.abs((Number.isFinite(point.value) ? clamp01(point.value) : 0.5) - 0.5) > 1e-4));
    return Boolean(hasBasic || hasWheels || hasCurves || hasHue || (effectiveAdjustLutRef(item) && (!Number.isFinite(intensity) || intensity > 0)));
  });
}

export async function resolveItemAdjustLutCubeTexts(edit, projectRoot) {
  const table = {};
  const items = [
    ...(edit?.cuts ?? []).map((item, index) => ({ item, id: String(item?.id ?? `cut-${index}`) })),
    ...(edit?.layers ?? []).map((item, index) => ({ item, id: String(item?.id ?? `layer-${index}`) })),
  ];
  await Promise.all(items.map(async ({ item, id }) => {
    const ref = effectiveAdjustLutRef(item);
    if (!ref) return;
    try {
      table[id] = await readFile(resolveLutPath(projectRoot, ref), "utf8");
    } catch (error) {
      throw new Error(`item adjust LUT ${ref} for ${id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return table;
}

export async function readJsonIfPresent(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

export function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function inlineScript(value) {
  return value.replace(/<\/script/giu, "<\\/script");
}

export function inferDuration(edit) {
  // reduce skips holes in sparse cuts arrays.
  return (edit.cuts ?? []).reduce((total, cut) => {
    const speed = Number(cut.speed ?? 1) || 1;
    const freeze = Number(cut.freeze?.duration_sec ?? 0) || 0;
    const transition = Number(cut.transition_out?.duration ?? 0) || 0;
    return total + Math.max(0, (Number(cut.out ?? 0) - Number(cut.in ?? 0)) / speed + freeze - transition);
  }, 0);
}

export function buildMediaPlaneSummary(edit, internal, overlays, captionZ) {
  const tracks = internal?.tracks ?? [];
  const itemTrackId = Object.create(null);
  const visit = (item, trackId) => {
    if (item?.id != null) itemTrackId[String(item.id)] = trackId;
    for (const child of item?.children ?? item?.items ?? []) visit(child, trackId);
  };
  for (const track of tracks) for (const item of track.items ?? []) visit(item, track.id);

  // Match resolvePreviewItemStackOrder: the expanded scale is needed only for grouped captions.
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
