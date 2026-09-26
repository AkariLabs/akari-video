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
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [shellRoot, '--remote-debugging-port=19457', `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
const observations = { shots: [], startedAt: new Date().toISOString() };
try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch('http://127.0.0.1:19457/json/version')).ok) break; } catch { /* startup */ }
        await new Promise(done => setTimeout(done, 300));
    }
    browser = await chromium.connectOverCDP('http://127.0.0.1:19457');
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(180000);
    const shot = async name => {
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight - 24 }));
        await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
        observations.shots.push(name);
        console.log(`${name}: ${await page.locator('#akari-onboarding-v1').getAttribute('data-akari-onboarding-step')}`);
    };
    await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
    await shot('r2-01-welcome');
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-akari-onboarding-step="first"]').waitFor();
    await shot('r2-02-first');
    await page.locator('[data-ao="yes"]').click();
    await page.locator('[data-akari-onboarding-step="invite"]').waitFor();
    await shot('r2-03-invite');
    await page.locator('[data-ao="start"]').click();
    await page.locator('[data-akari-onboarding-step="tour0"]').waitFor({ timeout: 180000 });
    await page.waitForTimeout(650);
    await shot('r2-04-tour0-fog');
    await page.locator('[data-ao="next"]').waitFor();
    await page.waitForTimeout(450);
    await shot('r2-05-tour0-clear');
    observations.example = await page.evaluate(() => ({
        card: !!document.querySelector('[data-akari-onboarding-target="sample-card"]'),
        preview: !!document.querySelector('.ao-example-preview video'),
        chat: document.querySelector('.ao-chat h3')?.textContent,
        subtitle: document.querySelector('.ao-example-caption')?.textContent,
        timeline: !!document.querySelector('[data-akari-onboarding-target="timeline"]')
    }));
    await page.locator('[data-ao="next"]').click();
    await page.waitForTimeout(300); await shot('r2-06-tour1-transition');
    await page.waitForTimeout(600); await shot('r2-07-tour1');
    await page.locator('[data-ao="next"]').click();
    await page.waitForTimeout(850); await shot('r2-08-tour2-preview');
    await page.locator('[data-akari-onboarding-step="tour2"][data-ao="none"]').count();
    await page.waitForTimeout(3000); await shot('r2-09-tour2-timeline');
    await page.locator('[data-ao="next"]').click();
    await page.waitForTimeout(850); await shot('r2-10-tour3');
    await page.locator('[data-ao="next"]').click();
    await page.waitForTimeout(500); await shot('r2-11-bridge');
    await page.locator('[data-akari-onboarding-step="drag"]').waitFor();
    await page.waitForTimeout(850); await shot('r2-12-drag-empty');
    observations.empty = await page.evaluate(() => ({
        card: !!document.querySelector('[data-akari-onboarding-target="sample-card"]'),
        examplePreview: !!document.querySelector('.ao-example-preview'),
        transcript: !!document.querySelector('.ao-chat')
    }));
    await page.waitForTimeout(2600); await shot('r2-13-drag-hint');
    observations.finishedAt = new Date().toISOString();
} catch (error) {
    observations.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    await writeFile(join(here, 'r2-tour-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
