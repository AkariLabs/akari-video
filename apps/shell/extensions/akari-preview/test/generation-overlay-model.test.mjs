import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
    describeOverlay,
    generationStateHelperV1,
    resolveGenerationState
} from '../lib/common/generation-overlay-model.js';
import { selectGenerationSidecarForSource } from '../../../../../packages/edit-store/lib/generation-meta.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'generation-overlays');
const nowMs = Date.parse('2026-09-13T09:50:00.000Z');
const readMeta = async name => JSON.parse(await readFile(join(fixtureRoot, `${name}.meta.json`), 'utf8'));

test('6 状態と frames の表示記述をフィクスチャから表駆動で解決する', async () => {
    const rows = [
        {
            name: 'still.png', meta: null, label: 'ビート 1',
            state: 'none', tag: '静止画（仮枠） · ビート 1', band: null,
            progress: null, shimmer: false, maskRect: null
        },
        {
            name: 'planned.png', meta: await readMeta('planned.png'), label: 'ビート 2',
            state: 'planned', tag: 'planned · ビート 2', band: null,
            progress: null, shimmer: false, maskRect: null
        },
        {
            name: 'generating.png', meta: await readMeta('generating.png'), label: 'ビート 3',
            state: 'generating', tag: '生成中 · ビート 3', band: '生成中 62% · 残り約 41 秒',
            progress: 0.62, shimmer: true, maskRect: null
        },
        {
            name: 'stale.png', meta: await readMeta('stale.png'), label: 'ビート 4',
            state: 'stale', tag: '応答なし · 再取得は右パネル', band: '応答なし',
            progress: null, shimmer: false, maskRect: null
        },
        {
            name: 'done.mp4', meta: await readMeta('done.mp4'), label: 'ビート 5',
            state: 'done', tag: null, band: null,
            progress: null, shimmer: false, maskRect: null
        },
        {
            name: 'failed.png', meta: await readMeta('failed.png'), label: 'ビート 6',
            state: 'failed', tag: '失敗 · timeout · 再試行は右パネル', band: null,
            progress: null, shimmer: false, maskRect: null
        },
        {
            name: 'frames.png', meta: await readMeta('frames.png'), label: 'ビート 7',
            state: 'done', tag: 'パラパラ 8fps · コマ 5/16', band: null,
            progress: null, shimmer: false,
            maskRect: { x: 0.15, y: 0.6, w: 0.22, h: 0.22 }, localTimeSec: 0.5
        }
    ];
    for (const row of rows) {
        const state = resolveGenerationState(row.meta, nowMs);
        assert.equal(state, row.state, row.name);
        const description = describeOverlay(state, row.meta, row.label, {
            sourcePath: row.name,
            localTimeSec: row.localTimeSec,
            clipDurationSec: 2
        });
        assert.equal(description.tag, row.tag, `${row.name}: tag`);
        assert.equal(description.band?.text ?? null, row.band, `${row.name}: band.text`);
        assert.equal(description.band?.progress ?? null, row.progress, `${row.name}: band.progress`);
        assert.equal(description.shimmer, row.shimmer, `${row.name}: shimmer`);
        assert.deepEqual(description.maskRect, row.maskRect, `${row.name}: maskRect`);
    }
});

test('生成中の進捗と残り時間は有無の 4 通りを契約文言へ写す', () => {
    const rows = [
        [{ progress: { percent: 25, eta_s: 8 } }, '生成中 25% · 残り約 8 秒', 0.25],
        [{ progress: { percent: 25 } }, '生成中 25%', 0.25],
        [{ progress: { eta_s: 8 } }, '生成中 · 残り約 8 秒', null],
        [{}, '生成中', null]
    ];
    for (const [extra, text, progress] of rows) {
        const description = describeOverlay('generating', { status: 'generating', ...extra }, 'clip');
        assert.equal(description.band.text, text);
        assert.equal(description.band.progress, progress);
    }
});

