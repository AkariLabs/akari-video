import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenableLibraryCategory } from '../lib/common/library-home-view.js';

test('resolveOpenableLibraryCategory returns all live category keys', () => {
    for (const key of [
        'bgm', 'sfx', 'broll', 'image', 'overlay', 'scene3d',
        'pack', 'textstyle', 'textanim', 'font', 'lut', 'transition'
    ]) {
        assert.equal(resolveOpenableLibraryCategory(key), key);
    }
});

test('resolveOpenableLibraryCategory ignores all soon category keys', () => {
    for (const key of ['fav', 'brandkit', 'mypresets', 'shapes', 'stamps', 'fx', 'motion', 'template']) {
        assert.equal(resolveOpenableLibraryCategory(key), undefined, key);
    }
});

test('resolveOpenableLibraryCategory ignores unknown and empty keys', () => {
    for (const key of ['not-a-real-key', undefined, '']) {
        assert.equal(resolveOpenableLibraryCategory(key), undefined);
    }
});
