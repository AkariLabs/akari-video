#!/usr/bin/env node
// BGM 自動提案 CLI — intake / 演出の tone から AKARI Sounds の BGM 候補を決定論で並べる。
//
// 読み先は first-party 一括取得（fetch-akari-sounds.mjs）が書いた取得時点スナップショット
// `<ライブラリ>/akari-sounds-bgm/.origin-catalog.json`。ネットワークには一切触れない
// （未導入なら `akari sounds` を案内して exit 1）。
//
// これは**候補の提示まで**。採用の決定は edit-plan の Checkpoint 2（素材計画）の
// 承認ゲートで人間が行う（skills/edit-plan/report-guide.md §素材計画）。
//
// Usage: node bin/suggest-bgm.mjs (--from-decision-log <path> | --tone <値>) [options]
//   --from-decision-log <path> decision-log.md の最新の (direction, tone) 行から tone / tempo を読む
//   --tone <値>      表現選定と同じ 8 語彙（真面目/親しみ/高級感/勢い/かわいい/無機質/エモい/シネマ）。
//                    複数指定可（重みを合算）。decision-log より優先
//   --tempo <値>     ゆったり | 標準 | 高速（任意。decision-log より優先）
//   --count <N>      提示件数（既定 5）
//   --catalog <path> catalog.json をローカルファイルから読む（検証用の上書き）
//   --declarations <path>  耳検証済み宣言データ（{id: {bpm, sections[], hit_points[] …}} の JSON）。
//                    解決順: --declarations → 環境変数 AKARI_SOUNDS_DECLARATIONS →
//                    既定パス <ライブラリ>/declarations.json（宣言パック購入者の導入先 —
//                    zip 内の declarations.json をそこへ置くだけで自動検出される）。
//                    あるトラックは実測 BPM 置換 + ランキング優先 + サビ頭出し（audio.bgm.in の
//                    推奨値）が提案に付く
//   --json           機械可読 JSON で出力（エージェント向け）

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  suggestBgm,
  TEMPO_VOCABULARY,
  TONE_VOCABULARY,
} from '../shared/bgm-suggest.mjs';
import { readToneDecision } from '../shared/decision-log.mjs';

const BGM_PACK_ID = 'akari-sounds-bgm';

function resolveLibraryRoot(env = process.env) {
  return path.join(env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'assets', 'audio');
}

function parseArguments(argv, env = process.env) {
  const options = { tones: [], tempo: null, decisionLog: null, count: 5, catalog: null, declarations: env.AKARI_SOUNDS_DECLARATIONS || null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from-decision-log') { options.decisionLog = path.resolve(argv[++i]); continue; }
    if (arg === '--tone') { options.tones.push(argv[++i]); continue; }
    if (arg === '--tempo') { options.tempo = argv[++i]; continue; }
    if (arg === '--count') { options.count = Number(argv[++i]); continue; }
    if (arg === '--catalog') { options.catalog = path.resolve(argv[++i]); continue; }
    if (arg === '--declarations') { options.declarations = argv[++i]; continue; }
    if (arg === '--json') { options.json = true; continue; }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error('--count は 1 以上の整数で指定してください');
  }
  return options;
}

async function loadDeclarations(options, libraryRoot) {
  let resolved = options.declarations ? path.resolve(options.declarations) : null;
  if (!resolved) {
    // 宣言パック購入者の既定導入先（zip 内の declarations.json をここへ置くだけ）
    const defaultPath = path.join(libraryRoot, 'declarations.json');
    if (existsSync(defaultPath)) {
      resolved = defaultPath;
    }
  }
  if (!resolved) {
    return { declarations: null, declarationsSource: null };
  }
  try {
    return { declarations: JSON.parse(await readFile(resolved, 'utf8')), declarationsSource: resolved };
  } catch (error) {
    throw new Error(`宣言データを読めません: ${resolved}（${error.message}）`);
  }
}

async function loadCatalog(options, libraryRoot) {
  if (options.catalog) {
    return { catalog: JSON.parse(await readFile(options.catalog, 'utf8')), source: options.catalog };
  }
  const snapshotPath = path.join(libraryRoot, BGM_PACK_ID, '.origin-catalog.json');
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `AKARI Sounds が未導入です（${snapshotPath} が見つかりません）。\n` +
      '先に `akari sounds` で公式音源ライブラリを一括ダウンロードしてください。',
    );
  }
  return { catalog: JSON.parse(await readFile(snapshotPath, 'utf8')), source: snapshotPath };
}

