#!/usr/bin/env node
// scripts/ci/run-unit-tests.mjs — ユニットテストのレーン定義 + 実行器（CI とローカルで共用・レーン定義の正本）
//
// 使い方:
//   node scripts/ci/run-unit-tests.mjs --lane pure         # 外部ツール不要・決定論（CI: required）
//   node scripts/ci/run-unit-tests.mjs --lane shell        # apps/shell 本体 + 拡張（CI: L0 ジョブ末尾・required。build:ext 済みが前提）
//   node scripts/ci/run-unit-tests.mjs --lane quarantine   # main で既に赤・修正待ち（CI: 参考 = continue-on-error）
//   node scripts/ci/run-unit-tests.mjs --lane media        # ffmpeg / ffprobe / Chrome が要る（CI: 参考 = continue-on-error）
//   node scripts/ci/run-unit-tests.mjs --list              # 全レーンの中身と、CI に載せていないテストの一覧
//   node scripts/ci/run-unit-tests.mjs --list --verbose    # 上に加えて node --test 側の対象ファイルを 1 行ずつ
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
//
// Windows 対応（2026-09-19・Windows 11 / Node 24.20.0 実測）:
//   上の実測は macOS 前提で、Windows 開発機ではレーンランナー自体が起動できていなかった
//   （npm エントリ 15 個すべて status: null → 件数 `-` / 0.0 秒の赤）。原因は 2 つで、どちらも下で塞いだ:
//     1. `npm.cmd` を shell 指定なしで spawn できない（Node 20+ / CVE-2024-27980）→ resolveNpmCli()
//     2. 各パッケージの test script が bare `node` を呼ぶので、node が PATH に無い配置だと
//        npm を起動できても script が落ちる → childEnv()（PATH の末尾に node 自身のディレクトリを追記）

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// npm の起動経路（2026-09-19・Windows 実測）:
//   Node 20 以降の Windows は .cmd / .bat を shell 指定なしで spawn できない（CVE-2024-27980 の対策で
//   spawn 自体が拒否する）。そのため `npm.cmd` を直に spawnSync すると全 npm エントリが status: null で
//   即死し、レポートが「0.0 秒・件数 -」の赤だけになる（= レーンランナーが Windows で使えない）。
//   shell: true を付ければ動くが、引数がシェル解釈にさらされる（スクリプト名や将来の引数に
//   スペース・`&`・`^` が入ると注入面になる）ので採らない。
//   代わりに .cmd シムを介さず npm の実体（node_modules/npm/bin/npm-cli.js）を process.execPath で
//   直接動かす。シムは「node を探して npm-cli.js に渡す」だけの薄い層なので、これは同じことを
//   自前でやっているに等しく、OS 非依存（macOS / Linux も同じ経路になる）。
export function resolveNpmCli(env = process.env, execPath = process.execPath) {
  const candidates = [];
  // 1) 自分自身が npm run から起動されている場合、npm が実体のパスを渡してくれている。
  //    npm-cli.js という名前まで見るのは、npm_execpath に .cmd シム（Windows で spawn 不能）や
  //    yarn / pnpm の入口が入っていることがあり、それを npm として叩いてしまわないため
  const fromEnv = env.npm_execpath;
  if (fromEnv && /(?:^|[\\/])npm-cli\.(?:c?js|mjs)$/u.test(fromEnv)) candidates.push(fromEnv);
  // 2) node の隣（Windows 公式インストーラ・nvm-windows・zip 展開）と
  //    prefix/lib 配下（POSIX 公式 tarball・nvm・Homebrew: /usr/local/bin/node → /usr/local/lib/node_modules/…）
  const nodeDir = path.dirname(execPath);
  candidates.push(
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  );
  // 3) node と npm が別置きの場合の保険: PATH 上の npm シムの隣を同じ 2 パターンで探す
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  const shimNames = process.platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm'];
  for (const directory of (env[pathKey] ?? '').split(path.delimiter)) {
    if (!directory) continue;
    if (!shimNames.some(name => existsSync(path.join(directory, name)))) continue;
    candidates.push(
      path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

const NPM_CLI = resolveNpmCli();

// 子プロセスの PATH に node 自身のディレクトリを「末尾に」足す。
// 各パッケージの test script は `node --test …` を bare `node` で呼ぶので、node が PATH に無い環境
// （Windows で zip 展開した node、~/.local/node に置いた node など）では npm を起動できても
// script 側が「'node' は認識されていません」で落ちる。
// 追記は末尾のみ = 既存の PATH エントリを一切上書きしないので、node が PATH にある
// macOS / Linux / CI では解決順が変わらない（同じ node が後ろに 1 つ増えるだけ）。
export function childEnv(env = process.env, execPath = process.execPath) {
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  const nodeDir = path.resolve(path.dirname(execPath));
  const current = env[pathKey] ?? '';
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const already = current.split(path.delimiter)
    .some(entry => entry && same(path.resolve(entry), nodeDir));
  if (already) return env;
  return { ...env, [pathKey]: current ? `${current}${path.delimiter}${nodeDir}` : nodeDir };
}

const CHILD_ENV = childEnv();

// エントリの形:
//   { id, cwd, npm: 'test' }                        → cwd で `npm run --silent <script>`
//   { id, cwd, files: [glob...], exclude: [RegExp] } → cwd で `node --test <展開したファイル>`
const pkg = (name, script = 'test') => ({ id: `packages/${name}`, cwd: `packages/${name}`, npm: script });
const ext = (name) => ({ id: `apps/shell/extensions/${name}`, cwd: `apps/shell/extensions/${name}`, npm: 'test' });

// packages/preview-server のうち「外部ツール不要・決定論」のテストだけを required（pure）で走らせる
// ための明示列挙（2026-09-19）。
//
// なぜ npm test ではなく列挙か:
//   - preview-server の `npm test` は `test/*.test.mjs` 全件 = Playwright / puppeteer / ffmpeg /
//     ffprobe を要するファイルまで巻き込むので、パッケージ単位では required にできない
//     （pretest も edit-store → akari-preview → 自身の build を回す）。だから媒体依存込みの
//     全件は media レーン（参考）に残し、ここは node --test でファイルを直接指定する
//   - ファイル名規約（*.pure.test.mjs のような接尾辞）は既存 78 ファイルの改名が必要で、
//     preview-server は他レーンが並行編集中のため採れない。よってレーン定義側での列挙
//   - 列挙は「既定で required に入れない」側に倒れる安全弁でもある: 新規テストが増えても
//     勝手に required へ載らないので、ブラウザ前提のテストが追加された日に required が赤くならない
//     （逆に glob + exclude だと新規ファイルが既定で required 入りする）
//
// 選定基準（scripts/test/ci-lane-spawn-and-purity.test.mjs が機械検査する）:
//   1. ファイル本文に playwright / puppeteer / chrome / chromium / CHROME_PATH / launchBrowser /
//      ffmpeg / ffprobe / electron / onnxruntime への参照が無い
//   2. L1（実機観測）の *.l1.mjs ではない
//   3. この Windows 機で実測して緑（= OS 依存で落ちない）
export const PREVIEW_SERVER_PURE_TESTS = [
  'test/adjust-css-visual.test.mjs',
  'test/audio-clip.test.mjs',
  'test/audio-declick.test.mjs',
  'test/audio-lane-projection-put.test.mjs',
  'test/audio-scrub.test.mjs',
  'test/caption-display-route.test.mjs',
  'test/caption-display.test.mjs',
  'test/caption-line-budget.test.mjs',
  'test/clip-adjust-dom-preview.test.mjs',
  'test/cut-transform-visual.test.mjs',
  'test/cut-write-guard.test.mjs',
  'test/ducking-supply-chain.test.mjs',
  'test/edit-history-store.test.mjs',
  'test/edit-to-timeline-still-image.test.mjs',
  'test/edit-to-timeline-v2.test.mjs',
  'test/fragment-assets.test.mjs',
  'test/frame-engine-adjust.test.mjs',
  'test/frame-engine-boundary-metrics.test.mjs',
  'test/frame-engine-flag.test.mjs',
  'test/frame-engine-layers.test.mjs',
  'test/frame-engine-play-gate.test.mjs',
  'test/frame-engine-render-state.test.mjs',
  'test/frame-engine-startup-order.test.mjs',
  'test/image-layer-source.test.mjs',
  'test/layer-crop-anchor.test.mjs',
  'test/layer-lazy-load.test.mjs',
  'test/media-playback-resume.test.mjs',
  'test/media-time-sync.test.mjs',
  'test/mp4-audio-track.test.mjs',
  'test/preview-audio-pcm-range.test.mjs',
  'test/preview-end-frame-request.test.mjs',
  'test/preview-frame-presented.test.mjs',
  'test/preview-layer-proxies.test.mjs',
  'test/preview-logical-size-declaration.test.mjs',
  'test/proxy-moov-quarantine.test.mjs',
  'test/runtime-registry.test.mjs',
  'test/still-image-display.test.mjs',
  'test/transition-recipe-supply-chain.test.mjs',
  'test/transition-visual.test.mjs',
  'test/v2-object-tree-put.test.mjs',
  'test/vgpu-preview-scale.test.mjs',
  'test/viewport-units.test.mjs',
  'test/web-ui-parity-2026-09.test.mjs',
  'test/zoom-viewport-structure.test.mjs'
];

// 基準 1・2 は満たすが required に載せていない preview-server テストと理由（1 対 1 の帳尻）。
// media レーンの `npm test` 側では全件走るので、取り落としではなく「required に入れない」だけ。
export const PREVIEW_SERVER_PURE_EXCLUSIONS = [];

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
      pkg('generate'),            // 依存ゼロ・純関数（生成入力バリデータ w1-b 2026-09-13。adapters/ は test script の glob 外 = 合流後の統合小票で吸収）
      pkg('akari-vibe'),          // 依存ゼロ・fetch 差し替え・係を起こすテストはポート 0 番と一時の AKARI_HOME
      {
        // パッケージ単位（npm test）では Playwright / ffmpeg 前提のファイルまで走ってしまうので、
        // 外部ツール不要のファイルだけを明示列挙して node --test で直接叩く。
        // 全件は media レーン（参考）側で走り続ける。選定基準は PREVIEW_SERVER_PURE_TESTS のコメント
        id: 'packages/preview-server (外部ツール不要のテストのみ)',
        cwd: 'packages/preview-server',
        files: PREVIEW_SERVER_PURE_TESTS
      },
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
      ext('akari-companion'),
      ext('akari-partner'),
      ext('akari-project'),
      ext('akari-shell-strip'),
      ext('akari-surfaces'),
      ext('akari-tabs'),
      ext('akari-theme'),          // webview の styles 再送スケジューラ（2026-09-06 webview-theme-vars で追加）
      ext('akari-world-view'),
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
      // Playwright chromium。無ければ一部 skip・一部 fail。
      // 外部ツール不要のファイル（PREVIEW_SERVER_PURE_TESTS）は pure レーンでも走るので二重実行になるが、
      // ここは「パッケージの npm test をそのまま回す参考レーン」の役目を保つため縮めない
      pkg('preview-server'),
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
  { what: 'packages/preview-server test:frame-engine-browser（*.l1.mjs）', why: 'L1（実機観測）。CI の対象外' },
  ...PREVIEW_SERVER_PURE_EXCLUSIONS.map(item => ({
    what: `packages/preview-server/${item.file}（required には載せない。media レーンの npm test では走る）`,
    why: item.why
  }))
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

export function commandFor(entry, npmCli = NPM_CLI) {
  if (entry.npm) {
    const shown = `npm run ${entry.npm}`;
    const npmArgs = ['run', '--silent', entry.npm];
    // npm-cli.js を node で直接叩く（.cmd シムを spawn しない = Windows でも shell: true 不要）
    if (npmCli) return { cmd: process.execPath, args: [npmCli, ...npmArgs], shown };
    // POSIX は PATH の npm が普通に exec できるので従来どおり（.cmd 問題は Windows 限定）
    if (process.platform !== 'win32') return { cmd: 'npm', args: npmArgs, shown };
    return {
      cmd: null,
      args: npmArgs,
      shown,
      unavailable: 'npm の実体（node_modules/npm/bin/npm-cli.js）が見つかりません。'
        + ' npm run 経由で起動する（npm_execpath が渡る）か、node と同じ配布に含まれる npm を使ってください'
    };
  }
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
  const { cmd, args, shown, unavailable } = commandFor(entry);
  const cwd = path.join(REPO_ROOT, entry.cwd);
  if (!cmd) {
    console.log(`\n=== FAIL ${entry.id} — ${shown} (0.0s) ===`);
    console.log(unavailable);
    return { id: entry.id, shown, exit: 1, seconds: '0.0', tests: null, pass: null, fail: null, skipped: null };
  }
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: CHILD_ENV, maxBuffer: 64 * 1024 * 1024 });
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

function printList(laneFilter, verbose = false) {
  for (const [lane, def] of Object.entries(LANES)) {
    if (laneFilter && lane !== laneFilter) continue;
    console.log(`\n[${lane}] ${def.title}`);
    for (const entry of def.entries) {
      const files = entry.npm ? null : expandFiles(entry);
      const detail = entry.npm ? `npm run ${entry.npm}` : `node --test ${files.length} files`;
      console.log(`  - ${entry.id}  (${entry.cwd}: ${detail})`);
      // --list --verbose で「どのファイルが required に入っているか」を 1 行ずつ出す（レーン検収の証跡用）
      if (verbose && files) for (const file of files) console.log(`      ${file}`);
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
    printList(args.lane, args.verbose);
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

// レーン定義とコマンド組み立てを scripts/test から import して検査できるように、
// 直接起動されたときだけ main() を走らせる（import 時に process.exit されないようにする）
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
const invokedDirectly = process.platform === 'win32'
  ? invokedPath.toLowerCase() === selfPath.toLowerCase()
  : invokedPath === selfPath;
if (invokedDirectly) main();