test('png clip は生成中 mp4 サイドカーから generating tag と shimmer を得る', () => {
    const sourcePath = 'assets/stills/a.png';
    const entry = selectGenerationSidecarForSource(sourcePath, [{
        sourcePath: 'assets/generated/gen-a.mp4',
        meta: {
            version: 1, kind: 'video', status: 'generating', progress: { percent: 45 },
            inputs: { first_frame: { path: sourcePath } },
            job: { started_at: '2026-09-13T09:49:59.000Z', stale_after_s: 30 }
        },
        binding: { matches: true }
    }], nowMs);
    const state = resolveGenerationState(entry.meta, nowMs, entry.binding);
    const overlay = describeOverlay(state, entry.meta, 'ビート 1', { sourcePath });
    assert.equal(overlay.tag, '生成中 · ビート 1');
    assert.equal(overlay.shimmer, true);
    assert.equal(overlay.band.text, '生成中 45%');
});

test('frames は総コマ推定とクランプを行い、failed は frames 表示より優先する', () => {
    const frames = { kind: 'frames', output: { fps: 8 }, inputs: { extra: {} }, result: {} };
    assert.equal(describeOverlay('done', frames, 'clip', {
        localTimeSec: 99, clipDurationSec: 2
    }).tag, 'パラパラ 8fps · コマ 16/16');
    assert.equal(describeOverlay('done', { kind: 'frames' }, 'clip').tag, 'パラパラ · clip');
    assert.equal(describeOverlay('failed', {
        ...frames, error: { message: 'broken' }
    }, 'clip').tag, '失敗 · broken · 再試行は右パネル');
});

test('壊れた meta を受けても状態解決と表示記述は例外を投げない', () => {
    const broken = [null, 'meta', { status: '???' }, {
        status: 'generating', job: { started_at: 'not-a-date' }
    }];
    for (const meta of broken) {
        assert.doesNotThrow(() => {
            const state = resolveGenerationState(meta, nowMs);
            describeOverlay(state, meta, 'clip', { sourcePath: 'clip.mp4' });
        });
    }
    assert.equal(resolveGenerationState(broken[3], nowMs), 'generating');
});

test('webview へ toString() で注入した状態解決が外部スコープ無しで 6 状態を返す', async t => {
    // webview の bootstrap が toString() で同じ形に組み立てるため、一時 ESM として評価する。
    // 検収プレゲートが動的な Function コンストラクタを禁じるため、module 隔離を使う。
    const dir = await mkdtemp(join(tmpdir(), 'generation-overlay-model-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'injected.mjs');
    const body = `const resolveGenerationStateV1 = (${generationStateHelperV1.toString()});
        const resolveGenerationStateFn = (${resolveGenerationState.toString()});
        export default resolveGenerationStateFn;`;
    await writeFile(file, body, 'utf8');
    const injected = (await import(pathToFileURL(file).href)).default;
    const startedAt = Date.parse('2026-09-13T00:00:00.000Z');
    const rows = [
        [null, startedAt, 'none'],
        [{ status: 'planned' }, startedAt, 'planned'],
        [{ status: 'generating', job: { started_at: '2026-09-13T00:00:00.000Z' } }, startedAt, 'generating'],
        [{ status: 'generating', job: { started_at: '2026-09-13T00:00:00.000Z' } }, startedAt + 901000, 'stale'],
        [{ status: 'done' }, startedAt, 'done'],
        [{ status: 'failed' }, startedAt, 'failed']
    ];
    for (const [meta, now, expected] of rows) {
        assert.equal(injected(meta, now), expected);
    }
    for (const [seconds, expected] of [[899, 'generating'], [900, 'generating'], [901, 'stale']]) {
        const meta = { status: 'generating', job: { started_at: '2026-09-13T00:00:00.000Z' } };
        assert.equal(injected(meta, startedAt + seconds * 1000), expected, `${seconds} 秒`);
    }
});

test('stale_after_s 未指定でも既定 900 秒で stale になる', () => {
    const startedAt = Date.parse('2026-09-13T00:00:00.000Z');
    const meta = { status: 'generating', job: { started_at: '2026-09-13T00:00:00.000Z' } };
    for (const [seconds, expected] of [[899, 'generating'], [900, 'generating'], [901, 'stale']]) {
        assert.equal(resolveGenerationState(meta, startedAt + seconds * 1000), expected, `${seconds} 秒`);
    }
});
