import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputRoot = path.join(shellRoot, 'electron-builder-out');
const packageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));

const applications = [];
for (const directory of await readdir(outputRoot, { withFileTypes: true }).catch(() => [])) {
  if (!directory.isDirectory()) {
    continue;
  }
  const directoryPath = path.join(outputRoot, directory.name);
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      applications.push(path.join(directoryPath, entry.name));
    }
  }
}

if (applications.length === 0) {
  console.error('PACKAGE-VERIFY FAILED — electron-builder-out 配下に .app が見つかりません。');
  process.exit(1);
}

const fileDependencies = Object.entries(packageJson.dependencies ?? {})
  .filter(([, specification]) => typeof specification === 'string' && specification.startsWith('file:'))
  .map(([name]) => name);
let failed = false;
const verified = [];

for (const application of applications.sort()) {
  const asar = path.join(application, 'Contents', 'Resources', 'app.asar');
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

  const sizeOutput = execSync(`du -sm ${JSON.stringify(application)}`, { encoding: 'utf8' }).trim();
  const sizeMb = Number.parseInt(sizeOutput, 10);
  if (!Number.isFinite(sizeMb) || sizeMb > 500) {
    console.error(`❌ SIZE ${Number.isFinite(sizeMb) ? sizeMb : 'UNKNOWN'}MB > 500MB`);
    failed = true;
  } else {
    console.log(`✅ SIZE ${sizeMb}MB <= 500MB`);
  }
  verified.push(`${path.relative(shellRoot, application)} (${sizeMb}MB)`);
}

if (failed) {
  console.error('PACKAGE-VERIFY FAILED — 配布禁止');
  process.exit(1);
}
console.log(`PACKAGE-VERIFIED: ${verified.join(', ')} / 拡張全数・skills・templates・schemas 同梱確認済み`);
