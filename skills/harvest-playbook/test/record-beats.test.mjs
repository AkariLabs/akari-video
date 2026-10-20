import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePlaybookFiles } from '../../../packages/schemas/validate-playbook.mjs';
import { recordPlaybook } from '../bin/record-playbook.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = join(repo, 'packages', 'project-scaffold', 'test', 'fixtures', 'finished-project-sample');

test('harvest-playbook prefers planned lines and falls back to cut boundaries and plan headings', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-beats-'));
  try {
    const withScript = join(scratch, 'script');
    await cp(fixture, withScript, { recursive: true });
    await mkdir(join(withScript, 'planning'), { recursive: true });
    await writeFile(join(withScript, 'planning', 'script.json'), JSON.stringify({ version: 0, kind: 'akari-script', lines: [
      { id: 'm-1', kind: 'memo', at: 1, text: 'メモ' },
      { id: 'p-intro', kind: 'plan', at: 0, duration: 10, text: '導入: 結論', beat: 'intro' },
      { id: 'p-body', kind: 'plan', at: 10, duration: 15, text: '本題', beat: 'body' }
    ] }));
    const fromScript = await recordPlaybook(withScript, { name: '台本あり', category: 'explainer' });
    assert.deepEqual(fromScript.beats.map(beat => [beat.id, beat.at, beat.duration, beat.title, beat.note]), [
      ['intro', 0, 10, '導入', '結論'], ['body', 10, 15, '本題', undefined]
    ]);
    assert.match(await readFile(join(withScript, 'planning', 'playbook.md'), 'utf8'), /## 必要な素材（仮枠）[\s\S]*## 内訳[\s\S]*## 使った部品/);
    assert.equal((await validatePlaybookFiles(join(withScript, 'planning', 'playbook.json'))).ok, true);

    const withoutScript = join(scratch, 'cuts');
    await cp(fixture, withoutScript, { recursive: true });
    await mkdir(join(withoutScript, 'planning'), { recursive: true });
    await writeFile(join(withoutScript, 'planning', 'plan.md'), '## 00:00 導入\n\n## 00:10 本題\n');
    const fromCuts = await recordPlaybook(withoutScript, { name: 'カットから', category: 'explainer' });
    assert.deepEqual(fromCuts.beats.map(beat => [beat.at, beat.duration, beat.title]), [
      [0, 10, '導入'], [10, 15, '本題']
    ]);
    assert.equal((await validatePlaybookFiles(join(withoutScript, 'planning', 'playbook.json'))).ok, true);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('overlay tracks do not add cut-based beats', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-overlays-'));
  try {
    const project = join(scratch, 'finished');
    await cp(fixture, project, { recursive: true });
    const editPath = join(project, 'edit.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    edit.tracks.unshift({ id: 'overlays', lane: 'visual', items: [
      { id: 'o1', at: 0, duration: 100, source: { kind: 'media', src: 'talk-a' } },
      { id: 'o2', at: 100, duration: 100, source: { kind: 'group' } },
      { id: 'o3', at: 200, duration: 100, source: { kind: 'group' } }
    ] });
    await writeFile(editPath, JSON.stringify(edit));
    const book = await recordPlaybook(project, { name: '重ねあり', category: 'explainer' });
    assert.deepEqual(book.beats.map(beat => [beat.at, beat.duration]), [[0, 10], [10, 15]]);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('timed chapter headings combine cuts and use the longest visible role', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-chapters-'));
  try {
    const project = join(scratch, 'finished');
    await cp(fixture, project, { recursive: true });
    await mkdir(join(project, 'planning'), { recursive: true });
    const editPath = join(project, 'edit.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    edit.sources.push({ id: 'screen', path: 'assets/screen.mp4' });
    edit.tracks.find(track => track.id === 'v1').items = [
      { id: 'a', at: 0, duration: 150, source: { kind: 'media', src: 'talk-a' } },
      { id: 'b', at: 150, duration: 150, source: { kind: 'media', src: 'screen' } },
      { id: 'c', at: 300, duration: 150, source: { kind: 'media', src: 'screen' } },
      { id: 'd', at: 450, duration: 300, source: { kind: 'media', src: 'talk-b' } }
    ];
    await writeFile(editPath, JSON.stringify(edit));
    const analysisPath = join(project, 'analysis.json');
    const analysis = JSON.parse(await readFile(analysisPath, 'utf8'));
    analysis.sources.push({ sourceId: 'screen', role: '画面収録', kind: 'video', source: 'own' });
    await writeFile(analysisPath, JSON.stringify(analysis));
    await writeFile(join(project, 'planning', 'plan.md'), '## 00:00 導入\n\n## 00:12 本題\n');
    const book = await recordPlaybook(project, { name: '章あり', category: 'explainer' });
    const byRole = new Map(book.placeholders.map(item => [item.role, item.id]));
    assert.deepEqual(book.beats.map(beat => [beat.at, beat.duration, beat.title, beat.placeholder]), [
      [0, 12, '導入', byRole.get('画面収録')],
      [12, 13, '本題', byRole.get('話している本人の寄り')]
    ]);
    assert.equal((await validatePlaybookFiles(join(project, 'planning', 'playbook.json'))).ok, true);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('harvest-playbook omits beats when no plan, heading, or visual cut yields one', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-no-beats-'));
  try {
    const project = join(scratch, 'finished');
    await cp(fixture, project, { recursive: true });
    const editPath = join(project, 'edit.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    edit.tracks.find(track => track.id === 'v1').items = [];
    await writeFile(editPath, JSON.stringify(edit));
    const book = await recordPlaybook(project, { name: '内訳なし', category: 'explainer' });
    assert.equal(Object.hasOwn(book, 'beats'), false);
    const saved = JSON.parse(await readFile(join(project, 'planning', 'playbook.json'), 'utf8'));
    assert.equal(Object.hasOwn(saved, 'beats'), false);
    assert.match(await readFile(join(project, 'planning', 'playbook.md'), 'utf8'), /## 内訳\n\nなし\n\n## 使った部品/);
    assert.equal((await validatePlaybookFiles(join(project, 'planning', 'playbook.json'))).ok, true);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
