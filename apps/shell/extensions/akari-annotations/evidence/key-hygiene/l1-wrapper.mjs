#!/usr/bin/env node
// L1（ラッパー検証）: キーの取り合い 5 件 + 表示のずれを実機 Electron + CDP で実測する。
// Usage: node l1-wrapper.mjs   （apps/shell を npm run build 済みであること）
// - CDP ポート 9463 / 一時ディレクトリ /tmp/key-hygiene-l1/run-* / AKARI_HOME・user-data-dir は専用
// - 入力は CDP の Input.* で送る（IME は Input.imeSetComposition、コピーは commands:['copy']）
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
const PORT = 9463;
await mkdir('/tmp/key-hygiene-l1', { recursive: true });
const iso = await mkdtemp('/tmp/key-hygiene-l1/run-');
const project = path.join(iso, 'project');
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
const SPACE = () => key(' ', 'Space', 32);
const ESC = () => key('Escape', 'Escape', 27);
const DEL = () => key('Delete', 'Delete', 46);
const shot = async name => { await screenshot(cdp, path.join(here, name)); return name; };
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const clipCount = async () => (await edit()).tracks.find(t => t.id === 'video').items.length;
const captionCount = async () => (JSON.parse(await readFile(captionsPath, 'utf8'))).captions.length;
const state = () => ev(`({ playing: window.__kh.tl.visualPlaying, toggles: window.__kh.toggles,
    copies: window.__kh.copies, selection: window.__kh.tl.selection ? JSON.stringify(window.__kh.tl.selection) : null,
    active: (() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ').slice(0, 2).join('.') : '') : null; })() })`);

