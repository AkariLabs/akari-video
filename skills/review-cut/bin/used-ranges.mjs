#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EPSILON = 1e-9;

export function deriveUsedRanges(edit) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
    throw new TypeError("edit.json root must be an object");
  }

  const version = edit.version ?? (Array.isArray(edit.tracks) ? 2 : Array.isArray(edit.sources) ? 1 : 0);
  if (version !== 0 && version !== 1 && version !== 2) {
    throw new Error(`unsupported edit.json version: ${version}`);
  }

  if (version === 2) return deriveV2UsedRanges(edit);

  const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
  const sourceMap = version === 1 ? buildSourceMap(edit.sources, version) : null;
  const defaultV0Path = sourcePath(edit.source);
  const sourceEntries = new Map();
  const warnings = [];
  const cursorByTrack = new Map();
  let timelineDuration = 0;
  let usedCutCount = 0;

  if (version === 0 && cuts.length === 0) {
    if (!defaultV0Path) throw new Error("edit.json version 0 with no cuts requires source.path");
    return {
      version,
      timeline_duration_s: null,
      cut_count: 0,
      ...legacyItemCounts(edit, 0),
      sources: [{
        src: defaultV0Path,
        path: defaultV0Path,
        whole_source: true,
        ranges: [],
        uses: [],
      }],
      warnings: ["version 0 with no cuts uses the whole source; resolve [0, duration_s) from probe"],
    };
  }

  for (let cutIndex = 0; cutIndex < cuts.length; cutIndex += 1) {
    const cut = cuts[cutIndex];
    validateCut(cut, cutIndex);

    const resolvedSource = resolveCutSource({ cut, cutIndex, version, sourceMap, defaultV0Path });
    if (!resolvedSource) {
      warnings.push(`cuts[${cutIndex}].src does not reference a declared source; skipped`);
      continue;
    }

    const speed = positiveNumber(cut.speed) ?? 1;
    const playbackDuration = (cut.out - cut.in) / speed;
    const freezeDuration = positiveNumber(cut.freeze?.duration_sec) ?? 0;
    const cutDuration = playbackDuration + freezeDuration;
    const track = nonNegativeInteger(cut.track) ?? 0;
    const cursor = cursorByTrack.get(track) ?? 0;
    const timelineIn = nonNegativeNumber(cut.at) ?? cursor;
    const timelineOut = timelineIn + cutDuration;
    const freeze = freezeDuration > 0
      ? freezeRecord(cut, speed, timelineIn, playbackDuration, freezeDuration)
      : null;

    let entry = sourceEntries.get(resolvedSource.src);
    if (!entry) {
      entry = { src: resolvedSource.src, path: resolvedSource.path, ranges: [], uses: [] };
      sourceEntries.set(resolvedSource.src, entry);
    } else if (entry.path !== resolvedSource.path) {
      throw new Error(`source ${resolvedSource.src} resolves to more than one path`);
    }

    entry.ranges.push({ in: cut.in, out: cut.out });
    entry.uses.push({
      cut_index: cutIndex,
      track,
      source: { in: round(cut.in), out: round(cut.out) },
      timeline: { in: round(timelineIn), out: round(timelineOut) },
      speed: round(speed),
      freeze,
    });
    cursorByTrack.set(track, timelineOut);
    timelineDuration = Math.max(timelineDuration, timelineOut);
    usedCutCount += 1;
  }

  const sources = [...sourceEntries.values()].map((entry) => ({
    ...entry,
    ranges: mergeRanges(entry.ranges),
  }));

  return {
    version,
    timeline_duration_s: round(timelineDuration),
    cut_count: usedCutCount,
    ...legacyItemCounts(edit, usedCutCount),
    sources,
    warnings,
  };
}

