import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { withInspectorDom } from './helpers/inspector-dom.mjs';
import { appendAiVideoCandidatesPanel, replaceVideoInEdit, videoApprovalMessage, videoCandidateDetail,
  videoModelGroups, videoModelName, videoProgress, videoProgressCandidate, videoProgressLayoutKey,
  videoSelectionEstimate, videoRoundedDuration, videoOverhangSeconds, videoRequestedDuration } from '../lib/browser/inspector/ai-video-candidates-panel.js';

const catalog = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8')).models;

const models = [
  { id: 'fal:h3-i2v', kind: 'video', family: 'H3', provider: 'fal' },
  { id: 'fal:kling', kind: 'video', family: 'Kling', provider: 'fal' },
  { id: 'fal:veo', kind: 'video', family: 'Veo', provider: 'fal' },
  { id: 'fal:uncallable', kind: 'video', family: 'Hidden', callable: false }
];
const preferred = { defaultModelId: 'fal:h3-i2v', favorites: ['fal:kling', 'fal:h3-i2v'], source: 'project' };
const estimate = { models: [
  { modelId: 'fal:h3-i2v', estimateUsd: 0.36, asOf: '2026-09-12', needs_explicit_confirm: false },
  { modelId: 'fal:kling', estimateUsd: null, asOf: '2026-09-12', needs_explicit_confirm: true },
  { modelId: 'fal:veo', estimateUsd: null, needs_explicit_confirm: false, error: 'この長さでは使えません' }
], totalUsd: 0.36, needs_explicit_confirm: true };
const descendants = node => [node, ...node.children.flatMap(descendants)];
const attr = (node, name, value) => descendants(node).find(row => row.attributes.get(name) === value);

