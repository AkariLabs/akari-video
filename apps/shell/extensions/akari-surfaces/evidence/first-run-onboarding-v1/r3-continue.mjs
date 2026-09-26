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
const child = spawn(electron, [shellRoot, '--remote-debugging-port=19460', `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
const observations = { shots: [], startedAt: new Date().toISOString() };
try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch('http://127.0.0.1:19460/json/version')).ok) break; } catch { /* startup */ }
        await new Promise(done => setTimeout(done, 300));
    }
    browser = await chromium.connectOverCDP('http://127.0.0.1:19460');
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(180000);
    const shot = async name => {
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight - 24 }));
        await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
        observations.shots.push(name);
        const guide = page.locator('#akari-onboarding-v1');
        console.log(`${name}: ${await guide.count() ? await guide.getAttribute('data-akari-onboarding-step') : 'closed'}`);
    };
    const step = async name => page.locator(`[data-akari-onboarding-step="${name}"]`).waitFor();
    const click = async name => page.locator(`[data-ao="${name}"]`).last().click();
    const inFrame = async (selector, read) => {
        for (const frame of page.frames()) {
            if (await frame.locator(selector).count().catch(() => 0)) return frame.locator(selector).evaluate(read);
        }
        return null;
    };
    await step('drag');
    observations.resumeStep = 'drag';
    await click('back'); await step('tour3'); await page.waitForTimeout(850); await shot('r3-14-back-tour3-example');
    await click('next'); await page.waitForTimeout(400); await shot('r3-15-bridge-again');
    await step('drag'); await page.waitForTimeout(950); await shot('r3-16-drag-empty-again');
    await page.locator('[data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    await step('matpreview'); await shot('r3-17-matpreview-card');
    await page.locator('[data-akari-onboarding-target="sample-card"]').click();
    await page.getByText('ここは「素材プレビュー」です').waitFor();
    await shot('r3-18-matpreview-open');
    await click('back'); await step('drag'); await page.waitForTimeout(650); await shot('r3-19-back-imported');
    await click('next'); await step('matpreview'); await click('next'); await step('ask');
    await page.locator('.theia-notification-list-item .action-label[title="Clear"]').evaluateAll(elements => elements.forEach(element => element.click()));
    await page.waitForTimeout(750);
    await shot('r3-20-ask-icons');
    await page.locator('[data-answer="chatgpt"]').click(); await click('replay'); await step('prompt');
    await page.waitForTimeout(750);
    await shot('r3-21-prompt');
    await click('insert'); const workStarted = Date.now(); await click('send'); await step('work');
    await page.waitForFunction(() => document.querySelector('.ao-live')?.textContent?.includes('字幕を置いています…（3/7）'), null, { timeout: 50000 });
    for (let attempt = 0; attempt < 20; attempt++) {
        const captions = await inFrame('#preview-video', element => document.querySelectorAll('.caption-row-plate:not([hidden])').length);
        if (captions) break;
        await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
    await shot('r3-22-work-mid');
    observations.workMid = {
        partnerHidden: await page.locator('[data-akari-onboarding-target="partner"]').evaluate(element => getComputedStyle(element).visibility === 'hidden'),
        reloadToast: await inFrame('#reload-toast', element => !element.hidden),
        videoState: await inFrame('#preview-video', element => ({ readyState: element.readyState, width: element.videoWidth, time: element.currentTime,
            captions: document.querySelectorAll('.caption-row-plate:not([hidden])').length }))
    };
    observations.workChat = await page.locator('.ao-chat h3').textContent();
    await step('play'); observations.workDurationMs = Date.now() - workStarted; await shot('r3-23-play-before');
    await click('back'); await step('prompt'); await shot('r3-24-back-work-completed');
    const replayStarted = Date.now(); await click('again-work'); await step('work');
    await page.waitForFunction(() => document.querySelector('.ao-live')?.textContent?.includes('字幕を置いています…（4/7）'), null, { timeout: 50000 });
    await shot('r3-25-work-replay-mid');
    await step('play');
    observations.replayDurationMs = Date.now() - replayStarted;
    let preview;
    const findPreview = async () => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            for (const frame of page.frames()) {
                if (await frame.locator('[data-akari-onboarding-target="play-button"]').count().catch(() => 0)) return frame;
            }
            await page.waitForTimeout(300);
        }
        return undefined;
    };
    preview = await findPreview();
    if (!preview) {
        await page.reload();
        await step('play');
        preview = await findPreview();
    }
    if (!preview) throw new Error('preview frame not found');
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await page.getByText('タイトルと字幕が入りました').waitFor();
    await page.waitForTimeout(8400); await shot('r3-26-play-running');
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await page.waitForTimeout(300);
    await click('next'); await step('caption'); await shot('r3-27-caption-before');
    await preview.locator('.caption-row-plate:not([data-output-caption]) .akari-caption__line').first().click();
    await page.locator('[data-akari-onboarding-target="caption-size"]').waitFor();
    await shot('r3-28-caption-selected');
    await page.locator('[data-akari-onboarding-target="caption-size"]').click();
    await page.locator('[data-akari-onboarding-target="caption-size-slider"]').waitFor();
    await page.locator('[data-akari-onboarding-target="caption-size-slider"]').evaluate(element => {
        element.value = String(Math.min(Number(element.max), Number(element.value) + 8));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await shot('r3-29-caption-adjusted');
    await click('next'); await step('daihon'); await shot('r3-30-daihon-before');
    await page.locator('[data-akari-onboarding-target="daihon-button"]').click();
    await page.getByText('行を押すと、その場面へ飛びます').waitFor();
    await page.waitForTimeout(550); await shot('r3-31-daihon-after');
    observations.daihon = { rows: await page.locator('.akari-daihon-row').count(),
        error: await page.getByText('台本を読み取れません', { exact: false }).count(),
        captionChrome: await inFrame('#caption-select-box', element => ({
            selected: element.classList.contains('is-active'),
            paletteOpen: !!element.querySelector('[data-caption-palette]:not([hidden])'),
            runMenuOpen: !!element.querySelector('[data-akari-run-menu]:not([hidden])')
        })) };
    await page.locator('.akari-daihon-row').nth(3).click();
    await page.waitForTimeout(500); await shot('r3-31-daihon-seek');
    await click('next'); await step('export'); await shot('r3-32-export-menu-target');
    await page.locator('[data-akari-onboarding-target="menu-button"]').click();
    await page.locator('[data-akari-onboarding-target="export-button"]').waitFor();
    await page.waitForTimeout(550); await shot('r3-33-export-open');
    await page.locator('[data-akari-onboarding-target="export-button"]').click();
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
    await page.waitForTimeout(550); await shot('r3-34-export-dialog');
    const exportStarted = Date.now(); await page.locator('[data-akari-onboarding-target="export-submit"]').click();
    await page.waitForTimeout(750); await shot('r3-35-export-progress');
    await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 180000 });
    await page.locator('[data-akari-onboarding-target="export-result"]').first().waitFor({ timeout: 20000 });
    observations.exportDurationMs = Date.now() - exportStarted;
    await shot('r3-36-export-result');
    observations.uiExportCompleted = true;
    await click('next'); await step('done'); await page.waitForTimeout(2200); await shot('r3-37-done-celebration');
    await page.waitForTimeout(6200); await shot('r3-37-done-settled');
    await click('connect'); await page.locator('[data-akari-onboarding-target="partner-codex"]').first().waitFor();
    await page.waitForTimeout(500); await shot('r3-38-connect');
    observations.finishedAt = new Date().toISOString();
} catch (error) {
    observations.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    await writeFile(join(here, 'r3-continue-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
