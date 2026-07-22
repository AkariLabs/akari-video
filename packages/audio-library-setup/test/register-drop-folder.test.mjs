import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scriptPath = path.join(here, '..', 'bin', 'register-drop-folder.mjs');
const candidatesPath = path.join(repoRoot, 'catalog', 'audio', 'candidates.json');
const validateAssetScript = path.join(repoRoot, 'packages', 'schemas', 'bin', 'validate-asset.mjs');

async function withFixture(run) {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-audio-drop-'));
    const dropDir = path.join(root, 'drop');
    const libraryRoot = path.join(root, 'library', 'audio');
    const catalogDir = path.join(root, 'catalog', 'audio');
    await mkdir(dropDir, { recursive: true });
    await mkdir(libraryRoot, { recursive: true });
    await mkdir(catalogDir, { recursive: true });
    try {
        await run({ root, dropDir, libraryRoot, catalogDir });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function runScript(args) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
    return { ...result, json: result.stdout ? JSON.parse(result.stdout) : null };
}

test('plan-only mode does not move any files', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, 'doon1.mp3'), 'dummy');
        await writeFile(path.join(dropDir, 'unknown-track.mp3'), 'dummy');

        const { status, json } = runScript([
            '--drop-dir', dropDir,
            '--library-root', libraryRoot,
            '--catalog-dir', catalogDir,
            '--candidates', candidatesPath,
        ]);

        assert.equal(status, 0);
        assert.equal(json.mode, 'plan-only');
        assert.equal(json.total_files_scanned, 2);
        assert.equal(json.matched_candidates.length, 1);
        assert.equal(json.matched_candidates[0].candidate_id, 'soundeffect-lab-doon1');
        assert.equal(json.quarantined.length, 1);
        assert.equal(json.quarantined[0].file, 'unknown-track.mp3');

        // plan-only ではファイルは一切動かない
        const dropFilesAfter = await readdir(dropDir);
        assert.deepEqual(dropFilesAfter.sort(), ['doon1.mp3', 'unknown-track.mp3']);
    });
});

test('--apply registers matched files into library-root and catalog, quarantines unmatched', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, 'doon1.mp3'), 'dummy-audio-bytes');
        await writeFile(path.join(dropDir, 'shock2.wav'), 'dummy-audio-bytes');
        await writeFile(path.join(dropDir, 'unknown-track.mp3'), 'dummy-audio-bytes');
        await writeFile(path.join(dropDir, 'notes.txt'), 'not audio, must be ignored');

        const { status, json } = runScript([
            '--drop-dir', dropDir,
            '--library-root', libraryRoot,
            '--catalog-dir', catalogDir,
            '--candidates', candidatesPath,
            '--apply',
        ]);

        assert.equal(status, 0);
        assert.equal(json.mode, 'apply');

        // library-root: 一致した音源が実体として移動している
        const libDoon = await readdir(path.join(libraryRoot, 'soundeffect-lab-doon1'));
        assert.ok(libDoon.includes('doon1.mp3'));
        assert.ok(libDoon.includes('meta.json'));

        const libMeta = JSON.parse(await readFile(path.join(libraryRoot, 'soundeffect-lab-doon1', 'meta.json'), 'utf8'));
        assert.equal(libMeta.id, 'soundeffect-lab-doon1');
        assert.equal(libMeta.category, 'audio');
        assert.equal(hasOwn(libMeta, 'remote'), false, 'library scope の実体エントリは remote キーを持たない');
        assert.equal(libMeta.license.ai_training_allowed, false);

        // catalog: remote:true の参照エントリが書かれている
        const catalogMeta = JSON.parse(await readFile(path.join(catalogDir, 'soundeffect-lab-doon1', 'meta.json'), 'utf8'));
        assert.equal(catalogMeta.remote, true);
        assert.equal(catalogMeta.source.url, 'https://soundeffect-lab.info/sound/anime/');

        // 未一致ファイルは _quarantine へ、notes.txt は対象外のままドロップフォルダに残る
        const dropFilesAfter = await readdir(dropDir);
        assert.ok(dropFilesAfter.includes('notes.txt'));
        assert.ok(!dropFilesAfter.includes('unknown-track.mp3'));
        assert.ok(!dropFilesAfter.includes('doon1.mp3'));

        const quarantineFiles = await readdir(path.join(dropDir, '_quarantine'));
        assert.ok(quarantineFiles.includes('unknown-track.mp3'));
        assert.ok(quarantineFiles.includes('manifest.json'));

        const manifest = JSON.parse(await readFile(path.join(dropDir, '_quarantine', 'manifest.json'), 'utf8'));
        assert.equal(manifest.length, 1);
        assert.equal(manifest[0].file, 'unknown-track.mp3');

        // 音声実体・音声実体を含むファイルツリーは、テスト用一時ディレクトリ（tmpdir 配下）にのみ存在し、
        // 本リポ配下には一切書き込まれていない
        assert.ok(!libraryRoot.startsWith(repoRoot));
        assert.ok(!catalogDir.startsWith(repoRoot));
    });
});

