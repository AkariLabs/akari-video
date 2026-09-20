// scripts/test/ci-lane-spawn-and-purity.test.mjs
//
// レーンランナー（scripts/ci/run-unit-tests.mjs）の 2 点を機械検査する:
//   (a) 子プロセスの起動が「どの OS でも spawn できる形」であること
//       — Node 20 以降の Windows は .cmd / .bat を shell 指定なしで spawn できない（CVE-2024-27980）。
//         以前は npm.cmd を直に spawn していて、Windows では npm エントリ全部が status: null で
//         即死していた（件数 `-` / 0.0 秒の赤）。shell: true での回避も禁止する（引数がシェル解釈にさらされる）
//   (b) pure（CI required）レーンに外部ツール依存のテストファイルが混入していないこと
//       — required は「どの環境でも同じ結果になる」ものだけ、というレーン分けの原則の機械化
//
// 併せて scripts/ci/check-preview-server-drift.mjs も同じ観点（shebang 付き JS を直接 spawn しない）で検査する。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LANES,
  NOT_COVERED,
  PREVIEW_SERVER_PURE_TESTS,
  PREVIEW_SERVER_PURE_EXCLUSIONS,
  childEnv,
  commandFor,
  resolveNpmCli
} from '../ci/run-unit-tests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(repoRoot, 'scripts/ci/run-unit-tests.mjs');
const runnerSource = readFileSync(runnerPath, 'utf8');
const previewServerTestDir = path.join(repoRoot, 'packages/preview-server/test');

// 外部ツール（ブラウザ実機 / ffmpeg 系 / Electron / ネイティブ）に触るテストの目印。
// 「ファイル本文にこの語が出たら required に載せない」という粗いが説明可能な基準にする
// （import 先の綴り・環境変数名・spawn するコマンド名のいずれかに必ず現れる）。
const EXTERNAL_TOOL_MARKERS = [
  /playwright/iu,
  /puppeteer/iu,
  /chromium/iu,
  /\bchrome\b/iu,
  /CHROME_PATH/u,
  /launchBrowser/u,
  /ffmpeg/iu,
  /ffprobe/iu,
  /electron/iu,
  /onnxruntime/iu
];

const markersIn = (source) => EXTERNAL_TOOL_MARKERS.filter(marker => marker.test(source)).map(String);
const npmEntries = Object.entries(LANES).flatMap(([lane, def]) => def.entries.filter(e => e.npm).map(e => ({ lane, entry: e })));
const fileEntries = Object.entries(LANES).flatMap(([lane, def]) => def.entries.filter(e => !e.npm).map(e => ({ lane, entry: e })));
const temporaryDirectory = t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-lane-spawn-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

// ---------------------------------------------------------------- (a) 起動形

test('npm エントリは node + npm-cli.js で起動し、.cmd / .bat シムを spawn しない', () => {
  assert.ok(npmEntries.length >= 15, `npm エントリが少なすぎる: ${npmEntries.length}`);
  for (const { lane, entry } of npmEntries) {
    const { cmd, args } = commandFor(entry, '/fixture/npm-cli.js');
    assert.equal(cmd, process.execPath, `${lane}/${entry.id}`);
    assert.deepEqual(args, ['/fixture/npm-cli.js', 'run', '--silent', entry.npm], `${lane}/${entry.id}`);
  }
});

test('全レーンの全エントリで、spawn 対象が .cmd / .bat / .ps1 にならない', () => {
  for (const [lane, def] of Object.entries(LANES)) {
    for (const entry of def.entries) {
      const { cmd } = commandFor(entry, '/fixture/npm-cli.js');
      assert.ok(cmd, `${lane}/${entry.id}: cmd が空`);
      assert.doesNotMatch(cmd, /\.(?:cmd|bat|ps1)$/iu, `${lane}/${entry.id}`);
    }
  }
});

test('この環境で解決した npm の実体は node で読める .js を指す', () => {
  const resolved = resolveNpmCli();
  // Windows は .cmd シムを spawn できないので、実体が見つからないと npm エントリが 1 つも走らない。
  // POSIX は PATH の npm を exec できるためフォールバックがあり、解決できないこと自体は異常ではない
  if (process.platform === 'win32') {
    assert.ok(resolved, 'npm-cli.js を解決できない（node と同じ配布の npm、または npm run 経由での起動が必要）');
  }
  if (!resolved) return;
  assert.match(resolved, /\.(?:c?js|mjs)$/u);
  assert.ok(existsSync(resolved), resolved);
  assert.doesNotMatch(resolved, /\.(?:cmd|bat|ps1)$/iu);
});

