import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';

// issue #69 の調査で見つかった無言のデータ喪失の経路を固定する。
// 書き戻しは「現在の射影にあって送信された射影に無い item」を削除する設計なので、
// クリップ系の書き戻しがタブの古い summary キャッシュを送ると、その間に別の書き手
// （アプリのタイムライン・CLI）が足したクリップが、削除操作なしで消える。
const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PROJECT = path.resolve(PACKAGE_ROOT, '..', '..', 'test-project');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);

function twoCutEdit() {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'source.mp4' }],
    tracks: [
      {
        id: 'v1',
        lane: 'visual',
        items: [
          { id: 'cut-a', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
          { id: 'cut-b', at: 60, duration: 60, source: { kind: 'media', src: 'main', in: 2, out: 4 } },
        ],
      },
    ],
  };
}

/** 別の書き手（アプリのタイムライン・CLI 相当）が 3 本目を足した状態。 */
function threeCutEdit() {
  const edit = twoCutEdit();
  edit.tracks[0].items.push(
    { id: 'cut-c', at: 120, duration: 60, source: { kind: 'media', src: 'main', in: 4, out: 6 } }
  );
  return edit;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // サーバ起動待ち
    }
    if (Date.now() > deadline) throw new Error(`server did not start: ${url}`);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

function readEdit(project) {
  return JSON.parse(fs.readFileSync(path.join(project, 'edit.json'), 'utf8'));
}

function itemIds(edit) {
  return (edit.tracks ?? []).flatMap(track => (track.items ?? []).map(item => item.id));
}

test('クリップ系の書き戻しは送信前に状態を取り直し、別の書き手が足したクリップを消さない', {
  timeout: 60000,
}, async (t) => {
  if (!SYSTEM_CHROME || !fs.existsSync(SYSTEM_CHROME)) {
    t.skip('system Chrome is unavailable');
    return;
  }
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-cut-write-staleness-'));
  let server = null;
  let browser = null;
  try {
    fs.cpSync(SOURCE_PROJECT, project, { recursive: true });
    fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(twoCutEdit(), null, 2)}\n`);

    let port;
    try { port = await freePort(); }
    catch (error) {
      if (error?.code === 'EPERM') { t.skip('local listen is unavailable in this sandbox'); return; }
      throw error;
    }
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [
      'src/server.mjs', project, '--port', String(port), '--no-lint',
    ], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverError = '';
    server.stderr.on('data', chunk => { serverError += chunk; });
    await waitForServer(`${base}/api/codec-info`);

    browser = await chromium.launch({ headless: true, executablePath: SYSTEM_CHROME });
    const page = await browser.newPage();
    // WS を隔離して reload 通知を届かせない。こうすると「タブが外の変更を知らないまま
    // 編集を送る」状況を決定論的に作れる（実機では通知の取りこぼし・バックグラウンドタブ）。
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(`${base}/?frameEngine=0`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => Number(document.getElementById('seek')?.max) > 0);

    // 別の書き手がクリップを 1 本足す。WS は隔離済みなのでタブのキャッシュは 2 本のまま。
    fs.writeFileSync(path.join(project, 'edit.json'), `${JSON.stringify(threeCutEdit(), null, 2)}\n`);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(itemIds(readEdit(project)), ['cut-a', 'cut-b', 'cut-c']);
    assert.equal(
      await page.evaluate(() => window.akari?.state?.summary?.cuts?.length ?? null),
      2,
      'タブの summary キャッシュが古いままであること（この前提が崩れるとテストの意味が無い）'
    );

    // 1 本目のクリップを UI から編集する（送信前の取り直しが無いと 3 本目が消える）。
    await page.evaluate(() => {
      const seek = document.getElementById('seek');
      seek.value = '0.25';
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      seek.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForSelector('#cut-inp-to-type', { state: 'visible' });
    const requests = [];
    page.on('request', request => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
    await page.selectOption('#cut-inp-to-type', 'dissolve');
    await page.fill('#cut-inp-to-dur', '0.4');
    const [response] = await Promise.all([
      page.waitForResponse(candidate => candidate.url().endsWith('/api/edit.json')
        && candidate.request().method() === 'PUT'),
      page.click('#cut-apply-btn'),
    ]);
    assert.equal(response.status(), 200, `PUT failed: ${serverError}`);

    const saved = readEdit(project);
    assert.deepEqual(itemIds(saved), ['cut-a', 'cut-b', 'cut-c'],
      '別の書き手が足した cut-c が、クリップ編集の書き戻しで消えてはいけない');
    const edited = saved.tracks[0].items.find(item => item.id === 'cut-a');
    assert.deepEqual(edited.source.transition_out, { type: 'dissolve', duration: 0.4 });
    // 送信前に現在の状態を取り直していること（PUT の直前に summary の GET がある）。
    const putIndex = requests.lastIndexOf('PUT /api/edit.json');
    assert.ok(
      requests.slice(0, putIndex).includes('GET /api/summary'),
      `PUT の前に /api/summary の取り直しが無い: ${JSON.stringify(requests)}`
    );
  } finally {
    if (browser) await browser.close();
    if (server) server.kill('SIGKILL');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
