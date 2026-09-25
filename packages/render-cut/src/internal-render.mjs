import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";

import { expandBagOverlays } from "../../overlay-runtime/src/parts.mjs";
import { generateCaptionOverlays } from "./captions.mjs";

const require = createRequire(import.meta.url);
const { readInternalEdit, resolveInternalTrackZ, projectLegacyAudioView, isAudioItemAudible, isCutAudioAudible, referencedCaptionSourceCount } = require("../../edit-store/lib/index.js");
const { flattenGroupDescendants } = require("../../edit-store/lib/group-flatten.js");
const projectRoots = new WeakMap();
const hiddenItemIds = new WeakMap();
const frameNormalizedHtmlItems = new WeakSet();


/**
 * edit.json の版差を読み込み層で吸収し、renderer が消費する組を作る。
 * expandParts は既定 true。compatibility / osr / gpu / preview の全経路で同じ袋展開を使い、
 * 非展開は互換性を明示的に調べる呼び出しだけが `{ expandParts: false }` で選ぶ。
 */
export function readRenderEdit(source, temporaryDirectory, { projectRoot, expandParts, onWarning, captions } = {}) {
  const raw = typeof source === "string" ? JSON.parse(source) : source;
  const internal = readInternalEdit(source, { captions });
  hiddenItemIds.set(internal, collectHiddenItemIds(raw));
  projectRoots.set(internal, projectRoot === undefined
    ? projectRootFromTemporaryDirectory(temporaryDirectory)
    : resolve(projectRoot));
  return {
    raw,
    internal,
    edit: projectRendererCompatibilityEdit(raw, internal, temporaryDirectory, projectRoot, {
      expandParts: expandParts ?? true,
      onWarning,
    }),
  };
}

/**
 * 既存の cut/audio/rasterize 実装へ渡す薄い互換ビュー。
 * visual 配列は生 JSON から再読出しせず、正規化済み tracks[].items[] だけから作る。
 */
export function projectRendererCompatibilityEdit(
  raw,
  internal,
  temporaryDirectory,
  projectRootOverride,
  { expandParts = true, onWarning } = {},
) {
  const mutedVisualItemIds = new Set();
  const collectMutedItemIds = (item, ids) => {
    if (item?.source?.kind === "media") ids.add(String(item.id));
    for (const child of item?.children ?? []) collectMutedItemIds(child, ids);
  };
  for (const track of internal.tracks) {
    if (track.lane !== "visual" || track.muted !== true) continue;
    for (const item of track.items) collectMutedItemIds(item, mutedVisualItemIds);
  }
  const ordered = flattenGroupDescendants(internal)
    .filter(({ item, descendant }) => !descendant || item.source.kind === "media")
    .sort((left, right) => left.order - right.order)
    .map(({ item }) => item);
  const cuts = [];
  const projectRoot = projectRootOverride === undefined
    ? projectRoots.get(internal) ?? projectRootFromTemporaryDirectory(temporaryDirectory)
    : resolve(projectRootOverride);
  resolveReferencedItemKeyframes(internal, projectRoot, onWarning, raw?.version === 2);
  const htmlOverlays = expandParts
    ? expandedHtmlOverlays(internal, projectRoot)
    : unexpandedHtmlOverlays(internal, temporaryDirectory);
  const layers = [];
  for (const item of ordered) {
    switch (renderItemKind(item)) {
      case "cut": {
        const declaration = renderItemDeclaration(item, temporaryDirectory);
        cuts.push(!isCutAudioAudible(declaration, { muted: mutedVisualItemIds.has(String(item.id)) }) ? { ...declaration, mute: true } : declaration);
        break;
      }
      case "html": break;
      case "layer": layers.push(renderItemDeclaration(item, temporaryDirectory)); break;
      default: break;
    }
  }

  const output = {
    ...(isRecord(raw?.output) ? raw.output : {}),
    ...(internal.output.width !== undefined ? { width: internal.output.width } : {}),
    ...(internal.output.height !== undefined ? { height: internal.output.height } : {}),
    fps: internal.output.fps,
    ...(internal.output.look !== undefined ? { look: internal.output.look } : {}),
  };
  const sources = internal.sources
    .filter(source => typeof source.path === "string")
    .map(source => ({
      id: source.id,
      path: source.path,
      proxy: source.proxy,
      ...(source.chromaKey !== undefined ? { chroma_key: source.chromaKey } : {}),
    }));
  const master = isRecord(raw?.audio) && raw.audio.master !== undefined
    ? raw.audio.master : undefined;
  const duckKeys = isRecord(raw?.audio) && raw.audio.duck_keys !== undefined
    ? raw.audio.duck_keys : undefined;
  const projectedAudio = projectLegacyAudioView(internal);
  const audio = {
    ...projectedAudio,
    sfx: projectedAudio.sfx.filter(item => isAudioItemAudible(undefined, item)),
    narration: projectedAudio.narration.filter(item => isAudioItemAudible(undefined, item)),
    ...(projectedAudio.speech ? { speech: projectedAudio.speech.filter(item => isAudioItemAudible(undefined, item)) } : {}),
    ...(projectedAudio.bgm && !isAudioItemAudible(undefined, projectedAudio.bgm) ? { bgm: undefined } : {}),
    ...(master !== undefined ? { master } : {}),
    ...(duckKeys !== undefined ? { duck_keys: duckKeys } : {}),
  };
  const captionOverlays = captionItemOverlays(internal, projectRoot, {
    cuts,
    output: { width: internal.output.width, height: internal.output.height },
    sourceCount: referencedCaptionSourceCount({ sources, cuts, tracks: raw?.tracks, audio: raw?.audio }),
    emphasisWords: raw?.emphasis_words,
    onWarning,
  });
  const overlays = captionOverlays.length === 0
    ? htmlOverlays
    : mergeItemOverlays(internal, htmlOverlays, captionOverlays);
  const projectedTracks = groupedCaptionBagTracks(raw, internal, projectRoot);
  return {
    ...(isRecord(raw) ? raw : {}),
    ...(projectedTracks ? { tracks: projectedTracks } : {}),
    // v2 is projected into the sole multi-source compatibility shape consumed below.
    version: 1,
    output,
    cuts,
    overlays,
    layers,
    sources,
    audio,
  };
}

