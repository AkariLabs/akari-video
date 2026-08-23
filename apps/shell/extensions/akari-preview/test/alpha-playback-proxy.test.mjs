import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';

import {
    getH264Proxy,
    probeVideoCodecName,
    probeVideoPixelFormat
} from '../lib/node/hevc-proxy.js';

const commandExists = command => {
    try {
        execFileSync(command, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

const hasMediaTools = commandExists('ffmpeg') && commandExists('ffprobe');

const makeTempProject = t => {
    const root = mkdtempSync(join(tmpdir(), 'akari-preview-proxy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
};

test('ProRes 4444 yuva is converted to VP9 WebM with a non-opaque alpha plane', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = makeTempProject(t);
    const source = join(root, 'alpha-prores.mov');
    execFileSync('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'color=c=red@0.35:s=32x32:r=5:d=0.4,format=yuva444p10le',
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
        source
    ]);

    assert.match(await probeVideoPixelFormat(source), /^yuva/i);
    const result = await getH264Proxy(root, source);
    assert.equal(result.status, 'ready');
    assert.equal(extname(result.proxyPath), '.webm');
    assert.equal(await probeVideoCodecName(result.proxyPath), 'vp9');

    // Native ffprobe reports yuv420p for VP9 alpha. alpha_mode proves the WebM declaration, while
    // forcing libvpx-vp9 and extracting the alpha plane proves the decoded pixels remain non-opaque.
    const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream_tags=alpha_mode',
        '-of', 'json',
        result.proxyPath
    ], { encoding: 'utf8' }));
    assert.equal(probe.streams?.[0]?.tags?.alpha_mode, '1');

    const alphaPlane = execFileSync('ffmpeg', [
        '-v', 'error',
        '-c:v', 'libvpx-vp9',
        '-i', result.proxyPath,
        '-vf', 'alphaextract',
        '-frames:v', '1',
        '-pix_fmt', 'gray',
        '-f', 'rawvideo',
        '-'
    ]);
    assert.ok(alphaPlane.length > 0);
    assert.ok(alphaPlane.some(value => value < 250), 'decoded alpha plane must contain transparency');

    const cached = await getH264Proxy(root, source);
    assert.deepEqual(cached, result);
});

test('opaque HEVC keeps the existing H.264 MP4 fallback', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = makeTempProject(t);
    const source = join(root, 'opaque-hevc.mp4');
    execFileSync('ffmpeg', [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'color=c=blue:s=32x32:r=5:d=0.4',
        '-c:v', 'libx265',
        '-x265-params', 'log-level=error',
        '-pix_fmt', 'yuv420p',
        '-tag:v', 'hvc1',
        source
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    assert.equal(await probeVideoCodecName(source), 'hevc');
    assert.doesNotMatch(await probeVideoPixelFormat(source), /^yuva/i);
    const result = await getH264Proxy(root, source);
    assert.equal(result.status, 'ready');
    assert.equal(extname(result.proxyPath), '.mp4');
    assert.equal(await probeVideoCodecName(result.proxyPath), 'h264');
});
