// 音楽グリッド — 宣言（bpm / beat_offset_s / hit_points / sections）を **timeline 秒**へ写す。
//
// なぜ必要か: 宣言の秒は「BGM ファイル内の秒」であり、編集で使う timeline 秒ではない。
// BGM は `audio.bgm.in` の位置から鳴り始め、タイムライン全長までループされるため、
// 曲のキメ（hit_points）が timeline のどこに来るかは計算しないと分からない。
//
// ループの意味論（**2026-08-04 に ffmpeg で実測して確定**。render-cut/src/plan.mjs の
// `-ss <in> -stream_loop -1 -i <file>` + `atrim=duration=<D>` の挙動）:
//   - 最初の一周だけは `in` から始まり、ファイル末尾まで（長さ `trackDuration - in`）
//   - **2 周目以降はファイル先頭（位置 0）へ戻る**（`in` へは戻らない）。周期は `trackDuration`
//   実測: 6 秒ファイル（先頭 1 秒がビープ）に `in=3` → ビープは timeline 3s と 9s に出た。
//   「`in` へ戻る」と仮定すると 2 周目以降が `in` 秒ぶんずれるので、ここは推測で書かない。
//
// このモジュールは純粋関数のみ（fs / network に触れない）。I/O は bin/beat-grid.mjs 側。

/** timeline 秒 → BGM ファイル内の位置（秒）。 */
export function trackPositionAt(timelineSec, { trackDuration, bgmIn = 0 }) {
    if (!(trackDuration > 0)) throw new Error('trackDuration が必要です（秒）');
    const firstSpan = Math.max(0, trackDuration - bgmIn);
    if (timelineSec < firstSpan) return bgmIn + timelineSec;
    return (timelineSec - firstSpan) % trackDuration;
}

/**
 * BGM が timeline を覆う区間を、ループの周ごとに分解する。
 * 返り値: [{ trackStart, trackEnd, timelineStart, loop }]（loop は 0 始まり）
 */
export function loopSpans({ trackDuration, bgmIn = 0, timelineDuration }) {
    if (!(trackDuration > 0)) throw new Error('trackDuration が必要です（秒）');
    if (!(timelineDuration > 0)) throw new Error('timelineDuration が必要です（秒）');
    const spans = [];
    const firstSpan = Math.max(0, trackDuration - bgmIn);
    if (firstSpan > 0) {
        spans.push({ loop: 0, trackStart: bgmIn, trackEnd: trackDuration, timelineStart: 0 });
    }
    let timelineStart = firstSpan;
    for (let loop = 1; timelineStart < timelineDuration; loop += 1) {
        spans.push({ loop, trackStart: 0, trackEnd: trackDuration, timelineStart });
        timelineStart += trackDuration;
    }
    // timelineDuration で切る（最後の周は途中で終わる）
    return spans
        .filter((span) => span.timelineStart < timelineDuration)
        .map((span) => {
            const available = timelineDuration - span.timelineStart;
            const length = Math.min(span.trackEnd - span.trackStart, available);
            return { ...span, trackEnd: span.trackStart + length };
        });
}

/** ファイル内の位置（秒）が timeline のどこに現れるか（ループで複数回ありうる）。 */
export function timelineOccurrences(trackPos, options) {
    return loopSpans(options)
        .filter((span) => trackPos >= span.trackStart && trackPos < span.trackEnd)
        .map((span) => round3(span.timelineStart + (trackPos - span.trackStart)));
}

function round3(value) {
    return Math.round(value * 1000) / 1000;
}

/**
 * 宣言 1 件を timeline 秒のグリッドへ展開する。
 * @param {object} params
 *   declaration: { bpm, beat_offset_s, time_signature, hit_points[], sections[] }
 *   trackDuration: BGM ファイルの長さ（秒）
 *   bgmIn: audio.bgm.in（既定 0）
 *   timelineDuration: タイムライン全長（秒）
 *   maxBeats: 生成する拍の上限（暴走防止。既定 20000）
 * @returns {object} { beats[], downbeats[], hits[], sections[], seams[], meta }
 *   すべて timeline 秒。seams はループの継ぎ目（音が飛ぶ位置）。
 */