/** 分離された字幕行を、既存 renderer が消費する inline HTML overlay へ射影する。 */
export function captionItemOverlays(
  internal,
  projectRoot,
  { cuts = [], output, sourceCount = 1, emphasisWords: editEmphasisWords, onWarning = console.warn } = {},
) {
  const items = flattenGroupDescendants(internal)
    .filter(({ item, descendant }) => (item.source.kind === "caption"
      || (descendant && item.source.kind === "captions"))
      && !hiddenItemIds.get(internal)?.has(String(item.id)))
    .map(({ item }) => item);
  if (items.length === 0) return [];

  let root;
  try {
    root = JSON.parse(readFileSync(resolve(projectRoot, "captions.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    onWarning?.("captions.json was not found; caption items were skipped");
    return [];
  }
  const captions = Array.isArray(root) ? root : Array.isArray(root?.captions) ? root.captions : [];
  const byId = new Map(captions.map(caption => [String(caption?.id), caption]));
  const defaultTextStyle = Array.isArray(root) ? undefined : root?.default_text_style;
  const emphasisWords = Array.isArray(root)
    ? editEmphasisWords
    : root?.emphasis_words ?? editEmphasisWords;
  const overlays = [];

  for (const item of items) {
    const selected = item.source.kind === "caption"
      ? [{ row: byId.get(String(item.source.id)), id: item.id, at: item.at, duration: item.duration }]
      : captions.filter(row => !item.source.exclude?.includes(String(row?.id)))
        .map(row => ({ row, id: `${item.id}::${row.id}`,
          at: Math.max(item.at, item.at + Number(row.start)),
          duration: Math.min(item.at + item.duration, item.at + Number(row.end))
            - Math.max(item.at, item.at + Number(row.start)) }))
        .filter(entry => entry.duration > 0);
    for (const selectedRow of selected) {
    const { row } = selectedRow;
    const captionId = String(row?.id ?? item.source.id);
    if (row === undefined) {
      onWarning?.(`captions.json item ${captionId} was not found; caption item ${item.id} was skipped`);
      continue;
    }
    // Output-domain caption items may live over layer-only timelines. The shared caption
    // generator clamps output cues to the cut timeline, so supply a timing-only span.
    const captionCuts = cuts.length > 0 ? cuts : [{ in: 0, out: selectedRow.at + selectedRow.duration,
      at: 0, src: "__caption_item_clock__" }];
    const generated = generateCaptionOverlays([{
      ...row,
      start: selectedRow.at,
      end: selectedRow.at + selectedRow.duration,
      time_domain: "output",
      src: undefined,
    }], captionCuts, {
      output,
      sourceCount,
      defaultTextStyle,
      emphasisWords,
      onWarning,
    });
    for (const record of generated) {
      overlays.push({
        ...record,
        id: selectedRow.id,
        transform: { x: 0, y: 0, scale: 1, rotate: 0, ...item.declaration?.transform },
        ...(item.declaration?.opacity !== undefined ? { opacity: item.declaration.opacity } : {}),
        generatedFrom: captionId,
        captionId,
        htmlPath: "captions.json",
        ...(item.source.kind === "captions" ? { parentId: item.id } : {}),
      });
    }
    }
  }
  return overlays;
}

function groupedCaptionBagTracks(raw, internal, projectRoot) {
  const ids = new Set();
  const collect = (item, inGroup = false) => {
    const nested = inGroup || item?.source?.kind === "group";
    if (inGroup && item?.source?.kind === "captions") ids.add(String(item.id));
    for (const child of item?.children ?? []) collect(child, nested);
  };
  for (const track of internal?.tracks ?? []) for (const item of track.items ?? []) collect(item);
  if (ids.size === 0 || !Array.isArray(raw?.tracks)) return null;
  let captions;
  try {
    const root = JSON.parse(readFileSync(resolve(projectRoot, "captions.json"), "utf8"));
    captions = Array.isArray(root) ? root : root?.captions;
  } catch { return null; }
  if (!Array.isArray(captions)) return null;
  const cueIds = captions.map(row => row?.id).filter(id => typeof id === "string");
  const tracks = structuredClone(raw.tracks);
  const visit = item => {
    if (ids.has(String(item?.id))) {
      item.source.exclude = [...new Set([...(item.source.exclude ?? []), ...cueIds])];
    }
    for (const child of item?.items ?? []) visit(child);
  };
  for (const track of tracks) for (const item of track?.items ?? []) visit(item);
  return tracks;
}

function collectHiddenItemIds(raw) {
  const ids = new Set();
  const visit = (item, hidden = false) => {
    const itemIsHidden = hidden || item?.hidden === true;
    if (itemIsHidden && item?.id !== undefined) ids.add(String(item.id));
    for (const child of item?.items ?? []) visit(child, itemIsHidden);
  };
  for (const track of raw?.tracks ?? []) {
    for (const item of track?.items ?? []) visit(item);
  }
  return ids;
}

function mergeItemOverlays(internal, htmlOverlays, captionOverlays) {
  const order = new Map();
  let sequence = 0;
  const visit = (item) => {
    order.set(String(item?.id), sequence++);
    for (const child of item?.children ?? []) visit(child);
  };
  for (const track of internal?.tracks ?? []) {
    for (const item of track.items ?? []) visit(item);
  }
  const combined = [...htmlOverlays, ...captionOverlays];
  const originalOrder = new Map(combined.map((overlay, index) => [overlay, index]));
  const itemOrder = overlay => order.get(String(overlay?.id))
    ?? order.get(String(overlay?.parentId))
    ?? Number.POSITIVE_INFINITY;
  return combined.sort((left, right) => itemOrder(left) - itemOrder(right)
    || originalOrder.get(left) - originalOrder.get(right));
}

function expandedHtmlOverlays(internal, projectRoot) {
  const htmlCache = new Map();
  const sourceById = new Map();
  const visit = (item) => {
    if (item?.source?.kind === "html" && typeof item.source.html === "string") {
      sourceById.set(String(item.id), item.source.html);
    }
    for (const child of item?.children ?? []) visit(child);
  };
  for (const track of internal?.tracks ?? []) for (const item of track.items ?? []) visit(item);
  return expandBagOverlays(internal, (reference) => {
    if (reference.trimStart().startsWith("<")) return reference;
    if (!htmlCache.has(reference)) {
      try {
        htmlCache.set(reference, readFileSync(resolve(projectRoot, reference), "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        // Plan-only unit inputs historically use unresolved placeholder paths. Keep their
        // compatibility record byte-identical; real render input validation remains fail-closed.
        htmlCache.set(reference, reference);
      }
    }
    return htmlCache.get(reference);
  }, { keyframeUnit: "frames" }).map(overlay => {
    if (!overlay.html.trimStart().startsWith("<")) return overlay;
    const htmlPath = sourceById.get(String(overlay.id))
      ?? sourceById.get(String(overlay.parentId ?? ""));
    return htmlPath === undefined ? overlay : { ...overlay, htmlPath };
  });
}

function unexpandedHtmlOverlays(internal, temporaryDirectory) {
  const overlays = [];
  const visit = (item) => {
    if (item?.declaration?.hidden === true) return;
    if (item?.source?.kind === "html") {
      overlays.push({
        ...renderItemDeclaration(item, temporaryDirectory),
        ...(item.source.part !== undefined ? { part: item.source.part } : {}),
        ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
      });
    }
    for (const child of item?.children ?? []) visit(child);
  };
  for (const track of internal.tracks ?? []) {
    for (const item of track.items ?? []) visit(item);
  }
  return overlays;
}

function projectRootFromTemporaryDirectory(temporaryDirectory) {
  let cursor = resolve(temporaryDirectory ?? ".");
  while (dirname(cursor) !== cursor) {
    if (basename(cursor) === ".akari") return dirname(cursor);
    cursor = dirname(cursor);
  }
  return process.cwd();
}

function resolveReferencedItemKeyframes(internal, projectRoot, onWarning = console.warn, v2 = false) {
  const bags = new Map();
  const readBag = (path) => {
    if (bags.has(path)) return bags.get(path);
    let bag = null;
    try {
      const parsed = JSON.parse(readFileSync(resolve(projectRoot, path), "utf8"));
      if (isRecord(parsed) && isRecord(parsed.items)) bag = parsed;
      else onWarning?.(`item keyframes bag ${path} has no items object; referenced items stay static`);
    } catch (error) {
      onWarning?.(`item keyframes bag ${path} could not be read; referenced items stay static (${error?.message ?? error})`);
    }
    bags.set(path, bag);
    return bag;
  };
  const visit = (item) => {
    if (v2
      && item?.source?.kind === "html"
      && !item?.keyframesRef
      && Array.isArray(item?.declaration?.keyframes)
      && !frameNormalizedHtmlItems.has(item)) {
      item.declaration = {
        ...item.declaration,
        keyframes: item.declaration.keyframes.map((point) => isRecord(point)
          ? { ...point, t: typeof point.t === "number" ? Math.round(point.t * internal.output.fps) : point.t }
          : point),
      };
      frameNormalizedHtmlItems.add(item);
    }
    if (item?.keyframesRef && !Array.isArray(item?.declaration?.keyframes)) {
      const path = String(item.keyframesRef.path ?? "");
      const points = readBag(path)?.items?.[String(item.id)];
      if (Array.isArray(points)) {
        item.declaration = { ...item.declaration, keyframes: points };
      } else if (bags.get(path) !== null) {
        onWarning?.(`item keyframes bag ${path} has no points for ${item.id}; item stays static`);
      }
    }
    for (const child of item?.children ?? []) visit(child);
  };
  for (const track of internal?.tracks ?? []) {
    for (const item of track.items ?? []) visit(item);
  }
}

/** source.kind だけで既存描画器への経路を決める。 */
export function renderItemKind(item) {
  switch (item?.source?.kind) {
    case "media":
      return item.legacy.collection === "layers" ? "layer"
        : item.legacy.collection === "cuts" ? "cut" : "audio";
    case "html": return "html";
    case "caption": return "caption";
    case "telop":
    case "filter": return "layer";
    default: return "unknown";
  }
}

export function renderItemDeclaration(item, temporaryDirectory) {
  const declaration = { ...item.declaration };
  switch (item.source.kind) {
    case "media":
      if (item.legacy.collection === "layers") {
        return {
          ...declaration,
          id: item.id,
          t: item.at,
          duration: item.duration,
          kind: "video",
          src: item.source.path,
        };
      }
      return declaration;
    case "html":
      return {
        ...declaration,
        id: item.id,
        html: item.source.html,
        start: item.at,
        duration: item.duration,
      };
    case "caption":
      return {
        ...declaration,
        id: item.id,
        start: item.at,
        duration: item.duration,
        captionId: item.source.id,
      };
    case "telop":
      if (item.source.baked === undefined) {
        throw new Error(`telop.retired: ${item.id}: テロップ（ATF）の描画は退役しました。Lab の HTML 素材版へ差し替えてください。既存の baked は再生できます。`);
      }
      return {
        ...declaration,
        id: item.id,
        t: item.at,
        duration: item.duration,
        kind: "baked",
        src: item.source.baked,
      };
    case "filter":
      return {
        ...declaration,
        id: item.id,
        t: item.at,
        duration: item.duration,
        kind: "filter",
        filter: item.source.filter,
        // v2 filter は領域省略 = 全画面。既存 filter layer 経路の mask 契約へ写す。
        perspective: declaration.perspective ?? {
          corners: [[0, 0], [1, 0], [0, 1], [1, 1]],
        },
      };
    default:
      return declaration;
  }
}

export function internalTrackZ(internal, track) {
  return resolveInternalTrackZ(internal.tracks, track.id);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
