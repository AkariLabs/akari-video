import { copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_CLI_NPM_ENTRIES } from './bundled-cli-npm-entries.mjs';
import { BINARY_MANIFEST, BUNDLED_LICENSE_TEXTS, WHISPER_CPP_SOURCE, currentTarget } from '../../../../packages/media-bin/src/binary-manifest.mjs';

// 配布物(app.asar + lib/ バンドル)に同梱される全サードパーティ依存のライセンス通知
// ThirdPartyNotices.txt を機械生成する。prepackage で毎回再生成し、electron-builder の
// extraResources 経由で mac: Contents/Resources/ 直下、win/linux: resources/ 直下に置かれる。
// 存在と網羅性(asar 内 top-level パッケージ全数が載っていること)は
// verify-asar-contents.mjs(postpackage)が検査する。
//
// 依存ツリーは npm CLI に頼らず自前で辿る。`npm query` はリポ root の workspaces 文脈を
// 拾って root パッケージを混入させる(実測)ため、package.json の dependencies +
// optionalDependencies を Node の解決規則(fromDir から node_modules を上方探索、
// repoRoot で打ち切り)で BFS する。devDependencies は配布物に入らないので辿らない。
// 打ち切りは当初 shellRoot だったが、npm workspaces の hoisting で依存はリポ直下の
// node_modules に居るのが通常形（dedupe 結果で揺れる）ため、リポ直下まで遡る。
// file: 依存(自社 akari-* 拡張)はサードパーティではないため通知対象から除外し、
// その依存だけを辿る。

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, '../..');
const repoRoot = path.resolve(shellRoot, '../..');
const outDir = process.env.AKARI_NOTICE_OUTPUT_FOR_TEST ?? path.join(shellRoot, 'resources', 'generated-notices');
const licenseTextsDir = path.join(scriptDir, 'license-texts');
const frameBundle = path.join(repoRoot, 'packages/frame-engine/generated/frame-engine.iife.js');
const overlayVendor = path.join(repoRoot, 'packages/overlay-runtime/src/vendor');
const mediaBin = process.env.AKARI_NOTICE_MEDIA_BIN_FOR_TEST ?? path.join(shellRoot, 'resources/vendor-ffmpeg');

async function isDirectory(candidate) {
  return stat(candidate).then(s => s.isDirectory(), () => false);
}

async function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  while (dir === repoRoot || dir.startsWith(repoRoot + path.sep)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (await isDirectory(candidate)) {
      return candidate;
    }
    if (dir === repoRoot) {
      break;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function normalizeLicenseExpression(packageJson) {
  if (typeof packageJson.license === 'string' && packageJson.license.trim() !== '') {
    return packageJson.license.trim();
  }
  if (packageJson.license && typeof packageJson.license === 'object' && packageJson.license.type) {
    return String(packageJson.license.type);
  }
  // 旧形式 { licenses: [{ type }] }(古いパッケージにまだ残っている)
  if (Array.isArray(packageJson.licenses) && packageJson.licenses.length > 0) {
    return packageJson.licenses.map(entry => entry.type ?? String(entry)).join(' OR ');
  }
  return 'UNKNOWN';
}

function normalizeAuthor(packageJson) {
  const author = packageJson.author;
  if (typeof author === 'string' && author.trim() !== '') {
    return author.trim();
  }
  if (author && typeof author === 'object' && author.name) {
    return String(author.name);
  }
  return null;
}

function normalizeRepository(packageJson) {
  const repository = packageJson.repository;
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (!url) {
    return packageJson.homepage ?? null;
  }
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice|thirdpartynotices?)(\.|-|$)/i;

async function readLicenseFiles(packageDir) {
  const entries = await readdir(packageDir, { withFileTypes: true }).catch(() => []);
  const texts = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name)) {
      texts.push(await readFile(path.join(packageDir, entry.name), 'utf8'));
    }
  }
  return texts;
}

