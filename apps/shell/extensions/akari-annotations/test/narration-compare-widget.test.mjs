import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { NarrationCliManager } from '../lib/node/narration-cli.js';
import { aiNarrationSourcePath, placeAiNarration, planAiNarrationPlacement } from '../lib/common/ai-narration-placement.js';
import { chooseAiNarrationVoice, initialAiNarrationState, narrationBatchConfirm,
  narrationRowEstimate, orderedNarrationEngines } from '../lib/browser/inspector/ai-narration-panel.js';

const engines = [
  { id: 'voicevox', label: 'VOICEVOX', place: 'local', availability: { state: 'available' }, price: { value: 0, unit: 'usd_per_1000_chars' } },
  { id: 'irodori', label: '彩', place: 'network', availability: { state: 'available' }, price: { value: 0, unit: 'usd_per_1000_chars' } },
  { id: 'gemini-tts', label: 'Gemini', place: 'cloud', availability: { state: 'available' }, price: { value: 0.04, unit: 'usd_per_1000_chars' } },
  { id: 'fal-qwen3', label: 'Qwen', place: 'cloud', availability: { state: 'available' }, price: { value: 0.2, unit: 'usd_per_1000_chars' } }
];
function harness(methodNames, dependencies) {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const methods = methodNames.map(name => {
    const member = klass.members.find(node => node.name?.getText(ast) === name);
    assert.ok(member, name); return member.getText(ast);
  }).join('\n');
  const compiled = ts.transpileModule(`class Harness { ${methods} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}; return Harness;`)(...Object.values(dependencies));
}
function startWidget(selected, decision = true) {
  const dialogs = [], batches = [], adoptions = [];
  const Harness = harness(['startAiNarration'], { narrationBatchConfirm,
    ConfirmDialog: class { constructor(message) { dialogs.push(message); } async open() { return decision; } },
    window: { setInterval: () => 1, clearInterval: () => {} } });
  const state = { ...initialAiNarrationState(engines), script: 'あ'.repeat(1000), selectedEngineIds: selected,
    voiceByEngine: Object.fromEntries(selected.map(id => [id, 'v'])) };
  const root = { toString: () => 'file:///stub/project' };
  const widget = Object.assign(new Harness(), { narrationStates: new Map([['key', state]]), narrationEngines: engines,
    aiView: 'narration', aiViewClipKey: 'key', isDisposed: false,
    workspaceService: { tryGetRoots: () => [{ resource: root }] },
    layerAudioService: { startNarrationBatch: async request => {
      batches.push(request); return { completed: request.routes.length,
        candidates: request.routes.map(row => ({ route: row.engine, ok: true,
          relativePath: `assets/generated/candidates/frame/${row.engine}-1.wav` })) };
    }, readNarrationCandidates: async () => ({ completed: 0, candidates: [] }) },
    loadAiNarrationCandidates: async () => {},
    adoptAiNarrationCandidate: async (...args) => { adoptions.push(args); },
    narrationIrodoriUrl: () => undefined, render() {} });
  return { widget, state, dialogs, batches, adoptions };
}

test('startAiNarration は 1 案だけ自動採用し、複数案と retry では自動採用しない', async () => {
  const one = startWidget(['voicevox']);
  await one.widget.startAiNarration('key', 'frame', 0);
  assert.equal(one.batches.length, 1);
  assert.equal(one.adoptions.length, 1);
  const many = startWidget(['voicevox', 'irodori']);
  await many.widget.startAiNarration('key', 'frame', 0);
  assert.equal(many.batches.length, 1);
  assert.equal(many.adoptions.length, 0);
  await many.widget.startAiNarration('key', 'frame', 0, 'voicevox');
  assert.equal(many.batches.length, 2);
  assert.deepEqual(many.batches[1].routes.map(row => row.engine), ['voicevox']);
  assert.equal(many.adoptions.length, 0);
});

