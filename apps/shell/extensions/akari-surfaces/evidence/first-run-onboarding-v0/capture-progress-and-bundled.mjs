import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * task 2026-08-17-tool-install-progress-bundled 手順9 の追撮専用ハーネス。
 * `capture.mjs`（初回セットアップ v2 本体の証跡）とは別ファイルにしてある —
 * 起動・CDP接続の骨格は複製だが、本タスクの2点だけを検証する専用スクリプトのため。
 *
 * (a) 進捗バー表示中の道具面: 実インストール（実 brew・実DL）はオーナーのマシンへの
 *     実インストールを禁じる task.md の制約により行わない。「偽の遅い検知/インストールを
 *     モックして撮ってよい」の許可（task.md 手順9）に従い、実アプリの実ダイアログ内に、
 *     ソースと同一の DOM 構造（`createProgressBarElement` / `renderOverallInstallProgress`
 *     と同じ属性・インラインスタイル）を注入して可視化する。ロジック自体（バイト整形・
 *     brew stdout→フェーズ変換）は `tool-install-progress.test.mjs` で実測済み。
 * (b) 同梱 ffmpeg の「インストール済み」判定: `packages/media-bin/` は並走タスク
 *     2026-08-17-media-bin-whisper の所有のため書き込めない。そのため
 *     `process.resourcesPath` 側の候補（`<Resources>/media-bin/ffmpeg`）を実証に使う
 *     （dev vendor 側は tool-detection.test.mjs で実ファイル+実 spawn 済み）。
 *     Electron dev 起動時の resourcesPath は `node_modules/electron/dist/Electron.app/
 *     Contents/Resources`（git-ignore 済み・書き込み可）を指すため、そこへ実行可能な
 *     偽 ffmpeg を置いて実行し、実プロセスとして解決させる。PATH は brew 由来の実 ffmpeg
 *     を含まない最小構成にして「PATH に無くても同梱で解決する」ことを実際に確認する。
 */

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);
const shellRoot = resolve(here, '../../../..');
const electron = createRequire(scriptPath)('electron');

await main();

