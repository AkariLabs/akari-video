// r1 の受け入れ条件の実測（l1.mjs after から runAfter の後に呼ばれる。ラッパー作成の検証スクリプト）。
// r1 で足した欄（太さ・行間・字間・余白）と効果 5 種（なし / 影 / 浮き出し / ネオン / 袋文字）、プリセット付き字幕への書き込み、
// 複数選択 3 本（太さ・行間・座布団）を、実マウス・実キーボード → captions.json → 出力プレビューの computed style で確かめる。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, sleep, waitEval } from './l1-lib.mjs';

async function waitFor(label, fn, timeoutMs = 30_000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(intervalMs); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

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

// プレビューの字幕 1 本: 文字（葉）の computed style・行の line-height・背景を持つ要素（padding 込み）。
const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const r0=p.getBoundingClientRect();if(!(r0.width>0&&r0.height>0))return null;const l=p.querySelector('.akari-caption__line')||p;const leaf=[...l.querySelectorAll('*')].find(e=>e.children.length===0&&(e.textContent||'').trim())||l;const cs=getComputedStyle(leaf);const lcs=getComputedStyle(l);const lr=l.getBoundingClientRect();const bgs=[...p.querySelectorAll('*')].map(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();return{cls:String(e.className).slice(0,50),bg:s.backgroundColor,padding:s.padding,radius:s.borderRadius,w:Math.round(r.width),h:Math.round(r.height)}}).filter(x=>x.bg&&x.bg!=='rgba(0, 0, 0, 0)'&&x.bg!=='transparent'&&x.w>0);return{text:(p.textContent||'').trim(),lines:p.querySelectorAll('.akari-caption__line').length,color:cs.color,fontWeight:cs.fontWeight,lineFontWeight:lcs.fontWeight,letterSpacing:cs.letterSpacing,lineLetterSpacing:lcs.letterSpacing,lineHeight:lcs.lineHeight,lineFontSize:lcs.fontSize,lineBox:{w:Math.round(lr.width),h:Math.round(lr.height)},plateBox:{w:Math.round(r0.width),h:Math.round(r0.height)},strokeWidth:cs.webkitTextStrokeWidth,strokeColor:cs.webkitTextStrokeColor,textShadow:cs.textShadow,bgs}})()`;
const FRAME_RECT = `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return r?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`;
// 効果の影があるか。描画の既定（shadow / glow 未指定のときの 0 2px 8px rgba(0,0,0,.35)。r0 の BEFORE から同じ）と
// 透明（alpha 0）の影は「効果なし」とみなす。
const DEFAULT_SOFT_SHADOW = 'rgba(0, 0, 0, 0.35) 0px 2px 8px';
const visibleShadow = shadow => typeof shadow === 'string' && shadow !== 'none' && shadow !== DEFAULT_SOFT_SHADOW
    && /rgba?\((?:\d+, ){2}\d+(?:, (?:0?\.\d*[1-9]\d*|1))?\)/.test(shadow.replace(/rgba\(\d+, \d+, \d+, 0\)/g, ''));

export async function runR1(ctx) {
    const { check, out, session, PORT, EVIDENCE } = ctx;
    const cdp = session.cdp;
    const PROJECT = ctx.PROJECT;
    const editUri = `file://${path.join(PROJECT, 'edit.json')}`;
    const captionsOf = async () => JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8')).captions;
    const rowOf = async id => (await captionsOf()).find(c => c.id === id);
    const seek = time => evalOn(cdp, command('akari.preview.seekOutput', { editUri, time }));
    const v = await view(PORT);
    const INSPECTOR = '[data-akari-ui="panel:inspector"]';
    const ROW = name => `${INSPECTOR} [data-akari-field="${name}"]`;
    out.r1 = { writes: [], screenshots: [] };

    async function pointOf(selector) {
        await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 30_000 });
        await sleep(250);
        return evalOn(cdp, `(()=>{const r=document.querySelector(${S(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    }
    async function click(selector) { const p = await pointOf(selector); await realClick(cdp, p.x, p.y); await sleep(300); }
    async function key(k, code, vk, modifiers = 0, commands) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    }
    async function typeInto(selector, text) {
        const p = await pointOf(selector);
        await realClick(cdp, p.x, p.y); await sleep(150);
        await key('a', 'KeyA', 65, 4, ['selectAll']);
        await cdp.send('Input.insertText', { text: String(text) });
        await sleep(100);
        await key('Enter', 'Enter', 13); await sleep(150);
        await key('Tab', 'Tab', 9); await sleep(300);
    }
    const setNumber = (field, value) => typeInto(`${ROW(field)} input[type="number"]`, value);
    const setColor = (field, hex) => typeInto(`${ROW(field)} input[type="text"]`, hex);
    const plate = id => v.eval(PLATE(id));
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
        const file = `r1-${name}.png`;
        await writeFile(path.join(EVIDENCE, file), Buffer.from(data, 'base64'));
        out.r1.screenshots.push(file);
        return file;
    }
    async function shotInspector(name) {
        const file = await ctx.shotInspector(cdp, `r1-${name}`);
        out.r1.screenshots.push(file);
        return file;
    }
    const cardState = () => evalOn(cdp, `(()=>{const root=document.querySelector(${S(INSPECTOR)});return[...root.querySelectorAll('[data-akari-ui^="section:inspector-style"]')].map(s=>({id:s.getAttribute('data-akari-ui').slice(18),label:(s.querySelector('.akari-inspector-section-toggle')?.textContent||'').trim(),fields:[...s.querySelectorAll('[data-akari-field]')].map(f=>f.getAttribute('data-akari-field'))}))})()`);
    const pressed = field => evalOn(cdp, `[...document.querySelectorAll(${S(`${ROW(field)} button`)})].filter(b=>b.getAttribute('aria-pressed')==='true'||b.classList.contains('is-active')||b.classList.contains('is-selected')).map(b=>b.dataset.value)`);

    // ---- R1-1. カードの中身（文字: 太さ・行間・字間 / 座布団: 余白 / 効果: 5 タイル）とスクリーンショット ----
    await check('r1 cards: 文字に 太さ・行間・字間、座布団に 余白、効果に 5 タイル（単体 / 複数 / プリセット / 置いた文字）', async () => {
        const result = {};
        for (const [name, ids, time] of [['single', ['c-0006'], 25.6], ['multi', ['c-0006', 'c-0007', 'c-0008']], ['preset', ['c-0007'], 29.6], ['placed', ['c-0101'], 13.5]]) {
            await select(ids, time);
            result[name] = await cardState();
        }
        const tiles = await (async () => { await select(['c-0006'], 25.6); return evalOn(cdp, `[...document.querySelectorAll(${S(`${ROW('caption-style-effect')} button`)})].map(b=>({value:b.dataset.value,label:b.textContent.trim(),sample:Boolean(b.querySelector('.akari-caption-effect-sample')),emoji:/\\p{Extended_Pictographic}/u.test(b.textContent)}))`); })();
        const want = { '文字': ['caption-font-weight', 'caption-line-height', 'caption-letter-spacing'], '座布団': ['caption-background-padding'] };
        const has = cards => Object.entries(want).every(([label, fields]) => fields.every(f => cards.find(c => c.label === label)?.fields.includes(f)));
        const order = cards => S(cards.map(c => c.label)) === S(['文字', '縁取り', '座布団', '効果', '位置']);
        const pass = Object.values(result).every(cards => has(cards) && order(cards))
            && S(tiles.map(t => t.value)) === S(['none', 'shadow', 'raised', 'neon', 'outline'])
            && tiles.every(t => t.sample && !t.emoji);
        return { pass, tiles, cards: Object.fromEntries(Object.entries(result).map(([k, cards]) => [k, cards.map(c => ({ label: c.label, fields: c.fields }))])) };
    });
    for (const theme of ['dark', 'light']) {
        await check(`r1 cards screenshot ${theme}`, async () => {
            await ctx.setTheme(cdp, theme);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1700, deviceScaleFactor: 1, mobile: false });
            await ctx.setRightWidth(cdp, 360);
            await select(['c-0007'], 29.6);
            await evalOn(cdp, `document.querySelector('[data-akari-ui="section:inspector-style"]').scrollIntoView({block:'start'})`);
            const a = await shotInspector(`cards-${theme}`);
            await select(['c-0006', 'c-0007', 'c-0008']);
            await evalOn(cdp, `document.querySelector('[data-akari-ui="section:inspector-style"]').scrollIntoView({block:'start'})`);
            const b = await shotInspector(`cards-multi-${theme}`);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
            return { screenshots: [a, b] };
        });
    }
    await ctx.setTheme(cdp, 'dark');
    await ctx.setRightWidth(cdp, 360);

    // ---- R1-2. 欄ごとの書き込み（c-0006・2 行・素）→ captions.json → 出力プレビュー ----
    const ID = 'c-0006', T = 25.6;
    const RED = '#E02020';
    const hasRed = s => /224, 32, 32/.test(s || '');
    const steps = [
        { field: '文字 / 太さ 普通', act: () => click(`${ROW('caption-font-weight')} button[data-value="400"]`), saved: r => r.text_style?.font_weight === 400, preview: p => p.fontWeight === '400' },
        { field: '文字 / 太さ 極太', act: () => click(`${ROW('caption-font-weight')} button[data-value="900"]`), saved: r => r.text_style?.font_weight === 900, preview: p => p.fontWeight === '900' },
        { field: '文字 / 行間', act: () => setNumber('caption-line-height', 1.9), saved: r => r.text_style?.line_height === 1.9, preview: (p, b) => parseFloat(p.lineHeight) > parseFloat(b.lineHeight) },
        { field: '文字 / 字間', act: () => setNumber('caption-letter-spacing', 0.2), saved: r => r.text_style?.letter_spacing_em === 0.2, preview: p => parseFloat(p.letterSpacing) > 0 || parseFloat(p.lineLetterSpacing) > 0 },
        { field: '座布団 / 敷く', act: () => click(`${ROW('caption-style-bg-enabled')} input[type="checkbox"]`), saved: r => r.text_style?.background?.opacity === 0.6, preview: p => p.bgs.some(x => /rgba\(0, 0, 0, 0\.6\)/.test(x.bg)) },
        { field: '座布団 / 余白', act: () => setNumber('caption-background-padding', 14), saved: r => r.text_style?.background?.padding_px === 14, preview: p => p.bgs.some(x => /14px/.test(x.padding)) },
        { field: '効果 / 影', act: () => click(`${ROW('caption-style-effect')} button[data-value="shadow"]`), saved: r => Boolean(r.text_style?.shadow?.color) && !r.text_style?.glow, preview: p => visibleShadow(p.textShadow) },
        { field: '効果 / 影 の色', act: () => setColor('caption-style-effect-color', RED), saved: r => r.text_style?.shadow?.color === RED, preview: p => hasRed(p.textShadow) },
        { field: '効果 / 影 の強さ', act: () => setNumber('caption-style-effect-strength', 2), saved: r => r.text_style?.shadow?.distance_px > 8.5, preview: (p, b) => p.textShadow !== b.textShadow },
        { field: '効果 / 浮き出し', act: () => click(`${ROW('caption-style-effect')} button[data-value="raised"]`), saved: r => r.text_style?.shadow?.blur_px > r.text_style?.shadow?.distance_px, preview: (p, b) => visibleShadow(p.textShadow) && p.textShadow !== b.textShadow },
        { field: '効果 / 浮き出し の色', act: () => setColor('caption-style-effect-color', RED), saved: r => r.text_style?.shadow?.color === RED, preview: p => hasRed(p.textShadow) },
        { field: '効果 / ネオン', act: () => click(`${ROW('caption-style-effect')} button[data-value="neon"]`), saved: r => Boolean(r.text_style?.glow?.color) && !(r.text_style?.shadow && r.text_style.shadow.opacity !== 0), preview: p => /57, 213, 255/.test(p.textShadow) },
        { field: '効果 / ネオン の強さ', act: () => setNumber('caption-style-effect-strength', 1.5), saved: r => r.text_style?.glow?.spread === 18, preview: (p, b) => p.textShadow !== b.textShadow },
        { field: '効果 / ネオン の色', act: () => setColor('caption-style-effect-color', RED), saved: r => r.text_style?.glow?.color === RED, preview: p => hasRed(p.textShadow) },
        { field: '効果 / 袋文字', act: () => click(`${ROW('caption-style-effect')} button[data-value="outline"]`), saved: r => r.text_style?.stroke?.width_px === 6 && !r.text_style?.glow && !r.text_style?.shadow, preview: p => parseFloat(p.strokeWidth) >= 10 && !visibleShadow(p.textShadow) },
        { field: '効果 / なし', act: () => click(`${ROW('caption-style-effect')} button[data-value="none"]`), saved: r => !r.text_style?.glow && !r.text_style?.shadow && r.text_style?.stroke?.width_px === 1.5, preview: p => parseFloat(p.strokeWidth) < 5 && !visibleShadow(p.textShadow) }
    ];
    await select([ID], T);
    await waitFor(`${ID} plate`, () => plate(ID), 60_000);
    for (const step of steps) {
        await check(`r1 write: ${step.field}`, async () => {
            await select([ID], T);
            await waitFor('plate', () => plate(ID), 30_000);
            const before = await plate(ID);
            await step.act();
            const row = await waitFor(`${step.field} saved`, async () => { const r = await rowOf(ID); return step.saved(r) && r; }, 20_000);
            await seek(T);
            const after = await waitFor(`${step.field} preview`, async () => { const p = await plate(ID); return p && step.preview(p, before) && p; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(ID)) }));
            const brief = p => ({ fontWeight: p.fontWeight, lineHeight: p.lineHeight, letterSpacing: p.letterSpacing, stroke: `${p.strokeWidth} ${p.strokeColor}`, textShadow: (p.textShadow || '').slice(0, 160), bgs: p.bgs, lineBox: p.lineBox });
            const record = { field: step.field, text_style: row.text_style, previewBefore: brief(before), previewAfter: brief(after), effectPressed: await pressed('caption-style-effect').catch(() => null) };
            out.r1.writes.push(record);
            if (/^効果 \/ (影|浮き出し|ネオン|袋文字|なし)$/.test(step.field)) {
                record.screenshot = await shotPreview(`effect-${{ '効果 / 影': 'shadow', '効果 / 浮き出し': 'raised', '効果 / ネオン': 'neon', '効果 / 袋文字': 'outline', '効果 / なし': 'none' }[step.field]}`);
            }
            return { pass: !after.unmatched, saved: row.text_style, preview: record.previewAfter };
        });
    }
    // 書き出し比較用: 効果の色を赤にした 影 / 浮き出し / ネオン / 袋文字 の保存値（export-frame-r1.mjs が読む）
    await check('r1 書き出し用の保存値（効果 4 種 × 効果の色 赤 + なし）', async () => {
        const variants = {};
        for (const [name, tile] of [['shadow', 'shadow'], ['raised', 'raised'], ['neon', 'neon'], ['outline', 'outline'], ['none', 'none']]) {
            await select([ID], T);
            await click(`${ROW('caption-style-effect')} button[data-value="${tile}"]`);
            await waitFor(`${tile} saved`, async () => { const r = await rowOf(ID); return tile === 'none' ? !r.text_style?.shadow && !r.text_style?.glow && r.text_style?.stroke?.width_px === 1.5 : tile === 'neon' ? r.text_style?.glow : tile === 'outline' ? r.text_style?.stroke?.width_px === 6 : r.text_style?.shadow; }, 20_000);
            if (tile !== 'none') {
                await select([ID], T);
                await setColor('caption-style-effect-color', RED);
                await waitFor(`${tile} red`, async () => { const r = await rowOf(ID); return S(r.text_style).includes(RED); }, 20_000);
            }
            await seek(T);
            const p = await waitFor(`${tile} preview`, async () => { const q = await plate(ID); return q && (tile === 'none' ? !hasRed(q.textShadow) && !hasRed(q.strokeColor) : hasRed(q.textShadow) || hasRed(q.strokeColor)) && q; }, 20_000).catch(() => plate(ID));
            variants[name] = { text_style: (await rowOf(ID)).text_style, preview: { textShadow: p.textShadow.slice(0, 200), stroke: `${p.strokeWidth} ${p.strokeColor}` } };
        }
        out.r1.exportVariants = variants;
        const pass = ['shadow', 'raised', 'neon', 'outline'].every(k => hasRed(variants[k].preview.textShadow) || hasRed(variants[k].preview.stroke))
            && !hasRed(variants.none.preview.textShadow) && !hasRed(variants.none.preview.stroke);
        return { pass, variants };
    });

    // ---- R1-3. プリセット付き字幕（c-0007 = subtitle-variety: weight 700 + shadow）----
    const PID = 'c-0007', PT = 29.6;
    await check('r1 プリセット付き字幕: 太さ 普通 が効く・効果 なし で影が消える・影 に戻せる', async () => {
        await select([PID], PT);
        const base = await waitFor('preset plate', () => plate(PID), 30_000);
        const effectBefore = await pressed('caption-style-effect');
        await click(`${ROW('caption-font-weight')} button[data-value="400"]`);
        const savedWeight = await waitFor('preset weight', async () => { const r = await rowOf(PID); return (r.text_style?.font_weight === 400) && r; }, 20_000);
        await seek(PT);
        const weightPreview = await waitFor('preset weight preview', async () => { const p = await plate(PID); return p && p.fontWeight === '400' && p; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(PID)) }));
        await select([PID], PT);
        await click(`${ROW('caption-style-effect')} button[data-value="none"]`);
        const savedNone = await waitFor('preset none', async () => { const r = await rowOf(PID); return r.text_style?.shadow?.opacity === 0 && r; }, 20_000).catch(async () => rowOf(PID));
        await seek(PT);
        const nonePreview = await waitFor('preset none preview', async () => { const p = await plate(PID); return p && !visibleShadow(p.textShadow) && p; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(PID)) }));
        await select([PID], PT);
        const effectAfterNone = await pressed('caption-style-effect');
        const noneShot = await shotPreview('preset-effect-none');
        await click(`${ROW('caption-style-effect')} button[data-value="shadow"]`);
        const savedShadow = await waitFor('preset shadow', async () => { const r = await rowOf(PID); return r.text_style?.shadow?.opacity > 0 && r; }, 20_000).catch(async () => rowOf(PID));
        await seek(PT);
        const shadowPreview = await waitFor('preset shadow preview', async () => { const p = await plate(PID); return p && visibleShadow(p.textShadow) && p; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(PID)) }));
        const pass = !weightPreview.unmatched && !nonePreview.unmatched && !shadowPreview.unmatched && S(effectAfterNone) === S(['none']);
        return { pass, base: { fontWeight: base.fontWeight, textShadow: base.textShadow.slice(0, 120) }, effectBefore, weight: { saved: savedWeight.text_style, fontWeight: weightPreview.fontWeight }, none: { saved: savedNone.text_style, textShadow: nonePreview.textShadow, pressed: effectAfterNone, screenshot: noneShot }, shadow: { saved: savedShadow.text_style, textShadow: (shadowPreview.textShadow || '').slice(0, 120) } };
    });

    // ---- R1-4. 複数選択 3 本（素 2 行 / プリセット / 素）: 太さ・行間・座布団（敷く・形・余白）----
    await check('r1 複数選択 3 本: 太さ・行間・座布団（敷く・まとめて・余白）が 3 本とも書き換わる', async () => {
        const ids = ['c-0006', 'c-0007', 'c-0008'];
        const before = await Promise.all(ids.map(rowOf));
        const all = pred => async () => (await Promise.all(ids.map(rowOf))).every(pred);
        await select(ids);
        await click(`${ROW('caption-font-weight')} button[data-value="900"]`);
        await waitFor('multi weight', all(r => r.text_style?.font_weight === 900 && (r.text_style?.weight === undefined || r.text_style.weight === 900)), 20_000);
        await select(ids);
        await setNumber('caption-line-height', 1.6);
        await waitFor('multi line height', all(r => r.text_style?.line_height === 1.6), 20_000);
        await select(ids);
        const bgOn = await evalOn(cdp, `document.querySelector(${S(`${ROW('caption-style-bg-enabled')} input[type="checkbox"]`)}).checked`);
        if (!bgOn) {
            await click(`${ROW('caption-style-bg-enabled')} input[type="checkbox"]`);
            await waitFor('multi bg on', all(r => r.text_style?.background?.opacity > 0), 20_000);
            await select(ids);
        }
        await click(`${ROW('caption-background-mode')} button[data-value="block"]`);
        await waitFor('multi block', all(r => r.text_style?.background?.mode === 'block'), 20_000);
        await select(ids);
        await setNumber('caption-background-padding', 10);
        await waitFor('multi padding', all(r => r.text_style?.background?.padding_px === 10), 20_000);
        const after = await Promise.all(ids.map(rowOf));
        await select(ids);
        const shot = await shotInspector('multi-after-writes');
        const previews = {};
        for (const [id, t] of [['c-0006', 25.6], ['c-0007', 29.6], ['c-0008', 33.6]]) {
            await seek(t);
            const p = await waitFor(`${id} preview`, async () => { const q = await plate(id); return q && q.fontWeight === '900' && q.bgs.some(x => /block/.test(x.cls)) && q; }, 20_000).catch(async () => ({ unmatched: true, ...(await plate(id)) }));
            previews[id] = { unmatched: Boolean(p.unmatched), fontWeight: p.fontWeight, lineHeight: p.lineHeight, bgs: p.bgs };
        }
        const pass = Object.values(previews).every(p => !p.unmatched);
        return { pass, before: before.map(r => ({ id: r.id, style_preset: r.style_preset ?? null, text_style: r.text_style ?? null })), after: after.map(r => ({ id: r.id, text_style: r.text_style })), previews, screenshot: shot };
    });

    // ---- R1-5. 取り消し: 効果 1 回 = undo 1 回で元へ（c-0008）----
    await check('r1 取り消し: 効果（影）1 回の書き込みが 1 回の取り消しで戻る', async () => {
        const UID = 'c-0008';
        await select([UID], 33.6);
        const before = (await rowOf(UID)).text_style ?? null;
        await click(`${ROW('caption-style-effect')} button[data-value="shadow"]`);
        await waitFor('undo target shadow', async () => Boolean((await rowOf(UID)).text_style?.shadow), 20_000);
        // akari.timeline.undo はタイムラインにフォーカスがあるときだけハンドラが有効なので、ショートカットと同じ履歴サービスの undo() を直接呼ぶ。
        const commandId = 'AkariEditHistoryService.undo()';
        await evalOn(cdp, `(async()=>{const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];const k=keys.find(k=>typeof k==='function'&&['undo','redo','push','isTop','setMaterialTrial'].every(n=>typeof k.prototype?.[n]==='function'));if(!k)throw new Error('history service missing');await c.get(k).undo();return true})()`);
        const restored = await waitFor('undo restored', async () => { const r = await rowOf(UID); return S(r.text_style ?? null) === S(before) && r; }, 20_000).catch(async () => ({ unmatched: true, ...(await rowOf(UID)) }));
        return { pass: !restored.unmatched, commandId, before, after: restored.text_style ?? null };
    });
}
