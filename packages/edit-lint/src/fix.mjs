/**
 * 自動修正（`--fix`）の入口。
 *
 * lint の findings を手掛かりに、**機械的に決まる**修正だけを edit.json へ適用する。
 * 判断が要る修正（尺の意味を変える・グループの切り方など）はここでは行わず、
 * `--fix` の報告で「自動修正の対象外」として残す。適用する修正は次の 3 種類:
 *
 * - `v2.lane-source`: lane と source.kind が合わない item を、適合する lane のトラックへ移す
 * - `v2.track-no-overlap`: 同じトラックで重なった item を、空いている同 lane のトラックへ移す
 * - `timeline.items.order` / `v2.empty-track`: at 順への並べ直しと空トラックの削除
 *
 * 呼び出し側（edit-lint.mjs の `--fix`）が退避と差分の表示を受け持つ。ここは
 * 解析済みの edit を書き換えて変更点を返すだけで、ファイル I/O はしない。
 */
import { serializeEdit } from "../../edit-store/lib/canonical.js";

import { isSourceCompatibleWithLane } from "./shape-lane.mjs";
import { lintText } from "./i18n.mjs";

/** `--fix` が直せる check id。ここに無い指摘は人が直す。 */
export const FIXABLE_CHECKS = new Set([
  "v2.lane-source",
  "v2.track-no-overlap",
  "timeline.items.order",
  "v2.empty-track",
]);

const TRACK_PATH_PATTERN = /^edit\.json#tracks\[(\d+)\](?:\.items\[(\d+)\])?/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function trackId(track, index) {
  return typeof track?.id === "string" && track.id.length > 0 ? track.id : `tracks[${index}]`;
}

/** finding の path から対象のトラック・item を引く（見つからなければ null）。 */
export function locateFinding(edit, finding) {
  const match = TRACK_PATH_PATTERN.exec(finding?.path ?? "");
  if (!match || !Array.isArray(edit?.tracks)) return null;
  const trackIndex = Number(match[1]);
  const track = edit.tracks[trackIndex];
  if (!isRecord(track)) return null;
  if (match[2] === undefined) return { track, trackIndex, item: null, itemIndex: null };
  const itemIndex = Number(match[2]);
  const item = Array.isArray(track.items) ? track.items[itemIndex] : undefined;
  return { track, trackIndex, item: isRecord(item) ? item : null, itemIndex };
}

function intervalsOverlap(item, other) {
  if (!isNumber(item.at) || !isNumber(item.duration) || !isNumber(other.at) || !isNumber(other.duration)) {
    return false;
  }
  return other.at < item.at + item.duration && item.at < other.at + other.duration;
}

function trackConflicts(track, item) {
  return Array.isArray(track.items) && track.items.some(other => isRecord(other)
    && other !== item && intervalsOverlap(item, other));
}

function findFreeTrack(edit, lane, item, excluded) {
  for (const [index, track] of edit.tracks.entries()) {
    if (!isRecord(track) || excluded.has(track)) continue;
    if (track.lane !== lane || !Array.isArray(track.items)) continue;
    if (!trackConflicts(track, item)) return { track, index };
  }
  return null;
}

