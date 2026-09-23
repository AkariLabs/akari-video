#!/usr/bin/env node
// 読み上げポップアップ L1。先に gen-fixture.mjs <fixture-dir> を実行する。
// 実機を隔離起動し、結果と PNG に機械固有パスを記録しない。
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, clickSelector, pressKey, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'tts-readaloud-l1', 'fixture'));
const PROJECT = path.join(FIXTURE, 'spoken');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9451);
const RESULTS = path.join(ROOT, 'results-l1.json');
const names = [
    '字幕右クリックに「音声を作る…」が「注釈…」の直前に出る',
    '押すと読み上げダイアログが開き対象の字幕テキストが見える',
    'エンジンカードが 2 枚以上あり VOICEVOX が選ばれる',
    '試聴で out/narration/n-NNNN.wav ができ生成尺が表示される',
    '置くとナレーション帯が 1 件増え caption_ref が保存される',
    '⌘Z でナレーションと字幕の伸長が 1 手で戻る',
    'タイムラインと台本の読み上げボタンから同じダイアログが開く',
    'Gemini の Leda と費用承認キャンセル、未設定時は接続画面を確認する',
    '設定の読み上げ節は文字起こしの直後で、Gemini の既定の声 Kore がポップアップへ反映される'
];
const out = { status: 'running', checks: names.map(name => ({ name, pass: false, detail: '未実行' })) };
const runStarted = Date.now();
const q = value => JSON.stringify(value);
const assert = (value, message) => { if (!value) throw new Error(message); };
async function check(index, run) {
    const started = Date.now();
    try { out.checks[index].detail = await run(); out.checks[index].pass = true; }
    catch (error) { out.checks[index].detail = sanitize(error, REPO); }
    out.checks[index].elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
    return out.checks[index].pass;
}
let shotNumber = 0;
async function shot(cdp) {
    shotNumber += 1;
    await sleep(350);
    // 設定画面の既存キー末尾表示を伏せる。下端のアカウント名が映るステータスバーも除く。
    await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-settings-dialog]');if(!root)return true;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){node.textContent=node.textContent.replace(/•{2,}[A-Za-z0-9]+/gu,'••••')}return true})()`);
    const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: 1440, height: 865, scale: 1 }
    });
    await writeFile(path.join(ROOT, `${String(shotNumber).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
}
const dialog = '[data-akari-read-aloud-dialog]';
const card = id => `${dialog} section[data-engine=${q(id)}]`;
async function waitFor(label, fn, timeout = 240_000) {
    const until = Date.now() + timeout;
    let last;
    while (Date.now() < until) {
        try { const value = await fn(); if (value) return value; }
        catch (error) { last = error; }
        await sleep(500);
    }
    throw new Error(`${label} に到達しませんでした${last ? `: ${sanitize(last, REPO)}` : ''}`);
}
async function rightClick(cdp, selector) {
    const point = await evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    assert(point, '字幕帯がありません');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1 });
}
const captions = async () => JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8')).captions;
const edit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const narration = async () => (await edit()).audio?.narration ?? [];
const exists = file => access(file).then(() => true, () => false);
const closeDialog = cdp => pressKey(cdp, 'Escape', 'Escape', 27, 0);
const captionSelector = '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]';
async function ensureTimeline(cdp) {
    const ready = await evalOn(cdp, `Boolean(document.querySelector(${q(captionSelector)}))`);
    if (!ready) await evalOn(cdp, fireCommand('akari.annotations.open'));
    await waitEval(cdp, `Boolean(document.querySelector(${q(captionSelector)}))`, { label: '字幕帯', timeoutMs: 240_000 });
}
async function ensureMenu(cdp) {
    await ensureTimeline(cdp);
    if (!(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-context-item="narrate"]'))`))) {
        await rightClick(cdp, captionSelector);
    }
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-context-item="narrate"]'))`, { label: '音声を作るメニュー', timeoutMs: 240_000 });
}
async function ensureDialog(cdp) {
    if (!(await evalOn(cdp, `Boolean(document.querySelector(${q(dialog)}))`))) {
        await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ['c-0001'] }));
    }
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog)}))`, { label: '読み上げダイアログ', timeoutMs: 240_000 });
}

let session;
try {
    assert(await exists(path.join(PROJECT, 'edit.json')), 'fixture がありません。gen-fixture.mjs を実行してください');
    await Promise.all((await readdir(ROOT)).filter(name => /^\d{2}\.png$/u.test(name))
        .map(name => rm(path.join(ROOT, name))));
    await saveJson(RESULTS, out);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT,
        isoDir: path.join(os.tmpdir(), 'tts-readaloud-l1', 'run') });
    const firstCaption = (await captions()).find(row => row.id === 'c-0001');
    const beforeEdit = await readFile(path.join(PROJECT, 'edit.json'), 'utf8');
    const beforeCaptions = await readFile(path.join(PROJECT, 'captions.json'), 'utf8');
    await check(0, async () => {
        await ensureTimeline(session.cdp);
        await rightClick(session.cdp, captionSelector);
        const items = await waitEval(session.cdp, `(()=>{const p=document.querySelector('[data-akari-context-menu]');return p?[...p.querySelectorAll('button')].map(x=>({id:x.dataset.akariContextItem,text:x.textContent})):null})()`, { label: '字幕メニュー' });
        const index = items.findIndex(item => item.id === 'narrate');
        assert(index >= 0 && items[index + 1]?.id === 'annotate', 'メニューの順序が違います');
        await shot(session.cdp);
        return { order: items.slice(index, index + 2).map(item => item.text) };
    });
    await check(1, async () => {
        await ensureMenu(session.cdp);
        await clickSelector(session.cdp, '[data-akari-context-item="narrate"]');
        const value = await waitEval(session.cdp, `(()=>{const d=document.querySelector(${q(dialog)});return d&&d.textContent.includes(${q(firstCaption.text)})?d.textContent.includes('読み上げ — この 1 行'):false})()`, { label: '読み上げダイアログ' });
        assert(value, '対象字幕が見えません'); await shot(session.cdp);
        return { captionId: firstCaption.id, targetVisible: true };
    });
    await check(2, async () => {
        await ensureDialog(session.cdp);
        const state = await waitEval(session.cdp, `(()=>{const d=document.querySelector(${q(dialog)});const cards=[...d?.querySelectorAll('section[data-engine]')??[]];return cards.length>=2?{count:cards.length,voicevox:cards.find(c=>c.dataset.engine==='voicevox')?.querySelector('input')?.checked,availability:cards.find(c=>c.dataset.engine==='voicevox')?.querySelector('[data-availability]')?.dataset.availability}:null})()`, { label: 'エンジンカード' });
        assert(state.voicevox || state.availability !== 'available', 'VOICEVOX が選ばれていません');
        await waitEval(session.cdp, `(()=>{const d=document.querySelector(${q(dialog)});return d?.querySelector('select')?.value && !d?.querySelector('[data-read-aloud-action="preview"]')?.disabled})()`, { label: 'VOICEVOX の声' });
        await shot(session.cdp); return state;
    });
    await check(3, async () => {
        await ensureDialog(session.cdp);
        await waitEval(session.cdp, `(()=>{const b=document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]')});return Boolean(b&&!b.disabled)})()`, { label: '試聴ボタン', timeoutMs: 240_000 });
        const started = Date.now();
        await clickSelector(session.cdp, `${dialog} [data-read-aloud-action="preview"]`);
        const file = await waitFor('生成 WAV', async () => (await readdir(path.join(PROJECT, 'out', 'narration')).catch(() => []))
            .find(name => /^n-\d{4}\.wav$/u.test(name)));
        const shown = await waitEval(session.cdp, `(()=>{const d=document.querySelector(${q(dialog)});return d?.textContent.includes('できた音声')&&d?.querySelector('audio')?.src?d.textContent.match(/できた音声 [0-9.]+ s/)?.[0]:null})()`, { label: '音声の尺' });
        await shot(session.cdp);
        return { file, durationLabel: shown, generationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)) };
    });
    await check(4, async () => {
        await ensureDialog(session.cdp);
        await waitEval(session.cdp, `(()=>{const b=document.querySelector(${q(dialog + ' [data-read-aloud-action="place"]')});return Boolean(b&&!b.disabled)})()`, { label: '置くボタン', timeoutMs: 240_000 });
        const before = (await narration()).length;
        const keep = await evalOn(session.cdp, `Boolean(document.querySelector(${q(dialog + ' input[value="keep"]')}))`);
        if (keep) await clickSelector(session.cdp, `${dialog} input[value="keep"]`);
        await clickSelector(session.cdp, `${dialog} [data-read-aloud-action="place"]`);
        const rows = await waitFor('narration entry', async () => { const value = await narration(); return value.length === before + 1 && value; });
        await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-audio-narration').length>${before}`, { label: 'ナレーション帯' });
        assert(rows.at(-1).caption_ref === firstCaption.id, 'caption_ref がありません');
        await shot(session.cdp);
        return { increment: 1, captionRef: rows.at(-1).caption_ref, itemVisible: true };
    });
    await check(5, async () => {
        await pressKey(session.cdp, 'z', 'KeyZ', 90, 4);
        await waitFor('undo', async () => (await readFile(path.join(PROJECT, 'edit.json'), 'utf8')) === beforeEdit);
        const afterCaptions = await readFile(path.join(PROJECT, 'captions.json'), 'utf8');
        assert(afterCaptions === beforeCaptions, '字幕タイミングが戻りません');
        await shot(session.cdp);
        return { narrationRemoved: true, captionTimingRestored: true };
    });
    await check(6, async () => {
        if (await evalOn(session.cdp, `Boolean(document.querySelector(${q(dialog)}))`)) await closeDialog(session.cdp);
        await waitEval(session.cdp, `!document.querySelector(${q(dialog)})`, { label: 'ダイアログが閉じる' });
        await ensureTimeline(session.cdp);
        await clickSelector(session.cdp, '.akari-timeline-read-aloud');
        await waitEval(session.cdp, `Boolean(document.querySelector(${q(dialog)}))`, { label: 'タイムライン入口' });
        await shot(session.cdp); await closeDialog(session.cdp);
        await waitEval(session.cdp, `!document.querySelector(${q(dialog)})`, { label: 'タイムラインのダイアログが閉じる' });
        await evalOn(session.cdp, fireCommand('akari.daihon.open'));
        await waitEval(session.cdp, `Boolean(document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]'))`, { label: '台本行', timeoutMs: 240_000 });
        await clickSelector(session.cdp, '.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-row-text');
        await clickSelector(session.cdp, '.akari-daihon-read-aloud');
        await waitEval(session.cdp, `Boolean(document.querySelector(${q(dialog)}))`, { label: '台本入口' });
        await shot(session.cdp);
        return { timeline: true, daihon: true };
    });
    await check(7, async () => {
        await ensureDialog(session.cdp);
        const state = await waitEval(session.cdp, `(()=>{const c=document.querySelector(${q(card('gemini-tts'))});const b=c?.querySelector('[data-availability]');return b?{availability:b.dataset.availability,badge:b.textContent}:null})()`, { label: 'Gemini カード' });
        if (state.availability === 'unconfigured') {
            await clickSelector(session.cdp, `${card('gemini-tts')} button[data-availability]`);
            await waitEval(session.cdp, `(()=>{const page=document.querySelector('[data-akari-settings-dialog] [data-akari-settings-section="connections"]');return Boolean(page&&!page.hidden)})()`, { label: '接続設定' });
            await shot(session.cdp);
            return { branch: 'unconfigured', badge: state.badge, connectionsOpened: true, charged: false };
        }
        await clickSelector(session.cdp, `${card('gemini-tts')} input[type=radio]`);
        const voice = await waitEval(session.cdp, `(()=>{const value=document.querySelector(${q(dialog + ' select')})?.value;return value==='Leda'?value:null})()`, { label: 'Gemini の声' });
        assert(voice === 'Leda', '先頭の声が Leda ではありません');
        const button = await evalOn(session.cdp, `document.querySelector(${q(dialog)})?.textContent.includes('費用を見て試聴…')`);
        assert(button, '費用承認ラベルがありません');
        await clickSelector(session.cdp, `${dialog} [data-read-aloud-action="preview"]`); // 承認ボタンは押さない。
        await waitEval(session.cdp, `document.body.textContent.includes('費用承認する')`, { label: '費用承認ダイアログ' });
        await shot(session.cdp);
        const cancel = await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='キャンセル'&&b.offsetParent);b?.click();return Boolean(b)})()`);
        assert(cancel, 'キャンセルがありません');
        return { branch: 'configured', voice, approvalShown: true, charged: false };
    });
    await check(8, async () => {
        if (await evalOn(session.cdp, `Boolean(document.querySelector('[data-akari-settings-dialog]'))`)) {
            await closeDialog(session.cdp);
            await waitEval(session.cdp, `!document.querySelector('[data-akari-settings-dialog]')`, { label: '接続設定が閉じる' });
        }
        if (await evalOn(session.cdp, `Boolean(document.querySelector(${q(dialog)}))`)) {
            await closeDialog(session.cdp);
            await waitEval(session.cdp, `!document.querySelector(${q(dialog)})`, { label: '読み上げダイアログが閉じる' });
        }
        await evalOn(session.cdp, fireCommand('akari.settings.open', 'narration'));
        await waitEval(session.cdp, `Boolean(document.querySelector('[data-akari-settings-dialog] [data-akari-settings-section="narration"]:not([hidden])'))`, { label: '読み上げ設定' });
        const order = await evalOn(session.cdp, `(()=>[...document.querySelectorAll('[data-akari-settings-dialog] [data-settings-nav]')].map(e=>e.dataset.settingsNav))()`);
        assert(order[order.indexOf('transcribe') + 1] === 'narration', '読み上げ節が文字起こしの直後ではありません');
        const voiceDropdown = '[data-akari-settings-section="narration"] [data-akari-dropdown="Gemini の既定の声"]';
        await clickSelector(session.cdp, `${voiceDropdown} .akari-set-dropdown-button`);
        await clickSelector(session.cdp, `${voiceDropdown} [role="option"][data-value="Kore"]`);
        const selected = await waitEval(session.cdp, `(()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>String(k)==='Symbol(PreferenceService)');return key&&c.get(key).get('akari.narration.voice')?.['gemini-tts']==='Kore'?'Kore':null})()`, { label: 'Gemini の声の保存値 Kore' });
        assert(selected === 'Kore', '保存された Gemini の声が Kore ではありません');
        await shot(session.cdp);
        await closeDialog(session.cdp);
        await waitEval(session.cdp, `!document.querySelector('[data-akari-settings-dialog]')`, { label: '設定が閉じる' });
        await ensureDialog(session.cdp);
        const availability = await waitEval(session.cdp, `document.querySelector(${q(card('gemini-tts') + ' [data-availability]')})?.dataset.availability`, { label: 'Gemini カードの状態' });
        const selectable = await evalOn(session.cdp, `!document.querySelector(${q(card('gemini-tts') + ' input[type=radio]')})?.disabled`);
        if (!selectable) {
            return { sectionOrder: 'transcribe → narration', savedVoice: selected,
                verification: 'preference の保存値を読み返し', availability, charged: false };
        }
        await clickSelector(session.cdp, `${card('gemini-tts')} input[type=radio]`);
        const popupVoice = await waitEval(session.cdp, `document.querySelector(${q(dialog + ' select')})?.value==='Kore'?'Kore':null`, { label: 'ポップアップの Gemini 声 Kore' });
        await shot(session.cdp);
        return { sectionOrder: 'transcribe → narration', savedVoice: selected,
            verification: 'ポップアップの声 select', popupVoice, charged: false };
    });
} catch (error) {
    out.error = sanitize(error, REPO);
    for (const record of out.checks) if (record.detail === '未実行') record.detail = `前提の起動に失敗: ${out.error}`;
} finally {
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
    out.elapsedSeconds = Number(((Date.now() - runStarted) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
    await stop(session);
}
console.log(out.status);
