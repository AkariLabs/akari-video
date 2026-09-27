import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const scratch = process.argv[2];
if (!scratch) throw new Error('isolated root required');
const electron = createRequire(import.meta.url)('electron');
const { chromium } = await import('playwright-core');
const home = join(scratch, 'home'), akariHome = join(scratch, 'akari-home'), profile = join(scratch, 'profile');
await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [shellRoot, '--remote-debugging-port=19562', `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
const observations = { startedAt: new Date().toISOString() };
try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch('http://127.0.0.1:19562/json/version')).ok) break; } catch { /* startup */ }
        await new Promise(done => setTimeout(done, 300));
    }
    browser = await chromium.connectOverCDP('http://127.0.0.1:19562');
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(30000);
    await page.route('http**', route => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' || host.endsWith('localhost') ? route.continue() : route.abort();
    });
    const shot = async name => {
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight - 24 }));
        await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
    };
    const partnerTab = page.locator('[title="パートナーを追加"], [aria-label="パートナーを追加"]').first();
    observations.stage = 'partner-tab';
    await partnerTab.waitFor();
    await partnerTab.click();
    observations.stage = 'partner-badge';
    await page.getByText('前回選んだ', { exact: true }).waitFor();
    await shot('r5-39-chosen-partner');
    observations.partnerBadge = true;
    await page.keyboard.press('Control+Shift+P');
    observations.stage = 'command-input';
    const commandInput = page.locator('.quick-input-widget input').first();
    await commandInput.waitFor();
    await commandInput.fill('>初回セットアップを開く');
    await page.waitForTimeout(800);
    observations.palette = await page.locator('.quick-input-widget').innerText();
    observations.stage = 'command-choice';
    await shot('r5-40-command-palette');
    await commandInput.press('Enter');
    observations.stage = 'setup-dialog';
    await page.locator('.akari-first-run-setup-dialog-overlay').waitFor();
    await page.waitForTimeout(500);
    await shot('r5-40-legacy-setup');
    observations.legacySetup = true;
} catch (error) {
    observations.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    await writeFile(join(here, 'r5-post-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
