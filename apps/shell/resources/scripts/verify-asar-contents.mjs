import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { listPackage, extractFile } from '@electron/asar';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputRoot = path.join(shellRoot, 'electron-builder-out');
const packageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));

// platform 注入: 実ビルド（npm run postpackage）では process.platform をそのまま使う
// （従来どおり）。--platform=<value>（または env AKARI_TARGET_PLATFORM）を渡すと mac 上
// から他 platform の走査ロジック（electron-builder --dir の出力レイアウト差異）を
// dry-run 検証できる。win-packaging タスク（2026-07-23）L0 検証専用の注入口。
// copy-native-helpers.mjs と同じ注入規約。
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

// electron-builder --dir の出力レイアウトは platform で構造が異なる（実物 electron-builder
// 実行結果 apps/shell/electron-builder-out/mac-arm64/*.app で確認 + app-builder-lib の
// computeAppOutDir 実装で裏取り）。
//   - darwin: <outputRoot>/<mac-*>/<ProductName>.app/Contents/Resources/app.asar
//   - win32 / linux（--dir target）: <outputRoot>/<win|linux[-arch]-unpacked>/resources/app.asar
//     （.app 相当のバンドル階層は無く、"-unpacked" ディレクトリ自体がアプリルート）
// ディレクトリ名の arch suffix 有無には依存しないが、win32/linux は
// buildConfigurationKey（win|linux）で始まり "-unpacked" で終わるという命名規約
// （app-builder-lib の computeAppOutDir 実装で裏取り）でプレフィックス絞り込みを行う。
// 絞り込まないと、同じ electron-builder-out/ に win-unpacked と linux-unpacked が
// 両方存在する場合に platform=win32 の検証が linux-unpacked も誤って拾ってしまう
// （実地の dry-run テストで実際に発生し発覚 — report.md 参照）。
const buildConfigurationKeyByPlatform = { win32: 'win', linux: 'linux' };

async function discoverApplications(root, platform) {
  const applications = [];
  const topLevel = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const directory of topLevel) {
    if (!directory.isDirectory()) {
      continue;
    }
    const directoryPath = path.join(root, directory.name);
    if (platform === 'darwin') {
      const children = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
      for (const entry of children) {
        if (entry.isDirectory() && entry.name.endsWith('.app')) {
          const applicationPath = path.join(directoryPath, entry.name);
          applications.push({
            displayPath: applicationPath,
            asar: path.join(applicationPath, 'Contents', 'Resources', 'app.asar')
          });
        }
      }
    } else {
      const expectedPrefix = buildConfigurationKeyByPlatform[platform];
      const matchesPlatformDirectory = expectedPrefix != null
        && directory.name.startsWith(`${expectedPrefix}-`)
        && directory.name.endsWith('-unpacked');
      if (!matchesPlatformDirectory) {
        continue;
      }
      const asar = path.join(directoryPath, 'resources', 'app.asar');
      const exists = await stat(asar).then(() => true, () => false);
      if (exists) {
        applications.push({ displayPath: directoryPath, asar });
      }
    }
  }
  return applications;
}

// プラットフォームごとの必須ネイティブモジュール（node-pty）。asar 内エントリ一覧に対する
// 正規表現チェックで存在を確認する。実地調査（node_modules/node-pty/prebuilds/ の実物 +
// electron-builder ソースでの裏取り。詳細は report.md / copy-native-helpers.mjs 冒頭コメント）:
//   - darwin: spawn-helper が copy-native-helpers.mjs 経由で lib/prebuilds/ に明示コピー
//     され、package.json の asarUnpack 個別ルールで unpack される
//   - win32: conpty.node / conpty_console_list.node が asarUnpack の **/*.node で自動 unpack
//   - linux: pty.node が asarUnpack の **/*.node で自動 unpack（spawn-helper 相当は無い）
const platformNativeModuleChecks = {
  darwin: [
    { label: 'node-pty spawn-helper', pattern: /^\/lib\/prebuilds\/darwin-(?:arm64|x64)\/spawn-helper$/ }
  ],
  win32: [
    { label: 'node-pty conpty.node', pattern: /^\/node_modules\/node-pty\/prebuilds\/win32-(?:arm64|x64)\/conpty\.node$/ },
    { label: 'node-pty conpty_console_list.node', pattern: /^\/node_modules\/node-pty\/prebuilds\/win32-(?:arm64|x64)\/conpty_console_list\.node$/ }
  ],
  linux: [
    { label: 'node-pty pty.node', pattern: /^\/node_modules\/node-pty\/prebuilds\/linux-(?:arm64|x64)\/pty\.node$/ }
  ]
};