function uniqueTrackId(edit, lane) {
  const used = new Set(edit.tracks.filter(isRecord)
    .map(track => track.id).filter(id => typeof id === "string"));
  const base = lane === "audio" ? "audio" : "visual";
  for (let serial = 2; serial < 10000; serial += 1) {
    const candidate = `${base}-${serial}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function createTrack(edit, lane, insertAfter) {
  const track = { id: uniqueTrackId(edit, lane), lane, items: [] };
  if (Number.isInteger(insertAfter) && insertAfter >= 0 && insertAfter < edit.tracks.length) {
    edit.tracks.splice(insertAfter + 1, 0, track);
  } else {
    edit.tracks.push(track);
  }
  return track;
}

function moveItem(fromTrack, item, toTrack) {
  const index = fromTrack.items.indexOf(item);
  if (index >= 0) fromTrack.items.splice(index, 1);
  toTrack.items.push(item);
}

function targetLaneForKind(kind) {
  if (typeof kind !== "string") return null;
  if (kind === "media") return "visual";
  return isSourceCompatibleWithLane("visual", kind) ? "visual" : null;
}

function sortTrackItems(track) {
  const items = track.items;
  if (!Array.isArray(items) || items.length < 2) return false;
  // at を持たない item（入れ子の袋など）が混ざるトラックは、並べ替えの判断をしない。
  if (!items.every(item => isRecord(item) && isNumber(item.at))) return false;
  const sorted = [...items].sort((left, right) => left.at - right.at);
  const changed = sorted.some((item, index) => item !== items[index]);
  if (changed) track.items = sorted;
  return changed;
}

/**
 * findings に基づいて edit（version 2）をその場で修正する。
 * @returns {{changes: Array<{check: string, path: string|null, noteKey: string, params: object}>}}
 */
export function applyFixes(edit, findings) {
  const changes = [];
  if (!isRecord(edit) || edit.version !== 2 || !Array.isArray(edit.tracks)) return { changes };

  const laneMoves = [];
  const overlapMoves = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    if (!FIXABLE_CHECKS.has(finding?.check)) continue;
    const located = locateFinding(edit, finding);
    if (!located) continue;
    if (finding.check === "v2.lane-source" && located.item) {
      laneMoves.push({ ...located, findingPath: finding.path ?? null });
    } else if (finding.check === "v2.track-no-overlap" && located.item) {
      overlapMoves.push({ ...located, findingPath: finding.path ?? null });
    }
  }

  for (const { track, item, findingPath } of laneMoves) {
    if (!Array.isArray(track.items) || !track.items.includes(item)) continue;
    const lane = targetLaneForKind(item.source?.kind);
    if (lane === null || lane === track.lane) continue;
    const excluded = new Set([track]);
    const free = findFreeTrack(edit, lane, item, excluded);
    const target = free ? free.track : createTrack(edit, lane, edit.tracks.indexOf(track));
    const targetIndex = edit.tracks.indexOf(target);
    const fromId = trackId(track, edit.tracks.indexOf(track));
    moveItem(track, item, target);
    changes.push({
      check: "v2.lane-source",
      path: findingPath,
      noteKey: "laneMove",
      params: { id: String(item.id ?? "?"), from: fromId, to: trackId(target, targetIndex), lane },
    });
  }

  for (const { track, item, findingPath } of overlapMoves) {
    if (!Array.isArray(track.items) || !track.items.includes(item)) continue;
    if (!isNumber(item.at) || !isNumber(item.duration)) continue;
    const excluded = new Set([track]);
    const free = findFreeTrack(edit, track.lane, item, excluded);
    const target = free ? free.track : createTrack(edit, track.lane, edit.tracks.indexOf(track));
    const targetIndex = edit.tracks.indexOf(target);
    const fromId = trackId(track, edit.tracks.indexOf(track));
    moveItem(track, item, target);
    changes.push({
      check: "v2.track-no-overlap",
      path: findingPath,
      noteKey: "overlapMove",
      params: { id: String(item.id ?? "?"), from: fromId, to: trackId(target, targetIndex) },
    });
  }

  for (const track of edit.tracks) {
    if (!isRecord(track) || !sortTrackItems(track)) continue;
    changes.push({
      check: "timeline.items.order",
      path: `edit.json#tracks[${edit.tracks.indexOf(track)}]`,
      noteKey: "sortItems",
      params: { track: trackId(track, edit.tracks.indexOf(track)) },
    });
  }

  const emptied = [];
  edit.tracks = edit.tracks.filter(track => {
    if (!isRecord(track) || track.content !== undefined) return true;
    if (!Array.isArray(track.items) || track.items.length > 0) return true;
    emptied.push(track);
    return false;
  });
  for (const track of emptied) {
    changes.push({
      check: "v2.empty-track",
      path: null,
      noteKey: "removeEmptyTrack",
      params: { track: trackId(track, -1) },
    });
  }

  return { changes };
}

/** 変更点を人が読む 1 行にする。 */
export function describeChange(change) {
  return lintText(`lint-messages.fix.note.${change.noteKey}`, change.params);
}

/** 修正後の edit を正規の書式で直列化する。 */
export function serializeFixedEdit(edit) {
  return serializeEdit(edit);
}

/**
 * 行単位の unified diff。変更点の前後 3 行だけを文脈にし、長いときは先頭 `maxLines` 行で切る。
 * 返す lines は `---` / `+++` / `@@` を含む。
 */
export function unifiedDiff(relativePath, beforeText, afterText, { maxLines = 40 } = {}) {
  const before = String(beforeText).split("\n");
  const after = String(afterText).split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (start > endBefore && start > endAfter) return { lines: [], omitted: 0 };

  const context = 3;
  const from = Math.max(0, start - context);
  const beforeEnd = Math.min(before.length, endBefore + 1 + context);
  const afterEnd = Math.min(after.length, endAfter + 1 + context);
  const body = [
    ...before.slice(from, start).map(line => ` ${line}`),
    ...before.slice(start, endBefore + 1).map(line => `-${line}`),
    ...after.slice(start, endAfter + 1).map(line => `+${line}`),
    ...before.slice(endBefore + 1, beforeEnd).map(line => ` ${line}`),
  ];
  const header = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${from + 1},${beforeEnd - from} +${from + 1},${afterEnd - from} @@`,
  ];
  const omitted = Math.max(0, body.length - maxLines);
  return {
    lines: [...header, ...body.slice(0, maxLines)],
    omitted,
  };
}
