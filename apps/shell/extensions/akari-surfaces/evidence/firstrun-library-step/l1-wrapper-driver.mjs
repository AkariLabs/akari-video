// Wrapper-written L1 driver (scratch, not committed). Usage: node drive.mjs <scenario>
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const REPO = '/Users/ryoma/_edit/30_products/akari-video-wt/firstrun-library-step';
const { chromium } = await import(REPO + '/node_modules/playwright-core/index.mjs');
const EVID = REPO + '/apps/shell/extensions/akari-surfaces/evidence/firstrun-library-step';
const scenario = process.argv[2];
const base = '/tmp/fls-l1/run-' + scenario.replace('onedrive', 'cloud').replace(/[^a-z0-9-]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${scenario}]`, ...a);
const out = {};
function paths(b) { return { home: /cloud-/.test(b) ? join(b, 'OneDrive', 'home') : join(b, 'home'), akariHome: join(b, 'akari-home'), profile: join(b, 'profile'), config: join(b, 'config') }; }
async function meta(dir, category, id, title, extra) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category, title, tags: [], license: { type: 'test' }, ...extra }, null, 2));
}
async function bin(file, bytes) { await writeFile(file, Buffer.alloc(bytes, 7)); }
async function launch(b, creator, port) {
  const p = paths(b);
  for (const d of Object.values(p)) await mkdir(d, { recursive: true });
  const env = { ...process.env, HOME: p.home, AKARI_HOME: p.akariHome, AKARI_CREATOR_ROOT: creator, THEIA_CONFIG_DIR: p.config,
    AKARI_CREDENTIALS_FILE: join(b, 'credentials.env') };
  delete env.AKARI_LIBRARY_ROOT;
  const child = spawn(REPO + '/apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    [REPO + '/apps/shell', `--remote-debugging-port=${port}`, `--user-data-dir=${p.profile}`, '--no-sandbox'], { env, cwd: REPO + '/apps/shell', stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; child.stdout.on('data', d => logs.push(String(d))); child.stderr.on('data', d => logs.push(String(d)));
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {} await sleep(1000); }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let i = 0; i < 120 && !page; i++) { page = browser.contexts().flatMap(c => c.pages()).find(pg => pg.url().includes('index.html')); if (!page) await sleep(1000); }
  await page.waitForFunction(() => !!(window.theia && window.theia.container && document.getElementById('theia-app-shell')), null, { timeout: 180000 });
  await page.evaluate(() => {
    const d = window.theia.container._bindingDictionary._map;
    const K = [...d.keys()].find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function' && typeof k.prototype?.registerCommand === 'function');
    const reg = window.theia.container.get(K);
    window.__cmds = [];
    const orig = reg.executeCommand.bind(reg);
    reg.executeCommand = (id, ...args) => { window.__cmds.push({ id, args: args.map(a => { try { return a && a.path && a.path.fsPath ? a.path.fsPath() : JSON.parse(JSON.stringify(a ?? null)); } catch { return String(a); } }) }); return orig(id, ...args); };
    window.__reg = reg;
    const FK = [...d.keys()].find(k => typeof k === 'symbol' && k.description === 'FileDialogService');
    window.__fileDialogs = FK ? window.theia.container.get(FK) : undefined;
  });
  return { child, browser, page, logs, kill: async () => { try { await browser.close(); } catch {} child.kill(); for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(250); await sleep(1500); } };
}
async function stubDialog(page, p) {
  await page.evaluate(p => {
    const mk = x => ({ path: { fsPath: () => x, toString: () => x }, toString: () => 'file://' + x });
    window.__fileDialogs.showOpenDialog = async (props) => { window.__dialogProps = props; return props && props.canSelectMany ? [mk(p)] : mk(p); };
  }, p);
}
const text = (page, sel) => page.locator(sel).innerText();
const readJson = async f => existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : null;
async function tree(dir) { const r = []; async function w(d, pre = '') { for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) { if (e.isDirectory()) await w(join(d, e.name), pre + e.name + '/'); else r.push(pre + e.name + (e.isSymbolicLink() ? '@' : '')); } } await w(dir); return r.sort(); }
async function toLibraryStep(page) {
  await page.waitForSelector('[data-akari-first-run-step="tools"]', { timeout: 120000 });
  await page.click('[data-akari-setup-next-workspace]');
  await page.waitForSelector('[data-akari-first-run-step="workspace"]');
  await page.click('[data-akari-setup-create-workspace]');
  await page.waitForSelector('[data-akari-first-run-step="library"]', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-akari-library-path]')?.textContent?.includes('確認しています'), null, { timeout: 30000 });
  await sleep(500);
}
const btn = (page, name) => page.locator('[data-akari-first-run-dialog]').getByRole('button', { name, exact: true });
let run;
try {
  await rm(base, { recursive: true, force: true });
  const p = paths(base);
  if (scenario === 'fresh') {
    const creator = join(p.home, 'Akari');
    run = await launch(base, creator, 9481);
    const { page } = run;
    await toLibraryStep(page);
    out.stepLabels = await page.locator('[data-akari-setup-step-label]').allInnerTexts().catch(() => []);
    out.libraryText = await text(page, '[data-akari-setup-library]');
    out.libraryPath = await text(page, '[data-akari-library-path]');
    await page.screenshot({ path: join(EVID, 'l1-fresh-library-step.png') });
    await btn(page, 'Finder で開く').click(); await sleep(1500);
    out.revealCalls = await page.evaluate(() => window.__cmds.filter(c => c.id === 'akari.project.revealInFileManager'));
    out.revealTargetExists = existsSync(out.libraryPath);
    await btn(page, '戻る').click();
    await page.waitForSelector('[data-akari-first-run-step="workspace"]');
    out.backToWorkspace = true;
    await page.click('[data-akari-setup-create-workspace]');
    await page.waitForSelector('[data-akari-first-run-step="library"]');
    await btn(page, '今はスキップ').click();
    await page.waitForSelector('[data-akari-first-run-step="connection"]', { timeout: 30000 });
    out.skipToConnection = true;
    out.locationAfterSkip = await readJson(join(p.akariHome, 'library-location.json'));
    await page.screenshot({ path: join(EVID, 'l1-fresh-after-skip-connection.png') });
    await run.kill();
    // relaunch: set-up already done → no first-run dialog
    run = await launch(base, creator, 9491);
    await sleep(15000);
    out.relaunchDialogCount = await run.page.locator('[data-akari-first-run-dialog]').count();
    await run.page.screenshot({ path: join(EVID, 'l1-fresh-relaunch-no-dialog.png') });
  } else if (scenario === 'legacy') {
    const creator = join(p.home, 'Akari');
    await meta(join(p.akariHome, 'assets/audio/song'), 'audio', 'song', 'Song'); await bin(join(p.akariHome, 'assets/audio/song/song.wav'), 1_500_000);
    await meta(join(p.akariHome, 'assets/still/photo'), 'still', 'photo', 'Photo'); await bin(join(p.akariHome, 'assets/still/photo/photo.png'), 600_000);
    out.legacyBefore = await tree(join(p.akariHome, 'assets'));
    run = await launch(base, creator, 9482);
    const { page } = run;
    await toLibraryStep(page);
    out.libraryText = await text(page, '[data-akari-setup-library]');
    await page.screenshot({ path: join(EVID, 'l1-legacy-library-step.png') });
    await btn(page, '次へ').click();
    await page.waitForSelector('[data-akari-first-run-step="connection"]', { timeout: 60000 });
    out.location = await readJson(join(p.akariHome, 'library-location.json'));
    out.newLibrary = await tree(join(creator, 'library'));
    out.legacyAfter = await tree(join(p.akariHome, 'assets'));
  } else if (scenario === 'onedrive-decline' || scenario === 'onedrive-other') {
    const creator = join(p.home, 'Akari');
    await meta(join(p.akariHome, 'assets/audio/song'), 'audio', 'song', 'Song'); await bin(join(p.akariHome, 'assets/audio/song/song.wav'), 1_500_000);
    run = await launch(base, creator, 9483);
    const { page } = run;
    await toLibraryStep(page);
    out.libraryText = await text(page, '[data-akari-setup-library]');
    await page.screenshot({ path: join(EVID, `l1-${scenario}-ask.png`) });
    out.locationBefore = await readJson(join(p.akariHome, 'library-location.json'));
    if (scenario === 'onedrive-decline') {
      await btn(page, '今は移さない').click(); await sleep(2500);
      out.libraryTextAfter = await text(page, '[data-akari-setup-library]');
    } else {
      const other = join(base, 'local-library');
      await stubDialog(page, other);
      await btn(page, '別の場所を選ぶ').click();
      for (let i = 0; i < 60 && !(await readJson(join(p.akariHome, 'library-location.json')))?.root?.includes('local-library'); i++) await sleep(500);
      await sleep(2500);
      out.libraryTextAfter = await text(page, '[data-akari-setup-library]');
      out.otherTree = await tree(other);
      await page.screenshot({ path: join(EVID, `l1-${scenario}-after.png`) });
    }
    out.location = await readJson(join(p.akariHome, 'library-location.json'));
    out.legacyAfter = await tree(join(p.akariHome, 'assets'));
    out.creatorLibrary = await tree(join(creator, 'library'));
  } else if (scenario === 'import') {
    const creator = join(p.home, 'Akari');
    const src = join(base, 'my-materials'); await mkdir(src, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(src, 'beep.wav')]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', join(src, 'red.png')]);
    run = await launch(base, creator, 9484);
    const { page } = run;
    await toLibraryStep(page);
    await stubDialog(page, src);
    await btn(page, '手持ちの素材フォルダがあれば入れる').click();
    await page.waitForSelector('[role="dialog"][aria-label="ローカルから取り込む"]', { timeout: 30000 });
    await sleep(2500);
    out.dialogProps = await page.evaluate(() => window.__dialogProps);
    out.sheetText = await page.locator('[role="dialog"][aria-label="ローカルから取り込む"]').innerText();
    out.cmds = await page.evaluate(() => window.__cmds.map(c => c.id).filter(id => /library|catalog/.test(id)));
    await page.screenshot({ path: join(EVID, 'l1-import-sheet.png') });
  } else if (scenario === 'later') {
    // Already set up: creator root created by the app once, library has lab/site/own + a referencing project.
    const creator = join(p.home, 'Akari');
    run = await launch(base, creator, 9485);
    await toLibraryStep(run.page);
    await btn(run.page, '次へ').click();
    await run.page.waitForSelector('[data-akari-first-run-step="connection"]', { timeout: 60000 });
    await run.kill();
    const lib = join(creator, 'library');
    await meta(join(lib, 'audio/lab-song'), 'audio', 'lab-song', 'Lab の曲', { source: { url: 'https://github.com/AkariLabs/sounds' } }); await bin(join(lib, 'audio/lab-song/lab-song.wav'), 2_000_000);
    await meta(join(lib, 'still/site-photo'), 'still', 'site-photo', 'サイトの写真', { tags: ['origin:site', 'site:example'] }); await bin(join(lib, 'still/site-photo/site-photo.png'), 700_000);
    await meta(join(lib, 'broll/intro'), 'broll', 'intro', '自分のクリップ', { tags: ['origin:own'] });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '1', '-pix_fmt', 'yuv420p', join(lib, 'broll/intro/clip.mp4')]);
    const proj = join(base, 'proj'); await mkdir(join(proj, '.akari'), { recursive: true });
    await writeFile(join(proj, 'edit.json'), JSON.stringify({ version: 1, output: { width: 640, height: 360, fps: 30 }, sources: [{ id: 'clip', path: 'assets/broll/intro/clip.mp4', proxy: null }], cuts: [{ src: 'clip', in: 0, out: 1 }], overlays: [] }, null, 2) + '\n');
    await writeFile(join(proj, '.akari/asset-references.json'), JSON.stringify({ version: 0, references: [{ category: 'broll', id: 'intro' }] }) + '\n');
    out.libBefore = await tree(lib);
    run = await launch(base, creator, 9486);
    const { page } = run;
    await sleep(4000);
    out.firstRunShown = await page.locator('[data-akari-first-run-dialog]').count();
    // usage + cleanup in settings
    await page.evaluate(() => { void window.__reg.executeCommand('akari.settings.open', { section: 'tools' }); });
    await page.waitForSelector('[data-akari-library-usage]', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('[data-akari-library-usage]')?.innerText.includes('Lab から'), null, { timeout: 30000 });
    await page.locator('[data-akari-library-usage]').scrollIntoViewIfNeeded();
    out.usageText = await text(page, '[data-akari-library-usage]');
    await page.screenshot({ path: join(EVID, 'l1-later-usage.png') });
    await page.getByRole('button', { name: '取り直せるものを片づける' }).click();
    const confirm = page.locator('.dialogOverlay').filter({ hasText: '取り直せる素材を片づける' });
    await confirm.waitFor({ timeout: 10000 });
    out.cleanupDialogText = await confirm.innerText();
    await page.screenshot({ path: join(EVID, 'l1-later-cleanup-confirm.png') });
    await confirm.getByRole('button', { name: 'ゴミ箱へ移す' }).click();
    await sleep(4000);
    out.libAfterCleanup = await tree(lib);
    out.usageAfterCleanup = await text(page, '[data-akari-library-usage]').catch(e => String(e));
    await page.locator('[data-akari-settings-dialog] .dialogTitle i, [data-akari-settings-dialog] .closeButton').first().click().catch(async () => { await page.keyboard.press('Escape'); }); await page.waitForSelector('[data-akari-settings-dialog]', { state: 'detached', timeout: 10000 }); await sleep(800);
    // change location from the ＋ menu of the library surface
    await page.evaluate(() => { void window.__reg.executeCommand('akari.catalog.open'); });
    await page.waitForSelector('button[aria-label="ライブラリに追加"]', { timeout: 30000 });
    const newRoot = join(base, 'moved-library');
    await stubDialog(page, newRoot);
    out.overlayAtPlus = await page.evaluate(() => [...document.querySelectorAll('.dialogOverlay')].map(e => [...e.attributes].map(a => a.name).filter(n => n.startsWith('data-')).join(',')));
    await page.evaluate(() => document.querySelector('button[aria-label="ライブラリに追加"]').click()); await sleep(500);
    await page.screenshot({ path: join(EVID, 'l1-later-plus-menu.png') });
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent === '素材の置き場を変える…').click());
    for (let i = 0; i < 60 && !(await readJson(join(p.akariHome, 'library-location.json')))?.root?.includes('moved-library'); i++) await sleep(500);
    await sleep(3000);
    out.locationAfterChange = await readJson(join(p.akariHome, 'library-location.json'));
    out.movedTree = await tree(newRoot);
    out.oldTreeAfterChange = await tree(lib);
    await page.evaluate(() => { void window.__reg.executeCommand('akari.catalog.open'); }); await sleep(3000);
    out.libraryPanelText = (await page.locator('body').innerText()).split('\n').filter(l => /自分のクリップ|サイトの写真|Lab の曲/.test(l));
    await page.screenshot({ path: join(EVID, 'l1-later-library-after-move.png') });
    await run.kill(); run = undefined;
    // referencing project renders after the move (same env as the app)
    const env = { ...process.env, HOME: p.home, AKARI_HOME: p.akariHome, AKARI_CREATOR_ROOT: creator, AKARI_EXPORT_ALLOW_DESKTOP: '0' }; delete env.AKARI_LIBRARY_ROOT;
    try {
      const r = execFileSync('node', [REPO + '/packages/render-cut/bin/render-cut.mjs', proj, '--out', join(base, 'out.mp4'), '--force'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
      out.renderTail = r.split('\n').slice(-6);
      out.renderExit = 0;
    } catch (e) { out.renderExit = e.status; out.renderTail = String(e.stdout ?? '').split('\n').slice(-8).concat(String(e.stderr ?? '').split('\n').slice(-8)); }
    out.outExists = existsSync(join(base, 'out.mp4'));
    if (out.outExists) out.outProbe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'compact', join(base, 'out.mp4')], { encoding: 'utf8' });
  }
  out.ok = true;
} catch (e) { out.error = String(e && e.stack || e); if (run) out.logTail = run.logs.join('').slice(-3000); }
finally { if (run) await run.kill(); }
await writeFile(join(EVID, `l1-${scenario}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
