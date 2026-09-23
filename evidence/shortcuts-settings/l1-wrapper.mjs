#!/usr/bin/env node
// L1（ラッパー検証）: 設定「ショートカット」の一覧・検索・絞り込み・チップ移動・押して変更・無効化・既定に戻す・JSON で開く を、
// 実機 Electron + CDP の実入力で測る。変更の効き目はタイムラインの分割ツール（akari.timeline.razorTool・既定 b / c）で確かめる。
// Usage: node evidence/shortcuts-settings/l1-wrapper.mjs   （apps/shell を npm run build 済みであること）
// - CDP ポート 9473 / 一時ディレクトリ /tmp/shortcuts-settings-l1/run-* / AKARI_HOME・user-data-dir・THEIA_CONFIG_DIR は専用
// - キー入力は CDP の Input.dispatchKeyEvent（rawKeyDown / keyUp）、クリックは Input.dispatchMouseEvent
// - 起動した Electron は自分の PID だけ止める
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, resizeViewport, screenshot } from '../../apps/shell/extensions/akari-annotations/evidence/caption-subrow-output-space/scripts/cdp-lib.mjs';
import { createFixture } from '../../apps/shell/extensions/akari-annotations/evidence/timeline-frame-tool/gen-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '../..');
const shell = path.join(worktree, 'apps/shell');
const PORT = 9473;
await mkdir('/tmp/shortcuts-settings-l1', { recursive: true });
const iso = await mkdtemp('/tmp/shortcuts-settings-l1/run-');
const project = path.join(iso, 'project');
const configDir = path.join(iso, 'config');
const keymapsPath = path.join(configDir, 'keymaps.json');
const editPath = path.join(project, 'edit.json');
const results = {};
let child; let cdp; let logs = ''; let exited;
const t0 = Date.now();
const log = m => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
const sanitize = v => String(v).split(iso).join('<TMP>').split(worktree).join('<WORKTREE>');
const ev = expression => Promise.race([evalOn(cdp, expression),
    sleep(30000).then(() => { throw new Error('eval timeout: ' + expression.slice(0, 80)); })]);
async function waitFor(read, label, timeout = 90000) {
    const deadline = Date.now() + timeout; let last;
    while (Date.now() < deadline) {
        try { last = await read(); if (last) return last; } catch (e) { last = e.message; }
        await sleep(250);
    }
    throw new Error(`${label}: ${String(last)}`);
}
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function key(k, code, vk, modifiers = 0) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    if (k.length === 1 && !(modifiers & (MOD.meta | MOD.ctrl | MOD.alt))) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: k, text: k, unmodifiedText: k, modifiers });
    }
    await sleep(30);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(400);
}
const ESC = () => key('Escape', 'Escape', 27);
// macOS の ⌥⇧B は event.key が「ı」になる（実機と同じ key を送り、code は KeyB）
const ALT_SHIFT_B = () => key('ı', 'KeyB', 66, MOD.alt | MOD.shift);
const B = () => key('b', 'KeyB', 66);
const C = () => key('c', 'KeyC', 67);
const V = () => key('v', 'KeyV', 86);
const shot = async name => { await screenshot(cdp, path.join(here, name)); return name; };
const keymaps = async () => { try { return JSON.parse(await readFile(keymapsPath, 'utf8')); } catch (e) { return `<${e.code ?? e.message}>`; } };
const row = id => `[data-shortcuts-row="${id}"]`;
const RAZOR = 'akari.timeline.razorTool';

