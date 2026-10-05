// edit.json v2 を edit-store の内部表現で読み、書き出し器用モデルへ落とす。
// 版判定・tracks の検証は readInternalEdit に集約し、このパッケージでは版分岐しない。

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { readInternalEdit, resolveInternalTrackZ, projectLegacyAudioView } = require("../../edit-store/lib/index.js");

export function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

// v2 の整数フレームを秒ベースの NLE 正規化モデルへ変える唯一の変換点。
export function itemFrameRange(item, fps) {
  return {
    start: item.atFrames / fps,
    duration: item.durationFrames / fps,
  };
}

// captions の start/end は素材秒アンカー。各 media item の絶対配置へ写す。
export function sourceRangeToTimelineRanges(start, end, cuts, sourceId = null) {
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start, sourceStart: start, sourceEnd: end }];
  }
  const ranges = [];
  for (const cut of cuts) {
    if (sourceId !== null && cut.src !== sourceId) continue;
    const overlapStart = Math.max(start, cut.in);
    const overlapEnd = Math.min(end, cut.out);
    if (overlapEnd > overlapStart) {
      const speed = cutSpeed(cut);
      ranges.push({
        start: cut.at + (overlapStart - cut.in) / speed,
        duration: (overlapEnd - overlapStart) / speed,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
      });
    }
  }
  return ranges;
}

export function sourcePointToTimeline(t, cuts, sourceId = null) {
  const ranges = sourceRangeToTimelineRanges(t, t + 1e-6, cuts, sourceId);
  return ranges.length > 0 ? ranges[0].start : null;
}

export function loadEditFile(inputPath) {
  const absolute = resolve(inputPath);
  const stats = statSync(absolute);
  const editPath = stats.isDirectory() ? resolve(absolute, "edit.json") : absolute;
  const projectRoot = dirname(editPath);
  const edit = JSON.parse(readFileSync(editPath, "utf8"));
  return { edit, editPath, projectRoot };
}

export function normalizeEdit(edit, projectRoot) {
  const internal = readInternalEdit(edit);
  const rawEdit = typeof edit === "string" ? JSON.parse(edit) : edit;
  const fps = internal.output.fps;
  const warnings = [...internal.warnings];
  const hasTrackAudio = Array.isArray(rawEdit?.tracks) && rawEdit.tracks.some((track) =>
    track?.lane === "audio" && Array.isArray(track.items) && track.items.length > 0);
  const audio = isRecord(internal.declaration.audio) ? internal.declaration.audio : {};
  const trackAudio = hasTrackAudio ? projectTrackAudio(internal, audio) : null;
  const unsupportedItems = declaredAudioItems(rawEdit, trackAudio?.exportedIds, trackAudio?.bgmId);
  if (trackAudio?.bgmStart) unsupportedItems.push(trackAudio.bgmStart);
  const sources = internal.sources
    .filter((source) => typeof source.path === "string")
    .map((source) => ({
      id: source.id,
      path: source.path,
      chroma_key: source.chromaKey ?? null,
    }));

  const videoTracks = internal.tracks
    .filter((track) => track.lane === "visual" && track.items.length > 0)
    .map((track) => {
      const z = resolveInternalTrackZ(internal.tracks, track.id);
      const clips = [];
      for (const item of track.items) {
        const range = itemFrameRange(item, fps);
        const field = `tracks[${track.id}].items[${item.id}].source`;
        switch (item.source.kind) {
          case "media": {
            const speed = positiveNumber(item.declaration.speed)
              ? item.declaration.speed
              : derivedSpeed(item.source, range.duration, fps);
            clips.push({
              kind: "media",
              id: item.id,
              z,
              at: range.start,
              duration: range.duration,
              src: item.source.sourceId,
              path: item.source.path,
              in: item.source.in,
              out: item.source.out,
              ...(speed !== undefined ? { speed } : {}),
              ...copyPresent(item.declaration, [
                "transform", "opacity", "blend", "crop", "perspective", "transition_out",
                "freeze", "fx", "chroma_key",
              ]),
            });
            break;
          }
          case "html": {
            const baked = bakedPath(item);
            if (baked) clips.push(bakedClip(item, range, z, baked));
            else unsupportedItems.push({
              field,
              reason: "html は NLE が実行できず、v2 の html source には焼き済み実体 baked がないため書き出さない",
              hint: "AKARI でアルファ付き動画へ焼き、baked を持つ telop として配置してから再書き出しする",
            });
            break;
          }
          case "telop": {
            const baked = bakedPath(item);
            if (baked) clips.push(bakedClip(item, range, z, baked));
            else unsupportedItems.push({
              field,
              reason: "telop に焼き済み実体 baked がないため NLE クリップへ変換できない",
              hint: "AKARI でアルファ付き動画へ焼いて source.baked を設定してから再書き出しする",
            });
            break;
          }
          case "filter":
            unsupportedItems.push({
              field,
              reason: "AKARI の filter source は交換形式に相互運用できるクリップ表現がない",
              hint: "書き出し先でフィルターを再設定するか、映像へ焼いてから書き出す",
            });
            break;
          default:
            unsupportedItems.push({ field, reason: "未知の source.kind のため書き出さない", hint: "edit-lint で入力を確認する" });
        }
      }
      return { id: track.id, z, clips };
    })
    .filter((track) => track.clips.length > 0)
    .sort((left, right) => left.z - right.z);

  const cuts = videoTracks.flatMap((track) => track.clips.filter((clip) => clip.kind === "media"));
  const layers = videoTracks.flatMap((track) => track.clips.filter((clip) => clip.kind === "baked"));
  return {
    projectRoot,
    projectName: basename(projectRoot),
    output: internal.output,
    sources,
    videoTracks,
    cuts,
    layers,
    narration: trackAudio ? trackAudio.narration : (Array.isArray(audio.narration) ? audio.narration : []),
    bgm: trackAudio ? trackAudio.bgm : (isRecord(audio.bgm) ? audio.bgm : null),
    sfx: trackAudio ? trackAudio.sfx : (Array.isArray(audio.sfx) ? audio.sfx : []),
    master: audio.master ?? null,
    beats: internal.beats ?? [],
    emphasisWords: Array.isArray(internal.declaration.emphasisWords) ? internal.declaration.emphasisWords : [],
    direction: null,
    unsupportedItems,
    warnings,
  };
}

