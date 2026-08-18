import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getClipFilmstripChunk, getClipThumbnail } from '../lib/node/media-cache.js';

// 静止画 cut ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md）のタイムライン
// 表示。media-cache には元々 isImage 分岐（1 フレーム atlas・chunkIndex 0 への収束）が
// あったが、probeForFilmstrip が「ffprobe の format.duration > 0」を必須にしていたため
// 静止画（ffprobe が duration を報告しない — 契約 §2.3 と同じ実測）では分岐に到達できず、
// クリップが常に灰色になっていた。ffmpeg/ffprobe が実行できる環境では実際に PNG から
// atlas / サムネイルが焼けることを検証する（無い環境では skip）。

const execFileAsync = promisify(execFile);

// 1x1 の赤 PNG（ffmpeg 不要でフィクスチャを用意するためバイト列を直接書く）
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

async function hasCommand(name) {
    try {
        await execFileAsync(name, ['-version']);
        return true;
    } catch {
        return false;
    }
}

test('静止画ソースのフィルムストリップ atlas が 1 フレームで焼ける', async t => {
    if (!(await hasCommand('ffmpeg')) || !(await hasCommand('ffprobe'))) {
        t.skip('ffmpeg/ffprobe が無い環境のため skip');
        return;
    }
    const root = await mkdtemp(join(tmpdir(), 'akari-filmstrip-still-'));
    try {
        const png = join(root, 'plate.png');
        await writeFile(png, PNG_1PX);
        const result = await getClipFilmstripChunk(root, png, 0);
        assert.equal(result.status, 'ready', `unavailable: ${result.reason ?? ''}`);
        assert.equal(result.chunk.frameCount, 1);
        assert.equal(result.chunk.chunkStartSeconds, 0);
        // 静止画はどの chunkIndex を要求されても同じ 1 フレーム atlas に収束する
        //（クリップ表示尺が 120s を跨いでも重複生成しない — media-cache の既存裁定）
        const far = await getClipFilmstripChunk(root, png, 5);
        assert.equal(far.status, 'ready');
        assert.equal(far.chunk.frameCount, 1);
        assert.equal(far.chunk.chunkIndex, 5, '要求どおりの chunkIndex を返す（キャッシュは 0 に収束）');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('静止画ソースの単一フレームサムネイルが焼ける（-ss を付けない経路）', async t => {
    if (!(await hasCommand('ffmpeg'))) {
        t.skip('ffmpeg が無い環境のため skip');
        return;
    }
    const root = await mkdtemp(join(tmpdir(), 'akari-thumb-still-'));
    try {
        const png = join(root, 'plate.png');
        await writeFile(png, PNG_1PX);
        // widget は atSeconds = cut.in + min(0.1, 尺/2) を渡す。静止画（尺 0）に対して
        // -ss 0.05 を付けると 1 フレームも出ないため、-ss なし経路に落ちることの実測。
        const result = await getClipThumbnail(root, png, 0.05);
        assert.equal(result.status, 'ready', `unavailable: ${result.reason ?? ''}`);
        assert.match(result.dataUri, /^data:image\/jpeg;base64,/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
