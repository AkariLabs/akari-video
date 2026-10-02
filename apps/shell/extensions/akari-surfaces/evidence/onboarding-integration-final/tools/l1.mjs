// 検証用（ラッパー所掌・2026-10-02-onboarding-integration-final）: evidence/onboarding-guide-final/l1.mjs を統合ブランチ用に写したもの。
// 変更点: シェルの場所を統合 worktree に固定・出力先を引数に・窓を画面外に置く・書き出しの子 electron だけ BORROW_DIST の dist を借りる
// （AKARI_EXPORT_GPU_PREFERENCE=off で HKCU は書かない）・最後に書き出しの記録（.akari/render.json）の採用エンジンと警告を拾う。
// usage: node l1.mjs <label> <width>x<height> <isolated-root> <cdp-port> <outRoot>
// 元の説明: L1 driver for the first-run guide: caption punctuation (、) and one-step back in the export step (2026-10-01).
// usage: node l1.mjs <label> <width>x<height> <isolated-root> <cdp-port>
// Starts the dev shell with isolated HOME / AKARI_HOME / THEIA_CONFIG_DIR / user-data-dir (no prior settings,
// empty working folder), walks the guide from welcome to done and records measurements + screenshots.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shellRoot = 'C:/Users/kyach/akari-wt/integrate-2026-09-29/apps/shell';
const [label, size, scratch, portText, outRoot] = process.argv.slice(2);
if (!label || !size || !scratch || !portText) throw new Error('label, WxH, isolated root and port required');
const [width, height] = size.split('x').map(Number);
const port = Number(portText);
const outDir = join(outRoot, `${label}-${width}x${height}`);
await mkdir(outDir, { recursive: true });
const shellRequire = createRequire(join(shellRoot, 'package.json'));
const electron = shellRequire('electron');
const pw = await import(pathToFileURL(shellRequire.resolve('playwright-core')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const home = join(scratch, 'home'), akariHome = join(scratch, 'akari-home'), profile = join(scratch, 'profile'), work = join(scratch, 'work');
await Promise.all([home, akariHome, profile, work].map(dir => mkdir(dir, { recursive: true })));
// 画面に見える窓を出さない: Theia の窓の位置（electron-store の windowstate）を画面外に置いてから起動する
await writeFile(join(profile, 'config.json'), JSON.stringify({ windowstate: { x: -2600, y: 0, width, height, isMaximized: false, isFullScreen: false, screenLayout: '0:0:1920:1080', frame: false } }));
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1', AKARI_EXPORT_ALLOW_DESKTOP: '0', AKARI_EXPORT_GPU_PREFERENCE: 'off', THEIA_NO_SPLASH: '1',
    ...(process.env.BORROW_DIST ? { ELECTRON_OVERRIDE_DIST_PATH: process.env.BORROW_DIST } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const obs = { label, viewport: { width, height }, electronPid: child.pid, startedAt: new Date().toISOString(), shots: [], checks: {}, exportBack: [], pageErrors: [] };
let browser;
const wait = ms => new Promise(done => setTimeout(done, ms));
const FULLWIDTH_COMMA = '，';
const commaContexts = text => [...String(text).matchAll(/.{0,8}，.{0,8}/gu)].map(match => match[0]);
try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* startup */ }
        await wait(300);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => obs.pageErrors.push(String(error.message).slice(0, 300)));
    await page.route('http**', route => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' || host.endsWith('localhost') ? route.continue() : route.abort();
    });
    await page.setViewportSize({ width, height });
    let shotIndex = 0;
    const shot = async name => {
        const file = `${String(++shotIndex).padStart(2, '0')}-${name}.jpg`;
        await page.screenshot({ path: join(outDir, file), type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width, height } });
        obs.shots.push(file);
        console.log(`${file}: ${await currentStep()} / ${await coachTitle()}`);
    };
    const currentStep = async () => {
        const guide = page.locator('#akari-onboarding-v1');
        return await guide.count() ? await guide.getAttribute('data-akari-onboarding-step') : 'closed';
    };
    const step = async (name, timeout = 60000) => page.locator(`#akari-onboarding-v1[data-akari-onboarding-step="${name}"]`).waitFor({ timeout });
    const click = async name => page.locator(`#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="${name}"], #akari-onboarding-v1 .ao-takeover [data-ao="${name}"]`).last().click();
    const coachTitle = async () => page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3')?.textContent ?? '');
    const waitTitle = async (text, timeout = 20000) => page.waitForFunction(t => (document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3')?.textContent ?? '').includes(t), text, { timeout });
    const hasBack = async () => page.evaluate(() => !!document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="back"]'));
    const clearToasts = async () => page.locator('.theia-notification-list-item .action-label[title="Clear"]').evaluateAll(elements => elements.forEach(element => element.click())).catch(() => undefined);
    const hitDiag = async selector => page.evaluate(sel => {
        const element = document.querySelector(sel);
        if (!element) return { missing: true };
        const r = element.getBoundingClientRect();
        if (!r.width || !r.height) return { missing: false, visible: false };
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { visible: true, rect: [r.x, r.y, r.width, r.height].map(Math.round), topmost: top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null,
            topmostIsTarget: !!top && (top === element || element.contains(top)) };
    }, selector);
    const exportDialogOpen = async () => page.evaluate(() => {
        const submit = document.querySelector('[data-akari-onboarding-target="export-submit"]');
        return !!submit && submit.getBoundingClientRect().width > 0;
    });
    const nextButton = () => page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="fallback-next"]');
    const findPreviewFrame = async kind => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            for (const frame of page.frames()) {
                if (!await frame.locator('#play-toggle').count().catch(() => 0)) continue;
                let outer = frame;
                while (outer.parentFrame() && outer.parentFrame() !== page.mainFrame()) outer = outer.parentFrame();
                const owner = await outer.frameElement().catch(() => null);
                const ok = owner && await owner.evaluate((element, k) => {
                    const widget = element.closest(`[data-akari-onboarding-target="${k}"]`);
                    return !!widget && widget.getBoundingClientRect().width > 0 && getComputedStyle(widget).display !== 'none';
                }, kind).catch(() => false);
                if (ok) return frame;
            }
            await wait(300);
        }
        return undefined;
    };
    // Visible caption lines inside a preview frame (subtitle plate + title).
    const previewCaptionLines = preview => preview ? preview.evaluate(() => [...document.querySelectorAll('.akari-caption__line')]
        .filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !element.closest('[hidden]'); })
        .map(element => element.textContent.trim())).catch(() => []) : [];
    const allPreviewCaptionText = async () => {
        const texts = [];
        for (const frame of page.frames()) texts.push(...await frame.evaluate(() => [...document.querySelectorAll('.akari-caption__line, [class*="caption"]')]
            .map(element => element.textContent ?? '')).catch(() => []));
        return texts.join('\n');
    };
    const bodyText = () => page.evaluate(() => document.body.innerText);

    // ---- welcome → tour (完成例) ----
    await step('welcome', 120000);
    await wait(1500);
    await click('next'); await step('first'); await wait(900);
    await click('yes'); await step('invite'); await wait(1200);
    await click('start');
    await step('tour0', 180000);
    for (let stable = 0, guard = 0; stable < 6 && guard < 240; guard++) { stable = (await currentStep().catch(() => 'closed')).startsWith('tour') ? stable + 1 : 0; await wait(500); }
    obs.checks.tour = [];
    for (let guard = 0; guard < 12 && (await currentStep()).startsWith('tour'); guard++) {
        await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"]').last().waitFor({ timeout: 20000 });
        await wait(500); await clearToasts();
        const tourPreview = await findPreviewFrame('output');
        const lines = await previewCaptionLines(tourPreview);
        const text = await bodyText();
        obs.checks.tour.push({ step: await currentStep(), title: await coachTitle(), previewCaptionLines: lines,
            fullwidthCommaInPreview: lines.some(line => line.includes(FULLWIDTH_COMMA)), fullwidthCommaInBody: commaContexts(text) });
        if ((await currentStep()) === 'tour2' && !obs.checks.tourShot) { obs.checks.tourShot = true; await shot('tour-example'); }
        await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"]').last().click().catch(() => undefined);
        await wait(900);
    }
    // ---- drag → matpreview → ask → prompt → work → play ----
    await step('drag'); await wait(1200);
    await page.locator('#akari-onboarding-v1 [data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    await step('matpreview'); await wait(900);
    try { await page.locator('[data-akari-onboarding-target="sample-card"]').click({ timeout: 8000 }); obs.checks.sampleCardClick = 'real-click'; }
    catch { obs.checks.sampleCardClick = 'help-next'; await page.locator('#akari-onboarding-v1 [data-ao="help-next"]').waitFor({ timeout: 15000 }); await click('help-next'); }
    await page.getByText('ここは「素材プレビュー」です').waitFor();
    await wait(1200);
    await click('next'); await step('ask'); await wait(1200); await clearToasts();
    await page.locator('[data-answer="chatgpt"]').click(); await wait(900);
    await click('replay'); await step('prompt'); await wait(1200);
    await click('insert'); await wait(600); await click('send'); await step('work');
    await step('play', 120000); await wait(1500);
    const preview = await findPreviewFrame('output');
    if (!preview) throw new Error('output preview frame not found');
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await waitTitle('入りました');
    await wait(2500);
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await wait(500);

    // ---- caption: the sample subtitle must keep 、 ----
    await click('next'); await step('caption');
    await page.waitForFunction(() => !!document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3'));
    await wait(1500);
    const captionLines = await previewCaptionLines(preview);
    obs.checks.captionPreview = { lines: captionLines, hasFullwidthComma: captionLines.some(line => line.includes(FULLWIDTH_COMMA)),
        hasIdeographicComma: captionLines.some(line => line.includes('、')) };
    await shot('caption-preview');
    // With 、 kept, a subtitle can wrap to two lines; the 3 s ring (estimated caption band) should still cover it.
    await wait(2200);
    const subtitleBoxes = [];
    const plateLines = preview.locator('.caption-row-plate:not([data-output-caption]):not([hidden]) .akari-caption__line');
    for (let index = 0; index < await plateLines.count().catch(() => 0); index++) {
        const box = await plateLines.nth(index).boundingBox().catch(() => null);
        if (box && box.width > 0 && await plateLines.nth(index).isVisible().catch(() => false)) subtitleBoxes.push(box);
    }
    const union = subtitleBoxes.length ? subtitleBoxes.reduce((a, b) => {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
    }) : null;
    const ring = await page.evaluate(() => { const r = document.querySelector('#akari-onboarding-v1 .ao-ring'); if (!r) return null; const b = r.getBoundingClientRect(); return b.width ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; });
    obs.checks.captionRing = { ring, subtitle: union, lines: subtitleBoxes.length,
        contains: !!(ring && union) && ring.x <= union.x + 2 && ring.y <= union.y + 2
            && ring.x + ring.width >= union.x + union.width - 2 && ring.y + ring.height >= union.y + union.height - 2 };
    await shot('caption-3s-ring');
    await preview.locator('.caption-row-plate:not([data-output-caption]):not([hidden]) .akari-caption__line').first().click().catch(() => undefined);
    await wait(1200);
    for (let guard = 0; guard < 6 && await currentStep() === 'caption'; guard++) {
        await nextButton().last().waitFor({ timeout: 15000 }); await nextButton().last().click(); await wait(1000);
    }

    // ---- daihon: the script view must keep 、 ----
    await step('daihon'); await wait(900);
    await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ timeout: 15000 });
    await waitTitle('この行を押して');
    await wait(1200);
    const daihonText = await page.evaluate(() => {
        const row = document.querySelector('[data-akari-onboarding-target="daihon-first-row"]');
        const container = document.querySelector('[data-akari-onboarding-target="daihon"]') ?? row?.parentElement?.parentElement;
        return container ? container.innerText : '';
    });
    obs.checks.daihon = { excerpt: daihonText.slice(0, 400), hasFullwidthComma: daihonText.includes(FULLWIDTH_COMMA), hasIdeographicComma: daihonText.includes('、'), commaContexts: commaContexts(daihonText) };
    await shot('daihon-script');
    await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click({ timeout: 15000 });
    await waitTitle('飛びました');
    await wait(600);
    obs.checks.bodyFullwidthComma = commaContexts(await bodyText());
    obs.checks.previewFullwidthComma = commaContexts(await allPreviewCaptionText());

    // ---- export: one step back at a time ----
    const position = async () => ({ step: await currentStep(), title: await coachTitle(), back: await hasBack(), dialogOpen: await exportDialogOpen() });
    const toExportSub0 = async () => {
        for (let guard = 0; guard < 10 && await currentStep() !== 'export'; guard++) {
            const title = await coachTitle();
            if (await currentStep() === 'daihon' && title.includes('この行')) { await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click(); await wait(1000); continue; }
            if (await currentStep() === 'daihon' && !title.includes('飛びました')) { await page.locator('[data-akari-onboarding-target="daihon-button"]').click().catch(() => undefined); await wait(1200); continue; }
            await nextButton().last().waitFor({ timeout: 15000 }); await nextButton().last().click(); await wait(1000);
        }
        await step('export'); await wait(900);
    };
    const back = async (from, expectTitle) => {
        const before = await position();
        // Press 戻る the way a person does: a real mouse click at its centre (records what is topmost there).
        const backSelector = '#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="back"]';
        const backHit = await hitDiag(backSelector);
        backHit.stack = await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (!element) return null;
            const r = element.getBoundingClientRect();
            const describe = e => `${e.tagName}${e.id ? `#${e.id}` : ''}.${String(e.className).slice(0, 50)}`;
            const chain = [];
            for (let e = element; e; e = e.parentElement) {
                const s = getComputedStyle(e);
                chain.push({ el: describe(e), pe: s.pointerEvents, z: s.zIndex, pos: s.position, inert: e.inert === true });
            }
            const host = document.querySelector('.akari-export-dialog-host');
            const hs = host ? getComputedStyle(host) : null;
            return { at: document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).slice(0, 8).map(describe), chain,
                dialogHost: hs ? { z: hs.zIndex, pos: hs.position, parent: describe(host.parentElement) } : null,
                bodyClass: document.body.className.slice(0, 200), topLayerDialogs: document.querySelectorAll('dialog[open]').length };
        }, backSelector);
        const box = await page.locator(backSelector).last().boundingBox();
        if (!box) throw new Error(`back button missing at ${from}`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await wait(1600);
        const after = await position();
        const menuPanelOpen = await page.evaluate(() => {
            const menu = document.querySelector('[data-akari-onboarding-target="menu-panel"]');
            if (!menu) return false;
            const r = menu.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(menu).visibility === 'visible';
        });
        const entry = { from, before: before.title, backHit, after, menuPanelOpen, expectTitle, ok: !!expectTitle && after.title.includes(expectTitle),
            menuButton: await hitDiag('[data-akari-onboarding-target="menu-button"]'),
            exportButton: await hitDiag('[data-akari-onboarding-target="export-button"]') };
        obs.exportBack.push(entry);
        return entry;
    };
    await click('next'); await step('export'); await wait(900);
    // Passive log of coach titles, export dialog presence and every click (trusted or synthetic) during export.
    await page.evaluate(() => {
        window.__aoExportLog = [];
        const t0 = performance.now();
        const push = entry => window.__aoExportLog.push({ t: Math.round(performance.now() - t0), ...entry });
        let last = '';
        new MutationObserver(() => {
            const title = document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3')?.textContent ?? '';
            const dialog = !!document.querySelector('[data-akari-onboarding-target="export-submit"]');
            const key = `${title}|${dialog}`;
            if (key !== last) { last = key; push({ title, dialog }); }
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest('[data-akari-onboarding-target], [data-ao], button') : null;
            push({ click: target ? (target.getAttribute('data-akari-onboarding-target') ?? target.getAttribute('data-ao') ?? target.textContent.trim().slice(0, 20)) : String(event.target?.tagName), trusted: event.isTrusted });
        }, true);
    });
    await shot('export-sub0');
    await page.locator('[data-akari-onboarding-target="menu-button"]').click({ timeout: 15000 });
    await waitTitle('「書き出し…」を押します');
    await wait(600);
    await page.locator('[data-akari-onboarding-target="export-button"]').click();
    await waitTitle('標準のまま「書き出す」');
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
    await wait(800);
    await shot('export-sub2-dialog');
    // r1: ③ → ② → ① with real clicks; after ② → ① the ≡ menu must be closed, then redo ≡ → 「書き出し…」 → ③ with real clicks.
    const menuOpen = () => page.evaluate(() => {
        const menu = document.querySelector('[data-akari-onboarding-target="menu-panel"]');
        if (!menu) return false;
        const r = menu.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(menu).visibility === 'visible';
    });
    const r1 = obs.checks.r1 = {};
    const b3 = await back('③「書き出す」', '「書き出し…」を押します');
    await shot('back-from-3');
    r1.from3 = { ok: b3.ok, menuOpen: b3.menuPanelOpen, dialogOpen: b3.after.dialogOpen, exportButton: b3.exportButton };
    const b2 = await back('②「書き出し…」', '書き出しは、左のメニューから');
    await shot('back-from-2-menu-closed');
    r1.from2 = { ok: b2.ok, menuOpen: b2.menuPanelOpen, menuButton: b2.menuButton };
    // Redo from ① by real clicks.
    let t1 = Date.now();
    await page.locator('[data-akari-onboarding-target="menu-button"]').click({ timeout: 10000 });
    await waitTitle('「書き出し…」を押します', 10000);
    await wait(700);
    r1.redoMenu = { ms: Date.now() - t1, menuOpen: await menuOpen(), exportButton: await hitDiag('[data-akari-onboarding-target="export-button"]') };
    await shot('redo-menu-after-back-from-2');
    t1 = Date.now();
    await page.locator('[data-akari-onboarding-target="export-button"]').click({ timeout: 10000 });
    await waitTitle('標準のまま「書き出す」', 10000);
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor({ timeout: 10000 });
    r1.redoExport = { ms: Date.now() - t1, dialogOpen: await exportDialogOpen() };
    await wait(800);
    await shot('redo-dialog-after-back-from-2');
    // ③ → ② → ① → 台本 sub2 (「飛びました」)
    await back('③「書き出す」(2 回目)', '「書き出し…」を押します');
    const b2b = await back('②「書き出し…」(2 回目)', '書き出しは、左のメニューから');
    r1.from2Again = { ok: b2b.ok, menuOpen: b2b.menuPanelOpen };
    const b1 = await back('①「≡」', '飛びました');
    b1.ok = b1.after.step === 'daihon' && b1.after.title.includes('飛びました');
    r1.from1 = { ok: b1.ok, step: b1.after.step, title: b1.after.title, back: b1.after.back, menuOpen: b1.menuPanelOpen,
        daihonVisible: await hitDiag('[data-akari-onboarding-target="daihon"]') };
    await shot('back-from-1-daihon-sub2');
    // 「次へ」 from 台本 sub2 returns to export ①.
    await nextButton().last().waitFor({ timeout: 15000 });
    await nextButton().last().click();
    await step('export', 15000);
    await waitTitle('書き出しは、左のメニューから', 10000);
    r1.nextFromDaihon = { step: await currentStep(), title: await coachTitle(), menuOpen: await menuOpen() };
    await shot('next-from-daihon-sub2');
    // assistStep at export sub0: the guide's own 「次へ」 (help-next) must really open ≡.
    await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]').waitFor({ timeout: 10000 });
    await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]').click();
    let assistTitle = '';
    try { await waitTitle('「書き出し…」を押します', 6000); assistTitle = await coachTitle(); } catch { assistTitle = await coachTitle(); }
    await wait(700);
    r1.assistSub0 = { title: assistTitle, menuOpen: await menuOpen(), exportButton: await hitDiag('[data-akari-onboarding-target="export-button"]') };
    await shot('assist-sub0-menu-open');
    // Forward again to export and run it to the end.
    if (await currentStep() !== 'export') await toExportSub0();
    for (let guard = 0; guard < 6; guard++) {
        const title = await coachTitle();
        if (title.includes('書き出しは')) { await page.locator('[data-akari-onboarding-target="menu-button"]').click(); await waitTitle('「書き出し…」を押します'); await wait(600); continue; }
        if (title.includes('「書き出し…」')) { await page.locator('[data-akari-onboarding-target="export-button"]').click(); await waitTitle('標準のまま「書き出す」'); await wait(800); continue; }
        break;
    }
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
    const exportStarted = Date.now();
    await page.locator('[data-akari-onboarding-target="export-submit"]').click();
    await waitTitle('書き出しています', 30000).catch(() => undefined);
    await wait(1200);
    obs.checks.exportRunning = await position();
    await shot('export-running');
    if (obs.checks.exportRunning.back && (await coachTitle()).includes('書き出しています')) {
        const during = await back('④「書き出しています」', '');
        await shot('back-during-export');
        obs.checks.exportRunning.afterBack = during.after;
        // Come back to the running export through the guide's own forward path.
        for (let guard = 0; guard < 10 && !['書き出しています', '書き出せました'].some(t => during.after.title.includes(t)); guard++) {
            const title = await coachTitle();
            if (title.includes('書き出しています') || title.includes('書き出せました')) break;
            if (await currentStep() !== 'export') { await toExportSub0(); continue; }
            if (title.includes('書き出しは')) { await page.locator('[data-akari-onboarding-target="menu-button"]').click(); await wait(1000); continue; }
            if (title.includes('「書き出し…」')) { await page.locator('[data-akari-onboarding-target="export-button"]').click(); await wait(1000); continue; }
            if (title.includes('「書き出す」')) { await page.locator('[data-akari-onboarding-target="export-submit"]').click(); await wait(1000); continue; }
            await nextButton().last().click().catch(() => undefined); await wait(1000);
        }
    }
    await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 300000 });
    obs.checks.exportMs = Date.now() - exportStarted;
    await wait(900);
    obs.checks.exportResult = await position();
    await shot('export-result');
    await click('next'); await step('done'); await wait(2400); await shot('done');
    obs.checks.done = await page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-takeover')?.innerText.replace(/\s+/g, ' ').trim());
    obs.exportLog = await page.evaluate(() => window.__aoExportLog).catch(() => undefined);
    obs.finishedAt = new Date().toISOString();
} catch (error) {
    obs.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(obs.error);
    try {
        const page = browser?.contexts()[0]?.pages()[0];
        if (page) {
            await page.screenshot({ path: join(outDir, 'zz-error.jpg'), type: 'jpeg', quality: 80 });
            obs.exportLog = await page.evaluate(() => window.__aoExportLog).catch(() => undefined);
        }
    } catch { /* best effort */ }
} finally {
    // Every captions.json the guide wrote inside the isolated root (tour example and the user's own project).
    obs.checks.captionFiles = [];
    const walk = async (dir, depth = 0) => {
        if (depth > 8) return;
        for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
            const path = join(dir, entry.name);
            if (entry.isDirectory() && !['profile', 'node_modules', 'Cache', 'GPUCache'].includes(entry.name)) await walk(path, depth + 1);
            else if (entry.isFile() && entry.name === 'captions.json') {
                try {
                    const captions = JSON.parse(await readFile(path, 'utf8')).captions ?? [];
                    const shown = captions.map(caption => caption.display_text ?? caption.text ?? '');
                    obs.checks.captionFiles.push({ path: path.replace(scratch, '<isolated>'), count: captions.length,
                        fullwidthComma: shown.filter(text => text.includes(FULLWIDTH_COMMA)).length,
                        ideographicComma: shown.filter(text => text.includes('、')).length,
                        displayDiffersFromText: captions.filter(caption => caption.display_text !== undefined && caption.display_text !== caption.text && caption.time_domain !== 'output').length });
                } catch (error) { obs.checks.captionFiles.push({ path: path.replace(scratch, '<isolated>'), error: String(error) }); }
            }
        }
    };
    await walk(scratch);
    // 書き出しの記録（採用エンジン・警告・GPU のレンダラ）
    obs.checks.renderRecords = [];
    const walkRender = async (dir, depth = 0) => {
        if (depth > 8) return;
        for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
            const path = join(dir, entry.name);
            if (entry.isDirectory() && !['profile', 'node_modules', 'Cache', 'GPUCache'].includes(entry.name)) await walkRender(path, depth + 1);
            else if (entry.isFile() && entry.name === 'render.json' && dir.endsWith('.akari')) {
                try {
                    const r = JSON.parse(await readFile(path, 'utf8'));
                    const p = r.provenance ?? {};
                    obs.checks.renderRecords.push({ path: path.replace(scratch, '<isolated>'), engine_requested: p.engine_requested, engine: p.engine,
                        launcher_tier: p.gpu?.provenance?.launcher_tier, renderer: p.gpu?.gpu?.renderer?.renderer ?? null,
                        warnings: r.warnings ?? [], ineligibleWarnings: (r.warnings ?? []).filter(w => /ineligible/i.test(String(w))) });
                    await writeFile(join(outDir, 'app-export-render.json'), JSON.stringify(r, null, 1).replaceAll(scratch.replaceAll(String.fromCharCode(92), String.fromCharCode(92, 92)), '<isolated>'));
                } catch (error) { obs.checks.renderRecords.push({ path, error: String(error) }); }
            }
        }
    };
    await walkRender(scratch);
    await writeFile(join(outDir, 'observations.json'), `${JSON.stringify(obs, null, 2).replaceAll(scratch.replaceAll('\\', '\\\\'), '<isolated>')}\n`);
    if (browser) {
        try { const cdp = await browser.newBrowserCDPSession(); await Promise.race([cdp.send('Browser.close'), wait(4000)]); } catch { /* fall through */ }
        await Promise.race([browser.close().catch(() => undefined), wait(4000)]);
    }
    await Promise.race([new Promise(done => child.once('exit', done)), wait(8000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    console.log('electron pid', child.pid);
    log.end();
}
process.exit(obs.error ? 1 : 0);
