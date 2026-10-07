import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialStripGenerator } from '../lib/node/material-strip.js';
import { materialImageRepeatCount, materialStripCells } from '../lib/common/materials-view.js';

function has(binary) {
    try { execFileSync(binary, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const mediaAvailable = has('ffmpeg') && has('ffprobe');
const temporaryProject = () => mkdtemp(join(tmpdir(), 'akari-strip-'));

test('strip cell count and still repeat count', () => {
    assert.equal(materialStripCells(undefined), 12);
    assert.equal(materialStripCells(6), 4);
    assert.equal(materialStripCells(30), 6);
    assert.equal(materialStripCells(120), 12);
    assert.equal(materialImageRepeatCount(), 5);
});

test('missing ffmpeg returns unavailable', async () => {
    const root = await temporaryProject();
    try {
        await writeFile(join(root, 'test.wav'), 'fixture');
        const generator = new MaterialStripGenerator({ ffmpegPath: async () => undefined, durationSeconds: async () => 3 });
        assert.deepEqual(await generator.resolve(root, 'test.wav', { cells: 4, cellWidth: 80 }), { available: false });
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('video and audio strips have requested width and reuse cache', { skip: !mediaAvailable }, async t => {
    const root = await temporaryProject();
    try {
        const assets = join(root, 'assets');
        await mkdir(assets);
        try {
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=6:size=160x90:rate=12',
                '-c:v', 'mpeg4', join(assets, 'test.mp4')]);
        } catch (error) {
            if (error.code === 'EPERM') { t.skip('ffmpeg execution is unavailable'); return; }
            throw error;
        }
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
            join(assets, 'test.wav')]);
        let calls = 0;
        const generator = new MaterialStripGenerator({
            ffmpegPath: async () => 'ffmpeg',
            durationSeconds: async source => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1', source], { encoding: 'utf8' }).trim()),
            runFfmpeg: async (binary, args) => { calls++; execFileSync(binary, args); }
        });
        for (const [file, cells] of [['test.mp4', 4], ['test.wav', 5]]) {
            const options = { cells, cellWidth: 80 };
            const first = await generator.resolve(root, `assets/${file}`, options);
            assert.equal(first.available, true, file);
            const png = await readFile(join(root, first.cacheRelativePath));
            assert.equal(png.readUInt32BE(16), cells * 80, file);
            const before = calls;
            const second = await generator.resolve(root, `assets/${file}`, options);
            assert.deepEqual(second, first);
            assert.equal(calls, before, `${file} cache hit`);
        }
    } finally { await rm(root, { recursive: true, force: true }); }
});
