#!/usr/bin/env node
// 台本パネルで字幕を 1 文字ずつ直し、captions.json の差分（words の時刻・emphasis_words・display_*）と
// 出力プレビューの見た目（強調の span・行・スクリーンショット）を編集前後で記録する。
// 使い方: node l1.mjs <fixture dir> --phase=before|after [--port=9471]
// fixture は gen-fixture.mjs で作る（phase ごとに作り直すこと）。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, listTargets } from './cdp-lib.mjs';
import { S, command, evalOn, launch, pressKey, realClick, sanitize, saveJson, sleep, stop, waitEval } from './l1-lib.mjs';
import { EDITS } from './gen-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'daihon-edit-keeps-style-l1', 'fixture'));
const PROJECT = path.join(FIXTURE, 'project');
const PHASE = process.argv.find(v => v.startsWith('--phase='))?.slice(8) ?? 'before';
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9471);
const RUNS = path.join(os.tmpdir(), 'daihon-edit-keeps-style-l1', 'runs');
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const out = { phase: PHASE, status: 'running', edits: [], preview: {}, captions: {}, screenshots: [] };

async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const readRoot = async () => JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8'));
const editUri = `file://${path.join(PROJECT, 'edit.json')}`;
const seek = (session, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time }));

// ---- webview（入れ子 iframe の内側）への到達（placed-text-position-polish の l1.mjs と同じ） ----
async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close(); cdp = undefined;
        await waitFor('preview stage', async () => {
            const targets = (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
            for (const target of targets) {
                const client = new CDP(target.webSocketDebuggerUrl);
                try { await client.connect(); } catch { continue; }
                const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
                try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
                await sleep(300);
                for (const c of [undefined, ...contexts.map(c => c.id)]) {
                    try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; return true; } } catch {}
                }
                client.close();
            }
            return false;
        }, 180_000);
    };
    await attach();
    return { eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } } };
}

// 見えている字幕の板: 本文・行（innerText の改行）・強調（プリセット）span の数と文字・その色。
const PREVIEW_STATE = `(()=>{const plates=[...document.querySelectorAll('.caption-row-plate')].filter(p=>{const r=p.getBoundingClientRect();const cs=getComputedStyle(p);return r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&(p.textContent||'').trim()});return plates.map(p=>{const spans=[...p.querySelectorAll('[data-emphasis-preset], .akari-caption__tok--emphasis')];return{id:p.id,text:p.textContent,innerText:p.innerText,lines:p.innerText.split('\\n').filter(Boolean),emphasis:spans.map(s=>({text:s.textContent,preset:s.getAttribute('data-emphasis-preset'),color:getComputedStyle(s).color}))}})})()`;

