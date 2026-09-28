#!/usr/bin/env node
// 票 gen-thin-frame-labels の実機検証（BEFORE / AFTER 共通）。
// 0.8 秒の枠に 3 案 → 100% と 400% の倍率で、札（作成中 k/3・候補 3）と点線（作る前・採用後）の文字が
// 次の item の上に直接乗っていないか・読めるかを、文字の実際の矩形（Range.getClientRects）で測って撮る。長さの行も撮る。
//   node l1-run.mjs --phase=before|after [--port=9660] [--keep-tmp]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  cleanupIso, FRAME, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PANEL, PROFILES,
  S, startStubFal, stopElectron, writeAppModels
} from './l1-common.mjs';

const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
if (phase !== 'before' && phase !== 'after') throw new Error('--phase=before|after');
const AFTER = phase === 'after';
const iso = await makeIso(phase);
const ctx = makeResults(phase, iso, `results-${phase}.json`);
const { results, clean, save } = ctx;
const [, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, project, h;
const readEdit = async () => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const itemOf = (doc, id) => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === id);

const widget = `(()=>{const c=window.theia?.container,d=c?._bindingDictionary;
  const K=d&&[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getWidgets==='function'&&typeof k.prototype?.revealWidget==='function');
  const shell=K&&c.get(K);return ['bottom','main'].flatMap(area=>shell?.getWidgets(area)??[]).find(x=>typeof x.reloadGenerationSidecars==='function')})()`;
/** 倍率を変える（100% = 全体。400% = 全体の 1/4 を枠の少し前から）。 */
const setZoom = async percent => {
  await evalOn(cdp, `(()=>{const w=${widget};if(!w)return false;const total=w.totalDuration();
    if(${percent}<=100)w.applyViewDuration(total,0,0);else w.applyViewDuration(total*100/${percent},2.9,0);w.flushStripRender?.();return true})()`);
  await sleep(700);
  await h.settle();
  return evalOn(cdp, `(()=>{const w=${widget};return{zoom:Math.round(w.zoomPercent()),viewStart:w.viewStart,label:document.querySelector('[data-akari-ui="panel:timeline"]')?.textContent.match(/\\d+%/)?.[0]??null}})()`);
};

/** 札と点線の中の見えている文字を、祖先の overflow で切った実際の矩形で測る。次の item との重なり・背景の不透明度・切れを出す。 */
const labelGeometry = `(()=>{const R=b=>b&&{left:Math.round(b.left*10)/10,right:Math.round(b.right*10)/10,top:Math.round(b.top),bottom:Math.round(b.bottom),width:Math.round((b.right-b.left)*10)/10};
  const frame=document.querySelector('[data-akari-ui="timeline:cut:1"]'),next=document.querySelector('[data-akari-ui="timeline:cut:2"]');
  if(!frame||!next)return null;const fb=frame.getBoundingClientRect(),nb=next.getBoundingClientRect();
  const alphaOf=c=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return 0;const p=m[1].split(/[ ,\\/]+/).filter(Boolean);return p.length>3?Number(p[3]):1};
  const bgAlpha=(el,root)=>{for(let a=el;a;a=a.parentElement){const x=alphaOf(getComputedStyle(a).backgroundColor);if(x>0)return x;if(a===root)break}return 0};
  const boxes=root=>{const out=[];if(!root)return out;const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
    while((n=tw.nextNode())){const text=n.textContent.replace(/\\s+/g,' ').trim();if(!text)continue;const el=n.parentElement;
      let hidden=false;for(let a=el;a;a=a.parentElement){const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0){hidden=true;break}if(a===root)break}
      if(hidden)continue;const range=document.createRange();range.selectNodeContents(n);
      for(const b of range.getClientRects()){let l=b.left,r=b.right,t=b.top,bm=b.bottom;
        for(let a=el;a;a=a.parentElement){const s=getComputedStyle(a);if(s.overflowX!=='visible'||s.overflowY!=='visible'){const ab=a.getBoundingClientRect();l=Math.max(l,ab.left);r=Math.min(r,ab.right);t=Math.max(t,ab.top);bm=Math.min(bm,ab.bottom)}if(a===root)break}
        if(r-l<0.5||bm-t<0.5)continue;
        const onNext=Math.min(r,nb.right)-Math.max(l,nb.left)>0.5&&Math.min(bm,nb.bottom)-Math.max(t,nb.top)>0.5;
        out.push({text,rect:R({left:l,right:r,top:t,bottom:bm}),clipped:b.left<l-0.5||b.right>r+0.5,onNext,background:bgAlpha(el,root),insideFrame:l>=fb.left-1&&r<=fb.right+1})}}
    return out};
  const badge=frame.querySelector('[data-akari-generation-badge]');const overhang=[...document.querySelectorAll('[data-akari-generation-overhang]')]
    .find(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.left>=fb.right-2&&b.top<fb.bottom&&b.bottom>fb.top});
  const full=e=>e?{text:e.textContent.replace(/\\s+/g,' ').trim(),title:e.getAttribute('title'),aria:e.getAttribute('aria-label'),ariaHidden:e.getAttribute('aria-hidden'),rect:R(e.getBoundingClientRect()),
    before:(()=>{const s=getComputedStyle(e,'::before');return s.display==='none'?null:s.content})()}:null;
  const ov=overhang&&{...full(overhang),pointerEvents:getComputedStyle(overhang).pointerEvents,border:getComputedStyle(overhang).borderTopStyle,
    titles:[overhang,...overhang.querySelectorAll('[title]')].map(e=>e.getAttribute('title')).filter(Boolean)};
  return{frame:R(fb),next:R(nb),badge:full(badge),badgeText:boxes(badge),overhang:ov,overhangText:boxes(overhang)}})()`;

