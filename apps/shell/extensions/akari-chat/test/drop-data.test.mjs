import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readChatDropData, hasChatDropData, shouldPrefetchLibraryCatalog } = require('../lib/browser/chat-drop-data.js');
const root = '/project';

test('material and preview payloads attach project paths without importing', () => {
    const result = readChatDropData({ 'application/x-akari-material': JSON.stringify({
        relativePath: 'assets/clip.mp4', name: 'clip.mp4' }) }, [], root);
    assert.deepEqual(result.paths, [{ path: '/project/assets/clip.mp4', label: 'clip.mp4' }]);
    assert.equal(result.unsupported, false);
    assert.equal(hasChatDropData(['application/x-akari-material']), true);
    assert.equal(hasChatDropData(['application/x-akari-library-item']), true);
    assert.equal(hasChatDropData(['theia-editor-dnd']), true);
    assert.equal(hasChatDropData(['Files']), true);
});

test('library asset keys are resolved separately and non-file items are rejected', () => {
    assert.deepEqual(readChatDropData({ 'application/x-akari-library-item': JSON.stringify({
        kind: 'audio', key: 'audio/intro', id: 'intro', category: 'audio' }) }, [], root).libraryKeys, ['audio/intro']);
    assert.equal(readChatDropData({ 'application/x-akari-library-item': JSON.stringify({
        kind: 'transition', id: 'fade' }) }, [], root).unsupported, true);
});

test('catalog prefetch starts only for library drag data or a keyed library drag event', () => {
    assert.equal(shouldPrefetchLibraryCatalog(['application/x-akari-library-item']), true);
    assert.equal(shouldPrefetchLibraryCatalog([], { kind: 'audio', key: 'audio/intro' }), true);
    assert.equal(shouldPrefetchLibraryCatalog([], { category: 'broll', id: 'clip' }), true);
    assert.equal(shouldPrefetchLibraryCatalog(['Files', 'text/plain']), false);
    assert.equal(shouldPrefetchLibraryCatalog([], { kind: 'transition', key: 'transition/fade' }), false);
    assert.equal(shouldPrefetchLibraryCatalog([], { kind: 'text' }), false);
    assert.equal(shouldPrefetchLibraryCatalog([], { key: '../outside' }), false);
});

test('Theia editor and tree node URIs and Finder files are accepted', () => {
    const result = readChatDropData({
        'theia-editor-dnd': 'file:///project/a.mp4\nfile:///project/b.mp4',
        'tree-node': JSON.stringify({ id: 'file:///project/c.mp4' }),
        'selected-tree-nodes': JSON.stringify([{ id: 'file:///project/d.mp4' }])
    }, [{ path: '/outside/from-finder.mov', label: 'from-finder.mov' }], root);
    assert.deepEqual(result.paths.map(item => item.path), [
        '/outside/from-finder.mov', '/project/a.mp4', '/project/b.mp4', '/project/c.mp4', '/project/d.mp4'
    ]);
});

test('invalid JSON and escaping material paths never produce attachment paths', () => {
    for (const value of ['{', JSON.stringify({ relativePath: '../secret.mp4' }),
        JSON.stringify({ relativePath: 'assets/../../secret.mp4' })]) {
        const result = readChatDropData({ 'application/x-akari-material': value }, [], root);
        assert.deepEqual(result.paths, []);
        assert.equal(result.unsupported, true);
    }
});
