import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isLibraryFavoriteKey, LIBRARY_FAVORITES_SCHEMA, parseLibraryFavorites, serializeLibraryFavorites, toggleLibraryFavorite
} from '../lib/common/library-favorites.js';
import { libraryFavoritesPath, readLibraryFavorites, setLibraryFavorite } from '../lib/node/library-favorites-store.js';

test('key の形: <種類>/<id>。空・パスの上り・制御文字は捨てる', () => {
    for (const key of ['still/photo', 'audio/bgm-01', 'textstyle/news', 'mystyle/orange-title', 'transition/fade', 'still/写真 1'])
        assert.equal(isLibraryFavoriteKey(key), true, key);
    for (const key of ['', 'photo', '/still/photo', 'still/../x', '../still/x', 'still/\n', 42, null, 'a/ b'])
        assert.equal(isLibraryFavoriteKey(key), false, String(key));
});

test('読み: 壊れた・古い形でも落とさず、重複を除いて順を保つ', () => {
    assert.deepEqual(parseLibraryFavorites(undefined), []);
    assert.deepEqual(parseLibraryFavorites('{broken'), []);
    assert.deepEqual(parseLibraryFavorites('{"keys": "x"}'), []);
    assert.deepEqual(parseLibraryFavorites('["still/a", "still/a", "bad", "audio/b"]'), ['still/a', 'audio/b']);
    assert.deepEqual(parseLibraryFavorites(JSON.stringify({ schema: LIBRARY_FAVORITES_SCHEMA, keys: ['audio/b', 'still/a'] })), ['audio/b', 'still/a']);
});

test('付ける = 先頭へ・外す = 取り除く。書き出しは schema 付き', () => {
    let keys = toggleLibraryFavorite([], 'still/a', true);
    keys = toggleLibraryFavorite(keys, 'audio/b', true);
    keys = toggleLibraryFavorite(keys, 'still/a', true);
    assert.deepEqual(keys, ['still/a', 'audio/b']);
    keys = toggleLibraryFavorite(keys, 'still/a', false);
    assert.deepEqual(keys, ['audio/b']);
    assert.throws(() => toggleLibraryFavorite(keys, '../x', true));
    assert.deepEqual(JSON.parse(serializeLibraryFavorites(['audio/b', 'audio/b'])), { schema: LIBRARY_FAVORITES_SCHEMA, keys: ['audio/b'] });
});

test('保存と読み出し（AKARI_HOME/library-favorites.json・連打しても消えない）', async () => {
    const home = await mkdtemp(join(tmpdir(), 'libcanvas-l1-favorites-'));
    try {
        const file = libraryFavoritesPath({ AKARI_HOME: home });
        assert.equal(file, join(home, 'library-favorites.json'));
        assert.deepEqual(await readLibraryFavorites(file), []);
        await Promise.all(['still/a', 'still/b', 'audio/c', 'textstyle/d'].map(key => setLibraryFavorite(file, key, true)));
        assert.deepEqual(new Set(await readLibraryFavorites(file)), new Set(['still/a', 'still/b', 'audio/c', 'textstyle/d']));
        assert.deepEqual(await setLibraryFavorite(file, 'still/b', false), (await readLibraryFavorites(file)));
        assert.equal((await readLibraryFavorites(file)).includes('still/b'), false);
        const saved = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(saved.schema, LIBRARY_FAVORITES_SCHEMA);
        await writeFile(file, '{broken');
        assert.deepEqual(await readLibraryFavorites(file), []);
        assert.deepEqual(await setLibraryFavorite(file, 'still/a', true), ['still/a']);
        await assert.rejects(setLibraryFavorite(file, 'bad', true));
        assert.deepEqual(await readLibraryFavorites(file), ['still/a'], '不正な key は書かない');
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