async function previewShot(session, name) {
    const rect = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return r?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`);
    const params = { format: 'png', ...(rect ? { clip: { ...rect, scale: 1 } } : {}) };
    const { data } = await session.cdp.send('Page.captureScreenshot', params);
    const file = `${PHASE}-${name}.png`;
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}

async function previewPass(session, v, label, captions) {
    const pass = {};
    for (const caption of captions) {
        const time = Math.round(((caption.start + caption.end) / 2) * 1000) / 1000;
        const expectText = label === 'post' ? caption.display_text ?? caption.text : undefined;
        await seek(session, time);
        await sleep(1200);
        let state = await v.eval(PREVIEW_STATE);
        if (expectText !== undefined) {
            // 書き込み後の再解決を待つ（本文が新しい文字になるまで）。
            state = await waitFor(`preview ${caption.id} updated`, async () => {
                await seek(session, time); await sleep(600);
                const s = await v.eval(PREVIEW_STATE);
                return s.some(p => p.text.replace(/\s/gu, '') === expectText.replace(/\s/gu, '')) ? s : null;
            }, 30_000).catch(async () => v.eval(PREVIEW_STATE));
        }
        pass[caption.id] = { time, plates: state };
        await previewShot(session, `${label}-${caption.id}`);
    }
    out.preview[label] = pass;
    await saveJson(RESULTS, out);
}

async function editRow(session, edit) {
    const selector = `.akari-daihon-row[data-caption-id=${S(edit.id)}] .akari-daihon-row-text`;
    await waitEval(session.cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${edit.id} row`, timeoutMs: 30_000 });
    await sleep(300);
    const point = await evalOn(session.cdp, `(()=>{const r=document.querySelector(${S(selector)}).getBoundingClientRect();return{x:r.left+Math.min(24,r.width/2),y:r.top+r.height/2}})()`);
    await realClick(session.cdp, point.x, point.y, { clickCount: 2 });
    const inputSel = `.akari-daihon-row[data-caption-id=${S(edit.id)}] .akari-daihon-row-edit input`;
    const shown = await waitEval(session.cdp, `(()=>{const i=document.querySelector(${S(inputSel)});return i?i.value:null})()`, { label: `${edit.id} input`, timeoutMs: 15_000 });
    if (!shown.includes(edit.from)) throw new Error(`${edit.id}: input value does not contain ${edit.from}: ${shown}`);
    const next = shown.replace(edit.from, edit.to);
    // 実キー入力: 全選択 → 新しい本文を入力 → Enter。
    await evalOn(session.cdp, `(()=>{const i=document.querySelector(${S(inputSel)});i.focus();i.select();return true})()`);
    await session.cdp.send('Input.insertText', { text: next });
    await sleep(200);
    const before = (await readRoot()).captions.find(c => c.id === edit.id);
    await pressKey(session.cdp, 'Enter', 'Enter', 13, 0);
    const after = await waitFor(`${edit.id} written`, async () => {
        const record = (await readRoot()).captions.find(c => c.id === edit.id);
        return record && record.text !== before.text ? record : null;
    }, 30_000);
    await waitEval(session.cdp, `(()=>{const e=document.querySelector(${S(`.akari-daihon-row[data-caption-id=${S(edit.id)}]`)});return Boolean(e&&!e.classList.contains('saving')&&!document.querySelector('.akari-daihon-row-edit'))})()`, { label: `${edit.id} settled`, timeoutMs: 30_000 });
    await sleep(800);
    const notice = await evalOn(session.cdp, `(()=>{const n=[...document.querySelectorAll('.akari-daihon-notice, .akari-daihon-status, [class*="daihon"][class*="notice"], .theia-notification-message')].map(e=>e.textContent.trim()).filter(Boolean);return n.slice(-3)})()`).catch(() => []);
    return { id: edit.id, note: edit.note, inputShown: shown, typed: next, textBefore: before.text, textAfter: after.text, notice };
}

const wordsOf = record => (record.words ?? []).map(w => ({ text: w.text, start: w.start, end: w.end }));
function diffRecord(pre, post, rootPre, rootPost) {
    const oldWords = wordsOf(pre), newWords = wordsOf(post);
    // 前後の共通部分（text と時刻が完全一致する語）を前と後ろから数える。
    let prefix = 0;
    while (prefix < oldWords.length && prefix < newWords.length && S(oldWords[prefix]) === S(newWords[prefix])) prefix++;
    let suffix = 0;
    while (suffix < oldWords.length - prefix && suffix < newWords.length - prefix
        && S(oldWords[oldWords.length - 1 - suffix]) === S(newWords[newWords.length - 1 - suffix])) suffix++;
    const inRange = (e, r) => e.t_start < r.end && r.start < e.t_end;
    const emph = root => (root.emphasis_words ?? []).filter(e => inRange(e, pre)).map(e => ({ id: e.id, t_start: e.t_start, t_end: e.t_end, word: e.word }));
    return {
        text: [pre.text, post.text],
        display_text: [pre.display_text ?? null, post.display_text ?? null],
        display_fragments: [pre.display_fragments ?? null, post.display_fragments ?? null],
        wordCount: [oldWords.length, newWords.length],
        wordsBefore: oldWords.map(w => `${w.text}@${w.start}-${w.end}`),
        wordsAfter: newWords.map(w => `${w.text}@${w.start}-${w.end}`),
        unchangedWordsKept: prefix + suffix,
        unchangedWordsTotal: Math.min(oldWords.length, newWords.length) === 0 ? 0 : oldWords.length,
        zeroLengthWordsAfter: newWords.filter(w => !(w.end > w.start)).length,
        emphasisBefore: emph(rootPre),
        emphasisAfter: emph(rootPost)
    };
}

