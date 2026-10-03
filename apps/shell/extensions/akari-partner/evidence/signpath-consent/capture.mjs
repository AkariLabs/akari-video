// 実機 Electron（隔離 HOME / AKARI_HOME / THEIA_CONFIG_DIR / user-data-dir）で、システムを変える前の
// 3 つの確認画面（道具の導入・AI パートナーの導入・書き出し時の GPU 設定）を実 DOM で観測して撮る。
//
//   node apps/shell/extensions/akari-partner/evidence/signpath-consent/capture.mjs [tools-partner|gpu-decline|gpu-allow ...]
//
// 前提: `apps/shell` を build 済み（`npm run build`）で、node_modules/electron/dist が健全なこと。
// どのシナリオも「導入する」「インストール」は押さない（提供元のインストーラーを実際には走らせない）。
// GPU の確認は Windows だけで出るので、表示判定だけを切り替える AKARI_TEST_WINDOWS_GPU_CONSENT=1 を使う
// （macOS ではレジストリ操作は起きない）。
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WT = resolve(HERE, '../../../../../..');
const require = createRequire(`${WT}/package.json`);
const { chromium } = require('playwright-core');
const ELECTRON = require('electron');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scenarios = process.argv.slice(2).length ? process.argv.slice(2) : ['tools-partner', 'gpu-decline', 'gpu-allow'];
const observationsPath = join(HERE, 'observations.json');
const observations = await readFile(observationsPath, 'utf8').then(JSON.parse, () => ({}));

