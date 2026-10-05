import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick } from '../timeline-tracks/scripts/cdp-lib.mjs';

const port = Number(process.argv[2] || 9464);

async function waitFor(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}${lastError ? `; ${lastError}` : ''}`);
}

async function press(cdp, key, code, windowsVirtualKeyCode) {
  await keyPress(cdp, { key, code, windowsVirtualKeyCode });
}

const target = await waitFor(async () => (await listTargets(port)).find(item => item.type === 'page'), 'main page');
const main = new CDP(target.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
});
await waitFor(() => evalOn(main, `document.readyState === 'complete'`), 'page ready');
if (!await evalOn(main, `!!document.getElementById('akari-annotations-widget')`)) {
  await press(main, 'F1', 'F1', 112);
  await sleep(500);
  await main.send('Input.insertText', { text: 'タイムラインを開く' });
  await sleep(500);
  await press(main, 'Enter', 'Enter', 13);
}
await waitFor(() => evalOn(main, `!!document.querySelector('[data-testid="akari-timeline-shuttle-rate"]')`), 'timeline');
await waitFor(() => evalOn(main, `document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]').length >= 5`), 'timeline clips');
console.log('timeline', await evalOn(main, `(() => { const w = document.querySelector('.akari-annotations-widget'); return {
  text: w?.innerText.slice(0, 600), clips: w?.querySelectorAll('[data-akari-item-kind]').length,
  errors: [...document.querySelectorAll('.notification-list-item')].map(item => item.textContent).slice(0, 3)
}; })()`));
const point = await evalOn(main, `(() => { const r = document.querySelector('.akari-annotations-widget').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()`);
await waitFor(() => evalOn(main, `!!document.querySelector('[data-akari-timeline-track-id="locked"] [data-akari-flag="lock"]')`), 'lock button');
await evalOn(main, `document.querySelector('[data-akari-timeline-track-id="locked"] [data-akari-flag="lock"]').click()`);
await waitFor(() => evalOn(main, `document.querySelector('[data-akari-timeline-track-id="locked"] [data-akari-flag="lock"]')?.getAttribute('aria-pressed') === 'true'`), 'locked track');
await realClick(main, point.x, point.y);
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await sleep(1500);

const state = () => evalOn(main, `(() => {
  const rate = document.querySelector('[data-testid="akari-timeline-shuttle-rate"]');
  const head = document.querySelector('.akari-annotations-widget [data-playhead-time]');
  return { rate: Number(rate?.dataset.shuttleRate), time: Number(head?.dataset.playheadTime),
    display: rate?.textContent, visible: rate?.style.display !== 'none' };
})()`);
const key = async (letter, code, number) => press(main, letter, code, number);
const rateIs = rate => waitFor(async () => { const value = await state(); return value.rate === rate ? value : undefined; }, `rate ${rate}`);
const nearFrame = (actual, expected) => Math.abs(actual - expected) <= 1 / 30 + 0.001;

await key('k', 'KeyK', 75);
for (let index = 0; index < 5; index++) await key('ArrowUp', 'ArrowUp', 38);
await sleep(300);
await key('l', 'KeyL', 76);
console.log('after L', await state());
await rateIs(1);
const normal = await waitFor(async () => { const value = await state(); return value.time > 0.3 ? value : undefined; }, 'normal playback tick');
await sleep(1000);
const normalAfter = await state();
await key('l', 'KeyL', 76);
const fast = await rateIs(2);
await sleep(1000);
const fastAfter = await state();
await key('k', 'KeyK', 75);
const stopped = await rateIs(0);
await sleep(500);
const stoppedAfter = await state();
await key('j', 'KeyJ', 74);
const reverse = await rateIs(-1);
await sleep(1000);
const reverseAfter = await state();
await key(' ', 'Space', 32);
const space = await rateIs(0);
const previewTarget = await waitFor(async () => (await listTargets(port)).find(item =>
  item.type === 'iframe' && /webview\/index\.html\?id=akari-output-preview-/.test(item.url)), 'preview target');
