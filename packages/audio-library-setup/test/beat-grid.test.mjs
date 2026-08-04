import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    cutCandidates,
    loopSpans,
    musicGrid,
    snapToGrid,
    timelineOccurrences,
    trackPositionAt,
} from '../shared/beat-grid.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'bin', 'beat-grid.mjs');

// ffmpeg 実測（2026-08-04）で確定したループの意味論を、そのままテストに固定する:
// 6 秒ファイル・in=3 → 1 周目は 3→6（timeline 0→3）、2 周目以降は**ファイル先頭から**
// （timeline 3→9, 9→15…）。「in へ戻る」実装に退行したらここが落ちる。
test('ループの意味論: 1 周目は in から、2 周目以降はファイル先頭から（ffmpeg 実測に一致）', () => {
    const options = { trackDuration: 6, bgmIn: 3, timelineDuration: 15 };
    assert.equal(trackPositionAt(0, options), 3);
    assert.equal(trackPositionAt(2.5, options), 5.5);
    assert.equal(trackPositionAt(3, options), 0, '継ぎ目でファイル先頭へ');
    assert.equal(trackPositionAt(4, options), 1);
    assert.equal(trackPositionAt(9, options), 0, '2 回目の継ぎ目');

    // ファイル先頭 0〜1s のビープは timeline 3s と 9s に出る（実測と同じ）
    assert.deepEqual(timelineOccurrences(0, options), [3, 9]);
    assert.deepEqual(timelineOccurrences(3, options), [0, 6, 12]);

    const spans = loopSpans(options);
    assert.deepEqual(spans.map((s) => [s.loop, s.trackStart, s.trackEnd, s.timelineStart]),
        [[0, 3, 6, 0], [1, 0, 6, 3], [2, 0, 6, 9]]);
});

test('ループなし（曲がタイムラインより長い）: 1 周だけ・継ぎ目なし', () => {
    const spans = loopSpans({ trackDuration: 120, bgmIn: 10, timelineDuration: 30 });
    assert.equal(spans.length, 1);
    assert.deepEqual([spans[0].trackStart, spans[0].trackEnd, spans[0].timelineStart], [10, 40, 0]);
});

const DECLARATION = {
    bpm: 120,                 // 拍 = 0.5 秒
    beat_offset_s: 0.25,
    time_signature: '4/4',
    hit_points: [8.25, 16.25],
    sections: [
        { label: 'intro', start_sec: 0, end_sec: 8.25 },
        { label: 'drop', start_sec: 8.25, end_sec: 20 },
    ],
};

test('musicGrid: 拍・小節頭・キメ・構成を timeline 秒へ写す（in オフセットを反映）', () => {
    const grid = musicGrid({ declaration: DECLARATION, trackDuration: 20, bgmIn: 8.25, timelineDuration: 10 });
    // in=8.25 なので、曲の 8.25s（キメ）は timeline 0s に来る
    assert.equal(grid.hits[0], 0);
    assert.equal(grid.meta.bpm, 120);
    assert.equal(grid.meta.beat_sec, 0.5);
    assert.equal(grid.meta.loops, 1, 'timeline 10s < 残り 11.75s なのでループしない');
    // 拍は 0.5 秒間隔で並ぶ
    const deltas = grid.beats.slice(1, 6).map((t, i) => Math.round((t - grid.beats[i]) * 1000) / 1000);
    assert.deepEqual(deltas, [0.5, 0.5, 0.5, 0.5, 0.5]);
    // 小節頭は 4 拍ごと（2 秒間隔）
    assert.equal(Math.round((grid.downbeats[1] - grid.downbeats[0]) * 1000) / 1000, 2);
    // サビ（drop）は in の位置から始まっているので timeline 0 から
    const drop = grid.sections.find((s) => s.label === 'drop');
    assert.equal(drop.start_sec, 0);
    assert.deepEqual(grid.seams, []);
});

test('musicGrid: ループするとキメと構成が周回ぶん現れ、継ぎ目が報告される', () => {
    const grid = musicGrid({ declaration: DECLARATION, trackDuration: 20, bgmIn: 0, timelineDuration: 45 });
    assert.deepEqual(grid.seams, [20, 40], 'ファイル長ごとに継ぎ目');
    assert.deepEqual(grid.hits, [8.25, 16.25, 28.25, 36.25], '2 周目のキメも出る');
    // 3 周目は timeline 40–45s（曲の先頭 5 秒）しか鳴らないので、その周にサビは入らない
    assert.deepEqual(
        grid.sections.map((s) => [s.label, s.start_sec, s.end_sec]),
        [['intro', 0, 8.25], ['drop', 8.25, 20], ['intro', 20, 28.25], ['drop', 28.25, 40], ['intro', 40, 45]],
    );
    assert.ok(grid.sections.every((s) => s.end_sec <= 45), 'タイムライン末尾で切る');
});

test('musicGrid: bpm が無い宣言（拍の無い曲）でもキメ・構成だけ出る', () => {
    const grid = musicGrid({
        declaration: { bpm: null, hit_points: [3], sections: [{ label: 'drop', start_sec: 2, end_sec: 9 }] },
        trackDuration: 10, bgmIn: 0, timelineDuration: 10,
    });
    assert.deepEqual(grid.beats, []);
    assert.deepEqual(grid.hits, [3]);
    assert.equal(grid.sections.length, 1);
});

