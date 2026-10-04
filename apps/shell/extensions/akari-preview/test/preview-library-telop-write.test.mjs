import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { materializedFragmentPlan, replaceFragmentReference,
  patchFragmentSourceText, assertNoSessionAssetUrl, withoutFragmentRootTiming } from '../../../../../packages/overlay-runtime/src/fragment-source-write.mjs';
import { resolvePreviewItemWrite } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';
import { readHandlerSource } from './helpers/handler-source.mjs';
import { lintProject } from '../../../../../packages/edit-lint/src/edit-lint.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { serializeEdit } = require('../../../../../packages/edit-store/lib/canonical.js');
const source = readHandlerSource();
const start = source.search(/^    protected async handleOverlayWrite\(/mu);
const end = source.indexOf('\n    }', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`class Host { ${source.slice(start, end + 6)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Host = vm.runInNewContext(`${code}; Host`, {
  resolvePreviewItemWrite, materializedFragmentPlan, replaceFragmentReference, serializeEdit,
  patchFragmentSourceText, assertNoSessionAssetUrl, withoutFragmentRootTiming,
  BinaryBuffer: { fromString: value => value }, crypto: { randomUUID: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, Error
});
const libraryPath = 'assets/overlay/title/fragment.html';
const original = '<div>元の文字</div>';
const edit = JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [],
  tracks: [{ id: 'visual', lane: 'visual', items: [
  { id: 'first', at: 0, duration: 5, source: { kind: 'html', path: libraryPath } },
  { id: 'second', at: 5, duration: 5, source: { kind: 'html', path: libraryPath } },
] }] });
const uri = value => ({ toString: () => value, resolve: child => uri(`${value}/${child}`),
  get parent() { return uri(value.slice(0, value.lastIndexOf('/'))); } });

function fixture({ library = true } = {}) {
  const files = new Map([
    ['file:///project/edit.json', edit],
    ...(library ? [['file:///library/assets/overlay/title/fragment.html', original],
      ['file:///library/assets/overlay/title/picture.png', 'image']] : []),
  ]);
  const host = new Host();
  const responses = [];
  host.readText = async resource => {
    if (!files.has(resource.toString())) throw new Error(`見つかりません: ${resource}`);
    return files.get(resource.toString());
  };
  host.resolveEditAssetUri = async path => uri(`file:///library/${path}`);
  host.recentWrites = new Map();
  host.previewService = { lintEditCandidate: async () => ({ pass: true }) };
  host.fileService = {
    exists: async resource => files.has(resource.toString()),
    createFolder: async () => {},
    copy: async (from, to) => {
      for (const [key, value] of [...files]) {
        if (key.startsWith(`${from.toString()}/`)) files.set(to.toString() + key.slice(from.toString().length), value);
      }
    },
    writeFile: async (resource, value) => files.set(resource.toString(), value),
    delete: async resource => {
      for (const key of files.keys()) if (key.startsWith(resource.toString())) files.delete(key);
    },
  };
  const widget = { akariPreviewEditUri: uri('file:///project/edit.json'),
    sendMessage: response => responses.push(response) };
  return { files, host, widget, responses };
}

test('H はライブラリ断片のフォルダを item ごとに写し片方だけの文字と参照を変更する', async () => {
  const { files, host, widget, responses } = fixture();
  await host.handleOverlayWrite(widget, { requestId: 'first', overlayId: 'first',
    patch: { html: '<div>新しい文字</div>' } });
  assert.equal(responses[0].ok, true, responses[0].error);
  const saved = JSON.parse(files.get('file:///project/edit.json'));
  const copied = saved.tracks[0].items[0].source.path;
  assert.equal(copied, 'assets/overlay/title-edit-first-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/fragment.html');
  assert.equal(saved.tracks[0].items[1].source.path, libraryPath);
  assert.equal(files.get(`file:///project/${copied}`), '<div>新しい文字</div>');
  assert.equal(files.get(`file:///project/${copied.replace('fragment.html', 'picture.png')}`), 'image');
  assert.equal(files.get('file:///library/assets/overlay/title/fragment.html'), original);
  await host.handleOverlayWrite(widget, { requestId: 'second', overlayId: 'first',
    patch: { html: '<div>さらに変更</div>' } });
  assert.equal(responses[1].ok, true, responses[1].error);
  assert.equal(files.get(`file:///project/${copied}`), '<div>さらに変更</div>');
  assert.equal(JSON.parse(files.get('file:///project/edit.json')).tracks[0].items[0].source.path, copied);
});

test('H はライブラリに実体が無ければ理由を返し何も書かない', async () => {
  const { files, host, widget, responses } = fixture({ library: false });
  await host.handleOverlayWrite(widget, { requestId: 'missing', overlayId: 'first',
    patch: { html: '<div>新しい文字</div>' } });
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /ライブラリに断片の実体がありません/u);
  assert.equal(files.size, 1);
  assert.equal(files.get('file:///project/edit.json'), edit);
});

