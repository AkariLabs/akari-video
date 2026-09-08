// L1-a: 実機 Electron（隔離 HOME / THEIA_CONFIG_DIR / user-data-dir / AKARI_HOME /
// AKARI_CREDENTIALS_FILE）で初回セットアップの道具表を実 DOM 観測する。
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// evidence/first-run-unsupported/ からリポジトリ root を導く（machine 非依存）。
const WT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const require = createRequire(`${WT}/package.json`);
const { chromium } = require('playwright-core');

const PORT = 9433;
const EVIDENCE = `${WT}/apps/shell/extensions/akari-surfaces/evidence/first-run-unsupported`;
await mkdir(EVIDENCE, { recursive: true });

const scratch = await mkdtemp(join(tmpdir(), 'akari-l1-electron-'));
const home = join(scratch, 'home');
const theiaConfig = join(scratch, 'theia');
const udd = join(scratch, 'udd');
const akariHome = join(scratch, 'akari');
for (const d of [home, theiaConfig, udd, akariHome]) { await mkdir(d, { recursive: true }); }
const credentials = join(scratch, 'credentials.env');
await writeFile(credentials, '');

const env = {
    ...process.env,
    HOME: home,
    THEIA_CONFIG_DIR: theiaConfig,
    AKARI_HOME: akariHome,
    AKARI_CREDENTIALS_FILE: credentials
};
delete env.WHISPER_CPP_MODEL;
delete env.AKARI_WHISPER_MODEL;

const child = spawn(`${WT}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
    [`${WT}/apps/shell`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, '--no-sandbox'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
child.stdout.on('data', d => logs.push(String(d)));
child.stderr.on('data', d => logs.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { pid: child.pid, scratch, steps: {} };
let browser;
try {
    for (let i = 0; i < 120; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { break; } } catch { /* not up yet */ }
        await sleep(1000);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let page;
    for (let i = 0; i < 90; i++) {
        page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html'));
        if (page) { break; }
        await sleep(1000);
    }
    if (!page) { throw new Error(`frontend page not found. logs: ${logs.join('').slice(-2000)}`); }

    // 初回セットアップの自動表示を待つ。出なければコマンドで開く。
    const rowsVisible = async () => page.evaluate(() => document.querySelectorAll('[data-akari-tool-id]').length);
    let opened = 0;
    for (let i = 0; i < 60 && opened === 0; i++) { opened = await rowsVisible().catch(() => 0); await sleep(1000); }
    result.steps.autoOpened = opened > 0;
    if (opened === 0) {
        await page.evaluate(async () => {
            const container = window.theia.container;
            const keys = [...container._bindingDictionary._map.keys()];
            const key = keys.find(k => String(k) === 'Symbol(CommandService)' || k?.name === 'CommandRegistry');
            await container.get(key).executeCommand('akari.home.openFirstRunSetup');
        });
        for (let i = 0; i < 60 && opened === 0; i++) { opened = await rowsVisible().catch(() => 0); await sleep(1000); }
    }
    if (opened === 0) { throw new Error(`tool rows never rendered. logs: ${logs.join('').slice(-3000)}`); }

    const read = () => page.evaluate(() => ({
        rows: [...document.querySelectorAll('[data-akari-tool-id]')].map(row => ({
            id: row.getAttribute('data-akari-tool-id'),
            availableAttr: row.getAttribute('data-akari-tool-available'),
            label: row.querySelector('[data-akari-tool-availability-label]')?.textContent ?? null,
            hasCheckbox: !!row.querySelector('input[type="checkbox"]'),
            checked: row.querySelector('input[type="checkbox"]')?.checked ?? null,
            note: [...row.querySelectorAll('p')].map(p => p.textContent).join(' | ')
        })),
        installButton: document.querySelector('[data-akari-tool-install-selected]')?.textContent ?? null,
        installDisabled: document.querySelector('[data-akari-tool-install-selected]')?.disabled ?? null,
        recheckButton: document.querySelector('[data-akari-tool-recheck]')?.textContent ?? null
    }));
    result.steps.firstRunInitial = await read();

    // 道具検知は外部コマンド待ち（5s timeout）を含むため、起動直後の 1 回目は
    // 取りこぼすことがある。「再チェック」を押して落ち着いた状態も観測する。
    const speechLabel = async () => page.evaluate(() =>
        document.querySelector('[data-akari-tool-id="speech-analyzer"] [data-akari-tool-availability-label]')?.textContent ?? null);
    result.steps.rechecks = [];
    for (let attempt = 0; attempt < 3 && (await speechLabel()) !== '使える'; attempt++) {
        await page.click('[data-akari-tool-recheck]');
        for (let i = 0; i < 30; i++) {
            await sleep(1000);
            const button = await page.evaluate(() =>
                document.querySelector('[data-akari-tool-recheck]')?.textContent ?? null);
            if (button === '再チェック') { break; }
        }
        result.steps.rechecks.push(await speechLabel());
    }
    result.steps.firstRun = await read();
    await page.screenshot({ path: `${EVIDENCE}/l1-first-run-tools-macos.png` });

    // SpeechAnalyzer 行だけを寄せて撮る。
    const box = await page.evaluate(() => {
        const row = document.querySelector('[data-akari-tool-id="speech-analyzer"]');
        row?.scrollIntoView({ block: 'center' });
        const r = row?.getBoundingClientRect();
        return r ? { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 } : null;
    });
    if (box) { await page.screenshot({ path: `${EVIDENCE}/l1-first-run-speech-analyzer-row.png`, clip: box }); }
    result.steps.speechAnalyzerBox = box;
} finally {
    if (browser) { await browser.close().catch(() => undefined); }
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
    await sleep(2500);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
}
result.logsTail = logs.join('').slice(-1500);
console.log(JSON.stringify(result, null, 1));