const preview = new CDP(previewTarget.webSocketDebuggerUrl);
await preview.connect();
const contexts = [];
preview.on('Runtime.executionContextCreated', params => contexts.push(params.context));
await preview.send('Page.enable');
await preview.send('Runtime.enable');
await sleep(300);
const tree = await preview.send('Page.getFrameTree');
const inner = contexts.find(context => context.auxData?.frameId !== tree.frameTree.frame.id);
if (!inner) throw new Error('preview context was unavailable');
const readPreviewTime = () => evalOn(preview, `Number(document.getElementById('seek')?.value)`, inner.id);
await key('ArrowDown', 'ArrowDown', 40);
await sleep(500);
const next = await state();
const nextPreview = await readPreviewTime();
await key('ArrowDown', 'ArrowDown', 40);
await sleep(500);
const nextAgain = await state();
const nextAgainPreview = await readPreviewTime();
await key('ArrowDown', 'ArrowDown', 40);
await sleep(500);
const nextThird = await state();
const nextThirdPreview = await readPreviewTime();
await key('ArrowDown', 'ArrowDown', 40);
await sleep(500);
const nextFourth = await state();
const nextFourthPreview = await readPreviewTime();
await key('ArrowUp', 'ArrowUp', 38);
await sleep(500);
const previous = await state();
const previousPreview = await readPreviewTime();
await key('ArrowUp', 'ArrowUp', 38);
await sleep(500);
const previousAgain = await state();
const previousAgainPreview = await readPreviewTime();
await key('ArrowUp', 'ArrowUp', 38);
await sleep(500);
const previousThird = await state();
const previousThirdPreview = await readPreviewTime();

