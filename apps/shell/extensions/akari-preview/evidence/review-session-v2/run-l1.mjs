#!/usr/bin/env node
// L1: v2 プロジェクト（version 2 の edit.json）で録音レビューセッションを実機記録する。
// 出力 = review/sessions/s-XXXX/ の記録原本 4 点 + strokes.json。compile への接続は
// compile-recorded-session.mjs が担う（本スクリプトは記録側だけを観測する）。
//
// usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port>
//   shell-dir   : apps/shell の絶対パス
//   project-dir : 一時ディレクトリの realpath 配下に置いた隔離プロジェクト
//   evidence-dir: スクショ・観測 JSON の出力先
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, listTargets, evalOn, realDrag, screenshot } from '../preview-writeback-v2/scripts/cdp-lib.mjs';

const [shellDirArg, projectDirArg, evidenceDirArg, portArg] = process.argv.slice(2);
if (!shellDirArg || !projectDirArg || !evidenceDirArg || !portArg) {
  throw new Error('usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port>');
}
const port = Number(portArg);
const shellDir = await realpath(shellDirArg);
const projectDir = await realpath(projectDirArg);
// macOS の /tmp は symlink。realpath でない作業ディレクトリを渡すと Theia の workspace
// 境界判定と URI が食い違い、プレビューが空になる（item-keyframes evidence と同じ地雷）。
const REALPATH_TMP_PREFIX = ['', 'private', 'tmp', ''].join(path.sep);
assert.ok(projectDir.startsWith(REALPATH_TMP_PREFIX),
  'project must live under the realpath of the temp dir, not the /tmp symlink');
const evidenceDir = path.resolve(evidenceDirArg);
await mkdir(evidenceDir, { recursive: true });

const userDataDir = path.join(path.dirname(projectDir), 'udd');
const akariHome = path.join(path.dirname(projectDir), 'akari-home');
await mkdir(userDataDir, { recursive: true });
await mkdir(akariHome, { recursive: true });

const editUri = pathToFileURL(path.join(projectDir, 'edit.json')).href;
// test-project の visual トラックは cut-1 = timeline 0〜5 秒 / cut-2 = timeline 5〜10 秒。
const SEEK_SECONDS = 7;
const observations = [];
const record = (step, value) => {
  observations.push({ step, ...value });
  console.log(`[${step}] ${JSON.stringify(value)}`);
};

const waitFor = async (label, predicate, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`timed out: ${label}; last=${JSON.stringify(last)}`);
};

