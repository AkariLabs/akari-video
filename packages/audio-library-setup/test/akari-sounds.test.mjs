import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildPackCatalogMeta,
    buildPackLibraryMeta,
    planFromCatalog,
    releaseAssetUrl,
    zipAssetNames,
} from '../shared/akari-sounds.mjs';

const FIXTURE_CATALOG = {
    library: 'AKARI Sounds',
    version: 'v0',
    tracks: [
        {
            id: 'bgm-test-001',
            title: 'Test BGM',
            kind: 'bgm',
            files: [
                { file: 'bgm-test-001.wav', mp3: 'bgm-test-001.mp3', duration_sec: 30 },
                { file: 'bgm-test-001-b.wav', mp3: 'bgm-test-001-b.mp3', duration_sec: 31 },
            ],
        },
        {
            id: 'sfx-test-001',
            title: 'Test SFX',
            kind: 'sfx',
            files: [{ file: 'sfx-test-001.wav', mp3: 'sfx-test-001.mp3', duration_sec: 1 }],
        },
    ],
};

test('planFromCatalog groups tracks into per-kind packs with take-level files', () => {
    const plan = planFromCatalog(FIXTURE_CATALOG, { variant: 'mp3' });
    assert.equal(plan.library, 'AKARI Sounds');
    assert.equal(plan.totalFiles, 3);
    assert.deepEqual(plan.packs.map((p) => p.id), ['akari-sounds-bgm', 'akari-sounds-sfx']);

    const bgm = plan.packs.find((p) => p.id === 'akari-sounds-bgm');
    assert.equal(bgm.trackCount, 1);
    assert.equal(bgm.takeCount, 2);
    assert.deepEqual(bgm.files, ['bgm-test-001.mp3', 'bgm-test-001-b.mp3']);
});

test('planFromCatalog wav variant selects wav filenames', () => {
    const plan = planFromCatalog(FIXTURE_CATALOG, { variant: 'wav' });
    const sfx = plan.packs.find((p) => p.id === 'akari-sounds-sfx');
    assert.deepEqual(sfx.files, ['sfx-test-001.wav']);
});

test('planFromCatalog rejects a catalog without tracks[]', () => {
    assert.throws(() => planFromCatalog({}), /tracks 配列がない/);
});

test('zipAssetNames maps variant to the v0 release layout and rejects unknown variants', () => {
    assert.deepEqual(zipAssetNames('mp3'), ['akari-sounds-mp3.zip']);
    assert.deepEqual(zipAssetNames('wav'), [
        'akari-sounds-wav-1.zip',
        'akari-sounds-wav-2.zip',
        'akari-sounds-wav-3.zip',
    ]);
    assert.throws(() => zipAssetNames('flac'), /unknown variant/);
});

test('release asset URLs point at the AkariLabs/akari-sounds release, not raw audio paths elsewhere', () => {
    assert.equal(
        releaseAssetUrl('akari-sounds-mp3.zip', 'v0'),
        'https://github.com/AkariLabs/akari-sounds/releases/download/v0/akari-sounds-mp3.zip',
    );
});

test('pack meta builders produce schema v0-shaped metadata (library has no remote key, catalog is remote:true)', () => {
    const plan = planFromCatalog(FIXTURE_CATALOG, { variant: 'mp3' });
    const pack = plan.packs[0];

    const libraryMeta = buildPackLibraryMeta(pack, { tag: 'v0', fetchedAt: '2026-08-03' });
    assert.equal(libraryMeta.id, 'akari-sounds-bgm');
    assert.equal(libraryMeta.category, 'audio');
    assert.equal(Object.hasOwn(libraryMeta, 'remote'), false, 'library scope の実体エントリは remote キーを持たない');
    assert.equal(libraryMeta.license.attribution_required, false);
    assert.equal(libraryMeta.license.ai_training_allowed, false);
    assert.equal(libraryMeta.provenance.generator, 'suno');

    const catalogMeta = buildPackCatalogMeta(pack, { tag: 'v0' });
    assert.equal(catalogMeta.remote, true);
    assert.match(catalogMeta.source.url, /github\.com\/AkariLabs\/akari-sounds\/releases/);
});
