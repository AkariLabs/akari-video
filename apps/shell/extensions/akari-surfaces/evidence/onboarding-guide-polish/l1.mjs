// L1 driver for the first-run guide polish (2026-09-30).
// usage: node l1.mjs <label> <width>x<height> <isolated-root> <cdp-port>
// Starts the dev shell with isolated HOME / AKARI_HOME / THEIA_CONFIG_DIR / user-data-dir,
// walks the first-run guide from welcome to done, and records measurements + screenshots.
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
const home = join(scratch, 'home'), akariHome = join(scratch, 'akari-home'), profile = join(scratch, 'profile');
await Promise.all([mkdir(home, { recursive: true }), mkdir(akariHome, { recursive: true }), mkdir(profile, { recursive: true })]);
const log = createWriteStream(join(scratch, 'electron.log'), { flags: 'a' });
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electron, [shellRoot, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        console.log(`${file}: ${await currentStep()}`);
    };
    const currentStep = async () => {
        const guide = page.locator('#akari-onboarding-v1');
        return await guide.count() ? await guide.getAttribute('data-akari-onboarding-step') : 'closed';
    };
    const step = async (name, timeout = 60000) => page.locator(`#akari-onboarding-v1[data-akari-onboarding-step="${name}"]`).waitFor({ timeout });
    const click = async name => page.locator(`#akari-onboarding-v1 [data-ao="${name}"]`).last().click();
    const coachTitle = async () => page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-coach h3')?.textContent ?? '');
    const clearToasts = async () => page.locator('.theia-notification-list-item .action-label[title="Clear"]').evaluateAll(elements => elements.forEach(element => element.click())).catch(() => undefined);
    const rect = async selector => page.evaluate(sel => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: r.x, y: r.y, width: r.width, height: r.height, visibility: style.visibility, display: style.display };
    }, selector);
    const edgeDelta = (a, b) => a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y),
        Math.abs(a.x + a.width - b.x - b.width), Math.abs(a.y + a.height - b.y - b.height)) : null;
    const intro = async () => page.evaluate(() => {
        const root = document.querySelector('#akari-onboarding-v1 .ao-takeover');
        if (!root) return null;
        const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
        const images = [...root.querySelectorAll('img')].filter(visible).map(img => {
            const r = img.getBoundingClientRect();
            return { cls: img.className, parent: img.parentElement?.className ?? '', alt: img.alt, x: r.x, y: r.y, width: r.width, height: r.height,
                natural: `${img.naturalWidth}x${img.naturalHeight}` };
        });
        const heroes = [...root.querySelectorAll('.ao-hero')].filter(visible).length;
        const brand = [...root.querySelectorAll('.ao-brand')].filter(visible).length;
        const chip = [...root.querySelectorAll('.ao-chip')].filter(visible).length;
        const buttons = [...root.querySelectorAll('button')].filter(visible).map(button => {
            const r = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return { ao: button.dataset.ao, text: button.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height,
                fontSize: style.fontSize, background: style.backgroundColor, border: style.borderTopWidth };
        });
        const text = root.querySelector('.ao-text');
        const firstVisual = [...root.querySelectorAll('.ao-takeover-inner > *, .ao-text > *')].filter(visible)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
        return { images, heroes, brand, chip, buttons, text: (root.innerText || '').replace(/\s+/g, ' ').trim(),
            headings: [...root.querySelectorAll('h2')].filter(visible).map(h => h.textContent.trim()),
            topElement: firstVisual ? { tag: firstVisual.tagName, cls: firstVisual.className, text: (firstVisual.textContent || '').trim().slice(0, 60) } : null,
            textChildren: text ? [...text.children].filter(visible).map(child => child.tagName + '.' + child.className) : [] };
    });
    // Click on an app control outside the spotlight and see whether the control receives it.
    const blockProbe = async (name, selector) => {
        const target = page.locator(selector).first();
        if (!await target.count()) return { name, selector, missing: true };
        const box = await target.boundingBox();
        if (!box) return { name, selector, missing: true };
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const before = await page.evaluate(({ sel, x, y }) => {
            const element = document.querySelector(sel);
            window.__aoProbe = { pointerdown: 0, mousedown: 0, click: 0 };
            for (const type of ['pointerdown', 'mousedown', 'click']) element.addEventListener(type, () => { window.__aoProbe[type]++; }, { capture: true });
            const top = document.elementFromPoint(x, y);
            return { topmost: top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null,
                topmostInsideGuide: !!top?.closest('#akari-onboarding-v1'), menuPanelOpen: !!document.querySelector('[data-akari-onboarding-target="menu-panel"]')?.getBoundingClientRect().width };
        }, { sel: selector, x, y });
        // On the unfixed baseline a real click on ≡ swaps the left panel and breaks the rest of the walk,
        // so the baseline only hit-tests ≡; the timeline button is clicked for real in every run.
        if (label === 'base' && name === 'menu-button') return { name, selector, point: { x: Math.round(x), y: Math.round(y) }, before, hitTestOnly: true, blocked: before.topmostInsideGuide };
        await page.mouse.click(x, y);
        await wait(600);
        const after = await page.evaluate(() => ({ ...window.__aoProbe,
            menuPanelOpen: !!document.querySelector('[data-akari-onboarding-target="menu-panel"]')?.getBoundingClientRect().width }));
        const blocked = after.pointerdown === 0 && after.mousedown === 0 && after.click === 0;
        return { name, selector, point: { x: Math.round(x), y: Math.round(y) }, before, after, blocked };
    };
    // Click the output preview's ▶ (inside nested iframes) while the spotlight is elsewhere.
    const iframeProbe = async name => {
        const frame = await findPreviewFrame('output');
        if (!frame) return { name, missing: true };
        const box = await frame.locator('#play-toggle').boundingBox({ timeout: 5000 }).catch(() => null);
        if (!box) return { name, missing: true };
        await frame.evaluate(() => { window.__aoFrameClicks = 0; document.querySelector('#play-toggle')?.addEventListener('click', () => { window.__aoFrameClicks++; }, true); });
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const topmost = await page.evaluate(({ x, y }) => { const top = document.elementFromPoint(x, y); return top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null; }, { x, y });
        await page.mouse.click(x, y); await wait(700);
        const clicks = await frame.evaluate(() => window.__aoFrameClicks);
        const paused = await frame.evaluate(() => { const v = document.querySelector('video'); return v ? v.paused : null; });
        if (clicks) { await page.mouse.click(x, y); await wait(400); }
        return { name, point: { x: Math.round(x), y: Math.round(y) }, topmost, clicks, videoPausedAfter: paused, blocked: clicks === 0 };
    };
    const keyProbe = async () => {
        const paletteOpen = () => page.evaluate(() => {
            const widget = document.querySelector('.quick-input-widget');
            return !!widget && getComputedStyle(widget).display !== 'none' && widget.getBoundingClientRect().height > 0;
        });
        const hidePalette = async () => { await page.evaluate(() => (document.activeElement)?.blur?.()); await wait(400); };
        await page.evaluate(() => {
            window.__aoKeyClicks = [];
            window.__aoKeyListener = event => { if (!(event.target instanceof Element) || !event.target.closest('#akari-onboarding-v1')) window.__aoKeyClicks.push(String(event.target?.className ?? event.target?.nodeName).slice(0, 60)); };
            document.addEventListener('click', window.__aoKeyListener, true);
        });
        await page.keyboard.press('Control+Shift+P'); await wait(800);
        const ctrlShiftP = await paletteOpen(); if (ctrlShiftP) await hidePalette();
        await page.keyboard.press('F1'); await wait(800);
        const f1 = await paletteOpen(); if (f1) await hidePalette();
        const focusTrail = [];
        for (let index = 0; index < 4; index++) {
            await page.keyboard.press('Tab'); await wait(150);
            focusTrail.push(await page.evaluate(() => { const a = document.activeElement; return a ? { tag: a.tagName, cls: String(a.className).slice(0, 50), insideGuide: !!a.closest('#akari-onboarding-v1'), ao: a.getAttribute?.('data-ao') } : null; }));
        }
        const focusedOutside = focusTrail.filter(item => item && !item.insideGuide && item.tag !== 'BODY');
        // Only press Enter when focus left the guide; pressing Enter on a guide button would advance the guide.
        if (focusedOutside.length && !(await page.evaluate(() => !!document.activeElement?.closest('#akari-onboarding-v1')))) { await page.keyboard.press('Enter'); await wait(600); }
        const outsideClicks = await page.evaluate(() => { document.removeEventListener('click', window.__aoKeyListener, true); return window.__aoKeyClicks; });
        const guideStillOpen = await page.locator('#akari-onboarding-v1').count() > 0;
        return { commandPaletteOpenedByCtrlShiftP: ctrlShiftP, commandPaletteOpenedByF1: f1, focusTrail, focusReachedApp: focusedOutside.length > 0, outsideClicks, guideStillOpen,
            stepAfter: await currentStep() };
    };
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
    const partnerAlignment = async stage => {
        const partner = await rect('[data-akari-onboarding-target="partner"]');
        const chat = await rect('#akari-onboarding-v1 .ao-chat');
        const hole = await rect('#akari-onboarding-v1 .ao-hole');
        const ring = await rect('#akari-onboarding-v1 .ao-ring');
        const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-akari-onboarding-target^="partner"]')].map(element => {
            const r = element.getBoundingClientRect();
            return { target: element.getAttribute('data-akari-onboarding-target'), id: element.id, x: r.x, y: r.y, width: r.width, height: r.height,
                visibility: getComputedStyle(element).visibility };
        }).filter(item => item.width > 0));
        return { stage, partner, chat, hole, ring, tabs, chatVsPartner: edgeDelta(chat, partner), holeVsPartner: edgeDelta(hole, partner) };
    };

    // ---- welcome / first / invite ----
    await step('welcome', 120000);
    await wait(2200);
    obs.checks.welcome = await intro();
    await shot('welcome');
    await click('next'); await step('first'); await wait(1700);
    obs.checks.first = await intro();
    await shot('first');
    await click('yes'); await step('invite'); await wait(2200);
    obs.checks.invite = await intro();
    await shot('invite');
    await page.evaluate(() => {
        window.__aoPrep = [];
        const record = () => {
            const root = document.querySelector('#akari-onboarding-v1 .ao-takeover');
            if (!root) return;
            const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const entry = { text: (root.innerText || '').replace(/\s+/g, ' ').trim(),
                images: [...root.querySelectorAll('img')].filter(visible).length,
                headings: [...root.querySelectorAll('h2')].filter(visible).length,
                buttons: [...root.querySelectorAll('button')].filter(visible).length };
            const last = window.__aoPrep[window.__aoPrep.length - 1];
            if (!last || JSON.stringify(last) !== JSON.stringify(entry)) window.__aoPrep.push(entry);
        };
        window.__aoPrepObserver = new MutationObserver(record);
        window.__aoPrepObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await click('start');
    await wait(350);
    obs.checks.preparingSnapshot = await intro();
    await shot('invite-preparing');
    await step('tour0', 180000);
    obs.checks.preparing = await page.evaluate(() => { window.__aoPrepObserver?.disconnect(); return window.__aoPrep; });

    // ---- tour ----
    await wait(700); await shot('tour0-fog');
    await page.locator('#akari-onboarding-v1 [data-ao="next"]').waitFor({ timeout: 20000 });
    await wait(500); await clearToasts(); await shot('tour0-clear');
    obs.checks.tour0Titles = [await coachTitle()];
    for (let index = 0; index < 3 && await currentStep() === 'tour0'; index++) {
        await click('next'); await wait(1200);
        if (await currentStep() === 'tour0') { obs.checks.tour0Titles.push(await coachTitle()); await shot('tour0-next'); }
    }
    await step('tour1'); await wait(1100); await shot('tour1-assets');
    obs.checks.blockTour1 = [
        await blockProbe('menu-button', '[data-akari-onboarding-target="menu-button"]'),
        await blockProbe('timeline-button', '[data-akari-onboarding-target="timeline"] button'),
        await iframeProbe('output-preview-play')
    ];
    obs.checks.keysTour1 = await keyProbe();
    if (await page.locator('#akari-onboarding-v1').count() === 0) throw new Error('guide closed by key probe');
    await click('next'); await step('tour2'); await wait(900);
    const tour2 = { at0: await coachTitle() };
    await shot('tour2-preview');
    await wait(4000); tour2.at5 = await coachTitle();
    await wait(5200); tour2.at10 = await coachTitle();
    obs.checks.tour2AutoAdvance = { ...tour2, stayedOnPreview: tour2.at0 === tour2.at10 && tour2.at10.includes('プレビュー') };
    await shot('tour2-after-10s');
    if ((await coachTitle()).includes('プレビュー')) { await click('next'); await wait(1000); }
    await shot('tour2-timeline');
    await click('next'); await step('tour3'); await wait(1400);
    obs.checks.partnerTour3 = await partnerAlignment('tour3');
    await shot('tour3-partner');
    await click('next');
    const drag0 = Date.now();
    obs.checks.tour3Bridge = { waitedMs: 0, clickedNext: false };
    while (Date.now() - drag0 < 20000 && await currentStep() !== 'drag') {
        const next = page.locator('#akari-onboarding-v1 [data-ao="next"], #akari-onboarding-v1 [data-ao="fallback-next"]');
        if (Date.now() - drag0 > 4000 && await next.count()) { await next.last().click().catch(() => undefined); obs.checks.tour3Bridge.clickedNext = true; }
        await wait(300);
    }
    obs.checks.tour3Bridge.waitedMs = Date.now() - drag0;
    await step('drag'); await wait(1200); await shot('drag');
    obs.checks.blockDrag = [await blockProbe('menu-button', '[data-akari-onboarding-target="menu-button"]')];
    await page.locator('#akari-onboarding-v1 [data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    obs.checks.dragDrop = { reachedMatpreview: true };
    await step('matpreview'); await wait(900); await shot('matpreview-card');
    const hitDiag = async selector => page.evaluate(sel => {
        const element = document.querySelector(sel);
        if (!element) return { missing: true };
        const r = element.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        const blocker = document.querySelector('#akari-onboarding-v1 .ao-input-blocker');
        return { rect: [r.x, r.y, r.width, r.height].map(Math.round), topmost: top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null,
            topmostIsTarget: !!top && (top === element || element.contains(top)), blockerClip: blocker ? getComputedStyle(blocker).clipPath.slice(0, 300) : null };
    }, selector);
    obs.checks.sampleCardHit = await hitDiag('[data-akari-onboarding-target="sample-card"]');
    try { await page.locator('[data-akari-onboarding-target="sample-card"]').click({ timeout: 10000 }); obs.checks.sampleCardClick = 'real-click'; }
    catch { obs.checks.sampleCardClick = 'FAILED-real-click'; await page.locator('#akari-onboarding-v1 [data-ao="help-next"]').waitFor({ timeout: 15000 }); await click('help-next'); }
    await page.getByText('ここは「素材プレビュー」です').waitFor();
    await wait(2000);
    const materialFrame = await findPreviewFrame('material-preview');
    const playBox = materialFrame ? await materialFrame.locator('#play-toggle').boundingBox({ timeout: 5000 }).catch(() => null) : null;
    obs.checks.matpreviewRing = { play: playBox, ring: await rect('#akari-onboarding-v1 .ao-ring'),
        body: await page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-coach .ao-body')?.textContent ?? '') };
    const ringBox = obs.checks.matpreviewRing.ring;
    obs.checks.matpreviewRing.ringContainsPlay = !!(playBox && ringBox && ringBox.x <= playBox.x && ringBox.y <= playBox.y
        && ringBox.x + ringBox.width >= playBox.x + playBox.width && ringBox.y + ringBox.height >= playBox.y + playBox.height);
    obs.checks.matpreviewRing.ringVsPlay = playBox && ringBox ? edgeDelta(ringBox, playBox) : null;
    await shot('matpreview-open');
    if (materialFrame) {
        await materialFrame.locator('#play-toggle').click({ timeout: 10000 });
        await wait(1500);
        obs.checks.matpreviewPlay = await materialFrame.evaluate(() => { const video = document.querySelector('video'); return video ? { paused: video.paused, time: video.currentTime } : null; });
        await shot('matpreview-playing');
        await materialFrame.locator('#play-toggle').click({ timeout: 10000 }).catch(() => undefined);
    }
    await click('next'); await step('ask'); await wait(1400); await clearToasts();
    obs.checks.partnerAsk = await partnerAlignment('ask');
    await shot('ask');
    await page.locator('[data-answer="chatgpt"]').click(); await wait(900);
    obs.checks.partnerAskAnswered = await partnerAlignment('ask-answered');
    await shot('ask-answered');
    await click('replay'); await step('prompt'); await wait(1400);
    obs.checks.partnerPrompt = await partnerAlignment('prompt');
    await shot('prompt');
    // Simulate a partner panel that cannot be found: the guide must use its own placeholder view on the right
    // (not the old floating default position), then re-anchor when the real panel is back.
    const partnerNode = page.locator('[data-akari-onboarding-target="partner"]');
    await partnerNode.evaluate(element => { element.setAttribute('data-akari-onboarding-target', 'partner-hidden-by-probe'); });
    await wait(4500);
    obs.checks.partnerFallback = await page.evaluate(() => {
        const box = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const chat = document.querySelector('#akari-onboarding-v1 .ao-chat');
        return { chat: box(chat), chatHidden: chat?.hidden ?? null, fallbackClass: chat?.classList.contains('ao-chat-fallback') ?? null,
            rightContent: box(document.querySelector('#theia-right-content-panel')), partnerNode: box(document.querySelector('[data-akari-onboarding-target="partner-hidden-by-probe"]')),
            viewport: { width: innerWidth, height: innerHeight } };
    });
    await shot('prompt-partner-fallback');
    await page.locator('[data-akari-onboarding-target="partner-hidden-by-probe"]').evaluate(element => { element.setAttribute('data-akari-onboarding-target', 'partner'); });
    await wait(1500);
    obs.checks.partnerAfterFallback = await partnerAlignment('prompt-after-fallback');
    obs.checks.chatStyle = await page.evaluate(() => {
        const chat = document.querySelector('#akari-onboarding-v1 .ao-chat');
        if (!chat) return null;
        const pick = element => { if (!element) return null; const s = getComputedStyle(element); return { cls: element.className, fontSize: s.fontSize, lineHeight: s.lineHeight, color: s.color, background: s.backgroundColor, fontFamily: s.fontFamily.slice(0, 60) }; };
        return { root: pick(chat), log: pick(chat.querySelector('.ao-chat-log')), children: [...chat.querySelectorAll('*')].slice(0, 30).map(pick) };
    });
    await click('insert'); await wait(600); await click('send'); await step('work');
    await wait(9000); await shot('work-mid');
    obs.checks.partnerWork = await partnerAlignment('work');
    await step('play', 90000); await wait(1500);
    const preview = await findPreviewFrame('output');
    if (!preview) throw new Error('output preview frame not found');
    await shot('play-before');
    obs.checks.blockPlay = [await blockProbe('menu-button', '[data-akari-onboarding-target="menu-button"]')];
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await page.waitForFunction(() => (document.querySelector('#akari-onboarding-v1 .ao-coach h3')?.textContent ?? '').includes('入りました'), null, { timeout: 20000 });
    await wait(6000); await shot('play-running');
    await preview.locator('[data-akari-onboarding-target="play-button"]').click();
    await wait(400);
    const doCaption = async suffix => {
    await preview.locator('.caption-row-plate:not([data-output-caption]) .akari-caption__line').first().click();
    const inAnyFrame = async (selector, timeout = 6000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            for (const frame of page.frames()) {
                const locator = frame.locator(selector);
                if (await locator.count().catch(() => 0) && await locator.first().isVisible().catch(() => false)) return locator.first();
            }
            await wait(250);
        }
        return undefined;
    };
    obs.checks.captionPath ??= [];
    const sizeButton = await inAnyFrame('[data-akari-onboarding-target="caption-size"]');
    if (sizeButton) { await sizeButton.click(); obs.checks.captionPath.push('size-button'); }
    else { await page.locator('#akari-onboarding-v1 [data-ao="help-next"]').waitFor({ timeout: 15000 }); await click('help-next'); obs.checks.captionPath.push('help-next(size)'); }
    await wait(600);
    const slider = await inAnyFrame('[data-akari-onboarding-target="caption-size-slider"]');
    if (slider) {
        await slider.evaluate(element => {
            element.value = String(Math.min(Number(element.max), Number(element.value) + 6));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        obs.checks.captionPath.push('slider');
    } else { await page.locator('#akari-onboarding-v1 [data-ao="help-next"]').waitFor({ timeout: 15000 }); await click('help-next'); obs.checks.captionPath.push('help-next(slider)'); }
    await page.waitForFunction(() => (document.querySelector('#akari-onboarding-v1 .ao-coach h3')?.textContent ?? '').includes('位置も動かせます'), null, { timeout: 20000 });
    await wait(700); await shot('caption-adjusted' + suffix);
    };
    await click('next'); await step('caption'); await wait(900); await shot('caption');
    obs.checks.partnerCaption = await partnerAlignment('caption');
    await doCaption('');
    await click('next'); await step('daihon'); await wait(900); await shot('daihon');
    obs.checks.daihonButtonHit = await hitDiag('[data-akari-onboarding-target="daihon-button"]');
    await page.locator('[data-akari-onboarding-target="daihon-button"]').click({ timeout: 15000 });
    await page.getByText('この行を押してみてください').waitFor();
    await wait(700);
    obs.checks.daihonRowHit = await hitDiag('[data-akari-onboarding-target="daihon-first-row"]');
    await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click({ timeout: 15000 });
    await page.getByText('プレビューがこの場面へ飛びました').waitFor();
    await wait(600); await shot('daihon-seek');
    // Going back from 台本 puts the chat step on screen while the right panel shows 台本, not the partner.
    await click('back'); await step('caption'); await wait(1800);
    obs.checks.partnerBackFromDaihon = await partnerAlignment('caption-back-from-daihon');
    await shot('caption-back-from-daihon');
    await doCaption('-again');
    await click('next'); await step('daihon'); await wait(900);
    await page.locator('[data-akari-onboarding-target="daihon-button"]').click();
    await page.getByText('この行を押してみてください').waitFor();
    await wait(700);
    await page.locator('[data-akari-onboarding-target="daihon-first-row"]').click();
    await page.getByText('プレビューがこの場面へ飛びました').waitFor();
    await wait(400);
    await click('next'); await step('export'); await wait(900); await shot('export');
    obs.checks.exportMenuHit = await hitDiag('[data-akari-onboarding-target="menu-button"]');
    await page.locator('[data-akari-onboarding-target="menu-button"]').click({ timeout: 15000 });
    await page.locator('[data-akari-onboarding-target="export-button"]').waitFor();
    await wait(500);
    await page.locator('[data-akari-onboarding-target="export-button"]').click();
    await page.locator('[data-akari-onboarding-target="export-submit"]').waitFor();
    await wait(700); await shot('export-dialog');
    const exportStarted = Date.now();
    await page.locator('[data-akari-onboarding-target="export-submit"]').click();
    await page.getByText('書き出せました', { exact: true }).waitFor({ timeout: 240000 });
    obs.checks.exportMs = Date.now() - exportStarted;
    await wait(900); await shot('export-result');
    await click('next'); await step('done'); await wait(2400); await shot('done');
    obs.checks.done = await page.evaluate(() => document.querySelector('#akari-onboarding-v1 .ao-takeover')?.innerText.replace(/\s+/g, ' ').trim());
    obs.finishedAt = new Date().toISOString();
} catch (error) {
    obs.error = String(error instanceof Error ? error.message : error).split(/[\r\n]/)[0].replaceAll(scratch, '<isolated>');
    console.error(obs.error);
    try {
        const page = browser?.contexts()[0]?.pages()[0];
        if (page) await page.screenshot({ path: join(outDir, 'zz-error.jpg'), type: 'jpeg', quality: 80 });
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
