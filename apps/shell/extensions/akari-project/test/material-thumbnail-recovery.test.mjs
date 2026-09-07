import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const frontend = fs.readFileSync(new URL('../lib/browser/akari-role-buckets-widget.js', import.meta.url), 'utf8');
const from = frontend.indexOf('    async hydrateCachedThumbnails(');
const to = frontend.indexOf('    // --- ライブ反映', from);
const Widget = new Function(`return class { ${frontend.slice(from, to)} };`)();
test('analyzed materials without keyframes receive cached thumbnails, but valid keyframes stay', async () => {
    const requested = [];
    const widget = Object.assign(new Widget(), { materialsGeneration: 1, update() {}, projectService: {
        async resolveMaterialThumbnail(root, name) { requested.push(name); return { available: true, cacheRelativePath: 'cache.jpg' }; }
    }});
    const root = { toString: () => 'root', resolve: name => name };
    const missing = { kind: 'video', analyzed: true, relativePath: 'clip.mp4' };
    const valid = { kind: 'video', analyzed: true, thumbnailUri: 'keyframe.jpg' };
    await widget.hydrateCachedThumbnails(root, 1, [missing, valid, { kind: 'audio' }]);
    assert.deepEqual(requested, ['clip.mp4']);
    assert.equal(missing.thumbnailUri, 'cache.jpg');
    assert.equal(valid.thumbnailUri, 'keyframe.jpg');
});
test('broken thumbnails fall back only once, avoiding an image-error loop', async () => {
    let requests = 0;
    const root = { toString: () => 'root', resolve: name => name };
    const widget = Object.assign(new Widget(), { materialsGeneration: 1, workflow: { workspaceRoot: root }, update() {}, projectService: {
        async resolveMaterialThumbnail() { requests++; return { available: true, cacheRelativePath: 'cache.jpg' }; }
    }});
    const entry = { kind: 'video', thumbnailUri: 'missing.jpg', relativePath: 'clip.mp4' };
    widget.handleMaterialThumbnailError(entry);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entry.thumbnailUri, 'cache.jpg');
    widget.handleMaterialThumbnailError(entry);
    assert.equal(entry.thumbnailUri, undefined);
    assert.equal(requests, 1);
});
test('a stale project request does not replace thumbnails', async () => {
    const widget = Object.assign(new Widget(), { materialsGeneration: 2, update() { assert.fail('stale update'); }, projectService: {
        async resolveMaterialThumbnail() { return { available: true, cacheRelativePath: 'cache.jpg' }; }
    }});
    const entry = { kind: 'video', relativePath: 'clip.mp4' };
    await widget.hydrateCachedThumbnails({ toString: () => 'old' }, 1, [entry]);
    assert.equal(entry.thumbnailUri, undefined);
});
test('sub-half-second video yields a real thumbnail', async t => {
    try { await execFileAsync('ffmpeg', ['-version']); } catch { t.skip('ffmpeg unavailable'); return; }
    const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'akari-thumb-recovery-'));
    try {
        const src = path.join(dir, 'short.mp4');
        await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30', '-t', '0.2', '-pix_fmt', 'yuv420p', src]);
        const source = fs.readFileSync(new URL('../lib/node/akari-project-service.js', import.meta.url), 'utf8');
        const start = source.indexOf('    async generateThumbnail(');
        const end = source.indexOf('    /**', start);
        const Service = new Function('fs_1', 'path_1', 'execFileAsync', `return class { ${source.slice(start, end)} };`)(fs, path, execFileAsync);
        const service = Object.assign(new Service(), { resolveFfmpegPath: async () => 'ffmpeg' });
        const out = path.join(dir, 'thumb.jpg');
        assert.equal((await service.generateThumbnail('video', src, dir, out, 'thumb.jpg', 'thumb.jpg')).available, true);
        assert.ok((await fs.promises.stat(out)).size > 0);
        assert.equal((await fs.promises.readFile(out)).readUInt16BE(0), 0xffd8);
    } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
});