async function center(selector) {
    return waitFor(() => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.bottom > innerHeight) return null;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`),
        `element ${selector}`, 30000);
}
async function click(selector) { const p = await center(selector); await realClick(cdp, p.x, p.y); await sleep(400); return p; }
const tool = () => ev('window.__ss.tl.toolMode');
const visibleRows = () => ev('[...document.querySelectorAll("[data-shortcuts-row]")].map(n => n.getAttribute("data-shortcuts-row"))');
async function typeSearch(text) {
    const p = await center('[data-shortcuts-search]');
    await realClick(cdp, p.x, p.y, { clickCount: 3 });
    await key('Backspace', 'Backspace', 8);
    if (text) { await cdp.send('Input.insertText', { text }); }
    await sleep(600);
    return ev('document.querySelector("[data-shortcuts-search]").value');
}
async function openShortcuts() {
    await ev(`(() => { void window.__ss.reg.executeCommand('akari.settings.open', 'shortcuts'); return true; })()`);
    await waitFor(() => ev('document.querySelectorAll("[data-akari-settings-section=shortcuts]:not([hidden]) [data-shortcuts-row]").length'), 'shortcut rows', 60000);
    await sleep(500);
}
async function closeSettings() {
    await ESC();
    await waitFor(() => ev('!document.querySelector("[data-akari-settings-section=shortcuts]")'), 'settings closed', 15000);
}
async function focusTimeline() {
    await ev(`(async () => { await window.__ss.sh.activateWidget(window.__ss.tl.id); return true; })()`);
    const sel = '.akari-annotations-strip [data-akari-ui="timeline:cut:0"]';
    await center(sel);
    const p = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.35), y: Math.round(r.top + r.height / 2) }; })()`);
    await realClick(cdp, p.x, p.y);
    await sleep(500);
}
/** タイムラインにフォーカスを置き、V で select に戻してから press を押し、ツールを読む。 */
async function tryKey(label, press) {
    await focusTimeline();
    await V();
    const before = await tool();
    await press();
    await sleep(300);
    return { key: label, before, after: await tool() };
}
async function menuAction(id, action) {
    await click(`${row(id)} [data-shortcuts-menu]`);
    await click(`${row(id)} [data-shortcuts-action="${action}"]`);
}

