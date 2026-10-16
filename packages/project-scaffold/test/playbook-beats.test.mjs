import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateScript } from '../../schemas/validate-script.mjs';
import { applyPlaybook, createProject } from '../src/index.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'playbook-sample');

test('beats create timed empty canvases, replace only playbook lines, and appear on the sheet', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-beats-'));
  try {
    const projectDir = join(scratch, 'project');
    const playbookDir = join(scratch, 'playbook');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    await cp(fixture, playbookDir, { recursive: true });
    const book = JSON.parse(await readFile(join(playbookDir, 'playbook.json'), 'utf8'));
    book.beats = [
      { id: 'end', at: 45.5, duration: 14.5, title: '締め' },
      { id: 'hook', at: 0, duration: 3, title: 'つかみ', note: '結論を先に', placeholder: 'talking-head' },
      { id: 'body', at: 3, duration: 42.5, title: '本題', placeholder: 'screen' }
    ];
    await writeFile(join(playbookDir, 'playbook.json'), `${JSON.stringify(book)}\n`);
    await writeFile(join(playbookDir, 'playbook.md'), `${await readFile(join(playbookDir, 'playbook.md'), 'utf8')}\n## 内訳\n`);
    await writeFile(join(projectDir, 'planning', 'script.json'), JSON.stringify({ version: 0, kind: 'akari-script', lines: [
      { id: 'p-hook', kind: 'memo', at: 1, text: '自分のメモ', author: 'user' },
      { id: 'old', kind: 'plan', at: 2, text: '旧予定', author: 'playbook' }
    ] }));
    const result = await applyPlaybook({ projectDir, playbookDir, hasTool: async () => true });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    const visual = edit.tracks.find(track => track.id === 'playbook-placeholders');
    assert.equal(visual.items.length, book.beats.length);
    assert.deepEqual(visual.items.map(item => [item.at, item.duration, item.name, item.source.canvas.intent]), [
      [0, 90, 'つかみ', '結論を先に'], [90, 1275, '本題', '本題'], [1365, 435, '締め', '締め']
    ]);
    assert.equal(edit.tracks.find(track => track.id === 'playbook-placeholders-audio').items[0].duration, 1800);
    const script = JSON.parse(await readFile(join(projectDir, 'planning', 'script.json'), 'utf8'));
    assert.equal(validateScript(script).ok, true);
    assert.equal(script.lines.filter(line => line.kind === 'plan').length, book.beats.length);
    assert.equal(script.lines.find(line => line.id === 'old'), undefined);
    assert.equal(script.lines.find(line => line.id === 'p-hook').text, '自分のメモ');
    assert.deepEqual(script.lines.filter(line => line.author === 'playbook').map(line => [line.beat, line.text, line.placeholder]), [
      ['hook', 'つかみ: 結論を先に', 'talking-head'], ['body', '本題', 'screen'], ['end', '締め', undefined]
    ]);
    assert.match(await readFile(result.sheetPath, 'utf8'), /内訳[\s\S]*つかみ[\s\S]*結論を先に/);
    const lint = spawnSync(process.execPath, [join(repo, 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'), projectDir, '--json'], { encoding: 'utf8' });
    // Audio placeholders stay on the visual lane until edit-lint's lane-source rule admits planned groups on audio lanes.
    assert.doesNotMatch(lint.stdout, /v2\.lane-source/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('a playbook without beats keeps role placeholders and does not write script.json', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-no-beats-'));
  try {
    const projectDir = join(scratch, 'project');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    await applyPlaybook({ projectDir, playbookDir: fixture, hasTool: async () => true });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    assert.deepEqual(edit.tracks[0].items.map(item => item.id), ['playbook-talking-head', 'playbook-screen']);
    await assert.rejects(readFile(join(projectDir, 'planning', 'script.json')), { code: 'ENOENT' });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('an empty beats array keeps role placeholders without writing script.json or a sheet row', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-empty-beats-'));
  try {
    const projectDir = join(scratch, 'project');
    const playbookDir = join(scratch, 'playbook');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    await cp(fixture, playbookDir, { recursive: true });
    const book = JSON.parse(await readFile(join(playbookDir, 'playbook.json'), 'utf8'));
    book.beats = [];
    await writeFile(join(playbookDir, 'playbook.json'), `${JSON.stringify(book)}\n`);
    const result = await applyPlaybook({ projectDir, playbookDir, hasTool: async () => true });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    assert.deepEqual(edit.tracks.find(track => track.id === 'playbook-placeholders').items.map(item => item.id),
      ['playbook-talking-head', 'playbook-screen']);
    assert.equal(result.placeholdersAdded, book.placeholders.length);
    await assert.rejects(readFile(join(projectDir, 'planning', 'script.json')), { code: 'ENOENT' });
    assert.doesNotMatch(await readFile(result.sheetPath, 'utf8'), /<dt>内訳<\/dt>/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('fractional-second beats do not overlap after rounding to frames', async () => {
  const { mkdtemp, cp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createProject, applyPlaybook } = await import('../src/index.mjs');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const scratch = await mkdtemp(join(tmpdir(), 'akari-beats-round-'));
  try {
    const pb = join(scratch, 'pb');
    await cp(join(here, 'fixtures', 'playbook-sample'), pb, { recursive: true });
    const book = JSON.parse(await readFile(join(pb, 'playbook.json'), 'utf8'));
    book.settings = { ...book.settings, fps: 24, targetDurationSec: 180 };
    book.beats = [
      { id: 'h', at: 0, duration: 3, title: 'h', placeholder: 'talking-head' },
      { id: 'b1', at: 3, duration: 47.2, title: 'b1', placeholder: 'talking-head' },
      { id: 'b2', at: 50.2, duration: 94.4, title: 'b2', placeholder: 'screen' },
      { id: 'b3', at: 144.6, duration: 35.4, title: 'b3', placeholder: 'screen' }
    ];
    await writeFile(join(pb, 'playbook.json'), JSON.stringify(book, null, 2));
    const projectDir = join(scratch, 'p');
    await createProject(projectDir, join(here, '..', '..', '..', 'templates', 'project-default'));
    await applyPlaybook({ projectDir, playbookDir: pb, hasTool: async () => true });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    const items = edit.tracks.find(track => track.id === 'playbook-placeholders').items;
    assert.equal(items.length, 4);
    for (let i = 1; i < items.length; i += 1) assert.ok(items[i].at >= items[i - 1].at + items[i - 1].duration, `overlap at ${i}`);
    assert.equal(items.at(-1).at + items.at(-1).duration, 180 * 24);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
