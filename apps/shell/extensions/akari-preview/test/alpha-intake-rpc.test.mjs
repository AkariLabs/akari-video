import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { alphaIntakeModuleCandidates, prepareAlphaIntake } from '../lib/node/alpha-intake.js';

// task/2026-09-02-shell-frame-engine-alpha-intake: shell の node 側から media-bin alpha-intake を呼ぶ
// RPC 実体の実ビヘイビア。alpha-playback-proxy.test.mjs と同じく実 ffmpeg で小さなアルファ付き
// フィクスチャを都度生成し、派生物（色 mp4 + マスク mp4）が Web UI（preview-server）と同じ場所・
// 同じ形式で作られることを ffprobe で確かめる。
const commandExists = command => {
    try {
        execFileSync(command, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};
const hasMediaTools = commandExists('ffmpeg') && commandExists('ffprobe');
const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
const makeTempProject = t => {
    const root = mkdtempSync(join(tmpdir(), 'akari-preview-alpha-intake-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
};
const probeStream = file => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height',
    '-of', 'json', file
], { encoding: 'utf8' })).streams?.[0] ?? {};
// WebM は ms 単位のタイムベースなので、5 fps のような端数だと ffprobe の r_frame_rate が 1000/1 になり
// media-bin のマスク規格検証（fps 一致）に落ちる。WebM 側は実運用と同じ 24 fps で作る。
const generate = (output, { fps = 5, encoderArgs = [] } = {}) => execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi',
    '-i', `color=c=red@0.35:s=32x32:r=${fps}:d=0.4,format=yuva444p10le`,
    ...encoderArgs, output
]);

test('alpha-intake helper is located inside the repository checkout', () => {
    const candidates = alphaIntakeModuleCandidates();
    assert.ok(candidates.every(candidate => candidate.endsWith(join('packages', 'media-bin', 'src', 'alpha-intake.mjs'))));
    assert.ok(candidates.some(candidate => existsSync(candidate)), 'one candidate must exist in this checkout');
});

test('ProRes 4444 layer source becomes an H.264 color mp4 plus a mask mp4 next to it, idempotently', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = makeTempProject(t);
    const source = join(root, 'person-mosaic.mov');
    generate(source, { encoderArgs: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'] });
    const first = await prepareAlphaIntake(source, tools);
    assert.equal(first.status, 'alpha');
    assert.equal(first.colorPath, join(root, 'person-mosaic.color.mp4'));
    assert.equal(first.maskPath, join(root, 'person-mosaic.mask.mp4'));
    assert.equal(first.maskFormat, 'gray-h264-fullrange');
    assert.equal(first.skipped, false);
    const color = probeStream(first.colorPath);
    assert.equal(color.codec_name, 'h264');
    assert.equal(color.pix_fmt, 'yuv420p');
    assert.deepEqual([color.width, color.height], [32, 32]);
    assert.equal(probeStream(first.maskPath).codec_name, 'h264');
    const colorMtime = statSync(first.colorPath).mtimeMs;
    const second = await prepareAlphaIntake(source, tools);
    assert.equal(second.status, 'alpha');
    assert.equal(second.skipped, true, 'fresh derivatives must not re-run ffmpeg');
    assert.equal(statSync(first.colorPath).mtimeMs, colorMtime);
});

test('VP9 alpha WebM (person-cutout output) takes the same intake path', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = makeTempProject(t);
    const source = join(root, 'person-0.webm');
    generate(source, { fps: 24, encoderArgs: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0'] });
    const result = await prepareAlphaIntake(source, tools);
    assert.equal(result.status, 'alpha');
    assert.equal(result.colorPath, join(root, 'person-0.color.mp4'));
    assert.equal(result.maskPath, join(root, 'person-0.mask.mp4'));
    assert.equal(probeStream(result.colorPath).codec_name, 'h264');
    assert.equal(probeStream(result.maskPath).codec_name, 'h264');
});

test('an opaque source is reported as opaque and leaves no derivatives behind', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const root = makeTempProject(t);
    const source = join(root, 'pinp.mov');
    generate(source, { encoderArgs: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] });
    const result = await prepareAlphaIntake(source, tools);
    assert.equal(result.status, 'opaque');
    assert.equal(existsSync(join(root, 'pinp.color.mp4')), false);
    assert.equal(existsSync(join(root, 'pinp.mask.mp4')), false);
});

test('a missing source is unavailable rather than thrown', async t => {
    const root = makeTempProject(t);
    const result = await prepareAlphaIntake(join(root, 'nope.webm'), tools);
    assert.deepEqual(result, { status: 'unavailable', reason: 'source-missing' });
});
