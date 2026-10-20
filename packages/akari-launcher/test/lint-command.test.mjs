import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { setLanguage } from '../../i18n/index.mjs';
import { lintHelp, runLintCommand } from '../src/lint-command.mjs';

const EDIT_LINT = fileURLToPath(new URL('../../edit-lint/bin/edit-lint.mjs', import.meta.url));
const HOME = await mkdtemp(join(tmpdir(), 'akari-lint-home-'));
after(() => rm(HOME, { recursive: true, force: true }));
const CHILD_ENV = { ...process.env, AKARI_HOME: HOME, AKARI_LANG: 'ja' };

const EDIT = {
  version: 2,
  output: { width: 320, height: 180, fps: 30 },
  sources: [],
  tracks: [
    {
      id: 't-audio',
      lane: 'audio',
      items: [{ id: 'title', at: 0, duration: 30, source: { kind: 'html', path: 'overlays/t.html' } }],
    },
    {
      id: 't-visual',
      lane: 'visual',
      items: [
        { id: 'b', at: 60, duration: 30, source: { kind: 'html', path: 'overlays/b.html' } },
        { id: 'a', at: 0, duration: 30, source: { kind: 'html', path: 'overlays/a.html' } },
      ],
    },
    { id: 't-empty', lane: 'visual', items: [] },
  ],
};

async function makeProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'akari-lint-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.akari'), { recursive: true });
  await mkdir(join(root, 'overlays'), { recursive: true });
  await writeFile(join(root, 'edit.json'), `${JSON.stringify(EDIT, null, 2)}\n`);
  for (const name of ['a', 'b', 't']) await writeFile(join(root, 'overlays', `${name}.html`), '<div></div>\n');
  return root;
}

function fakeSpawn(status = 0) {
  const calls = [];
  const spawn = (execPath, args, options) => {
    calls.push({ execPath, args, options });
    return { status };
  };
  return { calls, spawn };
}

test('help documents the read-only default and --fix', () => {
  setLanguage('ja');
  try {
    const text = lintHelp().join('\n');
    assert.match(text, /akari lint \[<project>\] \[--fix\]/u);
    assert.match(text, /既定ではファイルを書き換えず/u);
    assert.match(text, /--fix/u);
  } finally {
    setLanguage(undefined);
  }
});

test('the default run is read-only: no writes and a --fix notice', async (t) => {
  const root = await makeProject(t);
  const before = {
    text: await readFile(join(root, 'edit.json'), 'utf8'),
    mtime: (await stat(join(root, 'edit.json'))).mtimeMs,
  };

  const result = await runLintCommand([root], {
    editLintPath: EDIT_LINT,
    stdio: 'pipe',
    env: CHILD_ENV,
  });
  const stdout = result.stdout.toString('utf8');

  assert.equal(result.exitCode, 1);
  assert.match(stdout, /`--fix` で直せます/u);
  assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), before.text);
  assert.equal((await stat(join(root, 'edit.json'))).mtimeMs, before.mtime);
  assert.equal(existsSync(join(root, '.akari', 'lint.json')), false);
});

test('--fix rewrites the project and prints the change summary first', async (t) => {
  const root = await makeProject(t);
  const before = await readFile(join(root, 'edit.json'), 'utf8');

  const result = await runLintCommand([root, '--fix'], {
    editLintPath: EDIT_LINT,
    stdio: 'pipe',
    env: CHILD_ENV,
  });
  const stdout = result.stdout.toString('utf8');
  const lines = stdout.split('\n');

  assert.equal(result.exitCode, 0);
  assert.match(lines[0], /^修正しました（--fix）: 1 ファイル$/u);
  assert.match(stdout, /^--- a\/edit\.json$/mu);
  assert.match(stdout, /バックアップ: \.akari\/work\/tmp\/lint-fix-/u);
  assert.notEqual(await readFile(join(root, 'edit.json'), 'utf8'), before);
  assert.equal(existsSync(join(root, '.akari', 'lint.json')), true);
});

test('forwards the project, flags and --no-reports to edit-lint', async () => {
  const cases = [
    { argv: [], expected: [EDIT_LINT, '.', '--no-reports'] },
    { argv: ['/tmp/some-project'], expected: [EDIT_LINT, '/tmp/some-project', '--no-reports'] },
    { argv: ['--fix'], expected: [EDIT_LINT, '--fix', '.'] },
    { argv: ['--engine', 'gpu'], expected: [EDIT_LINT, '--engine', 'gpu', '.', '--no-reports'] },
    { argv: ['--engine=osr', '/tmp/p', '--media'], expected: [EDIT_LINT, '--engine=osr', '/tmp/p', '--media', '--no-reports'] },
  ];
  for (const entry of cases) {
    const { calls, spawn } = fakeSpawn(0);
    const result = await runLintCommand(entry.argv, { editLintPath: EDIT_LINT, spawn });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls[0].args, entry.expected);
    assert.equal(calls[0].execPath, process.execPath);
  }
});

test('propagates the child exit code and reports a missing edit-lint', async () => {
  const failed = fakeSpawn(1);
  assert.equal((await runLintCommand(['.', '--fix'], { editLintPath: EDIT_LINT, spawn: failed.spawn })).exitCode, 1);
  const unknown = fakeSpawn(null);
  assert.equal((await runLintCommand(['.'], { editLintPath: EDIT_LINT, spawn: unknown.spawn })).exitCode, 2);

  const errors = [];
  const result = await runLintCommand(['.'], {
    editLintPath: join(tmpdir(), 'missing-edit-lint.mjs'),
    error: line => errors.push(line),
  });
  assert.equal(result.exitCode, 2);
  assert.match(errors.join('\n'), /edit-lint が見つかりません/u);
});