try {
    // ---------------------------------------------------------------- fixture
    const fixture = await createFixture(project);
    await writeFile(editPath, JSON.stringify(fixture, null, 2) + '\n');
    await mkdir(path.join(iso, 'home'));
    await mkdir(configDir, { recursive: true }); // keymaps.json は置かない（JSON で開く が作ることも確かめる）

    // ---------------------------------------------------------------- boot
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(iso, 'userdata')}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: configDir, AKARI_HOME: path.join(iso, 'home'),
            FAL_KEY: '', FAL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', c => { logs += c; });
    child.stderr.on('data', c => { logs += c; });
    child.once('exit', (code, signal) => { exited = { code, signal }; });
    log(`electron pid ${child.pid}`);
    results.electronPid = child.pid;
    const target = await waitFor(async () => (await listTargets(PORT)).find(t => t.type === 'page'), 'page', 480000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await resizeViewport(cdp, 1600, 1000);
    await waitFor(() => ev('!!window.theia?.container && !!document.getElementById("theia-app-shell")'), 'shell', 480000);
    await waitFor(() => ev(`(() => {
        const c = window.theia.container;
        const keys = [...c._bindingDictionary._map.keys()];
        const k = keys.find(key => typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
        const reg = k && c.get(k);
        if (!reg?.getCommand('akari.annotations.open') || !reg.getCommand('akari.settings.open')) return false;
        const kk = keys.find(key => typeof key === 'function' && key.prototype?.getKeybindingsForCommand && key.prototype?.registerKeybinding);
        const sc = keys.find(key => typeof key === 'function' && key.prototype?.openSettings && key.prototype?.registerCommands);
        window.__ss = { reg, kb: kk && c.get(kk), settingsContribution: sc && c.getAll(sc)[0], opened: [] };
        return !!window.__ss.kb && !!window.__ss.settingsContribution; })()`), 'registries', 240000);
    await waitFor(() => ev('!document.querySelector(".theia-preload")'), 'preload cleared', 240000);
    await ev(`(() => { for (const d of document.querySelectorAll('.dialogBlock')) [...d.querySelectorAll('button')]
        .find(b => /キャンセル|閉じる|Cancel|Close/.test(b.textContent))?.click(); return true; })()`);
    const editUri = pathToFileURL(editPath).toString();
    await ev(`(() => { const r = window.__ss.reg; void r.executeCommand('akari.annotations.open');
        void r.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} }); return true; })()`);
    await waitFor(() => ev('!!document.querySelector(\'.akari-annotations-strip [data-akari-ui="timeline:cut:0"]\')'), 'timeline chips', 120000);
    await ev(`(() => {
        const c = window.theia.container;
        const k = [...c._bindingDictionary._map.keys()].find(key => typeof key === 'function'
            && key.prototype?.getCurrentWidget && key.prototype?.addWidget && key.prototype?.activateWidget);
        const sh = c.get(k);
        const tl = sh.widgets.find(w => w.node?.classList.contains('akari-annotations-widget'));
        Object.assign(window.__ss, { sh, tl });
        return !!tl; })()`);
    await sleep(3000);
    log('booted');

    // 既定キーの確認（変更前）
    results.beforeChange = { b: await tryKey('b', B), c: await tryKey('c', C), altShiftB: await tryKey('⌥⇧B', ALT_SHIFT_B) };
    assert.equal(results.beforeChange.b.after, 'razor');
    assert.equal(results.beforeChange.altShiftB.after, 'select');

    // ---------------------------------------------------------------- 1. 一覧（ダーク）
    await openShortcuts();
    results.theme = { dark: await ev(`document.body.classList.contains('theia-dark') ? 'dark' : document.body.className`) };
    results.list = await ev(`(() => {
        const section = document.querySelector('[data-akari-settings-section=shortcuts]');
        const groups = [...section.querySelectorAll('[data-shortcuts-group]')].map(h => ({ id: h.getAttribute('data-shortcuts-group'),
            heading: h.textContent.trim(), rows: h.nextElementSibling.querySelectorAll('[data-shortcuts-row]').length }));
        const chips = [...section.querySelectorAll('[data-shortcuts-jump]')].map(b => b.textContent.trim());
        const razor = section.querySelector('[data-shortcuts-row="akari.timeline.razorTool"]');
        const rawButtons = [...section.querySelectorAll('button')].filter(b => !b.className).length;
        return { total: section.querySelectorAll('[data-shortcuts-row]').length, groups, chips, rawButtons,
            razorRow: razor ? razor.innerText.replace(/\\s+/g, ' ').trim() : null,
            firstRows: [...section.querySelectorAll('[data-shortcuts-row]')].slice(0, 5).map(n => n.innerText.replace(/\\s+/g, ' ').trim()) };
    })()`);
    assert.ok(results.list.groups.length >= 6, 'groups');
    assert.equal(results.list.rawButtons, 0, 'unstyled raw buttons');
    // 表記の確認（モックの KEYS と比べる行）: 条件の列・キーの箱・並び
    results.rowText = await ev(`(() => { const ids = ['akari.timeline.undo', 'akari.timeline.moveTrackUp', 'akari.timeline.moveTrackDown',
        'akari.timeline.selectParent', 'akari.timeline.selectChild', 'akari.timeline.delete', 'akari.timeline.clearSelection',
        'akari.timeline.togglePlayback', 'akari.inspector.clearSolo', 'akari.daihon.selectAllRows'];
        const out = {}; for (const id of ids) { const n = document.querySelector('[data-shortcuts-row="' + id + '"]');
            out[id] = n ? { text: n.innerText.replace(/\\s+/g, ' ').trim(), keys: [...n.querySelectorAll('[data-shortcuts-key]')].map(k => k.getAttribute('aria-label')) } : null; }
        const editing = document.querySelector('[data-shortcuts-group=editing]').nextElementSibling;
        out.editingOrder = [...editing.querySelectorAll('[data-shortcuts-row]')].slice(0, 8).map(n => n.querySelector('span')?.textContent);
        return out; })()`);
    await shot('wrapper-01-dark.png');

    // ---------------------------------------------------------------- 2. 検索
    results.search = {};
    for (const q of ['⌘B', '文字']) {
        const value = await typeSearch(q);
        const rows = await visibleRows();
        results.search[q] = { value, count: rows.length, rows: rows.slice(0, 12) };
    }
    assert.ok(results.search['⌘B'].rows.includes(RAZOR), '⌘B finds razor');
    assert.ok(results.search['文字'].rows.includes('akari.caption.placeText'), '文字 finds placeText');
    await typeSearch('⌘B');
    await shot('wrapper-02-search-cmd-b.png');
    await typeSearch('');

    // ---------------------------------------------------------------- 3. 絞り込み（変更前）
    const countFilters = async () => {
        const out = {};
        for (const f of ['all', 'modified', 'unassigned', 'conflicts']) {
            await click(`[data-shortcuts-filter="${f}"]`);
            out[f] = { count: (await visibleRows()).length, sample: (await visibleRows()).slice(0, 6) };
        }
        await click('[data-shortcuts-filter="all"]');
        return out;
    };
    results.filtersBefore = await countFilters();
    assert.equal(results.filtersBefore.modified.count, 0);
    assert.ok(results.filtersBefore.conflicts.count >= 2, 'conflicts');
    await click('[data-shortcuts-filter="conflicts"]');
    await shot('wrapper-03-filter-conflicts.png');
    await click('[data-shortcuts-filter="all"]');

    // ---------------------------------------------------------------- 4. チップで移動
    results.jump = {};
    for (const g of ['script', 'panels', 'editing']) {
        const before = await ev(`document.querySelector('[data-shortcuts-group=${g}]').getBoundingClientRect().top`);
        await click(`[data-shortcuts-jump="${g}"]`);
        await sleep(900);
        const bar = await ev(`(() => { const b = document.querySelector('[data-shortcuts-jump]').closest('[class*=bar]') ?? document.querySelector('[data-shortcuts-jump]').parentElement; return b.getBoundingClientRect().bottom; })()`);
        const after = await ev(`document.querySelector('[data-shortcuts-group=${g}]').getBoundingClientRect().top`);
        results.jump[g] = { headingTopBefore: Math.round(before), headingTopAfter: Math.round(after), stickyBarBottom: Math.round(bar) };
    }
    assert.notEqual(results.jump.script.headingTopBefore, results.jump.script.headingTopAfter);

    // ---------------------------------------------------------------- 5. 押して変更（Esc で取消 → ⌥⇧B で確定）
    const bKey = `${row(RAZOR)} [data-shortcuts-key]`;
    const razorKeys = await ev(`[...document.querySelectorAll(${JSON.stringify(bKey)})].map(n => n.innerText.replace(/\\s+/g, ' ').trim())`);
    results.record = { razorKeysBefore: razorKeys };
    await click(`${row(RAZOR)} [data-shortcuts-key]:first-of-type`);
    results.record.recordingShown = await ev(`(() => { const n = document.querySelector('[data-recording="true"]'); return n ? n.innerText.trim() : null; })()`);
    await shot('wrapper-04-recording.png');
    await ESC();
    results.record.afterEsc = { recording: await ev('!!document.querySelector("[data-recording=true]")'), dialogOpen: await ev('!!document.querySelector("[data-akari-settings-section=shortcuts]")'), keymaps: await keymaps() };
    assert.equal(results.record.afterEsc.recording, false);
    assert.equal(results.record.afterEsc.dialogOpen, true, 'Esc during recording must not close the dialog');
    // 既定キー b の箱（c の箱は残す）を選んで押す
    results.record.targetKeyLabel = await ev(`(() => { const n = [...document.querySelectorAll(${JSON.stringify(bKey)})]
        .find(k => k.innerText.trim() === 'B'); n.setAttribute('data-l1-target', ''); return n.getAttribute('aria-label'); })()`);
    await click('[data-l1-target]');
    await ALT_SHIFT_B();
    await waitFor(async () => { const k = await keymaps(); return Array.isArray(k) && k.some(e => e.command === RAZOR); }, 'keymaps.json written', 20000);
    await waitFor(() => ev(`window.__ss.kb.getKeybindingsForCommand(${JSON.stringify(RAZOR)}).length > 0 && !window.__ss.kb.getKeybindingsForCommand(${JSON.stringify(RAZOR)}).some(b => b.keybinding === 'b')`), 'registry updated', 20000);
    results.record.keymapsAfter = await keymaps();
    results.record.registryAfter = await ev(`window.__ss.kb.getKeybindingsForCommand(${JSON.stringify(RAZOR)}).map(b => ({ keybinding: b.keybinding, scope: b.scope, accelerator: window.__ss.kb.acceleratorFor(b, '').join(' ') }))`);
    await sleep(600);
    results.record.razorRowAfter = await ev(`document.querySelector(${JSON.stringify(row(RAZOR))})?.innerText.replace(/\\s+/g, ' ').trim()`);
    results.filtersAfterChange = await countFilters();
    await shot('wrapper-05-after-change.png');
    // 重なり: 既に使われているキー（⌘G = まとめる）へ変えると印が出る
    await closeSettings();
    results.record.afterChange = { b: await tryKey('b', B), c: await tryKey('c', C), altShiftB: await tryKey('⌥⇧B', ALT_SHIFT_B) };
    assert.equal(results.record.afterChange.altShiftB.after, 'razor', 'new key works');
    assert.equal(results.record.afterChange.b.after, 'select', 'old key b no longer works');
    assert.equal(results.record.afterChange.c.after, 'razor', 'c remains');

    // ---------------------------------------------------------------- 6. 重なりの印（既に使われているキーへ）
    await openShortcuts();
    await click(`${row('akari.timeline.frameTool')} [data-shortcuts-key]`);
    await key('v', 'KeyV', 86); // v = 選択ツール（同じ when）
    await waitFor(async () => { const k = await keymaps(); return Array.isArray(k) && k.some(e => e.command === 'akari.timeline.frameTool'); }, 'frameTool written', 20000);
    await sleep(1000);
    results.conflictMark = await ev(`(() => { const f = document.querySelector('[data-shortcuts-row="akari.timeline.frameTool"]');
        const s = document.querySelector('[data-shortcuts-row="akari.timeline.selectTool"]');
        return { frameRow: f?.innerText.replace(/\\s+/g, ' ').trim(), frameConflict: !!f?.querySelector('[data-shortcuts-conflict]'),
            selectConflict: !!s?.querySelector('[data-shortcuts-conflict]') }; })()`);
    assert.equal(results.conflictMark.frameConflict, true);
    await click('[data-shortcuts-filter="conflicts"]');
    results.conflictMark.conflictRows = await visibleRows();
    await click('[data-shortcuts-filter="all"]');
    await menuAction('akari.timeline.frameTool', 'reset');
    await waitFor(async () => { const k = await keymaps(); return Array.isArray(k) && !k.some(e => e.command.replace(/^-/, '') === 'akari.timeline.frameTool'); }, 'frameTool reset', 20000);

    // ---------------------------------------------------------------- 7. 無効にする
    await sleep(600);
    await menuAction(RAZOR, 'disable');
    await waitFor(() => ev(`window.__ss.kb.getKeybindingsForCommand(${JSON.stringify(RAZOR)}).length === 0`), 'disabled in registry', 20000);
    results.disable = { keymaps: await keymaps() };
    await sleep(600);
    results.disable.row = await ev(`document.querySelector(${JSON.stringify(row(RAZOR))})?.innerText.replace(/\\s+/g, ' ').trim()`);
    await click('[data-shortcuts-filter="unassigned"]');
    results.disable.inUnassigned = (await visibleRows()).includes(RAZOR);
    await click('[data-shortcuts-filter="all"]');
    await closeSettings();
    results.disable.keys = { b: await tryKey('b', B), c: await tryKey('c', C), altShiftB: await tryKey('⌥⇧B', ALT_SHIFT_B) };
    for (const k of Object.values(results.disable.keys)) assert.equal(k.after, 'select', 'disabled key does nothing: ' + k.key);

    // ---------------------------------------------------------------- 8. 既定に戻す
    await openShortcuts();
    await menuAction(RAZOR, 'reset');
    await waitFor(() => ev(`window.__ss.kb.getKeybindingsForCommand(${JSON.stringify(RAZOR)}).some(b => b.keybinding === 'b')`), 'reset in registry', 20000);
    results.reset = { keymaps: await keymaps() };
    await closeSettings();
    results.reset.keys = { b: await tryKey('b', B), c: await tryKey('c', C), altShiftB: await tryKey('⌥⇧B', ALT_SHIFT_B) };
    assert.equal(results.reset.keys.b.after, 'razor');
    assert.equal(results.reset.keys.c.after, 'razor');
    assert.equal(results.reset.keys.altShiftB.after, 'select');

    // ---------------------------------------------------------------- 9. JSON で開く（無ければ作る → OS の既定アプリ）
    await rm(keymapsPath, { force: true });
    await openShortcuts();
    // 画面が持つ maintenance（RPC プロキシ）の前に記録用の薄い層を挟む。呼び出しはそのまま本物の openPath（OS の open）へ渡す
    await ev(`(() => { const view = window.__ss.settingsContribution.dialog.shortcutsView; const m = view.maintenance;
        view.maintenance = { openPath: p => { const rec = { path: p, result: 'pending' }; window.__ss.opened.push(rec);
            return m.openPath(p).then(v => { rec.result = 'resolved'; return v; }, e => { rec.result = 'rejected: ' + e; throw e; }); } };
        return true; })()`);
    await click('[data-shortcuts-open-json]');
    await waitFor(() => ev(`window.__ss.opened.length && window.__ss.opened[0].result !== 'pending'`), 'openPath settled', 30000)
        .catch(async e => { results.openJsonDiag = { notice: await ev('document.querySelector(".akari-set-notice")?.textContent ?? ""'), exists: !!(await stat(keymapsPath).catch(() => null)) }; throw e; });
    const opened = await ev('window.__ss.opened');
    const st = await stat(keymapsPath).catch(() => null);
    results.openJson = { calls: opened, expectedPath: keymapsPath, created: !!st, content: st ? await readFile(keymapsPath, 'utf8') : null,
        notice: await ev('document.querySelector(".akari-set-notice")?.textContent ?? ""') };
    assert.equal(opened[0].path, keymapsPath);
    assert.equal(opened[0].result, 'resolved');

    // ---------------------------------------------------------------- 10. ライト
    await ev('document.querySelector("[data-settings-nav=appearance]").click()');
    await waitFor(() => ev('!!document.querySelector("[data-akari-settings-section=appearance] button.akari-set-card")'), 'appearance');
    await ev(`(() => { [...document.querySelectorAll('[data-akari-settings-section=appearance] button.akari-set-card')]
        .find(b => b.textContent.includes('ライト'))?.click(); return true; })()`);
    await waitFor(() => ev("document.body.classList.contains('theia-light')"), 'light theme', 20000);
    await ev('document.querySelector("[data-settings-nav=shortcuts]").click()');
    await sleep(800);
    results.theme.light = await ev(`document.body.classList.contains('theia-light') ? 'light' : document.body.className`);
    await shot('wrapper-06-light.png');
    await click(`${row(RAZOR)} [data-shortcuts-key]:first-of-type`);
    await shot('wrapper-07-light-recording.png');
    await ESC();
    results.pass = true;
} catch (error) {
    results.pass = false;
    results.error = sanitize(error?.stack ?? error);
    process.exitCode = 1;
    try { await shot('wrapper-zz-failure.png'); } catch { /* ignore */ }
} finally {
    try { cdp?.close(); } catch { /* ignore */ }
    if (child && !exited) {
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
        for (let i = 0; i < 30 && !exited; i++) await sleep(500);
        if (!exited) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } await sleep(1000); }
    }
    const left = execFileSync('/bin/ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter(l => l.includes(iso));
    results.orphans = left.length;
    await writeFile(path.join(here, 'l1-wrapper-results.json'), sanitize(JSON.stringify(results, null, 2)) + '\n');
    if (!results.pass) process.stderr.write(sanitize(logs.slice(-4000)) + '\n');
    await rm(iso, { recursive: true, force: true }).catch(() => {});
    console.log(JSON.stringify({ pass: results.pass, orphans: results.orphans, error: results.error?.split('\n')[0] }));
}
