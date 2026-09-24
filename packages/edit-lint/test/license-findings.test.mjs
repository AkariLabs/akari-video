import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectLicenseFindings } from '../src/license-findings.mjs';
import { lintProject, runCli } from '../src/edit-lint.mjs';

test('the dependency-free license derivation stays byte-for-byte synchronized', async () => {
  const local = await readFile(new URL('../src/license-axes.mjs', import.meta.url), 'utf8');
  const canonical = await readFile(new URL('../../asset-resolver/src/license-axes.mjs', import.meta.url), 'utf8');
  assert.equal(local, canonical);
});

test('only used distinct assets produce nonblocking severities and credit details', async t => {
  const root = await mkdtemp(join(tmpdir(), 'license-findings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const metas = [
    ['one', { commercial: 'prohibited', attributionRequired: false }],
    ['two', { commercial: 'unknown', attributionRequired: null }],
    ['three', { commercial: 'allowed', attributionRequired: true }],
    ['unused', { commercial: 'prohibited', attributionRequired: true }],
  ];
  for (const [id, license] of metas) {
    const dir = join(root, 'assets/still', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'frame.png'), 'fixture');
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ title: `素材 ${id}`, author: '作者', license: { spdx: 'CC-BY-4.0', ...license } }));
  }
  await writeFile(join(root, 'assets/still/three/CREDIT.txt'), '表示する文面\n2 行目');
  const edit = {
    sources: metas.map(([id]) => ({ id, path: `assets/still/${id}/frame.png` })),
    tracks: [{ items: ['one', 'two', 'three', 'one'].map(id => ({ source: { src: id } })) }],
  };
  const findings = await collectLicenseFindings(edit, path => join(root, path));
  assert.deepEqual(findings.map(f => [f.check, f.severity]), [
    ['license.non-commercial', 'warning'], ['license.unknown', 'info'], ['license.attribution', 'info'],
  ]);
  assert.equal(findings[2].details.credit, '表示する文面');
  assert.ok(findings.every(f => f.severity !== 'error'));
});

test('a used personal asset without meta.json produces no license finding', async t => {
  const root = await mkdtemp(join(tmpdir(), 'license-personal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'assets/broll/personal');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'clip.mp4'), 'fixture');
  const edit = {
    sources: [{ id: 'personal', path: 'assets/broll/personal/clip.mp4' }],
    tracks: [{ items: [{ source: { src: 'personal' } }] }],
  };
  assert.deepEqual(await collectLicenseFindings(edit, path => join(root, path)), []);
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ title: 'ライセンス未記入' }));
  assert.deepEqual((await collectLicenseFindings(edit, path => join(root, path))).map(f => f.check), [
    'license.unknown',
  ]);
});

test('--no-reports returns JSON without creating lint reports', async t => {
  const root = await mkdtemp(join(tmpdir(), 'license-no-reports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'assets/broll/personal');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'clip.mp4'), 'fixture');
  await writeFile(join(root, 'edit.json'), JSON.stringify({
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'personal', path: 'assets/broll/personal/clip.mp4' }],
    tracks: [{ id: 'video', lane: 'visual', items: [{
      id: 'one', at: 0, duration: 30, source: { kind: 'media', src: 'personal', in: 0, out: 1 },
    }] }],
  }));
  const lines = [];
  const exitCode = await runCli([root, '--json', '--no-reports'], {
    log: line => lines.push(line), error: line => lines.push(line),
  });
  assert.equal(exitCode, 0, lines.join('\n'));
  const result = JSON.parse(lines.join('\n'));
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.findings.filter(finding => finding.check.startsWith('license.')), []);
  await assert.rejects(readFile(join(root, '.akari/lint.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, '.akari/reports/edit-lint-report.html')), { code: 'ENOENT' });
});

test('edit-lint returns three license checks and still passes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'license-lint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = [
    ['nc', { commercial: 'prohibited', attributionRequired: false }],
    ['unknown', { commercial: 'unknown', attributionRequired: null }],
    ['by', { commercial: 'allowed', attributionRequired: true }],
  ];
  for (const [id, license] of entries) {
    const dir = join(root, 'assets/broll', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'clip.mp4'), 'fixture');
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ title: id, author: '作者', license: { spdx: 'CC-BY-4.0', ...license } }));
  }
  const edit = {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: entries.map(([id]) => ({ id, path: `assets/broll/${id}/clip.mp4` })),
    tracks: [{ id: 'video', lane: 'visual', items: entries.map(([id], index) => ({
      id: `item-${id}`, at: index * 30, duration: 30, source: { kind: 'media', src: id, in: 0, out: 1 },
    })) }],
  };
  await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
  const result = await lintProject(root, { writeReports: false });
  assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
  assert.deepEqual(result.findings.filter(f => f.check.startsWith('license.')).map(f => [f.check, f.severity]), [
    ['license.attribution', 'info'], ['license.non-commercial', 'warning'], ['license.unknown', 'info'],
  ]);
});

test('edit-lint reads license metadata through the library reference fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'license-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const library = join(root, 'home/assets/broll/shared');
  await mkdir(join(project, '.akari'), { recursive: true });
  await mkdir(library, { recursive: true });
  await writeFile(join(library, 'clip.mp4'), 'fixture');
  await writeFile(join(library, 'meta.json'), JSON.stringify({
    title: '共有クリップ', license: { spdx: 'CC-BY-NC-4.0', scope: 'commercial-ok', attribution_required: true },
  }));
  await writeFile(join(project, '.akari/asset-references.json'), JSON.stringify({
    version: 0, references: [{ category: 'broll', id: 'shared' }],
  }));
  await writeFile(join(project, 'edit.json'), JSON.stringify({
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'shared', path: 'assets/broll/shared/clip.mp4' }],
    tracks: [{ id: 'video', lane: 'visual', items: [{
      id: 'one', at: 0, duration: 30, source: { kind: 'media', src: 'shared', in: 0, out: 1 },
    }] }],
  }));
  const result = await lintProject(project, { writeReports: false, env: { AKARI_HOME: join(root, 'home') } });
  assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
  assert.deepEqual(result.findings.filter(f => f.check.startsWith('license.')).map(f => f.check), [
    'license.attribution', 'license.non-commercial',
  ]);
});
