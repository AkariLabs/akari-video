import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick, screenshot } from '../timeline-dnd-polish/scripts/cdp-lib.mjs';
import { launch, command, sleep, waitEval } from '../timeline-dnd-polish/scripts/l1-lib.mjs';
import { view } from '../timeline-dnd-polish/scripts/l1-common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const shell = path.join(repo, 'apps/shell');
const mode = process.argv[2] || 'before';
const review = mode === 'after-review';
const workspace = path.join(os.tmpdir(), `akari-tl-inspector-multiselect-text-${mode}`);
const project = path.join(workspace, 'project');
const isoDir = path.join(workspace, 'profile');
const output = path.join(here, mode);
await mkdir(project, { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(output, { recursive: true });
const media = path.join(project, 'assets/base.mp4');
const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x27313f:size=1280x720:rate=30:duration=12',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media]);
if (ff.status !== 0) throw new Error(String(ff.stderr));
const captions = { default_text_style: { zone: 'bottom' }, captions: [
    { id: 'c-0001', start: 3, end: 6, text: '話した言葉', speaker: null, sourceRef: null,
        edited: false, src: 'a', time_domain: 'source',
        ...(review ? { text_style: { animation: { out: { id: 'fade-in-out' } } } } : {}) },
    { id: 'c-0002', start: 3, end: 6, text: '置いた文字', speaker: null, sourceRef: null,
        edited: true, time_domain: 'output',
        ...(review ? { text_style: { animation: { out: { id: 'slide-left' } } } } : {}) }
] };
const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks: [
        { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: 360,
            source: { kind: 'media', src: 'a', in: 0, out: 12, speed: 1 } }] },
        { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕',
            at: 0, duration: 360, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
    ] };
