import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from '../t4-track-height-resize/scripts/cdp-lib.mjs';

// Usage: node verify-l1.mjs <fieldtest directory>. Originals are only read.
const evidence = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(evidence, '../../../..');
const fieldtest = process.argv[2];
assert.ok(fieldtest, 'fieldtest directory is required');
const scratch = await mkdtemp(path.join(tmpdir(), 'akari-timeline-empty-l1-'));
const results = [];

async function session(name, workspace, verify) {
  const port = 49389;
  const child = spawn(path.resolve(shell, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
    shell, workspace, `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(scratch, `${name}-profile`)}`, '--no-sandbox'
  ], {
    cwd: shell,
    env: { ...process.env, THEIA_CONFIG_DIR: path.join(scratch, `${name}-config`) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let exited;
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const closed = new Promise(resolve => child.once('exit', (code, signal) => {
    exited = { code, signal };
    resolve();
  }));
  let cdp;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (exited) throw new Error(`Electron exited before UI startup: ${JSON.stringify(exited)}`);
      try {
        // Theia electron はフロントエンドを file:// の index.html で読む（実測 2026-09-08）。
        // http:// 前提で絞ると page target が永久に見つからないので type だけで拾う。
        const target = (await listTargets(port)).find(target => target.type === 'page');
        if (target) {
          cdp = new CDP(target.webSocketDebuggerUrl);
          await cdp.connect();
          if (await evalOn(cdp, '!!window.theia?.container')) break;
          cdp.close();
          cdp = undefined;
        }
      } catch { /* Startup is not ready yet. */ }
      await sleep(500);
    }
    assert.ok(cdp, 'Theia UI did not become ready');
    // window.theia.container が生えても拡張の registerCommand はまだ済んでいないことがある
    // （実測 2026-09-08: no active handlers）。ハンドラが載るまで待ってから叩く。
    const registered = `(() => {
      const container = window.theia.container;
      const key = [...container._bindingDictionary._map.keys()].find(key =>
        typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
      if (!key) return false;
      return !!container.get(key).getAllCommands().find(command => command.id === 'akari.annotations.open');
    })()`;
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt++) {
      ready = await evalOn(cdp, registered);
      if (!ready) await sleep(500);
    }
    assert.ok(ready, 'akari.annotations.open did not get registered');
    await evalOn(cdp, `(async () => {
      const container = window.theia.container;
      const key = [...container._bindingDictionary._map.keys()].find(key =>
        typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
      await container.get(key).executeCommand('akari.annotations.open');
    })()`);
    await verify(cdp);
    results.push({ scenario: name, pass: true });
  } finally {
    cdp?.close();
    if (!exited) child.kill('SIGTERM');
    await closed;
    await writeFile(path.join(evidence, `${name}-electron.log`), output);
  }
}

/**
 * 画面を前面に出してから撮る。バックグラウンドのウィンドウはコンポジタが新しいフレームを
 * 出さず、Page.captureScreenshot が OS 側の古いフレーム（プリロードのスピナー）を返す
 * （実測 2026-09-08）。fromSurface:false はレンダラ側から焼くのでこの依存を切れるが、
 * ウィンドウが完全に隠れていると "Unable to capture screenshot" で落ちるため、
 * 表面キャプチャへ落とし、プリロードだけの小さい PNG は撮り直す。
 */
async function shot(cdp, filePath) {
  // プリロードの覆い（暗転 + スピナー）が消えるまで待ってから撮る。
  const preloadGone = `(() => {
    const el = document.querySelector('.theia-preload');
    if (!el) return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
  })()`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evalOn(cdp, preloadGone)) break;
    await sleep(500);
  }
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    await cdp.send('Page.bringToFront').catch(() => {});
    await sleep(1500);
    for (const fromSurface of [false, true]) {
      let data;
      try {
        ({ data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface }));
      } catch { continue; }
      last = Buffer.from(data, 'base64');
      // プリロード画面（黒 + スピナー）は 20KB 未満にしかならない。実 UI は 200KB 超。
      if (last.length > 50_000) {
        await writeFile(filePath, last);
        return filePath;
      }
    }
  }
  assert.ok(last, `screenshot failed: ${filePath}`);
  await writeFile(filePath, last);
  return filePath;
}

/** 空状態ノードの枚数が expected になるまで待つ（描画は open / 生成の後に非同期で来る）。 */
async function waitForEmptyState(cdp, expected) {
  const query = `document.querySelectorAll('[data-akari-ui-label="タイムライン空状態"]').length`;
  let count = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    count = await evalOn(cdp, query);
    if (count === expected) return count;
    await sleep(500);
  }
  return count;
}

try {
  const empty = path.join(scratch, 'empty');
  await mkdir(path.join(empty, 'assets'), { recursive: true });
  await cp(path.join(fieldtest, 'assets/take-a.mp4'), path.join(empty, 'assets/take-a.mp4'));
  await session('empty-and-drop', empty, async cdp => {
    assert.equal(await waitForEmptyState(cdp, 1), 1);
    // 起動直後はまだプリロードのフレームしか焼かれていないので、初回だけ長めに落ち着かせる。
    await sleep(3000);
    await shot(cdp, path.join(evidence, '01-empty.png'));
    await evalOn(cdp, `(() => {
      const strip = document.querySelector('.akari-annotations-strip');
      const rect = strip.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/x-akari-material', JSON.stringify({
        relativePath: 'assets/take-a.mp4', kind: 'video', durationSeconds: 2
      }));
      for (const type of ['dragenter', 'dragover', 'drop']) strip.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + 20, clientY: rect.top + 40
      }));
    })()`);
    let created;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        created = await readFile(path.join(empty, 'project/edit.json'), 'utf8');
        if (JSON.parse(created).tracks.some(track => track.items?.length)) break;
      } catch { /* The drop is still being processed. */ }
      await sleep(500);
    }
    assert.ok(JSON.parse(created).tracks.some(track => track.items?.length));
    assert.equal(JSON.parse(created).sources[0].path, '../assets/take-a.mp4');
    assert.equal(await waitForEmptyState(cdp, 0), 0);
    await sleep(500);
    await shot(cdp, path.join(evidence, '02-first-clip.png'));
    await writeFile(path.join(evidence, 'created-edit.json'), created);
  });
  const existing = path.join(scratch, 'existing');
  await cp(fieldtest, existing, { recursive: true });
  const before = await readFile(path.join(existing, 'edit.json'), 'utf8');
  await session('existing', existing, async cdp => {
    await sleep(3000);
    assert.equal(await waitForEmptyState(cdp, 0), 0);
    await shot(cdp, path.join(evidence, '03-existing.png'));
    assert.equal(await readFile(path.join(existing, 'edit.json'), 'utf8'), before);
  });
} catch (error) {
  results.push({ pass: false, error: String(error) });
  process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'l1-checks.json'), JSON.stringify(results, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}