test('--apply is idempotent: re-running does not duplicate or re-quarantine', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, 'doon1.mp3'), 'dummy-audio-bytes');
        await writeFile(path.join(dropDir, 'unknown-track.mp3'), 'dummy-audio-bytes');

        const first = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', candidatesPath, '--apply',
        ]);
        assert.equal(first.status, 0);

        const second = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', candidatesPath, '--apply',
        ]);
        assert.equal(second.status, 0);
        assert.equal(second.json.total_files_scanned, 0, '2回目はドロップフォルダに新規ファイルが無い');
        assert.equal(second.json.apply_results.catalogWritten.length, 0);
        assert.equal(second.json.apply_results.registered.length, 0);

        const manifest = JSON.parse(await readFile(path.join(dropDir, '_quarantine', 'manifest.json'), 'utf8'));
        assert.equal(manifest.length, 1, 'manifest に重複エントリが増えていない');
    });
});

test('ambiguous match (multiple candidates) is quarantined, not guessed', async () => {
    // decision1〜53 と cancel1〜9 のような別々の filename_patterns が同じ stem に一致することは
    // 現行データでは無いが、将来の候補追加で衝突するケースを想定した回帰テスト用に、
    // 一時的な candidates.json を用意して検証する。
    await withFixture(async ({ dropDir, libraryRoot, catalogDir, root }) => {
        const tempCandidates = path.join(root, 'candidates-ambiguous.json');
        await writeFile(tempCandidates, JSON.stringify({
            categories: [
                {
                    id: 'test',
                    label_ja: 'テスト',
                    items: [
                        {
                            rank: 1, id: 'cand-a', site: 'A', title_ja: 'A', type: 'individual_file',
                            download_page_url: 'https://example.com/a', expected_filenames: ['overlap'], filename_patterns: [],
                            license: { attribution_required: false, ai_training_allowed: false, redistribution: 'unknown', note: '' },
                            confidence: 'confirmed_by_lane', verification: {},
                        },
                        {
                            rank: 2, id: 'cand-b', site: 'B', title_ja: 'B', type: 'individual_file',
                            download_page_url: 'https://example.com/b', expected_filenames: ['overlap'], filename_patterns: [],
                            license: { attribution_required: false, ai_training_allowed: false, redistribution: 'unknown', note: '' },
                            confidence: 'confirmed_by_lane', verification: {},
                        },
                    ],
                },
            ],
        }));
        await writeFile(path.join(dropDir, 'overlap.mp3'), 'dummy');

        const { status, json } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', tempCandidates, '--apply',
        ]);
        assert.equal(status, 0);
        assert.equal(json.matched_candidates.length, 0);
        assert.equal(json.ambiguous_count, 1);
        assert.equal(json.quarantined.length, 1);

        const quarantineFiles = await readdir(path.join(dropDir, '_quarantine'));
        assert.ok(quarantineFiles.includes('overlap.mp3'), '一意に決定できない場合は推測せず隔離する');
    });
});

test('generated library entries pass validate-asset.mjs when ffmpeg preview succeeds or is honestly skipped', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, 'clapping-hands1.mp3'), 'dummy-audio-bytes');

        const { status } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', candidatesPath, '--apply',
        ]);
        assert.equal(status, 0);

        // ffmpeg があれば ffmpeg で preview を作る想定だが、この dummy ファイルは実際の音声データでは
        // ないためデコードに失敗しうる。その場合でも validate-asset.mjs の判定結果をそのまま記録する
        // （実物と違う mock を preview として作らない、という既存ハードルールを壊さない）。
        const result = spawnSync(process.execPath, [validateAssetScript, path.join(libraryRoot, 'soundeffect-lab-clapping-hands')], { encoding: 'utf8' });
        if (result.status !== 0) {
            assert.match(result.stderr, /preview\.png/, 'ffmpeg 未生成時は理由が preview.png 不足として明示される');
        }
    });
});

