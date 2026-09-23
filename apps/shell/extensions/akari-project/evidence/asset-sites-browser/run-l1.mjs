// Local-only Electron/CDP acceptance probe. Run after `cd apps/shell && npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { startFixtureSite } from './fixture-site.mjs';

const repo = resolve(import.meta.dirname, '../../../../../..');
const shell = join(repo, 'apps/shell');
const electron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const temp = await mkdtemp(join(tmpdir(), 'akari-asset-site-l1-'));
const catalog = join(temp, 'catalog'), project = join(temp, 'project'), library = join(temp, 'library');
let fixture;
const freePort = async () => {
  const server = createServer(); await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
let port;
let browser, child, stderr = '';
const observations = {};
function record(name, value) { observations[name] = value; console.log(name, JSON.stringify(value)); }
async function waitFor(fn, timeout = 30000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Electron exited before CDP: code=${child.exitCode} signal=${child.signalCode}`);
    }
    try { last = await fn(); if (last) return last; } catch { /* renderer can restart during boot */ }
    await sleep(300);
  }
  throw new Error(`timed out: ${JSON.stringify(last)}`);
}
async function command(page, id, ...args) {
  return page.evaluate(async ({ id, args }) => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(key =>
      typeof key === 'function' && typeof key.prototype?.executeCommand === 'function');
    if (!key) throw new Error('CommandService binding unavailable');
    return container.get(key).executeCommand(id, ...args);
  }, { id, args });
}
async function sitePage() {
  return waitFor(() => browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(fixture.base)));
}

async function sitePageAt(path) {
  return waitFor(() => browser.contexts().flatMap(context => context.pages()).find(page => page.url() === fixture.base + path), 15000);
}

async function reloadFixtureItem(mainPage) {
  await mainPage.evaluate(url => window.electronAkariProject.assetSite.navigate(url), fixture.base + '/item');
  const target = await sitePageAt('/item');
  await target.locator('#file').waitFor();
  return target;
}

async function clickSiteNavigation(locator, path, mainPage) {
  // Playwright's scheduled-navigation waiter can stall on a WebContentsView target even after its URL changes.
  // Observe the target URL and fixture request separately so a real blocked navigation still fails.
  await locator.click({ noWaitAfter: true });
  try { return await sitePageAt(path); }
  catch (error) {
    const native = await mainPage.evaluate(() => window.electronAkariProject.assetSite.inspect()).catch(() => null);
    throw new Error(`site navigation to ${path} did not complete; requests=${JSON.stringify(fixture.requests.slice(-8))}; native=${JSON.stringify(native)}; ${error}`);
  }
}

async function libraryMetas() {
  const folders = await readdir(join(library, 'audio')).catch(() => []);
  return Promise.all(folders.map(async id => ({ id,
    meta: JSON.parse(await readFile(join(library, 'audio', id, 'meta.json'), 'utf8')),
    credit: await readFile(join(library, 'audio', id, 'CREDIT.txt'), 'utf8').catch(() => null) })));
}

async function measureShellView(page, hidden = false) {
  const start = Date.now(); let dom = null, native = null, lastError = null;
  while (Date.now() - start < 12000) {
    try {
      dom = await page.evaluate(() => {
        const node = document.querySelector('[data-akari-site-surface]');
        const r = node?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
      native = await page.evaluate(() => window.electronAkariProject.assetSite.inspect());
      const b = native.viewBounds;
      const matches = hidden ? b.width === 0 && b.height === 0
        : dom && dom.width > 0 && dom.height > 0 && b.width > 0 && b.height > 0
          && ['x', 'y', 'width', 'height'].every(key => Math.abs(Math.floor(dom[key]) - b[key]) <= 2);
      if (matches) return { dom, ...native, matches: true };
    } catch (error) { lastError = String(error); }
    await sleep(200);
  }
  throw new Error(`view bounds timeout: dom=${JSON.stringify(dom)} native=${JSON.stringify(native)} error=${lastError}`);
}

async function measureShellModes(page) {
  const steps = {};
  steps.initial = await measureShellView(page);
  const otherId = await page.evaluate(async () => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.addWidget === 'function'
      && typeof value.prototype?.getTabBarFor === 'function');
    if (!key) throw new Error('ApplicationShell binding unavailable');
    const shell = container.get(key), site = shell.widgets.find(value => value.id === 'akari-asset-site-browser');
    if (!site) throw new Error('site widget unavailable');
    let other = shell.getTabBarFor(site)?.titles.find(value => value.owner !== site)?.owner;
    if (!other) {
      other = shell.widgets.find(value => value !== site && shell.getAreaFor(value) === 'main');
      if (!other) throw new Error('no other main-area widget for tab measurement');
      await shell.addWidget(other, { area: 'main', mode: 'tab-after', ref: site });
    }
    window.__assetSiteShellProbe = { shell, site, other };
    await shell.activateWidget(other.id);
    return other.id;
  });
  steps.tabHidden = { otherId, ...await measureShellView(page, true) };
  assert.equal(steps.tabHidden.viewBounds.width, 0);
  await page.evaluate(async () => {
    const { shell, site, other } = window.__assetSiteShellProbe;
    await shell.activateWidget(site.id);
    await shell.addWidget(site, { area: 'main', mode: 'split-right', ref: other });
    await shell.activateWidget(site.id);
  });
  steps.split = await measureShellView(page);
  assert.ok(steps.split.dom.width > 0 && steps.split.viewBounds.width > 0 && steps.split.matches,
    'split must retain a visible site surface aligned with WebContentsView');
  assert.ok(steps.split.dom.width < steps.initial.dom.width, 'split must narrow the widget');
  const original = steps.split.windowBounds;
  await page.evaluate(bounds => window.electronAkariProject.assetSite.testWindowBounds(bounds),
    { ...original, width: original.width + 120, height: original.height + 80 });
  steps.resize = await measureShellView(page);
  assert.ok(steps.resize.windowBounds.width > original.width);
  await page.evaluate(bounds => window.electronAkariProject.assetSite.testWindowBounds(bounds),
    { ...steps.resize.windowBounds, x: original.x + 35, y: original.y + 25 });
  steps.move = await measureShellView(page);
  assert.notEqual(steps.move.windowBounds.x, steps.resize.windowBounds.x);
  await page.evaluate(bounds => window.electronAkariProject.assetSite.testWindowBounds(bounds), original);
  await page.evaluate(async () => {
    const { shell, site, other } = window.__assetSiteShellProbe;
    await shell.addWidget(site, { area: 'main', mode: 'tab-after', ref: other });
    await shell.activateWidget(site.id);
  });
  steps.restored = await measureShellView(page);
  assert.ok(steps.restored.dom.width >= steps.split.dom.width);
  return { mode: 'a', context: 'real-shell', steps };
}

try {
  fixture = await startFixtureSite(catalog);
  port = await freePort();
  await cp(join(repo, 'templates/project-default'), project, { recursive: true });
  child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(temp, 'electron-profile')}`, '--no-sandbox'], { cwd: shell,
    env: { ...process.env, THEIA_CONFIG_DIR: join(temp, 'theia'),
      AKARI_HOME: join(temp, 'home'), AKARI_LIBRARY_ROOT: library,
      AKARI_CREATOR_ROOT: join(temp, 'creator'), AKARI_ASSET_SITE_TEST_HTTP: '1',
      AKARI_ASSET_SITE_TEST_CATALOG: catalog }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-5000); });
  browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined), 120000);
  const page = await waitFor(async () => {
    for (const value of browser.contexts().flatMap(context => context.pages())) {
      if (await value.evaluate(() => Boolean(window.theia?.container)).catch(() => false)) return value;
    }
  }, 120000);
  await page.locator('[data-akari-panel-segment="catalog"]').click();
  await page.getByRole('button', { name: 'ライブラリに追加' }).click();
  await page.getByRole('menuitem', { name: '素材サイトでさがす' }).click();
  const sheet = page.locator('[data-akari-site-sheet]');
  await sheet.getByText('疑似無料サイト').waitFor();
  record('sheet_order', await sheet.locator('.akari-import-scroll').evaluate(node => ({
    first: node.firstElementChild?.textContent?.trim(), lastTag: node.lastElementChild?.tagName,
    paidLabel: node.querySelector('details:last-of-type summary')?.textContent?.trim()
  })));
  assert.match(observations.sheet_order.first, /^まず AKARI Lab から/);
  assert.equal(observations.sheet_order.lastTag, 'DETAILS');
  assert.match(observations.sheet_order.paidLabel, /有料・サブスクのサービス（1）/);
  await sheet.locator('.akari-import-group').filter({ hasText: '疑似無料サイト' }).getByRole('button', { name: '開く' }).click();
  await page.locator('[data-akari-asset-site]').waitFor();
  const surface = await sitePage();
  record('sheet_to_central', { central: await page.locator('[data-akari-site-surface]').isVisible(), url: surface.url() });
  assert.equal(await page.locator('[data-akari-site-surface]').isVisible(), true);
  observations.aShell = await measureShellModes(page);
  record('mode_a_shell', observations.aShell);
  const itemPage = await clickSiteNavigation(surface.getByRole('link', { name: '個別ページ' }), '/item', page);
  record('item_navigation', { url: itemPage.url(), requests: fixture.requests.slice(-5),
    native: await page.evaluate(() => window.electronAkariProject.assetSite.inspect()) });
  await itemPage.locator('audio').waitFor();
  await itemPage.locator('audio').click({ position: { x: 20, y: 20 } });
  await waitFor(() => itemPage.locator('audio').evaluate(el => !el.paused));
  record('audio_playing', await itemPage.locator('audio').evaluate(el => !el.paused && el.currentTime >= 0));
  assert.equal(observations.audio_playing, true);
  const beforeRecommendation = fixture.requests.length;
  await page.getByRole('button', { name: 'ページを開いて光らせる' }).first().click();
  const recommendedPage = await sitePageAt('/item');
  await waitFor(() => recommendedPage.locator('[data-akari-site-highlight]').count());
  record('recommendation', { outlined: await recommendedPage.locator('[data-akari-site-highlight]').count(),
    downloadRequests: fixture.requests.slice(beforeRecommendation).filter(value => value.includes('download=1')) });
  assert.equal(observations.recommendation.downloadRequests.length, 0);
  await recommendedPage.getByRole('link', { name: /sound.wav をダウンロード/ }).click({ noWaitAfter: true });
  await page.locator('[data-akari-site-received]').waitFor();
  record('received', await page.locator('[data-akari-site-received]').innerText());
  await page.getByRole('button', { name: 'ライブラリに入れる' }).click();
  await waitFor(async () => (await libraryMetas()).length > 0);
  const free = (await libraryMetas()).find(value => value.meta.tags.includes('site:fixture-free'));
  assert.ok(free, 'free site import missing');
  record('free_import', { id: free.id, tags: free.meta.tags, source: free.meta.source, credit: free.credit });
  assert.ok(free.meta.tags.includes('origin:site'));
  assert.ok(free.meta.tags.includes('site:fixture-free'));
  assert.equal(free.meta.source.url, fixture.base + '/item');
  assert.equal(free.meta.source.license_at_source, '疑似サイト検証用');
  assert.match(free.credit, /テスト提供/);
  record('recent_first', await page.locator('[data-recent-strip] [data-recent-key]').first().innerText());
  assert.match(observations.recent_first, /素材サイト/);
  await command(page, 'akari.assetSite.open', 'fixture-free', fixture.base + '/missing', true);
  const missing = await sitePageAt('/missing');
  assert.match(await page.locator('[data-akari-asset-site] header').innerText(), /エージェントがこのページを開きました/);
  await missing.locator('h1').waitFor();
  await missing.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await sleep(200);
  const beforeMissingHighlight = fixture.requests.length;
  const unmatched = await command(page, 'akari.assetSite.highlight', ['absent.wav']);
  record('missing_highlight', { result: unmatched, count: await missing.locator('[data-akari-site-highlight]').count(),
    newRequests: fixture.requests.slice(beforeMissingHighlight) });
  assert.equal(unmatched, false);
  assert.equal(observations.missing_highlight.count, 0);
  assert.deepEqual(observations.missing_highlight.newRequests, []);
  await command(page, 'akari.assetSite.open', 'fixture-free', fixture.base + '/item', true);
  const target = await sitePageAt('/item');
  record('direct_highlight_command', await command(page, 'akari.assetSite.highlight', ['sound.wav']));
  assert.equal(observations.direct_highlight_command, true);
  const beforePopup = browser.contexts().flatMap(context => context.pages()).length;
  await target.locator('#popup').click({ noWaitAfter: true }); await sleep(300);
  record('window_open_rejected', browser.contexts().flatMap(context => context.pages()).length === beforePopup);
  const outsidePage = await reloadFixtureItem(page);
  await outsidePage.locator('#outside').click({ noWaitAfter: true }); await sleep(300);
  record('outside_rejected', (await page.locator('[data-akari-site-address]').innerText()) === fixture.base + '/item');
  const filePage = await reloadFixtureItem(page);
  await filePage.locator('#file').click({ noWaitAfter: true }); await sleep(300);
  const fileLinkRejected = (await page.locator('[data-akari-site-address]').innerText()) === fixture.base + '/item';
  const fileCommandRejected = await page.evaluate(async () => {
    try { await window.electronAkariProject.assetSite.navigate('file:///etc/passwd'); return false; }
    catch { return true; }
  });
  record('file_rejected', { link: fileLinkRejected, command: fileCommandRejected });
  const permissionPage = await reloadFixtureItem(page);
  record('permission_rejected', await permissionPage.evaluate(() => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    navigator.geolocation.getCurrentPosition(() => { clearTimeout(timer); resolve(false); },
      () => { clearTimeout(timer); resolve(true); });
  })));
  assert.equal(observations.window_open_rejected && observations.outside_rejected &&
    observations.file_rejected.link && observations.file_rejected.command && observations.permission_rejected, true);
  await command(page, 'akari.assetSite.open', 'fixture-subscription', fixture.base + '/subscription/item', true);
  record('subscription_badge', await page.locator('[data-akari-asset-site] header').innerText());
  assert.match(observations.subscription_badge, /サブスク/);
  const subscriptionPage = await sitePageAt('/subscription/item');
  await subscriptionPage.getByRole('link', { name: /sound.wav をダウンロード/ }).click({ noWaitAfter: true });
  await page.locator('[data-akari-site-received]').waitFor();
  await page.getByRole('button', { name: 'ライブラリに入れる' }).click();
  await waitFor(async () => (await libraryMetas()).some(value => value.meta.tags.includes('site:fixture-subscription')));
  const subscription = (await libraryMetas()).find(value => value.meta.tags.includes('site:fixture-subscription'));
  record('subscription_import', { id: subscription.id, tags: subscription.meta.tags, source: subscription.meta.source });
  assert.ok(subscription.meta.tags.includes('origin:site'));
  assert.ok(subscription.meta.tags.includes('license:subscription'));
  assert.equal(subscription.meta.source.url, fixture.base + '/subscription/item');
  assert.equal(subscription.meta.source.license_at_source, '疑似サイト検証用');
  await page.locator('[data-recent-strip] [data-recent-key]').first().click();
  const subscriptionCardBadge = page.locator('[data-akari-catalog-item] [data-akari-site-subscription]');
  await subscriptionCardBadge.first().waitFor();
  record('subscription_card_badge', await subscriptionCardBadge.count());
  assert.ok(observations.subscription_card_badge > 0);
  await page.evaluate(() => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(value =>
      typeof value === 'function' && typeof value.prototype?.executeCommand === 'function');
    const commands = container.get(key), original = commands.executeCommand.bind(commands);
    commands.executeCommand = (id, ...args) => {
      if (id === 'akari.partner.injectPrompt') window.__assetSitePrompt = args[0];
      return original(id, ...args);
    };
  });
  await page.getByRole('button', { name: 'ライブラリに追加' }).click();
  await page.getByRole('menuitem', { name: '素材サイトでさがす' }).click();
  await page.locator('[data-akari-site-sheet] textarea').fill('明るい効果音');
  await page.locator('[data-akari-site-sheet]').getByRole('button', { name: 'エージェントに頼む' }).first().click();
  record('agent_packet', await page.evaluate(() => window.__assetSitePrompt));
  assert.match(observations.agent_packet, /ダウンロードは利用者が押す/);
  await page.evaluate(() => window.electronAkariProject.assetSite.close());
  record('temporary_dirs_after_close', (await readdir(library)).filter(name => name.startsWith('.tmp-site-')));
  assert.equal(observations.temporary_dirs_after_close.length, 0);
} catch (error) {
  observations.failure = String(error);
  console.error('L1 failed:', error, stderr.slice(-1500));
  process.exitCode = 1;
} finally {
  try {
    await writeFile(join(import.meta.dirname, 'l1-observations.json'), JSON.stringify(observations, null, 2) + '\n');
    const modePath = join(import.meta.dirname, 'modes-observations.json');
    const modes = JSON.parse(await readFile(modePath, 'utf8').catch(() => '{}'));
    if (observations.aShell) modes.aShell = observations.aShell;
    await writeFile(modePath, JSON.stringify(modes, null, 2) + '\n');
  } catch (error) { console.error('evidence write failed:', error); process.exitCode = 1; }
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(10000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
  if (fixture) await new Promise(resolve => fixture.server.close(resolve));
  try { await rm(temp, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }); }
  catch (error) { console.error('isolated fixture cleanup failed:', error); process.exitCode = 1; }
}