test('snapToGrid: キメ > 小節頭 > 拍 の優先順で、窓の外は動かさない', () => {
    const grid = musicGrid({ declaration: DECLARATION, trackDuration: 20, bgmIn: 0, timelineDuration: 20 });
    // 8.25 のキメの近く（8.3）→ キメへ
    const toHit = snapToGrid(8.3, grid, { window: 0.2 });
    assert.equal(toHit.kind, 'hit');
    assert.equal(toHit.t, 8.25);

    // 4.3 の近くには小節頭 4.25（0.25 + 4 拍 × 0.5 × 2）がある
    const toDownbeat = snapToGrid(4.3, grid, { window: 0.2 });
    assert.equal(toDownbeat.kind, 'downbeat');
    assert.equal(toDownbeat.t, 4.25);

    // 3.8 の近くは拍 3.75（小節頭ではない）
    const toBeat = snapToGrid(3.8, grid, { window: 0.2 });
    assert.equal(toBeat.kind, 'beat');
    assert.equal(toBeat.t, 3.75);

    // 窓が狭ければ動かさない
    const notSnapped = snapToGrid(3.8, grid, { window: 0.01 });
    assert.equal(notSnapped.snapped, false);
    assert.equal(notSnapped.t, 3.8);

    // kinds を絞れば拍には寄せない（儀式スナップ済みを拍で動かさない用途）
    const onlyHits = snapToGrid(3.8, grid, { window: 0.5, kinds: ['hit'] });
    assert.equal(onlyHits.snapped, false);
});

test('snapToGrid: 決定論（同じ入力 → 同じ結果・同点は早い側）', () => {
    const grid = { hits: [], downbeats: [], beats: [10, 10.2] };
    const first = snapToGrid(10.1, grid, { window: 0.2 });
    const second = snapToGrid(10.1, grid, { window: 0.2 });
    assert.deepEqual(first, second);
    assert.equal(first.t, 10, '等距離なら早い方');
});

test('cutCandidates: 既定は 1 小節（4 拍）ごと。unit で小節頭・キメにも切り替わる', () => {
    const grid = musicGrid({ declaration: DECLARATION, trackDuration: 20, bgmIn: 0, timelineDuration: 12 });
    const everyBar = cutCandidates(grid, { every: 4 });
    assert.equal(Math.round((everyBar[1] - everyBar[0]) * 100) / 100, 2);
    const onHits = cutCandidates(grid, { unit: 'hit' });
    assert.deepEqual(onHits, grid.hits);
    const ranged = cutCandidates(grid, { every: 4, from: 5, to: 9 });
    assert.ok(ranged.every((t) => t >= 5 && t <= 9));
});

test('CLI: 宣言が無ければ declare-audio / 宣言パックを案内して exit 1', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-beat-grid-'));
    try {
        const declPath = path.join(root, 'declarations.json');
        await writeFile(declPath, JSON.stringify({ 'other-track': DECLARATION }));
        const result = spawnSync(process.execPath, [
            cliPath, '--track', 'missing-track', '--timeline', '30', '--track-duration', '20',
            '--declarations', declPath,
        ], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /declare-audio|宣言パック/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI: --json でグリッド・スナップ・カット候補を返す', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-beat-grid-json-'));
    try {
        const declPath = path.join(root, 'declarations.json');
        await writeFile(declPath, JSON.stringify({ 'my-track': DECLARATION }));
        const result = spawnSync(process.execPath, [
            cliPath, '--track', 'my-track', '--timeline', '20', '--track-duration', '20',
            '--in', '0', '--snap', '8.3,3.8', '--window', '0.2', '--declarations', declPath, '--json',
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.track, 'my-track');
        assert.equal(parsed.grid.meta.bpm, 120);
        assert.equal(parsed.snaps[0].kind, 'hit');
        assert.equal(parsed.snaps[0].t, 8.25);
        assert.ok(parsed.cut_candidates.length > 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('CLI: --edit から BGM の id・in・タイムライン長（cuts 合計）を読む', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-beat-grid-edit-'));
    try {
        const declPath = path.join(root, 'declarations.json');
        await writeFile(declPath, JSON.stringify({ 'my-track': DECLARATION }));
        const editPath = path.join(root, 'edit.json');
        await writeFile(editPath, JSON.stringify({
            cuts: [{ in: 0, out: 6 }, { in: 10, out: 16 }],
            audio: { bgm: { path: 'audio/my-track.mp3', in: 8.25 } },
        }));
        const result = spawnSync(process.execPath, [
            cliPath, '--edit', editPath, '--track-duration', '20', '--declarations', declPath, '--json',
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.track, 'my-track', 'path の stem を id にする');
        assert.equal(parsed.grid.meta.timeline_duration, 12, 'cuts の合計 6 + 6');
        assert.equal(parsed.grid.meta.bgm_in, 8.25);
        assert.equal(parsed.grid.hits[0], 0, 'in の位置のキメが timeline 0 に来る');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
