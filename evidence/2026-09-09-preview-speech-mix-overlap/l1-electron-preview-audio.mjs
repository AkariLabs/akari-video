#!/usr/bin/env node
/**
 * L1（実機 Electron）— 同じ動画を上下 2 トラックに重ねたプロジェクトを実際のアプリで開き、
 * 出力プレビューの preview-audio-supply が重なり区間で 2 本の音声を鳴らしていることを
 * webview の window.akariFrameEngineAudioDebug() から実測する。
 *
 * 隔離: AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて一時ディレクトリ。
 * 後始末: 起動した Electron を PID 指名で kill し、user-data-dir で残存 0 件を確認する。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const require = createRequire(path.join(shellRoot, 'package.json'));
const { chromium } = require('playwright-core');

const FPS = 30;
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// macOS の /tmp は /private/tmp への symlink。Theia はワークスペースを realpath で持つので、
// editUri も realpath 側で組まないと「ワークスペース外の動画はプレビューできません」になる。
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-electron-mix-')));
const workspace = path.join(work, 'project');
const akariHome = path.join(work, 'akari-home');
const userDataDir = path.join(work, 'userdata');
const configDir = path.join(work, 'theia-config');
for (const dir of [path.join(workspace, 'assets'), path.join(workspace, 'exports'), akariHome, userDataDir, configDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ffmpeg = args => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
const sourceWav = path.join(work, 'source.wav');
const sourceMp4 = path.join(workspace, 'assets', 'source.mp4');
ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(300+100*floor(t))*t):d=10:s=48000', '-ac', '1', sourceWav]);
ffmpeg([
  '-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=10', '-i', sourceWav,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
  '-shortest', sourceMp4
]);

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/source.mp4', proxy: null }],
  tracks: [
    {
      id: 'visual-upper', lane: 'visual',
      items: [{ id: 'upper', at: 60, duration: 120, source: { kind: 'media', src: 'main', in: 6, out: 10 } }]
    },
    {
      id: 'visual-lower', lane: 'visual',
      items: [{ id: 'lower', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } }]
    }
  ]
};
fs.writeFileSync(path.join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

const freePort = async () => {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
};
const debugPort = await freePort();
const backendPort = await freePort();

const environment = { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: configDir };
delete environment.ELECTRON_RUN_AS_NODE;
const electronBinary = path.join(shellRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const logPath = path.join(work, 'electron.log');
const logStream = fs.createWriteStream(logPath);
// detached にしない: このハーネスが死ねば子も道連れにする（孤児プロセス事故の再発防止）。
const child = spawn(electronBinary, [
  shellRoot, workspace,
  `--remote-debugging-port=${debugPort}`, `--port=${backendPort}`,
  `--user-data-dir=${userDataDir}`, '--no-sandbox'
], { cwd: shellRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(logStream);
child.stderr.pipe(logStream);

const report = { pid: child.pid, steps: [] };
let browser;
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Electron exited early: ${child.exitCode}`);
    try {
      await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      break;
    } catch { await delay(1000); }
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  let page;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    page = browser.contexts().flatMap(context => context.pages()).find(item => /index\.html/u.test(item.url()));
    if (page) break;
    await delay(1000);
  }
  assert.ok(page, 'Theia frontend page did not appear');
  await page.waitForFunction(() => !document.querySelector('.theia-preload'), { timeout: 120_000 });
  report.steps.push('frontend ready');

  const editUri = `file://${path.join(workspace, 'edit.json')}`;
  const opened = await page.evaluate(async uri => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()]
      .find(entry => typeof entry === 'function' && entry.prototype?.executeCommand);
    return container.get(key).executeCommand('akari.preview.ensureVisible', { editUri: uri });
  }, editUri);
  report.steps.push(`ensureVisible: ${opened}`);
  assert.ok(opened === 'opened' || opened === 'revealed', `preview did not open: ${opened}`);

  // 出力プレビューは Theia webview（外側 iframe → 内側 active-frame）の中で動く。
  const findAudioFrame = async () => {
    for (const frame of page.frames()) {
      try {
        const ok = await frame.evaluate(() => typeof window.akariFrameEngineAudioDebug === 'function');
        if (ok) return frame;
      } catch { /* detached / cross-origin frames are simply skipped */ }
    }
    return null;
  };
  let audioFrame = null;
  for (let attempt = 0; attempt < 120 && !audioFrame; attempt += 1) {
    audioFrame = await findAudioFrame();
    if (!audioFrame) await delay(1000);
  }
  if (!audioFrame) {
    report.frames = [];
    for (const frame of page.frames()) {
      try {
        report.frames.push(await frame.evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          akariGlobals: Object.keys(window).filter(key => /^akari/iu.test(key)),
          hasEnginePreview: !!document.getElementById('frame-engine-preview'),
          bodyPreview: document.body ? document.body.innerHTML.slice(0, 200) : null
        })));
      } catch (error) { report.frames.push({ url: frame.url(), error: String(error).slice(0, 160) }); }
    }
    report.targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      .then(list => list.map(entry => ({ type: entry.type, url: entry.url })));
    fs.writeFileSync(path.join(here, 'l1-electron-frames-debug.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  assert.ok(audioFrame, 'preview webview never exposed akariFrameEngineAudioDebug()');
  report.steps.push('preview webview attached');

  // 重なり区間（出力 2-6 秒）へ移動して再生し、予定表が組まれるのを待つ。
  // 操作はアプリ本体のコマンド（実機の再生経路）で行う。
  const command = async (id, argument) => page.evaluate(async ({ commandId, request }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()]
      .find(entry => typeof entry === 'function' && entry.prototype?.executeCommand);
    return container.get(key).executeCommand(commandId, request);
  }, { commandId: id, request: argument });
  report.steps.push(`seekOutput: ${await command('akari.preview.seekOutput', { editUri, time: 3 })}`);
  report.steps.push(`togglePlayback: ${await command('akari.preview.togglePlayback', { editUri })}`);
  let debugState = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    debugState = await audioFrame.evaluate(() => window.akariFrameEngineAudioDebug());
    if (debugState.scheduled.itemCount > 0) break;
    await delay(500);
  }
  report.audioDebug = {
    phase: debugState.supply.phase,
    required: debugState.supply.required,
    ready: debugState.supply.ready,
    failed: debugState.supply.failed,
    noAudio: debugState.supply.noAudio,
    playing: debugState.playing,
    scheduled: debugState.scheduled,
    speechDecodeSources: debugState.speechDecode?.sources ?? null
  };
  report.steps.push(`scheduled.speech=${debugState.scheduled.speech}`);
  assert.equal(debugState.scheduled.speech, 2,
    `preview must schedule both overlapped clip audios (got ${debugState.scheduled.speech})`);
  assert.deepEqual(debugState.scheduled.skipped, [], 'no scheduled speech item may be skipped');
} finally {
  try { if (browser) await browser.close(); } catch { /* the CDP socket dies with the app */ }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  for (let attempt = 0; attempt < 40 && child.exitCode === null && child.signalCode === null; attempt += 1) {
    await delay(250);
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  await delay(1000);
}

const survivors = spawnSync('/bin/sh', ['-c',
  `ps -eo pid,ppid,args | grep -F ${JSON.stringify(userDataDir)} | grep -v grep || true`
], { encoding: 'utf8' }).stdout.trim();
const backendSurvivors = spawnSync('/bin/sh', ['-c',
  `ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(shellRoot, 'lib/backend/main.js'))} | grep -v grep || true`
], { encoding: 'utf8' }).stdout.trim();
report.survivingProcesses = survivors ? survivors.split('\n').length : 0;
report.survivingBackendMainJs = backendSurvivors ? backendSurvivors.split('\n').length : 0;

const scrub = value => value
  .split(repoRoot).join('<WORKTREE>')
  .split(os.homedir()).join('<HOME>')
  .split(work).join('<TMP>')
  .split(os.tmpdir()).join('<TMP>');
fs.writeFileSync(
  path.join(here, 'l1-electron-preview-audio.json'),
  `${scrub(JSON.stringify(report, null, 2))}\n`
);
console.log(scrub(JSON.stringify(report, null, 2)));

assert.equal(report.survivingProcesses, 0, 'Electron / Helper processes must not survive the L1');
assert.equal(report.survivingBackendMainJs, 0, 'no orphaned backend/main.js may survive the L1');
fs.rmSync(work, { recursive: true, force: true });
console.log('L1 (Electron) OK: preview scheduled 2 concurrent clip audios');