const sectionText = `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-generation"]');return s?s.textContent.replace(/\\s+/g,' ').trim().slice(0,2000):null})()`;
const panelState = `(()=>{const p=document.querySelector(${S(PANEL)});if(!p)return null;const t=e=>e?.textContent.replace(/\\s+/g,' ').trim()??null;
  return{durationNote:t(p.querySelector('[data-akari-inspector-video-duration-note]')),
    candidates:[...p.querySelectorAll('[data-akari-inspector-video-candidate]')].map(c=>c.getAttribute('data-akari-inspector-video-candidate')),
    running:!!p.querySelector('[data-akari-inspector-video-cancel]')}})()`;
const chipAll = `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"] [data-akari-generation-badge]');if(!e)return null;
  return [e.textContent,e.getAttribute('title'),e.getAttribute('aria-label')].filter(Boolean).join(' | ').replace(/\\s+/g,' ')})()`;

async function setChecked(modelId, checked) {
  const sel = `${PANEL} [data-akari-inspector-video-model-check="${modelId}"]`;
  if (await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});return e?e.checked:null})()`) === null)
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return true})()`);
  if (await evalOn(cdp, `document.querySelector(${S(sel)})?.checked`) === checked) return;
  await h.clickUntil(sel, `document.querySelector(${S(sel)})?.checked===${checked}`, `check ${modelId} ${checked}`);
}
async function clickDialogButton(label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`, 20_000);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`![...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`, 'dialog closed', 10_000);
}

/** 文字の読みやすさの判定（AFTER の合格条件。BEFORE では再現の記録として同じ値を残す）。 */
function judge(g, { want }) {
  // 記号だけの形は CSS の ::before（content: attr(data-akari-generation-compact)）で描かれるので、文字ノードが無いときは札の矩形が枠内で ::before に記号があることを見る
  const glyphOnly = g.badgeText.length === 0 && /✦/u.test(g.badge?.before ?? '') && g.badge.rect.left >= g.frame.left - 1 && g.badge.rect.right <= g.frame.right + 1;
  const badgeOk = glyphOnly || (g.badgeText.length > 0 && g.badgeText.every(b => b.insideFrame && !b.clipped && !(b.onNext && b.background < 0.8)));
  const overhangTextOk = g.overhangText.every(b => !b.clipped && !(b.onNext && b.background < 0.8));
  const overhangTitle = [g.overhang?.title, ...(g.overhang?.titles ?? [])].filter(Boolean).join(' ');
  const overhangFull = g.overhangText.map(b => b.text).join(' ');
  const overhangCarries = want.overhang.test(overhangFull) || want.overhang.test(overhangTitle);
  const badgeAll = [g.badge?.text, g.badge?.title, g.badge?.aria].filter(Boolean).join(' | ');
  return {
    badgeOk, glyphOnly, overhangTextOk, overhangCarries,
    badgeFullInTitleAndAria: want.badge.test(g.badge?.title ?? '') && want.badge.test(g.badge?.aria ?? ''),
    badgeCarries: want.badge.test(badgeAll),
    textOnNextWithoutBackground: [...g.badgeText, ...g.overhangText].filter(b => b.onNext && b.background < 0.8).map(b => b.text),
    badgeOutsideFrame: g.badgeText.filter(b => !b.insideFrame).map(b => b.text),
    clipped: [...g.badgeText, ...g.overhangText].filter(b => b.clipped).map(b => b.text)
  };
}

/** 100% と 400% の両方で測って撮る。 */
async function capturePair(key, index, want) {
  const out = {};
  for (const percent of [100, 400]) {
    const zoom = await setZoom(percent);
    const geometry = await evalOn(cdp, labelGeometry);
    const verdict = judge(geometry, { want });
    out[percent] = { zoom, geometry, verdict };
    await h.shot(`${index}-${phase}-${key}-${percent}.png`);
  }
  await setZoom(100);
  results.observations[key] = out;
  const z100 = out[100].verdict, z400 = out[400].verdict;
  if (AFTER) {
    await h.check(`AFTER ${key} 100%: 札の文字は枠の中に収まり、切れず、次の item の上に直接乗らない`, z100.badgeOk, out[100].geometry.badgeText);
    await h.check(`AFTER ${key} 100%: 札の全文は title と aria-label に残る`, z100.badgeFullInTitleAndAria, out[100].geometry.badge);
    await h.check(`AFTER ${key} 100%: 点線の文字は次の item の上に直接乗らず（背景つきの札か非表示）、全文は文字か title に残る`,
      z100.overhangTextOk && z100.overhangCarries, { text: out[100].geometry.overhangText, overhang: out[100].geometry.overhang });
    await h.check(`AFTER ${key} 100%: 点線そのものは今どおり次の item に重なり、表示専用`,
      out[100].geometry.overhang && out[100].geometry.overhang.rect.right > out[100].geometry.next.left
        && out[100].geometry.overhang.pointerEvents === 'none' && /dashed|dotted/.test(out[100].geometry.overhang.border), out[100].geometry.overhang);
    await h.check(`AFTER ${key} 400%: 今どおり札の全文が見える`,
      out[400].geometry.badgeText.map(b => b.text).join(' ').replace(/\s+/g, ' ').includes(want.badgeFull) && z400.badgeOk, out[400].geometry.badgeText);
    await h.check(`AFTER ${key} 400%: 今どおり点線の全文が見える`,
      want.overhang.test(out[400].geometry.overhangText.map(b => b.text).join(' ')) && z400.overhangTextOk, out[400].geometry.overhangText);
  } else {
    await h.check(`BEFORE ${key} 100%: 札または点線の文字が次の item の上に直接乗る・切れる（再現）`,
      z100.textOnNextWithoutBackground.length > 0 || z100.badgeOutsideFrame.length > 0 || z100.clipped.length > 0, z100);
  }
}

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.observations.stubModels = PROFILES.map(({ model, durationSec, queueMs, processingMs }) => ({ model, durationSec, queueMs, processingMs }));
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);
  results.step = 'open';
  const SECTION = await openFrameGeneration(h, cdp);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  results.observations.originalFrame = itemOf(await readEdit(), FRAME);
  await setChecked(KLING, true); await setChecked(SEEDANCE, true);
  await h.settle();

  // 長さの行
  results.step = 'duration row';
  const section = await evalOn(cdp, sectionText);
  const row = section?.match(/長さ\s*(\S+ 秒 → \S+ 秒|\S+ 秒（cuts）)/u)?.[1] ?? null;
  const note = section?.match(/尺 \S+ 秒 → \S+ 秒に丸めました[^。]*/u)?.[0] ?? null;
  results.observations.durationRow = row;
  results.observations.durationNote = note;
  results.observations.panelNote = (await evalOn(cdp, panelState))?.durationNote ?? null;
  await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const e=[...(s?.querySelectorAll('*')??[])].find(x=>x.children.length===0&&/^長さ$/.test(x.textContent.trim()));
    (e||s)?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(300);
  await h.shot(`00-${phase}-duration-row.png`);
  if (AFTER) {
    await h.check('AFTER: 長さの行が「0.8 秒 → 5 秒」', row === '0.8 秒 → 5 秒', { row, note });
    await h.check('AFTER: 注記も「尺 0.8 秒 → 5 秒に丸めました」', /^尺 0\.8 秒 → 5 秒に丸めました/.test(note ?? ''), note);
  } else {
    await h.check('BEFORE: 長さの行が浮動小数のまま（再現）', /\d\.\d{4,}/.test(row ?? ''), { row, note });
  }

  // 作る前の点線（5 秒で作ります）
  results.step = 'planned';
  await capturePair('planned', '01', { badge: /./u, badgeFull: '', overhang: /5 秒で作ります/u });
  // 作る前の札（▶ 動画予定）は票 A から変えていないので判定から外し、記録だけ残す
  if (AFTER) results.checks = results.checks.filter(c => !/^AFTER planned .*札/.test(c.name));

  // 3 案同時
  results.step = 'generate three';
  await evalOn(cdp, `(()=>{document.querySelector(${S(`${PANEL} [data-akari-inspector-video-create]`)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(250);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await clickDialogButton('費用承認する');
  const chips = [];
  let gotProgress = false;
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    const s = await evalOn(cdp, panelState).catch(() => null);
    const chip = await evalOn(cdp, chipAll).catch(() => null);
    if (chips.at(-1) !== chip) chips.push(chip);
    if (!gotProgress && /1\/3/.test(chip ?? '')) {
      gotProgress = true;
      await capturePair('generating-1of3', '02', { badge: /3 案作成中 · 1\/3/u, badgeFull: '3 案作成中 · 1/3', overhang: /5 秒で作ります/u });
    }
    if (s && s.candidates.length >= 3 && !s.running) break;
    await sleep(300);
  }
  results.observations.chipSequence = chips;
  await h.check(`${AFTER ? 'AFTER' : 'BEFORE'}: 作成中 1/3 の状態を撮れた`, gotProgress, chips);
  await sleep(1500);
  await capturePair('candidates-3', '03', { badge: /候補 3/u, badgeFull: '候補 3', overhang: /5 秒で作ります/u });

  // 採用後
  results.step = 'adopt';
  const candidates = (await evalOn(cdp, panelState)).candidates;
  const first = candidates.find(c => c.includes('h3')) ?? candidates[0];
  await h.clickUntil(`${PANEL} [data-akari-inspector-video-candidate=${S(first)}]`,
    `document.querySelector(${S(`${PANEL} [data-akari-inspector-video-candidate=${JSON.stringify(first)}]`)})?.getAttribute('data-akari-inspector-video-candidate-selected')==='true'`, 'pick candidate');
  await h.click(`${PANEL} [data-akari-inspector-video-adopt]`);
  const adoptedUntil = Date.now() + 60_000;
  while (Date.now() < adoptedUntil) {
    if (itemOf(await readEdit(), FRAME)?.source?.src === `gen-${FRAME}-video`) break;
    await sleep(300);
  }
  await h.waitEval(`[...document.querySelectorAll('[data-akari-generation-overhang]')].some(e=>/動画は/.test(e.textContent+' '+(e.getAttribute('title')??'')+' '+[...e.querySelectorAll('[title]')].map(x=>x.title).join(' ')))`,
    'timeline reflects adoption', 120_000).catch(() => undefined);
  await h.settle(); await sleep(1000);
  await capturePair('adopted', '04', { badge: /./u, badgeFull: '', overhang: /動画は 5 秒/u });
  if (AFTER) results.checks = results.checks.filter(c => !/^AFTER adopted .*札/.test(c.name));
  const doc = await readEdit();
  results.observations.adoptedFrame = itemOf(doc, FRAME);
  results.observations.nextItem = itemOf(doc, 'clip-next');
  await h.check(`${AFTER ? 'AFTER' : 'BEFORE'}: 枠と次の item の edit.json は不変（表示だけ）`,
    results.observations.adoptedFrame?.at === results.observations.originalFrame?.at
      && results.observations.adoptedFrame?.duration === results.observations.originalFrame?.duration
      && results.observations.nextItem?.at === 114, { frame: results.observations.adoptedFrame, next: results.observations.nextItem });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot(`zz-${phase}-failure.png`).catch(() => undefined);
} finally {
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
