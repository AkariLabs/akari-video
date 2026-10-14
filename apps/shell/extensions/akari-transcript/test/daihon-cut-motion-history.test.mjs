import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
import { BinaryBuffer } from '@theia/core/lib/common/buffer.js';
import { cutMotionReferencePaths } from '@akari-video/edit-store';
import { AkariAnnotationsServiceImpl } from '../../akari-annotations/lib/node/akari-annotations-service.js';

const URI = uriModule.default ?? uriModule;
const widgetSource = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = widgetSource.indexOf('    protected async withHistory(');
const end = widgetSource.indexOf('    protected async applyWordPreset(', start);
const code = ts.transpileModule(`class Daihon { ${widgetSource.slice(start, end)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const times = [0, 398, 400, 401, 402, 403, 441, 450, 936];
const points = times.map((t, index) => ({ t, transform: { scale: index === 0 || index === 8 ? 1 : 1.1 } }));
const originalEdit = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'video', path: 'video.mp4' }], tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'sample-split', at: 152, duration: 936,
            source: { kind: 'media', src: 'video', in: 0, out: 936 / 30 },
            keyframes: { path: 'motion/sample-split.json', count: 9 } }
    ] }] });
const source = value => `${JSON.stringify(value, null, 2)}\n`;

for (const range of [[41, 63], [900, 901]]) test(`台本のカット ${range.join('-')} は袋を含めて undo/redo できる`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-daihon-motion-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'motion'));
    const editPath = join(root, 'edit.json');
    const captionsPath = join(root, 'captions.json');
    const motionPath = join(root, 'motion/sample-split.json');
    const before = source(originalEdit());
    const bagBefore = source({ version: 0, group: 'sample-split', items: { 'sample-split': points } });
    await writeFile(editPath, before);
    await writeFile(captionsPath, '[]\n');
    await writeFile(motionPath, bagBefore);
    const service = new AkariAnnotationsServiceImpl();
    const history = [];
    const Daihon = new Function('daihonHistoryService', 'cutMotionReferencePaths', 'BinaryBuffer',
        `${code}\nreturn Daihon;`)(() => ({ push: entry => history.push(entry) }), cutMotionReferencePaths, BinaryBuffer);
    const widget = new Daihon();
    widget.editUri = new URI(pathToFileURL(editPath).toString());
    widget.captionsUri = new URI(pathToFileURL(captionsPath).toString());
    widget.rootUri = new URI(pathToFileURL(root).toString());
    widget.readText = uri => readFile(fileURLToPath(uri.toString()), 'utf8');
    widget.fileService = { createFolder: uri => mkdir(fileURLToPath(uri.toString()), { recursive: true }),
        writeFile: (uri, value) => writeFile(fileURLToPath(uri.toString()), value.toString()) };
    widget.annotationsService = service;
    widget.refreshCutTimeline = () => undefined;
    widget.reload = async () => undefined;
    await widget.withHistory('カット', async () => {
        await service.applyCutRanges({ editUri: widget.editUri.toString(), projectRootUri: widget.rootUri.toString(),
            ranges: [{ in: range[0] / 30, out: range[1] / 30, kind: 'row', captionId: 'video' }], label: 'カット' });
    }, true);
    assert.equal(history.length, 1);
    const after = await readFile(editPath, 'utf8');
    assert.notEqual(after, before);
    await history[0].undo();
    assert.deepEqual(JSON.parse(await readFile(editPath, 'utf8')).tracks, originalEdit().tracks);
    assert.deepEqual(JSON.parse(await readFile(motionPath, 'utf8')).items['sample-split'], points);
    await history[0].redo();
    const redone = JSON.parse(await readFile(editPath, 'utf8'));
    for (const item of redone.tracks[0].items) {
        if (!item.keyframes || Array.isArray(item.keyframes)) continue;
        const motion = JSON.parse(await readFile(join(root, item.keyframes.path), 'utf8'));
        assert.equal(motion.items[item.id].length, item.keyframes.count);
    }
});
