import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { setLanguage } from '../../i18n/index.mjs';
import { parseArguments, runCli } from '../src/edit-lint.mjs';
import { unifiedDiff } from '../src/fix.mjs';

const HOME = await mkdtemp(join(tmpdir(), 'edit-lint-fix-home-'));
const previousHome = process.env.AKARI_HOME;
process.env.AKARI_HOME = HOME;
after(async () => {
  if (previousHome === undefined) delete process.env.AKARI_HOME;
  else process.env.AKARI_HOME = previousHome;
  await rm(HOME, { recursive: true, force: true });
});

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

function collector() {
  const out = [];
  const err = [];
  return { out, err, io: { log: line => out.push(line), error: line => err.push(line) } };
}

async function makeProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-fix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.akari'), { recursive: true });
  await mkdir(join(root, 'overlays'), { recursive: true });
  await writeFile(join(root, 'edit.json'), `${JSON.stringify(EDIT, null, 2)}\n`);
  for (const name of ['a', 'b', 't']) await writeFile(join(root, 'overlays', `${name}.html`), '<div></div>\n');
  return root;
}

async function snapshot(root) {
  const file = join(root, 'edit.json');
  return {
    text: await readFile(file, 'utf8'),
    mtime: (await stat(file)).mtimeMs,
    overlay: await readFile(join(root, 'overlays', 'a.html'), 'utf8'),
  };
}

test('without --fix nothing is rewritten and the fixable findings are announced', async (t) => {
  setLanguage('ja');
  t.after(() => setLanguage(undefined));
  const root = await makeProject(t);
  const before = await snapshot(root);
  const { out, io } = collector();

  const code = await runCli([root, '--no-reports'], io);

  assert.equal(code, 1);
  assert.match(out.join('\n'), /`--fix` で直せます: \d+ 件/u);
  assert.match(out.join('\n'), /トラックを移動/u);
  const after = await snapshot(root);
  assert.equal(after.text, before.text);
  assert.equal(after.mtime, before.mtime);
  assert.equal(after.overlay, before.overlay);
  assert.equal(existsSync(join(root, '.akari', 'lint.json')), false);
});

test('--fix writes the fix, prints changed files, diff and backup first, then re-checks', async (t) => {
  setLanguage('ja');
  t.after(() => setLanguage(undefined));
  const root = await makeProject(t);
  const before = await snapshot(root);
  const { out, io } = collector();

  const code = await runCli([root, '--fix'], io);
  const text = out.join('\n');

  assert.equal(code, 0);
  assert.match(out[0], /^修正しました（--fix）: 1 ファイル$/u);
  assert.match(text, /変更したファイル:/u);
  assert.match(text, /\n  M edit\.json\n/u);
  assert.match(text, /差分:/u);
  assert.match(text, /^--- a\/edit\.json$/mu);
  assert.match(text, /^\+\+\+ b\/edit\.json$/mu);
  assert.match(text, /バックアップ: \.akari\/work\/tmp\/lint-fix-/u);
  assert.match(text, /PASS:/u);

  const fixed = await readFile(join(root, 'edit.json'), 'utf8');
  assert.notEqual(fixed, before.text);
  const backup = /バックアップ: (\S+)/u.exec(text)[1];
  assert.equal(await readFile(join(root, backup, 'edit.json'), 'utf8'), before.text);
  const lint = JSON.parse(await readFile(join(root, '.akari', 'lint.json'), 'utf8'));
  assert.equal(lint.verdict, 'pass');
});

test('--fix is idempotent and reports when nothing is fixable', async (t) => {
  setLanguage('ja');
  t.after(() => setLanguage(undefined));
  const root = await makeProject(t);
  assert.equal(await runCli([root, '--fix'], collector().io), 0);
  const fixed = await readFile(join(root, 'edit.json'), 'utf8');

  const { out, io } = collector();
  assert.equal(await runCli([root, '--fix'], io), 0);
  assert.match(out.join('\n'), /自動修正できる指摘はありません/u);
  assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), fixed);
});

test('--help documents --fix and the read-only default', async () => {
  setLanguage('ja');
  try {
    const { out, io } = collector();
    assert.equal(await runCli(['--help'], io), 0);
    assert.match(out.join('\n'), /\[--fix\]/u);
    assert.match(out.join('\n'), /never rewritten/u);
  } finally {
    setLanguage(undefined);
  }
});

test('--fix and --json keep the machine output on stdout', async (t) => {
  setLanguage('ja');
  t.after(() => setLanguage(undefined));
  const root = await makeProject(t);
  const { out, err, io } = collector();

  assert.equal(await runCli([root, '--fix', '--json'], io), 0);
  const parsed = JSON.parse(out.join('\n'));
  assert.equal(parsed.verdict, 'pass');
  assert.match(err.join('\n'), /修正しました（--fix）/u);
});

test('parseArguments accepts --fix', () => {
  const options = parseArguments(['.', '--fix']);
  assert.equal(options.fix, true);
  assert.equal(options.input, '.');
});

test('unifiedDiff truncates long bodies and counts omitted lines', () => {
  const before = Array.from({ length: 30 }, (_, index) => `old-${index}`).join('\n');
  const after = Array.from({ length: 30 }, (_, index) => `new-${index}`).join('\n');
  const diff = unifiedDiff('edit.json', before, after, { maxLines: 10 });
  assert.equal(diff.lines.length, 13);
  assert.equal(diff.lines[0], '--- a/edit.json');
  assert.equal(diff.lines[1], '+++ b/edit.json');
  assert.match(diff.lines[2], /^@@ /u);
  assert.equal(diff.omitted, 50);
});
