#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, pressKey, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'tts-readaloud-batch-l1', 'fixture'));
const PROJECT = path.join(FIXTURE, 'spoken');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9468);
const RESULTS = path.join(ROOT, 'results-l1.json');
const UI_TIMEOUT_MS = 240_000;
const GENERATION_TIMEOUT_MS = 600_000;
const names = [
    '3 行 fixture で台本の 🔊 → 読み上げ — 3 行',
    'まとめて作る（VOICEVOX）→ 3 行とも ✓',
    '3 件を置く → 帯 +3・各 caption_ref',
    '⌘Z 1 回で 3 件とも消え字幕の時刻も戻る',
    '字幕の文字変更で該当 narration に 🔊 古い',
    '作り直す… → 置く → 件数維持・札消去',
    'VOICEVOX の needs バッジ → 設定「読み上げ」'
];
const out = { status: 'running', checks: names.map(name => ({ name, pass: false, detail: '未実行' })), paidCalls: 0 };
const q = JSON.stringify;
const dialog = '[data-akari-read-aloud-dialog]';
const ids = ['c-0001', 'c-0002', 'c-0003'];
const edit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const narration = async () => (await edit()).audio?.narration ?? [];
const captions = async () => JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let ownedVoicevox;
async function voicevoxUp() {
    try { return (await fetch('http://127.0.0.1:50021/version', { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
}
async function startVoicevoxForRun() {
    if (await voicevoxUp()) return;
    const runPath = path.join(path.sep, 'Applications', 'VOICEVOX.app', 'Contents', 'Resources', 'vv-engine', 'run');
    await access(runPath);
    ownedVoicevox = spawn(runPath, [], { stdio: 'ignore' });
    await until('VOICEVOX エンジン', voicevoxUp, UI_TIMEOUT_MS);
}
async function until(label, fn, timeout = 240_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(300); }
    throw new Error(`${label} に到達しませんでした`);
}
async function check(index, fn) {
    const start = Date.now();
    try { out.checks[index].detail = await fn(); out.checks[index].pass = true; }
    catch (error) { out.checks[index].detail = sanitize(error, REPO); }
    out.checks[index].seconds = Number(((Date.now() - start) / 1000).toFixed(2));
    await saveJson(RESULTS, out);
}
async function screenshot(cdp, index) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 865, scale: 1 } });
    await writeFile(path.join(ROOT, `${String(index + 1).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
}
async function close(cdp, selector = dialog) {
    if (await evalOn(cdp, `Boolean(document.querySelector(${q(selector)}))`)) {
        await evalOn(cdp, `document.querySelector(${q(selector + ' .closeButton')})?.click()`);
        await waitEval(cdp, `!document.querySelector(${q(selector)})`, { label: 'ダイアログを閉じる', timeoutMs: UI_TIMEOUT_MS });
    }
}
async function openBatch(cdp) {
    await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ids }));
    await waitEval(cdp, `Boolean(document.querySelector(${q(dialog)}))`, { label: '読み上げポップアップ', timeoutMs: UI_TIMEOUT_MS });
}
async function rightClick(cdp, selector) {
    const point = await evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    assert(point, 'ナレーション帯がありません');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1 });
}
let session;
try {
    await access(path.join(PROJECT, 'edit.json'));
    await saveJson(RESULTS, out);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT,
        isoDir: path.join(os.tmpdir(), 'tts-readaloud-batch-l1', 'run') });
    const cdp = session.cdp;
    const beforeEdit = await readFile(path.join(PROJECT, 'edit.json'), 'utf8');
    const beforeCaptions = await readFile(path.join(PROJECT, 'captions.json'), 'utf8');
    await check(0, async () => {
        await evalOn(cdp, fireCommand('akari.daihon.open'));
        await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row[data-caption-id]').length===3`, { label: '台本 3 行', timeoutMs: UI_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector('.akari-daihon-read-aloud').click()`);
        await waitEval(cdp, `document.querySelector(${q(dialog)})?.textContent.includes('読み上げ — 3 行')`, { label: '3 行の見出し', timeoutMs: UI_TIMEOUT_MS });
        assert(await evalOn(cdp, `document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')}).length===3`), '3 行が表示されません');
        await screenshot(cdp, 0); return { rows: 3, title: '読み上げ — 3 行' };
    });
    // needs は音声生成前にだけ現れる。観測値は契約順の最後へ保存する。
    await check(6, async () => {
        const badge = `${dialog} section[data-engine="voicevox"] button[data-availability="needs"]`;
        await waitEval(cdp, `Boolean(document.querySelector(${q(badge)}))`, { label: 'VOICEVOX needs', timeoutMs: UI_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector(${q(badge)}).click()`);
        await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-section="narration"]:not([hidden])'))`, { label: '設定 読み上げ', timeoutMs: UI_TIMEOUT_MS });
        await screenshot(cdp, 6);
        await close(cdp, '[data-akari-settings-dialog]');
        return { badge: 'needs', section: 'narration' };
    });
    await startVoicevoxForRun();
    await check(1, async () => {
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: 'まとめて作る', timeoutMs: UI_TIMEOUT_MS });
        const started = Date.now();
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="preview"]`)}).click()`);
        await waitEval(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>!e.textContent.includes('生成中'))`, { label: '最初の順次生成', timeoutMs: GENERATION_TIMEOUT_MS });
        for (let attempt = 0; attempt < 3; attempt++) {
            const failed = await evalOn(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].filter(e=>e.textContent.includes('失敗')).length`);
            if (!failed) break;
            await evalOn(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})]
                .find(e=>e.textContent.includes('失敗'))?.querySelector('button')?.click()`);
            await waitEval(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>!e.textContent.includes('生成中'))`, { label: '失敗行の再生成', timeoutMs: GENERATION_TIMEOUT_MS });
        }
        await waitEval(cdp, `document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')}).length===3&&[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>e.textContent.includes('✓'))`, { label: '3 行生成', timeoutMs: GENERATION_TIMEOUT_MS });
        await screenshot(cdp, 1);
        return { done: 3, generationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)) };
    });
    await check(2, async () => {
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="place"]`)}).click()`);
        const rows = await until('3 件配置', async () => { const value = await narration(); return value.length === 3 && value; });
        assert(rows.every((item, index) => item.caption_ref === ids[index]), 'caption_ref が揃いません');
        await waitEval(cdp, `document.querySelectorAll('.akari-annotations-strip-audio-narration').length>=3`, { label: '帯 3 件', timeoutMs: UI_TIMEOUT_MS });
        await screenshot(cdp, 2); return { added: 3, captionRefs: rows.map(item => item.caption_ref) };
    });
    await check(3, async () => {
        await close(cdp);
        await pressKey(cdp, 'z', 'KeyZ', 90, 4);
        await until('undo', async () => (await readFile(path.join(PROJECT, 'edit.json'), 'utf8')) === beforeEdit);
        assert((await readFile(path.join(PROJECT, 'captions.json'), 'utf8')) === beforeCaptions, '字幕が戻りません');
        await screenshot(cdp, 3); return { removed: 3, captionsRestored: true };
    });
    await check(4, async () => {
        const narrationCount = (await narration()).length;
        assert(narrationCount === 0, `再生成の前提が崩れています: Undo 後の narration は 0 件のはずですが ${narrationCount} 件です。`);
        await openBatch(cdp);
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: '再生成', timeoutMs: UI_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="preview"]`)}).click()`);
        await waitEval(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>!e.textContent.includes('生成中'))`, { label: '再生成の順次完了', timeoutMs: GENERATION_TIMEOUT_MS });
        for (let attempt = 0; attempt < 3; attempt++) {
            const failed = await evalOn(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].filter(e=>e.textContent.includes('失敗')).length`);
            if (!failed) break;
            await evalOn(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})]
                .find(e=>e.textContent.includes('失敗'))?.querySelector('button')?.click()`);
            await waitEval(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].every(e=>!e.textContent.includes('生成中'))`, { label: '再生成の失敗行を再試行', timeoutMs: GENERATION_TIMEOUT_MS });
        }
        await waitEval(cdp, `[...document.querySelectorAll(${q(dialog + ' [data-read-aloud-row]')})].filter(e=>e.textContent.includes('✓')).length===3`, { label: '再生成 3 件', timeoutMs: GENERATION_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="place"]`)}).click()`);
        await until('再配置', async () => (await narration()).length === 3);
        await close(cdp);
        const document = await captions(); document.captions[0].text += ' 改訂';
        await writeFile(path.join(PROJECT, 'captions.json'), `${JSON.stringify(document, null, 2)}\n`);
        await waitEval(cdp, `Boolean(document.querySelector('.akari-annotations-strip-audio-narration [data-akari-stale-narration]'))`, { label: '古い札', timeoutMs: UI_TIMEOUT_MS });
        await screenshot(cdp, 4); return { editedCaption: 'c-0001', staleBadge: true };
    });
    await check(5, async () => {
        const old = (await narration()).find(item => item.caption_ref === 'c-0001');
        assert(old, '置き換え元がありません');
        await evalOn(cdp, `(async()=>{const container=window.theia.container;
            const key=[...container._bindingDictionary._map.keys()].find(k=>typeof k==='function'
                && typeof k.prototype?.activateWidget==='function'&&container.get(k).mainPanel);
            await container.get(key).activateWidget('akari-annotations-widget');return true})()`);
        await waitEval(cdp, `(()=>{const r=document.querySelector(${q(`.akari-annotations-strip-audio-narration[data-akari-item-id="${old.id}"]`)})?.getBoundingClientRect();return r&&r.width>0&&r.height>0})()`, { label: 'タイムラインの帯', timeoutMs: UI_TIMEOUT_MS });
        await rightClick(cdp, `.akari-annotations-strip-audio-narration[data-akari-item-id="${old.id}"]`);
        await waitEval(cdp, `Boolean(document.querySelector('[data-akari-context-item="narrate-redo"]'))`, { label: '作り直すメニュー', timeoutMs: UI_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector('[data-akari-context-item="narrate-redo"]').click()`);
        await waitEval(cdp, `document.querySelector(${q(dialog)})?.textContent.includes('読み上げ — この 1 行')`, { label: '1 行版', timeoutMs: UI_TIMEOUT_MS });
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' [data-read-aloud-action="preview"]:not(:disabled)')}))`, { label: '試聴', timeoutMs: UI_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="preview"]`)}).click()`);
        await waitEval(cdp, `Boolean(document.querySelector(${q(dialog + ' audio[src]')}))`, { label: '作り直し音声', timeoutMs: GENERATION_TIMEOUT_MS });
        await evalOn(cdp, `document.querySelector(${q(`${dialog} [data-read-aloud-action="place"]`)}).click()`);
        await until('置き換え', async () => { const value = await narration(); return value.length === 3 && !value.some(item => item.id === old.id) && value; });
        await waitEval(cdp, `!document.querySelector('[data-akari-stale-narration]')`, { label: '古い札消去', timeoutMs: UI_TIMEOUT_MS });
        await screenshot(cdp, 5); return { count: 3, oldRemoved: true, staleCleared: true };
    });
} catch (error) {
    out.error = sanitize(error, REPO);
    for (const record of out.checks) if (record.detail === '未実行') record.detail = `起動または前提失敗: ${out.error}`;
} finally {
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
    await saveJson(RESULTS, out);
    await stop(session);
    if (ownedVoicevox) {
        ownedVoicevox.kill('SIGTERM');
        await sleep(1500);
        if (ownedVoicevox.exitCode === null) ownedVoicevox.kill('SIGKILL');
    }
}
console.log(out.status);