const clipPoint = await evalOn(main, `(() => {
  const clip = [...document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind="cut"]')][1];
  const r = clip.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
await realClick(main, clipPoint.x, clipPoint.y);
await evalOn(main, `(async () => {
  const container = window.theia.container;
  const token = [...container._bindingDictionary._map.keys()].find(key =>
    typeof key === 'function' && typeof key.prototype?.executeCommand === 'function');
  await container.get(token).executeCommand('akari.inspector.open');
  return true;
})()`).catch(() => undefined);
await waitFor(() => evalOn(main, `(() => {
  const inspector = document.querySelector('[data-akari-ui="panel:inspector"]');
  if (inspector && inspector.offsetParent !== null) return true;
  const tab = [...document.querySelectorAll('.lm-TabBar-tab,.p-TabBar-tab')]
    .find(item => item.title.includes('インスペクター') && item.getClientRects().length);
  tab?.click(); return !!inspector && inspector.offsetParent !== null;
})()`), 'visible inspector');
await waitFor(() => evalOn(main, `!!document.querySelector('[data-akari-ui="tab:inspector-video"]')`), 'video inspector tab');
await evalOn(main, `document.querySelector('[data-akari-ui="tab:inspector-video"]').click()`);
await waitFor(() => evalOn(main, `!![...document.querySelectorAll('.akari-inspector-number-input')].find(input => !input.disabled && input.getClientRects().length)`), 'inspector number field');
const inputBefore = await evalOn(main, `(() => {
  const input = [...document.querySelectorAll('.akari-inspector-number-input')].find(row => !row.disabled && row.getClientRects().length);
  input.focus(); return Number(input.value);
})()`);
await key('j', 'KeyJ', 74);
await key('k', 'KeyK', 75);
await key('l', 'KeyL', 76);
await key('ArrowUp', 'ArrowUp', 38);
const inputUp = (await waitFor(async () => {
  const value = await evalOn(main, `Number(document.activeElement.value)`);
  return value > inputBefore ? { value } : undefined;
}, 'inspector step up', 5000)).value;
await evalOn(main, `(() => {
  const input = [...document.querySelectorAll('.akari-inspector-number-input')].find(row => !row.disabled && row.getClientRects().length);
  input.focus(); return true;
})()`);
await key('ArrowDown', 'ArrowDown', 40);
const inputDown = await evalOn(main, `Number(document.activeElement.value)`);
await sleep(300);
const input = { ...await state(), before: inputBefore, up: inputUp, down: inputDown };
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await realClick(main, point.x, point.y);
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

await key('j', 'KeyJ', 74);
await rateIs(-1);
const beginning = await rateIs(0);
await key('ArrowDown', 'ArrowDown', 40);
const afterEdgeDown = await state();
await key('j', 'KeyJ', 74);
await rateIs(-1);
await realClick(main, point.x, point.y);
const clicked = await rateIs(0);
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
for (let index = 0; index < 5; index++) await key('ArrowUp', 'ArrowUp', 38);
await key('l', 'KeyL', 76);
await rateIs(1);
await waitFor(async () => (await state()).time > 0.3, 'normal playback before click');
await realClick(main, point.x, point.y);
const normalClick = await rateIs(0);
await sleep(600);
const normalClickAfter = await state();
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
await key('k', 'KeyK', 75);
await sleep(200);
await key('l', 'KeyL', 76);
await rateIs(1);
await key('l', 'KeyL', 76);
await rateIs(2);
await key(' ', 'Space', 32);
const fastSpace = await rateIs(0);
await sleep(400);
const fastSpaceAfter = await state();

await realClick(main, point.x, point.y);
await evalOn(main, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
const frameBase = await state();
await key('ArrowRight', 'ArrowRight', 39);
await sleep(250);
const frameRight = await state();
await key('ArrowLeft', 'ArrowLeft', 37);
await sleep(250);
const frameLeft = await state();
await keyPress(main, { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 });
await sleep(250);
const secondRight = await state();
const toolState = () => evalOn(main, `(() => ({
  select: document.querySelector('.akari-annotations-widget button[aria-label="選択ツール"]')?.getAttribute('aria-pressed'),
  razor: document.querySelector('.akari-annotations-widget button[aria-label="分割ツール"]')?.getAttribute('aria-pressed')
}))()`);
await key('v', 'KeyV', 86);
const toolSelect = await toolState();
await key('b', 'KeyB', 66);
const toolRazor = await toolState();
await key('v', 'KeyV', 86);
const toolRestored = await toolState();
await key(' ', 'Space', 32);
const spaceStarted = await waitFor(async () => {
  const value = await state(); return value.time > secondRight.time + 0.3 ? value : undefined;
}, 'Space playback');
await key(' ', 'Space', 32);
const spaceStopped = await state();
await sleep(400);
const spaceStoppedAfter = await state();

const labels = [
  ['akari.timeline.shuttleReverse', '逆方向に再生', 'J'],
  ['akari.timeline.shuttleStop', '再生を停止', 'K'],
  ['akari.timeline.shuttleForward', '順方向に再生', 'L'],
  ['akari.timeline.previousEditPoint', '前の切れ目へ', '↑'],
  ['akari.timeline.nextEditPoint', '次の切れ目へ', '↓']
];
const toolbarHelp = await evalOn(main, `(() => {
  const widget = document.querySelector('.akari-annotations-widget');
  return [...widget.children].map(element => element.title ?? '').find(title => title.includes('再生 / 停止')) ?? '';
})()`);
await evalOn(main, `(() => {
  const container = window.theia.container;
  const token = [...container._bindingDictionary._map.keys()].find(key =>
    typeof key === 'function' && typeof key.prototype?.executeCommand === 'function');
  void container.get(token).executeCommand('akari.settings.open', { section: 'shortcuts' });
  return true;
})()`);
await waitFor(() => evalOn(main, `(() => {
  const section = document.querySelector('[data-akari-settings-section="shortcuts"]');
  return !!section && !section.hidden && section.querySelectorAll('[data-shortcuts-row]').length > 0;
})()`), 'shortcut settings');
const settingsRows = await evalOn(main, `(() => ${JSON.stringify(labels)}.map(([id]) => {
  const row = document.querySelector('[data-shortcuts-row="' + id + '"]');
  return { id, label: row?.querySelector('.akari-shortcuts-name span')?.textContent?.trim(),
    keys: [...(row?.querySelectorAll('.akari-shortcuts-key kbd') ?? [])].map(key => key.textContent?.trim()) };
}))()`);
await key('Escape', 'Escape', 27);
await waitFor(() => evalOn(main, `!document.querySelector('[data-akari-settings-dialog]')`), 'settings close');
const captionEditSkipped = 'fixture に字幕トラックがなく、切れ目検証用の構成を保つため省略';

const measured = {
  normal: { start: normal, after: normalAfter, delta: normalAfter.time - normal.time },
  fast: { start: fast, after: fastAfter, delta: fastAfter.time - fast.time },
  stopped: { start: stopped, after: stoppedAfter },
  reverse: { start: reverse, after: reverseAfter, delta: reverseAfter.time - reverse.time },
  space, next, nextAgain, nextThird, nextFourth, previous, previousAgain, previousThird,
  input, previewTimes: [nextPreview, nextAgainPreview, nextThirdPreview, nextFourthPreview,
    previousPreview, previousAgainPreview, previousThirdPreview], beginning, afterEdgeDown, clicked,
  normalClick, normalClickAfter, fastSpace, fastSpaceAfter,
  frameBase, frameRight, frameLeft, secondRight, toolSelect, toolRazor, toolRestored,
  spaceStarted, spaceStopped, spaceStoppedAfter, settingsRows,
  toolbarHelpLabels: labels.map(([, label]) => ({ label, present: toolbarHelp.includes(label) })),
  captionEditSkipped
};
console.log(JSON.stringify(measured, null, 2));
if (!(measured.fast.delta > 1.5 && measured.fast.delta < 2.5)) throw new Error('2x shuttle rate was outside tolerance');
if (!(measured.normal.delta > 0.75 && measured.normal.delta < 1.25)) throw new Error('normal playback rate was outside tolerance');
if (!(measured.reverse.delta < -0.7 && measured.reverse.delta > -1.3)) throw new Error('reverse shuttle rate was outside tolerance');
if (Math.abs(stoppedAfter.time - stopped.time) > 0.1) throw new Error('stop did not hold the playhead');
if (Math.abs(input.time - previousThird.time) > 0.1 || input.rate !== 0 || !(input.up > input.before)) {
  throw new Error('inspector number field did not retain its own keys');
}
if (!(nearFrame(next.time, 6) && nearFrame(nextAgain.time, 12)
  && nearFrame(nextThird.time, 18) && nearFrame(nextFourth.time, 24)
  && nearFrame(previous.time, 18) && nearFrame(previousAgain.time, 12)
  && nearFrame(previousThird.time, 6) && nearFrame(afterEdgeDown.time, 6))) {
  throw new Error('edit-point navigation missed fixture edges');
}
const previewTimes = [nextPreview, nextAgainPreview, nextThirdPreview, nextFourthPreview,
  previousPreview, previousAgainPreview, previousThirdPreview];
if (!previewTimes.every((value, index) => nearFrame(value,
  index === 3 ? 24 - 2 / 30 : [6, 12, 18, 24, 18, 12, 6][index]))) {
  throw new Error('preview did not follow an edit point');
}
if (!nearFrame(beginning.time, 0) || clicked.rate !== 0) throw new Error('edge or click did not stop the shuttle');
if (!(normalClickAfter.time - normalClick.time > 0.35) || normalClick.visible) {
  throw new Error('click did not preserve normal playback while clearing the shuttle display');
}
if (fastSpace.visible || Math.abs(fastSpaceAfter.time - fastSpace.time) > 0.1) {
  throw new Error('Space did not stop the fast shuttle');
}
if (!(nearFrame(frameRight.time, frameBase.time + 1 / 30)
  && nearFrame(frameLeft.time, frameBase.time)
  && nearFrame(secondRight.time, frameBase.time + 1))) {
  throw new Error('existing frame and second keys regressed');
}
if (!(toolSelect.select === 'true' && toolRazor.razor === 'true' && toolRestored.select === 'true')) {
  throw new Error('existing tool keys regressed');
}
if (!(spaceStarted.time > secondRight.time + 0.3
  && Math.abs(spaceStoppedAfter.time - spaceStopped.time) <= 0.1)) {
  throw new Error('existing Space playback regressed');
}
if (!labels.every(([id, label, key]) => settingsRows.some(row =>
  row.id === id && row.label === label && row.keys.includes(key))
  && toolbarHelp.includes(label))) {
  throw new Error('settings list or toolbar help omitted a transport shortcut');
}
preview.close();
main.close();
