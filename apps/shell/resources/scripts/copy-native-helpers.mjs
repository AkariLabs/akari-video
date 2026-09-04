import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(shellRoot, '../..');

// platform/arch 注入: 実ビルド（npm run prepackage）では process.platform/process.arch を
// そのまま使う（従来どおり）。--platform=<value> / --arch=<value>（または env
// AKARI_TARGET_PLATFORM / AKARI_TARGET_ARCH）を渡すと mac 上から他 platform 分岐を
// dry-run 検証できる。win-packaging タスク（2026-07-23）L0 検証専用の注入口。
function readInjectedValue(flagName, envName, fallback) {
  const flagPrefix = `--${flagName}=`;
  const fromArgv = process.argv.find(arg => arg.startsWith(flagPrefix));
  if (fromArgv) {
    return fromArgv.slice(flagPrefix.length);
  }
  if (process.env[envName]) {
    return process.env[envName];
  }
  return fallback;
}

const targetPlatform = readInjectedValue('platform', 'AKARI_TARGET_PLATFORM', process.platform);
const targetArch = readInjectedValue('arch', 'AKARI_TARGET_ARCH', process.arch);

const overlayRuntimeSource = path.join(repoRoot, 'packages', 'overlay-runtime', 'src');
const overlayRuntimeDestination = path.join(shellRoot, 'lib', 'overlay-runtime');
await cp(overlayRuntimeSource, overlayRuntimeDestination, { recursive: true });
// Bundle overlay-runtime's package.json so the backend can read the shipped version
// for project render pins (contract §6) in the packaged app.
await copyFile(
  path.join(repoRoot, 'packages', 'overlay-runtime', 'package.json'),
  path.join(overlayRuntimeDestination, 'package.json')
);
// 共有カーネルの webview 用 IIFE バンドル（edit-store の build が生成・lib/ にコミット済み）。
// akari-preview-service の findWebviewKernelBundle() が packaged では
// lib/overlay-runtime/webview-kernel.js を最初に探す。
await copyFile(
  path.join(repoRoot, 'packages', 'edit-store', 'lib', 'webview-kernel.js'),
  path.join(overlayRuntimeDestination, 'webview-kernel.js')
);
await copyFile(
  path.join(shellRoot, 'extensions', 'akari-preview', 'generated', 'frame-engine.js'),
  path.join(overlayRuntimeDestination, 'frame-engine.js')
);
await copyFile(
  path.join(repoRoot, 'packages', 'osr-export', 'generated', 'frame-engine.js'),
  path.join(overlayRuntimeDestination, 'osr-frame-engine.js')
);
console.log(`Copied overlay-runtime assets to ${path.relative(shellRoot, overlayRuntimeDestination)}`);

// Bundle the repo-root skills/ as the source used when a packaged app creates a
// self-contained project. The project service copies this tree with asar-aware recursion.
const skillsSource = path.join(repoRoot, 'skills');
const skillsDestination = path.join(shellRoot, 'lib', 'skills');
await cp(skillsSource, skillsDestination, {
  recursive: true,
  filter: src => path.basename(src) !== '.gitkeep'
});
console.log(`Copied skills original to ${path.relative(shellRoot, skillsDestination)}`);

const schemasSource = path.join(repoRoot, 'packages', 'schemas');
const schemasDestination = path.join(shellRoot, 'lib', 'schemas');
await cp(schemasSource, schemasDestination, {
  recursive: true,
  filter: src => path.basename(src) !== '.gitkeep'
});
console.log(`Copied schemas original to ${path.relative(shellRoot, schemasDestination)}`);

const projectTemplateSource = path.join(repoRoot, 'templates', 'project-default');
const projectTemplateDestination = path.join(shellRoot, 'lib', 'templates', 'project-default');
await cp(projectTemplateSource, projectTemplateDestination, { recursive: true });
console.log(`Copied project-default template to ${path.relative(shellRoot, projectTemplateDestination)}`);

