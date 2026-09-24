import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    addBrandColor, BRAND_KIT_ADD_COLOR_COMMAND_ID, BRAND_KIT_GET_COMMAND_ID, BRAND_KIT_REMOVE_COLOR_COMMAND_ID, BRAND_KIT_SCHEMA,
    normalizeBrandColor, parseBrandKit, removeBrandColor, serializeBrandKit
} from '../lib/common/brand-kit.js';
import { brandKitPath, readBrandKit, updateBrandKit } from '../lib/node/brand-kit-store.js';

test('色の形: #RRGGBB(AA) の大文字へそろえ、読めない値は捨てる', () => {
    assert.equal(normalizeBrandColor('#00c4cc'), '#00C4CC');
    assert.equal(normalizeBrandColor('abc'), '#AABBCC');
    assert.equal(normalizeBrandColor('#00c4ccff'), '#00C4CC');
    assert.equal(normalizeBrandColor('#00c4cc80'), '#00C4CC80');
    for (const bad of ['', 'blue', '#12', null, 3]) assert.equal(normalizeBrandColor(bad), undefined);
});

test('読み: 壊れた・古い形でも落とさず、重複を除いて順を保つ', () => {
    assert.deepEqual(parseBrandKit(undefined), []);
    assert.deepEqual(parseBrandKit('{broken'), []);
    assert.deepEqual(parseBrandKit('["#ff0000", "#FF0000", "bogus", "#00ff00"]'), ['#FF0000', '#00FF00']);
    assert.deepEqual(parseBrandKit(JSON.stringify({ schema: BRAND_KIT_SCHEMA, colors: ['#123456'] })), ['#123456']);
    assert.deepEqual(JSON.parse(serializeBrandKit(['#ff0000', '#ff0000'])), { schema: BRAND_KIT_SCHEMA, colors: ['#FF0000'] });
});

test('足す = 末尾へ・同じ色は増やさない / 外す', () => {
    assert.deepEqual(addBrandColor(['#FF0000'], '#00ff00'), ['#FF0000', '#00FF00']);
    assert.deepEqual(addBrandColor(['#FF0000'], '#ff0000'), ['#FF0000']);
    assert.throws(() => addBrandColor([], 'blue'));
    assert.deepEqual(removeBrandColor(['#FF0000', '#00FF00'], '#ff0000'), ['#00FF00']);
});

test('保存: AKARI_HOME/brand-kit.json に 1 つ（どのプロジェクトからも同じ）・連打は直列', async () => {
    const home = await mkdtemp(join(tmpdir(), 'libcanvas-k1-brand-'));
    try {
        const file = brandKitPath({ AKARI_HOME: home });
        assert.equal(file, join(home, 'brand-kit.json'));
        assert.deepEqual(await readBrandKit(file), []);
        await Promise.all(['#111111', '#222222', '#333333'].map(color => updateBrandKit(file, 'add', color)));
        assert.deepEqual(await readBrandKit(file), ['#111111', '#222222', '#333333']);
        assert.deepEqual(await updateBrandKit(file, 'remove', '#222222'), ['#111111', '#333333']);
        assert.equal(JSON.parse(await readFile(file, 'utf8')).schema, BRAND_KIT_SCHEMA);
        await writeFile(file, '{broken');
        assert.deepEqual(await readBrandKit(file), []);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('コマンド id はインスペクター側の複製と一致する（拡張をまたぐので文字列で持つ）', async () => {
    const host = await readFile(new URL('../../akari-annotations/src/browser/inspector/color-panel-host.ts', import.meta.url), 'utf8');
    for (const id of [BRAND_KIT_GET_COMMAND_ID, BRAND_KIT_ADD_COLOR_COMMAND_ID, BRAND_KIT_REMOVE_COLOR_COMMAND_ID]) {
        assert.ok(host.includes(`'${id}'`), id);
    }
});
