import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scriptPath = path.join(here, '..', 'bin', 'generate-candidates-html.mjs');
const candidatesPath = path.join(repoRoot, 'catalog', 'audio', 'candidates.json');
const realCatalogAudioDir = path.join(repoRoot, 'catalog', 'audio');

async function withTempOut(run) {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-audio-candidates-'));
    try {
        await run(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('generates a self-contained static HTML with all 60 candidates and no auto-download links to raw audio', async () => {
    await withTempOut(async (root) => {
        const outPath = path.join(root, 'candidates.html');
        const result = spawnSync(process.execPath, [
            scriptPath,
            '--candidates', candidatesPath,
            '--catalog-dir', realCatalogAudioDir,
            '--out', outPath,
        ], { encoding: 'utf8' });

        assert.equal(result.status, 0, result.stderr);
        const html = await readFile(outPath, 'utf8');

        assert.match(html, /候補 60 件/);
        assert.match(html, /AI はここから自動ダウンロードしません/);

        // リンクは必ずダウンロードページ URL。音声ファイル拡張子への直リンクを禁止する。
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        assert.ok(hrefs.length >= 60);
        for (const href of hrefs) {
            assert.doesNotMatch(href, /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i, `直リンク疑い: ${href}`);
        }
    });
});

test('BGM candidates carry mood tags aligned to the intake tone vocabulary, each mood has >=2 candidates, MusMus is represented', async () => {
    await withTempOut(async (root) => {
        const outPath = path.join(root, 'candidates.html');
        const result = spawnSync(process.execPath, [
            scriptPath,
            '--candidates', candidatesPath,
            '--catalog-dir', realCatalogAudioDir,
            '--out', outPath,
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);

        const raw = await readFile(candidatesPath, 'utf8');
        const data = JSON.parse(raw);
        const bgm = data.categories.find((c) => c.id === 'bgm-general');
        assert.ok(bgm.items.length >= 15 && bgm.items.length <= 20, `BGM候補は15〜20件を想定: 実際は${bgm.items.length}件`);

        const toneVocabulary = data.mood_vocabulary.values;
        assert.deepEqual(toneVocabulary, ['真面目', '親しみ', '高級感', '勢い', 'かわいい', '無機質', 'エモい', 'シネマ']);

        const coverage = new Map(toneVocabulary.map((tone) => [tone, 0]));
        for (const item of bgm.items) {
            for (const mood of item.mood ?? []) {
                assert.ok(coverage.has(mood), `mood_vocabulary に無い値: ${mood} (item: ${item.id})`);
                coverage.set(mood, coverage.get(mood) + 1);
            }
        }
        for (const [tone, count] of coverage) {
            assert.ok(count >= 2, `mood "${tone}" の候補が2件未満: ${count}件`);
        }

        assert.ok(bgm.items.some((item) => item.site === 'MusMus'), 'MusMus が BGM 候補に含まれていること');

        const html = await readFile(outPath, 'utf8');
        assert.match(html, /badge-mood/);
        assert.match(html, /BGM:MusMus/); // credit_template がそのまま表示される
    });
});

test('marks catalog-owned entries and reflects them dynamically (no hardcoded id list)', async () => {
    await withTempOut(async (root) => {
        // 既存 catalog/audio の1エントリと URL が完全一致する候補を作った上で、
        // 「既所有」判定が動的に catalog を読んで行われることを確認する
        // (audio-import 等の別レーンの登録が増えても再実行で反映される設計の裏取り)。
        const scratchCatalogDir = path.join(root, 'catalog-audio');
        await mkdir(path.join(scratchCatalogDir, 'exact-owned-entry'), { recursive: true });
        await writeFile(
            path.join(scratchCatalogDir, 'exact-owned-entry', 'meta.json'),
            // rank #1 のみが使う一意な URL（OtoLogic の個別ページ）。rank #21 は同じホスト
            // （otologic.jp）だが異なるページ URL のため、これは "site" 扱いになるはず。
            JSON.stringify({ source: { url: 'https://otologic.jp/free/se/motion-swish01.html' } }),
        );

        const outPath = path.join(root, 'candidates.html');
        const result = spawnSync(process.execPath, [
            scriptPath,
            '--candidates', candidatesPath,
            '--catalog-dir', scratchCatalogDir,
            '--out', outPath,
        ], { encoding: 'utf8' });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /exact-owned: 1/);

        const html = await readFile(outPath, 'utf8');
        assert.match(html, /既所有（catalog: exact-owned-entry）/);
    });
});