test('H は文字が同じならライブラリ参照を実体化しない', async () => {
  const { files, host, widget, responses } = fixture();
  await host.handleOverlayWrite(widget, { requestId: 'unchanged', overlayId: 'first',
    patch: { html: original } });
  assert.equal(responses[0].ok, true, responses[0].error);
  assert.equal(files.size, 3);
  assert.equal(files.get('file:///project/edit.json'), edit);
});

test('H は実体化後の lint 失敗で写しと参照を残さない', async () => {
  const { files, host, widget, responses } = fixture();
  host.previewService.lintEditCandidate = async () => ({ pass: false, errors: ['lint failed'] });
  await host.handleOverlayWrite(widget, { requestId: 'lint', overlayId: 'first',
    patch: { html: '<div>新しい文字</div>' } });
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].error, 'lint failed');
  assert.equal(files.size, 3);
  assert.equal(files.get('file:///project/edit.json'), edit);
  assert.equal(files.get('file:///library/assets/overlay/title/fragment.html'), original);
});

test('H は長さが違うライブラリ断片を実体化して実物の edit-lint を通す', async t => {
  const project = await mkdtemp(path.join(tmpdir(), 'preview-library-telop-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const libraryHome = path.join(project, 'library-home');
  const sourceDir = path.join(libraryHome, 'assets/overlay/title');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  const libraryFile = path.join(sourceDir, 'fragment.html');
  const libraryHtml = '<div data-start="0" data-duration="6">元の文字</div>';
  await writeFile(libraryFile, libraryHtml);
  await writeFile(path.join(project, '.akari/asset-references.json'),
    JSON.stringify({ version: 0, references: [{ category: 'overlay', id: 'title' }] }));
  const editFile = path.join(project, 'edit.json');
  await writeFile(editFile, JSON.stringify({ version: 2,
    output: { width: 320, height: 180, fps: 30 }, sources: [],
    tracks: [{ id: 'visual', lane: 'visual', items: [
      { id: 'first', at: 0, duration: 300, source: { kind: 'html', path: libraryPath } },
    ] }] }));
  const lint = () => lintProject(project, { writeReports: false,
    env: { ...process.env, AKARI_HOME: libraryHome } });
  assert.deepEqual((await lint()).findings.filter(finding => finding.severity === 'error'), []);
  const host = new Host();
  const toPath = resource => fileURLToPath(resource.toString());
  host.readText = resource => readFile(toPath(resource), 'utf8');
  host.resolveEditAssetUri = async () => uri(pathToFileURL(libraryFile).toString());
  host.recentWrites = new Map();
  host.fileService = {
    exists: async resource => stat(toPath(resource)).then(() => true, () => false),
    createFolder: async resource => mkdir(toPath(resource), { recursive: true }),
    copy: async (from, to) => cp(toPath(from), toPath(to), { recursive: true, errorOnExist: true }),
    writeFile: async (resource, value) => writeFile(toPath(resource), value),
    delete: async resource => rm(toPath(resource), { recursive: true, force: true }),
  };
  let lintCalls = 0;
  host.previewService = { lintEditCandidate: async ({ candidateText }) => {
    lintCalls++;
    const before = await readFile(editFile, 'utf8');
    await writeFile(editFile, candidateText);
    try {
      const report = await lint();
      const errors = report.findings.filter(finding => finding.severity === 'error');
      return { pass: errors.length === 0, errors: errors.map(finding => finding.message) };
    } finally { await writeFile(editFile, before); }
  } };
  const responses = [];
  const widget = { akariPreviewEditUri: uri(pathToFileURL(editFile).toString()),
    sendMessage: response => responses.push(response) };
  await host.handleOverlayWrite(widget, { requestId: 'real-lint', overlayId: 'first',
    patch: { html: '<div data-start="0" data-duration="6">新しい文字</div>' } });
  assert.equal(responses[0].ok, true, responses[0].error);
  assert.equal(lintCalls, 1);
  const copied = JSON.parse(await readFile(editFile, 'utf8')).tracks[0].items[0].source.path;
  assert.notEqual(copied, libraryPath);
  assert.equal(await readFile(path.join(project, copied), 'utf8'), '<div>新しい文字</div>');
  assert.equal(await readFile(libraryFile, 'utf8'), libraryHtml);
  assert.deepEqual((await lint()).findings.filter(finding => finding.severity === 'error'), []);
});