const electronBinary = path.join(
  shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
);
// マイク実機を使わない（無人実行・権限ダイアログ回避）。Chromium の合成入力で
// getUserMedia を成立させ、記録経路そのものだけを観測する。
const child = spawn(electronBinary, [
  shellDir, projectDir,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-sandbox',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-capture'
], {
  env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: userDataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => process.stdout.write(`[electron] ${chunk}`));
child.stderr.on('data', chunk => process.stderr.write(`[electron!] ${chunk}`));
record('electron-spawned', { pid: child.pid });

let main;
let failure;
try {
  const pageTarget = await waitFor('devtools target', async () => {
    const targets = await listTargets(port).catch(() => []);
    return targets.find(target => target.type === 'page') ?? false;
  }, 120_000);
  main = new CDP(pageTarget.webSocketDebuggerUrl);
  await main.connect(15_000);
  await main.send('Page.enable', {}, 15_000);
  await main.send('Runtime.enable', {}, 15_000);
  await waitFor('theia ready',
    () => evalOn(main, 'Boolean(window.theia && window.theia.container)'), 120_000);

  const runCommand = (id, argument) => evalOn(main, `(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function'
      && typeof key.prototype?.registerCommand === 'function');
    if (!commandClass) return false;
    await window.theia.container.get(commandClass).executeCommand(
      ${JSON.stringify(id)}${argument === undefined ? '' : `, ${JSON.stringify(argument)}`}
    );
    return true;
  })()`);

  // 拡張の contribution 登録は Theia の container 初期化より後に走る。コマンドが
  // 生えるまで実行そのものをリトライする（登録待ちの単純なポーリング）。
  const runCommandWhenReady = (id, argument) => waitFor(`command ${id}`,
    () => runCommand(id, argument).then(() => true).catch(() => false), 120_000);
  await runCommandWhenReady('akari.preview.ensureVisible', { editUri });
  await runCommandWhenReady('akari.review.open');
  await waitFor('review panel mounted', () => evalOn(main,
    "Boolean(document.querySelector('[data-review-recording-toggle]'))"));
  await sleep(1500);
  await screenshot(main, path.join(evidenceDir, 'l1-01-review-panel.png'));
  record('review-panel', await evalOn(main, `(() => {
    const button = document.querySelector('[data-review-recording-toggle]');
    return { label: button.textContent, disabled: button.disabled };
  })()`));

  // cut-2（timeline 5〜10 秒 / source 5〜10 秒）の内側へ寄せる。v1 語彙の cuts[] index では
  // なく v2 の item から sourceT を解く経路が効いているかを、非ゼロの値で観測するため。
  await runCommandWhenReady('akari.preview.seekOutput', { editUri, time: SEEK_SECONDS });
  await sleep(1500);

  await waitFor('record button enabled', () => evalOn(main,
    "document.querySelector('[data-review-recording-toggle]').disabled === false"), 120_000);
  await evalOn(main, "document.querySelector('[data-review-recording-toggle]').click(); true");
  const readRecordingSection = () => evalOn(main, `(() => {
    const button = document.querySelector('[data-review-recording-toggle]');
    const indicator = document.querySelector('.akari-review-recording-indicator');
    return {
      label: button.textContent,
      indicator: indicator?.getAttribute('aria-label') ?? null,
      section: document.querySelector('[data-review-recording-section]')?.innerText?.slice(0, 300) ?? ''
    };
  })()`);
  const recording = await waitFor('recording started', async () => {
    const state = await readRecordingSection();
    return state.label === '録音終了' ? state : false;
  }, 60_000);
  record('recording-started', recording);
  await sleep(1500);

  // ペンツールで 1 本描く。strokes.json の frame（sourceT / cutIndex / itemId / trackId）が
  // 記録側の写像そのものなので、ここが v2 で解けているかを実機で観測する。
  await evalOn(main,
    "document.querySelector('[data-review-tool-mode-button=\"pen\"]').click(); true");
  await sleep(600);
  // Theia の webview は二重 iframe。DOM id が版で揺れるので、可視 iframe のうち最大のものを
  // プレビュー面として採る（録音中に前面へ出ているのはプレビュータブだけ）。
  const stageRect = await evalOn(main, `(() => {
    const rects = [...document.querySelectorAll('iframe')].map(frame => {
      const rect = frame.getBoundingClientRect();
      return {
        id: frame.id || frame.getAttribute('name') || '',
        className: String(frame.className || '').slice(0, 60),
        x: rect.x, y: rect.y, width: rect.width, height: rect.height
      };
    }).filter(rect => rect.width > 80 && rect.height > 80);
    rects.sort((left, right) => right.width * right.height - left.width * left.height);
    return { chosen: rects[0] ?? null, candidates: rects.slice(0, 5) };
  })()`);
  record('stage-rect', stageRect ?? { missing: true });
  const stage = stageRect?.chosen;
  assert.ok(stage, 'preview stage not measurable');
  const centerX = stage.x + stage.width / 2;
  const centerY = stage.y + stage.height * 0.42;
  await realDrag(main, [
    { x: centerX - 60, y: centerY - 30 },
    { x: centerX + 20, y: centerY + 10 },
    { x: centerX + 70, y: centerY + 40 }
  ], { steps: 6, stepDelayMs: 24 });
  await sleep(2500);
  await screenshot(main, path.join(evidenceDir, 'l1-02-recording.png'));

  await evalOn(main, "document.querySelector('[data-review-recording-toggle]').click(); true");
  record('recording-stopped', await waitFor('recording stopped', () => evalOn(main, `(() => {
    const button = document.querySelector('[data-review-recording-toggle]');
    return button.textContent === '録音開始' ? { label: button.textContent } : false;
  })()`), 60_000));
  await sleep(1500);
  await screenshot(main, path.join(evidenceDir, 'l1-03-stopped.png'));

  const sessionsRoot = path.join(projectDir, 'review', 'sessions');
  const sessionIds = (await readdir(sessionsRoot)).sort();
  record('sessions-on-disk', { sessionIds });
  assert.ok(sessionIds.length > 0, 'no session directory written');
  const latest = sessionIds.at(-1);
  const files = (await readdir(path.join(sessionsRoot, latest))).sort();
  const session = JSON.parse(await readFile(path.join(sessionsRoot, latest, 'session.json'), 'utf8'));
  const snapshot = JSON.parse(
    await readFile(path.join(sessionsRoot, latest, 'edit.snapshot.json'), 'utf8')
  );
  const events = (await readFile(path.join(sessionsRoot, latest, 'events.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  record('session-recorded', {
    sessionId: latest,
    files,
    status: session.status,
    snapshotVersion: snapshot.version,
    eventTypes: events.map(event => event.type),
    startTimelineT: events.find(event => event.type === 'start')?.timelineT ?? null
  });
  assert.equal(snapshot.version, 2, 'recorded snapshot must be edit.json v2');

  let strokes = null;
  try {
    strokes = JSON.parse(await readFile(path.join(sessionsRoot, latest, 'strokes.json'), 'utf8'));
  } catch { /* 描線なしのときは frame 観測を飛ばす */ }
  record('strokes-recorded', strokes
    ? {
      count: strokes.strokes.length,
      frames: strokes.strokes.map(stroke => stroke.frame)
    }
    : { missing: true });
} catch (error) {
  failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  record('failure', { message: failure.split('\n')[0] });
} finally {
  try { main?.close(); } catch { /* ignore */ }
  if (child.pid !== undefined && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(2500);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await writeFile(
    path.join(evidenceDir, 'l1-observations.json'),
    `${JSON.stringify({ observations, failed: Boolean(failure) }, null, 2)}\n`
  );
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