// akari-surfaces の F5「新しい動画を始める」/ U5「チャンネルに入れる」は、実処理を
// pure Node ESM の packages/project-scaffold・packages/creator-root へ動的 import で
// 委譲する（akari-new-project-service.ts）。両者はリポジトリ直下の packages/ にしか
// 無く、そのままではパッケージ済み .app に一切入らない — .app をリポの外
// （/Applications など実配布先）へ置いた瞬間に上方探索が空振りし、
// 「新しい動画の作成に失敗しました。」で必ず失敗する（実機 CDP で再現確認済み）。
// lib/packages/<name>/src/index.mjs へ写すと、バックエンドバンドル
// （<asar>/lib/backend）からの上方探索が 1 段上で当たるのでリゾルバ側は無変更でよい
// （lib/skills・lib/schemas・lib/templates と同じ流儀。dev 実行でもこの写しが先に
// 当たるため、packages/ を直したら prepackage を回して写しを更新する）。
// 依存ゼロの ESM なので src/ と package.json だけ運べば動く（node_modules 不要）…
// だったが、この「依存ゼロ」は暗黙の前提でしかなく、実際に破れた: issue #48 の対応で
// project-scaffold が `../../akari-launcher/src/history-policy.mjs` を import するように
// なり、その写しが無い v0.1.39 の .app では「新しい動画の作成に失敗しました
// （Cannot find module …/lib/packages/akari-launcher/src/history-policy.mjs）」で必ず失敗した。
// パッケージ名の決め打ちリストだけだと、packages/ 間に import を 1 本足した誰も気づけない。
// そこで写した後に **パッケージの外へ出る相対 import を実際に辿って写す**（連鎖も追う）。
// これで同種の同梱漏れは構造的に起きなくなる。verify-asar-contents.mjs 側にも
// 実在チェックを置いてあり、こちらが取りこぼしても package 時に落ちる。
for (const name of ['project-scaffold', 'creator-root']) {
  const source = path.join(repoRoot, 'packages', name);
  const destination = path.join(shellRoot, 'lib', 'packages', name);
  await cp(path.join(source, 'src'), path.join(destination, 'src'), { recursive: true });
  await copyFile(path.join(source, 'package.json'), path.join(destination, 'package.json'));
  console.log(`Copied ${name} module to ${path.relative(shellRoot, destination)}`);
}
await copyCrossPackageImports(['project-scaffold', 'creator-root']);

/**
 * 写した packages/<name>/src 配下の ESM を読み、`../../<other>/…` のように
 * 自パッケージの外を指す相対 import を lib/packages/ へ写す。写したファイルが
 * さらに外を指していれば、それも辿る（連鎖・循環対応）。
 *
 * packages/ の外（node_modules や別ツリー）を指す import は運べないので、その場で落とす
 * — 黙って通すと「配布版でだけ落ちる」という一番気づきにくい形の壊れ方に戻るため。
 */
async function copyCrossPackageImports(rootNames) {
  const packagesRoot = path.join(repoRoot, 'packages');
  const queue = [];
  for (const name of rootNames) {
    queue.push(...(await listEsmFiles(path.join(packagesRoot, name, 'src'))));
  }
  const visited = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift();
    const contents = await readFile(file, 'utf8');
    for (const specifier of contents.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"](\.[^'"]*)['"]/g)) {
      const resolved = path.resolve(path.dirname(file), specifier[1]);
      if (!resolved.startsWith(`${packagesRoot}${path.sep}`)) {
        throw new Error(
          `${path.relative(repoRoot, file)} が packages/ の外を相対 import しています: ${specifier[1]}\n` +
          'パッケージ済み .app へは運べません（lib/packages/ 配下しか写せない）。import を packages/ 内へ寄せてください。'
        );
      }
      if (visited.has(resolved)) {
        continue;
      }
      visited.add(resolved);
      if (!existsSync(resolved)) {
        throw new Error(`${path.relative(repoRoot, file)} の import 先が存在しません: ${specifier[1]}`);
      }
      const destination = path.join(shellRoot, 'lib', 'packages', path.relative(packagesRoot, resolved));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(resolved, destination);
      console.log(`Copied cross-package import to ${path.relative(shellRoot, destination)}`);
      queue.push(resolved);
    }
  }
}