// du 相当のサイズ集計を pure Node で行う（darwin/linux の `du` は Windows 実機には無く、
// windows-build.md が案内する `npm run package`（postpackage で本スクリプトを呼ぶ）が
// Windows 上でそのまま動くようにするための移植対応）。ディスクブロックではなく見かけの
// バイト合計なので `du` の値と厳密には一致しないが、配布をブロックしない目安表示という
// 用途には十分（オーナー裁定 2026-07-20 のとおり厳格チェックはしない）。
async function computeDirectorySizeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      } else if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        total += (await stat(entryPath)).size;
      }
    }
  }
  return total;
}

const applications = await discoverApplications(outputRoot, targetPlatform);

if (applications.length === 0) {
  console.error(
    `PACKAGE-VERIFY FAILED — electron-builder-out 配下に platform=${targetPlatform} の ` +
    '出力が見つかりません（.app バンドル、または <platform>-unpacked/resources/app.asar）。'
  );
  process.exit(1);
}

const fileDependencies = Object.entries(packageJson.dependencies ?? {})
  .filter(([, specification]) => typeof specification === 'string' && specification.startsWith('file:'))
  .map(([name]) => name);

// 自社 file: 依存を再帰収集する（ThirdPartyNotices 照合の除外用）。拡張がさらに file: で
// 自社共有カーネル（例 @akari-video/edit-store / pen-visuals）へ依存する形が生まれたため、
// shell 直下 1 階層の fileDependencies だけでは除外から取りこぼして誤検知する。
// generate-third-party-notices.mjs の「file: 依存 = 自社拡張。通知対象にせず依存だけ辿る」と
// 同じ深さで辿る（直上の fileDependencies は asar 内の拡張存在検査用で、従来どおり直下のみ）。
async function collectFirstPartyPackageNames(rootManifest, rootDir) {
  const names = new Set();
  const visited = new Set();
  const queue = [{ manifest: rootManifest, dir: rootDir }];
  while (queue.length > 0) {
    const { manifest, dir } = queue.shift();
    for (const [name, specification] of Object.entries(manifest.dependencies ?? {})) {
      if (typeof specification !== 'string' || !specification.startsWith('file:')) {
        continue;
      }
      names.add(name);
      const dependencyDir = path.resolve(dir, specification.slice('file:'.length));
      if (visited.has(dependencyDir)) {
        continue;
      }
      visited.add(dependencyDir);
      try {
        const dependencyManifest = JSON.parse(await readFile(path.join(dependencyDir, 'package.json'), 'utf8'));
        queue.push({ manifest: dependencyManifest, dir: dependencyDir });
      } catch {
        // package.json が読めない file: 依存はここでは無視する（存在の検証は別段の責務）
      }
    }
  }
  return names;
}
const firstPartyPackageNames = await collectFirstPartyPackageNames(packageJson, shellRoot);

let failed = false;
const verified = [];

