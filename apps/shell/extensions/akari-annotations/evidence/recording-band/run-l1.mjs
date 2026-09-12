#!/usr/bin/env node
// L1: タイムラインの録音帯レーンを実機（Electron + CDP）で観測する。
// 由来 = evidence/review-session-v2/run-l1.mjs（同じ起動・後始末の流儀）。
//
// usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port> <mode>
//   mode = record  : 録音開始 → 帯が伸びる → 停止 → 帯が確定 を観測（v2 プロジェクト）
//   mode = existing: ディスクの既存セッションから帯が出ることだけ観測（v0 プロジェクト）
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, listTargets, evalOn, screenshot } from '../../../akari-preview/evidence/preview-writeback-v2/scripts/cdp-lib.mjs';

const [shellDirArg, projectDirArg, evidenceDirArg, portArg, modeArg] = process.argv.slice(2);
if (!shellDirArg || !projectDirArg || !evidenceDirArg || !portArg || !modeArg) {
  throw new Error('usage: run-l1.mjs <shell-dir> <project-dir> <evidence-dir> <port> <record|existing>');
}
const port = Number(portArg);
const mode = modeArg;
const shellDir = await realpath(shellDirArg);
const projectDir = await realpath(projectDirArg);
// macOS の /tmp は symlink。realpath でない作業ディレクトリだと Theia の workspace 境界判定と
// URI が食い違う（review-session-v2 evidence と同じ地雷）。
assert.equal(projectDir, path.resolve(projectDirArg),
  'project dir must be passed as a realpath (macOS の一時ディレクトリは symlink 経由だと Theia の workspace 判定と URI が食い違う)');
const evidenceDir = path.resolve(evidenceDirArg);
await mkdir(evidenceDir, { recursive: true });

const userDataDir = path.join(path.dirname(projectDir), `udd-${mode}`);
const akariHome = path.join(path.dirname(projectDir), `akari-home-${mode}`);
await mkdir(userDataDir, { recursive: true });
await mkdir(akariHome, { recursive: true });

const editUri = pathToFileURL(path.join(projectDir, 'edit.json')).href;
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

const electronBinary = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
// マイク実機は使わない（無人実行・権限ダイアログ回避）。
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

