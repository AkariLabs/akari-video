#!/usr/bin/env node
// L1（ラッパー検証）: キー割り当ての登録（keymaps 画面・ヘルプ・keymaps.json 上書き）と、
// 既定キーの挙動・key-hygiene の取り合い 5 件の回帰なしを、実機 Electron + CDP の実入力で測る。
// Usage: node l1-wrapper.mjs   （apps/shell を npm run build 済みであること）
// - CDP ポート 9472 / 一時ディレクトリ /tmp/keybinding-registry-l1/run-* / AKARI_HOME・user-data-dir・THEIA_CONFIG_DIR は専用
// - キー入力はすべて CDP の Input.dispatchKeyEvent（rawKeyDown / keyUp）。クリックは Input.dispatchMouseEvent
// - 起動した Electron は自分の PID だけ止める
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, resizeViewport, screenshot } from '../caption-subrow-output-space/scripts/cdp-lib.mjs';
import { createFixture } from '../timeline-frame-tool/gen-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '../../../..');
const worktree = path.resolve(shell, '../..');
const PORT = 9472;
const OVERRIDE = { command: 'akari.timeline.toggleSnap', keybinding: 'ctrl+shift+alt+9' };
await mkdir('/tmp/keybinding-registry-l1', { recursive: true });
const iso = await mkdtemp('/tmp/keybinding-registry-l1/run-');
const project = path.join(iso, 'project');
const configDir = path.join(iso, 'config');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const results = {};
let child; let cdp; let logs = ''; let exited;
const t0 = Date.now();
const log = m => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);
const sanitize = v => String(v).split(iso).join('<TMP>').split(worktree).join('<WORKTREE>');

const ev = expression => Promise.race([evalOn(cdp, expression),
    sleep(20000).then(() => { throw new Error('eval timeout: ' + expression.slice(0, 80)); })]);
async function waitFor(read, label, timeout = 90000) {
    const deadline = Date.now() + timeout; let last;
    while (Date.now() < deadline) {
        try { last = await read(); if (last) return last; } catch (e) { last = e.message; }
        await sleep(250);
    }
    throw new Error(`${label}: ${String(last)}`);
}
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function key(k, code, vk, modifiers = 0, extra = {}) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...extra });
    if (k.length === 1 && !(modifiers & (MOD.meta | MOD.ctrl))) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: k, text: k, unmodifiedText: k, modifiers });
    }
    await sleep(30);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(400);
}
const letter = (ch, modifiers = 0, extra = {}) => key(ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), modifiers, extra);
const SPACE = () => key(' ', 'Space', 32);
const ESC = () => key('Escape', 'Escape', 27);
const DEL = () => key('Delete', 'Delete', 46);
const RIGHT = (m = 0) => key('ArrowRight', 'ArrowRight', 39, m);
const LEFT = (m = 0) => key('ArrowLeft', 'ArrowLeft', 37, m);
const shot = async name => { await screenshot(cdp, path.join(here, name)); return name; };
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const videoItems = async () => (await edit()).tracks.find(t => t.id === 'video')?.items ?? [];
const clipCount = async () => (await videoItems()).length;
const captionCount = async () => (JSON.parse(await readFile(captionsPath, 'utf8'))).captions.length;
const trackOf = async id => (await edit()).tracks.find(t => (t.items ?? []).some(i => i.id === id))?.id ?? null;
const state = () => ev(`({ playing: window.__kh.tl.visualPlaying, toggles: window.__kh.toggles,
    copies: window.__kh.copies, selection: window.__kh.tl.selection ? JSON.stringify(window.__kh.tl.selection) : null,
    multi: window.__kh.tl.multiSelection.length, tool: window.__kh.tl.toolMode, snap: window.__kh.tl.snapEnabled,
    playheadT: window.__kh.tl.playheadT,
    active: (() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ').slice(0, 2).join('.') : '') : null; })() })`);

