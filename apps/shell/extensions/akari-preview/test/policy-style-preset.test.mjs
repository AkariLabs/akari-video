import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { toV2Edit } from './helpers/v2-fixture.mjs';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

const displayPolicy = {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 20,
    minimum_fragment_duration_seconds: 0.72,
    locale: 'ja',
    lines: 1,
    wrap: 'multi'
};

const baseCaption = {
    id: 'c-0001',
    src: 'a',
    start: 0,
    end: 2,
    text: 'ニュース',
    speaker: null,
    sourceRef: null,
    edited: false
};

test('display_policy 経路で subtitle-news の style_preset を style_vars へ解決する', async () => {
    const payload = await resolveFixture({ ...baseCaption, style_preset: 'subtitle-news' });
    assert.equal(payload.captions[0].style_vars['--plate-bg'], 'rgba(198,40,40,1)');
    assert.equal(payload.captions[0].style_vars['--caption-font-size'], '56px');
});

test('style_preset と同じ cue の text_style はプリセットより優先される', async () => {
    const payload = await resolveFixture({
        ...baseCaption,
        style_preset: 'subtitle-news',
        text_style: { color: '#12ab34' }
    });
    assert.equal(payload.captions[0].style_vars['--caption-color'], '#12ab34');
    assert.equal(payload.captions[0].style_vars['--plate-bg'], 'rgba(198,40,40,1)');
    assert.equal(payload.captions[0].style_vars['--caption-font-size'], '56px');
});

test('未知の style_preset id は例外にせず payload を返す', async () => {
    const payload = await resolveFixture({ ...baseCaption, style_preset: 'unknown-preset' });
    assert.equal(payload.schema, 'caption-layout/v1');
    assert.equal(payload.captions[0].source_cue_id, 'c-0001');
});

async function resolveFixture(caption) {
    const root = await mkdtemp(join(tmpdir(), 'akari-shell-policy-style-preset-'));
    try {
        const captionsPath = join(root, 'captions.json');
        const editPath = join(root, 'edit.json');
        await writeFile(captionsPath, JSON.stringify({
            display_policy: displayPolicy,
            captions: [caption]
        }));
        await writeFile(editPath, JSON.stringify(toV2Edit({
            version: 1,
            sources: [{ id: 'a', path: 'source.mp4' }],
            cuts: [{ src: 'a', in: 0, out: 2 }],
            output: { width: 1920, height: 1080, fps: 30 }
        })));
        const service = new AkariPreviewServiceImpl();
        service.workspaceServer = {
            getMostRecentlyUsedWorkspace: async () => pathToFileURL(root).toString()
        };
        return await service.resolveCaptionDisplay({
            captionsUri: pathToFileURL(captionsPath).toString(),
            editUri: pathToFileURL(editPath).toString()
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
