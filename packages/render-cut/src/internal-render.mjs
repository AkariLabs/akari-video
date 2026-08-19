import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { readInternalEdit, resolveInternalTrackZ } = require("../../edit-store/lib/index.js");

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BAKE_LAYER_ENTRY = join(REPOSITORY_ROOT, "packages", "bake-layer", "bin", "bake-layer.mjs");

/** edit.json の版差を読み込み層で吸収し、renderer が消費する組を作る。 */
export function readRenderEdit(source, temporaryDirectory) {
  const raw = typeof source === "string" ? JSON.parse(source) : source;
  const internal = readInternalEdit(source);
  return {
    raw,
    internal,
    edit: projectRendererCompatibilityEdit(raw, internal, temporaryDirectory),
  };
}

/**
 * 既存の cut/audio/rasterize 実装へ渡す薄い互換ビュー。
 * visual 配列は生 JSON から再読出しせず、正規化済み tracks[].items[] だけから作る。
 */
export function projectRendererCompatibilityEdit(raw, internal, temporaryDirectory) {
  const ordered = internal.tracks.flatMap(track => track.items)
    .sort((left, right) => left.legacy.index - right.legacy.index);
  const cuts = [];
  const overlays = [];
  const layers = [];
  for (const item of ordered) {
    switch (renderItemKind(item)) {
      case "cut": cuts.push(renderItemDeclaration(item, temporaryDirectory)); break;
      case "html": overlays.push(renderItemDeclaration(item, temporaryDirectory)); break;
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
  const defaultSource = internal.sources.find(source => source.isDefault && typeof source.path === "string");

  return {
    ...(isRecord(raw) ? raw : {}),
    // Phase 2 keeps the two established cut builders. This compatibility bit selects between
    // their single-source and source-table contracts; visual composition itself uses `internal`.
    version: internal.sourceTableDeclared ? 1 : 0,
    output,
    cuts,
    overlays,
    layers,
    ...(internal.sourceTableDeclared ? { sources } : {}),
    ...(!internal.sourceTableDeclared && defaultSource
      ? {
          source: {
            path: defaultSource.path,
            proxy: defaultSource.proxy,
            ...(defaultSource.chromaKey !== undefined ? { chroma_key: defaultSource.chromaKey } : {}),
          },
        }
      : {}),
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
