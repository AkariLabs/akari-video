// Run after the shell build: node l1.mjs <output-root> [cdp-port]
// Screenshots, logs, and measurements stay under the caller's output root.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../../../..');
const repoRoot = resolve(shellRoot, '../..');
const outputRoot = process.argv[2];
if (!outputRoot) throw new Error('output root required');
const port = Number(process.argv[3] ?? 9447);
const output = resolve(outputRoot);
const scratch = join(output, 'onboarding-guide-fixes');
const home = join(scratch, 'home');
const profile = join(scratch, 'profile');
const akariHome = join(scratch, 'akari-home');
const tmp = join(scratch, 'tmp');
const project = join(scratch, 'current-project');
await mkdir(scratch, { recursive: true });
await cp(join(repoRoot, 'templates/project-default'), project, { recursive: true, force: true });
await Promise.all([home, profile, akariHome, tmp].map(dir => mkdir(dir, { recursive: true })));

const require = createRequire(join(shellRoot, 'package.json'));
const electron = require('electron');
const { chromium } = require('playwright-core');
const log = createWriteStream(join(scratch, 'electron.log'));
const env = { ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: akariHome,
    TMPDIR: tmp, THEIA_CONFIG_DIR: profile, AKARI_UPDATE_FEED_URL: 'http://127.0.0.1:9/offline',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: 'localhost,127.0.0.1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electron, [shellRoot, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shellRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log);
child.stderr.pipe(log);

const wait = ms => new Promise(done => setTimeout(done, ms));
const result = { startedAt: new Date().toISOString(), checks: {}, shots: [], pageErrors: [], error: null };
let browser;
let page;
try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Electron exited before CDP');
        try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ }
        await wait(300);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].waitForEvent('page');
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => result.pageErrors.push(String(error.message).slice(0, 300)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => !!window.theia?.container, null, { timeout: 120000 });

    const shellState = () => page.evaluate(() => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(value =>
            typeof value === 'function' && typeof value.prototype?.collapsePanel === 'function'
                && typeof value.prototype?.revealWidget === 'function');
        if (!key) throw new Error(`ApplicationShell binding unavailable: ${[...container._bindingDictionary._map.keys()]
            .filter(value => typeof value === 'function').map(value => value.name).slice(0, 80).join(',')}`);
        const shell = container.get(key);
        return { left: shell.isExpanded('left'), bottom: shell.isExpanded('bottom') };
    });
    const shellCall = script => page.evaluate(script => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(value =>
            typeof value === 'function' && typeof value.prototype?.collapsePanel === 'function'
                && typeof value.prototype?.revealWidget === 'function');
        const shell = container.get(key);
        return script === 'collapseLeft' ? shell.collapsePanel('left') : undefined;
    }, script);
    const command = id => page.evaluate(id => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(value =>
            typeof value === 'symbol' && value.description === 'CommandService')
            ?? [...container._bindingDictionary._map.keys()].find(value =>
                typeof value === 'function' && typeof value.prototype?.executeCommand === 'function');
        if (!key) throw new Error('CommandService binding unavailable');
        void container.get(key).executeCommand(id);
    }, id);
    const currentProject = () => page.evaluate(() =>
        document.body.innerText.includes('current-project') ? 'current-project' : null);
    const shot = async label => {
        const file = `${String(result.shots.length + 1).padStart(2, '0')}-${label}.jpg`;
        await page.screenshot({ path: join(scratch, file), type: 'jpeg', quality: 82 });
        result.shots.push(join(scratch, file));
    };
    const step = name => page.locator(`#akari-onboarding-v1[data-akari-onboarding-step="${name}"]`).waitFor({ timeout: 180000 });
    const click = action => page.locator(`#akari-onboarding-v1 [data-ao="${action}"]`).last().click();
    const measure = target => page.evaluate(target => {
        const rect = element => {
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const root = document.querySelector('#akari-onboarding-v1');
        const targetElement = document.querySelector(`[data-akari-onboarding-target="${target}"]`);
        const targetBounds = targetElement?.getBoundingClientRect();
        const hit = targetBounds ? document.elementFromPoint(targetBounds.x + targetBounds.width / 2,
            targetBounds.y + targetBounds.height / 2) : null;
        return { step: root?.getAttribute('data-akari-onboarding-step'), target: rect(targetElement),
            hole: rect(root?.querySelector('.ao-hole')), ring: rect(root?.querySelector('.ao-ring')),
            coach: rect(root?.querySelector('.ao-coach:not(.out)')),
            blockerClipPath: root?.querySelector('.ao-input-blocker')?.style.clipPath ?? '',
            hitInsideTarget: !!hit && !!targetElement?.contains(hit),
            openPrompt: !!document.querySelector('[data-akari-home-dialog="open-project"]') };
    }, target);

    const projectDeadline = Date.now() + 120000;
    while (Date.now() < projectDeadline && !result.checks.initialProject) {
        result.checks.initialProject = await currentProject().catch(() => null);
        if (!result.checks.initialProject) await wait(500);
    }
    if (!result.checks.initialProject) throw new Error('the initial project is not open');
    result.checks.initialTitle = await page.title();
    result.checks.initialLayout = await shellState();
    await shellCall('collapseLeft');
    result.checks.closedBeforeGuide = await shellState();
    await command('akari.home.openFirstVideoGuide');
    await step('welcome');
    await click('next'); await step('first');
    await click('yes'); await step('invite');
    await shot('invite');
    await click('start');
    await step('tour0');
    await page.waitForFunction(previous => document.title !== previous, result.checks.initialTitle, { timeout: 60000 });
    result.checks.tour0 = { ...await measure('assets'), workspace: await page.evaluate(() => ({
        title: document.title, excerpt: document.body.innerText.slice(0, 600),
        currentProjectPresent: document.body.innerText.includes('current-project'),
        guideProjectPresent: document.body.innerText.includes('first-video')
    })) };
    await shot('tour0');
    await click('next'); await click('next'); await step('tour1');
    await page.waitForFunction(() => {
        const rect = document.querySelector('[data-akari-onboarding-target="assets"]')?.getBoundingClientRect();
        const hole = document.querySelector('#akari-onboarding-v1 .ao-hole')?.getBoundingClientRect();
        const coach = document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out)')?.getBoundingClientRect();
        return !!rect && rect.width > 0 && rect.height > 0 && !!hole && hole.width > 0 && hole.width < 500
            && !!coach && coach.width > 0;
    });
    result.checks.tour1 = { ...await measure('assets'), layout: await shellState() };
    await shot('tour1');
    await click('next'); await step('tour2');
    await click('next'); await click('next'); await step('tour3');
    await click('next'); await click('next'); await step('drag');
    await page.locator('#akari-onboarding-v1 [data-ao-file]').dragTo(page.locator('[data-akari-onboarding-target="assets"]'));
    await step('matpreview');
    await page.waitForFunction(() => {
        const rect = document.querySelector('[data-akari-onboarding-target="assets"]')?.getBoundingClientRect();
        const coach = document.querySelector('#akari-onboarding-v1 .ao-coach:not(.out)')?.getBoundingClientRect();
        return !!rect && rect.width > 0 && rect.height > 0 && !!coach && coach.width > 0;
    });
    await page.waitForFunction(() => {
        const card = document.querySelector('[data-akari-onboarding-target="sample-card"]')?.getBoundingClientRect();
        const ring = document.querySelector('#akari-onboarding-v1 .ao-ring')?.getBoundingClientRect();
        return !!card && !!ring && card.width > 0 && card.height > 0 && ring.width > 0 && ring.height > 0
            && Math.min(card.right, ring.right) > Math.max(card.left, ring.left)
            && Math.min(card.bottom, ring.bottom) > Math.max(card.top, ring.top);
    }, null, { timeout: 45000 }).catch(() => undefined);
    await wait(900);
    result.checks.matpreview = { ...await measure('sample-card'), assetPanel: await measure('assets'),
        layout: await shellState(), sampleCard: await page.locator('[data-akari-onboarding-target="sample-card"]').count() };
    await shot('matpreview');
    await page.locator('#akari-onboarding-v1 [data-ao="idle-close"]').waitFor({ timeout: 30000 });
    await page.locator('#akari-onboarding-v1 [data-ao="idle-close"]').click();
    await page.locator('#akari-onboarding-v1').waitFor({ state: 'detached' });
    result.checks.closed = await shellState();
    await shot('closed');
    const visible = item => item && item.width > 0 && item.height > 0;
    const overlaps = (left, right) => Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x)
        && Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y);
    result.checks.cardVisible = result.checks.matpreview.sampleCard > 0 && visible(result.checks.matpreview.target)
        && visible(result.checks.matpreview.ring)
        && overlaps(result.checks.matpreview.target, result.checks.matpreview.ring);
    result.checks.layoutPass = result.checks.tour0.workspace.title !== result.checks.initialTitle
        && !result.checks.tour0.workspace.currentProjectPresent && !result.checks.tour0.openPrompt
        && result.checks.closedBeforeGuide.left === false
        && result.checks.tour1.layout.left && visible(result.checks.tour1.target)
        && visible(result.checks.tour1.hole) && visible(result.checks.tour1.coach)
        && result.checks.matpreview.layout.left && result.checks.cardVisible
        && visible(result.checks.matpreview.assetPanel.target)
        && visible(result.checks.matpreview.coach) && result.checks.matpreview.hitInsideTarget
        && result.checks.matpreview.assetPanel.blockerClipPath.includes('M 0 44 H 48')
        && result.checks.closed.left === false;
    if (!result.checks.layoutPass) throw new Error('one or more guide layout observations failed');
} catch (error) {
    result.error = String(error instanceof Error ? error.message : error);
    if (page) await page.screenshot({ path: join(scratch, 'zz-error.jpg'), type: 'jpeg', quality: 80 }).catch(() => {});
} finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(join(scratch, 'observations.json'), JSON.stringify(result, null, 2));
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.race([new Promise(done => child.once('exit', done)), wait(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    log.end();
}
if (result.error) { console.error(result.error); process.exitCode = 1; }
else console.log(JSON.stringify(result.checks));
