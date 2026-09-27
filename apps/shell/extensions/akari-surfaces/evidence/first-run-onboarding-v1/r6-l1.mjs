import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const scratch = process.argv[2];
if (!scratch) throw new Error('isolated root required');
const electron = createRequire(import.meta.url)('electron');
const { chromium } = await import('playwright-core');
const observations = { startedAt: new Date().toISOString(), shots: [] };

async function launch(kind, visit) {
    const base = join(scratch, kind), home = join(base, 'home'), akariHome = join(base, 'akari-home'), profile = join(base, 'profile');
    await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
    const log = createWriteStream(join(base, 'electron.log'), { flags: 'a' });
    const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
        THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
        HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
        NO_PROXY: 'localhost,127.0.0.1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const port = kind === 'fresh' ? 19565 : 19564;
    const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
        { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log); child.stderr.pipe(log);
    let browser;
    try {
        const deadline = Date.now() + 100000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
            try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* startup */ }
            await new Promise(done => setTimeout(done, 300));
        }
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
        page.setDefaultTimeout(35000);
        await page.route('http**', route => {
            const host = new URL(route.request().url()).hostname;
            return host === '127.0.0.1' || host.endsWith('localhost') ? route.continue() : route.abort();
        });
        const shot = async name => {
            const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
            await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
            observations.shots.push(name);
        };
        await visit(page, shot, akariHome);
    } finally {
        if (browser) await browser.close().catch(() => undefined);
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        log.end();
    }
}

try {
    const existing = join(scratch, 'existing');
    const root = join(existing, 'home', 'Akari');
    const akariHome = join(existing, 'akari-home');
    const project = join(root, 'channels', 'my-channel', 'videos', '2026-09-27-prior-video');
    await Promise.all([mkdir(join(root, '.akari'), { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(project, { recursive: true })]);
    await Promise.all([
        writeFile(join(root, '.akari', 'root.json'), JSON.stringify({ schema: 'creator-root/v1', channels: ['my-channel'] })),
        writeFile(join(akariHome, 'creator-root.json'), JSON.stringify({ lastRoot: root, updatedAt: new Date().toISOString() }))
    ]);
    await launch('existing', async (page, shot, store) => {
        const toast = page.locator('.akari-guide-announcement');
        await toast.waitFor();
        assert.match(await toast.innerText(), /新しく「はじめてのガイド」ができました/);
        await shot('r6-01-existing-notice');
        observations.toastStack = await toast.evaluate(node => {
            const button = node.querySelector('.open');
            const rect = button.getBoundingClientRect();
            const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { top: top?.outerHTML.slice(0, 150), toastZ: getComputedStyle(node).zIndex,
                bodyChildren: [...document.body.children].map(child => [child.id, getComputedStyle(child).zIndex]).slice(-8) };
        });
        console.log(JSON.stringify(observations.toastStack));
        await toast.getByRole('button', { name: '今すぐ見る' }).click();
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await page.waitForTimeout(1600);
        await shot('r6-02-notice-open-guide');
        const marker = JSON.parse(await readFile(join(store, 'first-video-guide-announcement-v1.json'), 'utf8'));
        assert.equal(marker.schema, 1);
        observations.existingMarker = true;
    });
    await launch('existing', async (page, shot) => {
        await page.locator('#akari-home-widget').waitFor({ state: 'attached' }).catch(() => undefined);
        await page.waitForTimeout(3500);
        assert.equal(await page.locator('.akari-guide-announcement').count(), 0);
        await shot('r6-03-restart-no-notice');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+Shift+P');
        const command = page.locator('.quick-input-widget input').first();
        await command.waitFor();
        await command.fill('>AKARI Video の設定');
        await page.waitForTimeout(600);
        await command.press('Enter');
        const settings = page.locator('[data-akari-settings-dialog="true"]');
        await settings.waitFor();
        await settings.locator('[data-settings-nav="start"]').click();
        const section = settings.locator('[data-akari-settings-section="start"]');
        await section.getByText('はじめてのガイド', { exact: true }).waitFor();
        await section.getByText('はじめる準備', { exact: true }).waitFor();
        await shot('r6-04-settings-entry');
        await section.getByRole('button', { name: '見る', exact: true }).click();
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await page.waitForTimeout(1600);
        await shot('r6-05-settings-opens-guide');
        observations.settingsGuide = true;
    });
    await launch('fresh', async (page, shot, store) => {
        await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
        await page.waitForTimeout(1600);
        assert.equal(await page.locator('.akari-guide-announcement').count(), 0);
        assert.equal(await stat(join(store, 'first-video-guide-announcement-v1.json')).then(() => true, () => false), false);
        await shot('r6-06-fresh-auto');
        observations.freshAuto = true;
    });
} catch (error) {
    observations.error = String(error instanceof Error ? error.stack : error).replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    observations.finishedAt = new Date().toISOString();
    await writeFile(join(here, 'r6-l1-observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
}
process.exit(observations.error ? 1 : 0);
