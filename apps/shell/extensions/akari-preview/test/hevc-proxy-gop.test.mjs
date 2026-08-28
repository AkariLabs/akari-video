import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getH264Proxy, probeVideoFrameRate } from '../lib/node/hevc-proxy.js';

const commandExists = command => {
    try {
        execFileSync(command, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

const hasMediaTools = commandExists('ffmpeg') && commandExists('ffprobe');

const probeStream = path => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=pix_fmt,has_b_frames,nb_read_frames',
    '-of', 'json',
    path
], { encoding: 'utf8' })).streams?.[0];

const keyframeIntervals = path => {
    const points = execFileSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-skip_frame', 'nokey',
        '-show_entries', 'frame=pts_time',
        '-of', 'csv=p=0',
        path
    ], { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/u)
        .map(line => Number.parseFloat(line.split(',')[0]))
        .filter(Number.isFinite);
    return points.slice(1).map((point, index) => point - points[index]);
};

test('shell HEVC proxy uses a one-second GOP and versioned cache key', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required',
    timeout: 120_000
}, async t => {
    const root = mkdtempSync(join(tmpdir(), 'akari-preview-hevc-gop-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'source.mp4');
    execFileSync('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc2=s=96x54:r=30000/1001:d=2.2',
        '-c:v', 'libx265',
        '-x265-params', 'log-level=error',
        '-pix_fmt', 'yuv420p10le',
        '-tag:v', 'hvc1',
        source
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    assert.ok(Math.abs((await probeVideoFrameRate(source)) - (30000 / 1001)) < 1e-6);
    const sourceProbe = probeStream(source);
    const sourceStat = statSync(source);
    const oldHash = createHash('sha1').update([
        source,
        sourceStat.size,
        sourceStat.mtimeMs,
        'h264-proxy'
    ].join('|')).digest('hex');
    const oldCache = join(root, 'cache', 'media-proxy', `${oldHash}.mp4`);
    mkdirSync(join(root, 'cache', 'media-proxy'), { recursive: true });
    writeFileSync(oldCache, 'old cache', { encoding: 'utf8', flag: 'wx' });

    const result = await getH264Proxy(root, source);
    assert.equal(result.status, 'ready');
    assert.notEqual(result.proxyPath, oldCache);
    assert.equal(existsSync(oldCache), true);

    const proxyProbe = probeStream(result.proxyPath);
    assert.equal(proxyProbe.pix_fmt, 'yuv420p');
    assert.equal(proxyProbe.has_b_frames, 0);
    assert.equal(proxyProbe.nb_read_frames, sourceProbe.nb_read_frames);
    const intervals = keyframeIntervals(result.proxyPath);
    assert.ok(intervals.length >= 2);
    assert.ok(Math.max(...intervals) <= 1.001);
});
