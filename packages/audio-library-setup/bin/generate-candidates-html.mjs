#!/usr/bin/env node
// catalog/audio/candidates.json + 現在の catalog/audio/*/meta.json から、
// カテゴリ別・「ダウンロードページを開く」ボタン付きの静的 HTML を生成する。
//
// ハードルール（skills/setup-audio-library/SKILL.md と同一）:
// - このスクリプトは一切のダウンロードを実行しない。リンクはダウンロードページ URL を
//   新規タブで開くだけで、音声ファイルへの直リンクは張らない。
// - 出力は完全に自己完結した静的 HTML（外部 CDN 依存ゼロ）。file:// 直開きでも動作する。
//
// Usage: node bin/generate-candidates-html.mjs [--candidates path] [--catalog-dir path] [--out path]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCandidates, flattenCandidates, scanCatalogAudio, computeOwnership, countUnits } from '../shared/candidates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function parseArguments(argv) {
    const options = {
        candidates: path.join(repoRoot, 'catalog', 'audio', 'candidates.json'),
        catalogDir: path.join(repoRoot, 'catalog', 'audio'),
        out: path.join(repoRoot, 'catalog', 'audio', 'candidates.html'),
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--candidates') { options.candidates = path.resolve(argv[++i]); continue; }
        if (arg === '--catalog-dir') { options.catalogDir = path.resolve(argv[++i]); continue; }
        if (arg === '--out') { options.out = path.resolve(argv[++i]); continue; }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function badge(text, kind) {
    return `<span class="badge badge-${kind}">${escapeHtml(text)}</span>`;
}

function licenseBadges(item) {
    const parts = [];
    const attr = item.license?.attribution_required;
    if (attr === true) parts.push(badge('要クレジット', 'warn'));
    else if (attr === false) parts.push(badge('クレジット不要', 'ok'));
    else parts.push(badge('クレジット要否: 個別確認', 'unknown'));

    const ai = item.license?.ai_training_allowed;
    if (ai === true) parts.push(badge('AI学習可', 'ok'));
    else if (ai === false) parts.push(badge('AI学習禁止', 'danger'));
    else parts.push(badge('AI学習可否: 不明', 'unknown'));

    return parts.join(' ');
}

function confidenceBadge(item) {
    const map = {
        confirmed_by_lane: ['本レーンで実在確認済み', 'ok'],
        corrected_by_lane: ['本レーンで内容を修正済み', 'warn'],
        confirmed_by_research: ['リサーチ時点で確認済み', 'ok'],
        blocked_unverifiable: ['自動検証不能・要手動確認', 'danger'],
    };
    const [text, kind] = map[item.confidence] ?? [item.confidence, 'unknown'];
    return badge(text, kind);
}

function ownershipBadge(ownership) {
    if (ownership.status === 'exact') {
        return badge(`既所有（catalog: ${ownership.matchedIds.join(', ')}）`, 'owned');
    }
    if (ownership.status === 'site') {
        return badge(`同配布元から登録あり（catalog: ${ownership.matchedIds.join(', ')}）`, 'partial');
    }
    return '';
}

function moodBadges(item) {
    const mood = item.mood ?? [];
    const tempo = item.tempo ?? null;
    if (mood.length === 0 && !tempo) return '';
    const moodBadgesHtml = mood.map((m) => badge(m, 'mood')).join(' ');
    const tempoBadge = tempo ? badge(`テンポ: ${tempo}`, 'tempo') : '';
    return `<div class="mood-row">${moodBadgesHtml} ${tempoBadge}</div>`;
}

function renderSongs(item) {
    const songs = item.songs ?? [];
    if (songs.length === 0) return '';
    const rows = songs
        .map((song) => {
            const songMood = (song.mood ?? []).map((m) => badge(m, 'mood')).join(' ');
            const songTempo = song.tempo ? badge(`テンポ: ${song.tempo}`, 'tempo') : '';
            return `<li>${escapeHtml(song.title_ja)} ${songMood} ${songTempo}</li>`;
        })
        .join('\n');
    return `
        <details class="songs">
          <summary>収録曲 ${songs.length} 件</summary>
          <ul class="song-list">${rows}</ul>
        </details>`;
}

function renderItem(item, ownership) {
    const isOwned = ownership.status === 'exact';
    const rowClass = isOwned ? 'candidate owned' : 'candidate';
    return `
      <li class="${rowClass}">
        <div class="candidate-head">
          <span class="rank">#${item.rank}</span>
          <span class="site">${escapeHtml(item.site)}</span>
          <span class="title">${escapeHtml(item.title_ja)}</span>
          ${ownershipBadge(ownership)}
        </div>
        <div class="candidate-meta">
          ${confidenceBadge(item)}
          ${licenseBadges(item)}
        </div>
        ${moodBadges(item)}
        ${item.license?.note ? `<p class="note">${escapeHtml(item.license.note)}</p>` : ''}
        ${item.credit_template ? `<p class="note credit-note">クレジット表記: ${escapeHtml(item.credit_template)}</p>` : ''}
        ${item.verification?.result_note ? `<p class="note verify-note">検証メモ: ${escapeHtml(item.verification.result_note)}</p>` : ''}
        ${renderSongs(item)}
        <a class="open-button" href="${escapeHtml(item.download_page_url)}" target="_blank" rel="noopener noreferrer">
          ダウンロードページを開く ↗
        </a>
      </li>`;
}

function renderCategory(category, ownershipMap) {
    const items = category.items
        .map((item) => renderItem(item, ownershipMap.get(item.id) ?? { status: 'none', matchedIds: [] }))
        .join('\n');
    return `
    <section class="category">
      <h2>${escapeHtml(category.label_ja)}</h2>
      <ul class="candidate-list">
        ${items}
      </ul>
    </section>`;
}

function renderPage({ data, flat, ownershipMap, generatedAt }) {
    const ownedCount = flat.filter((item) => ownershipMap.get(item.id)?.status === 'exact').length;
    const totalUnits = flat.reduce((sum, item) => sum + countUnits(item), 0);
    const categorySections = data.categories.map((category) => renderCategory(category, ownershipMap)).join('\n');

    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>音源セットアップ候補リスト（AKARI Video）</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; line-height: 1.6; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
  .hard-rule { background: #fff3cd; color: #664d03; border: 1px solid #ffe69c; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
  @media (prefers-color-scheme: dark) { .hard-rule { background: #4d3b00; color: #ffe69c; border-color: #6b5300; } }
  .summary { font-size: 0.9rem; opacity: 0.8; }
  .candidate-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .candidate { border: 1px solid #8883; border-radius: 10px; padding: 12px 16px; }
  .candidate.owned { opacity: 0.55; }
  .candidate-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .rank { font-variant-numeric: tabular-nums; opacity: 0.6; font-size: 0.85rem; }
  .site { font-weight: 600; }
  .title { flex: 1; }
  .candidate-meta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  .note { font-size: 0.85rem; opacity: 0.75; margin: 6px 0 0; }
  .verify-note { font-style: italic; }
  .credit-note { font-family: ui-monospace, monospace; }
  .mood-row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  .songs { margin-top: 8px; font-size: 0.85rem; }
  .songs summary { cursor: pointer; opacity: 0.75; }
  .song-list { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 4px; }
  .song-list li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .badge { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; }
  .badge-ok { background: #d1e7dd; color: #0a3622; }
  .badge-warn { background: #fff3cd; color: #664d03; }
  .badge-danger { background: #f8d7da; color: #58151c; }
  .badge-unknown { background: #e2e3e5; color: #41464b; }
  .badge-owned { background: #cfe2ff; color: #052c65; }
  .badge-partial { background: #e0cffc; color: #3d0a6b; }
  .badge-mood { background: #ede9fe; color: #4c1d95; }
  .badge-tempo { background: #dbeafe; color: #1e3a8a; }
  @media (prefers-color-scheme: dark) {
    .badge-ok { background: #0f3324; color: #a3cfbb; }
    .badge-warn { background: #4d3b00; color: #ffe69c; }
    .badge-danger { background: #4c0d13; color: #f1aeb5; }
    .badge-unknown { background: #343a3f; color: #c8ccd0; }
    .badge-owned { background: #072045; color: #9ec5fe; }
    .badge-partial { background: #2b0a4d; color: #d0b3fa; }
    .badge-mood { background: #2e1065; color: #ddd6fe; }
    .badge-tempo { background: #172554; color: #bfdbfe; }
  }
  .open-button { display: inline-block; margin-top: 10px; padding: 6px 14px; border-radius: 8px; background: #0d6efd; color: white; text-decoration: none; font-size: 0.9rem; }
  .open-button:hover { background: #0b5ed7; }
  footer { margin-top: 3rem; font-size: 0.8rem; opacity: 0.6; }
</style>
</head>
<body>
  <h1>音源セットアップ候補リスト（BGM・SFX）</h1>
  <div class="hard-rule">
    <strong>AI はここから自動ダウンロードしません。</strong>
    「ダウンロードページを開く」を押すと配布元の正規ページが新規タブで開きます。実際の保存はあなた自身が行ってください。
    保存後はドロップフォルダへ置くと、次回のセットアップ実行時に自動で照合・登録されます。
  </div>
  <p class="summary">
    生成日時: ${escapeHtml(generatedAt)} ／ 候補カード ${flat.length} 件（${data.categories.length} カテゴリ、うち収録曲換算 ${totalUnits} 件）／
    既所有（catalog 登録済み）: ${ownedCount} 件
  </p>
  ${categorySections}
  <footer>
    データソース: catalog/audio/candidates.json（内部リサーチ根拠: research/2026-07-22-free-sfx-bgm-sources.md）。
    「既所有」判定は実行時点の catalog/audio/*/meta.json を動的に読んで計算しています（他レーンの登録が増えたら再生成してください）。
  </footer>
</body>
</html>
`;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const data = await loadCandidates(options.candidates);
    const flat = flattenCandidates(data);
    const catalogEntries = await scanCatalogAudio(options.catalogDir);
    const ownershipMap = computeOwnership(flat, catalogEntries);

    const html = renderPage({ data, flat, ownershipMap, generatedAt: new Date().toISOString() });

    await mkdir(path.dirname(options.out), { recursive: true });
    await writeFile(options.out, html, 'utf8');

    const ownedCount = flat.filter((item) => ownershipMap.get(item.id)?.status === 'exact').length;
    const siteCount = flat.filter((item) => ownershipMap.get(item.id)?.status === 'site').length;
    console.log(`Wrote ${options.out}`);
    console.log(`candidates: ${flat.length}, exact-owned: ${ownedCount}, site-partial: ${siteCount}`);
}

main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
});