for (const application of applications.sort((a, b) => a.displayPath.localeCompare(b.displayPath))) {
  const asar = application.asar;
  let entries;
  try {
    // Windows の asar list はエントリをバックスラッシュ区切りで返すため、以降の
    // `/lib/...` 前提の照合が全滅する（CI run 30000812912 実測: 547MB の asar 全項目 MISSING）。
    // 区切りを '/' に正規化してから照合する。
    entries = listPackage(asar, { isPack: false }).map(entry => entry.replace(/\\/g, '/'));
  } catch (error) {
    console.error(`❌ app.asar を読み取れません: ${path.relative(shellRoot, asar)}`);
    console.error(error instanceof Error ? error.message : String(error));
    failed = true;
    continue;
  }

  for (const name of fileDependencies) {
    if (entries.some(entry => entry.startsWith(`/node_modules/${name}/`))) {
      console.log(`✅ ${name}`);
    } else {
      console.error(`❌ MISSING in asar: 拡張 ${name}`);
      failed = true;
    }
  }

  const evidenceEntries = entries.filter(entry => /\/evidence(?:\/|$)/.test(entry));
  if (evidenceEntries.length === 0) {
    console.log('✅ evidence 0 件');
  } else {
    console.error(`❌ EVIDENCE in asar: ${evidenceEntries.length} 件`);
    failed = true;
  }

  const requiredFiles = [
    '/electron-entry.js',
    '/lib/skills/analyze-footage/SKILL.md',
    '/lib/schemas/analysis.schema.json',
    // フラグ on の frame-engine 評価台へ注入する正本。欠けると canvas 面を起動できない。
    '/lib/overlay-runtime/frame-engine.js',
    '/lib/overlay-runtime/osr-frame-engine.js',
    // F5「新しい動画を始める」/ U5「チャンネルに入れる」の実処理本体（動的 import）。
    // 同梱が漏れると .app をリポの外へ置いた瞬間に上方探索が空振りして
    // 「新しい動画の作成に失敗しました。」で必ず失敗する（実機で再現済み）。
    '/lib/packages/project-scaffold/src/index.mjs',
    '/lib/packages/creator-root/src/index.mjs'
  ];
  for (const required of requiredFiles) {
    if (entries.includes(required)) {
      console.log(`✅ ${required}`);
    } else {
      console.error(`❌ MISSING: ${required}`);
      failed = true;
    }
  }
  try {
    const bundledPackageJson = JSON.parse(extractFile(asar, 'package.json').toString('utf8'));
    if (bundledPackageJson.main === 'electron-entry.js') {
      console.log("✅ package.json main === 'electron-entry.js'");
    } else {
      console.error(`❌ package.json main: ${String(bundledPackageJson.main)}（expected electron-entry.js）`);
      failed = true;
    }
  } catch (error) {
    console.error(
      '❌ asar 内 package.json の main 検査に失敗:',
      error instanceof Error ? error.message : String(error)
    );
    failed = true;
  }
  if (entries.some(entry => entry.startsWith('/lib/templates/project-default'))) {
    console.log('✅ /lib/templates/project-default');
  } else {
    console.error('❌ MISSING: /lib/templates/project-default');
    failed = true;
  }

  const nativeModuleChecks = platformNativeModuleChecks[targetPlatform] ?? [];
  for (const check of nativeModuleChecks) {
    if (entries.some(entry => check.pattern.test(entry))) {
      console.log(`✅ ${check.label}`);
    } else {
      console.error(`❌ MISSING: ${check.label}（platform=${targetPlatform}）`);
      failed = true;
    }
  }

  // issue #5: ripgrep は child_process.spawn で起動するため asar 内では実行できない
  // （Electron は require の asar → asar.unpacked リダイレクトはするが spawn はしない。
  // win 実機 ENOENT / mac 実測 ENOTDIR）。asar 内エントリ検査だけでは「unpack される
  // べきものが unpack されていない」を検出できず今回すり抜けたため、検収は 2 点:
  // (1) rg 実体が app.asar.unpacked 側に存在し実行可能であること
  //     （build.asarUnpack の lib/backend/native/** が効いている証拠）
  // (2) asar 内 lib/backend/main.js の rgPath が asar.unpacked 置換を持つこと
  //     （prepackage の patch-ripgrep-asar-path.mjs の適用痕）
  const rgName = targetPlatform === 'win32' ? 'rg.exe' : 'rg';
  const rgUnpacked = path.join(`${asar}.unpacked`, 'lib', 'backend', 'native', rgName);
  const rgStat = await stat(rgUnpacked).then(s => s, () => null);
  const rgExecutable = rgStat != null && rgStat.isFile()
    && (targetPlatform === 'win32' || (rgStat.mode & 0o111) !== 0);
  if (rgExecutable) {
    console.log(`✅ ripgrep unpacked（app.asar.unpacked/lib/backend/native/${rgName}）`);
  } else {
    console.error(
      `❌ MISSING/NOT-EXECUTABLE: app.asar.unpacked/lib/backend/native/${rgName}` +
      '（issue #5 — build.asarUnpack の lib/backend/native/** を確認）'
    );
    failed = true;
  }
  // asar 内エントリの取り出しは @electron/asar を直接 import して呼ぶ（CLI をシェル経由で
  // 叩かない）。issue #5 の Windows 実機報告で、旧実装の
  // `execSync(... ${JSON.stringify(path.join('lib','backend','main.js'))})` が win32 で
  // false-fail することが判明したため（= 配布可能なパッケージを「配布禁止」と誤判定する）。
  // 機構: win32 では path.join が 'lib\backend\main.js' を返し、JSON.stringify がそれを
  // '"lib\\backend\\main.js"' へエスケープする。cmd.exe は二重引用符しか剥がさず
  // バックスラッシュのエスケープを解釈しないので、CLI には区切りが二重化した文字列が渡る。
  // アーカイブ内の検索は path.sep 分割（@electron/asar filesystem.js の searchNodeFromPath）
  // なので空セグメントが混入して miss する。mac 上の等価再現（区切りを '//' に二重化）でも
  // 同一の "was not found in this archive" になることを実測済み。
  // なお archivePath 側は Windows の FS が '\\' を吸収するため開けてしまい、
  // アーカイブ内キーの照合だけが落ちる、という非対称な壊れ方をしていた。
  // 引数を文字列連結でシェルに渡さなければ区切り・引用符の解釈段が消える。
  // 検索キーは path.sep 分割に合わせるため path.join のまま（正規化してはいけない）。
  try {
    const bundledMain = extractFile(asar, path.join('lib', 'backend', 'main.js')).toString('utf8');
    if (bundledMain.includes('app.asar.unpacked$1')) {
      console.log('✅ rgPath asar.unpacked 置換（patch-ripgrep-asar-path 適用痕）');
    } else {
      console.error(
        '❌ rgPath が素の asar パスのまま（prepackage の patch-ripgrep-asar-path.mjs 未適用 — issue #5）'
      );
      failed = true;
    }
  } catch (error) {
    console.error(
      '❌ asar 内 lib/backend/main.js の rgPath 検査に失敗:',
      error instanceof Error ? error.message : String(error)
    );
    failed = true;
  }

  // サードパーティライセンス通知の同梱検査。生成は prepackage の
  // generate-third-party-notices.mjs、配置は extraResources("." は mac: Contents/Resources、
  // win/linux: resources/ に展開される)。存在 3 点に加え、asar 内 top-level パッケージ全数が
  // ThirdPartyNotices.txt に掲載されていることを照合する(walker の取りこぼし検知。
  // 自社 file: 拡張はサードパーティではないので照合から除く)。
  const resourcesDir = targetPlatform === 'darwin'
    ? path.join(application.displayPath, 'Contents', 'Resources')
    : path.join(application.displayPath, 'resources');
  // analyze-project のレポート生成本体は extraResources（asar 外）へ配置される。
  // どれか欠けると CLI の実行、テンプレート解決、または interpretation 検証が失敗する。
  const analysisReportRuntimeFiles = [
    path.join('packages', 'osr-export', 'package.json'),
    path.join('packages', 'osr-export', 'src', 'electron-main.mjs'),
    path.join('packages', 'osr-export', 'generated', 'frame-engine.js'),
    path.join('packages', 'analysis-report', 'render-analysis-report.mjs'),
    path.join('packages', 'analysis-report', 'template.html'),
    // 判断記録レポートも同じく extraResources（asar 外）で renderer とテンプレートを同居させる。
    path.join('packages', 'decision-log-report', 'render-decision-log-report.mjs'),
    path.join('packages', 'decision-log-report', 'template.html'),
    path.join('packages', 'schemas', 'bin', 'validate-interpretation.mjs'),
    path.join('packages', 'schemas', 'interpretation.schema.json')
  ];
  for (const relative of analysisReportRuntimeFiles) {
    const exists = await stat(path.join(resourcesDir, relative)).then(s => s.isFile(), () => false);
    if (exists) {
      console.log(`✅ ${relative}`);
    } else {
      console.error(`❌ MISSING: ${relative}(リソース直下)`);
      failed = true;
    }
  }
  for (const noticeFile of ['ThirdPartyNotices.txt', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    const exists = await stat(path.join(resourcesDir, noticeFile)).then(s => s.isFile(), () => false);
    if (exists) {
      console.log(`✅ ${noticeFile}`);
    } else {
      console.error(`❌ MISSING: ${noticeFile}(リソース直下)`);
      failed = true;
    }
  }
  const noticesText = await readFile(path.join(resourcesDir, 'ThirdPartyNotices.txt'), 'utf8').catch(() => null);
  if (noticesText !== null) {
    const asarPackageNames = new Set();
    for (const entry of entries) {
      const match = entry.match(/^\/node_modules\/(@[^/]+\/[^/]+|[^@./][^/]*)\//);
      if (match) {
        asarPackageNames.add(match[1]);
      }
    }
    const firstParty = firstPartyPackageNames;
    const missingFromNotices = [...asarPackageNames]
      .filter(name => !firstParty.has(name))
      .filter(name => !noticesText.includes(`%% ${name}@`))
      .sort();
    if (missingFromNotices.length === 0) {
      console.log(`✅ ThirdPartyNotices 網羅（asar 内 ${asarPackageNames.size} パッケージ照合）`);
    } else {
      console.error(`❌ ThirdPartyNotices 不掲載: ${missingFromNotices.join(', ')}`);
      failed = true;
    }
  }

  // サイズは配布をブロックしない（オーナー裁定 2026-07-20 — 「1GB いってもいい」）。
  // 情報として常に表示し、暴走ビルド検知のための緩い目安（SOFT_BUDGET_MB）超過時のみ
  // 警告する。中身チェック（拡張・skills・schemas・templates）は従来どおり厳格。
  const SOFT_BUDGET_MB = 1536;
  const sizeBytes = await computeDirectorySizeBytes(application.displayPath).catch(() => NaN);
  const sizeMb = Number.isFinite(sizeBytes) ? Math.round(sizeBytes / (1024 * 1024)) : NaN;
  if (!Number.isFinite(sizeMb)) {
    console.warn('⚠️ SIZE UNKNOWN（計測できず・配布はブロックしない）');
  } else if (sizeMb > SOFT_BUDGET_MB) {
    console.warn(`⚠️ SIZE ${sizeMb}MB > 目安 ${SOFT_BUDGET_MB}MB（配布はブロックしないが肥大化に注意）`);
  } else {
    console.log(`✅ SIZE ${sizeMb}MB（目安 ${SOFT_BUDGET_MB}MB 以内）`);
  }
  verified.push(`${path.relative(shellRoot, application.displayPath)} (${Number.isFinite(sizeMb) ? sizeMb : 'UNKNOWN'}MB)`);
}

if (failed) {
  console.error('PACKAGE-VERIFY FAILED — 配布禁止');
  process.exit(1);
}
console.log(`PACKAGE-VERIFIED: ${verified.join(', ')} / 拡張全数・skills・templates・schemas 同梱確認済み`);