function deriveV2UsedRanges(edit) {
  const fps = edit.output?.fps;
  if (!Number.isInteger(fps) || fps < 1) {
    throw new Error("edit.json version 2 requires output.fps as a positive integer");
  }
  if (!Array.isArray(edit.tracks)) throw new Error("edit.json version 2 requires tracks[]");

  const sourceMap = buildSourceMap(edit.sources, 2);
  const sourceEntries = new Map();
  const warnings = [];
  const counts = emptyItemCounts();
  let timelineDuration = 0;

  for (let trackIndex = 0; trackIndex < edit.tracks.length; trackIndex += 1) {
    const track = edit.tracks[trackIndex];
    if (!track || typeof track !== "object" || Array.isArray(track)) {
      throw new Error(`tracks[${trackIndex}] must be an object`);
    }
    if (track.lane !== "visual" && track.lane !== "audio") {
      throw new Error(`tracks[${trackIndex}].lane must be visual or audio`);
    }
    if (!Array.isArray(track.items)) {
      if (track.content?.from === "captions.json") counts.caption_track_count += 1;
      continue;
    }

    for (let itemIndex = 0; itemIndex < track.items.length; itemIndex += 1) {
      const item = track.items[itemIndex];
      const itemPath = `tracks[${trackIndex}].items[${itemIndex}]`;
      validateV2Item(item, itemPath);
      const timelineIn = item.at / fps;
      const timelineOut = (item.at + item.duration) / fps;
      timelineDuration = Math.max(timelineDuration, timelineOut);

      const kind = item.source?.kind;
      if (track.lane === "audio" && kind === "media") {
        counts.audio_media_item_count += 1;
        continue;
      }
      if (kind === "html") {
        counts.overlay_item_count += 1;
        continue;
      }
      if (kind === "telop") {
        counts.telop_item_count += 1;
        continue;
      }
      if (kind === "filter") {
        counts.filter_item_count += 1;
        continue;
      }
      if (kind !== "media") {
        counts.unknown_item_count += 1;
        continue;
      }

      counts.media_item_count += 1;
      validateMediaSource(item.source, `${itemPath}.source`);
      const path = sourceMap.get(item.source.src);
      if (!path) {
        warnings.push(`${itemPath}.source.src does not reference a declared source; skipped`);
        continue;
      }

      const speed = positiveNumber(item.source.speed) ?? 1;
      const playbackDuration = (item.source.out - item.source.in) / speed;
      const freezeDuration = positiveNumber(item.source.freeze?.duration_sec) ?? 0;
      const freeze = freezeDuration > 0
        ? freezeRecord(item.source, speed, timelineIn, playbackDuration, freezeDuration)
        : null;
      addSourceUse(sourceEntries, {
        src: item.source.src,
        path,
        range: { in: item.source.in, out: item.source.out },
        use: {
          track_index: trackIndex,
          track_id: track.id ?? null,
          item_index: itemIndex,
          item_id: item.id ?? null,
          source: { in: round(item.source.in), out: round(item.source.out) },
          timeline: { in: round(timelineIn), out: round(timelineOut) },
          speed: round(speed),
          freeze,
        },
      });
    }
  }

  return {
    version: 2,
    timeline_duration_s: round(timelineDuration),
    cut_count: counts.media_item_count,
    ...counts,
    sources: finalizedSources(sourceEntries),
    warnings,
  };
}

export function mergeRanges(ranges) {
  const sorted = ranges
    .map((range) => ({ in: Number(range.in), out: Number(range.out) }))
    .sort((left, right) => left.in - right.in || left.out - right.out);
  const merged = [];
  for (const range of sorted) {
    if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.out <= range.in) {
      throw new Error("ranges must contain finite values with out > in");
    }
    const previous = merged.at(-1);
    if (previous && range.in <= previous.out + EPSILON) {
      previous.out = Math.max(previous.out, range.out);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((range) => ({ in: round(range.in), out: round(range.out) }));
}

function buildSourceMap(sources, version) {
  if (!Array.isArray(sources)) throw new Error(`edit.json version ${version} requires sources[]`);
  const result = new Map();
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source || typeof source.id !== "string" || source.id.length === 0 || typeof source.path !== "string" || source.path.length === 0) {
      throw new Error(`sources[${index}] requires non-empty id and path`);
    }
    if (result.has(source.id)) throw new Error(`duplicate sources[].id: ${source.id}`);
    result.set(source.id, source.path);
  }
  return result;
}

function addSourceUse(sourceEntries, { src, path, range, use }) {
  let entry = sourceEntries.get(src);
  if (!entry) {
    entry = { src, path, ranges: [], uses: [] };
    sourceEntries.set(src, entry);
  } else if (entry.path !== path) {
    throw new Error(`source ${src} resolves to more than one path`);
  }
  entry.ranges.push(range);
  entry.uses.push(use);
}

function finalizedSources(sourceEntries) {
  return [...sourceEntries.values()].map((entry) => ({
    ...entry,
    ranges: mergeRanges(entry.ranges),
  }));
}

