import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
let failed = false;
const verified = [];

for (const application of applications.sort((a, b) => a.displayPath.localeCompare(b.displayPath))) {
  const asar = application.asar;
  let entries;
  try {
    entries = execSync(`npx --yes @electron/asar list ${JSON.stringify(asar)}`, {
      cwd: shellRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }).split(/\r?\n/).filter(Boolean);
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
    '/lib/skills/analyze-footage/SKILL.md',
    '/lib/schemas/analysis.schema.json'
  ];
  for (const required of requiredFiles) {
    if (entries.includes(required)) {
      console.log(`✅ ${required}`);
    } else {
      console.error(`❌ MISSING: ${required}`);
      failed = true;
    }
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