/** 提案行に、edit.json の audio.bgm.path へそのまま書けるローカル実体パスを添える。 */
function attachLocalPaths(suggestion, libraryRoot) {
  const takes = suggestion.takes.map((take) => {
    const localPath = take.mp3 ? path.join(libraryRoot, BGM_PACK_ID, take.mp3) : null;
    return { ...take, path: localPath, exists: localPath ? existsSync(localPath) : false };
  });
  return { ...suggestion, takes };
}

function formatHuman(result, { tones, tempo, source, declarationsSource }) {
  const lines = [];
  lines.push(`BGM 候補（tone: ${tones.join('・')}${tempo ? ` / tempo: ${tempo}` : ''} / 出典: ${source}${declarationsSource ? ' + 宣言データ' : ''}）`);
  if (result.suggestions.length === 0) {
    lines.push('該当なし — tone の組み合わせを変えるか、tempo 指定を外してください。');
  }
  result.suggestions.forEach((s, index) => {
    const toneNote = Object.entries(s.matchedTones).map(([tone, w]) => `${tone}${w === 2 ? '◎' : '○'}`).join(' ');
    lines.push(`${index + 1}. ${s.id} — ${s.title}`);
    lines.push(`   系統: ${s.family} / ${s.declaration ? '実測BPM' : '体感BPM'}: ${s.bpm ?? '不明'}（${s.tempoClass ?? '—'}） / 一致: ${toneNote} / スコア: ${s.score}${s.declaredScore ? '（耳検証済み +' + s.declaredScore + '）' : ''}`);
    if (s.declaration) {
      const d = s.declaration;
      const secText = d.sections.map((x) => `${x.label} ${x.start_sec}-${x.end_sec}`).join(' / ');
      lines.push(`   宣言: ${d.drop_in_sec !== null ? `サビ頭 ${d.drop_in_sec}s（audio.bgm.in に指定でサビから敷ける）` : 'サビ宣言なし'}${d.hit_points.length ? ` / キメ ${d.hit_points.length} 点` : ''}`);
      if (secText) lines.push(`   構成: ${secText}`);
    }
    for (const take of s.takes) {
      lines.push(`   ${take.exists ? 'path' : '未取得'}: ${take.path ?? '(mp3 情報なし)'}${take.duration_sec ? `（${take.duration_sec}s）` : ''}`);
    }
  });
  if (result.unmappedIds.length > 0) {
    lines.push(`注記: 対応表に無い系統のトラック ${result.unmappedIds.length} 件を候補から除外しました（${result.unmappedIds.slice(0, 5).join(', ')}${result.unmappedIds.length > 5 ? ' …' : ''}）。shared/bgm-suggest.mjs の FAMILY_TONE_RULES に行を足してください。`);
  }
  lines.push('採用の決定は素材計画（Checkpoint 2）の承認で行ってください（これは候補の提示まで）。');
  return lines.join('\n');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const libraryRoot = resolveLibraryRoot();
  const decision = options.decisionLog ? await readToneDecision(options.decisionLog) : null;
  const tones = options.tones.length > 0 ? options.tones : decision?.tones ?? [];
  const tempo = options.tempo ?? decision?.tempo ?? null;
  const { catalog, source } = await loadCatalog(options, libraryRoot);
  const { declarations, declarationsSource } = await loadDeclarations(options, libraryRoot);

  const result = suggestBgm(catalog, { tones, tempo, count: options.count, declarations });
  const withPaths = {
    ...result,
    suggestions: result.suggestions.map((s) => attachLocalPaths(s, libraryRoot)),
  };

  if (options.json) {
    console.log(JSON.stringify({
      query: { tones, tempo, count: options.count },
      source,
      declarations_source: declarationsSource,
      library_root: libraryRoot,
      tone_vocabulary: TONE_VOCABULARY,
      tempo_vocabulary: TEMPO_VOCABULARY,
      ...withPaths,
    }, null, 2));
    return;
  }
  console.log(formatHuman(withPaths, { tones, tempo, source, declarationsSource }));
}

main().catch((error) => {
  console.error(error.message ?? String(error));
  process.exitCode = 1;
});