/** ディレクトリ配下の ESM（.mjs / .js）を再帰列挙する。 */
async function listEsmFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listEsmFiles(candidate)));
    } else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) {
      found.push(candidate);
    }
  }
  return found;
}

// ネイティブヘルパーの追加コピーはプラットフォームごとに要否が異なる（node-pty の
// prebuilds 実物 + electron-builder 本体ソースを実地調査して確定。詳細根拠は report.md）。
//
// - darwin: pty.node（.node 拡張子なので asarUnpack の **/*.node で自動 unpack）に加えて
//   spawn-helper という non-.node の伴走バイナリが必須。asarUnpack の汎用ルールでは
//   拾えないため、本スクリプトが lib/prebuilds/<platform>-<arch>/ へ明示コピーし、
//   package.json 側の `lib/prebuilds/**/spawn-helper` 個別ルールで unpack させている
//   （＝この分岐が唯一の「追加コピーが要る」ケース）。
// - win32: node-pty の win 実装が要求するネイティブモジュールは conpty.node /
//   conpty_console_list.node の 2 つのみで、どちらも .node 拡張子のため asarUnpack の
//   **/*.node が自動で拾う。追加コピーは不要。
//   同じ prebuilds/win32-<arch>/conpty/ 配下に conpty.dll・OpenConsole.exe があるが、
//   これらは node-pty の useConptyDll オプション（既定 false）が true の時だけ
//   LoadLibraryW される代替実装で、Theia 本体（@theia/process 等）にも本リポの
//   extensions/** にも useConptyDll を設定している箇所は無い（実地 grep 確認済み）ため
//   未使用。win 向けビルドでは electron-builder が .dll/.exe を node_modules から
//   除外しない（node_modules/app-builder-lib/out/util/appFileCopier.js の
//   getNodeModuleExcludedExts が `platform !== WINDOWS` の時だけ .dll/.exe を除外する
//   実装のため）ので asar 内には同梱されるが、unpack 対象外＝実ファイルパスを
//   要求する LoadLibraryW からは見えない。未使用機能なので実害なし
//   （useConptyDll を将来使うことになったら asarUnpack に
//   `node_modules/node-pty/prebuilds/**/conpty/**` を追加するか、この分岐で
//   明示コピーする対応が必要になる — 現状は不要）。
// - linux: node-pty の linux prebuilds には pty.node のみで spawn-helper 相当は
//   存在しない（darwin だけの構成）。追加コピーは不要。
if (targetPlatform === 'darwin') {
  const platformArch = `${targetPlatform}-${targetArch}`;
  // node-pty は npm workspaces の hoisting 次第で apps/shell 配下にもリポ直下にも
  // 置かれうる（lockfile の dedupe 結果で揺れる）。実在する方を使う。
  const source = [shellRoot, repoRoot]
    .map(root => path.join(root, 'node_modules', 'node-pty', 'prebuilds', platformArch, 'spawn-helper'))
    .find(candidate => existsSync(candidate));
  if (!source) {
    throw new Error(`node-pty spawn-helper (${platformArch}) が apps/shell とリポ直下のどちらの node_modules にも見つかりません`);
  }
  const destination = path.join(
    shellRoot,
    'lib',
    'prebuilds',
    platformArch,
    'spawn-helper'
  );

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  console.log(`Copied node-pty spawn-helper to ${path.relative(shellRoot, destination)}`);
} else {
  console.log(
    `[copy-native-helpers] platform=${targetPlatform} arch=${targetArch}: ` +
    '追加のネイティブヘルパーコピーは不要（node-pty の必須モジュールは .node 拡張子のみで ' +
    'asarUnpack の **/*.node が既に対応。根拠は resources/scripts 内コメントと report.md 参照）'
  );
}
