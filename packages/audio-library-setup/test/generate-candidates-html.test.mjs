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

test('generates a self-contained static HTML with all 68 candidate cards and no auto-download links to raw audio', async () => {
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

        assert.match(html, /候補カード 68 件/);
        assert.match(html, /AI はここから自動ダウンロードしません/);

        // リンクは必ずダウンロードページ URL。音声ファイル拡張子への直リンクを禁止する。
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        assert.ok(hrefs.length >= 68);
        for (const href of hrefs) {
            assert.doesNotMatch(href, /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i, `直リンク疑い: ${href}`);
        }
    });
});

test('BGM is split into bgm-calm/bgm-uplift/bgm-other with ~100 songs total, mood tags aligned to intake tone vocabulary (>=2 each), MusMus represented', async () => {
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
        const bgmCategoryIds = ['bgm-calm', 'bgm-uplift', 'bgm-other'];
        const bgmCategories = bgmCategoryIds.map((id) => {
            const category = data.categories.find((c) => c.id === id);
            assert.ok(category, `カテゴリ ${id} が存在すること`);
            return category;
        });

        const unitsPerCategory = new Map();
        let totalUnits = 0;
        for (const category of bgmCategories) {
            const units = category.items.reduce((sum, item) => sum + (item.songs?.length ?? 1), 0);
            unitsPerCategory.set(category.id, units);
            totalUnits += units;
        }
        assert.ok(totalUnits >= 90 && totalUnits <= 130, `BGM合計は約100曲相当を想定: 実際は${totalUnits}`);

        // 落ち着き系6割・盛り上げ系3割・その他1割の構成比目安（±15ポイントの余裕を許容）
        const calmRatio = unitsPerCategory.get('bgm-calm') / totalUnits;
        const upliftRatio = unitsPerCategory.get('bgm-uplift') / totalUnits;
        assert.ok(calmRatio >= 0.45, `落ち着き系の比率が低すぎる: ${calmRatio}`);
        assert.ok(upliftRatio >= 0.15 && upliftRatio <= 0.45, `盛り上げ系の比率が目安から外れている: ${upliftRatio}`);

        const toneVocabulary = data.mood_vocabulary.values;
        assert.deepEqual(toneVocabulary, ['真面目', '親しみ', '高級感', '勢い', 'かわいい', '無機質', 'エモい', 'シネマ']);

        const coverage = new Map(toneVocabulary.map((tone) => [tone, 0]));
        for (const category of bgmCategories) {
            for (const item of category.items) {
                for (const mood of item.mood ?? []) {
                    assert.ok(coverage.has(mood), `mood_vocabulary に無い値: ${mood} (item: ${item.id})`);
                    coverage.set(mood, coverage.get(mood) + 1);
                }
                for (const song of item.songs ?? []) {
                    for (const mood of song.mood ?? []) {
                        assert.ok(coverage.has(mood), `mood_vocabulary に無い値: ${mood} (song in item: ${item.id})`);
                        coverage.set(mood, coverage.get(mood) + 1);
                    }
                }
            }
        }
        for (const [tone, count] of coverage) {
            assert.ok(count >= 2, `mood "${tone}" の候補が2件未満: ${count}件`);
        }

        const allBgmItems = bgmCategories.flatMap((c) => c.items);
        assert.ok(allBgmItems.some((item) => item.site === 'MusMus'), 'MusMus が BGM 候補に含まれていること');

        const html = await readFile(outPath, 'utf8');
        assert.match(html, /badge-mood/);
        assert.match(html, /BGM:MusMus/); // credit_template がそのまま表示される
        assert.match(html, /収録曲/); // songs[] の展開表示
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
