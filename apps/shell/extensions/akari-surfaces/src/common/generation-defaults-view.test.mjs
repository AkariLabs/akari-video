import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    formatGenerationAudio, formatGenerationPrice, generationOptionLabel, generationOptions, generationSourceLabel
} from '../../lib/common/generation-defaults-view.js';

function findCatalog() {
    let directory = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = path.resolve(directory, 'packages/schemas/gen-models.json');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    return undefined;
}

const catalogPath = findCatalog();
assert.ok(catalogPath, '祖先に packages/schemas/gen-models.json が存在する');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const aiCatalog = JSON.parse(fs.readFileSync(path.join(path.dirname(catalogPath), 'ai-models.json'), 'utf8'));

test('価格を単価・範囲・見積不可・音声倍率つきで表示する', () => {
    const cases = [
        [null, '見積不可'],
        [{ unit: 'usd_per_second', by_resolution: {}, audio_multiplier: null }, '見積不可'],
        [{ unit: 'usd_per_second', by_resolution: { '': 0.112 }, audio_multiplier: null }, '$0.112/秒'],
        [{ unit: 'usd_per_second', by_resolution: { '480P': 0.05, '4K': 0.16 }, audio_multiplier: null }, '$0.05〜0.16/秒'],
        [{ unit: 'usd_per_second', by_resolution: { '720p': 0.2 }, audio_multiplier: 2 }, '$0.2/秒（音声つき ×2）']
    ];
    for (const [price, expected] of cases) assert.equal(formatGenerationPrice(price), expected);
});

test('音声出力の 3 値を表示する', () => {
    assert.equal(formatGenerationAudio('always'), '音声つき（固定）');
    assert.equal(formatGenerationAudio(true), '音声つき（切替）');
    assert.equal(formatGenerationAudio(false), '音声なし');
});

test('実カタログ行の option 文言が完全一致する', () => {
    const expected = {
        'fal:h3-i2v': 'MiniMax H3 · fal:h3-i2v · $0.05〜0.16/秒 · 音声つき（固定） · 2026-09-12 時点',
        'fal:kling-v3-standard-i2v': 'Kling Video v3 Standard · fal:kling-v3-standard-i2v · 見積不可 · 音声つき（切替） · 2026-09-12 時点',
        'codex:image': 'ChatGPT · codex:image · 見積不可 · 音声なし · 2026-09-12 時点'
    };
    for (const [id, label] of Object.entries(expected)) assert.equal(generationOptionLabel(catalog.models.find(model => model.id === id)), label);
});

test('画像・動画の表示名は AI モデル一覧の name と一致する', () => {
    const names = new Map(aiCatalog.models.filter(model => typeof model.name === 'string')
        .map(model => [model.id, model.name]));
    const checked = { image: 0, video: 0 };
    for (const model of catalog.models.filter(model => model.kind === 'image' || model.kind === 'video')) {
        const name = names.get(model.id);
        if (name === undefined) continue;
        assert.equal(generationOptionLabel(model).split(' · ')[0], name, model.id);
        checked[model.kind]++;
    }
    assert.ok(checked.image > 0, '表示名を明示した画像行を実カタログで検査する');
});

test('kind で絞り込み、順番を保ち、カタログ外の現在値だけ先頭に足す', () => {
    const videoIds = catalog.models.filter(model => model.kind === 'video').map(model => model.id);
    const ordinary = generationOptions(catalog.models, 'video', null);
    assert.deepEqual(ordinary.map(option => option.value), videoIds);
    assert.ok(ordinary.every(option => option.missing === false));
    const missing = generationOptions(catalog.models, 'image', 'legacy:image');
    assert.deepEqual(missing[0], { value: 'legacy:image', label: 'legacy:image · カタログにありません', missing: true });
    assert.deepEqual(missing.slice(1).map(option => option.value),
        catalog.models.filter(model => model.kind === 'image' && model.id !== 'fal:gpt-image-2.5-flare').map(model => model.id));
    const fal = generationOptions(catalog.models, 'image', 'fal:gpt-image-2.5-flare');
    assert.deepEqual(fal[0], { value: 'fal:gpt-image-2.5-flare',
        label: 'fal:gpt-image-2.5-flare · この画面では選べません', missing: true });
    assert.equal(fal.slice(1).some(option => option.value === 'fal:gpt-image-2.5-flare'), false);
});

test('出所の 3 値を表示する', () => {
    assert.equal(generationSourceLabel('project'), 'プロジェクト');
    assert.equal(generationSourceLabel('workspace'), 'ワークスペース');
    assert.equal(generationSourceLabel('default'), '既定');
});

test('実カタログは画像 3 行・動画 12 行で全行に as_of がある', () => {
    assert.equal(catalog.models.filter(model => model.kind === 'image').length, 3);
    assert.equal(catalog.models.filter(model => model.kind === 'video').length, 12);
    assert.ok(catalog.models.every(model => typeof model.as_of === 'string' && model.as_of.length > 0));
});