function resolveCutSource({ cut, cutIndex, version, sourceMap, defaultV0Path }) {
  if (version === 1) {
    if (typeof cut.src !== "string" || cut.src.length === 0) {
      throw new Error(`cuts[${cutIndex}].src is required for edit.json version 1`);
    }
    const path = sourceMap.get(cut.src);
    return path ? { src: cut.src, path } : null;
  }

  const path = typeof cut.src === "string" && cut.src.length > 0 ? cut.src : defaultV0Path;
  if (!path) throw new Error(`cuts[${cutIndex}] cannot resolve a version 0 source path`);
  return { src: path, path };
}

function sourcePath(source) {
  if (typeof source === "string" && source.length > 0) return source;
  if (source && typeof source.path === "string" && source.path.length > 0) return source.path;
  return null;
}

function validateCut(cut, index) {
  if (!cut || typeof cut !== "object" || Array.isArray(cut)) {
    throw new Error(`cuts[${index}] must be an object`);
  }
  if (!Number.isFinite(cut.in) || !Number.isFinite(cut.out) || cut.in < 0 || cut.out <= cut.in) {
    throw new Error(`cuts[${index}] requires finite values with 0 <= in < out`);
  }
  if (cut.speed !== undefined && positiveNumber(cut.speed) === null) {
    throw new Error(`cuts[${index}].speed must be a positive number`);
  }
  if (cut.freeze?.duration_sec !== undefined && positiveNumber(cut.freeze.duration_sec) === null) {
    throw new Error(`cuts[${index}].freeze.duration_sec must be a positive number`);
  }
  if (cut.at !== undefined && nonNegativeNumber(cut.at) === null) {
    throw new Error(`cuts[${index}].at must be a non-negative timeline second`);
  }
  if (cut.track !== undefined && nonNegativeInteger(cut.track) === null) {
    throw new Error(`cuts[${index}].track must be a non-negative integer`);
  }
}

function validateV2Item(item, path) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${path} must be an object`);
  }
  if (!Number.isInteger(item.at) || item.at < 0 || !Number.isInteger(item.duration) || item.duration < 0) {
    throw new Error(`${path}.at and duration must be non-negative integer frames`);
  }
  if (!item.source || typeof item.source !== "object" || Array.isArray(item.source)) {
    throw new Error(`${path}.source must be an object`);
  }
}

function validateMediaSource(source, path) {
  if (typeof source.src !== "string" || source.src.length === 0) {
    throw new Error(`${path}.src must be a non-empty source id`);
  }
  if (!Number.isFinite(source.in) || !Number.isFinite(source.out) || source.in < 0 || source.out <= source.in) {
    throw new Error(`${path} requires source seconds with 0 <= in < out`);
  }
  if (source.speed !== undefined && positiveNumber(source.speed) === null) {
    throw new Error(`${path}.speed must be a positive number`);
  }
  if (source.freeze?.duration_sec !== undefined && positiveNumber(source.freeze.duration_sec) === null) {
    throw new Error(`${path}.freeze.duration_sec must be a positive number`);
  }
}

function legacyItemCounts(edit, mediaItemCount) {
  return {
    media_item_count: mediaItemCount,
    overlay_item_count: Array.isArray(edit.overlays) ? edit.overlays.length : 0,
    telop_item_count: 0,
    filter_item_count: 0,
    audio_media_item_count: 0,
    caption_track_count: 0,
    unknown_item_count: 0,
  };
}

function emptyItemCounts() {
  return {
    media_item_count: 0,
    overlay_item_count: 0,
    telop_item_count: 0,
    filter_item_count: 0,
    audio_media_item_count: 0,
    caption_track_count: 0,
    unknown_item_count: 0,
  };
}

function freezeRecord(cut, speed, timelineIn, playbackDuration, duration) {
  const rawAt = Number(cut.freeze?.at_sec);
  const at = Number.isFinite(rawAt) ? Math.min(Math.max(rawAt, 0), playbackDuration) : playbackDuration;
  return {
    at_sec: round(at),
    duration_sec: round(duration),
    source_time_s: round(Math.min(cut.out, cut.in + at * speed)),
    timeline: { in: round(timelineIn + at), out: round(timelineIn + at + duration) },
  };
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: node used-ranges.mjs <edit.json>\n");
    return 0;
  }
  if (argv.length !== 1) throw new Error("Usage: node used-ranges.mjs <edit.json>");
  const edit = JSON.parse(await readFile(resolve(argv[0]), "utf8"));
  process.stdout.write(`${JSON.stringify(deriveUsedRanges(edit), null, 2)}\n`);
  return 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
