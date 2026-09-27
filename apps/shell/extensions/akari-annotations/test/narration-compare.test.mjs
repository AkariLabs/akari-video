import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectGenerationSidecarForSource } from '../../../../../packages/edit-store/lib/index.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { NarrationCliManager } from '../lib/node/narration-cli.js';
import { describeGenerationChip, resolveGenerationState } from '../lib/common/generation-sidecar.js';
import { selectedNarrationEngines, orderedNarrationEngines, narrationBatchConfirm } from '../lib/browser/inspector/ai-narration-panel.js';
const engines = [
  { id: 'voicevox', label: 'VOICEVOX', place: 'local', availability: { state: 'available' }, price: { value: 0, unit: 'usd_per_1000_chars' } },
  { id: 'gemini-tts', label: 'Gemini', place: 'cloud', availability: { state: 'available' }, price: { value: 0.04, unit: 'usd_per_1000_chars' } },
  { id: 'fal-qwen3', label: 'Qwen', place: 'cloud', availability: { state: 'available' }, price: { value: 0.2, unit: 'usd_per_1000_chars' } }
];
const timelineSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const timelineAst = ts.createSourceFile('akari-annotations-widget.ts', timelineSource, ts.ScriptTarget.Latest, true);
const timelineClass = timelineAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const generationForPathMethod = timelineClass.members.find(node => node.name?.getText(timelineAst) === 'generationForPath');
assert.ok(generationForPathMethod);
const compiledTimeline = ts.transpileModule(`class Timeline { ${generationForPathMethod.getText(timelineAst)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Timeline = new Function('selectGenerationSidecarForSource', 'resolveGenerationState',
  `${compiledTimeline}; return Timeline;`)(selectGenerationSidecarForSource, resolveGenerationState);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-narration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.akari'), { recursive: true });
  await mkdir(path.join(root, 'assets/generated'), { recursive: true });
  await writeFile(path.join(root, 'assets/generated/frame-audio-a.wav'), Buffer.from('RIFFstub'));
  await writeFile(path.join(root, 'assets/generated/frame-audio-a.wav.meta.json'), JSON.stringify({ kind: 'audio', status: 'planned',
    job: {}, inputs: {}, output: {}, cost: {} }));
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
    sources: [{ id: 's', path: 'assets/generated/frame-audio-a.wav' }],
    tracks: [{ lane: 'audio', items: [{ id: 'frame-a', at: 0, source: { src: 's' } }] }] }));
  return { root, uri: pathToFileURL(root).href };
}
test('いつもの 1 件とお気に入りの別順、合計 1 回の承認文', () => {
  assert.deepEqual(selectedNarrationEngines(engines, 'gemini-tts'), ['gemini-tts']);
  assert.deepEqual(selectedNarrationEngines(engines), ['voicevox']);
  assert.deepEqual(orderedNarrationEngines(engines, ['fal-qwen3']).map(x => x.id), ['fal-qwen3', 'voicevox', 'gemini-tts']);
  const confirm = narrationBatchConfirm(engines, 'あ'.repeat(1000));
  assert.match(confirm.msg, /Gemini.*\$0\.040.*Qwen.*\$0\.200.*合計 \$0\.240/su);
  assert.equal(narrationBatchConfirm([engines[0]], '無料'), undefined);
});
test('G8 voice の id は catalog ref を経てエンジン id に対応する', async t => {
  const { root, uri } = await fixture(t);
  const old = process.env.AKARI_HOME;
  process.env.AKARI_HOME = path.join(root, 'home');
  t.after(() => { if (old === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = old; });
  await mkdir(process.env.AKARI_HOME);
  await writeFile(path.join(process.env.AKARI_HOME, 'ai-models.json'), JSON.stringify({ defaults: { voice: 'tts:gemini-tts' },
    favorites: { voice: ['tts:fal-qwen3'] } }));
  const service = new AkariAnnotationsServiceImpl();
  assert.deepEqual(await service.readPreferredNarrationRoutes(uri), { defaultEngineId: 'gemini-tts', favorites: ['fal-qwen3'] });
  await writeFile(path.join(root, '.akari/ai-models.json'), JSON.stringify({ defaults: { voice: 'voicevox' } }));
  assert.equal((await service.readPreferredNarrationRoutes(uri)).defaultEngineId, 'voicevox');
});
test('3 エンジン同時、1 失敗、edit 不変、採用 2 回の番号予約と候補保持', async t => {
  const { root, uri } = await fixture(t);
  const service = new AkariAnnotationsServiceImpl();
  service.narrationCli.engines = async () => ({ engines });
  const calls = [];
  service.narrationCli.generate = async (request, _root, out) => {
    calls.push(request.engine);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (request.engine === 'gemini-tts') throw new Error('stub failure');
    await mkdir(path.dirname(path.join(root, out)), { recursive: true });
    await writeFile(path.join(root, out), Buffer.from('RIFFstub' + request.engine));
    return { status: 'ok', path: out, duration_s: request.engine === 'voicevox' ? 0.5 : 0.9, cost_usd: 0 };
  };
  const before = await readFile(path.join(root, 'edit.json'), 'utf8');
  const request = { projectRootUri: uri, itemId: 'frame-a', script: '比較', reading: '比較', t: 0,
    routes: engines.map(e => ({ engine: e.id, voice: 'v' })) };
  await assert.rejects(service.startNarrationBatch(request), /費用承認/u);
  assert.equal(calls.length, 0);
  const batch = await service.startNarrationBatch({ ...request, approved: true });
  assert.equal(batch.completed, 3);
  assert.equal(batch.candidates.filter(x => x.ok).length, 2);
  assert.equal(batch.candidates.find(x => !x.ok).reason, 'stub failure');
  assert.deepEqual(new Set(calls), new Set(engines.map(x => x.id)));
  assert.equal(await readFile(path.join(root, 'edit.json'), 'utf8'), before);
  const frame = JSON.parse(await readFile(path.join(root, 'assets/generated/frame-audio-a.wav.meta.json')));
  assert.equal(frame.job.completed, 3);
  assert.equal(frame.job.candidates, 2);
  const candidates = (await service.readNarrationCandidates({ projectRootUri: uri, itemId: 'frame-a' })).candidates.filter(x => x.ok);
  const candidateMeta = JSON.parse(await readFile(path.join(root, `${candidates[0].relativePath}.meta.json`)));
  assert.equal(candidateMeta.kind, 'audio');
  assert.equal(candidateMeta.status, 'done');
  assert.equal(candidateMeta.candidate_of, 'frame-a');
  assert.equal(candidateMeta.route, candidates[0].route);
  assert.equal(candidateMeta.voice, 'v');
  assert.ok(candidateMeta.job.elapsed_s >= 0);
  assert.ok(candidateMeta.result.duration_s_actual > 0);
  const [a,b] = await Promise.all(candidates.map(candidate => service.adoptNarrationCandidate({ projectRootUri: uri,
    itemId: 'frame-a', relativePath: candidate.relativePath })));
  assert.notEqual(a.path, b.path);
  assert.match(a.path, /^out\/narration\/n-\d{4}\.(wav|mp3)$/u);
  assert.equal(await readFile(path.join(root, 'edit.json'), 'utf8'), before);
  for (const candidate of candidates) assert.ok((await stat(path.join(root, candidate.relativePath))).isFile());
  for (const adopted of [a, b]) {
    await assert.rejects(stat(path.join(root, `${adopted.path}.meta.json`)), { code: 'ENOENT' });
    const timeline = new Timeline();
    timeline.generationSidecars = new Map([[candidates[0].relativePath, { meta: candidateMeta, binding: null }]]);
    const generation = timeline.generationForPath(adopted.path);
    const badge = generation ? describeGenerationChip(generation.state, generation.meta).badge : '';
    assert.equal(badge, '');
    assert.doesNotMatch(badge, /静止画/u);
  }
});
test('root × エンジンの鍵は同じエンジンだけ拒否し、中止は子を止める', async () => {
  const children = [], kills = [];
  const manager = new NarrationCliManager((_bin,args) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
    child.kill = () => { kills.push(args[args.indexOf('--engine') + 1]); child.exitCode = 143;
      child.stdout.emit('data', Buffer.from('{"status":"ok"}')); child.emit('close', 143); return true; };
    children.push({ child, args }); return child;
  });
  manager.resolver.resolveCli = async () => '/stub/cli.mjs';
  const root = '/stub/root';
  const base = { projectRootUri: 'file:///stub/root', voice: 'v', script: 'x', reading: 'x', t: 0, approved: true };
  manager.nextOutputId = async () => 'n-0001';
  const a = manager.generate({ ...base, engine: 'voicevox' }, root);
  const b = manager.generate({ ...base, engine: 'gemini-tts' }, root);
  for (let i = 0; i < 100 && children.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(children.length, 2);
  await assert.rejects(manager.generate({ ...base, engine: 'voicevox' }, root), /生成中/u);
  await manager.cancel(root);
  await Promise.allSettled([a,b]);
  assert.equal(children.length, 2);
  assert.deepEqual(new Set(kills), new Set(['voicevox', 'gemini-tts']));
  assert.equal(kills.length, 2);
});

test('採番は edit.json の n-0007 を含め、空の出力先なら n-0008 を使う', async t => {
  const { root, uri } = await fixture(t);
  const editPath = path.join(root, 'edit.json');
  const edit = JSON.parse(await readFile(editPath));
  edit.audio = { narration: [{ id: 'n-0007' }] };
  edit.tracks[0].items.push({ id: 'n-0006', source: { src: 's' } });
  await writeFile(editPath, JSON.stringify(edit));
  const dir = path.join(root, 'assets/generated/candidates/frame-a');
  await mkdir(dir, { recursive: true });
  const rel = 'assets/generated/candidates/frame-a/voicevox-1.wav';
  await writeFile(path.join(root, rel), Buffer.from('RIFFstub'));
  await writeFile(path.join(root, `${rel}.meta.json`), JSON.stringify({ candidate_of: 'frame-a', status: 'done',
    result: { duration_s_actual: 0.5 } }));
  const service = new AkariAnnotationsServiceImpl();
  const adopted = await service.adoptNarrationCandidate({ projectRootUri: uri, itemId: 'frame-a', relativePath: rel });
  assert.equal(adopted.path, 'out/narration/n-0008.wav');
  assert.ok((await stat(path.join(root, adopted.path))).isFile());
  await assert.rejects(stat(path.join(root, `${adopted.path}.meta.json`)), { code: 'ENOENT' });
});

test('音声の EEXIST は既存ファイルを保ち、次の番号で採用する', async t => {
  const { root, uri } = await fixture(t);
  const editPath = path.join(root, 'edit.json');
  const edit = JSON.parse(await readFile(editPath));
  edit.tracks[0].items.push({ id: 'n-0007', source: { src: 's' } });
  await writeFile(editPath, JSON.stringify(edit));
  const dir = path.join(root, 'assets/generated/candidates/frame-a');
  await mkdir(dir, { recursive: true });
  const rel = 'assets/generated/candidates/frame-a/voicevox-1.wav';
  await writeFile(path.join(root, rel), Buffer.from('RIFFstub'));
  await writeFile(path.join(root, `${rel}.meta.json`), JSON.stringify({ candidate_of: 'frame-a', status: 'done',
    result: { duration_s_actual: 0.5 } }));
  await mkdir(path.join(root, 'out/narration'), { recursive: true });
  await writeFile(path.join(root, 'out/narration/n-0008.wav'), 'existing audio');
  const service = new AkariAnnotationsServiceImpl();
  const adopted = await service.adoptNarrationCandidate({ projectRootUri: uri, itemId: 'frame-a', relativePath: rel });
  assert.equal(adopted.path, 'out/narration/n-0009.wav');
  assert.equal(await readFile(path.join(root, 'out/narration/n-0008.wav'), 'utf8'), 'existing audio');
  assert.ok((await stat(path.join(root, adopted.path))).isFile());
  await assert.rejects(stat(path.join(root, `${adopted.path}.meta.json`)), { code: 'ENOENT' });
});

test('同じエンジンの前回成功候補があっても今回の失敗行を隠さない', async t => {
  const { root, uri } = await fixture(t);
  const service = new AkariAnnotationsServiceImpl();
  service.narrationCli.engines = async () => ({ engines });
  let fail = false;
  service.narrationCli.generate = async (_request, _root, out) => {
    if (fail) throw new Error('stub failure');
    await mkdir(path.dirname(path.join(root, out)), { recursive: true });
    await writeFile(path.join(root, out), Buffer.from('RIFFstub'));
    return { status: 'ok', path: out, duration_s: 0.5, cost_usd: 0 };
  };
  const request = { projectRootUri: uri, itemId: 'frame-a', script: '比較', reading: '比較', t: 0,
    routes: [{ engine: 'voicevox', voice: '1' }] };
  assert.equal((await service.startNarrationBatch(request)).candidates[0].ok, true);
  fail = true;
  assert.equal((await service.startNarrationBatch(request)).candidates[0].ok, false);
  const rows = (await service.readNarrationCandidates({ projectRootUri: uri, itemId: 'frame-a' })).candidates;
  assert.equal(rows.filter(row => row.ok).length, 1);
  assert.equal(rows.filter(row => !row.ok && row.reason === 'stub failure').length, 1);
});
