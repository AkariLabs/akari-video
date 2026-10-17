import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPlaybookCommand } from '../src/playbook-command.mjs';
import { runTemplateCommand } from '../src/template-command.mjs';
import { run } from '../src/cli.mjs';
import { runNewCommand } from '../src/new-command.mjs';

const scaffoldModulePath = fileURLToPath(new URL('../../project-scaffold/src/index.mjs', import.meta.url));
test('template CLI exports and new --from places a group at zero', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-template-cli-'));
  try {
    const source = path.join(root, 'source'); const media = path.join(source, 'assets', 'still', 'image');
    await mkdir(media, { recursive: true });
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    await writeFile(path.join(media, 'pixel.png'), bytes);
    await writeFile(path.join(media, 'meta.json'), JSON.stringify({ source: 'own', license: 'CC0-1.0' }));
    await writeFile(path.join(source, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30, width: 1080, height: 1920 },
      sources: [{ id: 'src-1', path: 'assets/still/image/pixel.png' }], tracks: [{ id: 'v', lane: 'visual', items: [
        { id: 'group', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
          { id: 'image', at: 0, duration: 30, source: { kind: 'media', src: 'src-1', in: 0, out: 1 } }
        ] }
      ] }] }));
    const legacyNotice = [];
    const exported = await runPlaybookCommand(['template', source, '--item', 'group', '--id', 'pixel', '--out', path.join(root, 'playbooks')],
      { assets: { scaffoldModulePath }, log: () => {}, error: message => legacyNotice.push(message) });
    assert.equal(exported.exitCode, 0);
    assert.deepEqual(legacyNotice, ['akari playbook template は akari template export の別名です。']);
    const alias = await run(['template', 'export', source, '--item', 'group', '--id', 'pixel', '--out', path.join(root, 'aliases')],
      { assets: { scaffoldModulePath }, log: () => {}, error: message => { throw new Error(message); } });
    assert.equal(alias.exitCode, 0);
    const legacyBook = JSON.parse(await readFile(path.join(exported.dir, 'playbook.json')));
    const aliasBook = JSON.parse(await readFile(path.join(alias.dir, 'playbook.json')));
    delete legacyBook.provenance.recordedAt;
    delete aliasBook.provenance.recordedAt;
    assert.deepEqual(legacyBook, aliasBook);
    const homeForList = path.join(root, 'home-for-list');
    const templateDir = path.join(homeForList, 'playbooks', 'pixel');
    const plainDir = path.join(homeForList, 'playbooks', 'plain');
    await mkdir(path.dirname(templateDir), { recursive: true });
    await cp(exported.dir, templateDir, { recursive: true });
    await mkdir(plainDir);
    const plainBook = JSON.parse(await readFile(path.join(exported.dir, 'playbook.json')));
    delete plainBook.template;
    await writeFile(path.join(plainDir, 'playbook.json'), JSON.stringify({ ...plainBook, id: 'plain', depth: 1 }));
    const listed = [];
    const listResult = await runTemplateCommand(['list', '--json'], { assets: { scaffoldModulePath },
      env: { AKARI_HOME: homeForList }, log: line => listed.push(line), error: message => { throw new Error(message); } });
    assert.equal(listResult.exitCode, 0);
    assert.deepEqual(listResult.entries.map(entry => entry.id), ['pixel']);
    assert.deepEqual(JSON.parse(listed[0]).map(entry => entry.id), ['pixel']);
    await writeFile(path.join(media, 'meta.json'), '{}');
    const errors = [];
    const unknown = await runPlaybookCommand(['template', source, '--item', 'group', '--id', 'unknown', '--out', path.join(root, 'playbooks')],
      { assets: { scaffoldModulePath }, log: () => {}, error: message => errors.push(message) });
    assert.equal(unknown.exitCode, 1);
    assert.match(errors.join(' '), /pixel\.png/);
    const own = await runPlaybookCommand(['template', source, '--item', 'group', '--id', 'own-case', '--out', path.join(root, 'playbooks'), '--license-own', 'CC0-1.0'],
      { assets: { scaffoldModulePath }, log: () => {}, error: message => errors.push(message) });
    assert.equal(own.exitCode, 0);
    await writeFile(path.join(media, 'meta.json'), JSON.stringify({ source: 'site', license: 'CC0-1.0' }));
    const site = await runPlaybookCommand(['template', source, '--item', 'group', '--id', 'site-case', '--out', path.join(root, 'playbooks')],
      { assets: { scaffoldModulePath }, log: () => {}, error: message => errors.push(message) });
    assert.equal(site.exitCode, 1);
    assert.match(errors.join(' '), /site/);
    await writeFile(path.join(media, 'meta.json'), JSON.stringify({ source: 'own', license: 'CC0-1.0' }));
    const home = path.join(root, 'isolated-home');
    const defaultOut = await runPlaybookCommand(['template', source, '--item', 'group', '--id', 'default-out'],
      { assets: { scaffoldModulePath }, env: { AKARI_HOME: home }, log: () => {}, error: message => errors.push(message) });
    assert.equal(defaultOut.dir, path.join(home, 'playbooks', 'default-out'));
    const target = path.join(root, 'target');
    await mkdir(path.join(root, 'unused'));
    const created = await runNewCommand([target, '--from', exported.dir], { assets: { scaffoldModulePath,
      templateDir: path.join(root, 'unused') }, log: () => {}, logError: () => {},
      createProject: async (destination, _template, options) => {
        await mkdir(path.join(destination, '.akari', 'reports'), { recursive: true });
        await writeFile(path.join(destination, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30, width: 1080, height: 1920 }, sources: [], tracks: [] }));
        await writeFile(path.join(destination, '.akari', 'intake.json'), JSON.stringify({ target: { duration_s: null } }));
        await options.beforeCommit(destination);
        return { destination, copy: { copiedFiles: [], skippedSymlinks: [] }, fallback: { writtenFiles: [] }, git: { action: 'skipped' }, reportPath: '' };
      } });
    assert.equal(created.exitCode, 0);
    const edit = JSON.parse(await readFile(path.join(target, 'edit.json')));
    assert.equal(edit.tracks[0].items[0].at, 0);
    assert.equal(edit.tracks[0].items[0].source.kind, 'group');
  } finally { await rm(root, { recursive: true, force: true }); }
});
