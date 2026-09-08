// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-08-startup-rangeerror-and-duplicate-preference 指示 1 / 4。
//
// 使い方:
//   node run-l1.mjs <ワークスペース絶対パス> <ラベル> <CDP ポート>
//
// 環境変数:
//   AKARI_L1_OUT      出力先ディレクトリ（既定 $TMPDIR/akari-l1-startup-out）
//   AKARI_L1_ALLOW_DIRTY=1 判定に失敗しても exit 0 で返す（修正前のベースライン採取用）
//   AKARI_L1_RELOAD=1 CDP を張ったままフロントエンドを 1 回リロードし、
//                     `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` から
//                     例外の**自前スタック**（Error.description）を採取する。
//                     リロード後のログは件数集計から除外する（マーカーで区切る）。
//
// 判定（受け入れ条件）: 起動ログ（リロード前）に
//   - "Maximum call stack size exceeded" が 0 件
//   - "already exists" が 0 件
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME / AKARI_CREDENTIALS_FILE は
// すべて一時プロファイル配下に向けてあり、実利用の ~/.theia ~/.akari ~/.config/akari-video
// は読み書きしない。起動した Electron は必ず kill する。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw] = process.argv;
const port = Number(portRaw ?? 21994);
const outDir = process.env.AKARI_L1_OUT ?? path.join(tmpdir(), 'akari-l1-startup-out');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-startup-'));
const wantReload = process.env.AKARI_L1_RELOAD === '1';
const log = [];
let markIndex = Number.POSITIVE_INFINITY;   // リロード時点。ここから先は集計に入れない

const child = spawn(
    ELECTRON,
    [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    {
        env: {
            ...process.env,
            HOME: profile,
            THEIA_CONFIG_DIR: path.join(profile, '.theia'),
            AKARI_HOME: path.join(profile, '.akari'),
            AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
            ELECTRON_ENABLE_LOGGING: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    }
);
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');
const countedText = () => log.slice(0, Math.min(markIndex, log.length)).join('');
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const killAll = () => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    // ipc-bootstrap ヘルパは profile もワークスペースも argv に持たないので
    // シェルの lib/backend パスでも名指しする（ppid=1 の孤児を残さない）。
    for (const needle of [profile, `${SHELL} ${workspace}`, path.join(SHELL, 'lib/backend')]) {
        try { execFileSync('/usr/bin/pkill', ['-9', '-f', needle], { stdio: 'ignore' }); } catch { /* none left */ }
    }
};

const measurements = { label, workspace, profile, reload: wantReload, exceptions: [], consoleErrors: [] };

const finish = async () => {
    const counted = countedText();
    measurements.rangeErrorCount = countOf(counted, 'Maximum call stack size exceeded');
    measurements.alreadyExistsCount = countOf(counted, 'already exists');
    measurements.developerModeAlreadyExists = countOf(counted, "Property with id 'akari.developerMode' already exists");
    measurements.reachedReady = counted.includes("to 'ready'");
    measurements.failedToStart = counted.includes('Failed to start the frontend application.');
    // L1 アサーション（task 2026-09-08 受け入れ条件）:
    // 隔離プロファイルでの起動ログに RangeError も重複 preference 警告も出ない。
    measurements.pass = measurements.rangeErrorCount === 0
        && measurements.alreadyExistsCount === 0
        && measurements.reachedReady
        && !measurements.failedToStart;
    killAll();
    await sleep(800);
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify(measurements, null, 2));
};

let browser;
try {
    for (let i = 0; i < 600 && !browser; i++) {
        await sleep(100);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) { throw new Error('CDP connect failed'); }
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 60 && !page; i++) { await sleep(500); page = context.pages().find(p => !p.url().startsWith('devtools://')); }
    if (!page) { throw new Error('no page target'); }
    page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));

    const client = await context.newCDPSession(page);
    const seen = new Set();
    const push = (bucket, entry) => {
        const key = `${bucket}:${entry.text}`.slice(0, 4000);
        if (seen.has(key)) { return; }
        seen.add(key);
        measurements[bucket].push(entry);
    };
    client.on('Runtime.consoleAPICalled', e => {
        if (e.type !== 'error' && e.type !== 'warning') { return; }
        for (const arg of e.args ?? []) {
            const body = arg.description ?? (typeof arg.value === 'string' ? arg.value : undefined);
            if (!body) { continue; }
            if (!/Maximum call stack|already exists/.test(body)) { continue; }
            push('consoleErrors', {
                type: e.type,
                text: body.split('\n').slice(0, 12).join('\n'),
                callSite: (e.stackTrace?.callFrames ?? []).slice(0, 8)
                    .map(f => `${f.functionName || '<anonymous>'} (${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
            });
        }
    });
    client.on('Runtime.exceptionThrown', e => {
        const d = e.exceptionDetails ?? {};
        const body = d.exception?.description ?? d.text ?? '';
        if (!/Maximum call stack|already exists/.test(body)) { return; }
        push('exceptions', {
            text: body.split('\n').slice(0, 12).join('\n'),
            frames: (d.stackTrace?.callFrames ?? []).slice(0, 8)
                .map(f => `${f.functionName || '<anonymous>'} (${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
        });
    });
    await client.send('Runtime.enable');

    await page.waitForSelector('#theia-app-shell', { timeout: 240000 }).catch(() => undefined);
    for (let i = 0; i < 30 && !text().includes("to 'ready'"); i++) { await sleep(2000); }
    await sleep(3000);
    // ウィンドウタイトル（F11 / task 2026-08-09 の enhanceTitle が生きていることの確認）。
    // 循環を切った遅延解決が実際に WindowTitleService へ届いているかはここに出る。
    measurements.documentTitle = await page.evaluate(() => document.title).catch(() => null);
    await page.screenshot({ path: path.join(outDir, `${label}.png`) }).catch(() => undefined);

    if (wantReload) {
        markIndex = log.length;
        log.push('\n===== RELOAD MARKER (以降は件数集計に入れない) =====\n');
        await page.reload({ timeout: 240000 }).catch(() => undefined);
        await page.waitForSelector('#theia-app-shell', { timeout: 240000 }).catch(() => undefined);
        await sleep(20000);
    }
    await finish();
    process.exit(measurements.pass || process.env.AKARI_L1_ALLOW_DIRTY === '1' ? 0 : 2);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish();
    process.exit(1);
}
