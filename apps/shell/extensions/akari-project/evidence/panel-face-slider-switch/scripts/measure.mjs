// 素材パネル最上部の「プロジェクト / ライブラリ」切り替えを実測する。
// 必要なら左右スプリッターを実マウスでドラッグして左パネルを <panelWidth> px にし、
// 両面（materials / catalog）それぞれでトラック・つまみ・ボタンの矩形と computed style、折れ・はみ出し・横スクロールを記録。
// usage: CDP_PORT=9434 node measure.mjs <label> [panelWidth] ; writes ../<label>.json と ../<label>-<view>.png
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9434));
const [label, widthArg] = process.argv.slice(2);

export async function dragPanelTo(target) {
    const handle = await evalMain(cdp, `(() => { const p=document.getElementById('theia-left-content-panel').getBoundingClientRect(); const h=[...document.querySelectorAll('#theia-left-right-split-panel > .lm-SplitPanel-handle')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0).sort((a,b)=>a.left-b.left)[0]; return { right: p.right, x: h.left + h.width/2, y: h.top + h.height/2 }; })()`);
    const x2 = handle.x + (target - handle.right);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + (x2 - handle.x) * k / 10, y: handle.y, button: 'left', buttons: 1 }); await sleep(30); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: handle.y, button: 'left', clickCount: 1 });
    await sleep(800);
}

if (widthArg) await dragPanelTo(Number(widthArg));

const MEASURE = `(() => {
  const R = e => { const r = e.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; };
  const track = document.querySelector('[role="tablist"][aria-label="素材パネルの表示"]');
  const thumb = track.querySelector('[data-akari-panel-segment-thumb]');
  const tabs = [...track.querySelectorAll('[data-akari-panel-segment]')];
  const panel = document.getElementById('theia-left-content-panel');
  const widget = document.getElementById('akari-role-buckets-widget');
  const ts = getComputedStyle(track), hs = thumb ? getComputedStyle(thumb) : null;
  const buttons = tabs.map(b => {
    const cs = getComputedStyle(b);
    const range = document.createRange(); range.selectNodeContents(b);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const lines = Math.round(b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) > lh * 1.5 ? 2 : 1;
    return { view: b.dataset.akariPanelSegment, text: b.textContent, ariaSelected: b.getAttribute('aria-selected'), className: b.className,
      rect: R(b), scrollWidth: b.scrollWidth, clientWidth: b.clientWidth, textRectWidth: +range.getBoundingClientRect().width.toFixed(2), textLines: lines,
      fontWeight: cs.fontWeight, opacity: cs.opacity, background: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, zIndex: cs.zIndex, position: cs.position, transition: cs.transition,
      attrs: { openCatalog: b.getAttribute('data-akari-open-catalog'), backToMaterials: b.getAttribute('data-akari-back-to-materials'), role: b.getAttribute('role'), tabIndex: b.tabIndex } };
  });
  const scrollers = []; for (let p = track; p && p !== widget.parentElement; p = p.parentElement) scrollers.push({ tag: p.tagName, id: p.id, scrollWidth: p.scrollWidth, clientWidth: p.clientWidth, ok: p.scrollWidth <= p.clientWidth });
  const trackR = R(track), thumbR = thumb ? R(thumb) : null;
  const active = buttons.find(b => b.ariaSelected === 'true');
  return {
    topView: document.querySelector('[data-akari-top-view]')?.getAttribute('data-akari-top-view'),
    panelWidth: +panel.getBoundingClientRect().width.toFixed(2), widgetWidth: +widget.getBoundingClientRect().width.toFixed(2),
    track: { rect: trackR, position: ts.position, padding: ts.padding, gap: ts.columnGap, background: ts.backgroundColor, border: ts.borderTopWidth + ' ' + ts.borderTopStyle + ' ' + ts.borderTopColor, borderRadius: ts.borderRadius, display: ts.display },
    thumb: thumb ? { rect: thumbR, ariaHidden: thumb.getAttribute('aria-hidden'), transformInline: thumb.style.transform, transformComputed: hs.transform, transitionProperty: hs.transitionProperty, transitionDuration: hs.transitionDuration, transitionTimingFunction: hs.transitionTimingFunction, background: hs.backgroundColor, border: hs.borderTopWidth + ' ' + hs.borderTopStyle + ' ' + hs.borderTopColor, boxShadow: hs.boxShadow, borderRadius: hs.borderRadius } : null,
    buttons,
    scrollers,
    checks: {
      gapBetweenButtons: buttons.length === 2 ? +(buttons[1].rect.left - buttons[0].rect.right).toFixed(2) : null,
      buttonsInsideTrack: buttons.every(b => b.rect.left >= trackR.left - 0.5 && b.rect.right <= trackR.right + 0.5 && b.rect.top >= trackR.top - 0.5 && b.rect.bottom <= trackR.bottom + 0.5),
      thumbUnderActive: thumbR && active ? Math.abs(thumbR.left - active.rect.left) <= 1.5 && Math.abs(thumbR.right - active.rect.right) <= 1.5 : null,
      noWrap: buttons.every(b => b.textLines === 1),
      noClip: buttons.every(b => b.scrollWidth <= b.clientWidth),
      noHorizontalScroll: scrollers.every(s => s.ok)
    }
  };
})()`;

const clip = async () => evalMain(cdp, `(() => { const r = document.getElementById('theia-left-content-panel').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.right) + 4, height: Math.min(innerHeight, 420), scale: 1 }; })()`);
const result = { label, faces: {} };
for (const view of ['materials', 'catalog']) {
    await evalMain(cdp, `(async () => { document.querySelector('[data-akari-panel-segment="${view}"]').click(); await new Promise(r => setTimeout(r, 700)); })()`);
    result.faces[view] = await evalMain(cdp, MEASURE);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: await clip() }, 20000);
    writeFileSync(new URL(`../${label}-${view}.png`, import.meta.url), Buffer.from(data, 'base64'));
}
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="materials"]').click()`);
writeFileSync(new URL(`../${label}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');
for (const [view, f] of Object.entries(result.faces)) console.log(label, view, JSON.stringify({ panelWidth: f.panelWidth, widgetWidth: f.widgetWidth, texts: f.buttons.map(b => b.scrollWidth + '/' + b.clientWidth), topView: f.topView, ...f.checks, thumbTransform: f.thumb?.transformComputed }));
cdp.close();
process.exit(0);