// 帯レーンの DOM を読む。要素は [data-review-session] を持ち、title に時刻が入る。
const READ_BANDS = `(() => {
  const lane = [...document.querySelectorAll('[data-review-session]')]
    .filter(node => node.classList.contains('akari-review-session-range'));
  const ruler = document.querySelector('.akari-annotations-widget');
  return {
    count: lane.length,
    bands: lane.map(node => ({
      session: node.dataset.reviewSession,
      point: node.classList.contains('is-point'),
      left: node.style.left,
      width: node.style.width,
      title: node.title,
      label: node.querySelector('span')?.textContent ?? null,
      top: node.getBoundingClientRect().top - (ruler?.getBoundingClientRect().top ?? 0),
      rectWidth: Number(node.getBoundingClientRect().width.toFixed(2))
    })),
    toggle: (() => {
      const button = document.querySelector('[data-testid="akari-timeline-review-session-ranges-toggle"]');
      return button ? { pressed: button.getAttribute('aria-pressed'), text: button.textContent } : null;
    })(),
    rulerRows: [...document.querySelectorAll('.akari-annotations-widget [style*="grid-template-rows"]')]
      .map(node => node.style.gridTemplateRows)
  };
})()`;

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
  await waitFor('theia ready', () => evalOn(main, 'Boolean(window.theia && window.theia.container)'), 120_000);

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
  const runCommandWhenReady = (id, argument) => waitFor(`command ${id}`,
    () => runCommand(id, argument).then(() => true).catch(() => false), 120_000);
  // 拡張の contribution 登録待ちで一時的に失敗する経路と、恒久的に失敗する経路を区別する。
  const tryCommand = async (id, argument, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = 'never attempted';
    while (Date.now() < deadline) {
      try {
        await runCommand(id, argument);
        record('command-ok', { id });
        return true;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await sleep(500);
    }
    record('command-failed', { id, error: String(last).slice(0, 300) });
    return false;
  };

  // akari.annotations.open は タイムライン未作成時に作成ダイアログを開いて止まるため、
  // プレビューが動画を開いたときと同じ内部コマンド（attachPassive）でタイムラインを出す。
  await tryCommand('akari.annotations.attachPassive');
  await runCommandWhenReady('akari.preview.ensureVisible', { editUri });
  // existing モードでは注釈パネルを開かない（パネル未開でもタイムラインだけで帯が出ることの確認）。
  if (mode !== 'existing') {
    await tryCommand('akari.review.open');
  }
  await waitFor('timeline mounted', () => evalOn(main,
    "Boolean(document.querySelector('.akari-annotations-widget'))"), 120_000);
  await sleep(2500);
  record('mounted', await evalOn(main, READ_BANDS));

  if (mode === 'existing') {
    // 既存（ディスク）セッションの帯が、パネルからの操作なしで出ることを観測する。
    const bands = await waitFor('bands from disk', async () => {
      const state = await evalOn(main, READ_BANDS);
      return state.count > 0 ? state : false;
    }, 60_000);
    record('bands-from-disk', bands);
    await screenshot(main, path.join(evidenceDir, `l1-${mode}-01-bands.png`));
    // 表示トグルを OFF にするとレーンが畳まれる（既定は表示）。
    await evalOn(main,
      "document.querySelector('[data-testid=\"akari-timeline-review-session-ranges-toggle\"]').click(); true");
    await sleep(800);
    record('bands-toggled-off', await evalOn(main, READ_BANDS));
    await screenshot(main, path.join(evidenceDir, `l1-${mode}-02-toggle-off.png`));
    await evalOn(main,
      "document.querySelector('[data-testid=\"akari-timeline-review-session-ranges-toggle\"]').click(); true");
    await sleep(800);
    record('bands-toggled-on', await evalOn(main, READ_BANDS));
  } else {
    await runCommandWhenReady('akari.preview.seekOutput', { editUri, time: 2 });
    await sleep(1500);
    record('before-recording', await evalOn(main, READ_BANDS));
    await screenshot(main, path.join(evidenceDir, `l1-${mode}-01-before.png`));

    await waitFor('record button enabled', () => evalOn(main,
      "document.querySelector('[data-review-recording-toggle]').disabled === false"), 120_000);
    await evalOn(main, "document.querySelector('[data-review-recording-toggle]').click(); true");
    await waitFor('recording started', async () => await evalOn(main,
      "document.querySelector('[data-review-recording-toggle]').textContent === '録音終了'"), 60_000);
    record('recording-started', await evalOn(main, READ_BANDS));

    // 再生して帯を伸ばす。プレイヘッドが進んだぶんだけ幅が増えることを 2 点で観測する。
    await runCommandWhenReady('akari.preview.togglePlayback', { editUri });
    await sleep(3000);
    const growing1 = await evalOn(main, READ_BANDS);
    record('recording-growing-1', growing1);
    await sleep(3000);
    const growing2 = await evalOn(main, READ_BANDS);
    record('recording-growing-2', growing2);
    await screenshot(main, path.join(evidenceDir, `l1-${mode}-02-recording.png`));
    await runCommandWhenReady('akari.preview.togglePlayback', { editUri });
    await sleep(800);
    // 巻き戻し seek を入れて 2 本目の帯（不連続）を作る。
    await runCommandWhenReady('akari.preview.seekOutput', { editUri, time: 0.5 });
    await sleep(2000);
    record('recording-after-seek', await evalOn(main, READ_BANDS));

    await evalOn(main, "document.querySelector('[data-review-recording-toggle]').click(); true");
    await waitFor('recording stopped', async () => await evalOn(main,
      "document.querySelector('[data-review-recording-toggle]').textContent === '録音開始'"), 60_000);
    await sleep(2500);
    const stopped = await waitFor('bands after stop', async () => {
      const state = await evalOn(main, READ_BANDS);
      return state.count > 0 ? state : false;
    }, 60_000);
    record('after-stop', stopped);
    await screenshot(main, path.join(evidenceDir, `l1-${mode}-03-stopped.png`));

    // 帯クリック → 注釈パネルの該当セッション行がハイライトされる。
    await evalOn(main, `(() => {
      const band = document.querySelector('.akari-review-session-range');
      band.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    const READ_ROWS = `(() => {
      const rows = [...document.querySelectorAll('[data-review-session]')]
        .filter(node => !node.classList.contains('akari-review-session-range'));
      return {
        rows: rows.map(row => ({
          session: row.getAttribute('data-review-session'),
          className: row.className,
          revealed: row.classList.contains('akari-review-row-revealed')
        }))
      };
    })()`;
    await sleep(400);
    record('focus-after-band-click-400ms', await evalOn(main, READ_ROWS));
    await sleep(1500);
    record('focus-after-band-click-1900ms', await evalOn(main, READ_ROWS));
    // 切り分け: focus イベント自体を手で投げても行がハイライトされないなら受け口側の問題。
    record('focus-event-direct', await evalOn(main, `(() => {
      window.dispatchEvent(new CustomEvent('akari.review.session.focus', {
        detail: { sessionId: 's-0001', editUri: ${JSON.stringify(editUri)} }
      }));
      return true;
    })()`));
    await sleep(500);
    record('focus-after-direct-event', await evalOn(main, READ_ROWS));

    const sessionsRoot = path.join(projectDir, 'review', 'sessions');
    const sessionIds = (await readdir(sessionsRoot)).sort();
    const latest = sessionIds.at(-1);
    const events = (await readFile(path.join(sessionsRoot, latest, 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    record('session-on-disk', { sessionIds, latest, events });
  }
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
    path.join(evidenceDir, `l1-observations.${mode}.json`),
    `${JSON.stringify({ observations, failed: Boolean(failure) }, null, 2)}\n`
  );
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