await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
const projectReal = await realpath(project);
let session;
const errors = [];
try {
    session = await launch({ shellDir: shell,
        electron: path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        project: projectReal, port: 9478, isoDir });
    session.cdp.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails?.text ?? 'exception'));
    if (!await evalOn(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`)) {
        await evalOn(session.cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.annotations.open');return true})()`);
        const picker = await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0 ? 'open' : document.body.innerText.includes('タイムラインedit.json') ? 'picker' : null`, { label: 'timeline open or picker' });
        if (picker === 'picker') {
            const first = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.monaco-list-row[role="option"]')?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
            if (first) await realClick(session.cdp, first.x, first.y, { clickCount: 2 });
        }
    }
    await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`, { label: 'caption chips', timeoutMs: 120000 });
    await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(projectReal, 'edit.json')}`, time: 4 }));
    await sleep(2000);
    await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='キャンセル');b?.click();return !!b})()`);
    const chips = await evalOn(session.cdp, `([...document.querySelectorAll('[data-akari-item-kind="caption"][data-akari-item-id]')].map(e=>({id:e.dataset.akariItemId,text:e.textContent?.trim().slice(0,30),rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()})))`);
    const click = async (id, modifiers = 0) => {
        const point = await evalOn(session.cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-item-kind="caption"][data-akari-item-id]')].find(e=>e.getAttribute('data-akari-item-id')===${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        if (!point) return false;
        await realClick(session.cdp, point.x, point.y, { modifiers });
        await sleep(400);
        return true;
    };
    const singleFonts = [];
    if (review) for (const [id, fontId] of [['c-0001', 'noto-serif-jp'], ['c-0002', 'klee-one']]) {
        await click(id);
        await evalOn(session.cdp, command('akari.inspector.open'));
        await sleep(400);
        const button = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-akari-ui="action:inspector-caption-font-family"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        if (button) await realClick(session.cdp, button.x, button.y);
        await sleep(300);
        const opened = await evalOn(session.cdp, `Boolean(document.querySelector('[data-akari-caption-panel="font"]'))`);
        await screenshot(session.cdp, path.join(output, `font-${id}-panel.png`));
        let chosen = false;
        if (opened) {
            await waitEval(session.cdp, `Boolean(document.querySelector('[data-akari-font-row="${fontId}"]'))`,
                { label: `${fontId} font row`, timeoutMs: 30000 });
            chosen = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-akari-font-row="${fontId}"] button:nth-of-type(2)');e?.click();return !!e})()`);
            await sleep(750);
        }
        await screenshot(session.cdp, path.join(output, `font-${id}-applied.png`));
        singleFonts.push({ id, fontId, opened, chosen,
            captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
            errorNotice: await evalOn(session.cdp, `document.body.innerText.includes('フォントパネルを開けませんでした')`) });
        await evalOn(session.cdp, command('akari.captionPanel.close'));
    }
    await click('c-0001');
    await click('c-0002', 8);
    await evalOn(session.cdp, command('akari.inspector.open'));
    await sleep(500);
    const selection = await evalOn(session.cdp, `({tabs:[...document.querySelectorAll('.akari-inspector-tab')].map(x=>x.textContent?.trim()),fields:[...document.querySelectorAll('[data-akari-field]')].map(x=>x.getAttribute('data-akari-field')),selected:[...document.querySelectorAll('[data-akari-item-kind="caption"].is-selected')].map(x=>x.dataset.akariItemId)})`);
    await screenshot(session.cdp, path.join(output, 'selected.png'));
    const fontButton = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-akari-ui="action:inspector-caption-font-family"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    let font = { button: Boolean(fontButton) };
    if (fontButton) {
        await realClick(session.cdp, fontButton.x, fontButton.y);
        await sleep(700);
        font = await evalOn(session.cdp, `({panel:!!document.querySelector('.akari-caption-panel'),notice:[...document.querySelectorAll('[role="alert"],.theia-notification-list-item')].map(e=>e.textContent?.trim()).filter(Boolean).slice(-4)})`);
        await screenshot(session.cdp, path.join(output, 'font.png'));
    }
    const previewTab = await evalOn(session.cdp, `(()=>{const e=[...document.querySelectorAll('.lm-TabBar-tabLabel')].find(e=>e.textContent?.includes('出力プレビュー'));if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (previewTab) await realClick(session.cdp, previewTab.x, previewTab.y);
    const preview = await view(9478);
    const plateState = `([...document.querySelectorAll('.caption-row-plate')].map(p=>{const l=p.querySelector('.akari-caption__line');const s=l&&getComputedStyle(l);return{id:p.id,text:l?.textContent?.trim().slice(0,30),color:s?.color,stroke:s?.webkitTextStroke,background:s?.backgroundImage,fill:s?.webkitTextFillColor}}))`;
    await evalOn(session.cdp, `(window.__styleEvents=[],window.addEventListener('akari-caption-panel-preview',e=>window.__styleEvents.push(e.detail)),true)`);
    const modelState = `(window.akari.previewCaptions||[]).map(c=>({id:c.sourceCueId||c.id,stroke:c.textStyle?.stroke,fill:c.textStyle?.fill_gradient,vars:c.textStyleVars&&{'--caption-fill-gradient':c.textStyleVars['--caption-fill-gradient'],'--caption-webkit-text-stroke':c.textStyleVars['--caption-webkit-text-stroke']}}))`;
    const plates = await preview.eval(plateState);
    const samplePlayback = async () => preview.eval(`(async()=>{const clock=window.akari.frameEngineClock;if(!clock)return{available:false};clock.play(3.1);const intervals=[];await new Promise(resolve=>{let last=performance.now();const tick=()=>{const now=performance.now();intervals.push(now-last);last=now;if(intervals.length<45)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});clock.pause(3.9);return{available:true,intervals}})()`);
    const playbackBefore = await samplePlayback();
    const cardPoint = async id => evalOn(session.cdp, `(()=>{const e=document.querySelector('.akari-effect-card[data-value="${id}"]');if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const effectPoint = await cardPoint('ol-thick');
    let hover = null, applied = null, gradient = null;
    if (effectPoint) {
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: effectPoint.x, y: effectPoint.y, button: 'none' });
        await sleep(180);
        hover = await preview.eval(plateState);
        await screenshot(session.cdp, path.join(output, 'hover.png'));
        await preview.eval(`(window.__captionFrameSamples=[],window.__captionFrameSampler=(n=>{let last=performance.now();const tick=()=>{const now=performance.now();window.__captionFrameSamples.push({dt:now-last,plates:${plateState},model:${modelState}});last=now;if(window.__captionFrameSamples.length<n)requestAnimationFrame(tick)};requestAnimationFrame(tick)}),window.__captionFrameSampler(30),true)`);
        await realClick(session.cdp, effectPoint.x, effectPoint.y);
        await sleep(1000);
        applied = { captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
            frames: await preview.eval('window.__captionFrameSamples'), plates: await preview.eval(plateState) };
        await screenshot(session.cdp, path.join(output, 'outline.png'));
        const gradientPoint = await cardPoint('fill-sunset');
        if (gradientPoint) {
            await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gradientPoint.x, y: gradientPoint.y, button: 'none' });
            await sleep(120);
            await preview.eval(`(window.__captionFrameSamples=[],window.__captionFrameSampler(30),true)`);
            await realClick(session.cdp, gradientPoint.x, gradientPoint.y);
            await sleep(1000);
            gradient = { captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
                frames: await preview.eval('window.__captionFrameSamples'), plates: await preview.eval(plateState) };
            await screenshot(session.cdp, path.join(output, 'gradient.png'));
        }
    }
    const playbackAfter = gradient ? await samplePlayback() : null;
    const historyButton = async label => {
        const point = await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.title.includes(${JSON.stringify(label)}));if(!b||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        if (!point) return false;
        await realClick(session.cdp, point.x, point.y);
        return true;
    };
    const undoEffectClicked = await historyButton('元に戻す (⌘Z)');
    await sleep(500);
    const undoEffect = { clicked: undoEffectClicked,
        captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
        plates: await preview.eval(plateState), model: await preview.eval(modelState) };
    const redoEffectClicked = await historyButton('やり直す (⇧⌘Z)');
    await sleep(500);
    const redoEffect = { clicked: redoEffectClicked,
        captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')) };
    let shadow = null, undoShadow = null;
    if (review) {
        const shadowPoint = await cardPoint('sh-soft');
        if (shadowPoint) {
            await realClick(session.cdp, shadowPoint.x, shadowPoint.y);
            await sleep(800);
            shadow = { captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
                plates: await preview.eval(plateState) };
            await screenshot(session.cdp, path.join(output, 'shadow.png'));
            const clicked = await historyButton('元に戻す (⌘Z)');
            await sleep(500);
            undoShadow = { clicked, captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')) };
        }
    }
    const motionTabPoint = await evalOn(session.cdp, `(()=>{const e=[...document.querySelectorAll('.akari-inspector-tab')].find(e=>e.textContent?.trim()==='動き');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (motionTabPoint) await realClick(session.cdp, motionTabPoint.x, motionTabPoint.y);
    await sleep(250);
    const motionCards = await evalOn(session.cdp, `([...document.querySelectorAll('.akari-caption-motion-card')].map(e=>({id:e.dataset.motionId,kind:e.dataset.motionKind})))`);
    const fade = motionCards.find(card => card.id === 'fade-in-out' || card.id === 'fade');
    if (fade) {
        await evalOn(session.cdp, `(()=>{const e=[...document.querySelectorAll('.akari-caption-motion-card')].find(e=>e.dataset.motionId==='${fade.id}');e?.click();return !!e})()`);
        await sleep(1000);
    }
    const motion = { cards: motionCards, fade: fade?.id ?? null,
        captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')) };
    await screenshot(session.cdp, path.join(output, 'motion.png'));
    const undoMotionClicked = fade ? await historyButton('元に戻す (⌘Z)') : false;
    await sleep(500);
    const undoMotion = { clicked: undoMotionClicked,
        captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')),
        plates: await preview.eval(plateState) };
    await evalOn(session.cdp, `([...document.querySelectorAll('.akari-inspector-tab')].find(e=>e.textContent?.trim()==='情報')?.click(),true)`);
    await sleep(100);
    const info = await evalOn(session.cdp, `([...document.querySelectorAll('[data-akari-field^="caption-multi-info"]')].map(e=>e.textContent?.trim()))`);
    preview.cdp.close();
    const styleEvents = await evalOn(session.cdp, 'window.__styleEvents');
    await writeFile(path.join(output, 'results.json'), `${JSON.stringify({ chips, selection, font, singleFonts,
        plates, hover, applied, gradient, shadow, undoShadow, styleEvents,
        playbackBefore, playbackAfter,
        undoEffect, redoEffect, motion, undoMotion, info, errors,
        captions: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')) }, null, 2)}\n`);
} finally {
    session?.cdp.close();
    if (session?.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch {}
    }
}
