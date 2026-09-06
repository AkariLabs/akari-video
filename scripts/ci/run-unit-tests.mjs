#!/usr/bin/env node
// scripts/ci/run-unit-tests.mjs — ユニットテストのレーン定義 + 実行器（CI とローカルで共用・レーン定義の正本）
//
// 使い方:
//   node scripts/ci/run-unit-tests.mjs --lane pure         # 外部ツール不要・決定論（CI: required）
//   node scripts/ci/run-unit-tests.mjs --lane shell        # apps/shell 本体 + 拡張（CI: L0 ジョブ末尾・required。build:ext 済みが前提）
//   node scripts/ci/run-unit-tests.mjs --lane quarantine   # main で既に赤・修正待ち（CI: 参考 = continue-on-error）
//   node scripts/ci/run-unit-tests.mjs --lane media        # ffmpeg / ffprobe / Chrome が要る（CI: 参考 = continue-on-error）
//   node scripts/ci/run-unit-tests.mjs --list              # 全レーンの中身と、CI に載せていないテストの一覧
//   （root の npm scripts: test:unit / test:shell / test:media / test:quarantine / test:lanes が上の別名）
//
// 方針（2026-09-02 オーナー裁定・CI 整合ノート）:
//   - required に載せるのは「どの環境でも同じ結果になる」テストだけ。環境依存を required にすると常時赤になり、
//     赤が情報でなくなって CI が死ぬ（engine-v2.yml の required / 参考の二分と同じ流儀）
//   - レーンの移動は実測を根拠に行う: quarantine のパッケージが main で緑になったら pure へ、
//     media のテストが「道具が無ければ skip」に直されたら pure へ
//   - 各パッケージの `npm test` をそのまま呼ぶ（テストの定義は各 package.json が正本。ここは束ねて集計するだけ）。
//     package.json に test script が無い置き場（scripts/test・skills/*）だけ node --test を直接叩く
//   - 全エントリを最後まで走らせてから合否を返す（1 本目の赤で止めない）。要約は GITHUB_STEP_SUMMARY にも書く
//
// 実測の根拠（2026-09-02・macOS arm64・Node 26.3.0・ffmpeg / ffprobe なし・Chrome あり・npm install --ignore-scripts）:
//   pure 15 パッケージ + scripts/test + skills 全 pass（tests 1271 / pass 1265 / fail 0 / skipped 6。edit-store 356/356 を含む）/
//   shell 7 か所 全 pass（akari-preview はブラウザ 1 ファイル除外で 509 pass）/
//   quarantine: export-nle 20/21・akari-launcher 317/332 / media: ffmpeg・ffprobe 不在で赤（decision-cards はローカルでは
//   Chrome があるため緑だが、CI Linux では /tmp プロファイルの rmdir ENOTEMPTY で落ち d5f2a7b6 以降 required unit を赤にしていた）

