#!/usr/bin/env node
// インスペクタのフェードの形のセレクト（ラッパー作成の検証スクリプト）。
// BGM クリップを選んでインスペクタの「音声」タブを出し、「フェードインの形」を slow・「フェードアウトの形」を equal_power にする。
// 各変更で edit.json に書かれること・Cmd+Z 1 手で byte 一致に戻ることを見る。最後は形を付けたまま残す（開き直しの確認用）。
// 使い方: node inspector-shape.mjs <project> <out.json>
import { writeFileSync } from 'node:fs';
import { CLIP, UNDO, attach, audioItem, editText, evalOn, key, sleep, waitChange, waitEval } from './l1-common.mjs';

const [project, out] = process.argv.slice(2);
const cdp = await attach();
const ev = expr => evalOn(cdp, expr);
const SHELL = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');return window.theia.container.get(k)})()`;
const SELECTS = `[...document.querySelectorAll('select')].filter(s=>!s.closest('.dialogOverlay')&&!s.closest('[data-akari-item-kind]')&&[...s.options].some(o=>o.value==='equal_power')).map(s=>{const r=s.getBoundingClientRect();return{value:s.value,visible:r.width>0&&r.height>0,label:(s.closest('[class*=field],[class*=row]')?.textContent||'').trim().slice(0,40)}})`;
const rec = { at: new Date().toISOString() };

// タイムラインを最大化していると右パネルが隠れるため、インスペクタを前に出す。BGM の選択はタイムラインのクリックと同じ applySelection を呼ぶ
// （最大化を解いた狭いタイムラインでは BGM 行が画面外になるため）。続けて「音声」タブを開く。
await ev(`(()=>{const s=${SHELL};const w=s.widgets.find(w=>w.id==='akari-annotations-widget');w.applySelection({kind:'audio',id:'bgm'});s.revealWidget('akari-inspector-widget');return true})()`);
await sleep(1500);
await ev(`(()=>{const i=document.getElementById('akari-inspector-widget');const b=[...i.querySelectorAll('button,[role=tab]')].find(b=>b.textContent.trim()==='音声');b?.click();return Boolean(b)})()`);
await sleep(1500);
await waitEval(cdp, `${SELECTS}.length>=2`, { label: 'inspector fade shape selects', timeoutMs: 20_000 }).catch(() => undefined);
rec.selectsBefore = await ev(SELECTS);

async function setShape(index, value) {
    const before = editText(project);
    await ev(`(()=>{const s=${SELECTS.replace(/\.map\([\s\S]*$/, '')}[${index}];if(!s)return false;s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const changed = await waitChange(project, before);
    const item = audioItem(project, 'bgm-1');
    return { before, changed, fade_in_shape: item.fade_in_shape, fade_out_shape: item.fade_out_shape };
}
async function undoOnce(before) {
    await ev(`(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, UNDO);
    for (let i = 0; i < 40 && editText(project) !== before; i++) await sleep(200);
    await sleep(600);
    return editText(project) === before;
}

const first = await setShape(0, 'slow');
rec.fadeIn = { changed: first.changed, fade_in_shape: first.fade_in_shape, fade_out_shape: first.fade_out_shape, undoByteEqual: first.changed ? await undoOnce(first.before) : null };
// 戻したので、もう一度付けてから残す（開き直し確認用）。
await sleep(800);
const keepIn = await setShape(0, 'slow');
await sleep(800);
const keepOut = await setShape(1, 'equal_power');
rec.kept = { inChanged: keepIn.changed, outChanged: keepOut.changed, fade_in_shape: keepOut.fade_in_shape, fade_out_shape: keepOut.fade_out_shape };
rec.selectsAfter = await ev(SELECTS);
rec.curves = (await ev(CLIP('bgm'))).fadeCurves.map(x => x.attrs);
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify(rec));
cdp.close(); process.exit(0);
