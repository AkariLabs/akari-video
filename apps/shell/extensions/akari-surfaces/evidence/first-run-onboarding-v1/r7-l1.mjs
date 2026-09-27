import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const [mode, scratch] = process.argv.slice(2);
if (!['baseline', 'failure', 'fallback', 'close'].includes(mode) || !scratch) throw new Error('mode and isolated root required');
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
const port = ({ baseline: 19566, failure: 19567, fallback: 19568, close: 19569 })[mode];
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const observations = { mode, startedAt: new Date().toISOString(), shots: [] };
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
    page.setDefaultTimeout(90000);
    await page.route('http**', route => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' || host.endsWith('localhost') ? route.continue() : route.abort();
    });
    const shot = async name => {
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        await page.screenshot({ path: join(here, `${name}.png`), clip: { x: 0, y: 0, ...size } });
        observations.shots.push(name);
    };
    const step = page.locator('#akari-onboarding-v1');
    await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
    if (mode === 'close') {
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="first"]').waitFor();
        await page.locator('[data-ao="yes"]').click();
        await page.locator('[data-akari-onboarding-step="invite"]').waitFor();
    }
    if (mode !== 'close') {
        await page.locator('[data-ao="next"]').click();
        await page.locator('[data-akari-onboarding-step="first"]').waitFor();
        await page.locator('[data-ao="yes"]').click();
        await page.locator('[data-akari-onboarding-step="invite"]').waitFor();
    }
    await page.locator('[data-ao="start"]').click();
    await page.locator('[data-akari-onboarding-step="tour0"]').waitFor({ timeout: 180000 });
    const state = JSON.parse(await readFile(join(akariHome, 'onboarding-v1.json'), 'utf8'));
    const project = fileURLToPath(state.projectUri);
    observations.projectCreated = await stat(project).then(item => item.isDirectory(), () => false);
    assert.equal(observations.projectCreated, true);
    if (mode === 'close') {
        await page.locator('[data-ao="idle-close"]').waitFor({ timeout: 15000 });
        await shot('r7-04-idle-close');
        await page.locator('[data-ao="idle-close"]').click();
        await step.waitFor({ state: 'detached' });
        await page.getByText('設定からいつでも見られます', { exact: true }).waitFor();
        assert.equal(await stat(project).then(item => item.isDirectory(), () => false), true);
        let marked = false;
        for (let index = 0; index < 20 && !marked; index++) {
            marked = await stat(join(akariHome, 'first-run-onboarding-v0.json')).then(item => item.isFile(), () => false);
            if (!marked) await page.waitForTimeout(100);
        }
        assert.equal(marked, true);
        observations.projectRemained = true;
        observations.markedSeen = true;
        await page.waitForTimeout(600);
        await shot('r7-05-closed-project-remains');
    } else {
        await page.getByText('これが AKARI Video の画面です', { exact: true }).waitFor();
        await page.locator('[data-ao="next"]').click();
        await page.getByText('① 左は「素材」です', { exact: true }).waitFor();
        await page.locator('[data-ao="next"]').click();
        await page.getByText('② 下は「タイムライン」です', { exact: true }).waitFor();
        await page.locator('[data-ao="next"]').click();
        await page.getByText('③ 右は「AI パートナー」です', { exact: true }).waitFor();
        if (mode === 'fallback') await page.evaluate(() => {
            const original = window.setTimeout.bind(window);
            window.setTimeout = ((callback, delay, ...args) => {
                if (delay === 2300) { window.setTimeout = original; return original(() => undefined, delay); }
                return original(callback, delay, ...args);
            });
        });
        const original = await readFile(join(project, 'edit.json'), 'utf8');
        await page.locator('[data-ao="next"]').click();
        await page.getByText('では、これを一緒につくってみましょう', { exact: true }).waitFor();
        if (mode === 'fallback') {
            await page.locator('[data-ao="fallback-next"]').waitFor({ timeout: 10000 });
            assert.equal(await step.getAttribute('data-akari-onboarding-step'), 'tour3');
            await shot('r7-02-fallback-next');
            await page.locator('[data-ao="fallback-next"]').click();
            await page.locator('[data-akari-onboarding-step="drag"]').waitFor({ timeout: 15000 });
            observations.fallbackAdvanced = true;
            await shot('r7-03-fallback-advanced');
        } else {
            await writeFile(join(project, 'edit.json'), `${original}\n`);
            observations.injected = 'edit.json に改行を追加し resetTourExample の一致検査を失敗させた';
            if (mode === 'baseline') {
                await page.waitForTimeout(4000);
                assert.equal(await step.getAttribute('data-akari-onboarding-step'), 'tour3');
                assert.equal(await page.locator('[data-ao="next"]').count(), 0);
                observations.stuck = true;
                await shot('r7-00-baseline-stuck');
            } else {
                await page.locator('.ao-transition-error').waitFor({ timeout: 10000 });
                await page.getByRole('button', { name: 'もう一度', exact: true }).waitFor();
                await page.getByRole('button', { name: 'ガイドを閉じる', exact: true }).waitFor();
                observations.recovered = true;
                await shot('r7-01-failure-recovery');
                await writeFile(join(project, 'edit.json'), original);
                await page.getByRole('button', { name: 'もう一度', exact: true }).click();
                await page.locator('[data-akari-onboarding-step="drag"]').waitFor({ timeout: 15000 });
                observations.retryAdvanced = true;
                await shot('r7-01-retry-advanced');
            }
        }
    }
} catch (error) {
    observations.error = String(error instanceof Error ? error.stack : error).replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    observations.finishedAt = new Date().toISOString();
    await writeFile(join(here, `r7-${mode}-observations.json`), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
