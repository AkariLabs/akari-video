#!/usr/bin/env node
/**
 * L1（実機 Electron）— 上のトラックに拡縮（PiP）を付けた動画クリップ（内部モデルで `layers` へ
 * 退避される）の音が、実際のアプリで鳴ることを実測する。
 *
 *  (a) 出力プレビューの再生で、重なり区間に上下 2 本の音が予定表へ載る
 *      （webview の window.akariFrameEngineAudioDebug()）
 *  (b) 書き出しボタン（メニュー →「書き出し…」→「書き出す」）で出来た mp4 の
 *      重なり区間に 2 つの周波数が立つ（Goertzel）
 *  (c) インスペクターのレイヤー「音声」を「ミュート」にすると上の音だけ消える
 *      （実 DOM の <select> を change させ、edit.json と再書き出しの mp4 で確認）
 *
 * 隔離: AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir / ワークスペースはすべて一時ディレクトリ。
 * 本物の ~/.config/akari-video と ~/.akari には触らない。Electron は detached にしない。
 * 後始末: PID 指名で kill し、user-data-dir と backend/main.js の残存 0 件を確認する。
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 */
import assert from 'node:assert/strict';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const shellRoot = path.join(repoRoot, 'apps/shell');
const harnessDir = path.join(shellRoot, 'extensions/akari-shell-strip/evidence/quick-export-one-click');
const require = createRequire(path.join(shellRoot, 'package.json'));
const { chromium } = require('playwright-core');

const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const FPS = 30;
const DURATION = 6;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// macOS の /tmp は /private/tmp への symlink。Theia はワークスペースを realpath で持つ。
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-layer-audio-')));
const workspace = path.join(work, 'project');
const akariHome = path.join(work, 'akari-home');
const userDataDir = path.join(work, 'userdata');
const configDir = path.join(work, 'theia-config');
for (const dir of [path.join(workspace, 'assets'), path.join(workspace, 'exports'), akariHome, userDataDir, configDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ffmpeg = (args) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
// 1 秒ごとに周波数が変わるトーン（300 + 100*floor(t) Hz）。同じ素材を上下に置いても
// 上段（source 6-10s）と下段（source 0-6s）の音が別の周波数になる。
const sourceWav = path.join(work, 'source.wav');
const sourceMp4 = path.join(workspace, 'assets', 'source.mp4');
ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(300+100*floor(t))*t):d=10:s=48000', '-ac', '1', sourceWav]);
ffmpeg(['-f', 'lavfi', '-i', `color=c=0x203040:s=320x180:r=${FPS}:d=10`, '-i', sourceWav,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
  '-shortest', sourceMp4]);

// tracks[] は画面の下から上。上段（配列の後ろ）に transform を付けると needsCrossTrackLayers が
// 真になり、その item だけ layers へ退避される（= 本票の対象）。
const editPath = path.join(workspace, 'edit.json');
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/source.mp4' }],
  tracks: [
    { id: 'visual-lower', lane: 'visual',
      items: [{ id: 'lower', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } }] },
    { id: 'visual-upper', lane: 'visual',
      items: [{ id: 'upper', at: 60, duration: 120, transform: { scale: 0.5 },
        source: { kind: 'media', src: 'main', in: 6, out: 10 } }] },
  ],
};
fs.writeFileSync(editPath, `${JSON.stringify(edit, null, 2)}\n`);

// 退避されていることを実機と同じ edit-store で先に確認しておく（前提の裏取り）。
const routing = JSON.parse(execFileSync(process.execPath, ['-e', `
  const s = require(${JSON.stringify(path.join(repoRoot, 'packages/edit-store/lib/index.js'))});
  const doc = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(editPath)}, 'utf8'));
  const legacy = s.projectLegacyEdit(s.readInternalEdit(doc));
  process.stdout.write(JSON.stringify({ cutIds: legacy.cuts.map(c => c.src), layerIds: legacy.layers.map(l => l.id) }));
`], { encoding: 'utf8' }));

process.env.AKARI_HOME = akariHome;
delete process.env.ELECTRON_RUN_AS_NODE;

const {
  launchElectron, assertNoOrphans, connectAndWaitReady, clickMenuIcon,
  installErrorCounter, errorLog, toastLog, sleep, evalMain, realClick,
} = await import(path.join(harnessDir, 'harness.mjs'));

