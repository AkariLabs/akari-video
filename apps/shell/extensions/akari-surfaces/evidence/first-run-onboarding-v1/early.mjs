import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const electron = createRequire(import.meta.url)('electron');
const { chromium } = await import('playwright-core');
const scratch = join(here, '.l1-temp', 'early2');
const home = join(scratch, 'home');
const akariHome = join(scratch, 'akari-home');
const profile = join(scratch, 'profile');
await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [shellRoot, '--remote-debugging-port=19454', `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
child.stdout.pipe(log);
child.stderr.pipe(log);
let browser;
const observations = { shots: [] };
try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch('http://127.0.0.1:19454/json/version')).ok) break; } catch { /* startup */ }
        await new Promise(done => setTimeout(done, 300));
    }
    browser = await chromium.connectOverCDP('http://127.0.0.1:19454');
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(180000);
    const shot = async (name) => {
        await page.screenshot({ path: join(here, `${name}.png`) });
        observations.shots.push(name);
        console.log(name);
    };
    await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-ao="yes"]').click();
    await page.locator('[data-ao="start"]').click();
    await page.locator('[data-akari-onboarding-step="tour"]').waitFor();
    const toast = page.locator('.theia-notification-item').filter({ hasText: '素材の置き場を見る場所に移しました' });
    console.log('toast buttons:', JSON.stringify(await toast.locator('button').evaluateAll(ns => ns.map(n => n.outerHTML.slice(0, 180))).catch(() => [])));
    if (await toast.count()) await toast.locator('button').last().click();
    await shot('04-tour');
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-akari-onboarding-step="drag"]').waitFor();
    await page.waitForFunction(() => { const video = document.querySelector('.ao-f-preview video'); return video?.readyState >= 2 && !video.paused; });
    await shot('05-drag');
    await page.locator('[data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    await page.locator('[data-akari-onboarding-step="matpreview"]').waitFor();
    await page.locator('[data-akari-onboarding-target="sample-card"]').click();
    await page.locator('[data-akari-onboarding-step="matpreview"] .ao-coach .ao-actions').waitFor();
    await page.waitForTimeout(2500);
    await shot('06-matpreview');
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-answer="chatgpt"]').click();
    await shot('07-ask');
    await page.locator('[data-ao="replay"]').click();
    await page.locator('[data-akari-onboarding-step="prompt"]').waitFor();
    await page.waitForTimeout(1800);
    await shot('08-prompt');
} catch (error) {
    observations.error = error instanceof Error ? error.message.split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>') : String(error);
    console.error(observations.error);
} finally {
    await writeFile(join(here, 'early-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