test('npm_execpath が .cmd シムや yarn の入口を指しているときは採らない', t => {
  const directory = temporaryDirectory(t);
  for (const name of ['npm.cmd', 'yarn.js', 'pnpm.cjs']) {
    const entry = path.join(directory, name);
    writeFileSync(entry, '// fixture\n');
    // PATH を空にして、node の隣にも npm を置かない = 候補が npm_execpath だけになる状況を作る
    assert.equal(resolveNpmCli({ npm_execpath: entry, PATH: '' }, path.join(directory, 'node.exe')), null, name);
  }
  // npm 本体（npm-cli.js）なら採る
  const npmCli = path.join(directory, 'npm-cli.js');
  writeFileSync(npmCli, '// fixture\n');
  assert.equal(resolveNpmCli({ npm_execpath: npmCli, PATH: '' }, path.join(directory, 'node.exe')), npmCli);
});

test('node の隣・prefix/lib 配下・PATH 上の npm シムの隣、いずれからでも npm-cli.js を見つける', t => {
  const directory = temporaryDirectory(t);
  const write = relative => {
    const target = path.join(directory, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '// fixture\n');
    return target;
  };
  // 1) Windows 公式インストーラ / zip 展開: <node の隣>/node_modules/npm/bin/npm-cli.js
  const besideNode = write('node-dir/node_modules/npm/bin/npm-cli.js');
  assert.equal(resolveNpmCli({ PATH: '' }, path.join(directory, 'node-dir/node.exe')), besideNode);
  // 2) POSIX tarball / nvm / Homebrew: <prefix>/bin/node → <prefix>/lib/node_modules/npm/bin/npm-cli.js
  const underLib = write('prefix/lib/node_modules/npm/bin/npm-cli.js');
  assert.equal(resolveNpmCli({ PATH: '' }, path.join(directory, 'prefix/bin/node')), underLib);
  // 3) node と npm が別置き: PATH 上の npm シムの隣を同じ 2 パターンで探す
  const shimDirectory = path.join(directory, 'shim');
  const viaShim = write('shim/node_modules/npm/bin/npm-cli.js');
  writeFileSync(path.join(shimDirectory, process.platform === 'win32' ? 'npm.cmd' : 'npm'), '# fixture\n');
  assert.equal(resolveNpmCli({ PATH: shimDirectory }, path.join(directory, 'empty/node')), viaShim);
});

test('レーンランナーと preview-server drift 検査は shell: true を使わない', () => {
  const driftSource = readFileSync(path.join(repoRoot, 'scripts/ci/check-preview-server-drift.mjs'), 'utf8');
  for (const [name, source] of [['run-unit-tests.mjs', runnerSource], ['check-preview-server-drift.mjs', driftSource]]) {
    // 「なぜ shell: true を採らないか」はコメントに書いてあるので、コメントを落としてから見る
    const stripped = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
    const offending = stripped.match(/shell\s*:\s*(?:true|process\.platform[^,)]*)/u);
    assert.equal(offending?.[0] ?? null, null, `${name} が shell 起動を使っている`);
  }
});

