import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONNECTIONS_REGISTRY } from '../../../../packages/creator-root/src/index.mjs';

const entry = fileURLToPath(new URL('../doctor.mjs', import.meta.url));
const repo = path.resolve(path.dirname(entry), '../../..');
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;

async function runDoctor(language, mutate = () => {}) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'doctor-i18n-'));
  const project = path.join(scratch, 'project');
  const file = path.join(project, '.akari', 'connections.json');
  await mkdir(path.dirname(file), { recursive: true });
  const registry = structuredClone(DEFAULT_CONNECTIONS_REGISTRY);
  mutate(registry);
  await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`);
  const run = spawnSync(process.execPath, [entry, file], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: scratch,
      AKARI_LANG: language, AKARI_HOME: path.join(scratch, 'home'), AKARI_MONOREPO: repo },
  });
  const report = run.status === 0 ? await readFile(path.join(project, '.akari', 'reports', 'connections-report.html'), 'utf8') : '';
  const saved = run.status === 0 ? JSON.parse(await readFile(file, 'utf8')) : null;
  await rm(scratch, { recursive: true, force: true });
  return { run, report, saved };
}

test('English doctor output and default notes contain no Japanese; JSON retains Japanese details', async () => {
  const { run, report, saved } = await runDoctor('en');
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout + run.stderr + report, japanese);
  assert.match(report, /<html lang="en">/u);
  assert.match(report, /AKARI connection report/u);
  assert.match(report, /Replicate billing page/u);
  assert.match(run.stdout, /is not set in the environment or credentials\.env/u);
  assert.match(saved.providers.find(provider => provider.id === 'replicate').doctor.detail,
    /は環境変数にも credentials\.env にも設定されていません/u);
});

test('Japanese display and JSON keep original text; user-edited notes are shown verbatim', async () => {
  const custom = '独自の説明';
  const { run, report, saved } = await runDoctor('ja', registry => {
    registry.providers.find(provider => provider.id === 'replicate').notes.description = custom;
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /鍵の置き場: なし/u);
  assert.match(run.stdout, /接続レポート:/u);
  assert.match(report, /<html lang="ja">/u);
  assert.match(report, /<dt>用途<\/dt><dd>独自の説明<\/dd>/u);
  assert.equal(saved.providers.find(provider => provider.id === 'replicate').notes.description, custom);
  assert.match(saved.providers.find(provider => provider.id === 'replicate').doctor.detail,
    /は環境変数にも credentials\.env にも設定されていません/u);
});

test('English report leaves edited provider notes untouched', async () => {
  const { run, report } = await runDoctor('en', registry => {
    registry.providers.find(provider => provider.id === 'replicate').notes.description = '独自の説明';
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(report, /<dt>Purpose<\/dt><dd>独自の説明<\/dd>/u);
  assert.match(report, /Check balance and usage on the Replicate billing page/u);
});

test('English help is translated when i18n is installed', () => {
  const run = spawnSync(process.execPath, [entry, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, AKARI_LANG: 'en', AKARI_MONOREPO: repo },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Usage: node /u);
});
