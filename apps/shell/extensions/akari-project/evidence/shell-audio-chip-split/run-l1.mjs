import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , electronPath, appPath, workspacePath, profileRoot, evidenceDir, catalogRoot] = process.argv;
if (![electronPath, appPath, workspacePath, profileRoot, evidenceDir, catalogRoot].every(Boolean)) {
  throw new Error('usage: run-l1.mjs <electron> <app> <workspace> <profile> <evidence> <catalog>');
}

const wrapperPath = fileURLToPath(new URL('./electron-wrapper', import.meta.url));
const configDir = path.join(profileRoot, 'config');
await mkdir(configDir, { recursive: true });
const electronStdoutPath = path.join(profileRoot, 'electron-stdout.log');
const electronStderrPath = path.join(profileRoot, 'electron-stderr.log');
await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
  'akari.catalog.root': path.resolve(catalogRoot)
}, null, 2));

const audioRoot = path.join(catalogRoot, 'audio');
const entries = (await readdir(audioRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
const classifications = [];
for (const entry of entries) {
  const metaPath = path.join(audioRoot, entry.name, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  if (meta.category !== 'audio' || typeof meta.id !== 'string') {
    throw new Error(`invalid audio meta: ${metaPath}`);
  }
  const tags = Array.isArray(meta.tags) ? meta.tags.filter(tag => typeof tag === 'string') : [];
  classifications.push({ id: meta.id, label: tags.includes('sfx') ? '効果音' : 'BGM', tags });
}

const bgmIds = classifications.filter(item => item.label === 'BGM').map(item => item.id);
const sfxIds = classifications.filter(item => item.label === '効果音').map(item => item.id);
const classificationText = [
  '# catalog/audio classification',
  '',
  `total: ${classifications.length}`,
  `BGM: ${bgmIds.length}`,
  `効果音: ${sfxIds.length}`,
  '',
  ...classifications.map(item => `${item.id} -> ${item.label}`),
  ''
].join('\n');
await writeFile(path.join(evidenceDir, 'classification-results.txt'), classificationText);

const electronApp = path.resolve(path.dirname(electronPath), '../..');
const launchEnvironment = {
  AKARI_L1_APP_PATH: path.resolve(appPath),
  AKARI_L1_WORKSPACE_PATH: path.resolve(workspacePath),
  AKARI_ASSETS_CATALOG: 'http://127.0.0.1:9/catalog.json',
  AKARI_HOME: path.join(profileRoot, 'akari-home'),
  THEIA_CONFIG_DIR: configDir,
  AKARI_L1_EVIDENCE_DIR: path.resolve(evidenceDir),
  AKARI_L1_EXPECTED_BGM_IDS: JSON.stringify(bgmIds),
  AKARI_L1_EXPECTED_SFX_IDS: JSON.stringify(sfxIds)
};
// LaunchServices registration is required by current macOS before AppKit can create a BrowserWindow.
// `open --env` keeps the isolated product environment while still using that registration path.
const child = spawn('/usr/bin/open', [
  '-n', '-W',
  '--stdout', electronStdoutPath,
  '--stderr', electronStderrPath,
  ...Object.entries(launchEnvironment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
  electronApp,
  '--args',
  wrapperPath,
  `--user-data-dir=${path.join(profileRoot, 'user-data')}`,
  '--no-sandbox',
  '--window-size=1200,850'
], {
  cwd: wrapperPath,
  env: process.env,
  stdio: 'inherit'
});

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});

async function replayElectronLog(filePath, label, output) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (content.length > 0) {
    output.write(`[${label}]\n${content}${content.endsWith('\n') ? '' : '\n'}`);
  }
}

child.on('exit', async code => {
  try {
    await replayElectronLog(electronStdoutPath, 'electron stdout', process.stdout);
    await replayElectronLog(electronStderrPath, 'electron stderr', process.stderr);

    const runLog = JSON.parse(await readFile(path.join(evidenceDir, 'run-log.json'), 'utf8'));
    const complete = runLog.some(entry => entry.step === 'audio:sfx-selection')
      && !runLog.some(entry => entry.step === 'failure');
    process.exitCode = code === 0 && complete ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