async function launch(name, port, { project = false, seen = false, gpuSeam = false, minimalPath = false } = {}) {
    const scratch = join(tmpdir(), 'signpath-consent-evidence', name);
    await rm(scratch, { recursive: true, force: true });
    const dirs = { home: join(scratch, 'home'), akariHome: join(scratch, 'akari-home'), theia: join(scratch, 'theia'), udd: join(scratch, 'userData') };
    for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
    const credentials = join(scratch, 'credentials.env');
    await writeFile(credentials, '');
    const args = [join(WT, 'apps/shell')];
    let projectDir;
    if (project) {
        projectDir = join(scratch, 'project');
        await cp(join(WT, 'test-project'), projectDir, { recursive: true });
        args.push(projectDir);
    }
    if (seen) {
        await writeFile(join(dirs.akariHome, 'first-run-onboarding-v0.json'), JSON.stringify({ schema: 1, shownAt: new Date().toISOString() }));
    }
    args.push(`--remote-debugging-port=${port}`, `--user-data-dir=${dirs.udd}`, '--no-sandbox',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding');
    const env = { ...process.env, HOME: dirs.home, USERPROFILE: dirs.home, AKARI_HOME: dirs.akariHome, THEIA_CONFIG_DIR: dirs.theia,
        AKARI_CREDENTIALS_FILE: credentials, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.AKARI_EXPORT_GPU_PREFERENCE;
    if (gpuSeam) env.AKARI_TEST_WINDOWS_GPU_CONSENT = '1';
    if (minimalPath) env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    const log = openSync(join(scratch, 'electron.log'), 'a');
    const child = spawn(ELECTRON, args, { cwd: join(WT, 'apps/shell'), env, stdio: ['ignore', log, log], detached: true });
    let browser;
    for (let i = 0; i < 240 && !browser; i++) {
        if (child.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode})`);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await sleep(1000); }
    }
    if (!browser) throw new Error('CDP に接続できませんでした');
    let page;
    for (let i = 0; i < 240 && !page; i++) {
        page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html'));
        if (!page) await sleep(1000);
    }
    if (!page) throw new Error('frontend page が見つかりません');
    page.setDefaultTimeout(120000);
    // 窓を広げる（失敗しても撮影は続ける）。
    try {
        const pageSession = await page.context().newCDPSession(page);
        const { targetInfo } = await pageSession.send('Target.getTargetInfo');
        const browserSession = await browser.newBrowserCDPSession();
        const { windowId } = await browserSession.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
        await browserSession.send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 960 } });
    } catch { /* 既定の窓サイズのまま */ }
    await page.waitForFunction(() => Boolean(window.theia?.container && document.getElementById('theia-app-shell')), null, { timeout: 600000 });
    await sleep(6000);
    const stop = async () => {
        await browser.close().catch(() => undefined);
        // 自分が起動した PID（とその子）だけを終了する。
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
        await sleep(2500);
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    return { page, scratch, dirs, projectDir, pid: child.pid, stop };
}

const command = (page, id, arg) => page.evaluate(async ([commandId, commandArg]) => {
    const container = window.theia.container;
    const keys = [...container._bindingDictionary._map.keys()];
    const key = keys.find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function')
        ?? keys.find(k => String(k) === 'Symbol(CommandService)');
    void container.get(key).executeCommand(commandId, commandArg);
    return true;
}, [id, arg]);

const clickButtonByText = (page, scopeSelector, text) => page.evaluate(([scope, label]) => {
    const roots = [...document.querySelectorAll(scope)];
    const root = roots[roots.length - 1];
    const button = [...(root?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === label);
    button?.click();
    return Boolean(button);
}, [scopeSelector, text]);

// はじめてのガイド（全面の覆い）が遅れて出ることがあるので、少し待ってから閉じる。出なければ何もしない。
const closeGuide = async page => {
    for (let i = 0; i < 20; i++) {
        const closed = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('ガイドを閉じる'));
            button?.click();
            return Boolean(button);
        });
        if (closed) {
            await page.waitForFunction(() => !document.body.innerText.includes('ガイドを閉じました'), null, { timeout: 30000 }).catch(() => undefined);
            return true;
        }
        await sleep(500);
    }
    return false;
};

const listTree = async root => {
    const out = [];
    const walk = async (dir, depth) => {
        for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
            out.push(join(dir, entry.name).slice(root.length + 1));
            if (entry.isDirectory() && depth < 4) await walk(join(dir, entry.name), depth + 1);
        }
    };
    await walk(root, 0);
    return out;
};

async function toolsAndPartner() {
    const app = await launch('tools-partner', 19471, { minimalPath: true, seen: true });
    const { page } = app;
    const result = { pid: app.pid };
    try {
        result.guideClosed = await closeGuide(page);
        await sleep(1500);
        // --- 道具: 初回セットアップの「道具チェック」
        await command(page, 'akari.home.openFirstRunSetup');
        await page.waitForFunction(() => document.querySelectorAll('[data-akari-tool-id]').length > 0);
        await page.waitForFunction(() => document.querySelector('[data-akari-tool-recheck]')?.textContent.trim() === '再チェック', null, { timeout: 180000 });
        await page.waitForFunction(() => !document.body.innerText.includes('ガイドを閉じました'), null, { timeout: 30000 }).catch(() => undefined);
        const readTools = () => page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('.dialogOverlay')];
            const dialog = dialogs[dialogs.length - 1];
            return {
                title: dialog?.querySelector('.dialogTitle')?.innerText ?? null,
                notices: [...(dialog?.querySelectorAll('p, div') ?? [])].filter(e => e.childElementCount === 0)
                    .map(e => e.textContent).filter(t => /winget|Homebrew|管理者|選んでください/.test(t)),
                rows: [...document.querySelectorAll('[data-akari-tool-id]')].map(row => ({
                    id: row.getAttribute('data-akari-tool-id'),
                    available: row.getAttribute('data-akari-tool-available'),
                    hasCheckbox: Boolean(row.querySelector('input[type="checkbox"]')),
                    checked: row.querySelector('input[type="checkbox"]')?.checked ?? null,
                    provider: [...row.querySelectorAll('div, span')].map(e => e.textContent).find(t => t.startsWith('提供元:')) ?? null,
                    termsHref: row.querySelector('a')?.getAttribute('href') ?? null
                })),
                installButton: document.querySelector('[data-akari-tool-install-selected]')?.textContent ?? null,
                installDisabled: document.querySelector('[data-akari-tool-install-selected]')?.disabled ?? null
            };
        });
        result.firstRunTools = await readTools();
        await page.screenshot({ path: join(HERE, '01-tools-first-run.png') });
        // 未導入（チェック欄のある）行を寄せる。初期状態では何も選ばれていないこと。
        const scrolled = await page.evaluate(() => {
            const row = [...document.querySelectorAll('[data-akari-tool-id]')].find(r => r.querySelector('input[type="checkbox"]'));
            row?.scrollIntoView({ block: 'center' });
            return row?.getAttribute('data-akari-tool-id') ?? null;
        });
        result.firstRunUncheckedRow = scrolled;
        await sleep(800);
        await page.screenshot({ path: join(HERE, '02-tools-first-run-unchecked.png') });
        await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('.dialogOverlay')];
            dialogs[dialogs.length - 1]?.querySelector('.dialogClose, .codicon-close')?.click();
        });
        await sleep(1500);

        // --- 道具: 設定画面の「道具」
        await command(page, 'akari.settings.open', { section: 'tools' });
        await page.waitForFunction(() => Boolean(document.querySelector('[data-akari-settings-section="tools"]')), null, { timeout: 60000 });
        await sleep(6000);
        result.settingsTools = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('.dialogOverlay')];
            const dialog = dialogs[dialogs.length - 1];
            const text = dialog?.innerText ?? '';
            return {
                hasNotice: /Windows では winget、Mac では Homebrew で導入します。導入すると各ソフトの利用規約に同意したことになります。/.test(text),
                hasAdminNote: /管理者の確認/.test(text),
                providerLines: [...(dialog?.querySelectorAll('.akari-set-tool-extra') ?? [])].map(e => e.textContent).filter(t => t.startsWith('提供元:')),
                termsLinks: [...(dialog?.querySelectorAll('.akari-set-tool-extra a') ?? [])].map(a => a.getAttribute('href'))
            };
        });
        await page.screenshot({ path: join(HERE, '03-tools-settings.png') });
        // 書き出しの節: macOS では Windows 専用の GPU スイッチは出ない。
        await command(page, 'akari.settings.open', { section: 'export' });
        await sleep(2500);
        result.settingsExportOnMac = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('.dialogOverlay')];
            const text = dialogs[dialogs.length - 1]?.innerText ?? '';
            return { showsWindowsGpuCard: text.includes('Windows の GPU 設定') };
        });
        await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('.dialogOverlay')];
            dialogs[dialogs.length - 1]?.querySelector('.dialogClose, .codicon-close')?.click();
        });
        await sleep(1500);
        result.dialogsAfterSettingsClose = await page.evaluate(() => document.querySelectorAll('.dialogOverlay').length);

        // --- AI パートナー: 未導入の CLI の「始める」→ 確認ダイアログ →［やめる］
        result.partner = {};
        const shots = { antigravity: '04-partner-install-antigravity.png', codex: '06-partner-install-codex.png', claude: '07-partner-install-claude.png', commandcode: '08-partner-install-commandcode.png' };
        for (const [agent, file] of Object.entries(shots)) {
            const clicked = await page.evaluate(id => {
                const button = document.querySelector(`[data-akari-onboarding-target="partner-${id}"]`);
                button?.scrollIntoView({ block: 'center' });
                button?.click();
                return Boolean(button);
            }, agent);
            if (!clicked) { result.partner[agent] = { clicked: false }; continue; }
            await page.waitForFunction(() => [...document.querySelectorAll('.dialogOverlay')].some(d => d.innerText.includes('を導入しますか')), null, { timeout: 180000 });
            await sleep(500);
            const dialog = await page.evaluate(() => {
                const overlay = [...document.querySelectorAll('.dialogOverlay')].find(d => d.innerText.includes('を導入しますか'));
                const terms = [...overlay.querySelectorAll('dt')].map(dt => dt.textContent);
                const values = [...overlay.querySelectorAll('dd')].map(dd => dd.textContent);
                return {
                    title: overlay.querySelector('.dialogTitle')?.innerText ?? null,
                    notice: overlay.querySelector('.dialogContent p')?.textContent ?? null,
                    fields: Object.fromEntries(terms.map((term, index) => [term, values[index]])),
                    links: [...overlay.querySelectorAll('a')].map(a => a.getAttribute('href')),
                    buttons: [...overlay.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
                };
            });
            await page.screenshot({ path: join(HERE, file) });
            const cancelled = await clickButtonByText(page, '.dialogOverlay', 'やめる');
            await sleep(2000);
            const after = await page.evaluate(id => ({
                dialogs: document.querySelectorAll('.dialogOverlay').length,
                cardText: document.querySelector(`[data-akari-onboarding-target="partner-${id}"]`)?.innerText ?? null,
                cancelledNotice: [...document.querySelectorAll('[role=status]')].map(e => e.innerText).filter(t => t.includes('導入を中止しました'))
            }), agent);
            if (agent === 'antigravity') await page.screenshot({ path: join(HERE, '05-partner-install-cancelled.png') });
            result.partner[agent] = { clicked, dialog, cancelled, after };
        }
        // ［やめる］のあと、隔離した HOME には何も入っていないこと（導入の子プロセス・取得が起きていない）。
        result.isolatedHomeAfterCancel = await listTree(app.dirs.home);
        result.akariHomeAfterCancel = (await listTree(app.dirs.akariHome)).filter(p => !p.startsWith('cli'));
    } finally {
        await app.stop();
    }
    return result;
}

async function gpu(name, port, allow) {
    const app = await launch(name, port, { project: true, seen: true, gpuSeam: true });
    const { page } = app;
    const result = { pid: app.pid, choice: allow ? '許可する' : '許可しない' };
    const renderCutArgs = () => {
        try {
            const out = execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8' });
            const line = out.split('\n').find(l => l.includes('render-cut.mjs') && l.includes(app.projectDir.replace('/private', '')) );
            return line ? line.slice(line.indexOf('render-cut.mjs') + 'render-cut.mjs'.length).trim().replaceAll(app.scratch, '<scratch>').replaceAll(`/private${app.scratch}`, '<scratch>') : null;
        } catch { return null; }
    };
    const startExport = async () => {
        await page.evaluate(() => document.querySelector('[data-akari-onboarding-target="export-button"]')?.click());
        await page.waitForFunction(() => Boolean(document.querySelector('[data-akari-onboarding-target="export-submit"]')), null, { timeout: 120000 });
        await sleep(1500);
        await page.evaluate(() => document.querySelector('[data-akari-onboarding-target="export-submit"]')?.click());
    };
    const watchArgs = async () => {
        for (let i = 0; i < 120; i++) {
            const args = renderCutArgs();
            if (args) return args;
            await sleep(250);
        }
        return null;
    };
    const waitExportDone = async () => {
        for (let i = 0; i < 300; i++) {
            const files = await readdir(join(app.projectDir, 'exports')).catch(() => []);
            const done = files.filter(f => f.endsWith('.mp4'));
            if (done.length && !renderCutArgs()) return done;
            await sleep(1000);
        }
        return await readdir(join(app.projectDir, 'exports')).catch(() => []);
    };
    try {
        await closeGuide(page);
        await startExport();
        await page.waitForFunction(() => Boolean(document.querySelector('[data-akari-gpu-preference-consent]')), null, { timeout: 60000 });
        await sleep(500);
        result.dialog = await page.evaluate(() => {
            const block = document.querySelector('[data-akari-gpu-preference-consent]').closest('.dialogBlock');
            return {
                title: block.querySelector('.dialogTitle')?.innerText ?? null,
                text: document.querySelector('[data-akari-gpu-preference-consent]').innerText,
                buttons: [...block.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
            };
        });
        result.renderCutBeforeChoice = renderCutArgs();
        await page.screenshot({ path: join(HERE, allow ? '10-gpu-consent-before-allow.png' : '09-gpu-consent.png') });
        await page.evaluate(label => {
            const block = document.querySelector('[data-akari-gpu-preference-consent]').closest('.dialogBlock');
            [...block.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click();
        }, result.choice);
        result.renderCutArgs = await watchArgs();
        result.consentFile = JSON.parse(await readFile(join(app.dirs.akariHome, 'gpu-preference-consent.json'), 'utf8'));
        const settingsFiles = (await listTree(app.dirs.theia)).filter(p => p.endsWith('settings.json') && !p.includes('backend'));
        result.settings = Object.fromEntries(await Promise.all(settingsFiles.map(async p => [p, JSON.parse(await readFile(join(app.dirs.theia, p), 'utf8'))])));
        result.exported = await waitExportDone();
        // 2 回目の書き出しではもう聞かない。
        await sleep(2500);
        await page.evaluate(() => {
            const again = [...document.querySelectorAll('button')].find(b => /もう一度書き出す|設定に戻る|閉じる/.test(b.textContent));
            again?.click();
        });
        await sleep(1500);
        await page.evaluate(() => document.querySelector('.akari-export-dialog .close, [aria-label="閉じる"]')?.click());
        await sleep(1000);
        await startExport().catch(error => { result.secondStartError = String(error?.message ?? error); });
        await sleep(3000);
        result.second = {
            consentDialogShown: await page.evaluate(() => Boolean(document.querySelector('[data-akari-gpu-preference-consent]'))),
            renderCutArgs: await watchArgs()
        };
        result.sidecarLeft = (await listTree(app.dirs.akariHome)).includes('gpu-preference-override.json');
        await sleep(1000);
    } finally {
        await app.stop();
    }
    return result;
}

for (const scenario of scenarios) {
    console.log(`== ${scenario}`);
    if (scenario === 'tools-partner') observations[scenario] = await toolsAndPartner();
    else if (scenario === 'gpu-decline') observations[scenario] = await gpu('gpu-decline', 19472, false);
    else if (scenario === 'gpu-allow') observations[scenario] = await gpu('gpu-allow', 19473, true);
    else throw new Error(`unknown scenario: ${scenario}`);
    observations[scenario].capturedAt = new Date().toISOString();
    await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
}
console.log('done');
