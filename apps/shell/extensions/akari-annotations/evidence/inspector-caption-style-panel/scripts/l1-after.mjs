// AFTER の受け入れ条件の実測（l1.mjs after から呼ばれる。ラッパー作成の検証スクリプト）。
// 欄の操作はすべて CDP の実マウス・実キーボード（数値欄 = クリック → 全選択 → 入力 → Enter、色欄 = 同じ、ボタン = クリック）。
// 書き込み先は captions.json を読み直して確かめ、出力プレビュー（webview の内側）の computed style で反映を確かめる。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, sleep, waitEval } from './l1-lib.mjs';

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
async function waitFor(label, fn, timeoutMs = 30_000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(intervalMs); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

// ---- webview（入れ子 iframe の内側）への到達（placed-text-position-polish の l1.mjs と同じ手順） ----
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
        }, 180_000, 500);
    };
    await attach();
    return { eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } } };
}

// プレビューの字幕 1 本の見た目（文字の computed style と、背景を持つ要素の一覧）。
const PLATE_STYLE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const r0=p.getBoundingClientRect();if(!(r0.width>0&&r0.height>0))return null;const l=p.querySelector('.akari-caption__line')||p;const leaf=[...l.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim())||l;const cs=getComputedStyle(leaf);const lcs=getComputedStyle(l);const bgs=[...p.querySelectorAll('*')].map(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();return{cls:String(e.className).slice(0,50),bg:s.backgroundColor,radius:s.borderRadius,w:Math.round(r.width),h:Math.round(r.height)}}).filter(x=>x.bg&&x.bg!=='rgba(0, 0, 0, 0)'&&x.bg!=='transparent'&&x.w>0);return{text:(p.textContent||'').trim(),lines:p.querySelectorAll('.akari-caption__line').length,color:cs.color,fontSize:cs.fontSize,lineFontSize:lcs.fontSize,strokeWidth:cs.webkitTextStrokeWidth,strokeColor:cs.webkitTextStrokeColor,textShadow:cs.textShadow,paintOrder:cs.paintOrder,bgs}})()`;
const FRAME_RECT = `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return r?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`;

export async function runAfter(ctx) {
    const { check, P, out, session, PORT, EVIDENCE } = ctx;
    const cdp = session.cdp;
    const PROJECT = ctx.PROJECT;
    const editUri = `file://${path.join(PROJECT, 'edit.json')}`;
    const captionsOf = async () => JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8')).captions;
    const rowOf = async id => (await captionsOf()).find(c => c.id === id);
    const seek = time => evalOn(cdp, command('akari.preview.seekOutput', { editUri, time }));
    const v = await view(PORT);
    const INSPECTOR = '[data-akari-ui="panel:inspector"]';
    const ROW = name => `${INSPECTOR} [data-akari-field="${name}"]`;

    async function pointOf(selector) {
        await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 30_000 });
        await sleep(250);
        return evalOn(cdp, `(()=>{const r=document.querySelector(${S(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    }
    async function click(selector) { const p = await pointOf(selector); await realClick(cdp, p.x, p.y); await sleep(300); }
    async function typeInto(selector, text) {
        const p = await pointOf(selector);
        await realClick(cdp, p.x, p.y); await sleep(150);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
        await cdp.send('Input.insertText', { text: String(text) });
        await sleep(100);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await sleep(150);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await sleep(300);
    }
    const setNumber = (field, value) => typeInto(`${ROW(field)} input[type="number"]`, value);
    const setColor = (field, hex) => typeInto(`${ROW(field)} input[type="text"]`, hex);
    const plate = id => v.eval(PLATE_STYLE(id));
    async function select(ids, time) {
        await ctx.selectCaptions(cdp, ids);
        if (time !== undefined) await seek(time);
        await waitEval(cdp, `Boolean(document.querySelector(${S(ROW('caption-color'))}))`, { label: 'caption style rows', timeoutMs: 30_000 });
        await sleep(500);
    }
    async function shotPreview(name) {
        await sleep(900);
        const rect = await evalOn(cdp, FRAME_RECT);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
        const file = `after-${name}.png`;
        const { writeFile } = await import('node:fs/promises');
        await writeFile(path.join(EVIDENCE, file), Buffer.from(data, 'base64'));
        out.screenshots.push(file);
        return file;
    }
    const cardState = () => evalOn(cdp, `(()=>{const root=document.querySelector(${S(INSPECTOR)});return[...root.querySelectorAll('[data-akari-ui^="section:inspector-style"]')].map(s=>({id:s.getAttribute('data-akari-ui').slice(18),label:(s.querySelector('.akari-inspector-section-toggle')?.textContent||'').trim(),fields:[...s.querySelectorAll('[data-akari-field]')].map(f=>f.getAttribute('data-akari-field'))}))})()`);

    // ---- 1. 4 枚のカード（+ 位置）の並び・スクリーンショット（ダーク / ライト） ----
    await check('cards: 文字 / 縁取り / 座布団 / 効果 / 位置 の並び（単体・複数とも）', async () => {
        const result = {};
        for (const [name, ids, time] of [['single', ['c-0002'], 5.5], ['multi', ['c-0001', 'c-0004', 'c-0005'], undefined], ['placed', ['c-0101'], 13.5], ['preset', ['c-0003'], 9.5]]) {
            await select(ids, time);
            result[name] = await cardState();
        }
        const expected = ['文字', '縁取り', '座布団', '効果', '位置'];
        const labels = Object.fromEntries(Object.entries(result).map(([k, cards]) => [k, cards.map(c => c.label)]));
        return { pass: Object.values(labels).every(l => S(l) === S(expected)), labels, cards: result.single };
    });
    for (const theme of ['dark', 'light']) {
        await check(`cards screenshot ${theme}`, async () => {
            await ctx.setTheme(cdp, theme);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false });
            await ctx.setRightWidth(cdp, 360);
            await select(['c-0003'], 9.5); // プリセット付き（袋文字相当の太い縁取り）→ 効果の色 / 強さ まで出る
            await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-style"]');s.scrollIntoView({block:'start'});return true})()`);
            const a = await ctx.shotInspector(cdp, `cards-${theme}`);
            await select(['c-0001', 'c-0004', 'c-0005']);
            await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-style"]');s.scrollIntoView({block:'start'});return true})()`);
            const b = await ctx.shotInspector(cdp, `cards-multi-${theme}`);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
            return { screenshots: [a, b] };
        });
    }
    await ctx.setTheme(cdp, 'dark');
    await ctx.setRightWidth(cdp, 360);

    // ---- 2. 各欄 → captions.json → 出力プレビュー（項目ごとに 1 行） ----
    const ID = 'c-0001', T = 1.6;
    const steps = [
        { field: '文字 / 色', act: () => setColor('caption-color', '#FFD400'), saved: r => r.text_style?.color === '#FFD400', preview: p => p.color === 'rgb(255, 212, 0)' },
        { field: '文字 / 大きさ', act: () => setNumber('caption-size', 52), saved: r => r.text_style?.size_px === 52, preview: (p, b) => parseFloat(p.lineFontSize) > parseFloat(b.lineFontSize) },
        { field: '縁取り / 色', act: () => setColor('caption-stroke-color', '#D12B2B'), saved: r => r.text_style?.stroke?.color === '#D12B2B', preview: p => /209, 43, 43/.test(`${p.strokeColor} ${p.textShadow}`) },
        { field: '縁取り / 太さ', act: () => setNumber('caption-stroke-width', 3), saved: r => r.text_style?.stroke?.width_px === 3, preview: (p, b) => `${p.strokeWidth}|${p.textShadow}` !== `${b.strokeWidth}|${b.textShadow}` },
        { field: '座布団 / 敷く', act: () => click(`${ROW('caption-style-bg-enabled')} input[type="checkbox"]`), saved: r => r.text_style?.background?.opacity === 0.6, preview: p => p.bgs.some(x => /rgba\(0, 0, 0, 0\.6\)/.test(x.bg)) },
        { field: '座布団 / 色', act: () => setColor('caption-background-color', '#1E3A8A'), saved: r => r.text_style?.background?.color === '#1E3A8A', preview: p => p.bgs.some(x => /30, 58, 138/.test(x.bg)) },
        { field: '座布団 / 不透明度', act: () => setNumber('caption-background-opacity', 85), saved: r => r.text_style?.background?.opacity === 0.85, preview: p => p.bgs.some(x => /30, 58, 138, 0\.85/.test(x.bg)) },
        { field: '座布団 / 角丸（スライダーの最大 = カプセル）', act: async () => {
            const max = await evalOn(cdp, `document.querySelector(${S(`${ROW('caption-background-radius')} input[type="range"]`)}).max`);
            out.capsuleMax = Number(max);
            await setNumber('caption-background-radius', Number(max));
        }, saved: r => r.text_style?.background?.radius_px === out.capsuleMax, preview: p => p.bgs.some(x => parseFloat(x.radius) >= 5) },
        { field: '座布団 / 形 まとめて', act: () => click(`${ROW('caption-background-mode')} button[data-value="block"]`), saved: r => r.text_style?.background?.mode === 'block', preview: (p, b) => S(p.bgs.map(x => x.cls)) !== S(b.bgs.map(x => x.cls)) },
        { field: '座布団 / 形 行ごと', act: () => click(`${ROW('caption-background-mode')} button[data-value="per-line"]`), saved: r => r.text_style?.background?.mode === 'per-line', preview: (p, b) => S(p.bgs.map(x => x.cls)) !== S(b.bgs.map(x => x.cls)) },
        { field: '効果 / 袋文字', act: () => click(`${ROW('caption-style-effect')} button[data-value="outline"]`), saved: r => r.text_style?.stroke?.width_px === 6 && r.text_style?.stroke?.color === '#000000', preview: (p, b) => `${p.strokeWidth}|${p.textShadow}` !== `${b.strokeWidth}|${b.textShadow}` },
        { field: '効果 / 効果の色', act: () => setColor('caption-style-effect-color', '#E02020'), saved: r => r.text_style?.stroke?.color === '#E02020', preview: p => /224, 32, 32/.test(`${p.strokeColor} ${p.textShadow}`) },
        { field: '効果 / 強さ', act: () => setNumber('caption-style-effect-strength', 9), saved: r => r.text_style?.stroke?.width_px === 9, preview: (p, b) => `${p.strokeWidth}|${p.textShadow}` !== `${b.strokeWidth}|${b.textShadow}` },
        { field: '効果 / なし', act: () => click(`${ROW('caption-style-effect')} button[data-value="none"]`), saved: r => r.text_style?.stroke?.width_px === 1.5 && r.text_style?.stroke?.color === '#000000', preview: (p, b) => `${p.strokeWidth}|${p.textShadow}` !== `${b.strokeWidth}|${b.textShadow}` },
        { field: '座布団 / 敷かない', act: () => click(`${ROW('caption-style-bg-enabled')} input[type="checkbox"]`), saved: r => r.text_style?.background?.opacity === 0, preview: p => !p.bgs.some(x => /30, 58, 138/.test(x.bg) && !/, 0\)$/.test(x.bg)) }
    ];
    await select([ID], T);
    await waitFor('c-0001 plate', () => plate(ID), 60_000);
    for (const step of steps) {
        await check(`write: ${step.field}`, async () => {
            await select([ID], T);
            await waitFor('plate', () => plate(ID), 30_000);
            const before = await plate(ID);
            await step.act();
            const row = await waitFor(`${step.field} saved`, async () => { const r = await rowOf(ID); return step.saved(r) && r; }, 20_000);
            await seek(T);
            const after = await waitFor(`${step.field} preview`, async () => { const p = await plate(ID); return p && step.preview(p, before) && p; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(ID)) }));
            const record = { field: step.field, text_style: row.text_style, previewBefore: { color: before.color, fontSize: before.lineFontSize, stroke: `${before.strokeWidth} ${before.strokeColor}`, textShadow: before.textShadow.slice(0, 80), bgs: before.bgs }, previewAfter: { color: after.color, fontSize: after.lineFontSize, stroke: `${after.strokeWidth} ${after.strokeColor}`, textShadow: (after.textShadow || '').slice(0, 80), bgs: after.bgs } };
            out.writes.push(record);
            return { pass: !after.unmatched, saved: row.text_style, preview: record.previewAfter };
        });
    }

    // ---- 3. 座布団の形の 2 択（2 行の字幕 c-0002） ----
    await check('座布団の形: 2 行の字幕で 行ごと / まとめて が切り替わる（プレビュー）', async () => {
        const ID2 = 'c-0002', T2 = 5.6;
        const shots = {};
        const bgsOf = {};
        for (const mode of ['per-line', 'block', 'per-line']) {
            await select([ID2], T2);
            const current = (await rowOf(ID2)).text_style?.background?.mode ?? 'per-line';
            if (current !== mode) {
                await click(`${ROW('caption-background-mode')} button[data-value="${mode}"]`);
                await waitFor(`mode ${mode}`, async () => (await rowOf(ID2)).text_style?.background?.mode === mode, 20_000);
            }
            await seek(T2);
            const opaque = q => q.bgs.filter(x => !/, 0\)$/.test(x.bg));
            const want = q => mode === 'block' ? opaque(q).length === 1 && /block/.test(opaque(q)[0].cls) : opaque(q).length >= 2 && opaque(q).every(x => /line/.test(x.cls));
            const p = await waitFor(`preview ${mode}`, async () => { const q = await plate(ID2); return q && want(q) && q; }, 30_000).catch(async () => plate(ID2));
            bgsOf[mode] = p.bgs;
            if (!shots[mode]) shots[mode] = await shotPreview(`bg-mode-${mode}`);
        }
        const perLine = bgsOf['per-line'].filter(x => !/, 0\)$/.test(x.bg));
        const block = bgsOf.block.filter(x => !/, 0\)$/.test(x.bg));
        return { pass: perLine.length >= 2 && block.length === 1, perLine, block, shots };
    });

    // ---- 4. 効果（書ける項目で表せるのは なし / 袋文字 の 2 種）: プレビュー ----
    await check('効果（r0 の回帰）: なし / 袋文字 のプレビュー（効果 5 種は l1-r1.mjs）', async () => {
        await select([ID], T);
        await click(`${ROW('caption-style-effect')} button[data-value="outline"]`);
        await waitFor('outline', async () => (await rowOf(ID)).text_style?.stroke?.width_px === 6, 20_000);
        await select([ID], T);
        await setColor('caption-style-effect-color', '#E02020');
        await waitFor('outline color', async () => (await rowOf(ID)).text_style?.stroke?.color === '#E02020', 20_000);
        await seek(T);
        const outline = await waitFor('preview outline', async () => { const q = await plate(ID); return q && /224, 32, 32/.test(q.strokeColor) && parseFloat(q.strokeWidth) >= 10 && q; }, 30_000).catch(() => plate(ID));
        const outlineShot = await shotPreview('effect-outline');
        const tiles = await evalOn(cdp, `[...document.querySelectorAll(${S(`${ROW('caption-style-effect')} button`)})].map(b=>({value:b.dataset.value,label:b.textContent.trim(),pressed:b.getAttribute('aria-pressed')}))`);
        await select([ID], T);
        await click(`${ROW('caption-style-effect')} button[data-value="none"]`);
        await waitFor('none', async () => (await rowOf(ID)).text_style?.stroke?.width_px === 1.5, 20_000);
        await seek(T);
        const none = await waitFor('preview none', async () => { const q = await plate(ID); return q && /0, 0, 0/.test(q.strokeColor) && parseFloat(q.strokeWidth) < 5 && q; }, 30_000).catch(() => plate(ID));
        const noneShot = await shotPreview('effect-none');
        out.effectTiles = tiles;
        return { pass: /224, 32, 32/.test(outline.strokeColor) && parseFloat(outline.strokeWidth) >= 10 && /0, 0, 0/.test(none.strokeColor) && parseFloat(none.strokeWidth) < 5, tiles, outline: { stroke: `${outline.strokeWidth} ${outline.strokeColor}`, textShadow: outline.textShadow.slice(0, 120) }, none: { stroke: `${none.strokeWidth} ${none.strokeColor}`, textShadow: none.textShadow.slice(0, 120) }, shots: [outlineShot, noneShot] };
    });

    // ---- 5. 複数選択（3 本）: 縁取りの太さ・座布団（敷く・形）を変えると 3 本とも書き換わる ----
    await check('複数選択 3 本: 縁取りの太さ・座布団を敷く・座布団の形 が 3 本とも書き換わる', async () => {
        const ids = ['c-0001', 'c-0004', 'c-0005'];
        const before = await Promise.all(ids.map(rowOf));
        await select(ids);
        await setNumber('caption-stroke-width', 4);
        await waitFor('multi stroke', async () => (await Promise.all(ids.map(rowOf))).every(r => r.text_style?.stroke?.width_px === 4), 20_000);
        await select(ids);
        const toggle = `${ROW('caption-style-bg-enabled')} input[type="checkbox"]`;
        await click(toggle);
        await waitFor('multi bg on', async () => (await Promise.all(ids.map(rowOf))).every(r => r.text_style?.background?.opacity === 0.6), 20_000);
        await select(ids);
        await click(`${ROW('caption-background-mode')} button[data-value="block"]`);
        await waitFor('multi block', async () => (await Promise.all(ids.map(rowOf))).every(r => r.text_style?.background?.mode === 'block'), 20_000);
        const after = await Promise.all(ids.map(rowOf));
        await select(ids);
        const shot = await ctx.shotInspector(cdp, 'multi-after-writes');
        return { pass: true, before: before.map(r => ({ id: r.id, text_style: r.text_style ?? null })), after: after.map(r => ({ id: r.id, text_style: r.text_style })), screenshot: shot };
    });

    // ---- 6. akari.inspector.revealField ----
    for (const field of ['caption-style-bg-color', 'caption-style-stroke-color', 'caption-style-color', 'caption-style']) {
        await check(`revealField ${field}`, async () => {
            await select(['c-0002'], 5.5);
            await evalOn(cdp, `(()=>{const r=document.querySelector(${S(INSPECTOR)});for(const e of [r,...r.querySelectorAll('*')])if(e.scrollTop)e.scrollTop=0;return true})()`);
            await evalOn(cdp, command('akari.inspector.revealField', { field }));
            const state = await waitFor('flash', () => evalOn(cdp, `(()=>{const t=document.querySelector(${S(`${INSPECTOR} [data-inspector-field="${field}"]`)});if(!t)return null;const r=t.getBoundingClientRect();const root=document.querySelector(${S(INSPECTOR)}).getBoundingClientRect();return{flashing:t.classList.contains('akari-inspector-reveal-flash'),inView:r.top>=root.top&&r.bottom<=root.bottom,top:Math.round(r.top),activeInTarget:t.contains(document.activeElement)&&document.activeElement!==document.body,active:document.activeElement?.tagName+':'+(document.activeElement?.type||''),tab:document.querySelector('[data-akari-ui="tab:inspector-text"]')?.classList.contains('is-active')}})()`).then(s => s && s.flashing && s), 5_000, 50);
            await sleep(250);
            const shot = await ctx.shotInspector(cdp, `reveal-${field}`);
            await sleep(300);
            const settled = await evalOn(cdp, `(()=>{const t=document.querySelector(${S(`${INSPECTOR} [data-inspector-field="${field}"]`)});const r=t.getBoundingClientRect();const root=document.querySelector(${S(INSPECTOR)}).getBoundingClientRect();return{inView:r.top>=root.top&&r.bottom<=root.bottom,top:Math.round(r.top),bottom:Math.round(r.bottom),rootBottom:Math.round(root.bottom)}})()`);
            Object.assign(state, { atFlash: { inView: state.inView, top: state.top }, inView: settled.inView, top: settled.top, bottom: settled.bottom, rootBottom: settled.rootBottom });
            await sleep(300);
            const later = await evalOn(cdp, `document.querySelector(${S(`${INSPECTOR} [data-inspector-field="${field}"]`)}).classList.contains('akari-inspector-reveal-flash')`);
            const wantFocus = field !== 'caption-style';
            return { pass: state.inView && state.tab && (!wantFocus || state.activeInTarget) && !later, ...state, flashRemovedAfterMs900: !later, screenshot: shot };
        });
    }

    // ---- 7. 幅 240 / 300 / 360 / 420 で横スクロール 0（ダーク / ライト・単体 / 複数） ----
    const MEASURE = `(()=>{const root=document.querySelector(${S(INSPECTOR)});const els=[root,...root.querySelectorAll('*')].filter(e=>e instanceof HTMLElement);const scrollers=els.filter(e=>e===root||['auto','scroll','overlay'].includes(getComputedStyle(e).overflowX)||['auto','scroll','overlay'].includes(getComputedStyle(e).overflowY));const bad=scrollers.filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth).map(e=>({cls:String(e.className).slice(0,60),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));const rr=root.getBoundingClientRect();const outside=[...root.querySelectorAll('[data-akari-ui^="section:inspector-style"] *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>rr.right+0.5}).slice(0,5).map(e=>({tag:e.tagName,cls:String(e.className).slice(0,50),right:Math.round(e.getBoundingClientRect().right),rootRight:Math.round(rr.right)}));return{root:{scrollWidth:root.scrollWidth,clientWidth:root.clientWidth},scrollers:scrollers.length,bad,outside}})()`;
    const widthRows = [];
    for (const theme of ['dark', 'light']) {
        await ctx.setTheme(cdp, theme);
        for (const width of [240, 300, 360, 420]) {
            await check(`width ${width} ${theme}: scrollWidth <= clientWidth`, async () => {
                const size = await ctx.setRightWidth(cdp, width);
                const res = {};
                for (const [name, ids, time] of [['single-outline', ['c-0003'], 9.5], ['multi', ['c-0001', 'c-0004', 'c-0005']]]) {
                    await select(ids, time);
                    await evalOn(cdp, `(()=>{for(const t of document.querySelectorAll(${S(`${INSPECTOR} .akari-inspector-section-toggle[aria-expanded="false"]`)}))t.click();return true})()`);
                    await sleep(400);
                    res[name] = await evalOn(cdp, MEASURE);
                    if (width === 240 && theme === 'dark' && name === 'single-outline') {
                        await evalOn(cdp, `document.querySelector('[data-akari-ui="section:inspector-style"]').scrollIntoView({block:'start'})`);
                        res.screenshot = await ctx.shotInspector(cdp, 'width-240-dark');
                    }
                }
                const pass = Object.values(res).filter(r => r && r.root).every(r => r.root.scrollWidth <= r.root.clientWidth && r.bad.length === 0 && r.outside.length === 0);
                widthRows.push({ theme, width, panel: size.panel, inspector: Math.round(size.inspector), single: res['single-outline'].root, multi: res.multi.root, bad: [...res['single-outline'].bad, ...res.multi.bad], outside: [...res['single-outline'].outside, ...res.multi.outside] });
                return { pass, size, ...res };
            });
        }
    }
    out.widths = widthRows;
    await ctx.setTheme(cdp, 'dark');
    await ctx.setRightWidth(cdp, 360);
}
