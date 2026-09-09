#!/usr/bin/env node
/**
 * L1（実機 Electron / quick export）— 同じ動画を V1 / V2 に重ねたプロジェクトを
 * アプリで開き、書き出しボタン（quick export の一発経路）を押して mp4 が出来ることと、
 * 重なり区間で上下 2 本の音が両方鳴っていることを ffprobe + Goertzel で実測する。
 *
 * 対象の不具合: gap-aware amix の出力 PTS が ffmpeg 8.1.x で壊れ、
 * cut-audio が 0.011s に潰れて `final ffprobe verification failed` になる件。
 *
 * 隔離: AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir / ワークスペースはすべて一時ディレクトリ。
 * 本物の ~/.config/akari-video と ~/.akari には触らない。
 * 後始末: Electron を PID 木で kill し、user-data-dir と backend/main.js の残存 0 件を確認する。
 *
 * 検証専用スクリプト（製品コードではない）。ラッパー（検証担当）が書いた。
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const harnessDir = path.join(shellRoot, 'extensions/akari-shell-strip/evidence/quick-export-one-click');

const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const FPS = 30;
const DURATION = 6;

// /tmp は macOS では /private/tmp への symlink。Theia はワークスペースを realpath で持つ。
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-overlap-amix-')));
const workspace = path.join(work, 'project');
const akariHome = path.join(work, 'akari-home');
const userDataDir = path.join(work, 'userdata');
const configDir = path.join(work, 'theia-config');
for (const dir of [path.join(workspace, 'assets'), path.join(workspace, 'exports'), akariHome, userDataDir, configDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ffmpeg = (args) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
};

// 1 秒ごとに周波数が変わるトーン（300 + 100*floor(t) Hz）。
// 同じ動画を上下に重ねても、上段（source 6-10s）と下段（source 0-6s）の音が別の周波数になるので
// 「重なり区間で 2 音鳴っているか」を 1 本の素材で測れる。
const sourceWav = path.join(work, 'source.wav');
const sourceMp4 = path.join(workspace, 'assets', 'source.mp4');
ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(300+100*floor(t))*t):d=10:s=48000', '-ac', '1', sourceWav]);
ffmpeg(['-f', 'lavfi', '-i', `color=c=0x203040:s=320x180:r=${FPS}:d=10`, '-i', sourceWav,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
  '-shortest', sourceMp4]);

// 上段トラックを先に宣言する = cuts 配列の先頭が「at>0 かつ in がフレーム境界外」になる並び。
// この並びでないと現行（修正前）でも書き出しが通ってしまう（ラッパー実測）。
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/source.mp4' }],
  tracks: [
    { id: 'visual-upper', lane: 'visual',
      items: [{ id: 'upper', at: 60, duration: 120, source: { kind: 'media', src: 'main', in: 6, out: 10 } }] },
    { id: 'visual-lower', lane: 'visual',
      items: [{ id: 'lower', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } }] },
  ],
};
fs.writeFileSync(path.join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

// Electron の子プロセスへ渡る（harness.launchElectron は process.env を継承する）。
process.env.AKARI_HOME = akariHome;
delete process.env.ELECTRON_RUN_AS_NODE;

const {
  launchElectron, assertNoOrphans, connectAndWaitReady, clickMenuIcon,
  quickInputProbe, installErrorCounter, errorLog, toastLog, sleep, evalMain, realClick,
} = await import(path.join(harnessDir, 'harness.mjs'));

// v0.1.60 のメニューは「書き出し…」→ 書き出しダイアログ →「書き出す — …」の 2 段。
// harness の clickButtonByText は完全一致なので、前方一致で押すヘルパーを足す。
const probeButton = (cdp, prefix) => evalMain(cdp, `(() => {
  const el = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim().startsWith(${JSON.stringify(prefix)}) && b.getBoundingClientRect().width > 0);
  if (!el) return { found: false, buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean).slice(0, 60) };
  if (el.disabled) return { found: false, disabled: true, title: el.title };
  const r = el.getBoundingClientRect();
  return { found: true, label: el.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const clickButtonStartingWith = async (cdp, prefix, attempts = 40) => {
  let found;
  for (let i = 0; i < attempts; i += 1) {
    found = await probeButton(cdp, prefix);
    if (found.found) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!found.found) throw new Error(`button not clickable: ${prefix} ${JSON.stringify(found)}`);
  // 座標クリックだと重なった要素に吸われることがある（メニューは縦に長くスクロールする）。
  // まず elementFromPoint で当たりを確かめ、当たらなければ要素自身の click() を撃つ。
  const hit = await evalMain(cdp, `(() => {
    const el = document.elementFromPoint(${found.x}, ${found.y});
    return { tag: el ? el.tagName : null, text: el ? el.textContent.trim().slice(0, 60) : null };
  })()`);
  if (hit.text && hit.text.startsWith(prefix.slice(0, 3))) {
    await realClick(cdp, found.x, found.y);
  } else {
    await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim().startsWith(${JSON.stringify(prefix)}) && b.getBoundingClientRect().width > 0);
      el.click();
      return true;
    })()`);
  }
  return { label: found.label, hit };
};
const dialogText = (cdp) => evalMain(cdp, `(() => {
  const el = document.querySelector('.akari-export-dialog-host')
    || Array.from(document.querySelectorAll('[role="dialog"]')).pop();
  return el ? el.textContent.trim() : null;
})()`);

const CDP_PORT = 9351;
const report = { workspace: workspace, akariHome, userDataDir, steps: [] };
const note = (step, detail) => { report.steps.push({ step, detail }); console.log(step, JSON.stringify(detail)); };

const child = launchElectron({
  workspaceDir: workspace, cdpPort: CDP_PORT, userDataDir,
  themeConfigDir: configDir, logPath: path.join(work, 'electron.log'),
});
report.pid = child.pid;

try {
  const cdp = await connectAndWaitReady(CDP_PORT);
  await installErrorCounter(cdp);
  note('app-ready', true);

  await clickMenuIcon(cdp);
  await sleep(1500);
  note('menu-export-button', await clickButtonStartingWith(cdp, '書き出し…'));
  await sleep(2500);
  note('dialog-opened', (await dialogText(cdp))?.slice(0, 200) ?? null);

  try {
    note('start-button', await clickButtonStartingWith(cdp, '書き出す'));
  } catch (error) {
    report.startButtonDiagnostics = {
      message: String(error).slice(0, 400),
      consoleErrors: await errorLog(cdp),
      toasts: await toastLog(cdp),
      overlays: await evalMain(cdp, `Array.from(document.querySelectorAll('.dialogOverlay, .dialogBlock, [role="dialog"], .akari-export-dialog-host'))
        .map(e => ({ cls: e.className, role: e.getAttribute('role'), visible: e.getBoundingClientRect().width > 0, text: e.textContent.trim().slice(0, 160) }))`),
      lastBodyChildren: await evalMain(cdp, `Array.from(document.body.children).map(e => e.className || e.tagName).slice(-12)`),
    };
    report.started = false;
  }
  const probes = [];
  for (let i = 0; i < 3; i += 1) { await sleep(1000); probes.push(await quickInputProbe(cdp)); }
  note('quick-input-probes', probes);

  const renderStatePath = path.join(workspace, '.akari', 'render.json');
  const renderPhase = () => {
    try { return JSON.parse(fs.readFileSync(renderStatePath, 'utf8')).phase; } catch { return null; }
  };
  const seenPhases = [];
  let text = '';
  for (let i = 0; i < 900 && report.started !== false; i += 1) {
    const phase = renderPhase();
    if (phase && !seenPhases.includes(phase)) seenPhases.push(phase);
    text = (await dialogText(cdp)) ?? '';
    if (text.includes('書き出し完了') || phase === 'verified') break;
    if (text.includes('書き出し失敗') || text.includes('lint NG') || phase === 'error') break;
    await sleep(1000);
  }
  note('render-json-phases', seenPhases);
  note('dialog-text', text.slice(0, 400));
  report.renderPhases = seenPhases;
  report.exportSucceeded = text.includes('書き出し完了') || renderPhase() === 'verified';
  report.consoleErrors = await errorLog(cdp);
  report.toasts = await toastLog(cdp);
  const renderJsonPath = path.join(workspace, '.akari', 'render.json');
  report.renderJson = fs.existsSync(renderJsonPath)
    ? JSON.parse(fs.readFileSync(renderJsonPath, 'utf8')) : null;
} finally {
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  report.orphanSweep = await assertNoOrphans(child.pid, userDataDir);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const psCount = (needle) => {
  const out = execSync(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(needle)} | grep -v grep || true`,
    { encoding: 'utf8' }).trim();
  return out ? out.split('\n').length : 0;
};
report.survivingUserDataDirProcesses = psCount(userDataDir);
report.survivingBackendMainJs = psCount(path.join(shellRoot, 'lib/backend/main.js'));

// --- 出来上がった mp4 の実測 -------------------------------------------------
const exportsDir = path.join(workspace, 'exports');
report.exportsListing = fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir).sort() : [];
const produced = report.exportsListing
  .filter((name) => name.endsWith('.mp4'))
  .map((name) => path.join(exportsDir, name));
report.producedMp4 = produced.map((p) => path.basename(p));

if (produced.length > 0) {
  const target = produced[0];
  const probe = JSON.parse(execSync(
    `${JSON.stringify(FFPROBE)} -v error -show_entries format=duration:stream=codec_type,codec_name,duration -of json ${JSON.stringify(target)}`,
    { encoding: 'utf8' },
  ));
  report.ffprobe = probe;
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const video = probe.streams.find((s) => s.codec_type === 'video');
  report.audioDuration = Number(audio?.duration);
  report.videoDuration = Number(video?.duration);
  report.formatDuration = Number(probe.format?.duration);
  report.audioDurationMatchesOutput = Math.abs(report.audioDuration - DURATION) <= 0.05;
  report.audioMatchesVideoDuration = Math.abs(report.audioDuration - report.videoDuration) <= 0.05;

  // Goertzel（0.25 秒窓）。窓内で整数周期になるよう 48kHz / 12000 サンプル。
  const pcm = spawnSync(FFMPEG, ['-v', 'error', '-i', target, '-map', '0:a:0',
    '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 }).stdout;
  const tone = (frequency, at) => {
    const rate = 48000;
    const count = rate / 4;
    const start = Math.round(at * rate);
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / rate);
    let previous = 0;
    let beforePrevious = 0;
    for (let i = 0; i < count; i += 1) {
      const value = pcm.readFloatLE((start + i) * 4) + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = value;
    }
    return (2 * Math.sqrt(Math.max(0, previous ** 2 + beforePrevious ** 2
      - coefficient * previous * beforePrevious))) / count;
  };
  // 出力 t での期待周波数: 下段 = source t（300+100*floor(t)）/ 上段 = source 6+(t-2)（= t+4）。
  const measurements = [];
  for (const at of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
    const lowerHz = 300 + 100 * Math.floor(at);
    const upperHz = 300 + 100 * Math.floor(at + 4);
    measurements.push({
      at,
      lower: { hz: lowerHz, amplitude: Number(tone(lowerHz, at).toFixed(5)) },
      upper: { hz: upperHz, amplitude: Number(tone(upperHz, at).toFixed(5)) },
      inOverlap: at >= 2,
    });
  }
  report.tones = measurements;
  report.bothTonesAudibleInOverlap = measurements
    .filter((m) => m.inOverlap)
    .every((m) => m.lower.amplitude > 0.05 && m.upper.amplitude > 0.05);
  report.upperSilentBeforeOverlap = measurements
    .filter((m) => !m.inOverlap)
    .every((m) => m.upper.amplitude < 0.02 && m.lower.amplitude > 0.05);
}

const scrub = (value) => value
  .split(repoRoot).join('<WORKTREE>')
  .split(work).join('<TMP>')
  .split(fs.realpathSync(os.tmpdir())).join('<TMP>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');

const outPath = path.join(here, 'l1-quick-export-overlap.json');
fs.writeFileSync(outPath, `${scrub(JSON.stringify(report, null, 2))}\n`);
console.log(scrub(JSON.stringify(report, null, 2)));

fs.rmSync(work, { recursive: true, force: true });

const failures = [];
if (!report.exportSucceeded) failures.push('quick export did not report 書き出し完了');
if (report.producedMp4.length === 0) failures.push('no mp4 was produced');
if (report.audioDurationMatchesOutput !== true) failures.push('audio duration != output duration');
if (report.audioMatchesVideoDuration !== true) failures.push('audio duration != video duration');
if (report.bothTonesAudibleInOverlap !== true) failures.push('overlap does not carry both tones');
if (report.upperSilentBeforeOverlap !== true) failures.push('upper tone leaked before its at');
if (report.survivingUserDataDirProcesses !== 0) failures.push('Electron survived the L1');
if (report.survivingBackendMainJs !== 0) failures.push('backend/main.js survived the L1');
if (failures.length > 0) {
  console.error(`L1 FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('L1 PASS');