test('preview-server drift 検査は esbuild の shebang スクリプトを node 経由で起動する', () => {
  const source = readFileSync(path.join(repoRoot, 'scripts/ci/check-preview-server-drift.mjs'), 'utf8');
  // Windows では esbuild/bin/esbuild（shebang 付き JS）は実行可能ファイルではないので直接 spawn できない
  assert.doesNotMatch(source, /spawnSync\(\s*esbuildBin/u);
  assert.match(source, /spawnSync\(\s*process\.execPath\s*,\s*\[\s*esbuildBin\s*,/u);
});

test('frame-engine drift 検査の各下請けは node 経由で起動する', () => {
  const source = readFileSync(path.join(repoRoot, 'scripts/ci/check-frame-engine-drift.mjs'), 'utf8');
  assert.match(source, /spawnSync\(\s*process\.execPath\s*,/u);
});

test('childEnv は PATH の末尾に node のディレクトリを足し、既存エントリを書き換えない', () => {
  const nodeDirectory = path.dirname(process.execPath);
  const augmented = childEnv({ PATH: `/first${path.delimiter}/second` });
  assert.equal(augmented.PATH, `/first${path.delimiter}/second${path.delimiter}${nodeDirectory}`);
  // すでに入っているなら触らない（同じ env オブジェクトをそのまま返す）
  const already = { PATH: `/first${path.delimiter}${nodeDirectory}` };
  assert.equal(childEnv(already), already);
  // Windows の 'Path' のような別綴りでも、キーを増やさず同じキーを書き換える
  const windowsStyle = childEnv({ Path: '/first', OTHER: 'x' });
  assert.deepEqual(Object.keys(windowsStyle).sort(), ['OTHER', 'Path']);
  assert.equal(windowsStyle.Path, `/first${path.delimiter}${nodeDirectory}`);
});

test('import しても main() が走らない（レーン定義を検査から読めること）', () => {
  assert.match(runnerSource, /if \(invokedDirectly\) main\(\);/u);
});

// ---------------------------------------------------------------- (b) pure レーンの純度

test('pure レーンの preview-server は外部ツールの目印を含むファイルを 1 件も含まない', () => {
  for (const relative of PREVIEW_SERVER_PURE_TESTS) {
    const absolute = path.join(repoRoot, 'packages/preview-server', relative);
    assert.ok(existsSync(absolute), `列挙されたファイルが無い（改名か削除）: ${relative}`);
    const markers = markersIn(readFileSync(absolute, 'utf8'));
    assert.deepEqual(markers, [], `${relative} が外部ツールを参照している`);
  }
});

test('preview-server/test を独立に走査しても、目印付きのファイルは pure に入っていない', () => {
  const listed = new Set(PREVIEW_SERVER_PURE_TESTS);
  const impure = readdirSync(previewServerTestDir)
    .filter(name => name.endsWith('.test.mjs'))
    .filter(name => markersIn(readFileSync(path.join(previewServerTestDir, name), 'utf8')).length > 0);
  assert.ok(impure.length >= 20, `目印付きが少なすぎる（走査が壊れている疑い）: ${impure.length}`);
  const leaked = impure.filter(name => listed.has(`test/${name}`));
  assert.deepEqual(leaked, [], `外部ツール依存が pure に混入: ${leaked.join(', ')}`);
});

test('pure レーンに載せていない preview-server テストは理由付きで帳尻が合っている', () => {
  const listed = new Set(PREVIEW_SERVER_PURE_TESTS);
  for (const item of PREVIEW_SERVER_PURE_EXCLUSIONS) {
    assert.ok(!listed.has(item.file), `除外理由があるのに pure に入っている: ${item.file}`);
    assert.ok(existsSync(path.join(repoRoot, 'packages/preview-server', item.file)), item.file);
    assert.ok(item.why && item.why.length > 10, `${item.file}: 理由が空`);
    assert.ok(NOT_COVERED.some(covered => covered.what.includes(item.file)), `${item.file} が NOT_COVERED に出ていない`);
  }
});

test('pure レーンの node --test 対象に L1（実機観測）ファイルが混ざらない', () => {
  for (const { lane, entry } of fileEntries) {
    if (lane !== 'pure') continue;
    const { files } = commandFor(entry);
    assert.ok(files.length > 0, `${entry.id}: 対象 0 件（glob が壊れている）`);
    for (const file of files) assert.doesNotMatch(file, /\.l1\.mjs$/u, `${lane}/${entry.id}: ${file}`);
  }
});

test('preview-server の全件（npm test）は media レーンに残したままにする', () => {
  const pureNpm = LANES.pure.entries.filter(entry => entry.npm).map(entry => entry.cwd);
  assert.ok(!pureNpm.includes('packages/preview-server'),
    'preview-server の npm test は pretest で build を回し、ffmpeg / Chromium 前提のテストも走るので required にできない');
  assert.ok(LANES.media.entries.some(entry => entry.cwd === 'packages/preview-server' && entry.npm === 'test'));
});

test('skills レーンの ffmpeg・swiftc 依存の除外指定が残っている', () => {
  const skills = LANES.pure.entries.find(entry => entry.id.startsWith('skills/*'));
  assert.ok(skills?.exclude?.some(pattern => pattern.test('skills/analyze-footage/test/vision-tracks-assembly.test.mjs')));
  assert.ok(skills?.exclude?.some(pattern => pattern.test('skills/analyze-footage/test/vision-tracks-check.test.mjs')));
});