// view の track は audio lane 全体の番号。NLE の sfx track は sfx lane 内で振り直す。
function projectTrackAudio(internal, declarationAudio) {
  const view = projectLegacyAudioView(internal);
  const lanes = internal.tracks.filter((track) => track.lane === "audio");
  const eligible = new Set();
  const sfxLaneNumbers = new Map();
  for (const [laneNumber, track] of lanes.entries()) {
    if (track.muted === true) continue;
    for (const item of track.items) {
      if (item.declaration?.mute === true || item.source.kind !== "media" ||
          typeof item.declaration?.path !== "string") continue;
      if (!["narration", "sfx", "bgm"].includes(item.legacy.collection)) continue;
      eligible.add(item.id);
      if (item.legacy.collection === "sfx" && !sfxLaneNumbers.has(laneNumber)) {
        sfxLaneNumbers.set(laneNumber, sfxLaneNumbers.size);
      }
    }
  }
  const exportedIds = new Set();
  const narration = view.narration.filter((item) => eligible.has(item.id)).map((item) => {
    exportedIds.add(item.id);
    return copyPresent(item, ["id", "path", "t", "gain_db"]);
  });
  const sfx = view.sfx.filter((item) => eligible.has(item.id)).map((item) => {
    exportedIds.add(item.id);
    return {
      ...copyPresent(item, ["id", "path", "t", "in", "out", "gain_db"]),
      track: sfxLaneNumbers.get(item.track) ?? 0,
    };
  });
  const bgmViews = view.bgms ?? (view.bgm ? [view.bgm] : []);
  const bgmItems = lanes.filter((track) => track.muted !== true)
    .flatMap((track) => track.items.map((item) => ({ track, item })))
    .filter(({ item }) => item.legacy.collection === "bgm" && item.legacy.value !== undefined);
  const bgmEntry = bgmViews.find((item, index) => eligible.has(view.bgms ? item.id : bgmItems[index]?.item.id));
  const bgmId = bgmEntry && (view.bgms ? bgmEntry.id : bgmItems[0]?.item.id);
  if (bgmId) exportedIds.add(bgmId);
  const selectedBgm = bgmItems.find(({ item }) => item.id === bgmId);
  const bgm = bgmEntry ? {
    ...copyPresent(bgmEntry, ["path", "in", "fadeIn", "fadeOut", "gain_db"]),
    ...(isRecord(declarationAudio.bgm) && Object.hasOwn(declarationAudio.bgm, "ducking")
      ? { ducking: declarationAudio.bgm.ducking }
      : copyPresent(bgmEntry, ["ducking"])),
  } : null;
  // duration=0 の bgm は view.t を持たないため、選ばれた内部 item の配置も見る。
  const bgmStartSeconds = typeof bgmEntry?.t === "number" ? bgmEntry.t : selectedBgm?.item.at;
  const bgmStart = bgmStartSeconds > 0 && selectedBgm ? {
    field: `tracks[${selectedBgm.track.id}].items[${selectedBgm.item.id}].at`,
    reason: "書き出し器は bgm を 0 秒始まりで配置するため開始位置は移らない",
    hint: "書き出し先で BGM を指定の開始位置へ移動する",
  } : null;
  return { narration, sfx, bgm, bgmId, bgmStart, exportedIds };
}

