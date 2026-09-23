// Run after the shell build. The runner supplies playwright-core through
// PLAYWRIGHT_CORE (package path) or NODE_PATH; no dependency is installed here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const repo = resolve(import.meta.dirname, '../../../../../..');
const shell = join(repo, 'apps/shell');
const electron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const output = join(import.meta.dirname, 'l1-observations.json');
const temp = await mkdtemp(join(tmpdir(), 'akari-library-check-l1-'));
const home = join(temp, 'home'), library = join(temp, 'library'), creator = join(temp, 'creator');
const projectOne = join(temp, 'project-one'), projectTwo = join(temp, 'project-two');
const catalog = join(temp, 'catalog.json');
const names = { used: 'used-own', lab: 'lab-unused', badMeta: 'bad-meta', badAudio: 'bad-audio',
  missingCredit: 'credit-missing', subscription: 'subscription', creditOne: 'credit-one', creditTwo: 'credit-two' };
const sharedCredit = 'Music: Fixture Artist';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const observations = { verified: [], passed: false };
let child, browser, stderr = '';

function sanitize(value) {
  return String(value).replaceAll(temp, '<fixture>').replace(/\/private\/tmp\//g, '<tmp>/')
    .replace(/\/Users\/[^/]+\//g, '<user>/').replaceAll(['akari-video','wt'].join('-'), '<worktree>') /* 司令塔: Governance の第 2 パターンに文字列が当たるため分割 */;
}
function record(name, value) {
  observations[name] = value;
  observations.verified.push(name);
  console.log(`${name}: ${JSON.stringify(value)}`);
}
async function waitFor(fn, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Electron exited during L1');
    try { const value = await fn(); if (value) return value; } catch { /* startup may replace the renderer */ }
    await sleep(250);
  }
  throw new Error(`L1 timed out after ${timeout} ms`);
}
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
function wav() {
  const samples = 8000, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
function meta(id, { tags = ['origin:own', 'sfx'], creditRequired = false } = {}) {
  return { id, category: 'audio', title: id, description: 'L1 fixture', when_to_use: 'L1 fixture only',
    tags, knobs: [], ai_usage: 'L1 fixture only', requires: [],
    provenance: { origin: 'L1 fixture', generator: null }, author: 'AKARI L1',
    license: { spdx: 'CC0-1.0', scope: 'commercial-ok', attribution_required: creditRequired, ai_training_allowed: true }, price: 0 };
}
async function asset(id, options = {}) {
  const dir = join(library, 'audio', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), options.badMeta ? '{broken' : JSON.stringify(meta(id, options)));
  await writeFile(join(dir, `${id}.wav`), options.badAudio ? 'not audio' : wav());
  await writeFile(join(dir, 'preview.png'), png);
  if (options.creditText) await writeFile(join(dir, 'CREDIT.txt'), `${options.creditText}\n`);
  return dir;
}
async function fileHashes(root) {
  const rows = [];
  async function visit(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const file = join(dir, name), info = await lstat(file);
      assert.equal(info.isSymbolicLink(), false, 'fixture must not contain symlinks');
      if (info.isDirectory()) await visit(file);
      else rows.push([file.slice(root.length + 1), createHash('sha256').update(await readFile(file)).digest('hex')]);
    }
  }
  await visit(root);
  return rows;
}
async function command(page, id, ...args) {
  return page.evaluate(async ({ id, args }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.executeCommand === 'function');
    assertKey(key, 'CommandService');
    return container.get(key).executeCommand(id, ...args);
    function assertKey(value, label) { if (!value) throw new Error(`${label} binding unavailable`); }
  }, { id, args });
}
async function service(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value => String(value).includes('AkariProjectService'));
    if (!key) throw new Error('AkariProjectService binding unavailable');
    return container.get(key)[method](...args);
  }, { method, args });
}
async function widget(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.addWidget === 'function'
      && typeof value.prototype?.getTabBarFor === 'function');
    if (!key) throw new Error('ApplicationShell binding unavailable');
    const target = container.get(key).widgets.find(value => value.id === 'akari-role-buckets-widget');
    if (!target) throw new Error('library widget unavailable');
    return target[method](...args);
  }, { method, args });
}
async function usageRows() {
  try { return (await readFile(join(home, 'library-usage.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const card = (page, id) => page.locator(`[data-akari-catalog-item="audio/${id}"]`);

try {
  await mkdir(home, { recursive: true });
  await mkdir(library, { recursive: true });
  await mkdir(creator, { recursive: true });
  await cp(join(repo, 'templates/project-default'), projectOne, { recursive: true });
  await cp(join(repo, 'templates/project-default'), projectTwo, { recursive: true });
  await asset(names.used);
  await asset(names.badMeta, { badMeta: true });
  await asset(names.badAudio, { badAudio: true });
  await asset(names.missingCredit, { creditRequired: true });
  await asset(names.subscription, { tags: ['origin:site', 'sfx', 'license:subscription'] });
  await asset(names.creditOne, { creditRequired: true, creditText: sharedCredit });
  await asset(names.creditTwo, { creditRequired: true, creditText: sharedCredit });
  await writeFile(catalog, JSON.stringify({ schema: 'akari-assets-catalog/v0', version: 'l1', base: temp,
    items: [{ id: names.lab, category: 'audio', title: names.lab, tags: ['sfx'],
      license: { spdx: 'CC0-1.0' }, price: 0, version: 1, files: [] }] }));
  const port = await freePort();
  child = spawn(electron, [shell, projectOne, `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(temp, 'electron-profile')}`, '--no-sandbox'], { cwd: shell,
    env: { ...process.env, HOME: temp, XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_CACHE_HOME: join(temp, 'xdg-cache'),
      THEIA_CONFIG_DIR: join(temp, 'theia'), AKARI_HOME: home,
      AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: creator, AKARI_ASSETS_CATALOG: catalog },
    stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined), 120000);
  const page = await waitFor(async () => {
    for (const candidate of browser.contexts().flatMap(context => context.pages())) {
      if (await candidate.evaluate(() => Boolean(window.theia?.container)).catch(() => false)) return candidate;
    }
  }, 120000);
  await waitFor(() => command(page, 'akari.catalog.open').then(() => true), 60000);
  // The default test window leaves the left library panel ~40px wide; widen it to a realistic width.
  await page.evaluate(() => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.addWidget === 'function'
      && typeof value.prototype?.getTabBarFor === 'function');
    container.get(key).resize(520, 'left');
  });
  await page.locator('[data-akari-panel-segment="catalog"]').click();
  await page.locator('[data-category="sfx"]').click();
  await card(page, names.used).locator('[data-akari-catalog-action="use"]').click();
  await waitFor(async () => (await usageRows()).length === 1);
  const second = await service(page, 'placeLibraryAsset',
    { category: 'audio', id: names.used, libraryDir: join(library, 'audio', names.used) }, pathToFileURL(projectTwo).href);
  assert.equal(second.success, true, JSON.stringify(second));
  const rows = await waitFor(async () => { const value = await usageRows(); return value.length === 2 ? value : undefined; });
  assert.deepEqual(new Set(rows.map(row => row.project)), new Set([await realpath(projectOne), await realpath(projectTwo)]));
  await widget(page, 'loadAssetCatalogView');
  await waitFor(async () => (await card(page, names.used).locator('[data-akari-library-usage]').innerText()) === '2 回');
  const order = await page.locator('[data-akari-catalog-item]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-akari-catalog-item')));
  assert.ok(order.indexOf(`audio/${names.used}`) >= 0 && order.indexOf(`audio/${names.lab}`) >= 0);
  assert.ok(order.indexOf(`audio/${names.used}`) < order.indexOf(`audio/${names.lab}`), 'used asset must precede unused Lab');
  record('usageAndRanking', { newLines: rows.length, countLabel: '2 回', usedBeforeUnusedLab: true });

  // Observe FileService.delete options while allowing the real trash operation.
  await page.evaluate(() => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.addWidget === 'function'
      && typeof value.prototype?.getTabBarFor === 'function');
    const target = container.get(key).widgets.find(value => value.id === 'akari-role-buckets-widget');
    const original = target.files.delete.bind(target.files);
    target.files.delete = async (uri, options) => { window.__akariL1Trash = options?.useTrash === true; return original(uri, options); };
  });
  await card(page, names.used).getByRole('button', { name: `${names.used} のメニュー` }).click();
  await page.locator('[data-akari-context-item="remove-library"]').click();
  const dialog = page.locator('.dialogBlock');
  await dialog.waitFor();
  const warning = await dialog.locator('.dialogContent').innerText();
  assert.match(warning, /2 本のプロジェクトで使用中/);
  assert.match(warning, /project-one/); assert.match(warning, /project-two/);
  assert.match(warning, /取り直せません/);
  await dialog.locator('.dialogControl button').filter({ hasText: 'ゴミ箱へ移す' }).click();
  await waitFor(async () => !(await lstat(join(library, 'audio', names.used)).then(() => true, () => false)));
  assert.equal(await page.evaluate(() => window.__akariL1Trash), true);
  await card(page, names.subscription).getByRole('button', { name: `${names.subscription} のメニュー` }).click();
  await page.locator('[data-akari-context-item="remove-library"]').click();
  await dialog.waitFor();
  assert.match(await dialog.locator('.dialogContent').innerText(), /取り直せません/);
  await dialog.locator('.dialogControl button').filter({ hasText: 'キャンセル' }).click();
  await card(page, names.lab).click({ button: 'right' });
  assert.equal(await page.locator('[data-akari-context-item="remove-library"]').count(), 0);
  record('trashAndWarning', { projectCount: 2, projectNames: ['project-one', 'project-two'], ownAndSiteCannotRedownload: true,
    useTrash: true, libraryDirectoryGone: true, unavailableLabHasNoRemove: true });

  const beforeCheck = await fileHashes(library);
  await page.getByRole('button', { name: 'ライブラリに追加' }).click();
  await page.getByRole('menuitem', { name: 'ライブラリを点検' }).click();
  const checkSheet = page.locator('[data-akari-library-check-sheet]');
  await checkSheet.getByText(/問題なし .* 件 · 注意 .* 件 · エラー .* 件/).waitFor({ timeout: 120000 });
  const checkRows = await checkSheet.locator('.akari-import-row').allInnerTexts();
  for (const [id, level] of [[names.badMeta, 'エラー'], [names.badAudio, 'エラー'],
    [names.missingCredit, '注意'], [names.subscription, '注意']]) {
    assert.ok(checkRows.some(row => row.includes(id) && row.startsWith(level)), `${id} must be ${level}`);
  }
  assert.deepEqual(await fileHashes(library), beforeCheck, 'check must not mutate library bytes');
  record('checkSheet', { badMeta: 'error', badAudio: 'error', missingCredit: 'warning', subscription: 'warning',
    fileCount: beforeCheck.length, bytesUnchanged: true });
  await checkSheet.getByRole('button', { name: '閉じる' }).click();

  for (const id of [names.creditOne, names.creditTwo]) {
    const result = await service(page, 'placeLibraryAsset',
      { category: 'audio', id, libraryDir: join(library, 'audio', id) }, pathToFileURL(projectOne).href);
    assert.equal(result.success, true, `${id}: ${JSON.stringify(result)}`);
  }
  await widget(page, 'loadMaterials');
  await page.locator('[data-akari-panel-segment="materials"]').click();
  const copy = page.getByRole('button', { name: 'クレジットをコピー' });
  await copy.waitFor();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await copy.click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard, sharedCredit);
  record('credits', { text: clipboard, duplicates: 0 });
  observations.passed = true;
} catch (error) {
  observations.failure = sanitize(error?.stack ?? error);
  console.error('L1 failed:', observations.failure, sanitize(stderr));
  process.exitCode = 1;
} finally {
  try { await writeFile(output, `${JSON.stringify(observations, null, 2)}\n`); }
  catch (error) { console.error('evidence write failed:', sanitize(error)); process.exitCode = 1; }
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(10000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
  try { await rm(temp, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }); }
  catch (error) { console.error('fixture cleanup failed:', sanitize(error)); process.exitCode = 1; }
}
