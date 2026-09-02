import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expandBagOverlays } from "../../overlay-runtime/src/parts.mjs";
import { generateCaptionOverlays } from "./captions.mjs";

const require = createRequire(import.meta.url);
const { readInternalEdit, resolveInternalTrackZ } = require("../../edit-store/lib/index.js");
const projectRoots = new WeakMap();
const hiddenItemIds = new WeakMap();
const frameNormalizedHtmlItems = new WeakSet();

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BAKE_LAYER_ENTRY = join(REPOSITORY_ROOT, "packages", "bake-layer", "bin", "bake-layer.mjs");

/**
 * edit.json の版差を読み込み層で吸収し、renderer が消費する組を作る。
 * expandParts は既定 true。compatibility / osr / gpu / preview の全経路で同じ袋展開を使い、
 * 非展開は互換性を明示的に調べる呼び出しだけが `{ expandParts: false }` で選ぶ。
 */
export function readRenderEdit(source, temporaryDirectory, { projectRoot, expandParts, onWarning } = {}) {
  const raw = typeof source === "string" ? JSON.parse(source) : source;
  const internal = readInternalEdit(source);
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
  const ordered = internal.tracks.flatMap(track => track.items)
    .sort((left, right) => left.legacy.index - right.legacy.index);
  const cuts = [];
  const projectRoot = projectRootOverride === undefined
    ? projectRoots.get(internal) ?? projectRootFromTemporaryDirectory(temporaryDirectory)
    : resolve(projectRootOverride);
  resolveReferencedItemKeyframes(internal, projectRoot, onWarning, raw?.version === 2);
  const htmlOverlays = expandParts
    ? expandedHtmlOverlays(internal, projectRoot)
    : unexpandedHtmlOverlays(internal, temporaryDirectory);
  const layers = [];
  const sfx = [];
  const narration = [];
  let bgm;
  for (const item of ordered) {
    if (item.legacy.value !== undefined) {
      switch (item.legacy.collection) {
        case "sfx": sfx.push(projectAudioDeclaration(item, internal.output.fps)); break;
        case "narration": narration.push(projectAudioDeclaration(item, internal.output.fps)); break;
        case "bgm": bgm = projectAudioDeclaration(item, internal.output.fps); break;
        default: break;
      }
    }
    switch (renderItemKind(item)) {
      case "cut": cuts.push(renderItemDeclaration(item, temporaryDirectory)); break;
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
  const audio = {
    sfx,
    narration,
    ...(bgm !== undefined ? { bgm } : {}),
    ...(master !== undefined ? { master } : {}),
    ...(duckKeys !== undefined ? { duck_keys: duckKeys } : {}),
  };
  const captionOverlays = captionItemOverlays(internal, projectRoot, {
    cuts,
    output: { width: internal.output.width, height: internal.output.height },
    sourceCount: sources.length,
    emphasisWords: raw?.emphasis_words,
    onWarning,
  });
  const overlays = captionOverlays.length === 0
    ? htmlOverlays
    : mergeItemOverlays(internal, htmlOverlays, captionOverlays);
  return {
    ...(isRecord(raw) ? raw : {}),
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
  const items = [];
  const visit = (item, hidden = false) => {
    const itemIsHidden = hidden
      || hiddenItemIds.get(internal)?.has(String(item?.id)) === true
      || item?.hidden === true
      || item?.declaration?.hidden === true;
    if (!itemIsHidden && item?.source?.kind === "caption") items.push(item);
    for (const child of item?.children ?? []) visit(child, itemIsHidden);
  };
  for (const track of internal?.tracks ?? []) {
    for (const item of track.items ?? []) visit(item);
  }
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
    const captionId = String(item.source.id);
    const row = byId.get(captionId);
    if (row === undefined) {
      onWarning?.(`captions.json item ${captionId} was not found; caption item ${item.id} was skipped`);
      continue;
    }
    const generated = generateCaptionOverlays([{
      ...row,
      start: item.at,
      end: item.at + item.duration,
      time_domain: "output",
      src: undefined,
    }], cuts, {
      output,
      sourceCount,
      defaultTextStyle,
      emphasisWords,
      onWarning,
    });
    for (const record of generated) {
      overlays.push({
        ...record,
        id: item.id,
        transform: { x: 0, y: 0, scale: 1, rotate: 0, ...item.declaration?.transform },
        ...(item.declaration?.opacity !== undefined ? { opacity: item.declaration.opacity } : {}),
        generatedFrom: captionId,
        captionId,
        htmlPath: "captions.json",
      });
    }
  }
  return overlays;
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
  }).map(overlay => {
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

// Internal compatibility values use edit-store's camelCase display model. The renderer compatibility
// shape retains the historical JSON spelling consumed by plan.mjs for gain_db.
function projectAudioDeclaration(item, fps) {
  const value = item.legacy.value;
  const keyframes = item.source?.sourceId !== undefined && Array.isArray(value.keyframes)
    ? value.keyframes.map(point => isRecord(point) && typeof point.t === "number"
      ? { ...point, t: point.t / fps }
      : point)
    : undefined;
  if (item.source?.sourceId === undefined && isRecord(item.declaration)) {
    // Compatibility top-level audio receives provisional display-only in/out/duration in edit-store.
    // Rendering must retain the original declaration so an omitted trim still means full material.
    return {
      ...item.declaration,
      ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
      ...(keyframes ? { keyframes } : {}),
    };
  }
  return {
    // addV2AudioItems keeps the original top-level entry here. Preserve compatibility-only
    // fields (for example SFX fade_in/fade_out and BGM in) without making raw.audio authoritative.
    ...(isRecord(item.declaration) ? item.declaration : {}),
    ...value,
    ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
    ...(keyframes ? { keyframes } : {}),
  };
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
      return {
        ...declaration,
        id: item.id,
        t: item.at,
        duration: item.duration,
        kind: "baked",
        src: item.source.baked ?? telopRasterPath(temporaryDirectory, item.id),
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

export function buildTelopRasterCommands(internal, temporaryDirectory) {
  const commands = [];
  for (const track of internal.tracks) {
    for (const item of track.items) {
      if (item.source.kind !== "telop" || item.source.baked !== undefined) continue;
      commands.push({
        id: item.id,
        command: process.execPath,
        args: [
          BAKE_LAYER_ENTRY,
          "--kind", "telop",
          "--preset", item.source.preset,
          "--params", JSON.stringify(item.source.params ?? {}),
          "--duration", String(item.duration),
          "--size", `${internal.output.width}x${internal.output.height}`,
          "--fps", String(internal.output.fps),
          "--out", telopRasterPath(temporaryDirectory, item.id),
          "--no-preview-proxy",
        ],
        output: telopRasterPath(temporaryDirectory, item.id),
      });
    }
  }
  return commands;
}

export function telopRasterPath(temporaryDirectory, itemId) {
  const digest = createHash("sha256").update(String(itemId)).digest("hex").slice(0, 16);
  return join(temporaryDirectory, `telop-${digest}.mov`);
}

export function internalTrackZ(internal, track) {
  return resolveInternalTrackZ(internal.tracks, track.id);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
