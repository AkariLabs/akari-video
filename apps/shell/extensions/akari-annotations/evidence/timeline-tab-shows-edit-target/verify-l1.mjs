import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from '../t4-track-height-resize/scripts/cdp-lib.mjs';

// Usage: node verify-l1.mjs <fieldtest root>. 元の fieldtest は読むだけ（複製先で操作する）。
const evidence = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(evidence, '../../../..');
const fieldtestRoot = process.argv[2];
assert.ok(fieldtestRoot, 'fieldtest root directory is required');
const scratch = await mkdtemp(path.join(tmpdir(), 'akari-timeline-tab-caption-l1-'));
const results = [];
const PORT = 49411;

async function session(name, workspace, verify) {
  const child = spawn(path.resolve(shell, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
    shell, workspace, `--remote-debugging-port=${PORT}`,
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
    for (let attempt = 0; attempt < 180; attempt++) {
      if (exited) throw new Error(`Electron exited before UI startup: ${JSON.stringify(exited)}`);
      try {
        const target = (await listTargets(PORT)).find(target => target.type === 'page');
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
    const registered = `(() => {
      const container = window.theia.container;
      const key = [...container._bindingDictionary._map.keys()].find(key =>
        typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
      if (!key) return false;
      return !!container.get(key).getAllCommands().find(command => command.id === 'akari.annotations.open');
    })()`;
    let ready = false;
    for (let attempt = 0; attempt < 180 && !ready; attempt++) {
      ready = await evalOn(cdp, registered);
      if (!ready) await sleep(500);
    }
    assert.ok(ready, 'akari.annotations.open did not get registered');
    // 起動完了（プリロードの覆いが消える）前にコマンドを await すると、レイアウト初期化待ちで
    // 永久に解決しない（実測 2026-09-08: 負荷の高い機体で起動に 95 秒かかり、その間に叩くと固まる）。
    let started = false;
    for (let attempt = 0; attempt < 900 && !started; attempt++) {
      started = await evalOn(cdp, `(() => {
        const el = document.querySelector('.theia-preload');
        if (!el) return true;
        const style = getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
      })()`);
      if (!started) await sleep(500);
    }
    assert.ok(started, 'Theia frontend did not finish starting');
    // コマンドの Promise は await しない。configure() の reloadAll がプロジェクト次第で長引き、
    // awaitPromise:true だと CDP 側が永久に待つため（実測 2026-09-08）。タブの出現で待つ。
    await evalOn(cdp, `(() => {
      const container = window.theia.container;
      const key = [...container._bindingDictionary._map.keys()].find(key =>
        typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
      void container.get(key).executeCommand('akari.annotations.open');
      return true;
    })()`);
    await verify(cdp);
  } finally {
    cdp?.close();
    if (!exited) child.kill('SIGTERM');
    await closed;
    await writeFile(path.join(evidence, `${name}-electron.log`), output);
  }
}

/** プリロードの覆いが消えるまで待ってから、前面化して撮る（空状態票の shot() と同じ流儀）。 */
async function shot(cdp, filePath) {
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
    await sleep(800);
    for (const fromSurface of [false, true]) {
      let data;
      try {
        ({ data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface }));
      } catch { continue; }
      last = Buffer.from(data, 'base64');
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

const tabRectExpression = `(() => {
  const tab = Array.from(document.querySelectorAll('.lm-TabBar-tab')).find(el =>
    (el.querySelector('.lm-TabBar-tabLabel')?.textContent ?? '').includes('タイムライン'));
  if (!tab) return null;
  const rect = tab.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()`;

/** タブへ実マウス移動してホバーを出し、ホバー本文（= title.caption）を読む。 */
async function hoverTabCaption(cdp) {
  let rect;
  for (let attempt = 0; attempt < 600 && !rect; attempt++) {
    rect = await evalOn(cdp, tabRectExpression);
    if (!rect) await sleep(500);
  }
  assert.ok(rect, 'タイムラインタブが 300 秒以内に出なかった');
  // 直前のホバーを確実に閉じてから入り直す（HoverService は mouseleave で取り消す）。
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: Math.max(rect.y - 220, 40), button: 'none' });
  await sleep(600);
  let text = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + (attempt % 2), y: rect.y, button: 'none' });
    await sleep(700);
    text = await evalOn(cdp, `document.querySelector('.theia-hover')?.textContent ?? ''`);
    if (text.includes('タイムライン —')) return text;
  }
  return text;
}

async function record(scenario, expected, cdp, file) {
  const text = await hoverTabCaption(cdp);
  const pass = text.includes(expected);
  await shot(cdp, path.join(evidence, file));
  results.push({ scenario, expected, hoverText: text, screenshot: file, pass });
  assert.ok(pass, `${scenario}: ホバー本文に ${expected} が無い（実測: ${JSON.stringify(text)}）`);
  return text;
}

try {
  // (a) edit.json が無いプロジェクト → (b) D&D 生成後に caption が追随するか
  const empty = path.join(scratch, 'empty-project');
  await mkdir(path.join(empty, 'assets'), { recursive: true });
  await cp(path.join(fieldtestRoot, '2026-08-31-object-tree-manual-test/assets/take-a.mp4'),
    path.join(empty, 'assets/take-a.mp4'));
  await session('no-edit', empty, async cdp => {
    await record('edit.json なし', 'タイムライン — 編集データなし', cdp, '01-no-edit-hover.png');
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
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        created = await readFile(path.join(empty, 'project/edit.json'), 'utf8');
        if (JSON.parse(created).tracks.some(track => track.items?.length)) break;
      } catch { /* The drop is still being processed. */ }
      await sleep(500);
    }
    assert.ok(created && JSON.parse(created).tracks.some(track => track.items?.length),
      'D&D で project/edit.json が生成されなかった');
    await record('edit.json 生成後（再読込なし）', 'タイムライン — empty-project/project/edit.json',
      cdp, '02-created-hover.png');
  });

  // (c) edit.json を持つ実プロジェクト（fieldtest の複製。元は読むだけ）
  const withEditSource = path.join(fieldtestRoot, '2026-08-31-object-tree-manual-test');
  const withEdit = path.join(scratch, '2026-08-31-object-tree-manual-test');
  await cp(withEditSource, withEdit, { recursive: true });
  const beforeEdit = await readFile(path.join(withEdit, 'edit.json'), 'utf8');
  await session('with-edit', withEdit, async cdp => {
    await record('edit.json あり（fieldtest）', 'タイムライン — 2026-08-31-object-tree-manual-test/edit.json',
      cdp, '03-with-edit-hover.png');
    assert.equal(await readFile(path.join(withEdit, 'edit.json'), 'utf8'), beforeEdit);
  });
} catch (error) {
  results.push({ pass: false, error: String(error) });
  process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'l1-checks.json'), JSON.stringify(results, null, 2) + '\n');
  await rm(scratch, { recursive: true, force: true });
}
