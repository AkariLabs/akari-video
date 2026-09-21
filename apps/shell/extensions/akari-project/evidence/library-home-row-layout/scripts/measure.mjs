// Open the Library face home, optionally drag the left/right splitter so the left content panel is <width> px,
// then measure every category row (icon / title / hint / count rects) and save JSON + screenshot.
// usage: CDP_PORT=9412 node measure.mjs <label> [panelWidth] ; writes ../<label>.json and ../<label>.png
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9412));
const [label, widthArg] = process.argv.slice(2);
await evalMain(cdp, `(async () => { const b=[...document.querySelectorAll('[data-akari-panel-segment]')].find(b=>b.textContent.trim()==='ライブラリ'); b.click(); await new Promise(r=>setTimeout(r,800)); const back=document.querySelector('[data-akari-library-back]'); if (back) { back.click(); await new Promise(r=>setTimeout(r,800)); } })()`);
if (widthArg) {
    const target = Number(widthArg);
    const handle = await evalMain(cdp, `(() => { const p=document.getElementById('theia-left-content-panel').getBoundingClientRect(); const h=[...document.querySelectorAll('#theia-left-right-split-panel > .lm-SplitPanel-handle')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0).sort((a,b)=>a.left-b.left)[0]; return { right: p.right, x: h.left + h.width/2, y: h.top + h.height/2 }; })()`);
    const x2 = handle.x + (target - handle.right);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + (x2 - handle.x) * k / 10, y: handle.y, button: 'left', buttons: 1 }); await sleep(30); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: handle.y, button: 'left', clickCount: 1 });
    await sleep(800);
}
const result = await evalMain(cdp, `(() => {
  const R = e => { const r = e.getBoundingClientRect(); return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), width: +r.width.toFixed(2) }; };
  const home = document.querySelector('[data-akari-library-home]');
  const panel = document.getElementById('theia-left-content-panel');
  const widget = document.getElementById('akari-role-buckets-widget');
  const overflow = e => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, ok: e.scrollWidth <= e.clientWidth });
  const scrollers = []; for (let p = home; p && p !== widget.parentElement; p = p.parentElement) scrollers.push(overflow(p));
  const rows = [...home.querySelectorAll('button[data-akari-library-category]')].filter(b => !b.closest('[style*="repeat(3"]')).map(b => {
    const kids = [...b.children].map(e => ({ text: e.textContent, ...R(e) }));
    const cs = getComputedStyle(b);
    const isSoon = b.getAttribute('data-akari-library-soon') === 'true';
    const countText = [...b.children].map(e => e.textContent).find(t => t === '近日' || /^\\d+$/.test(t)) ?? null;
    const iconK = kids[0], titleK = kids[1];
    const countK = kids.find(k => k.text === countText && k !== iconK && k !== titleK);
    const hintK = kids.find(k => k !== iconK && k !== titleK && k !== countK);
    const row = R(b);
    const innerRight = row.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    return {
      key: b.getAttribute('data-akari-library-category'), soon: isSoon, label: titleK.text, count: countText,
      row, padding: cs.padding, gridTemplateColumns: cs.gridTemplateColumns,
      icon: iconK, title: titleK, hint: hintK, countEl: countK,
      checks: {
        order: iconK.right <= titleK.left + 0.01 && titleK.right <= countK.left + 0.01,
        countRightDelta: +(countK.right - innerRight).toFixed(2),
        hintUnderTitle: Math.abs(hintK.left - titleK.left) <= 0.5 && hintK.top >= titleK.bottom - 0.5,
        rowNoOverflow: b.scrollWidth <= b.clientWidth
      }
    };
  });
  const titleLefts = rows.map(r => r.title.left);
  return {
    panelWidth: +panel.getBoundingClientRect().width.toFixed(2), homeWidth: +home.getBoundingClientRect().width.toFixed(2),
    homePadding: getComputedStyle(home).padding,
    rows, scrollers,
    summary: {
      rows: rows.length, liveRows: rows.filter(r => !r.soon).length, soonRows: rows.filter(r => r.soon).length,
      allOrder: rows.every(r => r.checks.order),
      titleLeftMin: Math.min(...titleLefts), titleLeftMax: Math.max(...titleLefts), titleLeftSpread: +(Math.max(...titleLefts) - Math.min(...titleLefts)).toFixed(2),
      countRightMaxAbsDelta: Math.max(...rows.map(r => Math.abs(r.checks.countRightDelta))),
      allHintUnderTitle: rows.every(r => r.checks.hintUnderTitle),
      allRowsNoOverflow: rows.every(r => r.checks.rowNoOverflow),
      allScrollersNoOverflow: scrollers.every(s => s.ok)
    }
  };
})()`);
writeFileSync(new URL(`../${label}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');
const clip = await evalMain(cdp, `(() => { const r = document.getElementById('theia-left-content-panel').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.right) + 4, height: innerHeight, scale: 1 }; })()`);
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip }, 20000);
writeFileSync(new URL(`../${label}.png`, import.meta.url), Buffer.from(data, 'base64'));
console.log(label, JSON.stringify({ panelWidth: result.panelWidth, ...result.summary }));
cdp.close();
process.exit(0);
