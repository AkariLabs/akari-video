// Attach only: the wrapper builds/starts Electron and prepares the isolated workspace.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CDP, listTargets, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';

const port = Number(process.env.CDP_PORT);
if (!Number.isInteger(port) || port < 1) throw new Error('Set CDP_PORT to the already-running Electron debug port.');
const out = process.env.EVIDENCE_DIR || path.dirname(fileURLToPath(import.meta.url));
await mkdir(out, { recursive: true });
const started = Date.now();
const log = { startedAt: new Date().toISOString(), cdpPort: port, status: 'running', steps: [], screenshots: [] };
// Verified entry: @theia/application-manager/lib/generator/frontend-generator.js publishes
// window.theia.container before application.start(). Optional expression supports a wrapper
// exposing that same container differently; it never substitutes a fake CommandService.
const containerExpression = process.env.THEIA_CONTAINER_EXPRESSION || 'window.theia?.container';
let main;

async function attach() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const targets = await listTargets(port);
        // Avoid assuming /json/list's first page is the workbench (splash/extra windows exist).
        for (const target of targets.filter(item => item.type === 'page')) {
            const cdp = new CDP(target.webSocketDebuggerUrl);
            try {
                await cdp.connect();
                const found = await evalMain(cdp, `Boolean(${containerExpression})`, 3000);
                if (found) {
                    await cdp.send('Page.enable');
                    await cdp.send('Runtime.enable');
                    await cdp.send('Page.bringToFront');
                    log.target = { id: target.id, title: target.title, url: target.url };
                    return cdp;
                }
            } catch (error) { log.lastAttachError = String(error); }
            cdp.close();
        }
        await sleep(300);
    }
    throw new Error('Theia container unavailable in all page targets. Wait for startup, or set THEIA_CONTAINER_EXPRESSION to the actual container expression exposed by your wrapper.');
}
async function waitFor(expression, label, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const value = await evalMain(main, expression);
        if (value) return value;
        await sleep(75);
    }
    throw new Error(`Timed out: ${label}`);
}
async function shot(name) {
    await screenshot(main, path.join(out, name));
    log.screenshots.push(name);
}
const scope = '#akari-role-buckets-widget';
const band = `${scope} .akari-gen-pick-band`;
const card = name => `${scope} [data-akari-material-path="assets/${name}"]`;
async function click(selector) {
    const point = await evalMain(main, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) throw new Error('Hidden element: ' + ${JSON.stringify(selector)});
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await realClick(main, point.x, point.y); // One real pointer click, never element.click().
}
async function begin(multi) {
    const req = { slot: multi ? 'reference_images' : 'first_frame', label: multi ? '参照' : '最初の絵',
        accepts: ['image'], multi, ...(multi ? { max: 2 } : {}) };
    await evalMain(main, `(() => {
        window.__akariGenPickL1Result = null;
        window.__akariGenPickL1Commands.executeCommand('akari.generation.pickInto', ${JSON.stringify(req)})
            .then(result => { window.__akariGenPickL1Result = result; },
                error => { window.__akariGenPickL1Result = { error: String(error) }; });
        return true;
    })()`);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(band)}))`, 'selection band');
    const text = await evalMain(main, `document.querySelector(${JSON.stringify(band)}).textContent`);
    assert.ok(text.includes(`${req.label} に入れる素材を選ぶ`));
    await click(`${scope} [data-akari-panel-segment="materials"]`);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(card('a.png'))}))`, 'fixture a.png');
}
async function result() {
    const value = await waitFor('window.__akariGenPickL1Result', 'pick command result');
    assert.equal(value.error, undefined);
    await waitFor(`!document.querySelector(${JSON.stringify(band)})`, 'band removed');
    return value;
}

