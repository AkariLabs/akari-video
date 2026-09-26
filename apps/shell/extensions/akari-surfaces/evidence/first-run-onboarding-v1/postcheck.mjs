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
const scratch = join(here, '.l1-temp');
const observations = { secondLaunch: {}, returning: {} };

async function launch(name, port, fresh = false) {
    const base = fresh ? join(scratch, 'returning') : scratch;
    const home = join(base, 'home');
    const akariHome = join(base, 'akari-home');
    const profile = join(base, 'profile');
    await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
    const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
        THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline' };
    delete env.ELECTRON_RUN_AS_NODE;
    const log = createWriteStream(join(base, 'electron.log'), { flags: 'a' });
    const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
        { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    let browser;
    try {
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
            try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* startup */ }
            await new Promise(resolveWait => setTimeout(resolveWait, 300));
        }
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
        page.setDefaultTimeout(30000);
        return { page, close: async () => {
            await browser.close().catch(() => undefined);
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGTERM');
                await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            }
            log.end();
        } };
    } catch (error) {
        if (browser) await browser.close().catch(() => undefined);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        log.end();
        throw error;
    }
}

async function palette(page, label) {
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input');
    await input.waitFor();
    await input.fill(`>${label}`);
    await page.locator(`[role="option"][aria-label="${label}"]`).click();
}

try {
    const session = await launch('second', 19452);
    try {
        const { page } = session;
        await page.getByText('はじめての動画', { exact: true }).first().waitFor();
        await page.waitForTimeout(2000);
        observations.secondLaunch.autoGuideCount = await page.locator('#akari-onboarding-v1').count();
        const outputTab = page.getByText('出力プレビュー', { exact: true }).first();
        if (await outputTab.count()) await outputTab.click();
        await page.screenshot({ path: join(here, '15-second-launch-no-auto.png') });
        await palette(page, 'はじめてのガイドをもう一度');
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await page.screenshot({ path: join(here, '16-command-reopen.png') });
        observations.secondLaunch.commandReopened = true;
        await page.keyboard.press('Escape');
        await page.locator('#akari-onboarding-v1').waitFor({ state: 'detached' });
        await palette(page, '初回セットアップを開く');
        await page.locator('[data-akari-first-run-dialog="true"]').waitFor();
        await page.screenshot({ path: join(here, '17-old-setup.png') });
        observations.secondLaunch.oldSetupOpened = true;
    } finally { await session.close(); }

    const returning = await launch('returning', 19453, true);
    try {
        const { page } = returning;
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="first"]').waitFor();
        await page.locator('[data-ao="no"]').click();
        await page.locator('#akari-onboarding-v1').waitFor({ state: 'detached' });
        await page.screenshot({ path: join(here, '18-returning-home.png') });
        observations.returning.skippedGuide = true;
    } finally { await returning.close(); }
} catch (error) {
    observations.error = error instanceof Error ? error.message.split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>') : String(error);
    console.error(observations.error);
} finally {
    await writeFile(join(here, 'postcheck-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
}
process.exit(observations.error ? 1 : 0);
