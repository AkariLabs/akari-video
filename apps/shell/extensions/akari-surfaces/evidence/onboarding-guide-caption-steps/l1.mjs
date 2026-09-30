// L1 driver for the first-run guide caption / daihon steps (2026-09-30).
// usage: node l1.mjs <label> <width>x<height> <isolated-root> <cdp-port>
// Starts the dev shell with isolated HOME / AKARI_HOME / THEIA_CONFIG_DIR / user-data-dir,
// walks the first-run guide from welcome to done, and records measurements + screenshots.
// A passive in-page recorder logs every coach state (title, body, help line, next buttons, ring)
// with performance.now() so timings are measured, not inferred.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const [label, size, scratch, portText] = process.argv.slice(2);
if (!label || !size || !scratch || !portText) throw new Error('label, WxH, isolated root and port required');
const [width, height] = size.split('x').map(Number);
const port = Number(portText);
const outDir = join(here, `${label}-${width}x${height}`);
await mkdir(outDir, { recursive: true });
const electron = createRequire(import.meta.url)('electron');
const { chromium } = await import('playwright-core');
const home = join(scratch, 'home'), akariHome = join(scratch, 'akari-home'), profile = join(scratch, 'profile'), work = join(scratch, 'work');
await Promise.all([home, akariHome, profile, work].map(dir => mkdir(dir, { recursive: true })));
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
const obs = { label, viewport: { width, height }, electronPid: child.pid, startedAt: new Date().toISOString(), shots: [], checks: {}, pageErrors: [] };
let browser;
const wait = ms => new Promise(done => setTimeout(done, ms));
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
    const click = async name => page.locator(`#akari-onboarding-v1 [data-ao="${name}"]`).last().click();
    const coachTitle = async () => page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3')?.textContent ?? '');
    const waitTitle = async (text, timeout = 20000) => page.waitForFunction(t => (document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3')?.textContent ?? '').includes(t), text, { timeout });
    const clearToasts = async () => page.locator('.theia-notification-list-item .action-label[title="Clear"]').evaluateAll(elements => elements.forEach(element => element.click())).catch(() => undefined);
    const hitDiag = async selector => page.evaluate(sel => {
        const element = document.querySelector(sel);
        if (!element) return { missing: true };
        const r = element.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { rect: [r.x, r.y, r.width, r.height].map(Math.round), topmost: top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null,
            topmostIsTarget: !!top && (top === element || element.contains(top)) };
    }, selector);
    // Preview widgets nest an iframe inside an iframe; match the widget by the outermost frame element.
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

    // ---- passive recorder: one entry per distinct coach state ----
    const installRecorder = () => page.evaluate(() => {
        if (window.__aoRec) return;
        window.__aoRec = [];
        const snap = () => {
            const root = document.querySelector('#akari-onboarding-v1');
            if (!root) return;
            const coach = root.querySelector('.ao-coach:not(.out)');
            const ring = root.querySelector('.ao-ring');
            const ringRect = ring?.getBoundingClientRect();
            const help = coach?.querySelector('.ao-help');
            const nexts = coach ? [...coach.querySelectorAll('.ao-actions button')].map(b => b.dataset.ao).filter(a => ['next', 'help-next', 'fallback-next'].includes(a)) : [];
            const entry = {
                step: root.getAttribute('data-akari-onboarding-step'),
                title: coach?.querySelector('h3')?.textContent ?? '',
                body: [...(coach?.querySelectorAll('.ao-body > :not(.ao-help)') ?? [])].map(e => e.textContent.trim()).filter(Boolean),
                help: help?.textContent.trim() ?? '',
                nexts,
                back: !!coach?.querySelector('[data-ao="back"]'),
                ring: ringRect && ringRect.width ? [ringRect.x, ringRect.y, ringRect.width, ringRect.height].map(Math.round) : null,
                ringBounce: !!ring?.classList.contains('bounce'),
                ringAnim: ring ? getComputedStyle(ring).animationName : ''
            };
            const last = window.__aoRec[window.__aoRec.length - 1];
            const key = JSON.stringify({ ...entry, ring: entry.ring ? entry.ring.map(v => Math.round(v / 8)) : null });
            if (!last || last.key !== key) window.__aoRec.push({ ...entry, key, t: Math.round(performance.now()) });
        };
        new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'data-akari-onboarding-step'] });
        snap();
    });
    const recorder = () => page.evaluate(() => (window.__aoRec ?? []).map(({ key, ...rest }) => rest));
    const helpStyle = () => page.evaluate(() => {
        const coach = document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out)');
        const help = coach?.querySelector('.ao-help');
        const body = [...(coach?.querySelectorAll('.ao-body > p:not(.ao-help)') ?? [])][0];
        const pick = e => { if (!e) return null; const s = getComputedStyle(e); return { text: e.textContent.trim(), color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, background: s.backgroundColor, borderLeft: `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`, before: getComputedStyle(e, '::before').content }; };
        return { help: pick(help), body: pick(body) };
    });
    // Subtitle plate (not the title) in page coordinates.
    const subtitleRect = async preview => {
        const loc = preview.locator('.caption-row-plate:not([data-output-caption]):not([hidden]) .akari-caption__line');
        const count = await loc.count().catch(() => 0);
        for (let index = 0; index < count; index++) {
            const box = await loc.nth(index).boundingBox().catch(() => null);
            const visible = await loc.nth(index).isVisible().catch(() => false);
            if (box && visible && box.width > 0) return { ...box, text: (await loc.nth(index).textContent().catch(() => '')).trim() };
        }
        return null;
    };
    const previewTime = preview => preview.evaluate(() => { const v = document.querySelector('#preview-video'); return v ? v.currentTime : null; }).catch(() => null);
    const overlaps = (a, b) => !!(a && b) && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    const contains = (outer, inner) => !!(outer && inner) && outer.x <= inner.x + 2 && outer.y <= inner.y + 2
        && outer.x + outer.width >= inner.x + inner.width - 2 && outer.y + outer.height >= inner.y + inner.height - 2;

    // ---- welcome → tour → drag → matpreview → ask → prompt → work ----
    await step('welcome', 120000);
    await installRecorder();
    await wait(1500);
    await click('next'); await step('first'); await wait(900);
    await click('yes'); await step('invite'); await wait(1200);
    await click('start');
    await step('tour0', 180000);
    // Opening the project reloads the window; wait until the guide has been back for 3 s in a row.
    for (let stable = 0, guard = 0; stable < 6 && guard < 240; guard++) { stable = (await currentStep().catch(() => 'closed')).startsWith('tour') ? stable + 1 : 0; await wait(500); }
    await installRecorder();
    for (let guard = 0; guard < 12 && (await currentStep()).startsWith('tour'); guard++) {
        await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"]').last().waitFor({ timeout: 20000 });
        await wait(500); await clearToasts();
        await page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"]').last().click().catch(() => undefined);
        await wait(900);
    }
    await step('drag'); await wait(1200);
    await page.locator('#akari-onboarding-v1 [data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    await step('matpreview'); await wait(900);
    await wait(3600); // help line (4 s) is in: measure its look against the body
    obs.checks.matpreviewHelp = await helpStyle();
    obs.checks.sampleCardHit = await hitDiag('[data-akari-onboarding-target="sample-card"]');
    await shot('matpreview-help');
    try { await page.locator('[data-akari-onboarding-target="sample-card"]').click({ timeout: 10000 }); obs.checks.sampleCardClick = 'real-click'; }
    catch { obs.checks.sampleCardClick = 'help-next'; await page.locator('#akari-onboarding-v1 [data-ao="help-next"]').waitFor({ timeout: 15000 }); await click('help-next'); }
    await page.getByText('ここは「素材プレビュー」です').waitFor();
    await wait(1200);
    await click('next'); await step('ask'); await wait(1200); await clearToasts();
    await page.locator('[data-answer="chatgpt"]').click(); await wait(900);
    await click('replay'); await step('prompt'); await wait(1200);
    await click('insert'); await wait(600); await click('send'); await step('work');
    await step('play', 120000); await wait(1500);
    await installRecorder();
    const preview = await findPreviewFrame('output');
    if (!preview) throw new Error('output preview frame not found');

    // ---- play sub0: wait for help + next without touching ----
    const playEnter = Date.now();
    await wait(4800);
    obs.checks.playWait = { waitedMs: Date.now() - playEnter, style: await helpStyle() };
    await shot('play-waiting-help');
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await waitTitle('入りました');
    await wait(3000);
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await wait(500);

    // ---- caption sub0 ----
    await click('next'); await step('caption');
    await page.waitForFunction(() => !!document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) h3'));
    await wait(700);
    obs.checks.captionEnter = { previewTime: await previewTime(preview), subtitle: await subtitleRect(preview) };
    await shot('caption-enter');
    await wait(2500); // ≈3.2 s after entering, untouched
    obs.checks.captionAt3s = { ring: await page.evaluate(() => { const r = document.querySelector('#akari-onboarding-v1 .ao-ring'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bounce: r.classList.contains('bounce'), animation: getComputedStyle(r).animationName }; }),
        subtitle: await subtitleRect(preview), previewTime: await previewTime(preview) };
    obs.checks.captionAt3s.ringOverlapsSubtitle = overlaps(obs.checks.captionAt3s.ring, obs.checks.captionAt3s.subtitle);
    obs.checks.captionAt3s.ringContainsSubtitle = contains(obs.checks.captionAt3s.ring, obs.checks.captionAt3s.subtitle);
    await shot('caption-3s-ring');
    await wait(1600); // ≈4.8 s: help line is in
    obs.checks.captionHelp = await helpStyle();
    await shot('caption-help');
    // Real click on the subtitle inside the output preview.
    await preview.locator('.caption-row-plate:not([data-output-caption]):not([hidden]) .akari-caption__line').first().click();
    await wait(1200);
    obs.checks.captionPath = [];
    obs.checks.captionTitles = [];
    const barItems = () => page.evaluate(() => [...document.querySelectorAll('[data-akari-bar-item]')].filter(e => e.getBoundingClientRect().width > 0)
        .map(e => e.getAttribute('data-akari-bar-item')));
    obs.checks.captionBarItems = await barItems();
    await shot('caption-selected');
    // Walk the caption sub-steps until 位置 (or leaving the step), preferring real clicks on the ringed control.
    for (let guard = 0; guard < 8 && await currentStep() === 'caption'; guard++) {
        const title = await coachTitle();
        obs.checks.captionTitles.push(title);
        if (title.includes('位置')) break;
        const ring = await page.evaluate(() => { const r = document.querySelector('#akari-onboarding-v1 .ao-ring'); if (!r) return null; const b = r.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; });
        const ringed = ring ? await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const item = e?.closest('[data-akari-bar-item]'); return item ? item.getAttribute('data-akari-bar-item') : (e ? `${e.tagName}.${String(e.className).slice(0, 40)}` : null); }, ring) : null;
        obs.checks.captionPath.push({ title, ringed });
        if (/見た目|色|スタイル/.test(title)) {
            // Style step: open the text colour window through the real control and pick a colour when offered.
            const before = await page.evaluate(() => document.querySelector('[data-akari-bar-item="captionTextColor"] .akari-ctx-color-a span')?.getAttribute('style') ?? '');
            const colorButton = page.locator('[data-akari-bar-item="captionTextColor"]').first();
            if (await colorButton.count()) {
                await colorButton.click().catch(error => obs.checks.captionPath.push({ colorClickError: String(error.message).split('\n')[0] }));
                await wait(900);
                await shot('caption-style-color-open');
                const swatch = page.locator('[data-akari-window="captionTextColor"] .akari-ctx-color-choice').nth(4);
                if (await swatch.count()) { await swatch.click().catch(() => undefined); await wait(900); }
                const after = await page.evaluate(() => document.querySelector('[data-akari-bar-item="captionTextColor"] .akari-ctx-color-a span')?.getAttribute('style') ?? '');
                obs.checks.captionStyleColor = { before, after, changed: before !== after, pop: await page.evaluate(() => { const p = document.querySelector('[data-akari-window="captionTextColor"]'); if (!p || p.hidden) return null; const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), coach: await page.evaluate(() => { const c = document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out)'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) };
                await shot('caption-style-after-color');
            }
            if (!(await coachTitle()).includes('位置') && await currentStep() === 'caption') {
                const next = page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]');
                await next.last().waitFor({ timeout: 15000 }); await next.last().click(); obs.checks.captionPath.push('next(style)');
            }
        } else {
            const next = page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"]');
            await next.last().waitFor({ timeout: 15000 }); await next.last().click(); obs.checks.captionPath.push(`next(${title})`);
        }
        await wait(900);
    }
    await waitTitle('位置');
    await wait(700); await shot('caption-position');

    // ---- daihon ----
    await click('next'); await step('daihon'); await wait(900);
    obs.checks.daihonSub0 = { title: await coachTitle(), body: await page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out) .ao-body')?.textContent.trim() ?? '') };
    await shot('daihon');
    await wait(4200); obs.checks.daihonHelp = await helpStyle(); await shot('daihon-help');
    // back from daihon sub0
    await click('back'); await wait(1400);
    obs.checks.backFromDaihon0 = { step: await currentStep(), title: await coachTitle() };
    await shot('back-from-daihon0');
    if ((await coachTitle()).includes('位置')) {
        await click('back'); await wait(2200);
        obs.checks.backFromPosition = { step: await currentStep(), title: await coachTitle(),
            ring: await page.evaluate(() => { const r = document.querySelector('#akari-onboarding-v1 .ao-ring'); if (!r) return null; const b = r.getBoundingClientRect(); return b.width ? [b.x, b.y, b.width, b.height].map(Math.round) : null; }),
            colorButton: await hitDiag('[data-akari-bar-item="captionTextColor"]') };
        await shot('back-from-position');
    }
    if (await currentStep() === 'caption') {
        // Return to 台本 from wherever the back landed.
        for (let guard = 0; guard < 6 && await currentStep() === 'caption'; guard++) {
            const next = page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]');
            await next.last().waitFor({ timeout: 15000 }); await next.last().click(); await wait(1000);
        }
    }
    await step('daihon'); await wait(900);
    obs.checks.daihonButtonHit = await hitDiag('[data-akari-onboarding-target="daihon-button"]');
    await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ timeout: 15000 });
    await waitTitle('この行を押して');
    await wait(700); await shot('daihon-row');
    // back from daihon sub1 (the owner's report: this went back several steps)
    await click('back'); await wait(1400);
    obs.checks.backFromDaihon1 = { step: await currentStep(), title: await coachTitle(), daihonButtonHit: await hitDiag('[data-akari-onboarding-target="daihon-button"]') };
    await shot('back-from-daihon1');
    if (await currentStep() === 'daihon') {
        const retryStart = Date.now();
        await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ timeout: 15000 });
        await waitTitle('この行を押して');
        obs.checks.backFromDaihon1.redoMs = Date.now() - retryStart;
    } else {
        obs.checks.backFromDaihon1.redo = 'landed outside daihon; walking forward';
        for (let guard = 0; guard < 8 && await currentStep() !== 'daihon'; guard++) {
            const next = page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]');
            await next.last().waitFor({ timeout: 15000 }); await next.last().click(); await wait(1000);
        }
        await step('daihon'); await wait(900);
        await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ timeout: 15000 });
        await waitTitle('この行を押して');
    }
    await wait(700);
    obs.checks.daihonRowHit = await hitDiag('[data-akari-onboarding-target="daihon-first-row"]');
    await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click({ timeout: 15000 });
    await waitTitle('飛びました');
    await wait(600); await shot('daihon-seek');
    // back from daihon sub2
    await click('back'); await wait(1400);
    obs.checks.backFromDaihon2 = { step: await currentStep(), title: await coachTitle(), rowHit: await hitDiag('[data-akari-onboarding-target="daihon-first-row"]') };
    await shot('back-from-daihon2');
    if ((await coachTitle()).includes('この行を押して')) {
        const retryStart = Date.now();
        await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click({ timeout: 15000 });
        await waitTitle('飛びました');
        obs.checks.backFromDaihon2.redoMs = Date.now() - retryStart;
    } else {
        for (let guard = 0; guard < 8 && !(await coachTitle()).includes('飛びました'); guard++) {
            if (await currentStep() === 'daihon' && (await coachTitle()).includes('この行')) { await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click(); await wait(1000); continue; }
            if (await currentStep() === 'daihon' && !(await coachTitle()).includes('飛びました')) { await page.locator('[data-akari-onboarding-target="daihon-button"]').click().catch(() => undefined); await wait(1000); continue; }
            const next = page.locator('#akari-onboarding-v1 .ao-coach:not(.out) [data-ao="next"], #akari-onboarding-v1 .ao-coach:not(.out) [data-ao="help-next"]');
            await next.last().waitFor({ timeout: 15000 }); await next.last().click(); await wait(1000);
        }
    }
    await wait(500);

    // ---- export → done ----
    await click('next'); await step('export'); await wait(900); await shot('export');
    await wait(1800); obs.checks.exportNextAt2s = await page.evaluate(() => [...document.querySelectorAll('#akari-onboarding-v1 .ao-coach:not(.out) .ao-actions button')].map(b => b.dataset.ao));
    await page.locator('[data-akari-onboarding-target="menu-button"]').click({ timeout: 15000 });
    await page.locator('[data-akari-onboarding-target="export-button"]').waitFor();
    await wait(500);
    await page.locator('[data-akari-onboarding-target="export-button"]').click();
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
    await wait(700);
    const exportStarted = Date.now();
    await page.locator('[data-akari-onboarding-target="export-submit"]').click();
    await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 240000 });
    obs.checks.exportMs = Date.now() - exportStarted;
    await wait(900); await shot('export-result');
    await click('next'); await step('done'); await wait(2400); await shot('done');
    obs.checks.done = await page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-takeover')?.innerText.replace(/\s+/g, ' ').trim());
    obs.recorder = await recorder();
    obs.finishedAt = new Date().toISOString();
} catch (error) {
    obs.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(obs.error);
    try {
        const page = browser?.contexts()[0]?.pages()[0];
        if (page) {
            await page.screenshot({ path: join(outDir, 'zz-error.jpg'), type: 'jpeg', quality: 80 });
            obs.recorder = await page.evaluate(() => (window.__aoRec ?? []).map(({ key, ...rest }) => rest)).catch(() => undefined);
        }
    } catch { /* best effort */ }
} finally {
    await writeFile(join(outDir, 'observations.json'), `${JSON.stringify(obs, null, 2).replaceAll(scratch.replaceAll('\\', '\\\\'), '<isolated>')}\n`);
    if (browser) {
        try { const cdp = await browser.newBrowserCDPSession(); await Promise.race([cdp.send('Browser.close'), wait(4000)]); } catch { /* fall through */ }
        await Promise.race([browser.close().catch(() => undefined), wait(4000)]);
    }
    await Promise.race([new Promise(done => child.once('exit', done)), wait(8000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    log.end();
}
process.exit(obs.error ? 1 : 0);
