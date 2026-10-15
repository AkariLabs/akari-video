import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePlaybookFiles } from '../../schemas/validate-playbook.mjs';
import { applyPlaybook, createProject } from '../src/index.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('applyPlaybook copies both sources, creates three empty edit placeholders and a review sheet', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-'));
  try {
    const projectDir = join(scratch, 'new');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    const result = await applyPlaybook({ projectDir, playbookDir: join(fixtures, 'playbook-sample'),
      now: new Date('2026-10-15T00:00:00Z'), hasTool: async name => name !== 'voicevox' });
    assert.equal(result.placeholdersAdded, 3);
    assert.deepEqual(result.missingTools, ['voicevox']);
    const validation = await validatePlaybookFiles(result.playbookJsonPath);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    const book = JSON.parse(await readFile(result.playbookJsonPath, 'utf8'));
    assert.equal(book.provenance.appliedFrom.playbookVersion, 1);
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    assert.equal(edit.tracks[0].items.length, 3);
    assert.equal(edit.tracks[0].lane, 'visual');
    assert.equal(edit.tracks[0].items.find(item => item.id === 'playbook-bgm')?.source.kind, 'group');
    assert.deepEqual([edit.output.width, edit.output.height], [1080, 1920]);
    assert.equal(edit.output.caption_style_uid, 'st_01HZ…');
    assert.deepEqual(edit.audio.role_gains_db, { voice: -14, bgm: -24 });
    const sheet = await readFile(result.sheetPath, 'utf8');
    assert.match(sheet, /要る道具/);
    assert.match(sheet, /仮枠/);
    assert.match(sheet, /voicevox: 無い/);
    assert.match(sheet, /AKARI 1\.4\.0/);
    assert.match(sheet, /適用元/);
    const rows = ['名前と目的', '深さ', '流れ（確認点つき）', '設定値の数と主な値',
      '仮枠（役割・種類・見本の有無）', '使った部品（入手先・ライセンス・Pro 要否）',
      '要る道具（持っていないものを明記）', 'ライセンス', '出どころ'];
    assert.deepEqual([...sheet.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]), rows);
    const creationReport = await readFile(join(projectDir, '.akari', 'reports', 'create-project-report.html'), 'utf8');
    assert.equal(sheet.match(/<style>[\s\S]*?<\/style>/)?.[0], creationReport.match(/<style>[\s\S]*?<\/style>/)?.[0]);
    assert.doesNotMatch(sheet, /<script/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('record helper groups two sources with the same role into one placeholder', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-playbook-'));
  try {
    const project = join(scratch, 'finished');
    await cp(join(fixtures, 'finished-project-sample'), project, { recursive: true });
    const recorded = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'], { encoding: 'utf8' });
    assert.equal(recorded.status, 0, recorded.stderr);
    const result = await validatePlaybookFiles(join(project, 'planning', 'playbook.json'));
    assert.equal(result.ok, true, result.errors.join('; '));
    const book = JSON.parse(await readFile(join(project, 'planning', 'playbook.json'), 'utf8'));
    const talk = book.placeholders.filter(item => item.role === '話している本人の寄り');
    assert.equal(talk.length, 1);
    assert.equal(talk[0].durationHintSec, 25);
    assert.equal(talk[0].sample, undefined);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
