import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);
const shellRoot = resolve(here, '../../../..');
const electron = join(shellRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const options = parseOptions(process.argv.slice(2));

if (options.worker) {
    await runWorker(options);
} else {
    await runParent();
}

async function runParent() {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-first-run-l1-'));
    const isolatedHome = join(scratch, 'home');
    const akariHome = join(scratch, 'akari-home');
    await mkdir(isolatedHome, { recursive: true });
    await mkdir(akariHome, { recursive: true });

    try {
        const launches = [];
        for (const phase of ['first', 'second']) {
            const resultFile = join(scratch, `${phase}-launch-result.json`);
            await runLaunchWorker({ phase, scratch, isolatedHome, akariHome, resultFile });
            launches.push(JSON.parse(await readFile(resultFile, 'utf8')));
        }

        const observations = {
            sharedAkariHome: true,
            launches
        };
        await writeFile(join(here, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify(observations, null, 2));
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}

async function runLaunchWorker({ phase, scratch, isolatedHome, akariHome, resultFile }) {
    const child = spawn(process.execPath, [
        scriptPath,
        '--worker',
        `--phase=${phase}`,
        `--scratch=${scratch}`,
        `--isolated-home=${isolatedHome}`,
        `--akari-home=${akariHome}`,
        `--output-dir=${here}`,
        `--result-file=${resultFile}`
    ], {
        cwd: shellRoot,
        stdio: 'inherit'
    });

    await new Promise((resolveExit, rejectExit) => {
        child.once('error', rejectExit);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolveExit();
                return;
            }
            rejectExit(new Error(`Launch ${phase} worker exited with ${signal ?? code}`));
        });
    });
}

async function runWorker(workerOptions) {
    const config = validateWorkerOptions(workerOptions);
    const result = config.phase === 'first'
        ? await captureFirstLaunch(config)
        : await captureSecondLaunch(config);
    await writeFile(config.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function captureFirstLaunch(config) {
    const session = await launch(config, 9451, 'user-data-1');
    try {
        const { page } = session;
        await waitForStage(page, 'welcome');
        await waitForSetupDialog(page);
        await page.locator('[data-akari-setup-tools="true"]').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('[data-akari-tool-id]').length >= 7);
        const tools = await page.locator('[data-akari-tool-id]').evaluateAll(nodes => nodes.map(node => ({
            id: node.getAttribute('data-akari-tool-id'),
            available: node.getAttribute('data-akari-tool-available')
        })));
        await page.screenshot({ path: join(config.outputDir, '01-tools-check.png') });

        await page.locator('[data-akari-setup-next-workspace="true"]').click();
        await page.locator('[data-akari-setup-workspace="true"]').waitFor();
        await page.screenshot({ path: join(config.outputDir, '02-workspace-create.png') });

        await page.locator('[data-akari-setup-create-workspace="true"]').click();
        await page.locator('[data-akari-setup-connection="true"]').waitFor({ timeout: 30_000 });
        await page.screenshot({ path: join(config.outputDir, '03-connection-guide.png') });

        await page.locator('[data-akari-setup-connect="true"]').click();
        const cancel = page.getByText('キャンセル', { exact: true });
        await cancel.waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(config.outputDir, '04-existing-01-gate.png') });
        await cancel.click();
        await waitForStage(page, 'dashboard');
        await page.screenshot({ path: join(config.outputDir, '05-dashboard.png') });

        const marker = JSON.parse(await readFile(join(config.akariHome, 'first-run-onboarding-v0.json'), 'utf8'));
        const pointer = JSON.parse(await readFile(join(config.akariHome, 'creator-root.json'), 'utf8'));
        const manifest = JSON.parse(await readFile(join(pointer.lastRoot, '.akari/root.json'), 'utf8'));
        return {
            launch: 1,
            stages: ['welcome+setup-dialog', 'workspace-dialog', 'connection-dialog', 'dashboard'],
            tools,
            marker,
            pointer,
            manifestSchema: manifest.schema
        };
    } finally {
        await session.close();
    }
}

async function captureSecondLaunch(config) {
    const session = await launch(config, 9452, 'user-data-2');
    try {
        const { page } = session;
        await waitForStage(page, 'welcome');
        const autoSetupCount = await page.locator('[data-akari-first-run-dialog="true"]').count();
        const reopenButton = page.locator('[data-akari-open-first-run-setup="true"]');
        await reopenButton.waitFor({ timeout: 10_000 });
        const reopenButtonCount = await reopenButton.count();
        await page.screenshot({ path: join(config.outputDir, '06-second-launch-no-auto-setup.png') });

        await reopenButton.first().click();
        await waitForSetupDialog(page);
        await page.keyboard.press('Escape');
        await page.locator('[data-akari-first-run-dialog="true"]').waitFor({ state: 'detached', timeout: 10_000 });
        await waitForStage(page, 'welcome');

        await page.keyboard.press('F1');
        const input = page.locator('.quick-input-widget input');
        await input.waitFor({ timeout: 10_000 });
        await input.fill('>初回セットアップ');
        const commandOption = page.locator('[role="option"][aria-label="初回セットアップを開く"]');
        await commandOption.waitFor({ timeout: 10_000 });
        await commandOption.click();
        await waitForSetupDialog(page);
        await page.screenshot({ path: join(config.outputDir, '07-command-reopen.png') });
        await page.locator('[data-akari-first-run-dialog="true"] .dialogTitle .closeButton').click();
        await page.locator('[data-akari-first-run-dialog="true"]').waitFor({ state: 'detached', timeout: 10_000 });
        return {
            launch: 2,
            initialStage: 'welcome',
            autoSetupCount,
            reopenButtonCount,
            buttonReopenClosedWithEscape: true,
            commandStage: 'setup-dialog-over-welcome',
            commandReopenClosedWithX: true
        };
    } finally {
        await session.close();
    }
}

