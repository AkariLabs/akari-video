import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { getH264Proxy } from '../lib/node/hevc-proxy.js';

const commandExists = command => {
    try {
        execFileSync(command, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

const hasMediaTools = commandExists('ffmpeg') && commandExists('ffprobe');

const probeVideo = path => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=pix_fmt,profile',
    '-of', 'json',
    path
], { encoding: 'utf8' })).streams?.[0];

test('10-bit HEVC proxy is 8-bit H.264 and preserves stable cache-key evidence', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = mkdtempSync(join(tmpdir(), 'akari-preview-hevc-pixfmt-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'source-10bit-hevc.mp4');
    execFileSync('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc2=s=64x64:r=10:d=0.6',
        '-c:v', 'libx265',
        '-x265-params', 'log-level=error',
        '-pix_fmt', 'yuv420p10le',
        '-tag:v', 'hvc1',
        source
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const sourceProbe = probeVideo(source);
    assert.equal(sourceProbe?.pix_fmt, 'yuv420p10le');

    const first = await getH264Proxy(root, source);
    assert.equal(first.status, 'ready');
    assert.equal(extname(first.proxyPath), '.mp4');

    const proxyProbe = probeVideo(first.proxyPath);
    assert.equal(proxyProbe?.pix_fmt, 'yuv420p');
    assert.doesNotMatch(proxyProbe?.profile ?? '', /High 10/u);

    const cacheKey = basename(first.proxyPath, '.mp4');
    const metaPath = join(dirname(first.proxyPath), `${cacheKey}.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    assert.equal(meta.proxyPixelFormat, 'yuv420p');

    const sourceStat = statSync(source);
    assert.equal(meta.sourcePath, source);
    assert.equal(meta.sourceSize, sourceStat.size);
    assert.equal(meta.sourceMtimeMs, sourceStat.mtimeMs);
    assert.equal(meta.cacheKey, cacheKey);

    const independentlyComputedKey = execFileSync(process.execPath, [
        '-e',
        "const { createHash } = require('node:crypto'); process.stdout.write(createHash('sha1').update(process.argv.slice(1).join('|')).digest('hex'));",
        source,
        String(sourceStat.size),
        String(sourceStat.mtimeMs),
        'h264-proxy'
    ], { encoding: 'utf8' });
    assert.equal(independentlyComputedKey, meta.cacheKey);

    const firstMtimeMs = statSync(first.proxyPath).mtimeMs;
    await delay(1100);
    const second = await getH264Proxy(root, source);
    assert.equal(second.status, 'ready');
    assert.equal(second.proxyPath, first.proxyPath);
    assert.equal(statSync(second.proxyPath).mtimeMs, firstMtimeMs);
});