try {
    main = await attach();
    log.commandService = await waitFor(`(() => {
        const container = ${containerExpression};
        const keys = [];
        for (let current = container; current; current = current.parent) {
            const dictionary = current._bindingDictionary;
            if (dictionary?._map) keys.push(...dictionary._map.keys());
            else if (dictionary?.traverse) dictionary.traverse(key => keys.push(key));
        }
        // Primary: the actual Symbol('CommandService'). Fallback proven by the existing
        // inspector-live-preview-sync evidence: CommandRegistry class's method signatures.
        const candidates = keys.filter(key => typeof key === 'symbol' && key.description === 'CommandService');
        candidates.push(...keys.filter(key => typeof key === 'function'
            && typeof key.prototype?.executeCommand === 'function'
            && typeof key.prototype?.registerCommand === 'function'));
        for (const key of candidates) {
            try {
                const commands = container.get(key);
                if (commands.getCommand?.('akari.generation.pickInto')) {
                    window.__akariGenPickL1Commands = commands;
                    return { resolution: typeof key === 'symbol' ? 'CommandService symbol' : 'CommandRegistry prototype', registered: true };
                }
            } catch { /* Try the class-bound registry when the service alias is absent. */ }
        }
        return false;
    })()`, 'registered akari.generation.pickInto command');

    let at = Date.now();
    await begin(false);
    // Fixture errors fail explicitly before any click can be mistaken for a pass.
    for (const name of ['a.png', 'b.png', 'c.png', 'clip.mp4']) {
        await waitFor(`Boolean(document.querySelector(${JSON.stringify(card(name))}))`, `fixture ${name}`);
    }
    await shot('01-single-band.png');
    await click(card('a.png'));
    const single = await result();
    assert.deepEqual(single, { status: 'picked', paths: ['assets/a.png'] });
    await shot('02-single-picked.png');
    log.steps.push({ scenario: 'single', elapsedMs: Date.now() - at, clicks: 1, result: single, bandRemoved: true });

    at = Date.now();
    await begin(true);
    await click(card('a.png'));
    await click(card('b.png'));
    const badges = await waitFor(`(() => {
        const badges = ['a.png', 'b.png'].map(name => document.querySelector(
            '${scope} [data-akari-material-path="assets/' + name + '"] .akari-gen-pick-badge')?.textContent);
        return badges.every(Boolean) ? badges : false;
    })()`, 'two ordered badges');
    assert.deepEqual(badges, ['@画像1', '@画像2']);
    const completeText = await evalMain(main, `document.querySelector('${scope} .akari-gen-pick-complete').textContent`);
    assert.equal(completeText.trim(), '完了（2）');
    const maxDisabled = await evalMain(main, `document.querySelector(${JSON.stringify(card('c.png'))}).getAttribute('aria-disabled')`);
    assert.equal(maxDisabled, 'true');
    await shot('03-multi-badges.png');
    await click(`${scope} .akari-gen-pick-complete`);
    const multi = await result();
    assert.deepEqual(multi, { status: 'picked', paths: ['assets/a.png', 'assets/b.png'] });
    log.steps.push({ scenario: 'multi', elapsedMs: Date.now() - at, badges, completeText, maxDisabled, result: multi });

    at = Date.now();
    await begin(false);
    const disabled = await evalMain(main, `document.querySelector(${JSON.stringify(card('clip.mp4'))}).getAttribute('aria-disabled')`);
    assert.equal(disabled, 'true');
    await click(card('clip.mp4'));
    await sleep(300);
    const unresolved = await evalMain(main, 'window.__akariGenPickL1Result === null');
    assert.equal(unresolved, true);
    assert.equal(await evalMain(main, `Boolean(document.querySelector(${JSON.stringify(band)}))`), true);
    await shot('04-video-disabled.png');
    log.steps.push({ scenario: 'accepts', elapsedMs: Date.now() - at, ariaDisabled: disabled, unresolved });

    at = Date.now();
    await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const cancelled = await result();
    assert.deepEqual(cancelled, { status: 'cancelled' });
    await shot('05-escape-cancelled.png');
    log.steps.push({ scenario: 'escape', elapsedMs: Date.now() - at, result: cancelled, bandRemoved: true });
    log.status = 'PASS';
} catch (error) {
    log.status = 'FAIL';
    log.error = error.stack || String(error);
    if (main) await shot('99-failure.png').catch(() => {});
    process.exitCode = 1;
} finally {
    log.elapsedMs = Date.now() - started;
    await writeFile(path.join(out, 'run-log.json'), JSON.stringify(log, null, 2) + '\n');
    if (main) {
        // Restore only the temporary test session, never terminate the wrapper's Electron.
        await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
        await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
        await evalMain(main, `(() => {
            delete window.__akariGenPickL1Commands;
            delete window.__akariGenPickL1Result;
            return true;
        })()`).catch(() => {});
        main.close();
    }
    console.log(JSON.stringify(log, null, 2));
}
