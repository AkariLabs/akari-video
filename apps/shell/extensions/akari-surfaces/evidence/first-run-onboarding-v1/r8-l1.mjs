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
if (!['direct', 'skip'].includes(mode) || !scratch) throw new Error('mode and isolated root required');
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
delete env.NODE_OPTIONS;
const port = mode === 'direct' ? 19570 : 19571;
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const observations = { mode, startedAt: new Date().toISOString(), shots: [], electronPid: child.pid };
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
    await page.locator('[data-akari-onboarding-step="welcome"]').waitFor();
    await page.locator('[data-ao="next"]').click();
    await page.locator('[data-akari-onboarding-step="first"]').waitFor();
    await page.locator('[data-ao="yes"]').click();
    await page.locator('[data-akari-onboarding-step="invite"]').waitFor();
    await page.locator('[data-ao="start"]').click();
    await page.locator('[data-akari-onboarding-step="tour0"]').waitFor({ timeout: 180000 });
    const initialState = JSON.parse(await readFile(join(akariHome, 'onboarding-v1.json'), 'utf8'));
    const project = fileURLToPath(initialState.projectUri);
    observations.project = project.replaceAll(scratch, '<isolated>');
    await page.getByText('これが AKARI Video の画面です', { exact: true }).waitFor();
    await page.locator('[data-ao="next"]').click();
    await page.getByText('① 左は「素材」です', { exact: true }).waitFor();
    await page.locator('[data-ao="next"]').click();
    await page.getByText('② 下は「タイムライン」です', { exact: true }).waitFor();
    await page.locator('[data-ao="next"]').click();
    await page.getByText('③ 右は「AI パートナー」です', { exact: true }).waitFor();
    const editPath = join(project, 'edit.json');
    const before = await readFile(editPath, 'utf8');
    await page.locator('[data-ao="next"]').click();
    await page.getByText('では、これを一緒につくってみましょう', { exact: true }).waitFor();
    if (mode === 'direct') {
        await writeFile(editPath, `${before}\n`);
        observations.injected = 'tour3 で edit.json に改行を追加';
        await shot('r8-01-tampered-tour3');
        await page.locator('[data-akari-onboarding-step="drag"]').waitFor({ timeout: 15000 });
        assert.equal(await page.locator('.ao-transition-error').count(), 0);
        await page.getByText('まず素材を入れます', { exact: true }).waitFor();
        const edit = JSON.parse(await readFile(editPath, 'utf8'));
        assert.equal(edit.sources.length, 0);
        assert.equal(await stat(join(project, 'captions.json')).then(() => true, () => false), false);
        observations.advancedWithoutRecovery = true;
        await shot('r8-02-drag-after-cleanup');
    } else {
        const statePath = join(akariHome, 'onboarding-v1.json');
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        await writeFile(statePath, `${JSON.stringify({ ...state, exampleActive: false }, null, 2)}\n`);
        observations.injected = 'tour3 で保存済み状態の exampleActive を false に変更';
        await page.locator('.ao-transition-error').waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: '片付けを飛ばして次へ', exact: true }).waitFor();
        await shot('r8-03-skip-available');
        await page.getByRole('button', { name: '片付けを飛ばして次へ', exact: true }).click();
        await page.locator('[data-akari-onboarding-step="drag"]').waitFor({ timeout: 15000 });
        await page.getByText('素材はもう入っています', { exact: true }).waitFor();
        assert.equal(await readFile(editPath, 'utf8'), before);
        assert.equal(await stat(join(project, 'assets', 'サンプル動画.mp4')).then(() => true, () => false), true);
        observations.skipAdvanced = true;
        await shot('r8-04-skip-advanced');
    }
} catch (error) {
    observations.error = String(error instanceof Error ? error.stack : error).replaceAll(scratch, '<isolated>');
    console.error(observations.error);
} finally {
    observations.finishedAt = new Date().toISOString();
    await writeFile(join(here, `r8-${mode}-observations.json`), `${JSON.stringify(observations, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    log.end();
}
process.exit(observations.error ? 1 : 0);