async function main() {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-progress-bundled-l1-'));
    const isolatedHome = join(scratch, 'home');
    const akariHome = join(scratch, 'akari-home');
    await mkdir(isolatedHome, { recursive: true });
    await mkdir(akariHome, { recursive: true });

    const observations = { capturedAt: new Date().toISOString() };
    let session;
    try {
        session = await launch({ scratch, isolatedHome, akariHome }, 9453, 'user-data-progress-bundled');
        const { page } = session;
        await waitForStage(page, 'welcome');
        await waitForSetupDialog(page);
        await page.locator('[data-akari-setup-tools="true"]').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('[data-akari-tool-id]').length >= 7);

        // --- (b) 同梱 ffmpeg 判定 -------------------------------------------------
        const ffmpegRow = page.locator('[data-akari-tool-id="ffmpeg"]');
        await ffmpegRow.waitFor();
        const ffmpegState = await ffmpegRow.evaluate(node => ({
            available: node.getAttribute('data-akari-tool-available'),
            availabilityLabel: node.querySelector('[data-akari-tool-availability-label]')?.textContent ?? null,
            versionText: node.querySelector('strong')?.parentElement?.textContent ?? null
        }));
        observations.bundledFfmpeg = ffmpegState;
        await page.screenshot({ path: join(here, '07-bundled-ffmpeg-installed.png') });

        // --- (a) 進捗バー（モック注入）----------------------------------------------
        // 実 DL/実 brew は行わない（task.md の実インストール禁止制約）。ソースと同じ
        // DOM 構造・属性・インラインスタイルを、実ダイアログの実 yt-dlp 行の直下へ注入する。
        const injected = await page.evaluate(() => {
            const panel = document.querySelector('[data-akari-setup-tools="true"]');
            const ytDlpRow = document.querySelector('[data-akari-tool-id="yt-dlp"]');
            if (!panel || !ytDlpRow) {
                return { ok: false, reason: 'panel or yt-dlp row not found' };
            }

            // tool-install-progress.ts と同一のロジック（実測済み・ここでは表示確認のみ）。
            const formatBytes = bytes => {
                const mb = Math.max(0, bytes) / (1024 * 1024);
                return mb < 1 ? `${Math.round(mb * 10) / 10}MB` : `${Math.round(mb)}MB`;
            };
            const formatDownloadProgressLabel = (downloaded, total) =>
                total ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded);
            const computeDownloadPercent = (downloaded, total) =>
                total ? Math.min(100, Math.max(0, Math.round((downloaded / total) * 100))) : undefined;

            // 全体バー「1 / 2」（akari-first-run-setup-dialog.ts の renderOverallInstallProgress と同一構造）。
            const overallWrap = document.createElement('div');
            overallWrap.setAttribute('data-akari-tool-install-overall-progress', 'true');
            overallWrap.setAttribute('data-akari-evidence-mock', 'true');
            Object.assign(overallWrap.style, { margin: '16px 0 0' });
            const overallLabel = document.createElement('p');
            overallLabel.setAttribute('role', 'status');
            overallLabel.textContent = 'インストール中: yt-dlp (1/2)…';
            Object.assign(overallLabel.style, {
                margin: '0 0 6px', color: 'var(--theia-editorWidget-foreground)', fontSize: '12.5px', fontWeight: '600'
            });
            const overallTrack = document.createElement('div');
            Object.assign(overallTrack.style, {
                height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'var(--theia-widget-border)'
            });
            const overallFill = document.createElement('div');
            Object.assign(overallFill.style, {
                height: '100%', width: '0%', background: 'var(--theia-focusBorder)', transition: 'width 0.3s ease'
            });
            overallTrack.appendChild(overallFill);
            overallWrap.append(overallLabel, overallTrack);
            panel.insertBefore(overallWrap, panel.querySelector('div[style*="flex-end"]'));

            // 行内バー（createProgressBarElement と同一構造）— yt-dlp 行の直下（determinate: 12MB/35MB）。
            const downloaded = 12 * 1024 * 1024;
            const total = 35 * 1024 * 1024;
            const rowWrap = document.createElement('div');
            rowWrap.setAttribute('data-akari-tool-progress-bar', 'true');
            rowWrap.setAttribute('data-akari-tool-progress-kind', 'download');
            rowWrap.setAttribute('data-akari-evidence-mock', 'true');
            Object.assign(rowWrap.style, { marginTop: '8px' });
            const rowTrack = document.createElement('div');
            Object.assign(rowTrack.style, {
                position: 'relative', height: '5px', borderRadius: '999px', overflow: 'hidden',
                background: 'var(--theia-widget-border)'
            });
            const rowFill = document.createElement('div');
            rowFill.setAttribute('data-akari-tool-progress-mode', 'determinate');
            Object.assign(rowFill.style, {
                position: 'absolute', top: '0', bottom: '0', left: '0', borderRadius: '999px',
                background: 'var(--theia-focusBorder)', width: `${computeDownloadPercent(downloaded, total)}%`
            });
            rowTrack.appendChild(rowFill);
            const rowLabel = document.createElement('div');
            rowLabel.setAttribute('data-akari-tool-progress-label', 'true');
            rowLabel.textContent = formatDownloadProgressLabel(downloaded, total);
            Object.assign(rowLabel.style, {
                marginTop: '4px', fontSize: '10.5px', color: 'var(--theia-descriptionForeground)', fontFamily: 'monospace'
            });
            rowWrap.append(rowTrack, rowLabel);
            const ytDlpBody = ytDlpRow.querySelector('div');
            ytDlpBody?.appendChild(rowWrap);

            return {
                ok: true,
                overallLabel: overallLabel.textContent,
                rowLabel: rowLabel.textContent,
                rowPercent: rowFill.style.width
            };
        });
        observations.progressMock = injected;
        await page.screenshot({ path: join(here, '08-tool-install-progress-mock.png') });
    } finally {
        if (session) {
            await session.close();
        }
        await writeFile(
            join(here, 'observations-progress-and-bundled.json'),
            `${JSON.stringify(observations, null, 2)}\n`,
            'utf8'
        );
        console.log(JSON.stringify(observations, null, 2));
        if (process.env.KEEP_SCRATCH === '1') {
            console.error(`[debug] scratch kept at ${scratch}`);
        } else {
            await rm(scratch, { recursive: true, force: true });
        }
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
            AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
            // brew 由来の実 ffmpeg 等だけを PATH から外し、「同梱が PATH より優先」を実証する
            // （(b) の検証意図）。他のディレクトリ（Node/Electron 起動に要る可能性がある物）は
            // 実 PATH をそのまま引き継ぐ — homebrew の bin/sbin だけを除去する。
            PATH: filterOutHomebrewFromPath(process.env.PATH ?? '')
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

function filterOutHomebrewFromPath(rawPath) {
    return rawPath
        .split(':')
        .filter(segment => !/\/(opt\/homebrew|usr\/local)\/(bin|sbin)\/?$/.test(segment))
        .join(':');
}

async function waitForStage(page, stage) {
    await page.locator(`[data-akari-home-stage="${stage}"]`).waitFor({ timeout: 60_000 });
}

async function waitForSetupDialog(page) {
    await page.locator('[data-akari-first-run-dialog="true"]').waitFor({ timeout: 60_000 });
}