// readInternalEdit は edit.audio.* を内部 track にも射影する。入力 tracks[] の item だけを照合する。
function declaredAudioItems(edit, exportedIds, bgmId) {
  if (!isRecord(edit) || !Array.isArray(edit.tracks)) return [];
  return edit.tracks.flatMap((track) => {
    if (!isRecord(track) || track.lane !== "audio" || !Array.isArray(track.items)) return [];
    return track.items.filter(isRecord).flatMap((item, index) => {
      if (exportedIds?.has(item.id)) return [];
      const muted = track.muted === true || item.mute === true;
      const speech = item.role === "speech";
      const extraBgm = item.role === "bgm" && bgmId && item.id !== bgmId;
      return [{
        field: `tracks[${typeof track.id === "string" ? track.id : "?"}].items[${typeof item.id === "string" ? item.id : index}]`,
        reason: muted ? "ミュートされた音声 item は NLE に書き出さない"
          : speech ? "speech role の音声 item は NLE 書き出しの対象外"
          : extraBgm ? "書き出し器は bgm を 1 本しか扱わないため、2 本目以降は書き出さない"
          : "この音声 item は互換音声ビューに載らず、NLE に書き出せない",
        hint: muted ? "書き出す場合は track と item のミュートを解除する"
          : speech ? "本編音声として書き出す場合は書き出し先で設定する"
          : extraBgm ? "書き出し先で 2 本目以降の BGM を手動で配置する"
          : "audio lane の media source と narration / sfx / bgm role を確認する",
      }];
    });
  });
}

function bakedPath(item) {
  if (typeof item.source.baked === "string" && item.source.baked.trim() !== "") return item.source.baked;
  if (typeof item.declaration.baked === "string" && item.declaration.baked.trim() !== "") return item.declaration.baked;
  return null;
}

function bakedClip(item, range, z, path) {
  return {
    kind: "baked",
    id: item.id,
    z,
    at: range.start,
    duration: range.duration,
    path,
    ...copyPresent(item.declaration, ["transform", "opacity", "blend", "crop", "perspective", "chroma_key"]),
  };
}

function derivedSpeed(source, duration, fps) {
  if (!(duration > 0)) return undefined;
  const span = source.out - source.in;
  return Math.abs(span - duration) > 1 / fps + 1e-9 ? span / duration : undefined;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function copyPresent(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function baseTimelineDuration(model) {
  let end = 0;
  for (const track of model.videoTracks) {
    for (const clip of track.clips) end = Math.max(end, clip.at + clip.duration);
  }
  for (const item of model.sfx ?? []) {
    if (typeof item.t !== "number") continue;
    const inPoint = typeof item.in === "number" ? item.in : 0;
    if (typeof item.out === "number" && item.out > inPoint) {
      end = Math.max(end, item.t + (item.out - inPoint));
    }
  }
  return end;
}
