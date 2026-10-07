import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { MaterialMetaReader } from '../lib/node/material-meta.js';

const execFileAsync = promisify(execFile);
const hasMediaTools = ['ffmpeg', 'ffprobe'].every(name => spawnSync(name, ['-version']).status === 0);

test('reads one-second audio and video metadata with ffprobe', { skip: !hasMediaTools }, async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'akari-material-meta-'));
    try {
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
            '-c:a', 'pcm_s16le', join(root, 'sound.wav')]);
        await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=1',
            '-c:v', 'mpeg4', '-an', join(root, 'picture.mp4')]);
        const reader = new MaterialMetaReader({ ffprobePath: async () => 'ffprobe' });
        const result = await reader.read(root, ['sound.wav', 'picture.mp4']);
        for (const path of ['sound.wav', 'picture.mp4']) {
            assert.ok(result[path].durationSeconds >= 0.9 && result[path].durationSeconds <= 1.1);
            assert.ok(result[path].importedAt);
            assert.ok(result[path].createdAt);
        }
        assert.ok((await fs.readFile(join(root, '.akari', 'cache', 'material-meta.json'), 'utf8')).includes('durationSeconds'));
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('persists metadata and does not probe cached material again', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'akari-material-meta-'));
    try {
        await fs.writeFile(join(root, 'clip.mp4'), 'media');
        let calls = 0;
        const options = {
            ffprobePath: async () => 'ffprobe',
            runFfprobe: async () => { calls++; return JSON.stringify({ format: { duration: '1.25', tags: { creation_time: '2024-01-02T03:04:05Z' } } }); }
        };
        const first = await new MaterialMetaReader(options).read(root, ['clip.mp4']);
        const second = await new MaterialMetaReader(options).read(root, ['clip.mp4']);
        assert.equal(first['clip.mp4'].durationSeconds, 1.25);
        assert.equal(first['clip.mp4'].createdAt, '2024-01-02T03:04:05.000Z');
        assert.deepEqual(second, first);
        assert.equal(calls, 1);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('corrupt cache and missing ffprobe leave the material list usable', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'akari-material-meta-'));
    try {
        await fs.mkdir(join(root, '.akari', 'cache'), { recursive: true });
        await fs.writeFile(join(root, '.akari', 'cache', 'material-meta.json'), '{broken');
        await fs.writeFile(join(root, 'clip.mp4'), 'media');
        const result = await new MaterialMetaReader({ ffprobePath: async () => undefined }).read(root, ['clip.mp4']);
        assert.deepEqual(Object.keys(result['clip.mp4']), ['importedAt']);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('limits simultaneous ffprobe calls to two', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'akari-material-meta-'));
    try {
        const paths = Array.from({ length: 5 }, (_, index) => `clip-${index}.mp4`);
        await Promise.all(paths.map(path => fs.writeFile(join(root, path), 'media')));
        let active = 0;
        let peak = 0;
        const reader = new MaterialMetaReader({
            ffprobePath: async () => 'ffprobe',
            runFfprobe: async () => {
                active++;
                peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active--;
                return JSON.stringify({ format: { duration: '1' } });
            }
        });
        const result = await reader.read(root, paths);
        assert.equal(Object.keys(result).length, paths.length);
        assert.equal(peak, 2);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
