import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const electron = createRequire(import.meta.url)('electron');
const { chromium } = await import('playwright-core');
const resume = process.argv.includes('--resume');
const softExport = process.argv.includes('--soft-export');
const workOnly = process.argv.includes('--work-only');
const completeOnly = process.argv.includes('--complete-only');
const scratch = join(here, '.l1-temp');
const home = join(scratch, 'home');
const akariHome = join(scratch, 'akari-home');
const profile = join(scratch, 'profile');
await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);

const port = 19451;
const logPath = join(scratch, 'electron.log');
const log = createWriteStream(logPath, { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    ...(softExport ? { AKARI_OSR_SOFT: '1' } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.pipe(log);
child.stderr.pipe(log);
let browser;
const observations = resume
    ? JSON.parse(await readFile(join(here, 'observations.json'), 'utf8'))
    : { screenshots: [], steps: [], startedAt: new Date().toISOString() };
const savedStep = resume
    ? JSON.parse(await readFile(join(akariHome, 'onboarding-v1.json'), 'utf8')).step
    : undefined;
const savedSub = resume
    ? JSON.parse(await readFile(join(akariHome, 'onboarding-v1.json'), 'utf8')).sub
    : 0;
delete observations.error;
try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* startup */ }
        await new Promise(resolveWait => setTimeout(resolveWait, 300));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    let page = context.pages()[0] ?? await context.waitForEvent('page');
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => console.error('page error:', error.message));
    const shot = async (name) => {
        if (name === '04-tour' || name === '05-drag') {
            await page.waitForFunction(() => !document.body.innerText.includes('素材の置き場を見る場所に移しました'),
                null, { timeout: 20000 }).catch(() => undefined);
        }
        await page.screenshot({ path: join(here, `${name}.png`) });
        observations.screenshots.push(`${name}.png`);
        observations.steps.push(await page.locator('#akari-onboarding-v1').getAttribute('data-akari-onboarding-step'));
        console.log(`captured ${name}`);
    };
    if (completeOnly) {
        await page.locator('[data-akari-onboarding-step="export"]').waitFor();
        await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 60000 });
        await page.locator('[data-akari-onboarding-target="export-result"]').first().scrollIntoViewIfNeeded();
        await shot('13-export-result');
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="done"]').waitFor();
        await shot('14-done');
        await page.locator('[data-ao="connect"]').click();
        await page.locator('[data-akari-onboarding-target="partner-codex"]').first().waitFor();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(here, '14-connect.png') });
        observations.screenshots.push('14-connect.png');
        observations.steps.push('connected');
        console.log('captured 14-connect');
    } else {
    if (!resume) {
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await shot('01-welcome');
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="first"]').waitFor();
        await shot('02-first');
        await page.locator('[data-ao="yes"]').click();
        await page.locator('[data-akari-onboarding-step="invite"]').waitFor();
        await shot('03-invite');
        await page.locator('[data-ao="start"]').click();
    }
    if (workOnly && savedStep === 'prompt') {
        await page.locator('[data-akari-onboarding-step="prompt"]').waitFor();
        await page.locator('[data-ao="send"]').last().click();
        await page.locator('[data-akari-onboarding-step="work"]').waitFor();
    } else if (!['work', 'play', 'caption', 'daihon', 'export', 'done'].includes(savedStep)) {
        await page.locator('[data-akari-onboarding-step="tour"]').waitFor({ timeout: 180000 });
        await shot('04-tour');
        observations.projectCreated = true;
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="drag"]').waitFor();
        await page.waitForFunction(() => {
            const video = document.querySelector('.ao-f-preview video');
            return video?.readyState >= 2 && !video.paused;
        }, null, { timeout: 15000 });
        await shot('05-drag');
        await page.locator('[data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
        await page.locator('[data-akari-onboarding-step="matpreview"]').waitFor();
        await page.locator('[data-akari-onboarding-target="sample-card"]').click();
        await page.locator('[data-akari-onboarding-step="matpreview"] .ao-coach .ao-actions').waitFor();
        await shot('06-matpreview');
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="ask"]').waitFor();
        await page.locator('[data-answer="chatgpt"]').click();
        await shot('07-ask');
        await page.locator('[data-ao="replay"]').click();
        await page.locator('[data-akari-onboarding-step="prompt"]').waitFor();
        await page.waitForTimeout(1700);
        await shot('08-prompt');
        await page.locator('[data-ao="insert"]').click();
        await page.locator('[data-ao="send"]').last().click();
        await page.locator('[data-akari-onboarding-step="work"]').waitFor();
    } else if (savedStep === 'work') {
        await page.locator('[data-akari-onboarding-step="work"]').waitFor();
    }
    if (!['play', 'caption', 'daihon', 'export', 'done'].includes(savedStep)) {
        if (workOnly) {
            await page.waitForFunction(() => document.querySelector('.ao-coach')?.textContent?.includes('字幕を置いています…（1/7）'));
            await shot('09-work');
            await page.waitForFunction(() => document.querySelector('.ao-coach')?.textContent?.includes('字幕を置いています…（4/7）'));
            await shot('09-work-progress');
        } else await page.waitForTimeout(5300);
        if (!workOnly) await shot('09-work');
    }
    if (!workOnly) {
    if (!['daihon', 'export', 'done'].includes(savedStep)) {
    if (savedStep !== 'caption') await page.locator('[data-akari-onboarding-step="play"]').waitFor({ timeout: 45000 });
    let previewFrame;
    const previewDeadline = Date.now() + 30000;
    while (!previewFrame && Date.now() < previewDeadline) {
        for (const frame of page.frames()) {
            if (await frame.locator('button[aria-label="再生"]').count().catch(() => 0)) { previewFrame = frame; break; }
        }
        if (!previewFrame) await page.waitForTimeout(300);
    }
    if (!previewFrame) throw new Error('Output preview play button was not found');
    if (savedStep !== 'caption') {
        await previewFrame.locator('button[aria-label="再生"]').click();
        await page.getByText('タイトルと字幕が入りました').waitFor();
        await page.waitForTimeout(8800);
        await shot('10-play');
        await page.locator('[data-ao="next"]').click();
    }
    await page.locator('[data-akari-onboarding-step="caption"]').waitFor();
    await shot('11-caption');
    console.log('caption candidates:', JSON.stringify(await previewFrame.locator('.caption-row-plate').evaluateAll(nodes =>
        nodes.slice(0, 20).map(node => ({ outer: node.outerHTML.slice(0, 500), text: node.textContent?.slice(0, 50) }))).catch(() => [])).slice(0, 2500));
    await previewFrame.locator('.caption-row-plate:not([data-output-caption]) .akari-caption__line').first().click();
    await page.locator('[data-akari-onboarding-target="caption-size"]').waitFor();
    await shot('11-caption-selected');
    await page.locator('[data-akari-onboarding-target="caption-size"]').click();
    await page.locator('[data-akari-onboarding-target="caption-size-slider"]').waitFor();
    await shot('11-caption-size');
    await page.locator('[data-akari-onboarding-target="caption-size-slider"]').evaluate(element => {
        element.value = String(Math.min(Number(element.max), Number(element.value) + 8));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByText('位置も動かせます').waitFor();
    await shot('11-caption-adjusted');
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-akari-onboarding-step="daihon"]').waitFor();
    await shot('12-daihon');
    console.log('daihon targets:', JSON.stringify(await page.locator('[data-akari-onboarding-target="daihon-button"]').evaluateAll(nodes => nodes.map(node => node.outerHTML.slice(0, 400)))));
    }
    if (!['export', 'done'].includes(savedStep)) {
        await page.locator('[data-akari-onboarding-step="daihon"]').waitFor();
        await shot('12-daihon');
        console.log('daihon state:', JSON.stringify(await page.locator('[data-akari-onboarding-target="daihon-button"]').evaluateAll(nodes => nodes.map(node => ({ outer: node.outerHTML.slice(0, 200), rect: node.getBoundingClientRect().toJSON() })))));
        await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ force: true, timeout: 12000 });
        await page.locator('[data-akari-onboarding-target="daihon"]').waitFor();
        await shot('12-daihon-open');
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="export"]').waitFor();
        await shot('13-export-menu');
    }
    if (savedStep !== 'done') {
        await page.locator('[data-akari-onboarding-step="export"]').waitFor();
        await page.locator('[data-akari-onboarding-target="menu-button"]').click();
        await page.locator('[data-akari-onboarding-target="export-button"]').waitFor();
        if (savedSub < 3) await shot('13-export-button');
        await page.locator('[data-akari-onboarding-target="export-button"]').click();
        await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
        if (savedSub < 3) await shot('13-export-submit');
        await page.locator('[data-akari-onboarding-target="export-submit"]').click();
        await page.getByText('書き出しています', { exact: true }).waitFor();
        await shot(softExport ? '13-export-progress-soft' : '13-export-progress');
        await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 240000 });
        await shot('13-export-result');
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="done"]').waitFor();
        await shot('14-done');
    }
    }
    }
} catch (error) {
    observations.error = error instanceof Error ? error.message.split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>') : String(error);
    console.error(observations.error);
} finally {
    observations.endedAt = new Date().toISOString();
    await writeFile(join(here, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await Promise.race([
        browser.close().catch(() => undefined),
        new Promise(resolveWait => setTimeout(resolveWait, 3000))
    ]);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise(resolveExit => { child.once('exit', resolveExit); setTimeout(resolveExit, 5000); });
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
