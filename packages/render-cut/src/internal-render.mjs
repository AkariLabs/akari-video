import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expandBagOverlays } from "../../overlay-runtime/src/parts.mjs";

const require = createRequire(import.meta.url);
const { readInternalEdit, resolveInternalTrackZ } = require("../../edit-store/lib/index.js");
const projectRoots = new WeakMap();

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BAKE_LAYER_ENTRY = join(REPOSITORY_ROOT, "packages", "bake-layer", "bin", "bake-layer.mjs");

/**
 * edit.json の版差を読み込み層で吸収し、renderer が消費する組を作る。
 * expandParts 未指定時の継ぎ目:
 * - `.akari/render-tmp` = render-cut の plan / 宣言入力列挙前なので非展開
 * - `osr-page` / `gpu-page` = v2 page runtime へ渡すため展開
 * - `preview-projection` = preview-server へ渡すため展開
 * - その他（単体テストを含む）= 完成した renderer 互換ビューとして展開
 */
export function readRenderEdit(source, temporaryDirectory, { projectRoot, expandParts } = {}) {
  const raw = typeof source === "string" ? JSON.parse(source) : source;
  const internal = readInternalEdit(source);
  projectRoots.set(internal, projectRoot === undefined
    ? projectRootFromTemporaryDirectory(temporaryDirectory)
    : resolve(projectRoot));
  return {
    raw,
    internal,
    edit: projectRendererCompatibilityEdit(raw, internal, temporaryDirectory, projectRoot, {
      // renderProject は入力ハッシュ固定後にこの射影をもう一度呼ぶ。初回だけ原ファイル参照を
      // 保ち、render-inputs が inline マスクをパスと誤認せず元断片を列挙できるようにする。
      expandParts: expandParts ?? (basename(resolve(temporaryDirectory ?? ".")) !== "render-tmp"),
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
  { expandParts = true } = {},
) {
  const ordered = internal.tracks.flatMap(track => track.items)
    .sort((left, right) => left.legacy.index - right.legacy.index);
  const cuts = [];
  const projectRoot = projectRootOverride === undefined
    ? projectRoots.get(internal) ?? projectRootFromTemporaryDirectory(temporaryDirectory)
    : resolve(projectRootOverride);
  const overlays = expandParts
    ? expandedHtmlOverlays(internal, projectRoot)
    : unexpandedHtmlOverlays(internal, temporaryDirectory);
  const layers = [];
  const sfx = [];
  const narration = [];
  let bgm;
  for (const item of ordered) {
    if (item.legacy.value !== undefined) {
      switch (item.legacy.collection) {
        case "sfx": sfx.push(projectAudioDeclaration(item)); break;
        case "narration": narration.push(projectAudioDeclaration(item)); break;
        case "bgm": bgm = projectAudioDeclaration(item); break;
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
  const audio = {
    sfx,
    narration,
    ...(bgm !== undefined ? { bgm } : {}),
    ...(master !== undefined ? { master } : {}),
  };
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

function expandedHtmlOverlays(internal, projectRoot) {
  const htmlCache = new Map();
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

// Internal legacy values use edit-store's camelCase display model. The renderer compatibility
// shape retains the historical JSON spelling consumed by plan.mjs for gain_db.
function projectAudioDeclaration(item) {
  const value = item.legacy.value;
  if (item.source?.sourceId === undefined && isRecord(item.declaration)) {
    // Legacy top-level audio receives provisional display-only in/out/duration in edit-store.
    // Rendering must retain the original declaration so an omitted trim still means full material.
    return {
      ...item.declaration,
      ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
    };
  }
  return {
    // addV2AudioItems keeps the original top-level entry here. Preserve compatibility-only
    // fields (for example SFX fade_in/fade_out and BGM in) without making raw.audio authoritative.
    ...(isRecord(item.declaration) ? item.declaration : {}),
    ...value,
    ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
  };
}

/** source.kind だけで既存描画器への経路を決める。 */
export function renderItemKind(item) {
  switch (item?.source?.kind) {
    case "media":
      return item.legacy.collection === "layers" ? "layer"
        : item.legacy.collection === "cuts" ? "cut" : "audio";
    case "html": return "html";
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