export function musicGrid({ declaration, trackDuration, bgmIn = 0, timelineDuration, maxBeats = 20000 }) {
    if (!declaration || typeof declaration !== 'object') throw new Error('declaration が必要です');
    const spans = loopSpans({ trackDuration, bgmIn, timelineDuration });
    const beats = [];
    const downbeats = [];
    const hits = [];
    const sections = [];

    const bpm = typeof declaration.bpm === 'number' && declaration.bpm > 0 ? declaration.bpm : null;
    const beatSec = bpm ? 60 / bpm : null;
    const offset = typeof declaration.beat_offset_s === 'number' ? declaration.beat_offset_s : 0;
    const perBar = Number(String(declaration.time_signature ?? '4/4').split('/')[0]) || 4;

    for (const span of spans) {
        const toTimeline = (trackPos) => round3(span.timelineStart + (trackPos - span.trackStart));

        if (beatSec) {
            // この周が覆うファイル位置の範囲に入る拍だけを出す
            const firstIndex = Math.max(0, Math.ceil((span.trackStart - offset) / beatSec));
            for (let index = firstIndex; beats.length < maxBeats; index += 1) {
                const pos = offset + index * beatSec;
                if (pos >= span.trackEnd) break;
                if (pos < span.trackStart) continue;
                const t = toTimeline(pos);
                beats.push(t);
                if (index % perBar === 0) downbeats.push(t);
            }
        }

        for (const pos of declaration.hit_points ?? []) {
            if (typeof pos === 'number' && pos >= span.trackStart && pos < span.trackEnd) {
                hits.push(toTimeline(pos));
            }
        }

        for (const section of declaration.sections ?? []) {
            const start = Math.max(section.start_sec, span.trackStart);
            const end = Math.min(section.end_sec, span.trackEnd);
            if (end > start) {
                sections.push({ label: section.label, start_sec: toTimeline(start), end_sec: toTimeline(end) });
            }
        }
    }

    // ループの継ぎ目（曲が末尾から先頭へ飛ぶ位置。ここで拍が乱れうる = 演出を置かない目安）
    const seams = spans.filter((span) => span.loop > 0).map((span) => round3(span.timelineStart));

    const sortNumeric = (a, b) => a - b;
    return {
        beats: beats.sort(sortNumeric),
        downbeats: downbeats.sort(sortNumeric),
        hits: hits.sort(sortNumeric),
        sections: sections.sort((a, b) => a.start_sec - b.start_sec),
        seams,
        meta: {
            bpm, beat_sec: beatSec ? round3(beatSec) : null, beats_per_bar: perBar,
            track_duration: trackDuration, bgm_in: bgmIn, timeline_duration: timelineDuration,
            loops: spans.length,
        },
    };
}

/** 優先順位: キメ > 小節頭 > 拍。同点は早い方（決定論）。 */
const SNAP_KINDS = [['hit', 'hits'], ['downbeat', 'downbeats'], ['beat', 'beats']];

/**
 * timeline 秒をグリッドへ寄せる。窓の外なら動かさない（null 返しではなく snapped:false）。
 * @param {number} t timeline 秒
 * @param {object} grid musicGrid の返り値
 * @param {object} options { window: 秒（既定 0.12）, kinds: ['hit','downbeat','beat'] }
 * @returns {object} { t, snapped, kind, delta, from }
 */
export function snapToGrid(t, grid, { window = 0.12, kinds = ['hit', 'downbeat', 'beat'] } = {}) {
    for (const [kind, key] of SNAP_KINDS) {
        if (!kinds.includes(kind)) continue;
        let best = null;
        for (const candidate of grid[key] ?? []) {
            const delta = candidate - t;
            if (Math.abs(delta) > window) continue;
            if (best === null || Math.abs(delta) < Math.abs(best.delta) - 1e-9) {
                best = { candidate, delta };
            }
        }
        if (best) {
            return { t: round3(best.candidate), snapped: true, kind, delta: round3(best.delta), from: round3(t) };
        }
    }
    return { t: round3(t), snapped: false, kind: null, delta: 0, from: round3(t) };
}

/**
 * カット割りの候補（拍で切る = 写真の入れ替えを拍に乗せる）。
 * @param {object} grid musicGrid の返り値
 * @param {object} options { every: 何拍ごと（既定 4 = 1 小節）, from, to, unit: 'beat'|'downbeat'|'hit' }
 * @returns {number[]} timeline 秒（昇順）
 */
export function cutCandidates(grid, { every = 4, from = 0, to = Infinity, unit = 'beat' } = {}) {
    const source = unit === 'hit' ? grid.hits : unit === 'downbeat' ? grid.downbeats : grid.beats;
    const step = unit === 'beat' ? Math.max(1, Math.round(every)) : 1;
    return (source ?? [])
        .filter((t) => t >= from && t <= to)
        .filter((_, index) => index % step === 0);
}
