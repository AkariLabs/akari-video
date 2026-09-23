#!/usr/bin/env node
// Isolated Electron/CDP observation for the Settings shortcuts page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, resizeViewport, screenshot } from '../../apps/shell/extensions/akari-annotations/evidence/caption-subrow-output-space/scripts/cdp-lib.mjs';
import { createFixture } from '../../apps/shell/extensions/akari-annotations/evidence/timeline-frame-tool/gen-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const shell = path.join(root, 'apps/shell');
const port = 9473;
await mkdir('/tmp/shortcuts-settings-l1', { recursive: true });
const temp = await mkdtemp('/tmp/shortcuts-settings-l1/codex-');
const workspace = path.join(temp, 'project');
const config = path.join(temp, 'config');
const results = { port, groups: {}, filters: {}, checks: {} };
let child; let cdp; let logs = '';
const ev = expression => evalOn(cdp, expression);
async function waitFor(read, label, timeout = 120000) {
    const until = Date.now() + timeout;
    let last;
    while (Date.now() < until) {
        try { last = await read(); if (last) return last; } catch (error) { last = String(error); }
        await sleep(300);
    }
    throw new Error(`${label}: ${String(last)}`);
}
async function click(selector) {
    await ev(`(() => { document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ behavior: 'instant', block: 'center' }); return true; })()`);
    const point = await waitFor(() => ev(`(() => { const n = document.querySelector(${JSON.stringify(selector)});
        if (!n) return null; const r = n.getBoundingClientRect();
        return r.width && r.height && r.top >= 0 && r.bottom <= innerHeight
            ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`), selector, 30000);
    await realClick(cdp, point.x, point.y);
}
async function domClick(selector) {
    await ev(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw Error('missing ${selector}'); n.click(); return true; })()`);
}
async function key(key, code, vk, modifiers = 0) {
    const data = { key, code, windowsVirtualKeyCode: vk, modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...data });
    if (key.length === 1 && !(modifiers & 6)) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'char', ...data, text: key, unmodifiedText: key });
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
}
const shot = name => screenshot(cdp, path.join(here, name));
const row = id => `[data-shortcuts-row="${id}"]`;
const keymaps = () => readFile(path.join(config, 'keymaps.json'), 'utf8').then(JSON.parse);
const tool = () => ev('window.__shortcutsL1.tl.toolMode');
async function focusTimeline() {
    await ev('(async () => { const { sh, tl } = window.__shortcutsL1; await sh.activateWidget(tl.id); tl.node.focus(); return true; })()');
    await click('.akari-annotations-strip [data-akari-ui="timeline:cut:0"]');
}
const selectTool = async () => { await focusTimeline(); await key('v', 'KeyV', 86); await waitFor(async () => (await tool()) === 'select', 'select tool'); };
const pressOptionB = () => key('∫', 'KeyB', 66, 1);
try {
    await cp(path.join(root, 'templates/project-default'), workspace, { recursive: true });
    await createFixture(workspace);
    await mkdir(config);
    await writeFile(path.join(config, 'keymaps.json'), '[]\n');
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, 'userdata')}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: path.join(temp, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const target = await waitFor(async () => (await listTargets(port)).find(item =>
        item.type === 'page' && item.url.includes(path.basename(temp))), 'project CDP page', 180000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await resizeViewport(cdp, 1600, 1000);
    await waitFor(() => ev('!!window.theia?.container && !!document.getElementById("theia-app-shell")'), 'shell', 180000);
    await ev(`(() => { for (const block of document.querySelectorAll('.dialogBlock')) {
        [...block.querySelectorAll('button')].find(b => /キャンセル|閉じる|Cancel|Close/.test(b.textContent))?.click();
    } return true; })()`);
    await ev(`(() => { const c = window.theia.container; const token = [...c._bindingDictionary._map.keys()]
        .find(k => typeof k === 'function' && k.prototype?.executeCommand && k.prototype?.registerCommand);
        const reg = c.get(token); const kbToken = [...c._bindingDictionary._map.keys()]
            .find(k => typeof k === 'function' && k.prototype?.getKeybindingsForCommand && k.prototype?.registerKeybinding);
        window.__shortcutsL1 = { reg, kb: c.get(kbToken), executed: [] };
        reg.onDidExecuteCommand(e => window.__shortcutsL1.executed.push(e.commandId));
        void reg.executeCommand('akari.annotations.open');
        void reg.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(pathToFileURL(path.join(workspace, 'edit.json')).toString())} });
        return true; })()`);
    await waitFor(() => ev('!!document.querySelector(\'.akari-annotations-strip [data-akari-ui="timeline:cut:0"]\')'), 'timeline chip');
    await ev(`(() => { const c = window.theia.container; const token = [...c._bindingDictionary._map.keys()]
        .find(k => typeof k === 'function' && k.prototype?.getCurrentWidget && k.prototype?.addWidget && k.prototype?.activateWidget);
        const sh = c.get(token); const tl = sh.widgets.find(w => w.node?.classList.contains('akari-annotations-widget'));
        if (!tl) throw Error('timeline widget missing'); Object.assign(window.__shortcutsL1, { sh, tl }); return true; })()`);
    await selectTool();
    results.checks.timelineToolBefore = await tool();
    await ev("(() => { void window.__shortcutsL1.reg.executeCommand('akari.settings.open', 'shortcuts'); return true; })()");
    await waitFor(() => ev('document.querySelectorAll("[data-shortcuts-row]").length'), 'shortcut rows');
    await waitFor(() => ev('!document.querySelector(".theia-preload")'), 'preload cleared', 240000);
    process.stderr.write('L1: page ready\n');
    results.groups = await ev(`Object.fromEntries([...document.querySelectorAll('[data-shortcuts-group]')]
        .map(h => [h.getAttribute('data-shortcuts-group'), h.nextElementSibling.querySelectorAll('[data-shortcuts-row]').length]))`);
    results.checks.rows = await ev('document.querySelectorAll("[data-shortcuts-row]").length');
    results.checks.razorInitiallyPresent = await ev(`!!document.querySelector(${JSON.stringify(row('akari.timeline.razorTool'))})`);
    await shot('dark.png');
    await ev('document.querySelector("[data-settings-nav=appearance]").click()');
    await waitFor(() => ev('!!document.querySelector("[data-akari-settings-section=appearance] button.akari-set-card")'), 'appearance');
    await ev(`(() => { const page = document.querySelector('[data-akari-settings-section=appearance]');
        [...page.querySelectorAll('button.akari-set-card')].find(b => b.textContent.includes('ライト'))?.click(); return true; })()`);
    await sleep(600);
    results.checks.lightSelected = await ev(`!![...document.querySelectorAll('[data-akari-settings-section=appearance] button.akari-set-card')]
        .find(b => b.textContent.includes('ライト') && b.getAttribute('aria-checked') === 'true')`);
    await waitFor(() => ev("document.body.classList.contains('theia-light')"), 'light theme', 15000);
    await ev('document.querySelector("[data-settings-nav=shortcuts]").click()');
    await shot('light.png');
    await ev(`(() => { const n = document.querySelector('[data-shortcuts-search]'); n.value = '⌘B';
        n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    results.checks.symbolSearch = await ev(`!!document.querySelector(${JSON.stringify(row('akari.timeline.razorTool'))})`);
    if (!results.checks.symbolSearch) {
        results.checks.searchDiagnostics = await ev(`({ value: document.querySelector('[data-shortcuts-search]')?.value,
            rows: [...document.querySelectorAll('[data-shortcuts-row]')].map(n => n.getAttribute('data-shortcuts-row')),
            command: window.__shortcutsL1.reg.getCommand('akari.timeline.razorTool')?.label })`);
        process.stderr.write(JSON.stringify(results.checks, null, 2) + '\n');
    }
    assert.equal(results.checks.symbolSearch, true);
    await ev(`(() => { const n = document.querySelector('[data-shortcuts-search]'); n.value = '文字'; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    results.checks.textSearch = await ev(`!!document.querySelector(${JSON.stringify(row('akari.caption.placeText'))})`);
    assert.equal(results.checks.textSearch, true);
    await ev(`(() => { const n = document.querySelector('[data-shortcuts-search]'); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    for (const filter of ['all', 'modified', 'unassigned', 'conflicts']) {
        await click(`[data-shortcuts-filter="${filter}"]`);
        results.filters[filter] = await ev('document.querySelectorAll("[data-shortcuts-row]").length');
    }
    await click('[data-shortcuts-filter="all"]');
    process.stderr.write('L1: search and filters ready\n');
    await click('[data-shortcuts-jump="panels"]');
    results.checks.jump = await waitFor(async () => {
        const top = await ev('document.querySelector("[data-shortcuts-group=panels]").getBoundingClientRect().top');
        return top >= 100 && top < 380 ? top : null;
    }, 'category jump', 8000);
    const razor = 'akari.timeline.razorTool';
    const recordB = () => ev(`(() => { const keys = [...document.querySelectorAll(${JSON.stringify(row('akari.timeline.razorTool') + ' [data-shortcuts-key]')})];
        const primary = keys.find(n => n.getAttribute('aria-label')?.includes(' B を変更'));
        if (!primary) throw Error('razorTool B key missing'); primary.click(); return true; })()`);
    await recordB();
    results.checks.recording = await ev(`!!document.querySelector(${JSON.stringify(row('akari.timeline.razorTool') + ' [data-recording="true"]')})`);
    assert.equal(results.checks.recording, true);
    await key('Escape', 'Escape', 27);
    results.checks.escapeCanceled = !(await ev('!!document.querySelector("[data-recording=true]")')) && (await keymaps()).length === 0;
    assert.equal(results.checks.escapeCanceled, true);
    await recordB();
    await pressOptionB();
    await waitFor(async () => (await keymaps()).some(item => item.command === razor && item.keybinding === 'alt+b'), 'remap JSON');
    await waitFor(() => ev("window.__shortcutsL1.kb.getKeybindingsForCommand('akari.timeline.razorTool').some(b => b.keybinding === 'alt+b')"), 'remap registry');
    results.checks.remapped = await keymaps();
    results.checks.keysAfterRemap = await ev("window.__shortcutsL1.kb.getKeybindingsForCommand('akari.timeline.razorTool').map(b => b.keybinding)");
    assert.deepEqual([...results.checks.keysAfterRemap].sort(), ['alt+b', 'c']);
    await click('[data-shortcuts-filter="modified"]');
    results.checks.modifiedAfterRemap = await ev('document.querySelectorAll("[data-shortcuts-row]").length');
    assert.equal(await ev(`!!document.querySelector(${JSON.stringify(row('akari.timeline.razorTool'))})`), true);
    await click('[data-shortcuts-filter="all"]');
    process.stderr.write('L1: remap saved\n');
    await key('Escape', 'Escape', 27);
    await selectTool();
    results.checks.beforeOptionB = await tool();
    await pressOptionB();
    await waitFor(async () => (await tool()) === 'razor', 'Option+B selects razor');
    results.checks.optionBTool = await tool();
    await selectTool();
    await key('b', 'KeyB', 66);
    await sleep(250);
    results.checks.oldBTool = await tool();
    assert.equal(results.checks.oldBTool, 'select');
    await key('c', 'KeyC', 67);
    await waitFor(async () => (await tool()) === 'razor', 'C remains assigned');
    results.checks.cTool = await tool();
    process.stderr.write('L1: new key selects razor; old B does not; C remains\n');
    await ev("(() => { void window.__shortcutsL1.reg.executeCommand('akari.settings.open', 'shortcuts'); return true; })()");
    await waitFor(() => ev('document.querySelectorAll("[data-shortcuts-row]").length'), 'shortcut rows after remap');
    await domClick(`${row(razor)} [data-shortcuts-menu]`);
    await domClick(`${row(razor)} [data-shortcuts-action="disable"]`);
    await waitFor(async () => { const items = await keymaps(); return ['b', 'c'].every(keybinding =>
        items.some(item => item.command === '-akari.timeline.razorTool' && item.keybinding === keybinding))
        && !items.some(item => item.command === razor); }, 'disabled JSON');
    await waitFor(() => ev("window.__shortcutsL1.kb.getKeybindingsForCommand('akari.timeline.razorTool').length === 0"), 'disabled registry');
    results.checks.disabled = await keymaps();
    process.stderr.write('L1: disabled\n');
    await key('Escape', 'Escape', 27);
    await selectTool();
    await key('c', 'KeyC', 67);
    await sleep(250);
    results.checks.disabledCTool = await tool();
    assert.equal(results.checks.disabledCTool, 'select');
    await pressOptionB();
    await sleep(250);
    results.checks.disabledOptionBTool = await tool();
    assert.equal(results.checks.disabledOptionBTool, 'select');
    await ev("(() => { void window.__shortcutsL1.reg.executeCommand('akari.settings.open', 'shortcuts'); return true; })()");
    await waitFor(() => ev('document.querySelectorAll("[data-shortcuts-row]").length'), 'shortcut rows after disable');
    await domClick(`${row(razor)} [data-shortcuts-menu]`);
    await domClick(`${row(razor)} [data-shortcuts-action="reset"]`);
    await waitFor(async () => !(await keymaps()).some(item => item.command.replace(/^-/, '') === razor), 'reset JSON');
    await waitFor(() => ev("window.__shortcutsL1.kb.getKeybindingsForCommand('akari.timeline.razorTool').some(b => b.keybinding === 'b')"), 'reset registry');
    results.checks.reset = await keymaps();
    process.stderr.write('L1: reset\n');
    await key('Escape', 'Escape', 27);
    await selectTool();
    await key('b', 'KeyB', 66);
    await waitFor(async () => (await tool()) === 'razor', 'default B restored');
    results.checks.defaultBTool = await tool();
    await ev("(() => { void window.__shortcutsL1.reg.executeCommand('akari.settings.open', 'shortcuts'); return true; })()");
    await waitFor(() => ev('document.querySelectorAll("[data-shortcuts-row]").length'), 'shortcut rows after reset');
    await domClick('[data-shortcuts-open-json]');
    await sleep(1000);
    results.checks.jsonOpenError = await ev('document.querySelector(".akari-set-notice")?.textContent ?? ""');
    assert.equal(results.checks.jsonOpenError, '');
    results.checks.jsonPath = path.join(config, 'keymaps.json');
    await writeFile(path.join(here, 'l1-results.json'), JSON.stringify(results, null, 2) + '\n');
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} catch (error) {
    process.stderr.write(`L1 failed: ${String(error)}\n${logs.slice(-5000)}\n`);
    throw error;
} finally {
    cdp?.close();
    if (child?.pid) { child.kill('SIGTERM'); await sleep(1500); }
    for (let attempt = 0; attempt < 6; attempt++) {
        try { await rm(temp, { recursive: true, force: true }); break; }
        catch (error) { if (attempt === 5) throw error; await sleep(500); }
    }
}
