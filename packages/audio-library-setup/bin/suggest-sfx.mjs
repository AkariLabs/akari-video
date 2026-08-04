#!/usr/bin/env node
// SFX / ジングル自動提案 CLI — 「場面の意味」から AKARI Sounds の候補（+ 外部補完の参照）を返す。
//
// suggest-bgm.mjs の姉妹 CLI。読み先は fetch-akari-sounds.mjs が書いた取得時点スナップショット
// （どのパックの .origin-catalog.json も全 kind を含む）。ネットワークには一切触れない。
// これは**候補の提示まで** — 発火タイミングの設計は beat-sync、採用は素材計画の承認で決める。
//
// Usage:
//   node bin/suggest-sfx.mjs --meaning <値> [--count N] [--catalog path] [--json]
//   node bin/suggest-sfx.mjs --list          # 意味の語彙一覧

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MEANING_VOCABULARY, suggestSfx } from '../shared/sfx-suggest.mjs';

const SNAPSHOT_PACKS = ['akari-sounds-sfx', 'akari-sounds-jingle', 'akari-sounds-bgm'];

function resolveLibraryRoot(env = process.env) {
  return path.join(env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'assets', 'audio');
}

function parseArguments(argv) {
  const options = { meaning: null, count: 5, catalog: null, json: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--meaning') { options.meaning = argv[++i]; continue; }
    if (arg === '--count') { options.count = Number(argv[++i]); continue; }
    if (arg === '--catalog') { options.catalog = path.resolve(argv[++i]); continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--list') { options.list = true; continue; }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function loadCatalog(options, libraryRoot) {
  if (options.catalog) {
    return { catalog: JSON.parse(await readFile(options.catalog, 'utf8')), source: options.catalog };
  }
  for (const pack of SNAPSHOT_PACKS) {
    const snapshotPath = path.join(libraryRoot, pack, '.origin-catalog.json');
    if (existsSync(snapshotPath)) {
      return { catalog: JSON.parse(await readFile(snapshotPath, 'utf8')), source: snapshotPath };
    }
  }
  throw new Error(
    'AKARI Sounds が未導入です（.origin-catalog.json が見つかりません）。\n' +
    '先に `akari sounds` で公式音源ライブラリを一括ダウンロードしてください。',
  );
}

function attachPaths(result, libraryRoot) {
  const first = result.first.map((candidate) => {
    if (candidate.absent) {
      return candidate;
    }
    const packDir = path.join(libraryRoot, `akari-sounds-${candidate.kind}`);
    const takes = candidate.takes.map((take) => {
      const localPath = take.mp3 ? path.join(packDir, take.mp3) : null;
      return { ...take, path: localPath, exists: localPath ? existsSync(localPath) : false };
    });
    return { ...candidate, takes };
  });
  const external = result.external.map((entry) => {
    const libraryDir = path.join(libraryRoot, entry.id);
    const owned = existsSync(path.join(libraryDir, 'meta.json'));
    return { ...entry, owned, library_dir: owned ? libraryDir : null };
  });
  return { ...result, first, external };
}

function formatHuman(result) {
  const lines = [`「${result.meaning}」の音候補（優先順）`];
  result.first.forEach((c, index) => {
    if (c.absent) {
      lines.push(`${index + 1}. ${c.id} — カタログに見当たらず（Release 取り下げの可能性。対応表の更新を検討）`);
      return;
    }
    lines.push(`${index + 1}. ${c.id} — ${c.title}（${c.kind}）`);
    for (const take of c.takes) {
      lines.push(`   ${take.exists ? 'path' : '未取得'}: ${take.path}${take.duration_sec ? `（${take.duration_sec}s）` : ''}`);
    }
  });
  if (result.external.length > 0) {
    lines.push('外部補完（AKARI Sounds に無い系統。実体は各自取得 = catalog/audio 参照）:');
    for (const entry of result.external) {
      lines.push(`- ${entry.id} — ${entry.note} ${entry.owned ? `[取得済み: ${entry.library_dir}]` : '[未取得: catalog/audio/' + entry.id + ' か候補リストから]'}`);
    }
  }
  if (result.first.length === 0 && result.external.length === 0) {
    lines.push('候補なし（宣言表の行が空です）');
  }
  lines.push('発火タイミングは beat-sync、採用は素材計画（Checkpoint 2）の承認で決めてください。');
  return lines.join('\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.list) {
    console.log(MEANING_VOCABULARY.join('\n'));
    return;
  }
  if (!options.meaning) {
    throw new Error(`--meaning を指定してください（一覧は --list。使える値: ${MEANING_VOCABULARY.join(' / ')}）`);
  }
  const libraryRoot = resolveLibraryRoot();
  const { catalog, source } = await loadCatalog(options, libraryRoot);
  const result = attachPaths(suggestSfx(catalog, { meaning: options.meaning, count: options.count }), libraryRoot);

  if (options.json) {
    console.log(JSON.stringify({ source, library_root: libraryRoot, meaning_vocabulary: MEANING_VOCABULARY, ...result }, null, 2));
    return;
  }
  console.log(formatHuman(result));
}

main().catch((error) => {
  console.error(error.message ?? String(error));
  process.exitCode = 1;
});
