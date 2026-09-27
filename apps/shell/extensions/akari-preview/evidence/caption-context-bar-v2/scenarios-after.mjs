// run-l1.mjs から読む筋書き（AFTER: このブランチのビルド）。
// - layout: 字幕を選んだときの上のメニューが 1 段か・並び・畳んだ項目（「…」）・高さ
// - buttons: 各ボタン → captions.json の text_style とプレビューの computed style、1 回の取り消しで元に戻るか
// - popups: ミニポップアップ（色・間隔・透明度）の開閉規則（他のボタン・別のミニポップアップ・Esc・外側）と書き込み
// - panels: 「フォント」「スタイル」が akari.captionPanel.toggle を呼ぶか・akari-caption-panel-changed で押下状態が変わるか
// - vertical: 縦書きの字幕と選択枠
// - props: fixtures/captions-after.json の各字幕をプレビューで撮る（書き出しとの比較は render-parity.mjs）
import { readFile } from 'node:fs/promises';
import { captionComputed } from './scenarios-before.mjs';

const BAR = '[data-akari-ui="preview-context-bar"]';
const item = key => `${BAR} [data-akari-bar-item="${key}"]`;

async function selectCaptionText(api, needle) {
  const box = await api.evaluate(api.browser, `(() => {
    const hit = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes(${JSON.stringify(needle)})
      && e.getBoundingClientRect().width > 0 && !e.closest('#caption-select-box'));
    if (!hit) return null;
    const b = hit.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  })()`, api.view.contextId, api.view.sessionId);
  if (!box) throw new Error('caption not mounted: ' + needle);
  await api.viewClick(box.cx, box.cy);
  await api.sleep(900);
  return box;
}
async function ensureSelected(api) {
  const chrome = await api.chrome();
  if (chrome.bar?.items?.some(i => i.key === 'captionFont')) return;
  await selectCaptionText(api, '字幕のメニュー');
}
async function stageClip(api) {
  const s = await api.stageBox();
  return { x: api.outer.x + s.x, y: api.outer.y + s.y, width: s.width, height: s.height };
}
async function barLayout(api) {
  return api.evaluate(api.main, `(() => {
    const bar = document.querySelector(${JSON.stringify(BAR)});
    if (!bar || bar.hidden) return null;
    const vis = n => n.getClientRects().length > 0 && !n.hidden && getComputedStyle(n).display !== 'none';
    const b = bar.getBoundingClientRect();
    const items = [...bar.children].filter(vis).map(n => { const r = n.getBoundingClientRect();
      return { key: n.getAttribute('data-akari-bar-item'), top: +r.top.toFixed(1), left: +r.left.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
        pressed: n.getAttribute('aria-pressed'), expanded: n.getAttribute('aria-expanded'), text: n.textContent.trim().slice(0, 20) }; });
    const hidden = [...bar.children].filter(n => !vis(n)).map(n => n.getAttribute('data-akari-bar-item'));
    const rows = new Set(items.map(i => Math.round(i.top / 4))).size;
    return { rect: { left: +b.left.toFixed(1), top: +b.top.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) },
      rows, order: items.map(i => i.key), hidden, items, bg: getComputedStyle(bar).backgroundColor };
  })()`);
}
async function popState(api) {
  return api.evaluate(api.main, `(() => {
    const pop = document.querySelector('[data-akari-ui="preview-context-window"]');
    const vis = n => !!n && n.getClientRects().length > 0 && !n.hidden && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
    const more = document.querySelector('[data-akari-ui="preview-element-more"]');
    return { window: vis(pop) ? (pop.getAttribute('data-akari-window') ?? 'open') : null,
      text: vis(pop) ? pop.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : null,
      more: vis(more) ? [...more.querySelectorAll('[data-akari-bar-item]')].filter(vis).map(n => ({ key: n.getAttribute('data-akari-bar-item'), pressed: n.getAttribute('aria-pressed') })) : null };
  })()`);
}
async function readCaptions(api) { return readFile(api.captionsPath, 'utf8'); }
function cueStyle(text, id) { return JSON.parse(text).captions.find(c => c.id === id)?.text_style ?? null; }
async function waitCaptionsChange(api, before, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const now = await readCaptions(api); if (now !== before) return now; await api.sleep(150); }
  return null;
}
async function undo(api) {
  // 取り消しは入力欄に焦点があると効かない（when: !akariHistoryEditableFocus）。利用者が外を押したのと同じく焦点を外してから
  await api.evaluate(api.main, `(() => { document.activeElement?.blur?.(); return true; })()`);
  await api.sleep(200);
  // 利用者と同じく ⌘Z を押す（取り消しの有効判定は keydown のたびに焦点から作り直される）
  await api.key('z', 'KeyZ', 90, ['meta']);
  await api.sleep(1200);
  return { ok: true, via: 'meta+z' };
}
async function press(api, key) {
  let target = await api.hostButton(item(key));
  if (!target || target.x === undefined) throw new Error('no button ' + key);
  const hidden = await api.evaluate(api.main, `(() => { const n = document.querySelector(${JSON.stringify(item(key))}); return !n || n.hidden || n.getClientRects().length === 0; })()`);
  if (hidden) {
    await api.pressHost(item('overflow'));
    await api.sleep(500);
    await api.pressHost(`[data-akari-ui="preview-element-more"] [data-akari-bar-item="${key}"]`);
  } else await api.hostClick(target.x, target.y);
  await api.sleep(500);
}

