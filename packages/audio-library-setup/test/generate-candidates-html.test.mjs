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
const legacyCandidatesPath = path.join(repoRoot, 'catalog', 'audio', 'candidates-legacy.json');
const realCatalogAudioDir = path.join(repoRoot, 'catalog', 'audio');

async function withTempOut(run) {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-audio-candidates-'));
    try {
        await run(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('generates a self-contained static HTML with the 13 v2 candidate cards, the AKARI Sounds first-party banner, and no auto-download links to raw audio', async () => {
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

        assert.match(html, /候補カード 13 件/);
        assert.match(html, /既定ソース: AKARI Sounds/);
        assert.match(html, /fetch-akari-sounds\.mjs/);
        assert.match(html, /AI はここから自動ダウンロードしません/);

        // 外部候補のリンクは必ずダウンロードページ URL。音声ファイル拡張子への直リンクを禁止する。
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        assert.ok(hrefs.length >= 13);
        for (const href of hrefs) {
            assert.doesNotMatch(href, /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i, `直リンク疑い: ${href}`);
        }
    });
});

test('v2 contract: BGM cards are fully unified into first-party AKARI Sounds, kept SFX categories are the AKARI Sounds gaps, legacy JSON preserves all 68 v1 cards', async () => {
    const v2 = JSON.parse(await readFile(candidatesPath, 'utf8'));

    // first_party が既定ソースとして宣言されている（2026-08-03 オーナー裁定）
    assert.equal(v2.first_party.id, 'akari-sounds');
    assert.equal(v2.first_party.role, 'default_source');
    assert.equal(v2.first_party.repo, 'AkariLabs/akari-sounds');
    assert.ok(v2.first_party.kinds.bgm >= 90, 'BGM は AKARI Sounds 側で 90 トラック以上ある想定');

    // BGM の外部カテゴリは v2 に存在しない（BGM は全量 AKARI Sounds）
    const v2Ids = v2.categories.map((c) => c.id);
    for (const id of v2Ids) {
        assert.doesNotMatch(id, /^bgm-/, `BGM カテゴリが v2 に残っている: ${id}`);
    }

    // 残す外部 SFX カテゴリは「AKARI Sounds に無い系統」だけ
    assert.deepEqual([...v2Ids].sort(), ['applause', 'fail-buzzer', 'impact-hit']);
    const totalCards = v2.categories.reduce((n, c) => n + c.items.length, 0);
    assert.equal(totalCards, 13);

    // レガシー JSON は v1 の全 68 カードを原文のまま保持している（不変・参照用）
    const legacy = JSON.parse(await readFile(legacyCandidatesPath, 'utf8'));
    const legacyCards = legacy.categories.reduce((n, c) => n + c.items.length, 0);
    assert.equal(legacyCards, 68);

    // v1 時点の BGM 構成（約100曲・落ち着き6割）はレガシー側にそのまま残る
    const legacyBgm = ['bgm-calm', 'bgm-uplift', 'bgm-other'].map((id) => {
        const category = legacy.categories.find((c) => c.id === id);
        assert.ok(category, `レガシーにカテゴリ ${id} が残っていること`);
        return category;
    });
    const units = legacyBgm.map((c) => c.items.reduce((sum, item) => sum + (item.songs?.length ?? 1), 0));
    const totalUnits = units.reduce((a, b) => a + b, 0);
    assert.ok(totalUnits >= 90 && totalUnits <= 120, `レガシー BGM は約100曲相当: 実際は${totalUnits}`);
    assert.deepEqual(legacy.mood_vocabulary.values, ['真面目', '親しみ', '高級感', '勢い', 'かわいい', '無機質', 'エモい', 'シネマ']);
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
            // rank #27（拍手）のみが使う一意な URL。他の効果音ラボ候補（doon1 / battle / people 等）は
            // 同じホストだが異なるページ URL のため、それらは "site" 扱いになるはず。
            JSON.stringify({ source: { url: 'https://soundeffect-lab.info/sound/various/various3.html' } }),
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
