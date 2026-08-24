#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import {
  CDP, evalOn, keyPress, listTargets, realClick, resizeViewport, screenshot,
} from '../../caption-subrow-output-space/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
const port = Number(portArg || 9784);
const workspace = path.resolve(workspaceArg);
const evidence = path.resolve(evidenceArg);
const log = [];

function record(step, data = {}) {
  log.push({ step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
}
function assert(condition, message, data = {}) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`);
  record('ok', { message, ...data });
}
async function captions() {
  return JSON.parse(await readFile(path.join(workspace, 'captions.json'), 'utf8'));
}
async function waitFor(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await predicate();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(value)}`);
}
async function openTimeline(main) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await evalOn(main, `!!document.getElementById('akari-annotations-widget')`)) return;
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(600);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1000);
  }
  throw new Error('timeline did not open');
}
async function geometry(main) {
  return evalOn(main, `(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return {
      id: element.dataset.akariItemId, left: r.left, right: r.right,
      top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      centerX: r.left + r.width / 2, centerY: r.top + r.height / 2
    }; };
    return {
      caption: rect(document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="c-0001"]')),
      cuts: Array.from(document.querySelectorAll('.akari-annotations-strip-clip[data-akari-item-kind="cut"]')).map(rect)
    };
  })()`);
}
async function dragWithMidpointProbe(main, start, end) {
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await main.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1,
  });
  for (let index = 1; index <= 12; index++) {
    const ratio = index / 12;
    await main.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio, button: 'left', buttons: 1,
    });
    await sleep(18);
  }
  const mid = await evalOn(main, `(() => {
    const ghost = document.querySelector('.akari-annotations-ghost-output-domain');
    const widget = document.getElementById('akari-annotations-widget');
    const feedback = Array.from(widget.querySelectorAll('div')).find(element =>
      element.textContent.includes('出力時間の字幕に変換'));
    return {
      outputClass: Boolean(ghost),
      feedback: feedback?.textContent ?? '',
      ghostRect: ghost ? (() => { const r = ghost.getBoundingClientRect(); return {
        left: r.left, right: r.right, width: r.width
      }; })() : null
    };
  })()`);
  await screenshot(main, path.join(evidence, '01-drag-output-domain-ghost.png'));
  await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left' });
  return mid;
}
async function focusTimeline(main) {
  const point = await evalOn(main, `(() => {
    const r = document.getElementById('akari-annotations-widget').children[0].getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 5 };
  })()`);
  await realClick(main, point.x, point.y);
}
async function connectPreview() {
  let target;
  for (let attempt = 0; attempt < 30 && !target; attempt++) {
    target = (await listTargets(port)).find(candidate =>
      candidate.type === 'iframe' && /webview\/index\.html\?id=akari-preview-/.test(candidate.url));
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('preview webview target not found');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(400);
  const tree = await cdp.send('Page.getFrameTree');
  const inner = contexts.find(context => context.auxData?.frameId !== tree.frameTree.frame.id);
  if (!inner) throw new Error('preview inner context not found');
  return { cdp, contextId: inner.id };
}
async function evalPreview(preview, expression) {
  const result = await preview.cdp.send('Runtime.evaluate', {
    expression, contextId: preview.contextId, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

await mkdir(evidence, { recursive: true });
const target = (await listTargets(port)).find(candidate => candidate.type === 'page');
if (!target) throw new Error('main target not found');
const main = new CDP(target.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
await resizeViewport(main, 1440, 1050);
await openTimeline(main);
await sleep(1000);

const original = (await captions())[0];
const first = await geometry(main);
assert(first.cuts.length === 2, 'C1/C2 are present', first);

// 境界内での右端ドラッグ。time_domain を新設しないことを実ファイルで確認して undo。
const insideX = first.caption.right + first.cuts[0].width * 0.1;
await dragWithMidpointProbe(main,
  { x: first.caption.right - 2, y: first.caption.centerY },
  { x: insideX, y: first.caption.centerY });
const inside = await waitFor(async () => {
  const value = (await captions())[0];
  return value.end !== original.end ? value : undefined;
}, 'inside drag write');
assert(!Object.hasOwn(inside, 'time_domain'), 'inside-boundary drag leaves domain field absent', { inside });
await focusTimeline(main);
await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
await waitFor(async () => JSON.stringify((await captions())[0]) === JSON.stringify(original), 'inside undo');

// C1 の字幕右端を C2 の 75% 地点まで伸ばし、ゴーストと保存結果を観測。
const beforeCross = await geometry(main);
const c2TargetX = beforeCross.cuts[1].left + beforeCross.cuts[1].width * 0.75;
const mid = await dragWithMidpointProbe(main,
  { x: beforeCross.caption.right - 2, y: beforeCross.caption.centerY },
  { x: c2TargetX, y: beforeCross.caption.centerY });
assert(mid.outputClass && mid.feedback.includes('出力時間の字幕に変換'),
  'drag ghost announces output-domain conversion', mid);
const converted = await waitFor(async () => {
  const value = (await captions())[0];
  return value.time_domain === 'output' ? value : undefined;
}, 'output-domain write');
assert(converted.src === 'source-a' && converted.start === 0.5 && converted.end > 3.4,
  'saved cue is continuous output time and keeps provenance src', { converted });
const afterCross = await geometry(main);
assert(afterCross.caption.right > afterCross.cuts[1].left
  && afterCross.caption.right <= afterCross.cuts[1].right + 1,
  'timeline band extends through C2', { caption: afterCross.caption, c2: afterCross.cuts[1] });
await screenshot(main, path.join(evidence, '02-output-domain-band-through-c2.png'));

// 字幕帯中央クリックで出力プレビューを開き、C2 時刻で plate が見えることを内側 DOM で確認。
await realClick(main, afterCross.caption.centerX, afterCross.caption.centerY);
const preview = await connectPreview();
await evalPreview(preview, `(() => {
  const seek = document.getElementById('seek');
  seek.value = '3';
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const plate = await waitFor(async () => {
  const value = await evalPreview(preview, `(() => {
    const plate = document.getElementById('caption-plate');
    const rect = plate.getBoundingClientRect();
    return { text: plate.textContent, height: rect.height, visibility: getComputedStyle(plate).visibility };
  })()`);
  return value.text.includes('C2まで表示する字幕') && value.height > 0 ? value : undefined;
}, 'preview caption in C2');
assert(plate.visibility === 'visible', 'preview shows the cue while C2 is active', { plate });

// undo は未宣言 source-domain・元時刻・edited=false を完全復元し、C2 表示も消す。
await focusTimeline(main);
await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
await waitFor(async () => JSON.stringify((await captions())[0]) === JSON.stringify(original), 'conversion undo');
await evalPreview(preview, `(() => {
  const seek = document.getElementById('seek'); seek.value = '3';
  seek.dispatchEvent(new Event('input', { bubbles: true })); return true;
})()`);
const hiddenAfterUndo = await waitFor(async () => {
  const value = await evalPreview(preview, `(() => {
    const plate = document.getElementById('caption-plate');
    return { text: plate.textContent, height: plate.getBoundingClientRect().height };
  })()`);
  return value.height === 0 ? value : undefined;
}, 'preview hides after undo');
assert(hiddenAfterUndo.height === 0, 'undo removes the cue from C2 preview', { hiddenAfterUndo });

// render 検証へ渡すため redo し、output-domain 状態を復元して終了。
await focusTimeline(main);
await keyPress(main, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 12 });
await waitFor(async () => (await captions())[0].time_domain === 'output', 'conversion redo');

await writeFile(path.join(evidence, 'run-log.json'), `${JSON.stringify({
  verdict: 'PASS', mid, original, converted,
  band: { captionRight: afterCross.caption.right, c2Left: afterCross.cuts[1].left, c2Right: afterCross.cuts[1].right },
  preview: plate, undo: hiddenAfterUndo,
}, null, 2)}\n`);
preview.cdp.close();
main.close();