let session;
try {
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: path.join(RUNS, PHASE) });
    out.pid = session.pid;
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitFor('preview webview', async () => {
        await seek(session, 1);
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 180_000);
    await waitFor('daihon rows', async () => {
        await evalOn(session.cdp, command('akari.daihon.open'));
        return waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length>=5`, { label: 'daihon rows', timeoutMs: 20_000 }).catch(() => false);
    }, 300_000);
    await sleep(2500);
    const v = await view(PORT);
    await waitFor('caption plate', async () => { await seek(session, 1.5); await sleep(500); return (await v.eval(PREVIEW_STATE)).length > 0; }, 90_000);

    const rootPre = await readRoot();
    out.captions.pre = rootPre;
    await previewPass(session, v, 'pre', rootPre.captions);
    await session.cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFile(path.join(ROOT, `${PHASE}-daihon-pre.png`), Buffer.from(data, 'base64')));
    out.screenshots.push(`${PHASE}-daihon-pre.png`);

    for (const edit of EDITS) {
        out.edits.push(await editRow(session, edit));
        await saveJson(RESULTS, out);
    }
    const rootPost = await readRoot();
    out.captions.post = rootPost;
    await previewPass(session, v, 'post', rootPost.captions);
    await session.cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFile(path.join(ROOT, `${PHASE}-daihon-post.png`), Buffer.from(data, 'base64')));
    out.screenshots.push(`${PHASE}-daihon-post.png`);

    out.diff = Object.fromEntries(rootPre.captions.map(pre => {
        const post = rootPost.captions.find(c => c.id === pre.id);
        const d = diffRecord(pre, post, rootPre, rootPost);
        const platesPre = out.preview.pre[pre.id].plates, platesPost = out.preview.post[pre.id].plates;
        d.preview = {
            textPre: platesPre.map(p => p.innerText), textPost: platesPost.map(p => p.innerText),
            linesPre: platesPre.map(p => p.lines.length), linesPost: platesPost.map(p => p.lines.length),
            emphasisSpansPre: platesPre.flatMap(p => p.emphasis.map(e => e.text)),
            emphasisSpansPost: platesPost.flatMap(p => p.emphasis.map(e => e.text))
        };
        return [pre.id, d];
    }));
    out.status = 'done';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    process.exitCode = 1;
    if (session) await session.cdp.send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => writeFile(path.join(os.tmpdir(), 'daihon-edit-keeps-style-l1', `fail-${PHASE}.png`), Buffer.from(data, 'base64'))).catch(() => {});
} finally {
    await stop(session);
}
// captions.json の全文は結果に残さない（diff だけ残す）。
delete out.captions;
await saveJson(RESULTS, out);
process.stdout.write(`${JSON.stringify({ status: out.status, error: out.error, diff: out.diff && Object.fromEntries(Object.entries(out.diff).map(([id, d]) => [id, { kept: `${d.unchangedWordsKept}/${d.wordCount[0]}`, zero: d.zeroLengthWordsAfter, emph: [d.preview.emphasisSpansPre, d.preview.emphasisSpansPost], lines: [d.preview.textPre, d.preview.textPost], dt: d.display_text, df: d.display_fragments }])) })}\n`);