function licenseFromText(text) {
  if (/Apache License\s+Version 2\.0/u.test(text) && /TERMS AND CONDITIONS FOR USE/u.test(text)) return 'Apache-2.0';
  if ((/\bMIT License\b|The MIT License/u.test(text) || /The above copyright notice and this permission notice shall be/u.test(text)) &&
      /Permission is hereby granted/u.test(text) && /THE SOFTWARE IS PROVIDED "AS IS"/u.test(text)) return 'MIT';
  if (/Redistribution and use in source and binary forms/u.test(text)) {
    return /Neither the name of/u.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (/Permission to use, copy, modify, and\/or distribute this software/u.test(text)) return 'ISC';
  return null;
}

// ライセンス式(単一 ID / "A OR B" / "A WITH C")から、付録に本文を持つ ID を選ぶ。
// OR のときはどれか 1 つを選択して配布すればよいので、付録テキストを持っている ID を優先する。
async function pickAppendixLicenseId(expression, availableTexts) {
  const candidates = expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map(token => token.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (availableTexts.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

const rootPackageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));

const availableAppendixTexts = new Set(
  (await readdir(licenseTextsDir).catch(() => []))
    .filter(name => name.endsWith('.txt'))
    .map(name => name.slice(0, -4))
);

const queue = [];
const visitedDirs = new Set();
const thirdParty = new Map(); // "name@version" -> record
const unresolved = [];
const skippedOptional = [];

function enqueueDependencies(packageJson, fromDir) {
  const optionalNames = new Set(Object.keys(packageJson.optionalDependencies ?? {}));
  const all = { ...(packageJson.dependencies ?? {}), ...(packageJson.optionalDependencies ?? {}) };
  for (const [name, spec] of Object.entries(all)) {
    queue.push({ name, spec, fromDir, optional: optionalNames.has(name) });
  }
}

enqueueDependencies(rootPackageJson, shellRoot);

// extraResources で配る CLI（packages/render-cut・packages/gpu-export）が実行時に import する
// npm 依存も配布物に入る（prepackage の bundle-cli-node-modules.mjs が
// resources/cli-node-modules へ staging し、Resources/packages/node_modules として同梱される）。
// apps/shell の dependencies には現れないので、ここで明示的に BFS の起点へ足す。
// 足さないと通知が実際の配布物より狭くなる（= 同梱しているのに載っていない依存が出る）。
// 起点は CLI の package.json の dependencies ではなく **実際に staging する入口**を使う
// （render-cut は hyperframes を依存として宣言しているが同梱しない — 宣言から辿ると
// 配布していない 400MB 分の依存まで通知に載り、今度は逆に実態とずれる）。
for (const name of BUNDLED_CLI_NPM_ENTRIES) {
  queue.push({ name, spec: '*', fromDir: repoRoot, optional: false });
}

while (queue.length > 0) {
  const { name, spec, fromDir, optional } = queue.shift();

  // file: 依存 = 自社拡張。通知対象にせず依存だけ辿る
  if (typeof spec === 'string' && spec.startsWith('file:')) {
    const extensionDir = path.resolve(fromDir, spec.slice('file:'.length));
    const real = await realpath(extensionDir).catch(() => extensionDir);
    if (visitedDirs.has(real)) {
      continue;
    }
    visitedDirs.add(real);
    const extensionPackageJson = JSON.parse(await readFile(path.join(extensionDir, 'package.json'), 'utf8'));
    enqueueDependencies(extensionPackageJson, extensionDir);
    continue;
  }

  const packageDir = await resolvePackageDir(name, fromDir);
  if (packageDir === null) {
    (optional ? skippedOptional : unresolved).push(`${name} (from ${path.relative(shellRoot, fromDir) || '.'})`);
    continue;
  }
  const real = await realpath(packageDir).catch(() => packageDir);
  if (visitedDirs.has(real)) {
    continue;
  }
  visitedDirs.add(real);

  const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  const key = `${packageJson.name}@${packageJson.version}`;
  if (!thirdParty.has(key)) {
    thirdParty.set(key, {
      name: packageJson.name,
      version: packageJson.version,
      licenseExpression: normalizeLicenseExpression(packageJson),
      author: normalizeAuthor(packageJson),
      repository: normalizeRepository(packageJson),
      licenseTexts: await readLicenseFiles(packageDir),
      aliases: new Set()
    });
  }
  // npm alias インストール("x-cjs": "npm:x@^4" 等)は依存名 ≠ 実名でディレクトリが
  // 別名で存在する。通知にも別名で載せないと verify の asar 全数照合に落ちる
  if (name !== packageJson.name) {
    thirdParty.get(key).aliases.add(name);
  }
  enqueueDependencies(packageJson, packageDir);
}

if (unresolved.length > 0) {
  console.error('THIRD-PARTY-NOTICES FAILED — 解決できない必須依存があります(node_modules が不完全):');
  for (const entry of unresolved) {
    console.error(`  - ${entry}`);
  }
  process.exit(1);
}

// frame-engine の生成物に記録された入力パスを出典とする。av-cliper は vendor コピーの
// パスで記録されるため、同生成物のそのパスがある場合だけ npm 原本を照合する。
try {
  const frameSource = await readFile(frameBundle, 'utf8');
  const frameNames = new Set([...frameSource.matchAll(/node_modules\/(?:@[^/]+\/)?[^/\s"']+/gu)]
    .map(match => match[0].slice('node_modules/'.length)));
  if (frameSource.includes('packages/frame-engine/vendor/av-cliper/av-cliper.js')) frameNames.add('@webav/av-cliper');
  // release は apps/shell だけ npm install する。frame-engine の 4 依存は
  // リポ内の固定 LICENSE を正本にし、開発機で npm 原本があれば版と本文を照合する。
  const frameLicenses = {
    '@webav/av-cliper': {
      version: '1.2.8', spdx: 'MIT', source: 'https://github.com/WebAV-Tech/WebAV',
      licenseFile: path.join(repoRoot, 'packages/frame-engine/vendor/av-cliper/LICENSE'),
    },
    '@webav/internal-utils': {
      version: '1.2.8', spdx: 'MIT', source: 'https://github.com/WebAV-Tech/WebAV',
      licenseFile: path.join(licenseTextsDir, 'frame-engine/internal-utils.txt'),
    },
    'opfs-tools': {
      version: '0.7.4', spdx: 'MIT', source: 'https://github.com/hughfenghen/opfs-tools',
      licenseFile: path.join(licenseTextsDir, 'frame-engine/opfs-tools.txt'),
    },
    'wave-resampler': {
      version: '1.0.0', spdx: 'MIT', source: 'https://github.com/rochars/wave-resampler',
      licenseFile: path.join(licenseTextsDir, 'frame-engine/wave-resampler.txt'),
    },
  };
  const framePackageRootForTest = process.env.AKARI_NOTICE_FRAME_PACKAGE_ROOT_FOR_TEST;
  for (const name of [...frameNames].sort()) {
    if (name === '@webav/mp4box.js') {
      if (![...thirdParty.values()].some(record => record.name === name)) {
        throw new Error('frame-engine 同梱依存 @webav/mp4box.js が通知にありません。bundled CLI 依存と node_modules を確認してください');
      }
      continue; // BUNDLED_CLI_NPM_ENTRIES による収集と重複させない
    }
    const expected = frameLicenses[name];
    if (!expected) throw new Error(`frame-engine 同梱依存 ${name} の表とライセンス文がありません。両方を追加してください`);
    let licenseBytes;
    try {
      licenseBytes = await readFile(expected.licenseFile);
    } catch {
      throw new Error(`frame-engine 同梱依存 ${name} の固定 LICENSE がありません: ${expected.licenseFile}。本文を追加してください`);
    }
    const licenseText = licenseBytes.toString('utf8');
    if (licenseFromText(licenseText) !== expected.spdx) {
      throw new Error(`frame-engine 同梱依存 ${name} の固定 LICENSE と ${expected.spdx} が一致しません。本文と表を確認してください`);
    }
    const packageDir = framePackageRootForTest !== undefined
      ? (await isDirectory(path.join(framePackageRootForTest, name)) ? path.join(framePackageRootForTest, name) : null)
      : await resolvePackageDir(name, shellRoot);
    if (packageDir) {
      const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
      if (packageJson.name !== name || packageJson.version !== expected.version) {
        throw new Error(`frame-engine 同梱依存 ${name} の版が固定表と異なります。表と LICENSE の写しを更新してください`);
      }
      const declared = normalizeLicenseExpression(packageJson);
      if (declared !== 'UNKNOWN' && declared !== expected.spdx) {
        throw new Error(`frame-engine 同梱依存 ${name} の SPDX が固定表と異なります。表と LICENSE の写しを確認してください`);
      }
      let installedLicense;
      try {
        installedLicense = await readFile(path.join(packageDir, 'LICENSE'));
      } catch {
        throw new Error(`frame-engine 同梱依存 ${name} の npm LICENSE がありません。依存を確認してください`);
      }
      if (!installedLicense.equals(licenseBytes)) {
        throw new Error(`frame-engine 同梱依存 ${name} の LICENSE が固定の写しと異なります。写しを更新してください`);
      }
    }
    const existing = [...thirdParty.values()].find(record => record.name === name);
    if (existing && (existing.version !== expected.version || existing.licenseExpression !== expected.spdx)) {
      throw new Error(`frame-engine 同梱依存 ${name} の既存通知と固定表が一致しません。版とライセンスを確認してください`);
    }
    if (!existing) thirdParty.set(`frame-engine:${name}`, {
      name, version: expected.version, licenseExpression: expected.spdx,
      author: null, repository: expected.source,
      licenseTexts: [licenseText], aliases: new Set(),
    });
  }

  // 版は README の npm tarball 記録、BudouX の同梱 LICENSE、VRM バンドル先頭の
  // バージョン表示から確定する。確定できない liquid-glass-js は vendored のままにする。
  const overlayLicenses = {
    'three': { spdx: 'MIT', version: '0.185.1', npmName: 'three', evidence: 'three@0.185.1' },
    'vgpu': { spdx: 'MIT', version: '0.4.0', npmName: 'vgpu', evidence: 'vgpu@0.4.0' },
    'troika-three-text': { spdx: 'MIT', version: '0.52.4', npmName: 'troika-three-text', evidence: 'troika-three-text@0.52.4' },
    'opentype.js': { spdx: 'MIT', version: '1.3.4', npmName: 'opentype.js', evidence: 'opentype.js@1.3.4' },
    'matter-js': { spdx: 'MIT', version: '0.20.0', npmName: 'matter-js', evidence: 'matter-js@0.20.0' },
    'poly-decomp': { spdx: 'MIT', version: '0.3.0', npmName: 'poly-decomp', evidence: 'poly-decomp@0.3.0' },
    'three-vrm': { spdx: 'MIT', version: '3.5.5', npmName: '@pixiv/three-vrm', evidence: '@pixiv/three-vrm v3.5.5' },
    'budoux': { spdx: 'Apache-2.0', version: '0.9.0', npmName: 'budoux', evidence: 'budoux 0.9.0', name: 'BudouX' },
    'liquid-glass-js': { spdx: 'MIT', version: 'vendored', source: 'https://github.com/dashersw/liquid-glass-js' },
  };
  const vendorEntries = await readdir(overlayVendor);
  const bundleLicenses = {
    'three-bundle.js': ['three'],
    'vgpu-bundle.js': ['vgpu'],
    'avatar-vrm-bundle.js': ['three-vrm'],
    'budoux-ja-bundle.js': ['budoux'],
    'vendor-3d-text-bundle.js': ['troika-three-text', 'opentype.js'],
  };
  for (const bundle of vendorEntries.filter(name => name.endsWith('-bundle.js'))) {
    if (!bundleLicenses[bundle]) throw new Error(`overlay vendor ${bundle} にライセンス対応表がありません。対応を追加してください`);
  }
  const vendorLicenseNames = vendorEntries.filter(name => name.endsWith('-LICENSE.txt') || name.startsWith('LICENSE.'));
  const overlayReadme = await readFile(path.join(repoRoot, 'packages/overlay-runtime/README.md'), 'utf8');
  const vrmBundle = await readFile(path.join(overlayVendor, 'avatar-vrm-bundle.js'), 'utf8');
  for (const file of vendorLicenseNames.sort()) {
    const name = file.startsWith('LICENSE.') ? file.slice('LICENSE.'.length) : file.slice(0, -'-LICENSE.txt'.length);
    const expected = overlayLicenses[name];
    if (!expected) throw new Error(`overlay vendor ${file} にライセンス対応表がありません。対応を追加してください`);
    const licenseText = await readFile(path.join(overlayVendor, file), 'utf8');
    if (licenseFromText(licenseText) !== expected.spdx) {
      throw new Error(`overlay vendor ${file} の LICENSE 本文と ${expected.spdx} が一致しません。本文を確認してください`);
    }
    const evidence = name === 'three-vrm' ? vrmBundle : name === 'budoux' ? licenseText : overlayReadme;
    if (expected.evidence && !evidence.includes(expected.evidence)) {
      throw new Error(`overlay vendor ${name} の版 ${expected.version} を確認できません。バンドルと記録を確認してください`);
    }
    thirdParty.set(`overlay-vendor:${name}`, {
      name: expected.name ?? name, version: expected.version, licenseExpression: expected.spdx,
      author: null,
      repository: expected.source ?? `https://www.npmjs.com/package/${expected.npmName}/v/${expected.version}`,
      licenseTexts: [licenseText], aliases: new Set(),
    });
  }
  for (const name of Object.keys(overlayLicenses)) {
    const file = name === 'liquid-glass-js' ? `LICENSE.${name}` : `${name}-LICENSE.txt`;
    if (!vendorLicenseNames.includes(file)) throw new Error(`overlay vendor ${name} の LICENSE がありません。対応する本文を配置してください`);
  }
  for (const names of Object.values(bundleLicenses)) for (const name of names) {
    if (!overlayLicenses[name]) throw new Error(`overlay vendor ${name} のライセンス対応表がありません`);
  }

  const ffmpegSource = BINARY_MANIFEST[currentTarget()]?.source;
  if (!ffmpegSource) throw new Error(`FFmpeg ${currentTarget()} のソース情報が manifest にありません。対応を追加してください`);
  const ffmpegVersion = ffmpegSource.ffmpegRevision.match(/^n(\d+\.\d+\.\d+)/u)?.[1];
  if (!ffmpegVersion) throw new Error('FFmpeg の版を manifest の ffmpegRevision から判別できません');
  for (const [key, name, version, license, repository, details] of [
    ['ffmpeg', 'FFmpeg', ffmpegVersion, 'GPL-3.0-or-later', ffmpegSource.ffmpegSource, [
      `build: ${ffmpegSource.distributor}`, `build scripts: ${ffmpegSource.buildScripts}`,
      `revision: ${ffmpegSource.ffmpegRevision}`, `license text: ${BUNDLED_LICENSE_TEXTS.ffmpeg.fileName}`,
    ]],
    ['whisper', 'whisper.cpp', WHISPER_CPP_SOURCE.tag.replace(/^v/u, ''), 'MIT',
      `${WHISPER_CPP_SOURCE.repository}/tree/${WHISPER_CPP_SOURCE.tag}`, []],
  ]) {
    const entry = BUNDLED_LICENSE_TEXTS[key];
    let licenseText;
    try {
      licenseText = await readFile(path.join(mediaBin, entry.fileName), 'utf8');
    } catch {
      throw new Error(`media-bin/${entry.fileName} がありません。先に bundle-media-binaries.mjs を実行してください`);
    }
    thirdParty.set(`media:${key}`, {
      name, version, licenseExpression: license, author: null, repository,
      details, licenseTexts: [licenseText], aliases: new Set(),
    });
  }
} catch (error) {
  const detail = error.code === 'ENOENT'
    ? `${error.path} が見つかりません。frame-engine の生成物、overlay vendor、依存パッケージを確認してください`
    : error.message;
  console.error(`THIRD-PARTY-NOTICES FAILED — ${detail}`);
  process.exit(1);
}

// Electron / Chromium のライセンス文。electron-builder は win/linux では実行ファイル横に
// 自動で置くが mac では .app に入れない(実測)ため、全 platform で自前同梱に統一する。
// electron も hoisting 次第で置き場が揺れるため resolvePackageDir で実在位置を引く。
const electronPackageDir = await resolvePackageDir('electron', shellRoot);
if (!electronPackageDir) {
  console.error('THIRD-PARTY-NOTICES FAILED — electron パッケージが node_modules に見つかりません。');
  process.exit(1);
}
const electronDist = process.env.AKARI_NOTICE_ELECTRON_DIST_FOR_TEST ?? path.join(electronPackageDir, 'dist');
const electronLicense = path.join(electronDist, 'LICENSE');
const chromiumLicenses = path.join(electronDist, 'LICENSES.chromium.html');
for (const required of [electronLicense, chromiumLicenses]) {
  const exists = await stat(required).then(() => true, () => false);
  if (!exists) {
    console.error(
      `THIRD-PARTY-NOTICES FAILED — ${path.relative(shellRoot, required)} がありません。` +
      'electron/dist が不完全です(npm 11 allow-scripts ゲート。verify スキル L0 節の回避手順を参照)。'
    );
    process.exit(1);
  }
}
const electronVersion = (await readFile(path.join(electronDist, 'version'), 'utf8').catch(() => 'unknown')).trim();

const records = [...thirdParty.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const appendixPackagesByLicenseId = new Map();
const pointerOnly = [];

const sections = [];
for (const record of records) {
  const lines = [];
  lines.push(`%% ${record.name}@${record.version} — ${record.licenseExpression}`);
  for (const alias of [...record.aliases].sort()) {
    lines.push(`%% ${alias}@${record.version} — ${record.licenseExpression} (npm alias of ${record.name})`);
  }
  if (record.author) {
    lines.push(`   author: ${record.author}`);
  }
  if (record.repository) {
    lines.push(`   source: ${record.repository}`);
  }
  for (const detail of record.details ?? []) {
    lines.push(`   ${detail}`);
  }
  lines.push('');
  if (record.licenseTexts.length > 0) {
    lines.push(record.licenseTexts.join('\n\n').trim());
  } else {
    const appendixId = await pickAppendixLicenseId(record.licenseExpression, availableAppendixTexts);
    if (appendixId !== null) {
      if (!appendixPackagesByLicenseId.has(appendixId)) {
        appendixPackagesByLicenseId.set(appendixId, []);
      }
      appendixPackagesByLicenseId.get(appendixId).push(`${record.name}@${record.version}`);
      lines.push(
        'The npm package does not include a license text file. ' +
        `Licensed under ${record.licenseExpression}; the standard ${appendixId} text is reproduced in the Appendix below.`
      );
    } else {
      pointerOnly.push(`${record.name}@${record.version} — ${record.licenseExpression}`);
      lines.push(
        'The npm package does not include a license text file. ' +
        `Licensed under ${record.licenseExpression}; see https://spdx.org/licenses/ for the license text.`
      );
    }
  }
  sections.push(lines.join('\n'));
}

const separator = '\n\n' + '='.repeat(78) + '\n\n';
const header = [
  'THIRD-PARTY SOFTWARE NOTICES AND INFORMATION',
  '============================================',
  '',
  `This file accompanies ${rootPackageJson.name ?? 'AKARI Video'} ${rootPackageJson.version ?? ''}`.trimEnd() + '.',
  'It lists the third-party software contained in this distribution together',
  'with their license notices. Sections are separated by "%% <package> — <license>".',
  '',
  `This application is built on Electron ${electronVersion}. The Electron and Chromium`,
  'license terms are provided alongside this file as LICENSE.electron.txt and',
  'LICENSES.chromium.html.'
].join('\n');

const appendixParts = [];
if (appendixPackagesByLicenseId.size > 0) {
  appendixParts.push(
    'APPENDIX — STANDARD LICENSE TEXTS',
    '=================================',
    '',
    'The packages referenced below do not ship a license text file inside their',
    'npm package. Their declared licenses correspond to the standard texts',
    'reproduced in this appendix. The copyright holder of each package is the',
    'author / contributors of that package as recorded in its package metadata.'
  );
  for (const licenseId of [...appendixPackagesByLicenseId.keys()].sort()) {
    const licenseText = await readFile(path.join(licenseTextsDir, `${licenseId}.txt`), 'utf8');
    appendixParts.push(
      '',
      `----- ${licenseId} -----`,
      '',
      `Applies to: ${appendixPackagesByLicenseId.get(licenseId).join(', ')}`,
      '',
      licenseText.trim()
    );
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'ThirdPartyNotices.txt'),
  header + separator + sections.join(separator) + (appendixParts.length > 0 ? separator + appendixParts.join('\n') : '') + '\n'
);
await copyFile(electronLicense, path.join(outDir, 'LICENSE.electron.txt'));
await copyFile(chromiumLicenses, path.join(outDir, 'LICENSES.chromium.html'));
await copyFile(path.join(repoRoot, 'LICENSE'), path.join(outDir, 'LICENSE.akari-video.txt'));

const withText = records.filter(record => record.licenseTexts.length > 0).length;
console.log(
  `THIRD-PARTY-NOTICES GENERATED: ${records.length} packages ` +
  `(license file ${withText} / appendix ${records.length - withText - pointerOnly.length} / pointer ${pointerOnly.length})` +
  ` + Electron ${electronVersion} licenses → ${path.relative(shellRoot, outDir)}`
);
if (pointerOnly.length > 0) {
  console.warn('⚠️ 付録テキスト未収蔵のライセンス(本文なし・SPDX ポインタのみ)。license-texts/ への追加を検討:');
  for (const entry of pointerOnly) {
    console.warn(`  - ${entry}`);
  }
}
if (skippedOptional.length > 0) {
  console.log(`optional 依存の未インストール ${skippedOptional.length} 件をスキップ(platform 別ネイティブ等): ${skippedOptional.join(', ')}`);
}