test('モデル別の丸め尺・最長の点線・枠超過の注意を示す', () => withInspectorDom(({ document }) => {
  const h3 = catalog.find(row => row.id === 'fal:h3-i2v');
  const kling = catalog.find(row => row.id === 'fal:kling-v3-standard-i2v');
  const veo = catalog.find(row => row.id === 'fal:veo-3.1-flf');
  assert.equal(videoRoundedDuration(h3, 0.8), 5);
  assert.equal(videoRoundedDuration(kling, 0.8), 3);
  assert.equal(videoRoundedDuration(veo, 5), 6);
  assert.equal(videoOverhangSeconds(0.8, 5), 4.2);
  assert.equal(videoOverhangSeconds(5, 5), 0);
  const state = { selected: new Set([h3.id, kling.id]),
    preferred: { defaultModelId: h3.id, favorites: [kling.id] }, thumbnails: new Map(), running: false,
    estimateKey: JSON.stringify(['project', 'clip-frame', { output: { duration_s: 0.7999999999999998 } }, [h3.id, kling.id]]) };
  assert.equal(videoRequestedDuration(state), 0.8);
  appendAiVideoCandidatesPanel(document.body, state,
  [h3, kling], { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-duration', h3.id).textContent, '5 秒で作ります');
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-duration', kling.id).textContent, '3 秒で作ります');
  assert.match(attr(document.body, 'data-akari-inspector-video-duration-note', 'true').textContent,
    /枠 0\.8 秒 → 5 秒の動画を作ります.*残りはタイムラインに点線で出ます/u);
}));

test('見積キーがまだ無くても承認時の batchDraft から要求尺を読む', () => {
  assert.equal(videoRequestedDuration({ batchDraft: { output: { duration_s: 0.8 } } }), 0.8);
  assert.equal(videoRequestedDuration({}), undefined);
});

test('いつものだけを選び、★ は未選択・呼べないモデルは非表示・使えないモデルは理由付き', () => withInspectorDom(({ document }) => {
  const groups = videoModelGroups(models, preferred);
  assert.deepEqual(groups.usual.map(row => row.id), ['fal:h3-i2v']);
  assert.deepEqual(groups.favorites.map(row => row.id), ['fal:kling']);
  assert.deepEqual(groups.others.map(row => row.id), ['fal:veo']);
  const state = { selected: new Set(['fal:h3-i2v']), preferred, estimate, thumbnails: new Map(), running: false };
  appendAiVideoCandidatesPanel(document.body, state, models, {
    select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {}
  });
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-check', 'fal:h3-i2v').checked, true);
  assert.ok(attr(document.body, 'data-akari-inspector-ai-maker', 'minimax'));
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-check', 'fal:kling').checked, false);
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-check', 'fal:veo').disabled, true);
  assert.equal(attr(document.body, 'data-akari-inspector-video-model-reason', 'fal:veo').textContent, 'この長さでは使えません');
  assert.equal(attr(document.body, 'data-akari-inspector-video-model', 'fal:uncallable'), undefined);
}));

test('ボタンの合計・料金未確認と費用承認のモデル別内訳', () => withInspectorDom(({ document }) => {
  const selected = new Set(['fal:h3-i2v', 'fal:kling']);
  assert.deepEqual(videoSelectionEstimate(estimate, selected), {
    count: 2, total: 0.36, unknown: 1, invalid: false, label: '2 案を作る · 見積 $0.36 + 未確認 1'
  });
  const message = videoApprovalMessage(estimate, selected, models);
  assert.match(message, /H3: \$0\.36（as_of 2026-09-12）/u);
  assert.match(message, /Kling: 料金 未確認/u);
  assert.match(message, /合計 見積 \$0\.36 \+ 料金未確認 1 件/u);
  appendAiVideoCandidatesPanel(document.body, { selected, preferred, estimate, thumbnails: new Map(), running: false }, models,
    { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  assert.equal(attr(document.body, 'data-akari-inspector-video-create', 'true').textContent,
    '2 案を作る · 見積 $0.36 + 未確認 1');
}));

test('待ち・生成中の秒数・失敗の理由と再試行行', () => withInspectorDom(({ document }) => {
  for (const [candidate, state, label] of [
    [{ route: 'a', ok: false, status: 'generating', queueStatus: 'IN_QUEUE' }, 'waiting', '待ち'],
    [{ route: 'a', ok: false, status: 'generating', queueStatus: 'IN_PROGRESS' }, 'running', '生成中 · 5 秒'],
    [{ route: 'a', ok: false, status: 'generating', queueStatus: 'COMPLETED' }, 'running', '仕上げ中'],
    [{ route: 'a', ok: true, status: 'done', queueStatus: 'COMPLETED' }, 'done', '完了'],
    [{ route: 'a', ok: false, status: 'failed', reason: 'stub failure' }, 'failed', '失敗 · stub failure']
  ]) assert.deepEqual(videoProgress(candidate, 5), { state, label });
  const state = { selected: new Set(['fal:h3-i2v']), preferred, estimate, thumbnails: new Map(), running: false,
    batch: { routes: ['fal:h3-i2v'], completed: 1, running: false, results: [], candidates: [
      { route: 'fal:h3-i2v', ok: false, status: 'failed', reason: 'stub failure' }
    ] } };
  appendAiVideoCandidatesPanel(document.body, state, models,
    { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  assert.match(attr(document.body, 'data-akari-inspector-video-failed-model', 'fal:h3-i2v').textContent, /stub failure/u);
  assert.ok(attr(document.body, 'data-akari-inspector-video-retry-model', 'fal:h3-i2v'));
}));

test('動画候補は 160px のサムネイルと 2 列のコンパクトな行を使う', () => {
  const css = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const row = css.match(/\.akari-inspector-ai-video-candidate\s*\{([^}]*)\}/u)?.[1];
  const thumbnail = css.match(/\.akari-inspector-ai-video-candidate-thumbnail\s*\{([^}]*)\}/u)?.[1];
  assert.match(row, /display:\s*grid/u);
  assert.match(row, /grid-template-columns:\s*160px\s+minmax\(0,\s*1fr\)/u);
  assert.match(thumbnail, /width:\s*160px/u);
  assert.doesNotMatch(thumbnail, /width:\s*100%/u);
  assert.match(thumbnail, /object-fit:\s*contain/u);
});

test('候補の尺・作成秒を札付きで示し、未取得の値は省く', () => {
  assert.equal(videoCandidateDetail({ durationSeconds: 4, elapsedSeconds: 20.6,
    width: 640, height: 360, costUsd: 1.21 }, 'Seedance 2.0'),
  'Seedance 2.0 · 尺 4 秒 · 作成 21 秒 · 640×360 · $1.21');
  assert.equal(videoCandidateDetail({ durationSeconds: 4.25, elapsedSeconds: 1.4, costUsd: null }, 'H3'),
    'H3 · 尺 4.3 秒 · 作成 1 秒 · 料金 未確認');
  assert.equal(videoCandidateDetail({}, 'H3'), 'H3');
});

test('同名モデルはカタログの入力種別をモデル行・進捗・候補・承認に共通表示する', () => withInspectorDom(({ document }) => {
  const h3 = catalog.find(row => row.id === 'fal:h3-i2v');
  const h3Ref = catalog.find(row => row.id === 'fal:h3-ref');
  const veo = catalog.find(row => row.id === 'fal:veo-3.1-flf');
  assert.equal(videoModelName(h3), 'MiniMax H3（画像から）');
  assert.equal(videoModelName(h3Ref), 'MiniMax H3（参照から）');
  assert.equal(videoModelName(veo), 'Veo 3.1（最初と最後）');
  const estimates = { models: [
    { modelId: h3.id, estimateUsd: 0.3, asOf: '2026-09-12' },
    { modelId: h3Ref.id, estimateUsd: 0.3, asOf: '2026-09-22' }
  ] };
  assert.match(videoApprovalMessage(estimates, new Set([h3.id, h3Ref.id]), [h3, h3Ref]), /MiniMax H3（画像から）.*MiniMax H3（参照から）/su);
  const state = { selected: new Set([h3.id]), preferred: { defaultModelId: h3.id, favorites: [], source: 'project' },
    estimate: estimates, thumbnails: new Map(), running: false,
    batch: { routes: [h3.id], completed: 1, running: false, results: [], candidates: [
      { route: h3.id, ok: true, status: 'done', relativePath: 'candidate.mp4' }
    ] } };
  appendAiVideoCandidatesPanel(document.body, state, [h3, h3Ref],
    { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  assert.ok(descendants(document.body).some(row => row.textContent?.includes('MiniMax H3（画像から）')));
}));

test('進捗は前回結果より今回の候補 meta を選び、queue の変化では全体再描画を要しない', () => {
  const old = { route: 'fal:h3-i2v', ok: true, status: 'done', relativePath: 'old.mp4' };
  const current = { route: old.route, ok: false, status: 'generating', queueStatus: 'IN_QUEUE' };
  const state = { running: true, batchBaseline: new Set(['old.mp4']),
    batch: { routes: [old.route], completed: 0, running: true, candidates: [old, current], results: [old] } };
  assert.equal(videoProgress(videoProgressCandidate(state, old.route), 1).state, 'waiting');
  const layout = videoProgressLayoutKey(state.batch);
  current.queueStatus = 'IN_PROGRESS';
  assert.equal(videoProgress(videoProgressCandidate(state, old.route), 1).state, 'running');
  assert.equal(videoProgressLayoutKey(state.batch), layout);
});

test('候補行と選択した候補の編集パネル内プレイヤーを表示する', () => withInspectorDom(({ document }) => {
  const candidate = { route: 'fal:h3-i2v', ok: true, status: 'done',
    relativePath: 'assets/generated/candidates/clip-1/a.mp4', durationSeconds: 6,
    elapsedSeconds: 12, width: 1280, height: 720, costUsd: 0.36 };
  appendAiVideoCandidatesPanel(document.body, { selected: new Set(['fal:h3-i2v']), preferred, estimate,
    thumbnails: new Map(), running: false, picked: candidate.relativePath, playerUrl: 'blob:local',
    batch: { routes: ['fal:h3-i2v'], completed: 1, running: false, candidates: [candidate], results: [candidate] } }, models,
  { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  assert.ok(attr(document.body, 'data-akari-inspector-video-candidate', candidate.relativePath));
  assert.equal(attr(document.body, 'data-akari-inspector-video-player', candidate.relativePath).src, 'blob:local');
  assert.equal(attr(document.body, 'data-akari-inspector-video-adopt', 'true').disabled, false);
  assert.ok(attr(document.body, 'data-akari-inspector-video-candidates-remain', 'true'));
}));

test('選択した候補の直後だけにプレイヤーを置き、画角を候補の寸法に合わせる', () => withInspectorDom(({ document }) => {
  const candidates = [
    { route: 'fal:h3-i2v', ok: true, status: 'done', relativePath: 'a.mp4', width: 640, height: 360 },
    { route: 'fal:kling', ok: true, status: 'done', relativePath: 'b.mp4', width: 640, height: 480 },
    { route: 'fal:veo', ok: true, status: 'done', relativePath: 'c.mp4' }
  ];
  const state = { selected: new Set(['fal:h3-i2v']), preferred, estimate, thumbnails: new Map(), running: false,
    picked: 'b.mp4', playerUrl: 'blob:middle',
    batch: { routes: candidates.map(row => row.route), completed: 3, running: false, candidates, results: candidates } };
  appendAiVideoCandidatesPanel(document.body, state, models,
    { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} });
  const panel = attr(document.body, 'data-akari-inspector-video-panel', 'true');
  const middle = attr(panel, 'data-akari-inspector-video-candidate', 'b.mp4');
  const last = attr(panel, 'data-akari-inspector-video-candidate', 'c.mp4');
  const player = attr(panel, 'data-akari-inspector-video-player', 'b.mp4');
  assert.equal(panel.children[panel.children.indexOf(middle) + 1], player);
  assert.ok(panel.children.indexOf(player) < panel.children.indexOf(last));
  assert.equal(attr(middle, 'data-akari-inspector-video-candidate-thumbnail', 'b.mp4').style.aspectRatio, '640 / 480');
  assert.equal(attr(last, 'data-akari-inspector-video-candidate-thumbnail', 'c.mp4').style.aspectRatio, '16 / 9');
}));

test('再描画でも同じ video 要素と再生位置を保持する', () => withInspectorDom(({ document }) => {
  const candidate = { route: 'fal:h3-i2v', ok: true, status: 'done', relativePath: 'candidate.mp4', durationSeconds: 6 };
  const state = { selected: new Set([candidate.route]), preferred, estimate, thumbnails: new Map(), running: false,
    picked: candidate.relativePath, playerUrl: 'blob:stable',
    batch: { routes: [candidate.route], completed: 1, running: false, candidates: [candidate], results: [candidate] } };
  const actions = { select() {}, generate() {}, cancel() {}, pick() {}, adopt() {}, thumbnail() {} };
  appendAiVideoCandidatesPanel(document.body, state, models, actions);
  const first = attr(document.body, 'data-akari-inspector-video-player', candidate.relativePath);
  first.currentTime = 1.25; first.playing = true;
  appendAiVideoCandidatesPanel(document.body, state, models, actions);
  const players = descendants(document.body).filter(row => row.attributes.get('data-akari-inspector-video-player') === candidate.relativePath);
  assert.equal(state.playerElement, first);
  assert.equal(players.at(-1), first);
  assert.equal(first.currentTime, 1.25);
  assert.equal(first.playing, true);
}));

test('候補の採用は sources と item を一手で変え、undo で復元し他候補を残す', () => {
  let edit = { sources: [{ id: 'still', path: 'frame.png' }], tracks: [{ items: [
    { id: 'clip-1', source: { kind: 'media', src: 'still', in: 0, out: 6 }, transform: { scale: 0.5 } }
  ] }] };
  const original = structuredClone(edit);
  const candidates = [
    { route: 'fal:h3-i2v', ok: true, relativePath: 'assets/generated/candidates/clip-1/a.mp4', durationSeconds: 4 },
    { route: 'fal:kling', ok: true, relativePath: 'assets/generated/candidates/clip-1/b.mp4', durationSeconds: 8 }
  ];
  const history = [];
  const commitEditMutation = (_label, mutate) => { history.push(structuredClone(edit)); edit = mutate(structuredClone(edit)); };
  commitEditMutation('この案を使う', doc => replaceVideoInEdit(doc, 'clip-1', candidates[0]));
  assert.equal(history.length, 1);
  assert.equal(edit.sources.find(row => row.id === 'gen-clip-1-video').path, candidates[0].relativePath);
  assert.equal(edit.tracks[0].items[0].source.src, 'gen-clip-1-video');
  assert.deepEqual(edit.tracks[0].items[0].source.freeze, { at_sec: 4, duration_sec: 2 });
  assert.deepEqual(edit.tracks[0].items[0].transform, original.tracks[0].items[0].transform);
  edit = history.pop();
  assert.deepEqual(edit, original);
  assert.equal(candidates.length, 2);
});

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(row => row.name?.getText(ast) === name).getText(ast);

test('初期化はいつもの 1 モデルだけをチェックし、保存済みの候補を読み直す', async () => {
  const script = ts.transpileModule(`class Widget { ${method('appendVideoCandidatesPanel')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Widget = new Function('videoModelGroups', 'appendAiVideoCandidatesPanel',
    `${script}; return Widget;`)(videoModelGroups, () => {});
  const instance = new Widget();
  instance.aiVideoStates = new Map(); instance.generationCatalog = models;
  instance.generationDrafts = new Map([['clip-1', { modelId: 'fal:h3-i2v', inputs: {}, output: {} }]]);
  instance.generationStates = new Map(); instance.body = {};
  instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
  instance.layerAudioService = { readPreferredRoutes: async () => preferred,
    readVideoCandidates: async () => ({ routes: [], completed: 0, candidates: [
      { route: 'fal:kling', ok: true, status: 'done', relativePath: 'candidate.mp4' }
    ], results: [], running: false }) };
  instance.persistGenerationDraft = async () => {};
  instance.refreshVideoEstimate = async () => {};
  instance.refreshVideoTimelineProgress = () => {};
  instance.renderVideoCandidates = () => {};
  instance.appendVideoCandidatesPanel({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'frame.png' });
  await new Promise(resolve => setImmediate(resolve));
  const state = instance.aiVideoStates.get('clip-1');
  assert.deepEqual([...state.selected], ['fal:h3-i2v']);
  assert.equal(state.batch.candidates[0].relativePath, 'candidate.mp4');
});

test('再選択時のポーリングは待ちから完了まで候補とタイムラインを更新して止まる', async () => {
  const script = ts.transpileModule(`class Widget { ${method('pollVideoCandidates')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Widget = new Function('videoProgressLayoutKey', `${script}; return Widget;`)(videoProgressLayoutKey);
  const oldWindow = globalThis.window;
  globalThis.window = { setTimeout: callback => { queueMicrotask(callback); return 1; } };
  try {
    const instance = new Widget();
    const state = { running: true, externalRunning: true,
      batch: { routes: ['fal:h3-i2v'], completed: 0, candidates: [], results: [], running: true } };
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    instance.generationCatalog = models;
    instance.generationLoads = new Set();
    instance.model = { snapshot: {} };
    instance.generationIdentity = () => ({ key: 'clip-1', itemId: 'clip-1' });
    let reloads = 0;
    instance.loadGeneration = async () => { reloads++; };
    let renders = 0;
    instance.renderVideoCandidates = () => { renders++; };
    const observed = [], renderAtState = [];
    instance.syncVideoProgressRows = value => {
      observed.push(videoProgress(videoProgressCandidate(value, 'fal:h3-i2v'), 2).state);
      renderAtState.push(renders);
    };
    const chips = [];
    instance.refreshVideoTimelineProgress = (_root, value) => chips.push(value.batch.completed);
    let reads = 0;
    instance.readVideoCandidatesFromFiles = async () => {
      reads++;
      return { routes: ['fal:h3-i2v'], completed: reads < 3 ? 0 : 1,
        candidates: reads < 3 ? [{ route: 'fal:h3-i2v', ok: false, status: 'generating',
          queueStatus: reads === 1 ? 'IN_QUEUE' : 'IN_PROGRESS' }]
          : [{ route: 'fal:h3-i2v', ok: true, status: 'done', relativePath: 'candidate.mp4' }],
        results: [], running: reads < 3 };
    };
    await instance.pollVideoCandidates({ key: 'clip-1', itemId: 'clip-1' }, state);
    assert.equal(reads, 3); assert.equal(state.running, false); assert.equal(state.polling, false);
    assert.deepEqual(observed, ['waiting', 'running', 'done']);
    assert.deepEqual(renderAtState, [1, 1, 2]);
    assert.deepEqual(chips, [0, 0, 1, 1]); assert.equal(reloads, 1); assert.equal(renders, 3);
  } finally { globalThis.window = oldWindow; }
});

test('長い annotations RPC を待たず FileService の候補 meta から queue 状態を読む', async () => {
  const script = ts.transpileModule(`class Widget { ${method('readVideoCandidatesFromFiles')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Widget = new Function(`${script}; return Widget;`)();
  const instance = new Widget();
  const resource = path => ({ path: { base: path.split('/').at(-1) }, toString: () => `file:///project/${path}` });
  const root = { resolve: resource };
  const candidateName = 'fal-h3-i2v-100.mp4.meta.json';
  let done = false;
  instance.fileService = {
    resolve: async () => ({ children: [{ isFile: true, resource: resource(candidateName) }] }),
    readFile: async uri => ({ value: { toString: () => JSON.stringify(uri.path.base === candidateName
      ? { candidate_of: 'clip-1', route: 'fal:h3-i2v', status: done ? 'done' : 'generating',
        job: { started_at: '2026-09-27T00:00:00Z', queue_status: done ? 'COMPLETED' : 'IN_PROGRESS' },
        result: done ? { duration_s_actual: 6, width: 640, height: 360 } : {} }
      : { status: done ? 'planned' : 'generating', job: { provider: 'compare', started_at: '2026-09-27T00:00:00Z',
        routes: ['fal:h3-i2v'], completed: done ? 1 : 0 } }) } })
  };
  const state = { running: true, externalRunning: true, batch: { routes: ['fal:h3-i2v'], completed: 0 } };
  const identity = { itemId: 'clip-1', sourcePath: 'frame.png' };
  const pending = await instance.readVideoCandidatesFromFiles(identity, state, root);
  assert.equal(pending.candidates[0].queueStatus, 'IN_PROGRESS');
  assert.equal(pending.running, true);
  done = true;
  const complete = await instance.readVideoCandidatesFromFiles(identity, state, root);
  assert.equal(complete.candidates[0].status, 'done');
  assert.equal(complete.completed, 1);
  assert.equal(complete.running, false);
});

test('node の queue 状態は再描画なしで表示中の進捗行へ即反映する', () => {
  const script = ts.transpileModule(`class Widget { ${method('syncVideoProgressRows')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Widget = new Function('videoProgressCandidate', 'videoProgress', 'videoModelName',
    `${script}; return Widget;`)(videoProgressCandidate, videoProgress, videoModelName);
  const row = { attrs: new Map([['data-akari-inspector-video-progress-model', 'fal:h3-i2v']]), textContent: '',
    getAttribute(key) { return this.attrs.get(key); }, setAttribute(key, value) { this.attrs.set(key, value); } };
  const progress = { setAttribute() {}, querySelectorAll: () => [row] };
  const widgetInstance = new Widget();
  widgetInstance.aiView = 'video'; widgetInstance.generationCatalog = models;
  widgetInstance.body = { querySelector: () => ({ querySelector: () => progress }) };
  const candidate = { route: 'fal:h3-i2v', ok: false, status: 'generating', queueStatus: 'IN_QUEUE' };
  const state = { running: true, startedAt: Date.now() - 2_000,
    batch: { routes: [candidate.route], completed: 0, running: true, candidates: [candidate], results: [] } };
  widgetInstance.syncVideoProgressRows(state);
  assert.equal(row.attrs.get('data-akari-inspector-video-progress-state'), 'waiting');
  candidate.queueStatus = 'IN_PROGRESS';
  widgetInstance.syncVideoProgressRows(state);
  assert.equal(row.attrs.get('data-akari-inspector-video-progress-state'), 'running');
  assert.match(row.textContent, /生成中 · 2 秒/u);
  assert.equal(row.attrs.get('data-akari-inspector-video-progress-queue'), 'IN_PROGRESS');
  state.batch.results = [{ route: candidate.route, ok: true }];
  widgetInstance.syncVideoProgressRows(state);
  assert.equal(row.attrs.get('data-akari-inspector-video-progress-state'), 'done');
});

test('タイムラインの最終再読込は進行中の再読込を追い越さない', async () => {
  const script = ts.transpileModule(`class Widget { ${method('refreshVideoTimelineProgress')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Widget = new Function(`${script}; return Widget;`)();
  const instance = new Widget();
  const root = { toString: () => 'file:///project' };
  let releaseFirst, active = 0, maxActive = 0, calls = 0;
  instance.stillWidgetManager = { getWidgets: () => [{ location: { root }, isDisposed: false,
    reloadGenerationSidecars: async () => {
      calls++; active++; maxActive = Math.max(maxActive, active);
      if (calls === 1) await new Promise(resolve => { releaseFirst = resolve; });
      active--;
    } }] };
  const state = { batch: { running: true, routes: ['fal:h3-i2v'], completed: 0, candidates: [] } };
  const first = instance.refreshVideoTimelineProgress(root, state);
  state.batch = { ...state.batch, running: false, completed: 1,
    candidates: [{ route: 'fal:h3-i2v', ok: true }] };
  const final = instance.refreshVideoTimelineProgress(root, state, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  releaseFirst();
  await Promise.all([first, final]);
  assert.equal(calls, 2); assert.equal(maxActive, 1);
});

test('サムネイルが最初に取れなくてもキャッシュを外して取り直す', async () => {
  const script = ts.transpileModule(`class Widget { ${method('appendVideoCandidatesPanel')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const candidate = { route: 'fal:h3-i2v', ok: true, status: 'done', relativePath: 'candidate.mp4' };
  const image = { src: '', getAttribute: () => candidate.relativePath };
  const Widget = new Function('videoModelGroups', 'appendAiVideoCandidatesPanel',
    `${script}; return Widget;`)(videoModelGroups, (_body, _state, _catalog, actions) => actions.thumbnail(candidate, image));
  const oldWindow = globalThis.window;
  globalThis.window = { setTimeout: callback => { queueMicrotask(callback); return 1; } };
  try {
    const instance = new Widget();
    const root = { toString: () => 'file:///project', resolve: path => ({ toString: () => `file:///project/${path}` }) };
    const state = { loaded: true, selected: new Set(['fal:h3-i2v']), preferred, thumbnails: new Map(), running: false };
    instance.aiVideoStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
    instance.generationCatalog = models;
    instance.generationThumbnails = new Map([['file:///project/candidate.mp4', Promise.resolve(undefined)]]);
    instance.body = { querySelectorAll: () => [image] };
    let reads = 0;
    instance.generationThumbnail = async () => ++reads === 1 ? undefined : 'data:image/png;base64,YQ==';
    instance.appendVideoCandidatesPanel({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'frame.png' });
    await state.thumbnailLoads.get(candidate.relativePath);
    assert.equal(reads, 2);
    assert.equal(instance.generationThumbnails.has('file:///project/candidate.mp4'), false);
    assert.equal(image.src, 'data:image/png;base64,YQ==');
  } finally { globalThis.window = oldWindow; }
});

test('費用承認を断ると batch は一度も始まらない', async () => {
  const script = ts.transpileModule(`class Widget { ${method('startVideoCandidates')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  let confirmations = 0;
  const ConfirmDialog = class { constructor(options) { assert.match(options.msg, /合計 見積/u); confirmations++; } async open() { return false; } };
  const Widget = new Function('ConfirmDialog', 'videoApprovalMessage', `${script}; return Widget;`)(ConfirmDialog, videoApprovalMessage);
  const instance = new Widget();
  const state = { selected: new Set(['fal:h3-i2v', 'fal:kling']), estimate, running: false };
  instance.aiVideoStates = new Map([['clip-1', state]]);
  instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
  instance.generationCatalog = models;
  instance.generationDrafts = new Map([['clip-1', { modelId: 'fal:h3-i2v', inputs: {}, output: {} }]]);
  instance.persistGenerationDraft = async () => {};
  instance.refreshVideoEstimate = async () => {};
  instance.renderVideoCandidates = () => {};
  let starts = 0;
  instance.layerAudioService = { startGenerateVideoBatch: () => { starts++; } };
  await instance.startVideoCandidates({ key: 'clip-1', itemId: 'clip-1' });
  assert.equal(confirmations, 1);
  assert.equal(starts, 0);
});

test('1 案の成功時だけ自動採用し、2 案は選択待ち', async () => {
  const script = ts.transpileModule(`class Widget { ${method('startVideoCandidates')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const ConfirmDialog = class { async open() { return true; } };
  const Widget = new Function('ConfirmDialog', 'videoApprovalMessage', `${script}; return Widget;`)(ConfirmDialog, videoApprovalMessage);
  for (const count of [1, 2]) {
    const instance = new Widget();
    const routes = ['fal:h3-i2v', 'fal:kling'].slice(0, count);
    const candidates = routes.map((route, index) => ({ route, ok: true,
      relativePath: `assets/generated/candidates/clip-1/${index}.mp4`, status: 'done', durationSeconds: 6 }));
    const state = { selected: new Set(routes), estimate, running: false };
    instance.aiVideoStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    instance.generationCatalog = models;
    instance.generationDrafts = new Map([['clip-1', { modelId: 'fal:h3-i2v', inputs: {}, output: {} }]]);
    instance.generationStates = new Map(); instance.generationLoads = new Set();
    instance.persistGenerationDraft = async () => {};
    instance.refreshVideoEstimate = async () => {};
    instance.renderVideoCandidates = () => {};
    instance.syncVideoProgressRows = () => {};
    instance.refreshVideoTimelineProgress = () => {};
    instance.pollVideoCandidates = async () => {};
    instance.loadGeneration = async () => {};
    let adopts = 0;
    instance.adoptVideoCandidate = async () => { adopts++; };
    let starts = 0;
    instance.layerAudioService = { startGenerateVideoBatch: async request => { starts++; assert.equal(request.approved, true); return { candidates }; },
      readVideoCandidates: async () => ({ routes, completed: count, candidates, results: candidates, running: false }) };
    await instance.startVideoCandidates({ key: 'clip-1', itemId: 'clip-1' });
    assert.equal(starts, 1);
    assert.equal(adopts, count === 1 ? 1 : 0);
  }
});

test('1 案の自動採用は再読込の後に 1 手だけ積み、undo 1 回で枠と sources を戻す', async () => {
  const script = ts.transpileModule(`class Widget { ${method('startVideoCandidates')}\n${method('adoptVideoCandidate')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const ConfirmDialog = class { async open() { return true; } };
  const Widget = new Function('ConfirmDialog', 'videoApprovalMessage', 'replaceVideoInEdit',
    `${script}; return Widget;`)(ConfirmDialog, videoApprovalMessage, replaceVideoInEdit);
  const instance = new Widget();
  const root = { toString: () => 'file:///project' };
  const candidate = { route: 'fal:h3-i2v', ok: true, status: 'done',
    relativePath: 'assets/generated/candidates/clip-1/one.mp4', durationSeconds: 4 };
  let edit = { version: 2, sources: [{ id: 'still', path: 'frame.png' }], tracks: [{ items: [
    { id: 'clip-1', source: { kind: 'media', src: 'still', in: 0, out: 6 } }
  ] }] };
  const original = structuredClone(edit);
  const history = [], order = [];
  instance.stillWidgetManager = { getWidgets: () => [{ isDisposed: false, location: { root },
    commitEditMutation: async (_label, mutate) => {
      order.push('commit'); history.push(structuredClone(edit)); edit = mutate(structuredClone(edit));
    } }] };
  instance.aiVideoStates = new Map([['clip-1', { selected: new Set([candidate.route]), estimate,
    running: false, thumbnails: new Map() }]]);
  instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
  instance.generationCatalog = models;
  instance.generationDrafts = new Map([['clip-1', { modelId: candidate.route, inputs: {}, output: {} }]]);
  instance.generationDone = new Map(); instance.generationStates = new Map(); instance.generationLoads = new Set();
  instance.persistGenerationDraft = async () => {};
  instance.refreshVideoEstimate = async () => {};
  instance.refreshVideoTimelineProgress = async () => {};
  instance.syncVideoProgressRows = () => {};
  instance.renderVideoCandidates = () => {};
  instance.pollVideoCandidates = async () => {};
  instance.loadGeneration = async () => { order.push('load'); };
  instance.layerAudioService = { startGenerateVideoBatch: async () => ({ candidates: [candidate] }),
    readVideoCandidates: async () => ({ routes: [candidate.route], completed: 1,
      candidates: [candidate], results: [candidate], running: false }) };
  await instance.startVideoCandidates({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'frame.png' });
  assert.deepEqual(order, ['load', 'commit']);
  assert.equal(history.length, 1);
  assert.equal(edit.sources.find(source => source.id === 'gen-clip-1-video')?.path, candidate.relativePath);
  assert.equal(edit.tracks[0].items[0].source.src, 'gen-clip-1-video');
  edit = history.pop();
  assert.deepEqual(edit, original);
});