import { spawnSync } from 'node:child_process';
import { appendFileSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// エントリの形:
//   { id, cwd, npm: 'test' }                        → cwd で `npm run --silent <script>`
//   { id, cwd, files: [glob...], exclude: [RegExp] } → cwd で `node --test <展開したファイル>`
const pkg = (name, script = 'test') => ({ id: `packages/${name}`, cwd: `packages/${name}`, npm: script });
const ext = (name) => ({ id: `apps/shell/extensions/${name}`, cwd: `apps/shell/extensions/${name}`, npm: 'test' });

export const LANES = {
  // 外部ツール（ffmpeg / Chrome / Electron / ネイティブモジュール）を一切要さず、どの OS でも同じ結果になるもの。
  pure: {
    title: '外部ツール不要・決定論（CI required）',
    entries: [
      pkg('analysis-report'),
      pkg('asset-resolver'),
      pkg('audio-library-setup'),   // ffprobe が無い環境では 2 件 skip（設計どおり）
      pkg('chat-bridge'),
      pkg('creator-root'),
      pkg('decision-log-report'),
      pkg('edit-lint'),             // ffprobe が無い環境では 6 件 skip（設計どおり）
      pkg('edit-store'),            // test script が build（gen:textstyle-catalog + tsc -b + esbuild）を含む（lib/ は追跡対象・drift させない）
      pkg('intake-form'),
      pkg('matte-rvm'),             // onnxruntime-node の実体が無い環境では 3 件 skip
      pkg('pen-visuals'),           // test script が tsc -b を含む（lib/ は追跡対象・drift させない）
      pkg('project-scaffold'),
      pkg('schemas'),
      pkg('word-book'),           // 依存ゼロ・tmp fixture で作業場を組む（単語帳 v0 コア 2026-09-02）
      { id: 'scripts/test', cwd: '.', files: ['scripts/test/*.test.mjs'] },
      {
        id: 'skills/* (package.json を持たないスキル同梱テスト)',
        cwd: '.',
        files: [
          'skills/*/test/*.test.mjs',
          'skills/*/bin/test/*.test.mjs',
          'skills/*/bin/*.test.mjs',
          'skills/*/bin/*/*.test.mjs'
        ],
        // vision-tracks の組み立て / 道具検査は ffmpeg・swiftc に依存 → media レーン
        exclude: [/vision-tracks-(assembly|check)\.test\.mjs$/]
      }
    ]
  },

  // apps/shell 側。CI の L0 ジョブ（apps/shell で npm ci --no-workspaces --ignore-scripts → build:ext → lint）の末尾で走る。
  // 拡張の test script が `tsc -b && node --test` の形でも、build:ext 済みなら tsc は増分で数秒。
  shell: {
    title: 'apps/shell 本体 + 拡張（CI: L0 ジョブ末尾・required）',
    entries: [
      { id: 'apps/shell/test', cwd: 'apps/shell', files: ['test/*.test.mjs'] },
      ext('akari-annotations'),
      ext('akari-partner'),
      ext('akari-project'),
      ext('akari-shell-strip'),
      ext('akari-surfaces'),
      ext('akari-tabs'),
      ext('akari-theme'),          // webview の styles 再送スケジューラ（2026-09-06 webview-theme-vars で追加）
      ext('akari-transcript'),
      {
        // akari-preview の test script は `tsc -b && node --test test/*.test.mjs`。
        // caption-entry-animation-hit-region.test.mjs だけ実 Chrome（puppeteer-core）を起動するので除外
        // （下の NOT_COVERED を参照）。残り 75 ファイル 509 件はブラウザ不要
        id: 'apps/shell/extensions/akari-preview (ブラウザ 1 ファイル除外)',
        cwd: 'apps/shell/extensions/akari-preview',
        files: ['test/*.test.mjs'],
        exclude: [/caption-entry-animation-hit-region\.test\.mjs$/]
      }
    ]
  },

  // main で既に赤いもの。required に入れると初日から赤で止まるので隔離し、修正タスクで緑になったら pure へ移す。
  // 「なぜ赤か」を必ず横に書く（原因不明のまま隔離に置き続けない）。
  quarantine: {
    title: 'main で既に赤・修正待ち（CI: 参考）',
    entries: [
      // 1 件: migration-regression.test.mjs の v1 fixture（narration: { id, path, t }）を edit-store の migrate が
      // 「path / t / in / out / gain_db / script / reading / provenance が不正」で拒む → migrate の検証強化にテストが未追随
      pkg('export-nle'),
      // 15 件: full-integrity.test.mjs の fixture（audio.sfx[].start 等）を同じ migrate が「未知フィールド」で拒む
      pkg('akari-launcher')
    ]
  },

  // ffmpeg / ffprobe / Chrome（Playwright chromium・puppeteer-core 用 CHROME_PATH）が要るもの。
  // Linux ランナーでも通る保証は無い（symlink 権限・GPU・フォントの差）。緑が安定したら required 化を検討する。
  media: {
    title: 'ffmpeg / ffprobe / Chrome が要る（CI: 参考）',
    entries: [
      pkg('media-bin'),
      pkg('decision-cards'),        // Chrome を起動するテストを含む（direction inputs persist… が /tmp プロファイルの rmdir ENOTEMPTY で落ちる・CI 上は d5f2a7b6 以降 required unit を赤にしていた）
      pkg('akari-tools'),
      pkg('render-cut'),
      pkg('preview-server'),        // Playwright chromium。無ければ一部 skip・一部 fail
      pkg('overlay-runtime'),       // puppeteer-core + CHROME_PATH
      {
        id: 'skills/analyze-footage vision-tracks (ffmpeg・swiftc)',
        cwd: '.',
        files: ['skills/analyze-footage/test/vision-tracks-*.test.mjs']
      }
    ]
  }
};

// どのレーンにも載せていないテストと、その理由（1 対 1 の帳尻をここで明示する）
export const NOT_COVERED = [
  { what: 'packages/frame-engine / osr-export / gpu-export', why: 'engine-v2.yml が Electron 実機付きで走らせている（required 3 レーン + 参考 2 レーン）' },
  {
    what: 'apps/shell/extensions/akari-preview/test/caption-entry-animation-hit-region.test.mjs',
    why: '実 Chrome を要する上、loadPuppeteer が .git を「ファイル」として読むため通常 checkout（.git がディレクトリ）では EISDIR で落ちる。テスト側の修正待ち'
  },
  { what: 'packages/preview-server test:frame-engine-browser（*.l1.mjs）', why: 'L1（実機観測）。CI の対象外' }
];

function parseArgs(argv) {
  const args = { lane: null, list: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--lane') args.lane = argv[++i];
    else if (a.startsWith('--lane=')) args.lane = a.slice('--lane='.length);
    else if (a === '--list') args.list = true;
    else if (a === '--verbose') args.verbose = true;
    else {
      console.error(`未知の引数: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function expandFiles(entry) {
  const cwd = path.join(REPO_ROOT, entry.cwd);
  const files = [...new Set(globSync(entry.files, { cwd }))].sort();
  const excluded = entry.exclude ?? [];
  return files.filter(f => !excluded.some(re => re.test(f)));
}

function commandFor(entry) {
  if (entry.npm) return { cmd: NPM, args: ['run', '--silent', entry.npm], shown: `npm run ${entry.npm}` };
  const files = expandFiles(entry);
  return { cmd: process.execPath, args: ['--test', ...files], shown: `node --test (${files.length} files)`, files };
}

function lastNumber(output, label) {
  // node --test の要約行: spec reporter は「ℹ tests 26」、tap reporter は「# tests 26」
  const re = new RegExp(`^(?:ℹ|#) ${label} (\\d+)`, 'gmu');
  let m; let value = null;
  while ((m = re.exec(output)) !== null) value = Number(m[1]);
  return value;
}

function runEntry(entry, verbose) {
  const { cmd, args, shown } = commandFor(entry);
  const cwd = path.join(REPO_ROOT, entry.cwd);
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const exit = result.status ?? (result.error ? 1 : 1);
  const counts = {
    tests: lastNumber(output, 'tests'),
    pass: lastNumber(output, 'pass'),
    fail: lastNumber(output, 'fail'),
    skipped: lastNumber(output, 'skipped')
  };
  const onCi = Boolean(process.env.GITHUB_ACTIONS);
  const status = exit === 0 ? 'ok' : 'FAIL';
  if (onCi) console.log(`::group::${status} ${entry.id} — ${shown} (${seconds}s)`);
  else console.log(`\n=== ${status} ${entry.id} — ${shown} (${seconds}s) ===`);
  if (exit !== 0 || verbose) {
    process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
    if (result.error) console.log(`spawn error: ${result.error.message}`);
  } else {
    console.log(`tests ${counts.tests ?? '-'} / pass ${counts.pass ?? '-'} / fail ${counts.fail ?? '-'} / skipped ${counts.skipped ?? '-'}`);
  }
  if (onCi) console.log('::endgroup::');
  return { id: entry.id, shown, exit, seconds, ...counts };
}

function summaryTable(lane, rows) {
  const cell = v => (v === null || v === undefined ? '-' : String(v));
  const lines = [
    `### unit lane: ${lane} — ${LANES[lane].title}`,
    '',
    '| 結果 | 対象 | tests | pass | fail | skipped | 秒 |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.exit === 0 ? '✅' : '❌'} | ${r.id} | ${cell(r.tests)} | ${cell(r.pass)} | ${cell(r.fail)} | ${cell(r.skipped)} | ${r.seconds} |`)
  ];
  return `${lines.join('\n')}\n`;
}

function printList(laneFilter) {
  for (const [lane, def] of Object.entries(LANES)) {
    if (laneFilter && lane !== laneFilter) continue;
    console.log(`\n[${lane}] ${def.title}`);
    for (const entry of def.entries) {
      const detail = entry.npm ? `npm run ${entry.npm}` : `node --test ${expandFiles(entry).length} files`;
      console.log(`  - ${entry.id}  (${entry.cwd}: ${detail})`);
    }
  }
  if (!laneFilter) {
    console.log('\n[not covered] どのレーンにも載せていないもの');
    for (const item of NOT_COVERED) console.log(`  - ${item.what}\n      ${item.why}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    printList(args.lane);
    return;
  }
  if (!args.lane || !LANES[args.lane]) {
    console.error(`--lane に ${Object.keys(LANES).join(' | ')} のいずれかを指定してください（--list で中身を表示）`);
    process.exit(2);
  }
  const def = LANES[args.lane];
  console.log(`unit lane: ${args.lane} — ${def.title}（${def.entries.length} entries, node ${process.version}）`);
  const rows = def.entries.map(entry => runEntry(entry, args.verbose));
  const failed = rows.filter(r => r.exit !== 0);
  const table = summaryTable(args.lane, rows);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  const totals = rows.reduce((acc, r) => ({
    tests: acc.tests + (r.tests ?? 0), pass: acc.pass + (r.pass ?? 0), fail: acc.fail + (r.fail ?? 0), skipped: acc.skipped + (r.skipped ?? 0)
  }), { tests: 0, pass: 0, fail: 0, skipped: 0 });
  console.log(`合計: tests ${totals.tests} / pass ${totals.pass} / fail ${totals.fail} / skipped ${totals.skipped} — ${failed.length === 0 ? '全エントリ exit 0' : `exit≠0: ${failed.map(r => r.id).join(', ')}`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
