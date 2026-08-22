import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { persistCaptionZone, updateCaptionZoneSource } from '../lib/common/caption-zone-write.js';

const here = dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const require = createRequire(import.meta.url);
const { lintProjectCandidates } = require('../../../../../packages/edit-store/lib/write-gate.js');

for (const rootShape of ['array', 'object']) {
    test(`caption zone persists after serialization and reload (${rootShape} root)`, () => {
        const cues = [{
            id: 'c-0001', start: 0.3, end: 2, text: '字幕', speaker: null,
            text_style: { color: '#fff', zone: 'bottom' }
        }];
        const root = rootShape === 'array' ? cues : { default_text_style: { size: 38 }, captions: cues };
        const next = updateCaptionZoneSource(JSON.stringify(root), 'c-0001', 'top-right');
        const reloaded = JSON.parse(next);
        const caption = Array.isArray(reloaded) ? reloaded[0] : reloaded.captions[0];
        assert.equal(caption.text_style.zone, 'top-right');
        assert.equal(caption.text_style.color, '#fff');
        assert.equal(caption.text, '字幕');
    });
}

test('successful caption write refreshes the webview instead of suppressing its own watcher only', () => {
    const start = handlerSource.indexOf('protected async handleCaptionWrite');
    const end = handlerSource.indexOf('protected isCaptionWriteRequest', start);
    const handler = handlerSource.slice(start, end);
    assert.match(handler, /persistCaptionZone/);
    assert.match(handler, /this\.queueCaptionsUpdate\(widget\)/);
});

test('caption zone passes the project lint gate and is written to captions.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caption-zone-write-'));
    const captionsPath = join(root, 'captions.json');
    try {
        await mkdir(join(root, 'assets'));
        await writeFile(join(root, 'assets', 'a.mp4'), 'fixture');
        await writeFile(join(root, 'edit.json'), JSON.stringify({
            version: 2,
            output: { width: 1920, height: 1080, fps: 30 },
            sources: [{ id: 'a', path: 'assets/a.mp4' }],
            tracks: [{
                id: 'v-main', lane: 'visual', items: [
                    { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } }
                ]
            }]
        }, null, 2));
        await writeFile(captionsPath, JSON.stringify([{
            id: 'c-0001', start: 0.3, end: 2, text: '字幕', speaker: null,
            sourceRef: null, edited: false, src: 'a'
        }], null, 2));
        const source = await readFile(captionsPath, 'utf8');
        const result = await persistCaptionZone({
            source,
            captionId: 'c-0001',
            zone: 'top-right',
            lint: candidate => lintProjectCandidates(root, { 'captions.json': candidate }),
            write: candidate => writeFile(captionsPath, candidate, 'utf8')
        });
        assert.equal(result.pass, true, result.errors.join('\n'));
        const [saved] = JSON.parse(await readFile(captionsPath, 'utf8'));
        assert.equal(saved.text_style.zone, 'top-right');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
