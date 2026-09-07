import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProjects, readProjectView, saveProjectView } from '../../lib/common/project-browser.js';

test('検索は表示ページ外も含め、名前とチャンネルを組み合わせられる', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ name: `動画 ${i}`, channel: i % 2 ? '旅行' : '料理', key: `project-${i}` }));
    assert.deepEqual(filterProjects(rows, '旅行 ９９'), [rows[99]]);
    assert.equal(filterProjects(rows, '').length, 100);
    assert.deepEqual(filterProjects(rows, '旅行 98'), []);
});

test('単体プロジェクトと英数の大文字小文字・全角を検索できる', () => {
    const row = { name: 'AKARI Video', key: 'my-project' };
    assert.deepEqual(filterProjects([row], 'ａｋａｒｉ VIDEO'), [row]);
    assert.deepEqual(filterProjects([row], 'my-project'), [row]);
});

test('表示選択を保存し、保存領域が使えなくても切り替えを妨げない', () => {
    const saved = new Map();
    globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    assert.equal(readProjectView(), 'cards');
    saveProjectView('list');
    assert.equal(readProjectView(), 'list');
    delete globalThis.localStorage;
    assert.equal(readProjectView(), 'cards');
    assert.doesNotThrow(() => saveProjectView('cards'));
});
