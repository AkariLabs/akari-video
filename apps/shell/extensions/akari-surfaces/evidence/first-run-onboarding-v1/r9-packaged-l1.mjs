import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, executable, scratch] = process.argv.slice(2);
if (!['baseline-auto', 'baseline-settings', 'baseline-notice', 'fresh', 'settings', 'notice', 'failure'].includes(mode) || !executable || !scratch)
    throw new Error('mode, packaged executable, isolated root required');
assert.equal(await stat(executable).then(item => item.isFile(), () => false), true);
const { chromium } = await import('playwright-core');
const home = join(scratch, 'home'), akariHome = join(scratch, 'akari-home'), profile = join(scratch, 'profile');
await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
if (mode === 'settings' || mode === 'baseline-settings' || mode === 'notice' || mode === 'baseline-notice' || mode === 'failure') {
    const root = join(home, 'Akari');
    const project = join(root, 'channels', 'my-channel', 'videos', '2026-09-28-prior-video');
    await Promise.all([mkdir(join(root, '.akari'), { recursive: true }), mkdir(project, { recursive: true })]);
    await Promise.all([
        writeFile(join(root, '.akari', 'root.json'), JSON.stringify({ schema: 'creator-root/v1', channels: ['my-channel'] })),
        writeFile(join(akariHome, 'creator-root.json'), JSON.stringify({ lastRoot: root, updatedAt: new Date().toISOString() }))
    ]);
    if (mode !== 'notice' && mode !== 'baseline-notice') await writeFile(join(akariHome, 'first-run-onboarding-v0.json'), JSON.stringify({ schema: 1, shownAt: new Date().toISOString() }));
}
const port = { 'baseline-auto': 19630, 'baseline-settings': 19631, 'baseline-notice': 19635,
    fresh: 19632, settings: 19633, notice: 19634, failure: 19636 }[mode];
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: profile,
    AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const observations = { mode, startedAt: new Date().toISOString(), electronPid: child.pid, shots: [], pageErrors: [] };
let browser;
try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('packaged Electron exited before CDP');
        try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* startup */ }
        await new Promise(done => setTimeout(done, 300));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => observations.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') observations.pageErrors.push(message.text()); });
    await page.route('http**', route => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' || host.endsWith('localhost') ? route.continue() : route.abort();
    });
    const shot = async name => {
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
        observations.shots.push(name);
    };
    await page.locator('#akari-home-widget').waitFor({ state: 'attached' });
    if (mode === 'baseline-auto') {
        await page.waitForTimeout(5000);
        assert.equal(await page.locator('[data-akari-onboarding-step="welcome"]').count(), 0);
        await shot('r9-00-baseline-auto-missing');
        observations.guideMissing = true;
    } else if (mode === 'fresh') {
        const welcome = page.locator('[data-akari-onboarding-step="welcome"]');
        await welcome.waitFor();
        await welcome.locator('.ao-hero img').waitFor();
        assert.match(await welcome.locator('.ao-hero img').getAttribute('src'), /^data:image\/webp;base64,/);
        await page.waitForTimeout(900);
        await shot('r9-02-packaged-auto-open');
        observations.guideOpened = true;
    } else if (mode === 'notice' || mode === 'baseline-notice') {
        const toast = page.locator('.akari-guide-announcement');
        await toast.waitFor();
        if (mode === 'notice') await shot('r9-04-packaged-notice');
        await toast.getByRole('button', { name: '今すぐ見る' }).click();
        if (mode === 'baseline-notice') {
            await page.waitForTimeout(2500);
            assert.equal(await page.locator('[data-akari-onboarding-step="welcome"]').count(), 0);
            await shot('r9-01b-baseline-notice-missing');
            observations.guideMissing = true;
        } else {
            await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
            await page.waitForTimeout(900);
            await shot('r9-05-packaged-notice-open');
            observations.guideOpened = true;
        }
    } else {
        const launcher = page.locator('[data-akari-project-launcher-dialog="true"]');
        await launcher.waitFor();
        await page.keyboard.press('Escape');
        await launcher.waitFor({ state: 'detached' });
        observations.settingsCandidates = await page.locator('[title*="設定"], [aria-label*="設定"]').evaluateAll(nodes =>
            nodes.map(node => ({ html: node.outerHTML.slice(0, 220), visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length) })));
        observations.gearCandidates = await page.locator('.codicon-settings-gear').evaluateAll(nodes =>
            nodes.map(node => ({ html: node.parentElement?.outerHTML.slice(0, 300), visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length) })));
        const settingsOpener = page.locator('.codicon-settings-gear:visible').first();
        await settingsOpener.click({ timeout: 5000 });
        const settings = page.locator('[data-akari-settings-dialog="true"]');
        await settings.waitFor();
        await settings.locator('[data-settings-nav="start"]').click();
        const section = settings.locator('[data-akari-settings-section="start"]');
        await section.getByText('はじめてのガイド', { exact: true }).waitFor();
        if (mode === 'failure') await page.evaluate(() => {
            const append = document.body.appendChild;
            document.body.appendChild = function (node) {
                if (node instanceof HTMLElement && node.id === 'akari-onboarding-v1') throw new Error('injected open failure');
                return append.call(this, node);
            };
        });
        await section.getByRole('button', { name: '見る', exact: true }).click();
        if (mode === 'baseline-settings') {
            await page.waitForTimeout(2500);
            assert.equal(await page.locator('[data-akari-onboarding-step="welcome"]').count(), 0);
            await shot('r9-01-baseline-settings-missing');
            observations.guideMissing = true;
        } else if (mode === 'failure') {
            await page.getByText('ガイドを開けませんでした。', { exact: true }).first().waitFor();
            await page.getByRole('button', { name: '閉じる', exact: true }).first().waitFor();
            assert.equal(await page.locator('#akari-onboarding-v1').count(), 0);
            await shot('r9-06-open-error-visible');
            observations.errorVisible = true;
        } else {
            await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
            await page.waitForTimeout(900);
            await shot('r9-03-packaged-settings-open');
            observations.guideOpened = true;
        }
    }
} catch (error) {
    observations.error = String(error instanceof Error ? error.stack : error).replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    observations.finishedAt = new Date().toISOString();
    await writeFile(join(here, `r9-${mode}-observations.json`), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