test('有料 2 エンジンは合計 1 回だけ承認し、拒否は送信 0、承認は approved true', async () => {
  const denied = startWidget(['gemini-tts', 'fal-qwen3'], false);
  await denied.widget.startAiNarration('key', 'frame', 0);
  assert.equal(denied.dialogs.length, 1);
  assert.match(denied.dialogs[0].msg, /Gemini.*\$0\.040.*Qwen.*\$0\.200.*合計 \$0\.240/su);
  assert.equal(denied.batches.length, 0);
  const approved = startWidget(['gemini-tts', 'fal-qwen3']);
  await approved.widget.startAiNarration('key', 'frame', 0);
  assert.equal(approved.dialogs.length, 1);
  assert.equal(approved.batches.length, 1);
  assert.equal(approved.batches[0].approved, true);
  assert.equal(approved.adoptions.length, 0);
});

test('adoptAiNarrationCandidate は 1 mutation に置き、undo 1 回で戻り候補ファイルを残す', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-narration-widget-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const candidate = path.join(scratch, 'assets/generated/candidates/frame/voicevox-1.wav');
  const output = path.join(scratch, 'out/narration/n-0001.wav');
  await mkdir(path.dirname(candidate), { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(candidate, Buffer.from('RIFFstub'));
  const before = { version: 2, output: { fps: 30 },
    sources: [{ id: 'frame-src', path: 'assets/generated/frame-audio-a.wav' }],
    tracks: [{ id: 'audio', lane: 'audio', items: [{ id: 'frame', at: 0, duration: 60,
      source: { kind: 'media', src: 'frame-src', in: 0, out: 2 } }] }] };
  let disk = structuredClone(before), saved, commits = 0;
  const uri = pathToFileURL(scratch).href;
  const root = { toString: () => uri, resolve: name => `${uri}/${name}` };
  const Harness = harness(['adoptAiNarrationCandidate'], { aiNarrationSourcePath, placeAiNarration, planAiNarrationPlacement });
  const widget = Object.assign(new Harness(), { narrationStates: new Map([['key', { placementChoice: 'lower' }]]),
    workspaceService: { tryGetRoots: () => [{ resource: root }] },
    layerAudioService: { adoptNarrationCandidate: async () => {
      await copyFile(candidate, output); return { path: 'out/narration/n-0001.wav', durationSeconds: 1.5 };
    } },
    fileService: { readFile: async () => ({ value: Buffer.from(JSON.stringify(disk)) }) },
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root },
      commitEditMutation: async (_label, mutate) => { commits++; saved = structuredClone(disk); disk = mutate(disk); } }] },
    render() {}, isDisposed: false });
  await widget.adoptAiNarrationCandidate('key', 'frame', 'assets/generated/candidates/frame/voicevox-1.wav');
  assert.equal(commits, 1);
  assert.equal(aiNarrationSourcePath(disk, 'frame'), 'out/narration/n-0001.wav');
  assert.equal(disk.tracks[0].items[0].role, 'narration');
  disk = saved; // History stub: one undo restores the pre-mutation snapshot.
  assert.deepEqual(disk, before);
  assert.ok((await stat(candidate)).isFile());
  assert.ok((await stat(output)).isFile());
});

