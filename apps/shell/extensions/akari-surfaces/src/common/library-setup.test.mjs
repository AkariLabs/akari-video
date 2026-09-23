import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nextFirstRunSetupStep, shouldAutoOpenFirstRunSetup } = require('../../lib/common/first-run-onboarding.js');
const { summarizeLibraryStorage, librarySyncChoices, libraryMoveCopy } = require('../../lib/common/library-storage.js');

test('素材を作業場とパートナーの間に置き、戻るとスキップを扱う', () => {
    assert.equal(nextFirstRunSetupStep('workspace', 'workspace-created'), 'library');
    assert.equal(nextFirstRunSetupStep('library', 'back'), 'workspace');
    assert.equal(nextFirstRunSetupStep('library', 'skip'), 'connection');
    assert.equal(nextFirstRunSetupStep('connection', 'back'), 'library');
    assert.equal(nextFirstRunSetupStep('library', 'next'), 'connection');
    assert.equal(shouldAutoOpenFirstRunSetup({ hasOpenProject: false, hasCreatorRootPointer: false,
        hasProjectHistory: false, markerSeen: true }), false);
});

test('同期の確認中だけ三つの選択肢を示す', () => {
    assert.deepEqual(librarySyncChoices('pending'), ['このまま使う', '別の場所を選ぶ', '今は移さない']);
    assert.deepEqual(librarySyncChoices('done'), []);
});

for (const [state, count, bytes, expected] of [
    ['pending', 1, 4096, { transfer: true, sync: true, retained: false }],
    ['pending', 0, 0, { transfer: false, sync: true, retained: false }],
    ['declined', 1, 4096, { transfer: false, sync: false, retained: true }],
    ['declined', 0, 0, { transfer: false, sync: false, retained: true }],
    ['done', 1, 4096, { transfer: false, sync: false, retained: false }],
    ['done', 0, 0, { transfer: false, sync: false, retained: false }],
    [null, 1, 4096, { transfer: true, sync: false, retained: false }],
    [null, 0, 0, { transfer: false, sync: false, retained: false }]
]) test(`置き場の案内: ${state ?? '未決定'}・旧素材 ${count} 件`, () => {
    const copy = libraryMoveCopy(state, { count, bytes }, 'OneDrive');
    assert.deepEqual({ transfer: !!copy.transfer, sync: !!copy.sync, retained: !!copy.retained }, expected);
    if (state === 'declined') {
        assert.match(copy.retained, /今の置き場のまま使います/);
        assert.doesNotMatch(JSON.stringify(copy), /移します|0\.0 MB/);
    }
    if (state === 'pending' && count > 0) assert.match(copy.sync, /OneDrive.*4 KB/);
    if (state === null && count > 0) assert.match(copy.transfer, /1 個・約 4 KB/);
});

test('内訳と片づけ候補は取得済みの Lab だけ', () => {
    const items = [
        { id: 'lab', category: 'audio', title: 'Lab', sourceKind: 'lab', libraryDir: '/tmp/lab', files: [{ bytes: 7 }] },
        { id: 'site', category: 'audio', title: 'Site', sourceKind: 'site', libraryDir: '/tmp/site', files: [{ bytes: 11 }] },
        { id: 'own', category: 'still', title: 'Own', sourceKind: 'own', libraryDir: '/tmp/own', files: [{ bytes: 13 }] },
        { id: 'remote', category: 'audio', title: 'Remote', sourceKind: 'lab', files: [{ bytes: 100 }] }
    ];
    const result = summarizeLibraryStorage(items);
    assert.equal(result.totalBytes, 31);
    assert.deepEqual([result.bySource.lab.bytes, result.bySource.site.bytes, result.bySource.own.bytes], [7, 11, 13]);
    assert.deepEqual(result.cleanup.map(item => item.id), ['lab']);
    assert.equal(result.cleanupBytes, 7);
});
