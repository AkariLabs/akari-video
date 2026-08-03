#!/usr/bin/env node
// 「意味 → 音」対応表（shared/sfx-suggest.mjs の MEANING_RULES）のレビュー面を生成する。
//
// 目的: 対応表が耳で聴いて本当に合っているかを人間が確認できるようにする（2026-08-03
// オーナー要望「その意味があっているかどうかを確認できるようにしたい」）。
// 全 14 の意味それぞれに候補音源の試聴プレイヤーを並べた自己完結 HTML を書き出す。
// ブラウザで開いて聴き、行ごとに 合ってる/違う/保留 + メモを付け、「判定を保存」で
// JSON をダウンロード → それをエージェントに渡せば対応表の改訂に使える。
//
// - 音源はローカルの導入済みライブラリ（file:// 参照）。未取得の候補は正直に「未取得」表示
// - ネットワークには一切触れない・リポには何も書かない（出力先は既定 ~/.akari/reviews/）
//
// Usage: node bin/review-sfx-mapping.mjs [--out <path>] [--catalog <path>]

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MEANING_VOCABULARY, suggestSfx } from '../shared/sfx-suggest.mjs';

function resolveLibraryRoot(env = process.env) {
  return path.join(env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'assets', 'audio');
}

function parseArguments(argv, env = process.env) {
  const options = {
    out: path.join(env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'reviews', 'sfx-mapping.html'),
    catalog: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') { options.out = path.resolve(argv[++i]); continue; }
    if (arg === '--catalog') { options.catalog = path.resolve(argv[++i]); continue; }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderCandidate(candidate, libraryRoot) {
  if (candidate.absent) {
    return `<li class="cand missing"><code>${escapeHtml(candidate.id)}</code> — カタログに見当たらず</li>`;
  }
  const packDir = path.join(libraryRoot, `akari-sounds-${candidate.kind}`);
  const players = candidate.takes.map((take) => {
    if (!take.mp3) return '';
    const localPath = path.join(packDir, take.mp3);
    if (!existsSync(localPath)) {
      return `<span class="missing">未取得: ${escapeHtml(take.mp3)}</span>`;
    }
    return `<audio controls preload="none" src="${escapeHtml(pathToFileURL(localPath).href)}"></audio>` +
      (take.duration_sec ? `<span class="dur">${escapeHtml(String(take.duration_sec))}s</span>` : '');
  }).join(' ');
  return `
    <li class="cand" data-id="${escapeHtml(candidate.id)}">
      <div class="cand-head"><code>${escapeHtml(candidate.id)}</code> ${escapeHtml(candidate.title)}
        <select class="verdict"><option value="">未判定</option><option>合ってる</option><option>違う</option><option>保留</option></select>
      </div>
      <div class="players">${players}</div>
    </li>`;
}

function renderMeaning(result, libraryRoot) {
  const candidates = result.first.map((c) => renderCandidate(c, libraryRoot)).join('\n');
  const externals = result.external.map((e) =>
    `<li class="external">外部補完: <code>${escapeHtml(e.id)}</code> — ${escapeHtml(e.note)}` +
    `${e.owned ? '（取得済み — 試聴はライブラリで）' : '（未取得）'}</li>`).join('\n');
  return `
  <section class="meaning" data-meaning="${escapeHtml(result.meaning)}">
    <h2>${escapeHtml(result.meaning)}</h2>
    <ul>${candidates}${externals}</ul>
    <label class="rownote">この意味へのメモ: <input class="note" placeholder="例: 2 番は弱すぎ・順位入れ替え希望"></label>
  </section>`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const libraryRoot = resolveLibraryRoot();

  let catalog;
  if (options.catalog) {
    catalog = JSON.parse(await readFile(options.catalog, 'utf8'));
  } else {
    const snapshotPath = path.join(libraryRoot, 'akari-sounds-sfx', '.origin-catalog.json');
    if (!existsSync(snapshotPath)) {
      throw new Error('AKARI Sounds が未導入です。先に `akari sounds` を実行してください（または --catalog）');
    }
    catalog = JSON.parse(await readFile(snapshotPath, 'utf8'));
  }

  const sections = MEANING_VOCABULARY
    .map((meaning) => {
      const result = suggestSfx(catalog, { meaning, count: 99 });
      const external = result.external.map((entry) => ({
        ...entry,
        owned: existsSync(path.join(libraryRoot, entry.id, 'meta.json')),
      }));
      return renderMeaning({ ...result, external }, libraryRoot);
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>意味 → 音 対応表レビュー（AKARI Sounds）</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; max-width: 860px; margin: 0 auto; padding: 24px 16px 80px; line-height: 1.6; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1.05rem; border-bottom: 1px solid #8884; padding-bottom: .3rem; margin-top: 2.2rem; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .cand { border: 1px solid #8883; border-radius: 8px; padding: 8px 12px; }
  .cand-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .players { margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  audio { height: 32px; }
  .dur { font-size: .8rem; opacity: .6; }
  .missing { opacity: .6; font-style: italic; }
  .external { font-size: .9rem; opacity: .85; padding: 4px 12px; }
  .rownote { display: block; font-size: .85rem; margin-top: 4px; }
  .rownote input { width: 60%; padding: 4px 8px; }
  #bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1f5eff; color: #fff; padding: 10px 16px; display: flex; gap: 16px; align-items: center; }
  #bar button { background: #fff; color: #1f5eff; border: none; border-radius: 6px; padding: 6px 16px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<h1>意味 → 音 対応表レビュー</h1>
<p>各「意味」の候補（優先順）を聴いて、合っているか判定してください。判定とメモは下の「判定を保存」で JSON になります（それをエージェントに渡すと対応表を改訂できます）。</p>
${sections}
<div id="bar"><span id="progress"></span><button id="export">判定を保存（JSON ダウンロード）</button></div>
<script>
function collect() {
  const out = {};
  document.querySelectorAll('.meaning').forEach((section) => {
    const meaning = section.dataset.meaning;
    const rows = [];
    section.querySelectorAll('.cand[data-id]').forEach((li) => {
      const verdict = li.querySelector('.verdict').value;
      if (verdict) rows.push({ id: li.dataset.id, verdict });
    });
    const note = section.querySelector('.note').value.trim();
    if (rows.length || note) out[meaning] = { candidates: rows, note };
  });
  return out;
}
function refresh() {
  const total = document.querySelectorAll('.cand[data-id]').length;
  const judged = [...document.querySelectorAll('.verdict')].filter((s) => s.value).length;
  document.getElementById('progress').textContent = '判定 ' + judged + ' / ' + total;
}
document.addEventListener('change', refresh);
refresh();
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ reviewed_at: new Date().toISOString(), verdicts: collect() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sfx-mapping-review.json';
  a.click();
};
// 同時再生を防ぐ（1 個再生したら他を止める）
document.addEventListener('play', (e) => {
  document.querySelectorAll('audio').forEach((el) => { if (el !== e.target) el.pause(); });
}, true);
</script>
</body>
</html>
`;

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, html);
  const audioCount = (html.match(/<audio /g) || []).length;
  console.log(`Wrote ${options.out}（意味 ${MEANING_VOCABULARY.length} 行 / 試聴プレイヤー ${audioCount} 個）`);
  console.log(`open '${options.out}' で開いて確認してください`);
}

main().catch((error) => {
  console.error(error.message ?? String(error));
  process.exitCode = 1;
});