async function center(selector) {
    return waitFor(() => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`),
        `element ${selector}`, 30000);
}
/** タイムラインのチップを実クリックで選ぶ（フォーカスもタイムラインへ入る）。 */
async function clickChip(id) {
    const index = id === 'left' ? 0 : 1; // 映像トラックは cuts 扱いで、チップは index で引く
    const p = await center(`.akari-annotations-strip [data-akari-ui="timeline:cut:${index}"]`);
    await realClick(cdp, p.x, p.y);
    await sleep(500);
    return p;
}
async function setPlaying(target) {
    // 再生状態をそろえる（タイムラインにフォーカスを置いて Space）。プレビューからの通知で visualPlaying が変わる
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
    fixture.tracks.push({ id: 'captions', lane: 'visual', content: { from: 'captions.json' } });
    await writeFile(editPath, JSON.stringify(fixture, null, 2) + '\n');
    await writeFile(captionsPath, JSON.stringify({ emphasis_words: [], captions: [
        { id: 'c-0001', start: 0, end: 1, text: '台本の一行目', speaker: null, sourceRef: { segment: 0 }, edited: false },
        { id: 'c-0002', start: 1.2, end: 2, text: '台本の二行目', speaker: null, sourceRef: { segment: 1 }, edited: false }
    ] }, null, 2) + '\n');
    await mkdir(path.join(iso, 'home'));

    // ---------------------------------------------------------------- boot
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(iso, 'userdata')}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: path.join(iso, 'config'), AKARI_HOME: path.join(iso, 'home'),
            FAL_KEY: '', FAL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', c => { logs += c; });
    child.stderr.on('data', c => { logs += c; });
    child.once('exit', (code, signal) => { exited = { code, signal }; });
    log(`electron pid ${child.pid}`);
    const target = await waitFor(async () => (await listTargets(PORT)).find(t => t.type === 'page'), 'page', 120000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await resizeViewport(cdp, 1600, 1000);
    await waitFor(() => ev('!!window.theia?.container && !!document.getElementById("theia-app-shell")'), 'shell', 120000);
    const editUri = pathToFileURL(editPath).toString();
    await waitFor(() => ev(`(() => {
        const c = window.theia.container;
        const k = [...c._bindingDictionary._map.keys()].find(key => typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
        const reg = k && c.get(k);
        if (!reg?.getCommand('akari.annotations.open')) return false;
        window.__kh = { reg };
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
    // プレビューの再生準備（visualPlaying はプレビューからの通知で変わる）
    await waitFor(() => ev('!!document.querySelector("iframe")'), 'preview iframe', 60000).catch(() => null);
    await sleep(4000);
    await shot('l1-00-boot.png');
    log('booted');

    // ---------------------------------------------------------------- A. 表示と実装（ボタン・ヘルプ）
    results.labels = await ev(`(() => { const tl = window.__kh.tl; return {
        splitTitle: tl.razorToolButton.title, splitAria: tl.razorToolButton.getAttribute('aria-label'),
        placeText: tl.placeTextButton?.textContent, help: tl.toolbar?.title ?? null }; })()`);
    assert.match(results.labels.splitTitle, /B \/ C/);
    for (const k of ['V / A', 'B / C', 'F:', 'T: 文字を置く', 'N / M', 'Delete', '⌘G', '⌘C']) assert.ok(results.labels.help.includes(k), 'help lacks ' + k);

    // ---------------------------------------------------------------- B. タイムライン通常操作（Space / Esc / ⌘C / Delete）
    await setPlaying(false);
    await clickChip('left');
    const b0 = await state();
    await SPACE();
    const bPlay = await waitFor(async () => { const s = await state(); return s.playing ? s : null; }, 'Space plays', 10000).catch(() => state());
    await SPACE();
    const bStop = await waitFor(async () => { const s = await state(); return !s.playing ? s : null; }, 'Space stops', 10000).catch(() => state());
    results.timelineSpace = { before: b0, afterFirstSpace: bPlay, afterSecondSpace: bStop };
    assert.equal(bPlay.playing, true, 'timeline Space did not start playback');
    assert.equal(bStop.playing, false, 'timeline Space did not stop playback');

    await clickChip('left');
    const e0 = await state();
    await ESC();
    const e1 = await state();
    results.timelineEsc = { before: e0.selection, after: e1.selection };
    assert.ok(e0.selection && !e1.selection, 'timeline Esc did not clear selection');

    await clickChip('left');
    const c0 = await state();
    await key('c', 'KeyC', 67, MOD.meta, { commands: ['copy'] });
    const c1 = await state();
    results.timelineCopy = { copiesBefore: c0.copies, copiesAfter: c1.copies,
        footer: await ev(`(() => { const p = document.querySelector('[data-akari-ui="panel:timeline"]');
            return Array.from(p.children).filter(el => el.tagName === 'DIV').at(-1)?.textContent ?? ''; })()`) };
    assert.equal(c1.copies, c0.copies + 1, 'timeline ⌘C did not copy the clip');

    await clickChip('right');
    const d0 = await clipCount();
    await DEL();
    await waitFor(async () => (await clipCount()) < d0 || null, 'timeline Delete', 10000);
    results.timelineDelete = { clipsBefore: d0, clipsAfter: await clipCount() };
    await key('z', 'KeyZ', 90, MOD.meta);
    await waitFor(async () => (await clipCount()) === d0 || null, 'undo delete', 10000);
    results.timelineDelete.clipsAfterUndo = await clipCount();

    // ---------------------------------------------------------------- C. T キーで文字を置く
    await clickChip('left');
    const t0c = await captionCount();
    await key('t', 'KeyT', 84);
    await waitFor(async () => (await captionCount()) > t0c || null, 'T places text', 15000);
    results.tKey = { captionsBefore: t0c, captionsAfter: await captionCount() };
    await shot('l1-01-t-key.png');
    // T で入った文字が入力状態なら抜ける
    await ev('document.activeElement?.blur?.(); true');
    await sleep(500);

    // ---------------------------------------------------------------- D. 音声キーフレームのダイアログ（Space / Delete / Esc）
    await setPlaying(false);
    await clickChip('left'); // タイムラインでクリップを選んだ状態でダイアログを開く（Delete 二重の再現条件）
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
    await realClick(cdp, cv.x, cv.y); // 点を足して選ぶ
    await sleep(500);
    const pointState = () => ev(`(() => { const d = document.querySelector('.akari-audio-keyframe-dialog');
        const del = d && [...d.querySelectorAll('button')].find(b => b.textContent === '選択点を削除');
        return { open: !!d, deleteEnabled: !!del && !del.disabled }; })()`);
    const s0 = await state();
    results.audioDialog.beforeSpace = { ...(await pointState()), previewPlaying: s0.playing, toggles: s0.toggles, active: s0.active };
    await SPACE();
    await sleep(600);
    const s1 = await state();
    results.audioDialog.afterSpace = { previewPlaying: s1.playing, toggles: s1.toggles,
        dialogAudioPlays: await ev('window.__kh.audioPlays'), dialogAudioPaused: await ev('window.__kh.lastAudio ? window.__kh.lastAudio.paused : null') };
    await shot('l1-02-audio-dialog-space.png');
    assert.equal(s1.playing, s0.playing, 'Space in dialog changed preview playback');
    assert.equal(s1.toggles, s0.toggles, 'Space in dialog reached timeline');
    assert.equal(results.audioDialog.afterSpace.dialogAudioPlays, 1, 'dialog playback did not toggle');
    assert.equal(results.audioDialog.beforeSpace.deleteEnabled, true, 'no point selected in dialog');
    await DEL();
    await sleep(1500);
    results.audioDialog.afterDelete = { ...(await pointState()), clips: await clipCount() };
    assert.equal(results.audioDialog.afterDelete.deleteEnabled, false, 'dialog point not deleted');
    assert.equal(results.audioDialog.afterDelete.clips, results.audioDialog.clipsBefore, 'timeline clip deleted by dialog Delete');
    await ESC();
    await sleep(600);
    results.audioDialog.afterFirstEsc = await pointState();
    assert.equal(results.audioDialog.afterFirstEsc.open, false, 'dialog did not close on first Esc');

    // ---------------------------------------------------------------- E. ライブラリのカードで Space
    await setPlaying(false);
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-open-catalog]')?.click(); true`);
    await ev(`(async () => { const w = window.__kh.sh.widgets.find(w => w.id === 'akari-role-buckets-widget'); if (w) await window.__kh.sh.activateWidget(w.id); return true; })()`);
    await waitFor(() => ev('!!document.querySelector("#akari-role-buckets-widget [data-akari-library-category=transition]")'), 'library category');
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-library-category=transition]').click(); true`);
    const card = await center('#akari-role-buckets-widget [data-akari-library-transition]');
    await ev(`document.querySelector('#akari-role-buckets-widget [data-akari-library-transition]').focus(); true`);
    const l0 = await state();
    await SPACE();
    await sleep(800);
    const l1 = await state();
    results.libraryCard = { card, focused: l0.active, before: { playing: l0.playing, toggles: l0.toggles },
        after: { playing: l1.playing, toggles: l1.toggles, active: l1.active } };
    await shot('l1-03-library-card-space.png');
    assert.equal(l1.playing, l0.playing, 'library card Space changed preview playback');
    assert.equal(l1.toggles, l0.toggles, 'library card Space reached timeline');

    // ---------------------------------------------------------------- F. 台本の行を選んで Esc（タイムライン選択中）
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await clickChip('left');
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-daihon-widget'); return true; })()`);
    // 台本の行は素のクリック = シーク、⌘クリック = 行の選択（DH planRowClick）。単語の上を避けて行の左端を押す
    await center('#akari-daihon-widget .akari-daihon-row');
    const row = await ev(`(() => { const r = document.querySelector('#akari-daihon-widget .akari-daihon-row').getBoundingClientRect();
        return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) }; })()`);
    await realClick(cdp, row.x, row.y, { modifiers: MOD.meta });
    await sleep(500);
    const rowSel = () => ev(`[...document.querySelectorAll('#akari-daihon-widget .akari-daihon-row.selected')].length`);
    const f0 = { rowsSelected: await rowSel(), ...(await state()) };
    await ESC();
    const f1 = { rowsSelected: await rowSel(), ...(await state()) };
    results.daihonEsc = { before: f0, afterFirstEsc: f1 };
    await shot('l1-04-daihon-esc.png');
    assert.ok(f0.rowsSelected > 0, 'daihon row not selected');
    assert.ok(f0.selection, 'timeline selection was not kept before Esc');
    assert.equal(f1.rowsSelected, 0, 'first Esc did not clear the daihon row selection');

    // ---------------------------------------------------------------- G. パートナー: IME の Enter（CDP composition）
    // 既定経路は生ターミナル（2026-07-25）で、チャット入力欄は renderChat() に温存されている。検証のため renderChat を描かせる
    await ev(`(async () => { const p = window.__kh.partner; p.render = () => p.renderChat();
        p.channel = { send() {} }; p.update(); await window.__kh.sh.activateWidget(p.id); return true; })()`);
    const input = await center('input[aria-label="パートナーに話しかける"]');
    await realClick(cdp, input.x, input.y);
    const msgs = () => ev('window.__kh.partner.messages.length');
    const g0 = await msgs();
    await cdp.send('Input.imeSetComposition', { text: 'にほんご', selectionStart: 4, selectionEnd: 4 });
    await sleep(200);
    const composingValue = await ev('document.activeElement.value');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(300);
    const gDuring = await msgs();
    await cdp.send('Input.insertText', { text: '日本語' });
    await sleep(300);
    const committedValue = await ev('document.activeElement.value');
    const gCommitted = await msgs();
    await key('Enter', 'Enter', 13, 0, { text: '\r' });
    await sleep(400);
    const gAfter = await msgs();
    results.partnerIme = { before: g0, composingValue, afterComposingEnter: gDuring, committedValue,
        afterCommit: gCommitted, afterEnter: gAfter, lastMessage: await ev('window.__kh.partner.messages.at(-1)?.text ?? null') };
    await shot('l1-05-partner-ime.png');
    assert.equal(gDuring, g0, 'IME composing Enter sent a message');
    assert.equal(gAfter, g0 + 1, 'Enter after commit did not send');

    // ---------------------------------------------------------------- H. パートナーの会話ログを選んで ⌘C
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await clickChip('left'); // タイムラインで選択中にしておく（横取りの再現条件）
    await ev(`(async () => { await window.__kh.sh.activateWidget(window.__kh.partner.id); return true; })()`);
    const bubbleSel = `(() => [...window.__kh.partner.node.querySelectorAll('div')].find(n => n.textContent === ${JSON.stringify(results.partnerIme.lastMessage)} && n.children.length === 0))()`;
    const bubble = await waitFor(() => ev(`(() => { const b = ${bubbleSel}; if (!b) return null; const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`), 'bubble');
    await realClick(cdp, bubble.x, bubble.y, { clickCount: 3 });
    await sleep(300);
    execFileSync('/usr/bin/pbcopy', { input: 'KH-SENTINEL' });
    const h0 = await state();
    const selected = await ev('window.getSelection().toString()');
    await key('c', 'KeyC', 67, MOD.meta, { commands: ['copy'] });
    await sleep(500);
    const clipboard = execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' });
    const h1 = await state();
    results.partnerCopy = { selected, active: h0.active, timelineSelection: h0.selection, clipboard,
        timelineCopiesBefore: h0.copies, timelineCopiesAfter: h1.copies };
    assert.equal(clipboard.trim(), selected.trim(), 'clipboard does not match the selected log text');
    assert.ok(selected.includes(results.partnerIme.lastMessage));
    assert.equal(h1.copies, h0.copies, 'timeline copied the clip instead');
    await ev('window.getSelection().removeAllRanges(); true');

    // ---------------------------------------------------------------- I. webview 転送（target = iframe）の Esc は従来どおりタイムラインへ
    await ev(`(async () => { await window.__kh.sh.activateWidget('akari-annotations-widget'); return true; })()`);
    await clickChip('left');
    const i0 = await state();
    results.webviewForwardedEsc = await ev(`(() => {
        const frame = document.querySelector('iframe');
        if (!frame) return { skipped: 'no iframe' };
        frame.focus();
        const active = document.activeElement?.tagName;
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        return { active, selectionAfter: window.__kh.tl.selection ? JSON.stringify(window.__kh.tl.selection) : null };
    })()`);
    results.webviewForwardedEsc.selectionBefore = i0.selection;

    await shot('l1-06-final.png');
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
