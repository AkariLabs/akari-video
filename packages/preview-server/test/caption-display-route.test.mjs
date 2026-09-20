// GET /api/captions.json / GET /api/output/captions.json の display_policy 解決を
// HTTP の入口ごと押さえる。
//
// 押さえる退行（2026-09-20 に実際に踏んだもの）:
//   1. 入口が生の v2 edit.json を解決器へ渡す。v2 に cuts は無く tracks[].items[] から
//      導出するので cuts = [] → occurrence 0 → display_cues 0 件。字幕が「静かに 1 件も
//      出ない」状態で、応答は 200 なので正常系と区別がつかなかった
//   2. 除外フィルタ（captions 袋の source.exclude）が preview-server だけ抜けていて、
//      edit 側で除外した字幕がブラウザプレビューにだけ出ていた
//   3. output モード（edit.output.json / captions.output.json）は未解決 root を
//      そのまま返していて、display_policy を丸ごと無視していた
//
// caption-display.test.mjs が解決器そのものを直に叩くのに対し、こちらは
// 「サーバが解決器へ何を渡すか」を見る。入口が生 edit へ戻ると 1 で落ちる。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');
const sourceMedia = path.resolve(packageRoot, '..', '..', 'test-project', 'source.mp4');

const DISPLAY_POLICY = {
  mode: 'single_line_sequential',
  algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1',
  max_line_units: 6,
  minimum_fragment_duration_seconds: 0.72,
  locale: 'ja',
  break_hints: { preferred_second_starts: ['設定'] },
};

const cue = (id, start, end, text, fragments) => ({
  id, start, end, text, speaker: null, sourceRef: { segment: 0 }, edited: false,
  display_fragments: fragments,
});

const POLICY_CAPTIONS = {
  display_policy: DISPLAY_POLICY,
  captions: [
    cue('c-0001', 0, 2, '今回設定します', ['今回', '設定します']),
    cue('c-0002', 2, 4, '除外する行です', ['除外する', '行です']),
  ],
};

// cuts を持たない v2。カットは tracks[].items[] からしか導出できない。
// captions 袋の source.exclude が除外フィルタの入力になる。
const v2Edit = (excluded = []) => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'main', path: 'assets/source.mp4' }],
  tracks: [
    { id: 'v1', lane: 'visual', items: [
      { id: 'cut-1', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } },
    ] },
    { id: 'v2', lane: 'visual', items: [
      { id: 'captions', name: '字幕', at: 0, duration: 180, items: [],
        source: { kind: 'captions', path: 'captions.json', exclude: excluded } },
    ] },
  ],
});

test('GET /api/captions.json は cuts を持たない v2 でも display_cues を 0 件にせず、除外行も落とす', {
  timeout: 60_000,
}, async t => {
  const project = await makeProject(t, async root => {
    await writeFile(path.join(root, 'edit.json'), JSON.stringify(v2Edit(['c-0002'])));
    await writeFile(path.join(root, 'captions.json'), JSON.stringify(POLICY_CAPTIONS));
    // output モードも同じ解決を通ること（ここも生 root を返していた）
    await writeFile(path.join(root, 'edit.output.json'), JSON.stringify(v2Edit(['c-0002'])));
    await writeFile(path.join(root, 'captions.output.json'), JSON.stringify(POLICY_CAPTIONS));
  });
  const base = await startServer(t, project);
  if (base === null) return;

  const body = await fetchJson(`${base}/api/captions.json`);
  assert.equal(body.schema, 'caption-layout/v1', '解決済みの応答として返っていない');
  // 生 edit を渡していた頃はここが 0 件だった（応答は 200 のまま）。
  assert.ok(body.captions.length > 0, 'display_cues が 0 件（生 edit を渡す退行）');
  assert.deepEqual(body.captions.map(item => item.text), ['今回', '設定します']);
  assert.deepEqual([...new Set(body.captions.map(item => item.source_cue_id))], ['c-0001']);

  const output = await fetchJson(`${base}/api/output/captions.json`);
  assert.equal(output.schema, 'caption-layout/v1', 'output モードが未解決 root のまま');
  assert.deepEqual(output.captions.map(item => item.text), ['今回', '設定します']);
});

test('display_policy 未宣言のプロジェクトは従来どおりの応答で、output は解決できなければ未解決 root へ落ちる', {
  timeout: 60_000,
}, async t => {
  const legacyCaptions = [
    { id: 'c-0001', start: 0, end: 2, text: '今回設定します', speaker: null, sourceRef: null, edited: false },
  ];
  const project = await makeProject(t, async root => {
    await writeFile(path.join(root, 'edit.json'), JSON.stringify(v2Edit()));
    await writeFile(path.join(root, 'captions.json'), JSON.stringify(legacyCaptions));
    // v2 としても v0/v1 としても読めない中間文書。output は fail-safe に倒れる契約
    await writeFile(path.join(root, 'edit.output.json'), JSON.stringify({ version: 2, tracks: 'broken' }));
    await writeFile(path.join(root, 'captions.output.json'), JSON.stringify(POLICY_CAPTIONS));
  });
  const base = await startServer(t, project);
  if (base === null) return;

  assert.deepEqual(await fetchJson(`${base}/api/captions.json`), legacyCaptions);

  // 解決できない output は 500 で落とさず、未解決 root をそのまま返す（旧経路で描ける形）。
  const output = await fetchJson(`${base}/api/output/captions.json`);
  assert.equal(output.schema, undefined);
  assert.deepEqual(output.captions.map(item => item.id), ['c-0001', 'c-0002']);
});

async function makeProject(t, fill) {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-preview-caption-route-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await copyFile(sourceMedia, path.join(root, 'assets', 'source.mp4'));
  await fill(root);
  return root;
}

/** 起動できなければ null を返して t.skip する（サンドボックスでは listen が EPERM になる）。 */
async function startServer(t, project) {
  const port = await freePort().catch(error => {
    if (error?.code === 'EPERM') return null;
    throw error;
  });
  if (port === null) {
    t.skip('local TCP listener is unavailable in this sandbox');
    return null;
  }
  const child = spawn(process.execPath, [
    path.join(packageRoot, 'src', 'server.mjs'), project, '--port', String(port), '--no-lint',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/api/raw-edit.json`);
  return base;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.status, 200, `${url} が ${response.status}: ${text}`);
  return JSON.parse(text);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview-server did not start');
}
