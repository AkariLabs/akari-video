import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { applyPlaybookToExisting, createProject, listPlaybooks } from '../src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const sample = join(here, 'fixtures', 'playbook-sample');
const nativeRequire = createRequire(import.meta.url);

function popupService() {
  const source = nativeRequire('node:fs').readFileSync(join(repo, 'apps', 'shell', 'extensions',
    'akari-surfaces', 'src', 'node', 'akari-new-project-service.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const stubs = { '@akari-video/i18n': { t: key => key },
    '@theia/core/shared/inversify': { inject: () => () => {}, injectable: () => value => value },
    '@theia/core/lib/common/uri': { default: class URI {} } };
  const requireModule = name => stubs[name] ?? (name.startsWith('.') ? {} : nativeRequire(name));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(requireModule, module, module.exports);
  return new module.exports.AkariNewProjectServiceImpl();
}
const record = (id, category = 'explainer') => ({ version: 0, kind: 'akari-playbook', id, name: id,
  playbookVersion: 1, depth: 1, category, steps: [], settings: { targetDurationSec: 60 },
  tags: { form: ['vertical'] }, requires: { tools: [] }, license: 'CC0-1.0', provenance: {} });

test('list merges channel and local in popup order, identifies Lab, skips broken records and filters', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-list-'));
  try {
    const home = join(temp, 'home');
    const channel = join(temp, 'root', 'channels', 'main', 'playbooks');
    const kitDir = join(temp, 'kit');
    const lab = join(kitDir, 'playbooks', 'lab-one');
    for (const dir of [join(channel, 'channel-one'), join(home, 'playbooks', 'local-one'),
      join(home, 'playbooks', 'broken'), lab, join(home, 'kits')]) await mkdir(dir, { recursive: true });
    for (const [dir, book] of [[join(channel, 'channel-one'), record('channel-one')],
      [join(home, 'playbooks', 'local-one'), record('local-one', 'cm')], [lab, record('lab-one')]]) {
      await writeFile(join(dir, 'playbook.json'), JSON.stringify(book));
    }
    await writeFile(join(home, 'playbooks', 'broken', 'playbook.json'), '{');
    await symlink(relative(join(home, 'playbooks'), lab), join(home, 'playbooks', 'lab-one'));
    await writeFile(join(home, 'kits', 'installed.json'), JSON.stringify({ schema: 'akari-installed-kits/v0',
      kits: [{ kitDir, playbooks: ['lab-one'] }] }));
    const warnings = [];
    const entries = await listPlaybooks({ akariHome: home, channelDir: channel, onWarning: dir => warnings.push(dir) });
    const previousHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = home;
    try {
      const popup = popupService();
      popup.loadCreatorRootModule = async () => ({ resolveCreatorRoot: async () => ({ rootDir: join(temp, 'root') }) });
      assert.deepEqual(entries.map(item => [item.id, item.source]),
        (await popup.listPlaybooks('main')).map(item => [item.playbook.id, item.source]));
    } finally {
      if (previousHome === undefined) delete process.env.AKARI_HOME;
      else process.env.AKARI_HOME = previousHome;
    }
    assert.deepEqual(entries.map(item => [item.id, item.source]),
      [['channel-one', 'channel'], ['lab-one', 'lab'], ['local-one', 'local']]);
    assert.equal(warnings.length, 1);
    assert.deepEqual((await listPlaybooks({ akariHome: home, channelDir: channel, category: 'cm' })).map(e => e.id), ['local-one']);
    assert.deepEqual((await listPlaybooks({ akariHome: home, channelDir: channel, tag: 'vertical' })).map(e => e.id),
      entries.map(e => e.id));
    assert.deepEqual(Object.keys(entries[0]), ['id', 'name', 'category', 'tags', 'source', 'dir', 'targetDurationSec', 'requires']);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('apply fills only absent settings and roles, preserves cuts, is idempotent and logs one action', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-apply-existing-'));
  try {
    const projectDir = join(temp, 'project');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    const editPath = join(projectDir, 'edit.json');
    const intakePath = join(projectDir, '.akari', 'intake.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    edit.tracks.push({ id: 'existing', name: 'Existing', lane: 'visual', items: [{ id: 'cut-1', at: 15,
      duration: 30, name: '話している本人の寄り', source: { kind: 'group', canvas: {
        origin: 'plan', durationMode: 'fixed', intent: '話している本人の寄り', background: { type: 'none' }
      } }, items: [] }] });
    const originalCut = structuredClone(edit.tracks[0].items[0]);
    await writeFile(editPath, JSON.stringify(edit));
    const intake = JSON.parse(await readFile(intakePath, 'utf8'));
    intake.target.duration_s = 90;
    await writeFile(intakePath, JSON.stringify(intake));
    const first = await applyPlaybookToExisting({ projectDir, playbookDir: sample });
    const after = JSON.parse(await readFile(editPath, 'utf8'));
    assert.deepEqual(after.tracks[0].items[0], originalCut);
    assert.deepEqual(after.output, edit.output);
    assert.equal(after.tracks.find(t => t.id === 'playbook-placeholders').items.length, 1);
    assert.equal(first.placeholdersAdded, 2);
    assert.equal(JSON.parse(await readFile(intakePath, 'utf8')).target.duration_s, 90);
    assert.equal((await readdir(join(projectDir, '.akari', 'events'))).filter(name => name.includes('act-')).length, 1);
    assert.match(await readFile(first.reportPath, 'utf8'), /既存のカット/);
    const second = await applyPlaybookToExisting({ projectDir, playbookDir: sample });
    assert.equal(second.placeholdersAdded, 0);
    assert.equal(second.editChanged, false);
    assert.equal((await readdir(join(projectDir, '.akari', 'events'))).filter(name => name.includes('act-')).length, 1);
    assert.match(second.playbookMdPath, /playbook-kaisetsu-vertical-60s/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('dry-run makes no writes; beats append without replacing existing lines', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-apply-dry-'));
  try {
    const projectDir = join(temp, 'project');
    const playbookDir = join(temp, 'book');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    await cp(sample, playbookDir, { recursive: true });
    const book = JSON.parse(await readFile(join(playbookDir, 'playbook.json'), 'utf8'));
    book.beats = [{ id: 'opening', at: 0, duration: 4, title: 'Opening' }];
    await writeFile(join(playbookDir, 'playbook.json'), JSON.stringify(book));
    const scriptPath = join(projectDir, 'planning', 'script.json');
    await writeFile(scriptPath, JSON.stringify({ version: 0, kind: 'akari-script',
      lines: [{ id: 'user-1', kind: 'memo', at: 1, text: 'keep', author: 'user' }] }));
    const before = await Promise.all(['edit.json', '.akari/intake.json', 'planning/script.json'].map(file => readFile(join(projectDir, file), 'utf8')));
    await applyPlaybookToExisting({ projectDir, playbookDir, dryRun: true });
    assert.deepEqual(await Promise.all(['edit.json', '.akari/intake.json', 'planning/script.json'].map(file => readFile(join(projectDir, file), 'utf8'))), before);
    assert.equal((await readdir(join(projectDir, 'planning'))).some(name => name.startsWith('playbook')), false);
    await applyPlaybookToExisting({ projectDir, playbookDir });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    assert.deepEqual([edit.output.width, edit.output.height], [1080, 1920]);
    await applyPlaybookToExisting({ projectDir, playbookDir });
    const script = JSON.parse(await readFile(scriptPath, 'utf8'));
    assert.deepEqual(script.lines.map(line => line.id), ['user-1', 'p-opening']);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('empty target duration is filled and a reserved placeholder track id gets a suffix', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'akari-apply-suffix-'));
  try {
    const projectDir = join(temp, 'project');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    const editPath = join(projectDir, 'edit.json');
    const edit = JSON.parse(await readFile(editPath, 'utf8'));
    edit.output = { ...edit.output, width: 1000, height: 1000, fps: 24 };
    edit.tracks.push({ id: 'playbook-placeholders', name: 'Reserved', lane: 'visual', items: [] });
    await writeFile(editPath, JSON.stringify(edit));
    const intakePath = join(projectDir, '.akari', 'intake.json');
    const intake = JSON.parse(await readFile(intakePath, 'utf8'));
    intake.target.duration_s = null;
    await writeFile(intakePath, JSON.stringify(intake));
    await applyPlaybookToExisting({ projectDir, playbookDir: sample });
    const after = JSON.parse(await readFile(editPath, 'utf8'));
    assert.ok(after.tracks.some(track => track.id === 'playbook-placeholders-2'));
    assert.deepEqual(after.output, edit.output);
    assert.equal(JSON.parse(await readFile(intakePath, 'utf8')).target.duration_s, 60);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