test('song titles uniquely match normalized drop filenames and record provenance', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, '223 AM.mp3'), 'dummy-audio-bytes');
        await writeFile(path.join(dropDir, 'morning.wav'), 'dummy-audio-bytes');

        const { status, json } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', candidatesPath, '--apply',
        ]);

        assert.equal(status, 0);
        assert.deepEqual(
            json.matched_candidates.map(({ candidate_id: candidateId }) => candidateId).sort(),
            ['dova-syndrome-ranking-calm', 'dova-syndrome-ranking-uplift'],
        );

        for (const candidateId of ['dova-syndrome-ranking-calm', 'dova-syndrome-ranking-uplift']) {
            const libraryMeta = JSON.parse(await readFile(path.join(libraryRoot, candidateId, 'meta.json'), 'utf8'));
            const catalogMeta = JSON.parse(await readFile(path.join(catalogDir, candidateId, 'meta.json'), 'utf8'));
            assert.equal(libraryMeta.matched_by, 'title-normalized');
            assert.equal(catalogMeta.matched_by, 'title-normalized');
        }
    });
});

test('ambiguous normalized song titles are quarantined, not guessed', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir, root }) => {
        const tempCandidates = path.join(root, 'candidates-title-ambiguous.json');
        await writeFile(tempCandidates, JSON.stringify({
            categories: [{
                id: 'test',
                label_ja: 'テスト',
                items: [
                    songCandidate({ rank: 1, id: 'title-a', title: 'Night-Time' }),
                    songCandidate({ rank: 2, id: 'title-b', title: 'night time!' }),
                ],
            }],
        }));
        await writeFile(path.join(dropDir, 'NIGHT_TIME.mp3'), 'dummy');

        const { status, json } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', tempCandidates, '--apply',
        ]);

        assert.equal(status, 0);
        assert.equal(json.matched_candidates.length, 0);
        assert.equal(json.ambiguous_count, 1);
        assert.equal(json.quarantined.length, 1);
        assert.ok((await readdir(path.join(dropDir, '_quarantine'))).includes('NIGHT_TIME.mp3'));
    });
});

test('partial normalized song title matches are quarantined', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir, root }) => {
        const tempCandidates = path.join(root, 'candidates-title-partial.json');
        await writeFile(tempCandidates, JSON.stringify({
            categories: [{
                id: 'test',
                label_ja: 'テスト',
                items: [songCandidate({ rank: 1, id: 'morning-glow', title: 'Morning Glow' })],
            }],
        }));
        await writeFile(path.join(dropDir, 'morning.mp3'), 'dummy');

        const { status, json } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', tempCandidates, '--apply',
        ]);

        assert.equal(status, 0);
        assert.equal(json.matched_candidates.length, 0);
        assert.equal(json.ambiguous_count, 0);
        assert.equal(json.quarantined.length, 1);
        assert.ok((await readdir(path.join(dropDir, '_quarantine'))).includes('morning.mp3'));
    });
});

test('expected_filenames matches retain the existing meta shape', async () => {
    await withFixture(async ({ dropDir, libraryRoot, catalogDir }) => {
        await writeFile(path.join(dropDir, 'doon1.mp3'), 'dummy-audio-bytes');

        const { status } = runScript([
            '--drop-dir', dropDir, '--library-root', libraryRoot, '--catalog-dir', catalogDir,
            '--candidates', candidatesPath, '--apply',
        ]);

        assert.equal(status, 0);
        const libraryMeta = JSON.parse(await readFile(path.join(libraryRoot, 'soundeffect-lab-doon1', 'meta.json'), 'utf8'));
        assert.equal(hasOwn(libraryMeta, 'matched_by'), false);
    });
});

function songCandidate({ rank, id, title }) {
    return {
        rank,
        id,
        site: 'Test Site',
        title_ja: id,
        type: 'song_pack',
        download_page_url: `https://example.com/${id}`,
        expected_filenames: [],
        filename_patterns: [],
        songs: [{ title_ja: title, expected_filenames: [] }],
        license: { attribution_required: false, ai_training_allowed: false, redistribution: 'unknown', note: '' },
        confidence: 'confirmed_by_lane',
        verification: {},
    };
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}
