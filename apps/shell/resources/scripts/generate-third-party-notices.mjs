import { copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 配布物(app.asar + lib/ バンドル)に同梱される全サードパーティ依存のライセンス通知
// ThirdPartyNotices.txt を機械生成する。prepackage で毎回再生成し、electron-builder の
// extraResources 経由で mac: Contents/Resources/ 直下、win/linux: resources/ 直下に置かれる。
// 存在と網羅性(asar 内 top-level パッケージ全数が載っていること)は
// verify-asar-contents.mjs(postpackage)が検査する。
//
// 依存ツリーは npm CLI に頼らず自前で辿る。`npm query` はリポ root の workspaces 文脈を
// 拾って root パッケージを混入させる(実測)ため、package.json の dependencies +
// optionalDependencies を Node の解決規則(fromDir から node_modules を上方探索、
// shellRoot で打ち切り)で BFS する。devDependencies は配布物に入らないので辿らない。
// file: 依存(自社 akari-* 拡張)はサードパーティではないため通知対象から除外し、
// その依存だけを辿る。

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, '../..');
const outDir = path.join(shellRoot, 'resources', 'generated-notices');
const licenseTextsDir = path.join(scriptDir, 'license-texts');

async function isDirectory(candidate) {
  return stat(candidate).then(s => s.isDirectory(), () => false);
}

async function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  while (dir === shellRoot || dir.startsWith(shellRoot + path.sep)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (await isDirectory(candidate)) {
      return candidate;
    }
    if (dir === shellRoot) {
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

// Electron / Chromium のライセンス文。electron-builder は win/linux では実行ファイル横に
// 自動で置くが mac では .app に入れない(実測)ため、全 platform で自前同梱に統一する。
const electronDist = path.join(shellRoot, 'node_modules', 'electron', 'dist');
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