async function center(selector) {
    return waitFor(() => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`),
        `element ${selector}`, 30000);
}
/** タイムラインのチップを実クリックで選ぶ（フォーカスもタイムラインへ入る）。 */
async function clickChip(id, modifiers = 0) {
    const index = id === 'left' ? 0 : 1;
    // 中央は再生ヘッドの線と重なることがあるので、チップの 80% の位置を押す
    const sel = `.akari-annotations-strip [data-akari-ui="timeline:cut:${index}"]`;
    await center(sel);
    const p = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.8), y: Math.round(r.top + r.height / 2) }; })()`);
    await realClick(cdp, p.x, p.y, modifiers ? { modifiers } : {});
    await sleep(500);
    return p;
}
async function focusTimeline() {
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.tl.id); return true; })()`);
    await clickChip('left');
}
async function setPlaying(target) {
    for (let i = 0; i < 3 && (await state()).playing !== target; i++) {
        await ev('window.__kh.tl.node.focus()');
        await SPACE();
        await waitFor(async () => (await state()).playing === target || null, 'playing=' + target, 8000).catch(() => null);
    }
}

try {
    // ---------------------------------------------------------------- fixture
    const fixture = await createFixture(project);
    const tone = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
        'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', path.join(project, 'assets/tone.wav')]);
    assert.equal(tone.status, 0);
    fixture.sources.push({ id: 'tone', path: 'assets/tone.wav' });
    fixture.tracks.push({ id: 'audio', lane: 'audio', items: [{ id: 'sfx-1', at: 30, duration: 60, role: 'sfx',
        source: { kind: 'media', src: 'tone', in: 0, out: 2 } }] });
    // ] / [ の移動先になる 2 本目の映像トラック（空）
    fixture.tracks.push({ id: 'upper', lane: 'visual', name: '上の段', items: [] });
    fixture.tracks.push({ id: 'captions', lane: 'visual', content: { from: 'captions.json' } });
    await writeFile(editPath, JSON.stringify(fixture, null, 2) + '\n');
    await writeFile(captionsPath, JSON.stringify({ emphasis_words: [], captions: [
        { id: 'c-0001', start: 0, end: 1, text: '台本の一行目', speaker: null, sourceRef: { segment: 0 }, edited: false },
        { id: 'c-0002', start: 1.2, end: 2, text: '台本の二行目', speaker: null, sourceRef: { segment: 1 }, edited: false }
    ] }, null, 2) + '\n');
    await mkdir(path.join(iso, 'home'));
    // keymaps.json の上書き（THEIA_CONFIG_DIR/keymaps.json）
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'keymaps.json'), JSON.stringify([OVERRIDE], null, 2) + '\n');

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
    const target = await waitFor(async () => (await listTargets(PORT)).find(t => t.type === 'page'), 'page', 120000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await resizeViewport(cdp, 1600, 1000);
    await waitFor(() => ev('!!window.theia?.container && !!document.getElementById("theia-app-shell")'), 'shell', 120000);
    const editUri = pathToFileURL(editPath).toString();
    await waitFor(() => ev(`(() => {
        const c = window.theia.container;
        const keys = [...c._bindingDictionary._map.keys()];
        const k = keys.find(key => typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
        const reg = k && c.get(k);
        if (!reg?.getCommand('akari.annotations.open')) return false;
        const kk = keys.find(key => typeof key === 'function' && key.prototype?.getKeybindingsForCommand && key.prototype?.registerKeybinding);
        const kb = kk && c.get(kk);
        if (!kb) return false;
        window.__kh = { reg, kb, executed: [] };
        reg.onDidExecuteCommand(e => window.__kh.executed.push(e.commandId));
        return true; })()`), 'command registry', 120000);
    await ev(`(() => { for (const d of document.querySelectorAll('.dialogBlock')) [...d.querySelectorAll('button')]
        .find(b => /キャンセル|閉じる|Cancel|Close/.test(b.textContent))?.click(); return true; })()`);
    await ev(`(() => { const r = window.__kh.reg; void r.executeCommand('akari.annotations.open');
        void r.executeCommand('akari.partner.open'); void r.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} }); return true; })()`);
    await waitFor(() => ev('!!document.querySelector(\'.akari-annotations-strip [data-akari-ui="timeline:cut:0"]\')'), 'timeline chips', 120000);
    await ev(`(() => {
        const c = window.theia.container;
        const k = [...c._bindingDictionary._map.keys()].find(key => typeof key === 'function'
            && key.prototype?.getCurrentWidget && key.prototype?.addWidget && key.prototype?.activateWidget);
        const sh = c.get(k);
        const tl = sh.widgets.find(w => w.node?.classList.contains('akari-annotations-widget'));
        const partner = sh.widgets.find(w => typeof w.renderChat === 'function');
        Object.assign(window.__kh, { sh, tl, partner, toggles: 0, copies: 0 });
        const toggle = tl.togglePreviewPlayback.bind(tl);
        tl.togglePreviewPlayback = () => { window.__kh.toggles++; toggle(); };
        const copy = tl.copySelectedItem.bind(tl);
        tl.copySelectedItem = (...a) => { window.__kh.copies++; return copy(...a); };
        sh.activateWidget(tl.id);
        return true; })()`);
    await waitFor(() => ev('!!document.querySelector("iframe")'), 'preview iframe', 60000).catch(() => null);
    await sleep(4000);
    await shot('l1-00-boot.png');
    log('booted');

    // ---------------------------------------------------------------- A. 登録の一覧（KeybindingRegistry と keymaps:open 画面）
    results.registry = await ev(`(() => {
        const { reg, kb } = window.__kh;
        const cmds = reg.commands.filter(c => /^akari\\.(timeline|daihon|inspector|caption)\\./.test(c.id));
        const rows = [];
        for (const c of cmds) for (const b of kb.getKeybindingsForCommand(c.id)) {
            rows.push({ id: c.id, label: c.label ?? null, category: c.category ?? null,
                keybinding: b.keybinding, accelerator: kb.acceleratorFor(b, '+').join(' '), when: b.when ?? null, scope: b.scope });
        }
        return { commandsWithKeys: [...new Set(rows.map(r => r.id))].length, bindings: rows.length, rows };
    })()`);
    await ev(`(() => { void window.__kh.reg.executeCommand('keymaps:open'); return true; })()`);
    await waitFor(() => ev(`!!document.querySelector('#kb-table-container')`), 'keymaps widget', 30000);
    await sleep(800);
    results.keymapsWidget = await ev(`(() => {
        const w = window.__kh.sh.widgets.find(x => x.id === 'keybindings.view.widget');
        const items = (w?.items ?? []).filter(i => /^akari\\.(timeline|daihon|inspector|caption)\\./.test(i.command.id) && i.keybinding);
        return { title: w?.title.label, akariRows: items.length,
            akariCommands: new Set(items.map(i => i.command.id)).size,
            japaneseLabelRows: items.filter(i => /[\\u3040-\\u30ff\\u4e00-\\u9fff]/.test(i.labels.command.value)).length,
            sample: items.slice(0, 6).map(i => ({ id: i.command.id, label: i.labels.command.value, key: i.labels.keybinding.value, when: i.labels.context?.value ?? i.labels.when?.value })) };
    })()`);
    // 画面上の検索欄で「タイムライン」に絞る（実入力）
    const search = await center('#search-kb');
    await realClick(cdp, search.x, search.y);
    await cdp.send('Input.insertText', { text: 'タイムライン' });
    await key('n', 'KeyN', 78, 0, {}); // onKeyUp で絞り込みが走る。n は検索語を壊さないよう下で消す
    await key('Backspace', 'Backspace', 8);
    await sleep(800);
    results.keymapsWidget.visibleRowsForTimelineSearch = await ev(`document.querySelectorAll('#kb-table-container tbody tr').length`);
    await shot('l1-01-keymaps-open.png');
    assert.ok(results.keymapsWidget.akariCommands >= 30, 'too few AKARI commands in keymaps');
    assert.equal(results.keymapsWidget.japaneseLabelRows, results.keymapsWidget.akariRows, 'non-Japanese labels');
    await ev(`(() => { const w = window.__kh.sh.widgets.find(x => x.id === 'keybindings.view.widget'); w?.close(); return true; })()`);
    await sleep(500);

    // ---------------------------------------------------------------- B. ヘルプ表示 = 登録から生成
    results.help = await ev(`(() => {
        const { tl, kb, reg } = window.__kh;
        const help = tl.toolbar?.title ?? '';
        const lines = help.split('\\n');
        const missing = [];
        for (const c of reg.commands.filter(c => /^akari\\.(timeline|caption)\\./.test(c.id) && kb.getKeybindingsForCommand(c.id).length)) {
            if (c.category !== 'タイムライン' && c.category !== '再生') continue;
            const line = lines.find(l => l.endsWith(': ' + c.label));
            const keys = kb.getKeybindingsForCommand(c.id).map(b => kb.acceleratorFor(b, '+').join(' '));
            if (!line || !keys.every(k => line.includes(k))) missing.push({ id: c.id, label: c.label, keys, line: line ?? null });
        }
        return { lineCount: lines.length, missing, overrideLine: lines.find(l => l.includes('スナップ')) ?? null, text: help };
    })()`);
    assert.equal(results.help.missing.length, 0, 'help does not match registry');

    // ---------------------------------------------------------------- C. 既定キーの挙動（実入力）
    await setPlaying(false);
    await focusTimeline();
    const sp0 = await state();
    await SPACE();
    const sp1 = await waitFor(async () => { const s = await state(); return s.playing ? s : null; }, 'Space plays', 10000).catch(() => state());
    await SPACE();
    const sp2 = await waitFor(async () => { const s = await state(); return !s.playing ? s : null; }, 'Space stops', 10000).catch(() => state());
    results.space = { before: sp0.playing, afterFirst: sp1.playing, afterSecond: sp2.playing, toggles: [sp0.toggles, sp1.toggles, sp2.toggles] };
    assert.equal(sp1.playing, true); assert.equal(sp2.playing, false);

    await focusTimeline();
    // 再生を止めた直後の再生ヘッドはコマの途中にあり、シークでコマ境界へ寄る。1 回動かして境界にそろえてから測る
    await RIGHT(); await sleep(400);
    const a0 = await state();
    await RIGHT();
    const a1 = await state();
    await LEFT();
    const a2 = await state();
    await RIGHT(MOD.shift);
    const a3 = await state();
    await LEFT(MOD.shift);
    const a4 = await state();
    results.arrows = { before: a0.playheadT, afterRight: a1.playheadT, afterLeft: a2.playheadT, afterShiftRight: a3.playheadT, afterShiftLeft: a4.playheadT };
    assert.ok(Math.abs(a1.playheadT - a0.playheadT - 1 / 30) < 1e-6, '→ 1 frame');
    assert.ok(Math.abs(a2.playheadT - a0.playheadT) < 1e-6, '← 1 frame');
    assert.ok(Math.abs(a3.playheadT - a2.playheadT - 1) < 1e-6, '⇧→ 1 sec');

    const tools = {};
    for (const [ch, expected] of [['b', 'razor'], ['v', 'select'], ['f', 'frame'], ['c', 'razor'], ['a', 'select']]) {
        const before = (await state()).tool;
        await letter(ch);
        tools[ch.toUpperCase()] = { before, after: (await state()).tool };
        assert.equal(tools[ch.toUpperCase()].after, expected, ch + ' tool');
    }
    const n0 = (await state()).snap; await letter('n'); const n1 = (await state()).snap; await letter('m'); const n2 = (await state()).snap;
    results.tools = { ...tools, N: { before: n0, after: n1 }, M: { before: n1, after: n2 } };
    assert.equal(n1, !n0); assert.equal(n2, n0);

    await focusTimeline();
    const tc0 = await captionCount();
    await letter('t');
    await waitFor(async () => (await captionCount()) > tc0 || null, 'T places text', 15000);
    results.tKey = { captionsBefore: tc0, captionsAfter: await captionCount() };
    await ev('document.activeElement?.blur?.(); true');
    await sleep(500);

    // Esc
    await focusTimeline();
    const e0 = await state(); await ESC(); const e1 = await state();
    results.esc = { before: e0.selection, after: e1.selection };
    assert.ok(e0.selection && !e1.selection);

    // Delete + ⌘Z / ⇧⌘Z
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.tl.id); return true; })()`);
    await clickChip('right');
    const d0 = await clipCount(); await DEL();
    await waitFor(async () => (await clipCount()) < d0 || null, 'Delete', 10000);
    const d1 = await clipCount();
    await ev('window.__kh.tl.node.focus(); true');
    await letter('z', MOD.meta);
    await waitFor(async () => (await clipCount()) === d0 || null, 'undo', 10000);
    const d2 = await clipCount();
    await ev('window.__kh.executed = []; true');
    await letter('z', MOD.meta | MOD.shift);
    await waitFor(async () => (await clipCount()) === d1 || null, 'redo', 10000).catch(async error => {
        results.redoDebug = { executed: await ev('window.__kh.executed'), clips: await clipCount(),
            footer: await ev('window.__kh.tl.footer?.textContent'), active: (await state()).active };
        throw error;
    });
    const d3 = await clipCount();
    await letter('z', MOD.meta);
    await waitFor(async () => (await clipCount()) === d0 || null, 'undo 2', 10000);
    results.deleteUndoRedo = { before: d0, afterDelete: d1, afterUndo: d2, afterRedo: d3, afterUndoAgain: await clipCount() };

    // ⌘C / ⌘X / ⌘V
    await clickChip('right');
    const c0 = await state();
    await letter('c', MOD.meta, { commands: ['copy'] });
    const c1 = await state();
    const x0 = await clipCount();
    await letter('x', MOD.meta, { commands: ['cut'] });
    await waitFor(async () => (await clipCount()) < x0 || null, '⌘X', 10000);
    const x1 = await clipCount();
    await ev('window.__kh.tl.node.focus(); window.__kh.executed = []; true');
    await letter('v', MOD.meta, { commands: ['paste'] });
    await waitFor(async () => (await clipCount()) > x1 || null, '⌘V', 10000);
    const x2 = await clipCount();
    results.clipboard = { copiesBefore: c0.copies, copiesAfter: c1.copies, clipsBeforeCut: x0, afterCut: x1, afterPaste: x2,
        pasteCommandsExecuted: await ev('window.__kh.executed.filter(id => id.startsWith("akari."))'),
        videoItemsAfterPaste: (await videoItems()).map(i => ({ id: i.id, at: i.at, duration: i.duration })) };
    assert.equal(c1.copies, c0.copies + 1);
    // 状態を戻す（⌘Z × 2）
    await ev('window.__kh.tl.node.focus(); true');
    await letter('z', MOD.meta); await letter('z', MOD.meta);
    await waitFor(async () => (await clipCount()) === x0 || null, 'undo clipboard', 10000);

    // ] / [（トラック移動）
    await sleep(800);
    await clickChip('left');
    results.trackMoveSelectionAtStart = (await state()).selection;
    if (!results.trackMoveSelectionAtStart) {
        const p = await center('.akari-annotations-strip [data-akari-ui="timeline:cut:0"]');
        results.trackMoveHit = await ev(`(() => { const el = document.elementFromPoint(${p.x}, ${p.y});
            return { point: ${JSON.stringify(p)}, tag: el?.tagName, cls: String(el?.className).slice(0, 120), ui: el?.closest('[data-akari-ui]')?.getAttribute('data-akari-ui') ?? null,
                multi: window.__kh.tl.multiSelection.length, gap: !!window.__kh.tl.selectedGap }; })()`);
        await shot('l1-debug-track-move.png');
        await sleep(1000); await clickChip('left'); results.trackMoveSelectionRetry = (await state()).selection;
    }
    const tr0 = await trackOf('left');
    const trCount0 = (await edit()).tracks.length;
    await ev(`(() => { window.__kh.executed = []; window.__kh.bracketDebug = [];
        window.__kh.onBr = e => window.__kh.bracketDebug.push({ key: e.key, code: e.code, prevented: e.defaultPrevented });
        window.addEventListener('keydown', window.__kh.onBr); return true; })()`);
    // 実機のキーボードが送る物理コードは Theia のキーボード配列サービスが解決したものと同じ（この Mac は ']' = Backslash）
    const codeFor = cmd => ev(`(() => { const b = window.__kh.kb.getKeybindingsForCommand(${JSON.stringify(cmd)})[0];
        return window.__kh.kb.resolveKeybinding(b)[0].key; })()`);
    const upKey = await codeFor('akari.timeline.moveTrackUp');
    const downKey = await codeFor('akari.timeline.moveTrackDown');
    results.bracketPhysicalCodes = { ']': upKey.code, '[': downKey.code };
    await key(']', upKey.code, upKey.keyCode);
    const bracketDebug = await ev(`(() => { window.removeEventListener('keydown', window.__kh.onBr);
        const kb = window.__kh.kb; const b = kb.getKeybindingsForCommand('akari.timeline.moveTrackUp')[0];
        return { events: window.__kh.bracketDebug, executed: window.__kh.executed, selection: JSON.stringify(window.__kh.tl.selection),
            resolved: JSON.stringify(b?.resolved), footer: window.__kh.tl.footer?.textContent, active: document.activeElement?.className }; })()`);
    results.bracketDebug = bracketDebug;
    await waitFor(async () => (await trackOf('left')) !== tr0 || null, ']', 10000);
    const tr1 = await trackOf('left');
    const trCount1 = (await edit()).tracks.length;
    await sleep(800);
    const selAfterUp = (await state()).selection;
    // 移動後の選択は映像トラックの index（cut:0）のまま残る（既存挙動）。上の段へ移った left のチップには id 属性が無いので、
    // 選択だけ API（applySelection: layer）で left に合わせ、フォーカスをタイムラインへ置いてから [ を実入力する
    const moved = await ev(`(() => { const tl = window.__kh.tl; const row = tl.timelineTreeRows.find(r => r.id === 'left');
        if (row) tl.applySelection({ kind: 'item', id: row.id, itemKind: row.itemKind, parentId: row.parentId, trackId: row.trackId });
        tl.node.focus(); return { ui: 'applySelection(item:left)', row: row ? { itemKind: row.itemKind, trackId: row.trackId } : null }; })()`);
    await sleep(500);
    const selBeforeDown = (await state()).selection;
    await key('[', downKey.code, downKey.keyCode);
    await waitFor(async () => (await trackOf('left')) === tr0 || null, '[', 10000).catch(() => null);
    const tr2 = await trackOf('left');
    results.trackMove = { before: tr0, afterBracketRight: tr1, tracksBefore: trCount0, tracksAfterRight: trCount1, selectionAfterRight: selAfterUp, movedChip: moved.ui, selectionBeforeLeft: selBeforeDown, afterBracketLeft: tr2 };
    assert.equal(tr2, tr0, '[ did not move the item back');
    assert.notEqual(tr1, tr0, '] did not move the item');
    // 元に戻す
    await ev('window.__kh.tl.node.focus(); true');
    for (let i = 0; i < 2 && (await trackOf('left')) !== tr0; i++) await letter('z', MOD.meta);

    // ⌘G / ⇧⌘G
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.tl.id); return true; })()`);
    await sleep(500);
    const cleanCount = await clipCount();
    await clickChip('left');
    await clickChip('right', MOD.shift);
    const g0 = await state();
    await letter('g', MOD.meta);
    await waitFor(async () => (await clipCount()) < cleanCount || null, '⌘G', 10000);
    const groupItems = await videoItems();
    const group = groupItems.find(i => Array.isArray(i.items) || i.kind === 'group' || i.group);
    results.group = { multiSelectionBefore: g0.multi, itemsBefore: cleanCount, itemsAfter: groupItems.length,
        groupId: group?.id ?? null, groupChildren: group?.items?.length ?? null };
    // ばらす: グループを選んで ⇧⌘G
    if (group?.id) {
        await ev(`(() => { window.__kh.tl.applySelection({ kind: 'item', id: ${JSON.stringify(group.id)}, itemKind: 'group', parentId: null, trackId: 'video' }); window.__kh.tl.node.focus(); return true; })()`);
        await sleep(300);
        await letter('g', MOD.meta | MOD.shift);
        await waitFor(async () => (await clipCount()) === cleanCount || null, '⇧⌘G', 10000).catch(() => null);
        results.group.afterUngroup = await clipCount();
    }
    await ev('window.__kh.tl.node.focus(); true');
    for (let i = 0; i < 3 && (await clipCount()) !== cleanCount; i++) await letter('z', MOD.meta);
    results.group.restored = await clipCount();
    assert.equal(results.group.itemsAfter, cleanCount - 1, '⌘G did not group');

    // ---------------------------------------------------------------- C2. インスペクターの数値欄 ↑ / ⇧↑ / ⌥↑
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.tl.id); return true; })()`);
    await clickChip('left');
    await ev(`(() => { void window.__kh.reg.executeCommand('akari.inspector.open'); return true; })()`);
    const numSel = '.akari-inspector-widget .akari-inspector-number-input';
    const num = await waitFor(() => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(numSel)})]
        .find(e => e.getBoundingClientRect().width > 0 && !e.disabled && Number.isFinite(Number(e.value)));
        if (!el) return null; el.setAttribute('data-kbr-probe', '1'); el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
            label: el.getAttribute('aria-label') ?? el.closest('label')?.textContent?.trim()?.slice(0, 30) ?? null }; })()`), 'number field', 20000);
    // 確定で再描画されると入力欄が作り直されてフォーカスが外れる（既存挙動・フォーカス復元なし）ので、押す前に毎回実クリックで入れ直す
    const findNum = `[...document.querySelectorAll(${JSON.stringify(numSel)})].find(e => e.getBoundingClientRect().width > 0
        && (e.getAttribute('aria-label') ?? e.closest('label')?.textContent?.trim()?.slice(0, 30) ?? null) === ${JSON.stringify(num.label)})`;
    const numVal = () => ev(`Number((${findNum})?.value)`);
    const stepKey = async (k, code, vk, m = 0) => {
        const p = await ev(`(() => { const r = (${findNum}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        await realClick(cdp, p.x, p.y); await sleep(250);
        const focused = await ev(`document.activeElement === (${findNum})`);
        await key(k, code, vk, m); await sleep(600);
        return { focused, value: await numVal() };
    };
    const nv0 = await numVal();
    const nv1 = await stepKey('ArrowUp', 'ArrowUp', 38);
    const nv2 = await stepKey('ArrowUp', 'ArrowUp', 38, MOD.shift);
    const nv3 = await stepKey('ArrowDown', 'ArrowDown', 40, MOD.alt);
    const nv4 = await stepKey('ArrowDown', 'ArrowDown', 40, MOD.shift);
    results.numberField = { field: num.label, active: (await state()).active, before: nv0, afterUp: nv1, afterShiftUp: nv2, afterAltDown: nv3, afterShiftDown: nv4 };
    assert.ok(Number.isFinite(nv0));
    assert.ok(nv1.value > nv0 && nv2.value > nv1.value && nv3.value < nv2.value && nv4.value < nv3.value, 'number field steps');
    await ev('document.activeElement?.blur?.(); true');
    await sleep(500);

    // ---------------------------------------------------------------- D. プレビュー（webview）からの転送: ← → / Delete
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.tl.id); return true; })()`);
    await clickChip('right');
    const w0 = await state();
    const frameInfo = await ev(`(() => { const f = [...document.querySelectorAll('iframe')].find(f => f.getBoundingClientRect().width > 50);
        if (!f) return null; f.focus(); return { active: document.activeElement?.tagName, w: Math.round(f.getBoundingClientRect().width) }; })()`);
    await sleep(300);
    await RIGHT();
    const w1 = await state();
    const wd0 = await clipCount();
    await DEL();
    await waitFor(async () => (await clipCount()) < wd0 || null, 'webview Delete', 6000).catch(() => null);
    const wd1 = await clipCount();
    results.webviewForward = { frame: frameInfo, activeAtKey: w1.active, playheadBefore: w0.playheadT, playheadAfterRight: w1.playheadT,
        clipsBeforeDelete: wd0, clipsAfterDelete: wd1 };
    await ev('window.__kh.tl.node.focus(); true');
    if (wd1 < wd0) { await letter('z', MOD.meta); await waitFor(async () => (await clipCount()) === wd0 || null, 'undo webview delete', 10000); }

    // ---------------------------------------------------------------- E. keymaps.json の上書き（ctrl+shift+alt+9 → スナップ切替）
    await focusTimeline();
    const o0 = (await state()).snap;
    await key('9', 'Digit9', 57, MOD.ctrl | MOD.shift | MOD.alt);
    const o1 = (await state()).snap;
    results.keymapsOverride = { file: '<TMP>/config/keymaps.json', entry: OVERRIDE, snapBefore: o0, snapAfter: o1,
        userScopeBinding: await ev(`window.__kh.kb.getKeybindingsForCommand(${JSON.stringify(OVERRIDE.command)}).map(b => ({ keybinding: b.keybinding, scope: b.scope }))`) };
    assert.equal(o1, !o0, 'keymaps.json override did not toggle snap');
    await key('9', 'Digit9', 57, MOD.ctrl | MOD.shift | MOD.alt);

    // ---------------------------------------------------------------- F. key-hygiene の 5 件（再実測）
    // F1/F2 音声キーフレームのダイアログ: Space / Delete
    await setPlaying(false);
    await clickChip('left');
    results.audioDialog = { timelineSelection: (await state()).selection, clipsBefore: await clipCount() };
    await ev(`(() => {
        window.__kh.audioPlays = 0;
        const orig = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__kh.audioPlays++; window.__kh.lastAudio = this; return orig.call(this); };
        void window.__kh.tl.openAudioKeyframeEditor('sfx-1'); return true; })()`);
    await waitFor(() => ev('!!document.querySelector(".akari-audio-keyframe-dialog canvas")'), 'audio dialog');
    await sleep(800);
    const cv = await ev(`(() => { const r = document.querySelector('.akari-audio-keyframe-dialog canvas').getBoundingClientRect();
        return { x: Math.round(r.left + r.width * .55), y: Math.round(r.top + r.height * .6) }; })()`);
    await realClick(cdp, cv.x, cv.y);
    await sleep(500);
    const pointState = () => ev(`(() => { const d = document.querySelector('.akari-audio-keyframe-dialog');
        const del = d && [...d.querySelectorAll('button')].find(b => b.textContent === '選択点を削除');
        return { open: !!d, deleteEnabled: !!del && !del.disabled }; })()`);
    const s0 = await state();
    results.audioDialog.beforeSpace = { ...(await pointState()), previewPlaying: s0.playing, toggles: s0.toggles };
    await SPACE();
    await sleep(600);
    const s1 = await state();
    results.audioDialog.afterSpace = { previewPlaying: s1.playing, toggles: s1.toggles,
        dialogAudioPlays: await ev('window.__kh.audioPlays'), dialogAudioPaused: await ev('window.__kh.lastAudio ? window.__kh.lastAudio.paused : null') };
    await shot('l1-02-audio-dialog-space.png');
    assert.equal(s1.playing, s0.playing, 'Space in dialog changed preview playback');
    assert.equal(s1.toggles, s0.toggles, 'Space in dialog reached timeline');
    assert.equal(results.audioDialog.afterSpace.dialogAudioPlays, 1, 'dialog playback did not toggle');
    await DEL();
    await sleep(1500);
    results.audioDialog.afterDelete = { ...(await pointState()), clips: await clipCount() };
    assert.equal(results.audioDialog.afterDelete.deleteEnabled, false, 'dialog point not deleted');
    assert.equal(results.audioDialog.afterDelete.clips, results.audioDialog.clipsBefore, 'timeline clip deleted by dialog Delete');
    await ESC();
    await sleep(600);
    results.audioDialog.afterFirstEsc = await pointState();
    assert.equal(results.audioDialog.afterFirstEsc.open, false);

    // F3 ライブラリのカードで Space
    await setPlaying(false);
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-open-catalog]')?.click(); true`);
    await ev(`(async () => { const w = window.__kh.sh.widgets.find(w => w.id === 'akari-role-buckets-widget'); if (w) await window.__kh.sh.activateWidget(w.id); return true; })()`);
    await waitFor(() => ev('!!document.querySelector("#akari-role-buckets-widget [data-akari-library-category=transition]")'), 'library category');
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-library-category=transition]').click(); true`);
    await center('#akari-role-buckets-widget [data-akari-library-transition]');
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-library-transition]').focus(); true`);
    const l0 = await state();
    await SPACE();
    await sleep(800);
    const l1 = await state();
    results.libraryCard = { focused: l0.active, before: { playing: l0.playing, toggles: l0.toggles }, after: { playing: l1.playing, toggles: l1.toggles } };
    await shot('l1-03-library-card-space.png');
    assert.equal(l1.playing, l0.playing); assert.equal(l1.toggles, l0.toggles);

    // F4 台本の行を選んで Esc（1 回目で外れる）/ ⌘A（行をすべて選ぶ）
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await clickChip('left');
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-daihon-widget'); return true; })()`);
    await center('#akari-daihon-widget .akari-daihon-row');
    const row = await ev(`(() => { const r = document.querySelector('#akari-daihon-widget .akari-daihon-row').getBoundingClientRect();
        return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) }; })()`);
    await realClick(cdp, row.x, row.y, { modifiers: MOD.meta });
    await sleep(500);
    const rowSel = () => ev(`[...document.querySelectorAll('#akari-daihon-widget .akari-daihon-row.selected')].length`);
    const rowTotal = await ev(`document.querySelectorAll('#akari-daihon-widget .akari-daihon-row').length`);
    const f0 = { rowsSelected: await rowSel(), ...(await state()) };
    await ESC();
    const f1 = { rowsSelected: await rowSel(), ...(await state()) };
    await letter('a', MOD.meta);
    const f2 = { rowsSelected: await rowSel() };
    const toolBeforeV = (await state()).tool;
    await ESC();
    results.daihon = { rowTotal, before: f0.rowsSelected, afterFirstEsc: f1.rowsSelected, afterCmdA: f2.rowsSelected, active: f1.active,
        timelineSelectionBeforeEsc: f0.selection };
    await shot('l1-04-daihon-esc.png');
    assert.ok(f0.rowsSelected > 0); assert.equal(f1.rowsSelected, 0); assert.equal(f2.rowsSelected, rowTotal);
    // （参考）台本の行一覧にフォーカスがあるときの B（旧実装はタイムライン全域で効いた）
    await realClick(cdp, row.x, row.y, { modifiers: MOD.meta });
    await sleep(300);
    await ESC();
    await letter('b');
    results.daihon.bWithRowsFocus = { toolBefore: toolBeforeV, toolAfter: (await state()).tool, active: (await state()).active };
    assert.equal(results.daihon.bWithRowsFocus.toolAfter, 'razor', 'B with daihon focus must behave as before (tool → razor)');
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await focusTimeline(); await letter('v');

    // F5 パートナーの会話ログの ⌘C（ログに 1 件入れる）
    await ev(`(async () => { const p = window.__kh.partner; p.render = () => p.renderChat();
        p.channel = { send() {} }; p.update(); await window.__kh.sh.activateWidget(p.id); return true; })()`);
    const input = await center('input[aria-label="パートナーに話しかける"]');
    await realClick(cdp, input.x, input.y);
    await cdp.send('Input.insertText', { text: 'ログの文字列' });
    await key('Enter', 'Enter', 13, 0, { text: '\r' });
    await sleep(400);
    const lastMessage = await ev('window.__kh.partner.messages.at(-1)?.text ?? null');
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await clickChip('left');
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.partner.id); return true; })()`);
    const bubbleSel = `(() => [...window.__kh.partner.node.querySelectorAll('div')].find(n => n.textContent === ${JSON.stringify(lastMessage)} && n.children.length === 0))()`;
    const bubble = await waitFor(() => ev(`(() => { const b = ${bubbleSel}; if (!b) return null; const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`), 'bubble');
    await realClick(cdp, bubble.x, bubble.y, { clickCount: 3 });
    await sleep(300);
    execFileSync('/usr/bin/pbcopy', { input: 'KBR-SENTINEL' });
    const h0 = await state();
    const selected = await ev('window.getSelection().toString()');
    await letter('c', MOD.meta, { commands: ['copy'] });
    await sleep(500);
    const clipboardText = execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' });
    const h1 = await state();
    results.partnerCopy = { selected, clipboard: clipboardText, timelineSelection: h0.selection, timelineCopiesBefore: h0.copies, timelineCopiesAfter: h1.copies };
    assert.equal(clipboardText.trim(), selected.trim());
    assert.equal(h1.copies, h0.copies);
    await ev('window.getSelection().removeAllRanges(); true');

    // ---------------------------------------------------------------- G. タイムラインを閉じた状態で V / B / T
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await focusTimeline();
    const closedCaptions0 = await captionCount();
    const tool0 = (await state()).tool;
    await ev(`(() => { window.__kh.tl.close(); return true; })()`);
    await waitFor(() => ev('!window.__kh.tl.isAttached'), 'timeline closed', 10000);
    await ev(`(() => { window.__kh.executed = []; window.__kh.prevented = [];
        window.__kh.onBubble = e => window.__kh.prevented.push(e.key + ':' + e.defaultPrevented);
        window.addEventListener('keydown', window.__kh.onBubble); document.body.focus(); return true; })()`);
    await letter('b'); await letter('v'); await letter('t');
    await sleep(1000);
    results.timelineClosed = { attached: await ev('window.__kh.tl.isAttached'), executed: await ev('window.__kh.executed'),
        defaultPrevented: await ev('window.__kh.prevented'), toolBefore: tool0, toolAfter: (await state()).tool,
        captionsBefore: closedCaptions0, captionsAfter: await captionCount() };
    await ev('window.removeEventListener("keydown", window.__kh.onBubble); true');
    assert.equal(results.timelineClosed.executed.filter(id => id.startsWith('akari.')).length, 0, 'closed timeline ran a command');
    assert.equal(results.timelineClosed.captionsAfter, closedCaptions0);

    await shot('l1-05-final.png');
    results.pass = true;
} catch (error) {
    results.pass = false;
    results.error = sanitize(error?.stack ?? error);
    process.exitCode = 1;
    try { await shot('l1-zz-failure.png'); } catch { /* ignore */ }
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