test('既定は使えるいつもの 1 件、使えない・未設定は従来既定、お気に入りは未チェックで上位', async () => {
  const Harness = harness(['loadAiNarrationVoices'], { initialAiNarrationState, chooseAiNarrationVoice });
  async function load(preferred, rows = engines) {
    const state = initialAiNarrationState(rows);
    const widget = Object.assign(new Harness(), { narrationStates: new Map([['key', state]]), narrationEngines: rows,
      aiViewClipKey: 'key', workspaceService: { tryGetRoots: () => [{ resource: { toString: () => 'file:///stub' } }] },
      layerAudioService: { readPreferredNarrationRoutes: async () => ({ defaultEngineId: preferred,
        favorites: ['fal-qwen3'] }), listNarrationVoices: async () => ({ voices: [{ id: 'v', default: true }] }) },
      render() {}, narrationIrodoriUrl: () => undefined });
    await widget.loadAiNarrationVoices('key'); return state;
  }
  const selected = await load('gemini-tts');
  assert.deepEqual(selected.selectedEngineIds, ['gemini-tts']);
  assert.deepEqual(selected.favorites, ['fal-qwen3']);
  assert.ok(!selected.selectedEngineIds.includes('fal-qwen3'));
  assert.equal(orderedNarrationEngines(engines, selected.favorites)[0].id, 'fal-qwen3');
  const unavailable = await load('gemini-tts', engines.map(row => row.id === 'gemini-tts'
    ? { ...row, availability: { state: 'unconfigured' } } : row));
  assert.deepEqual(unavailable.selectedEngineIds, ['voicevox']);
  assert.deepEqual((await load(undefined)).selectedEngineIds, ['voicevox']);
});

test('行ごとの見積もりは無料・従量・見積不可を区別する', () => {
  assert.equal(narrationRowEstimate(engines[0], 'あ'.repeat(1000)), '無料');
  assert.equal(narrationRowEstimate(engines[1], 'あ'.repeat(1000)), '無料');
  assert.equal(narrationRowEstimate(engines[2], 'あ'.repeat(1000)), '見積 $0.040');
  assert.equal(narrationRowEstimate(engines[2], 'あ'.repeat(2000)), '見積 $0.080');
  assert.equal(narrationRowEstimate({ ...engines[2], price: undefined }, 'あ'), '見積不可');
});

test('cancelNarrationBatch は対象まとめの子だけ kill する', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-narration-cancel-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await mkdir(path.join(scratch, 'assets/generated'), { recursive: true });
  await writeFile(path.join(scratch, 'assets/generated/frame-audio-a.wav'), Buffer.from('RIFFstub'));
  await writeFile(path.join(scratch, 'assets/generated/frame-audio-a.wav.meta.json'), JSON.stringify({ kind: 'audio', status: 'planned', job: {} }));
  await writeFile(path.join(scratch, 'edit.json'), JSON.stringify({ version: 2, sources: [{ id: 's', path: 'assets/generated/frame-audio-a.wav' }],
    tracks: [{ lane: 'audio', items: [{ id: 'frame-a', source: { src: 's' } }] }] }));
  const kills = [], children = [];
  const manager = new NarrationCliManager((_bin, args) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
    const engine = args[args.indexOf('--engine') + 1];
    child.kill = () => { kills.push(engine); child.exitCode = 143; child.emit('close', 143); return true; };
    children.push(engine); return child;
  });
  manager.resolver.resolveCli = async () => '/stub/cli.mjs';
  manager.engines = async () => ({ engines });
  const service = new AkariAnnotationsServiceImpl(); service.narrationCli = manager;
  const uri = pathToFileURL(scratch).href;
  const separate = manager.generate({ projectRootUri: uri, engine: 'irodori', voice: 'v', script: 'x', reading: 'x', t: 0 }, scratch);
  const batch = service.startNarrationBatch({ projectRootUri: uri, itemId: 'frame-a', script: 'x', reading: 'x', t: 0,
    approved: true, routes: [{ engine: 'voicevox', voice: '1' }, { engine: 'gemini-tts', voice: 'Leda' }] });
  for (let i = 0; i < 100 && children.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(new Set(children), new Set(['irodori', 'voicevox', 'gemini-tts']));
  await service.cancelNarrationBatch({ projectRootUri: uri, itemId: 'frame-a' });
  assert.deepEqual(new Set(kills), new Set(['voicevox', 'gemini-tts']));
  assert.equal(kills.length, 2);
  await manager.cancel(scratch, ['irodori']);
  await Promise.allSettled([batch, separate]);
  assert.equal(kills.length, 3);
});