const probeButton = (cdp, prefix) => evalMain(cdp, `(() => {
  const el = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim().startsWith(${JSON.stringify(prefix)}) && b.getBoundingClientRect().width > 0);
  if (!el) return { found: false };
  if (el.disabled) return { found: false, disabled: true, title: el.title };
  const r = el.getBoundingClientRect();
  return { found: true, label: el.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
const clickButtonStartingWith = async (cdp, prefix, attempts = 40) => {
  let found;
  for (let i = 0; i < attempts; i += 1) {
    found = await probeButton(cdp, prefix);
    if (found.found) break;
    await sleep(500);
  }
  if (!found.found) throw new Error(`button not clickable: ${prefix} ${JSON.stringify(found)}`);
  const hit = await evalMain(cdp, `(() => {
    const el = document.elementFromPoint(${found.x}, ${found.y});
    return { tag: el ? el.tagName : null, text: el ? el.textContent.trim().slice(0, 60) : null };
  })()`);
  if (hit.text && hit.text.startsWith(prefix.slice(0, 3))) await realClick(cdp, found.x, found.y);
  else {
    await evalMain(cdp, `(() => {
      Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim().startsWith(${JSON.stringify(prefix)}) && b.getBoundingClientRect().width > 0).click();
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
const closeDialog = (cdp) => evalMain(cdp, `(() => {
  const host = document.querySelector('.akari-export-dialog-host')
    || Array.from(document.querySelectorAll('[role="dialog"]')).pop();
  if (!host) return 'none';
  const close = Array.from(host.querySelectorAll('button'))
    .find(b => /閉じる|キャンセル/u.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0);
  if (close) { close.click(); return 'closed'; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'escape';
})()`);

// Goertzel（0.25 秒窓 = 48kHz / 12000 サンプルで各トーンが整数周期）。
const tonesOf = (target) => {
  const pcm = spawnSync(FFMPEG, ['-v', 'error', '-i', target, '-map', '0:a:0', '-ac', '1', '-ar', '48000',
    '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 }).stdout;
  const amplitude = (frequency, at) => {
    const rate = 48000;
    const count = rate / 4;
    const start = Math.round(at * rate);
    if (!pcm || (start + count) * 4 > pcm.length) return null;
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / rate);
    let previous = 0;
    let beforePrevious = 0;
    for (let i = 0; i < count; i += 1) {
      const value = pcm.readFloatLE((start + i) * 4) + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = value;
    }
    return Number(((2 * Math.sqrt(Math.max(0, previous ** 2 + beforePrevious ** 2
      - coefficient * previous * beforePrevious))) / count).toFixed(5));
  };
  return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((at) => ({
    at,
    lower: { hz: 300 + 100 * Math.floor(at), amplitude: amplitude(300 + 100 * Math.floor(at), at) },
    upper: { hz: 300 + 100 * Math.floor(at + 4), amplitude: amplitude(300 + 100 * Math.floor(at + 4), at) },
    inOverlap: at >= 2,
  }));
};
const probeOf = (target) => JSON.parse(spawnSync(FFPROBE, ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_type,codec_name,duration', '-of', 'json', target], { encoding: 'utf8' }).stdout);

const CDP_PORT = 9362;
const report = { routing, steps: [] };
const note = (step, detail) => { report.steps.push({ step, detail }); console.log(step, JSON.stringify(detail)?.slice(0, 400)); };

const renderStatePath = path.join(workspace, '.akari', 'render.json');
const renderPhase = () => {
  try { return JSON.parse(fs.readFileSync(renderStatePath, 'utf8')).phase; } catch { return null; }
};
const runExport = async (cdp, label) => {
  const exportsDir = path.join(workspace, 'exports');
  const mtimeOf = (name) => {
    try { return fs.statSync(path.join(exportsDir, name)).mtimeMs; } catch { return 0; }
  };
  const beforeMtimes = new Map((fs.existsSync(exportsDir) ? fs.readdirSync(exportsDir) : [])
    .filter((name) => name.endsWith('.mp4')).map((name) => [name, mtimeOf(name)]));
  // 前回の完了状態を残したまま待つと即座に verified を拾ってしまうので消しておく。
  try { fs.rmSync(renderStatePath); } catch { /* first run has none */ }
  // 2 回目はメニューが閉じ切っていないことがある。開き直しを含めてやり直す。
  let menu;
  for (let attempt = 1; attempt <= 4 && !menu; attempt += 1) {
    try {
      await clickMenuIcon(cdp);
      await sleep(2000);
      menu = await clickButtonStartingWith(cdp, '書き出し…', 6);
    } catch (error) {
      if (attempt === 4) throw error;
      await evalMain(cdp, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
      await sleep(2000);
    }
  }
  await sleep(4000);
  // 2 回目のダイアログは前回の完了画面を保持しており、開始ボタンが「もう一度書き出す」になる。
  let start;
  try {
    try {
      start = await clickButtonStartingWith(cdp, '書き出す', 8);
    } catch {
      // 完了画面が残っているときは「もう一度書き出す」で設定画面へ戻してから開始する。
      const again = await clickButtonStartingWith(cdp, 'もう一度書き出す', 30);
      await sleep(3000);
      start = await clickButtonStartingWith(cdp, '書き出す', 40);
      start = { label: `${again.label} → ${start.label}` };
    }
  } catch (error) {
    return {
      label, menu: menu?.label ?? null, succeeded: false, phases: [], tones: null, probe: null, sha256: null,
      startButtonDiagnostics: {
        message: String(error).slice(0, 300),
        dialog: (await dialogText(cdp))?.slice(0, 400) ?? null,
        buttons: await evalMain(cdp, `Array.from(document.querySelectorAll('button'))
          .map(b => ({ text: b.textContent.trim().slice(0, 40), disabled: b.disabled, visible: b.getBoundingClientRect().width > 0 }))
          .filter(b => b.text).slice(0, 60)`),
        toasts: await toastLog(cdp),
      },
    };
  }
  const phases = [];
  let text = '';
  await sleep(2000);
  for (let i = 0; i < 600; i += 1) {
    const phase = renderPhase();
    if (phase && !phases.includes(phase)) phases.push(phase);
    text = (await dialogText(cdp)) ?? '';
    if (text.includes('書き出し完了') || phase === 'verified') break;
    if (text.includes('書き出し失敗') || text.includes('lint NG') || phase === 'error') break;
    await sleep(1000);
  }
  const produced = fs.readdirSync(exportsDir).filter((name) => name.endsWith('.mp4'));
  const fresh = produced.filter((name) => mtimeOf(name) > (beforeMtimes.get(name) ?? 0));
  const target = path.join(exportsDir, (fresh[0] ?? produced[0] ?? 'missing.mp4'));
  const result = {
    label, menu: menu.label, start: start.label, phases,
    dialog: text.slice(0, 200), file: path.basename(target),
    freshFiles: fresh,
    succeeded: renderPhase() === 'verified' && fresh.length > 0,
    probe: fs.existsSync(target) ? probeOf(target) : null,
    tones: fs.existsSync(target) ? tonesOf(target) : null,
    sha256: fs.existsSync(target)
      ? execSync(`shasum -a 256 ${JSON.stringify(target)}`, { encoding: 'utf8' }).split(' ')[0] : null,
  };
  await closeDialog(cdp);
  await sleep(1500);
  return result;
};

const child = launchElectron({
  workspaceDir: workspace, cdpPort: CDP_PORT, userDataDir,
  themeConfigDir: configDir, logPath: path.join(work, 'electron.log'),
});
report.pid = child.pid;
let browser;

try {
  const cdp = await connectAndWaitReady(CDP_PORT);
  await installErrorCounter(cdp);
  note('app-ready', true);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let page;
  for (let attempt = 0; attempt < 120 && !page; attempt += 1) {
    page = browser.contexts().flatMap((context) => context.pages()).find((item) => /index\.html/u.test(item.url()));
    if (!page) await delay(1000);
  }
  assert.ok(page, 'Theia frontend page did not appear');
  const command = async (id, argument) => page.evaluate(async ({ commandId, request }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()]
      .find((entry) => typeof entry === 'function' && entry.prototype?.executeCommand);
    return container.get(key).executeCommand(commandId, request);
  }, { commandId: id, request: argument });

  // --- (a) 出力プレビューの再生 -------------------------------------------------
  const editUri = `file://${editPath}`;
  note('ensureVisible', await command('akari.preview.ensureVisible', { editUri }));
  const findAudioFrame = async () => {
    for (const frame of page.frames()) {
      try {
        if (await frame.evaluate(() => typeof window.akariFrameEngineAudioDebug === 'function')) return frame;
      } catch { /* detached frames are skipped */ }
    }
    return null;
  };
  let audioFrame = null;
  for (let attempt = 0; attempt < 120 && !audioFrame; attempt += 1) {
    audioFrame = await findAudioFrame();
    if (!audioFrame) await delay(1000);
  }
  assert.ok(audioFrame, 'preview webview never exposed akariFrameEngineAudioDebug()');
  note('seekOutput', await command('akari.preview.seekOutput', { editUri, time: 3 }));
  note('togglePlayback', await command('akari.preview.togglePlayback', { editUri }));
  let debugState = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    debugState = await audioFrame.evaluate(() => window.akariFrameEngineAudioDebug());
    if (debugState.scheduled.itemCount > 0) break;
    await delay(500);
  }
  report.previewAudio = {
    phase: debugState.supply.phase,
    required: debugState.supply.required,
    ready: debugState.supply.ready,
    failed: debugState.supply.failed,
    noAudio: debugState.supply.noAudio,
    playing: debugState.playing,
    scheduled: debugState.scheduled,
  };
  report.previewBothAudiosScheduled = debugState.scheduled.speech === 2
    && debugState.supply.required.some((id) => id.includes('layer-upper'));
  note('preview-scheduled-speech', { speech: debugState.scheduled.speech, required: debugState.supply.required });
  await command('akari.preview.togglePlayback', { editUri });
  await delay(1000);

  // --- (b) 書き出し（レイヤーの音が鳴る） ---------------------------------------
  report.exportWithLayerAudio = await runExport(cdp, 'layer-audio-on');
  note('export-1', { succeeded: report.exportWithLayerAudio.succeeded, phases: report.exportWithLayerAudio.phases });

  // --- (c) インスペクターでミュート -------------------------------------------
  const clipHit = await page.evaluate(() => {
    const el = document.querySelector('[data-akari-item-kind="layer"][data-akari-item-id="upper"]');
    if (!el) {
      return { found: false, candidates: Array.from(document.querySelectorAll('[data-akari-item-id]'))
        .map((node) => ({ id: node.dataset.akariItemId, kind: node.dataset.akariItemKind })) };
    }
    const rect = el.getBoundingClientRect();
    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      width: rect.width, height: rect.height };
  });
  note('layer-clip-element', clipHit);
  assert.ok(clipHit.found, 'timeline never rendered the PiP layer clip');
  await realClick(cdp, clipHit.x, clipHit.y);
  await sleep(2500);

  let audioRow = null;
  for (let attempt = 0; attempt < 40 && !audioRow?.found; attempt += 1) {
    audioRow = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select.akari-inspector-row-input'));
      const match = selects.find((select) => {
        const options = Array.from(select.options).map((option) => option.value);
        return options.includes('鳴らす') && options.includes('ミュート');
      });
      if (!match) {
        return { found: false, labels: Array.from(document.querySelectorAll('.akari-inspector-row, .akari-inspector-section'))
          .map((node) => node.textContent.trim().slice(0, 24)).slice(0, 40) };
      }
      return { found: true, value: match.value, options: Array.from(match.options).map((option) => option.value) };
    });
    if (!audioRow.found) await sleep(500);
  }
  note('inspector-audio-row', audioRow);
  assert.ok(audioRow.found, 'inspector never rendered the layer audio select');
  report.inspectorAudioFieldDefault = audioRow.value;

  const muted = await page.evaluate(() => {
    const select = Array.from(document.querySelectorAll('select.akari-inspector-row-input'))
      .find((node) => Array.from(node.options).map((option) => option.value).includes('ミュート'));
    select.value = 'ミュート';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  });
  note('inspector-set-mute', muted);
  let written = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    written = JSON.parse(fs.readFileSync(editPath, 'utf8'));
    const item = written.tracks?.[1]?.items?.[0];
    if (item?.source?.mute === true || item?.audio === false) break;
    await sleep(500);
  }
  report.editJsonAfterMute = written.tracks?.[1]?.items?.[0] ?? null;
  report.muteWrittenToEdit = report.editJsonAfterMute?.source?.mute === true
    || report.editJsonAfterMute?.audio === false;
  note('edit-json-after-mute', report.editJsonAfterMute);

  // (c-1) プレビュー側: ミュート後は予定表からレイヤーの音が消える。
  await command('akari.preview.seekOutput', { editUri, time: 3 });
  await command('akari.preview.togglePlayback', { editUri });
  // edit.json の書き込みでプレビュー webview が作り直されるので、frame を毎回引き直す。
  let mutedState = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const frame = await findAudioFrame();
    if (!frame) { await delay(1000); continue; }
    try {
      mutedState = await frame.evaluate(() => window.akariFrameEngineAudioDebug());
    } catch { await delay(1000); continue; }
    if (mutedState.scheduled.itemCount > 0
      && !mutedState.supply.required.some((id) => id.includes('layer-upper'))) break;
    await delay(500);
  }
  if (!mutedState) throw new Error('preview webview never came back after the inspector write');
  report.previewAudioAfterMute = {
    required: mutedState.supply.required, ready: mutedState.supply.ready,
    playing: mutedState.playing, scheduled: mutedState.scheduled,
  };
  report.previewLayerAudioGoneAfterMute = mutedState.scheduled.speech === 1
    && !mutedState.supply.required.some((id) => id.includes('layer-upper'));
  note('preview-after-mute', { speech: mutedState.scheduled.speech, required: mutedState.supply.required });
  await command('akari.preview.togglePlayback', { editUri });
  await delay(1000);

  report.exportAfterMute = await runExport(cdp, 'layer-audio-muted');
  note('export-2', { succeeded: report.exportAfterMute.succeeded, phases: report.exportAfterMute.phases });

  report.consoleErrors = await errorLog(cdp);
  report.toasts = await toastLog(cdp);
} catch (error) {
  report.error = String(error).slice(0, 2000);
} finally {
  try { if (browser) await browser.close(); } catch { /* the CDP socket dies with the app */ }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  await delay(2500);
  report.orphanSweep = await assertNoOrphans(child.pid, userDataDir);
  await delay(1000);
}