/** 1 つのボタン: 押す → 書き込み 1 回 → computed style → 取り消し 1 回で元のバイト列に戻るか */
async function buttonCase(api, key, id, shotName) {
  await ensureSelected(api);
  const before = await readCaptions(api);
  await press(api, key);
  const after = await waitCaptionsChange(api, before);
  await api.sleep(900);
  const out = { key, wrote: after !== null, styleBefore: cueStyle(before, id), styleAfter: after ? cueStyle(after, id) : null,
    computed: await captionComputed(api), bar: (await barLayout(api))?.items.find(i => i.key === key) ?? null };
  if (shotName) out.shot = await api.screenshot(shotName, await stageClip(api));
  if (after) {
    out.undo = await undo(api);
    const restored = await readCaptions(api);
    out.undoRestoresBytes = restored === before;
    await ensureSelected(api);
  }
  return out;
}

export default async function scenarios(api) {
  const { scenario, previewShot, screenshot, sleep } = api;
  const captionsText = await readCaptions(api);
  // 上のメニューの筋書きは c-0001 の字幕を使う。それ以外の fixture（captions-after / captions-vertical）は字幕ごとの撮影だけ
  const propsFixture = !JSON.parse(captionsText).captions.some(c => c.id === 'c-0001');

  if (propsFixture) {
    await scenario('props', async () => {
      const out = [];
      for (const cue of JSON.parse(captionsText).captions) {
        const t = cue.start + 0.5;
        await api.evaluate(api.browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${t}}, '*'); return true; })()`, api.view.contextId, api.view.sessionId);
        await sleep(1500);
        out.push({ id: cue.id, t, text_style: cue.text_style ?? null, computed: await captionComputed(api), shot: await screenshot(`prop-${cue.id}`, await stageClip(api)) });
      }
      return out;
    });
    return;
  }

  await scenario('layout', async () => {
    await selectCaptionText(api, '字幕のメニュー');
    await sleep(900);
    const layout = await barLayout(api);
    const out = { layout };
    const r = layout.rect;
    out.barShot = await screenshot('bar', { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 });
    out.previewShot = await previewShot('caption-selected');
    if (layout.order.includes('overflow') && layout.hidden.length > 1) {
      await api.pressHost(item('overflow'));
      await sleep(700);
      out.overflowOpen = await popState(api);
      out.overflowShot = await previewShot('overflow-open');
      await api.key('Escape', 'Escape', 27);
      await sleep(500);
      out.afterEsc = await popState(api);
    }
    // 幅を変える: 本体のビューポートを広げる / 細くして、1 段のまま「…」に畳む項目が変わるか
    out.widths = {};
    for (const width of [1680, 2200, 900]) {
      await api.main.send('Emulation.setDeviceMetricsOverride', { width, height: 1040, deviceScaleFactor: 0, mobile: false });
      await sleep(3000);
      await api.refreshView();
      await ensureSelected(api);
      await sleep(900);
      const layout = await barLayout(api);
      out.widths[width] = { rows: layout?.rows, rect: layout?.rect, order: layout?.order, hidden: layout?.hidden };
      const shot = await previewShot(`width-${width}`);
      out.widths[width].shot = shot;
    }
    // 以降の筋書き: 横長は 1680 幅（全項目が 1 段に見える）でボタンを直接押す。縦長は既定の幅（畳んだ「…」から押す）
    if (api.aspect === 'landscape') await api.main.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1040, deviceScaleFactor: 0, mobile: false });
    else await api.main.send('Emulation.clearDeviceMetricsOverride');
    await sleep(3000);
    await api.refreshView();
    return out;
  });

  await scenario('buttons', async () => {
    await selectCaptionText(api, '字幕のメニュー');
    const out = [];
    for (const key of ['captionBold', 'captionItalic', 'captionUnderline', 'captionStrike', 'captionCase', 'captionBullet', 'captionSizeInc', 'captionSizeDec']) {
      out.push(await buttonCase(api, key, 'c-0001', `btn-${key}`));
    }
    // 配置: 押すたびに 中央 → 右 → 左 → 中央（取り消しせずに 3 回）
    const align = { values: [], icons: [] };
    const before = await readCaptions(api);
    for (let i = 0; i < 3; i++) {
      const prev = await readCaptions(api);
      await press(api, 'captionAlign');
      const next = await waitCaptionsChange(api, prev);
      await sleep(900);
      align.values.push(next ? cueStyle(next, 'c-0001')?.align ?? null : 'no-write');
      align.icons.push(await api.evaluate(api.main, `document.querySelector(${JSON.stringify(item('captionAlign'))})?.innerHTML.replace(/\\s+/g,' ').slice(0, 200) ?? null`));
      align[`shot${i}`] = await screenshot(`align-${i}`, await stageClip(api));
      align[`computed${i}`] = await captionComputed(api);
    }
    for (let i = 0; i < 3; i++) await undo(api);
    align.undo3RestoresBytes = (await readCaptions(api)) === before;
    out.push({ key: 'captionAlign', ...align });
    // サイズの直接入力（Enter で確定）
    await ensureSelected(api);
    const sizeBefore = await readCaptions(api);
    const input = await api.hostButton(`${BAR} [data-akari-caption-size]`);
    await api.hostClick(input.x, input.y);
    await api.evaluate(api.main, `(() => { const i = document.querySelector('${BAR} [data-akari-caption-size]'); i.select(); return true; })()`);
    await api.main.send('Input.insertText', { text: '72' });
    await api.key('Enter', 'Enter', 13);
    const sizeAfter = await waitCaptionsChange(api, sizeBefore);
    out.push({ key: 'sizeInput', wrote: sizeAfter !== null, styleAfter: sizeAfter ? cueStyle(sizeAfter, 'c-0001') : null });
    if (sizeAfter) {
      await sleep(1500);
      const history = [];
      out.at(-1).focusBeforeUndo = await api.evaluate(api.main, `(() => { const a = document.activeElement; return a ? a.tagName + '.' + String(a.className).slice(0, 60) + '[' + (a.getAttribute('data-akari-caption-size') !== null ? 'size' : '') + ']' : null; })()`);
      for (let i = 0; i < 3; i++) { const r = await undo(api); const now = await readCaptions(api); history.push({ r, style: cueStyle(now, 'c-0001') }); if (now === sizeBefore) break; }
      out.at(-1).undoRestoresBytes = history.length === 1 && (await readCaptions(api)) === sizeBefore;
      out.at(-1).undoSteps = history;
    }
    return out;
  });

  await scenario('decoration-color', async () => {
    await ensureSelected(api);
    const before = await readCaptions(api);
    // 色 = 黄、下線 + 取り消し線（縁取りの色 = 黒のまま）
    await press(api, 'captionTextColor');
    await sleep(500);
    await api.pressHost('[data-akari-ui="preview-context-window"] [data-caption-color="color"][data-value="#f5c451"]');
    await waitCaptionsChange(api, before);
    await sleep(800);
    const out0 = { afterSwatch: { pop: await popState(api), bar: !!(await barLayout(api)) } };
    await api.key('Escape', 'Escape', 27);
    out0.afterEsc = { pop: await popState(api), bar: !!(await barLayout(api)) };
    await ensureSelected(api);
    for (const key of ['captionUnderline', 'captionStrike']) {
      const prev = await readCaptions(api);
      await press(api, key);
      await waitCaptionsChange(api, prev);
      await sleep(800);
    }
    const out = { ...out0, style: cueStyle(await readCaptions(api), 'c-0001'), computed: await captionComputed(api) };
    out.shot = await screenshot('decoration-color', await stageClip(api));
    const s = await api.stageBox();
    out.zoomShot = null;
    const box = await api.evaluate(api.browser, `(() => { const l = document.querySelector('.akari-caption__line'); const b = l?.getBoundingClientRect(); return b ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`, api.view.contextId, api.view.sessionId);
    if (box) out.zoomShot = await screenshot('decoration-color-zoom', { x: api.outer.x + box.x - 10, y: api.outer.y + box.y - 10, width: box.width + 20, height: box.height + 20 });
    for (let i = 0; i < 3; i++) await undo(api);
    out.undo3RestoresBytes = (await readCaptions(api)) === before;
    void s;
    return out;
  });

  await scenario('popups', async () => {
    await ensureSelected(api);
    const out = {};
    for (const key of ['captionTextColor', 'captionSpacing', 'captionOpacity']) {
      await press(api, key);
      await sleep(600);
      out[`open-${key}`] = await popState(api);
      out[`open-${key}-shot`] = await previewShot(`pop-${key}`);
      await api.key('Escape', 'Escape', 27);
      await sleep(500);
      out[`esc-${key}`] = await popState(api);
      out[`esc-${key}-stillSelected`] = !!(await barLayout(api));
      await ensureSelected(api);
    }
    // 開いている → 他のボタン（斜体）で閉じる
    await press(api, 'captionSpacing');
    out.beforeOther = await popState(api);
    const before = await readCaptions(api);
    await press(api, 'captionItalic');
    await waitCaptionsChange(api, before);
    await sleep(700);
    out.afterOtherButton = await popState(api);
    await undo(api);
    await ensureSelected(api);
    // 色 → 透明度（別のミニポップアップへ切り替え）
    await press(api, 'captionTextColor');
    out.switchFrom = await popState(api);
    await press(api, 'captionOpacity');
    out.switchTo = await popState(api);
    // 同じボタンをもう一度 → 閉じる
    await press(api, 'captionOpacity');
    out.sameAgain = await popState(api);
    // 外側（インスペクターの見出しあたり = 本体の右端）のクリックで閉じる
    await press(api, 'captionSpacing');
    out.beforeOutside = await popState(api);
    const outside = await api.evaluate(api.main, `(() => { const p = document.querySelector('[data-akari-ui="panel:inspector"]') ?? document.body; const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 12 }; })()`);
    await api.hostClick(outside.x, outside.y);
    await sleep(600);
    out.afterOutside = await popState(api);
    await ensureSelected(api);
    // 間隔: スライダーを 3 回動かして離す → 取り消し 1 回で戻るか・数字の箱
    await press(api, 'captionSpacing');
    const s0 = await readCaptions(api);
    await api.evaluate(api.main, `(() => { const r = document.querySelector('[data-akari-ui="preview-context-window"] input[type=range][data-caption-field="letterSpacingEm"]');
      for (const v of [0.1, 0.2, 0.3]) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }
      r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const s1 = await waitCaptionsChange(api, s0);
    await sleep(1500);
    const s1b = await readCaptions(api);
    out.spacingSlider = { wrote: !!s1, style: cueStyle(s1b, 'c-0001'), shot: await previewShot('pop-spacing-after-slider') };
    await undo(api);
    out.spacingSlider.oneUndoRestores = (await readCaptions(api)) === s0;
    await ensureSelected(api);
    // テキストボックスを固定: 上（取り消しのあとも間隔の窓が開いたままなので、Esc で閉じてから開き直す。
    // 開いたまま同じボタンを押すと閉じる = 押し直しで戻る規則どおり）
    await api.key('Escape', 'Escape', 27);
    await sleep(400);
    await ensureSelected(api);
    await press(api, 'captionSpacing');
    const a0 = await readCaptions(api);
    await api.pressHost('[data-akari-ui="preview-context-window"] [data-caption-anchor="top"]');
    const a1 = await waitCaptionsChange(api, a0);
    await sleep(900);
    out.anchorTop = { wrote: !!a1, style: a1 ? cueStyle(a1, 'c-0001') : null, shot: await screenshot('anchor-top', await stageClip(api)) };
    if (a1) { await undo(api); out.anchorTop.oneUndoRestores = (await readCaptions(api)) === a0; }
    await api.key('Escape', 'Escape', 27);
    await ensureSelected(api);
    // 透明度: 数字の箱に 40 → Enter / change
    await press(api, 'captionOpacity');
    const o0 = await readCaptions(api);
    await api.evaluate(api.main, `(() => { const n = document.querySelector('[data-akari-ui="preview-context-window"] input[type=number][data-caption-field="opacity"]');
      n.value = '40'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const o1 = await waitCaptionsChange(api, o0);
    await sleep(1200);
    out.opacity = { wrote: !!o1, style: o1 ? cueStyle(o1, 'c-0001') : null, computed: await captionComputed(api), shot: await screenshot('opacity-40', await stageClip(api)) };
    if (o1) { await undo(api); out.opacity.oneUndoRestores = (await readCaptions(api)) === o0; }
    await api.key('Escape', 'Escape', 27);
    return out;
  });

  await scenario('panels', async () => {
    await ensureSelected(api);
    const out = {};
    out.registeredBefore = await api.evaluate(api.main, `(() => { const C = [...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'&&typeof k.prototype?.registerCommand==='function');
      return !!window.theia.container.get(C).getCommand('akari.captionPanel.toggle'); })()`);
    // 未登録のまま押す: 何も起きない（例外なし・選択とバーはそのまま）
    await press(api, 'captionFont');
    await sleep(600);
    out.unregisteredPress = { bar: !!(await barLayout(api)), pop: await popState(api) };
    // 別票の代わりの記録用コマンドを登録して押す → 引数を記録、押下状態は通知で出す
    await api.evaluate(api.main, `(() => { const C = [...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'&&typeof k.prototype?.registerCommand==='function');
      const reg = window.theia.container.get(C); window.__panelCalls = []; let open = null;
      if (!reg.getCommand('akari.captionPanel.toggle')) window.__panelSpy = reg.registerCommand({ id: 'akari.captionPanel.toggle' }, { execute: arg => {
        window.__panelCalls.push(arg); open = open === arg?.panel ? null : arg?.panel;
        window.dispatchEvent(new CustomEvent('akari-caption-panel-changed', { detail: { panel: open } })); } });
      return true; })()`);
    const pressedOf = async () => (await barLayout(api))?.items.filter(i => i.key === 'captionFont' || i.key === 'captionStyle').map(i => ({ key: i.key, pressed: i.pressed }));
    await press(api, 'captionFont'); await sleep(500);
    out.afterFont = await pressedOf();
    const barClip = async () => { const r = (await barLayout(api)).rect; return { x: r.left, y: r.top, width: r.width, height: r.height }; };
    out.fontShot = await screenshot('panel-font-pressed', await barClip());
    await press(api, 'captionFont'); await sleep(500);
    out.afterFontAgain = await pressedOf();
    await press(api, 'captionStyle'); await sleep(500);
    out.afterStyle = await pressedOf();
    out.styleShot = await screenshot('panel-style-pressed', await barClip());
    // 通知を手で dispatch（別票の通知の見た目）
    await api.evaluate(api.main, `window.dispatchEvent(new CustomEvent('akari-caption-panel-changed', { detail: { panel: 'font' } }))`);
    await sleep(400);
    out.dispatchedFont = await pressedOf();
    await api.evaluate(api.main, `window.dispatchEvent(new CustomEvent('akari-caption-panel-changed', { detail: { panel: null } }))`);
    await sleep(400);
    out.dispatchedNull = await pressedOf();
    out.calls = await api.evaluate(api.main, `window.__panelCalls`);
    await api.evaluate(api.main, `(() => { window.__panelSpy?.dispose(); return true; })()`);
    return out;
  });

  await scenario('vertical', async () => {
    await ensureSelected(api);
    const selectBox = async () => api.evaluate(api.browser, `(() => { const n = document.getElementById('caption-select-box'); if (!n || n.hidden) return null; const b = n.getBoundingClientRect(); return { width: +b.width.toFixed(1), height: +b.height.toFixed(1) }; })()`, api.view.contextId, api.view.sessionId);
    const out = { horizontalBox: await selectBox() };
    const before = await readCaptions(api);
    await press(api, 'captionVertical');
    const after = await waitCaptionsChange(api, before);
    await sleep(1200);
    await ensureSelected(api);
    out.style = after ? cueStyle(after, 'c-0001') : null;
    out.computed = await captionComputed(api);
    out.verticalBox = await selectBox();
    out.shot = await previewShot('vertical-selected');
    await press(api, 'captionSpacing');
    await sleep(600);
    out.spacingPop = await popState(api);
    out.popShot = await previewShot('vertical-spacing-pop');
    await api.key('Escape', 'Escape', 27);
    await undo(api);
    out.undoRestoresBytes = (await readCaptions(api)) === before;
    return out;
  });
}