async function launch(config, port, profileName) {
    const profile = join(config.scratch, profileName);
    const logPath = join(config.scratch, `${profileName}.log`);
    await mkdir(profile, { recursive: true });
    const log = createWriteStream(logPath, { flags: 'a' });
    const child = spawn(electron, [
        shellRoot,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        '--no-sandbox'
    ], {
        cwd: shellRoot,
        env: {
            ...process.env,
            HOME: config.isolatedHome,
            USERPROFILE: config.isolatedHome,
            AKARI_HOME: config.akariHome,
            THEIA_CONFIG_DIR: profile,
            AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let spawnFailure;
    child.once('error', error => {
        spawnFailure = error;
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);

    let browser;
    try {
        await waitForCdp(port, child, logPath, () => spawnFailure);
        const { chromium } = await import('playwright-core');
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? await context.waitForEvent('page');
        await page.waitForLoadState('domcontentloaded');
        await page.locator('.theia-preload').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => undefined);
        return {
            page,
            close: createSessionCloser(browser, child, log)
        };
    } catch (error) {
        try {
            await closeSession(browser, child, log);
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Electron launch and exact-PID cleanup both failed');
        }
        throw error;
    }
}

function createSessionCloser(browser, child, log) {
    let closePromise;
    return () => {
        closePromise ??= closeSession(browser, child, log);
        return closePromise;
    };
}

async function closeSession(browser, child, log) {
    try {
        if (browser) {
            await withTimeout(Promise.resolve().then(() => browser.close()), 3_000).catch(() => undefined);
        }
    } finally {
        try {
            await terminateExactChild(child);
        } finally {
            log.end();
        }
    }
}

async function terminateExactChild(child) {
    if (!isChildRunning(child)) {
        return;
    }
    child.kill('SIGTERM');
    if (await waitForChildExit(child, 5_000)) {
        return;
    }
    child.kill('SIGKILL');
    if (!await waitForChildExit(child, 5_000)) {
        throw new Error(`Electron PID ${child.pid} did not exit after SIGKILL`);
    }
}

function isChildRunning(child) {
    return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function waitForChildExit(child, timeoutMs) {
    if (!isChildRunning(child)) {
        return Promise.resolve(true);
    }
    return new Promise(resolveExit => {
        const onExit = () => {
            clearTimeout(timer);
            resolveExit(true);
        };
        const timer = setTimeout(() => {
            child.off('exit', onExit);
            resolveExit(!isChildRunning(child));
        }, timeoutMs);
        child.once('exit', onExit);
        if (!isChildRunning(child)) {
            child.off('exit', onExit);
            clearTimeout(timer);
            resolveExit(true);
        }
    });
}

function withTimeout(promise, timeoutMs) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, rejectTimeout) => {
            timer = setTimeout(() => rejectTimeout(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

async function waitForCdp(port, child, logPath, getSpawnFailure) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const spawnFailure = getSpawnFailure();
        if (spawnFailure) {
            throw spawnFailure;
        }
        if (!isChildRunning(child)) {
            throw new Error(`Electron exited with ${child.signalCode ?? child.exitCode}: ${await readFile(logPath, 'utf8')}`);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (response.ok) {
                return;
            }
        } catch {
            // 起動待ち。
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    throw new Error(`CDP did not become ready: ${await readFile(logPath, 'utf8')}`);
}

async function waitForStage(page, stage) {
    await page.locator(`[data-akari-home-stage="${stage}"]`).waitFor({ timeout: 60_000 });
}

async function waitForSetupDialog(page) {
    await page.locator('[data-akari-first-run-dialog="true"]').waitFor({ timeout: 60_000 });
}

function parseOptions(args) {
    const parsed = {};
    for (const argument of args) {
        if (argument === '--worker') {
            parsed.worker = true;
            continue;
        }
        if (!argument.startsWith('--') || !argument.includes('=')) {
            throw new Error(`Unknown argument: ${argument}`);
        }
        const separator = argument.indexOf('=');
        parsed[toCamelCase(argument.slice(2, separator))] = argument.slice(separator + 1);
    }
    return parsed;
}

function toCamelCase(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function validateWorkerOptions(workerOptions) {
    const required = ['phase', 'scratch', 'isolatedHome', 'akariHome', 'outputDir', 'resultFile'];
    for (const key of required) {
        if (typeof workerOptions[key] !== 'string' || workerOptions[key].length === 0) {
            throw new Error(`Worker option --${key} is required`);
        }
    }
    if (!['first', 'second'].includes(workerOptions.phase)) {
        throw new Error(`Unknown launch phase: ${workerOptions.phase}`);
    }
    return workerOptions;
}