const psCount = (needle) => {
  const out = execSync(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(needle)} | grep -v grep || true`,
    { encoding: 'utf8' }).trim();
  return out ? out.split('\n').length : 0;
};
report.survivingUserDataDirProcesses = psCount(userDataDir);
report.survivingBackendMainJs = psCount(path.join(shellRoot, 'lib/backend/main.js'));

const overlap = (tones) => (tones ?? []).filter((row) => row.inOverlap);
// 計測が無いのに空配列の every で true になるのを避けるため、行数まで確かめる。
const allOverlap = (tones, predicate) => {
  const rows = overlap(tones);
  return rows.length === 4 && rows.every(predicate);
};
report.verdict = {
  layerRoutedToLayers: routing.layerIds.includes('upper'),
  previewBothAudiosScheduled: report.previewBothAudiosScheduled === true,
  exportBothTonesAudible: allOverlap(report.exportWithLayerAudio?.tones,
    (row) => row.lower.amplitude > 0.05 && row.upper.amplitude > 0.05),
  exportUpperSilentBeforeOverlap: (report.exportWithLayerAudio?.tones ?? [])
    .filter((row) => !row.inOverlap).length === 2
    && (report.exportWithLayerAudio?.tones ?? []).filter((row) => !row.inOverlap)
      .every((row) => row.upper.amplitude < 0.02 && row.lower.amplitude > 0.05),
  inspectorMuteWritten: report.muteWrittenToEdit === true,
  previewLayerAudioGoneAfterMute: report.previewLayerAudioGoneAfterMute === true,
  exportAfterMuteSucceeded: report.exportAfterMute?.succeeded === true,
  exportAfterMuteUpperSilent: allOverlap(report.exportAfterMute?.tones,
    (row) => row.upper.amplitude < 0.02 && row.lower.amplitude > 0.05),
  audioDurationMatchesOutput: Math.abs(Number(report.exportWithLayerAudio?.probe?.format?.duration) - DURATION) <= 0.05,
  noError: report.error === undefined,
  noSurvivingProcesses: report.survivingUserDataDirProcesses === 0 && report.survivingBackendMainJs === 0,
};

const scrub = (value) => value
  .split(repoRoot).join('<WORKTREE>')
  .split(work).join('<TMP>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
fs.writeFileSync(path.join(here, 'l1-electron-layer-audio.json'), `${scrub(JSON.stringify(report, null, 2))}\n`);
console.log(scrub(JSON.stringify(report.verdict, null, 2)));
fs.rmSync(work, { recursive: true, force: true });
assert.equal(report.survivingUserDataDirProcesses, 0, 'Electron / Helper processes must not survive the L1');
