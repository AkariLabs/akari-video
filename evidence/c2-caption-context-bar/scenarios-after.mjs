// AFTER の筋書き: 字幕を選ぶ → 上のメニュー（スタイル）の各操作が書き込み 1 回・undo 1 回・プレビューに反映 /
// 下の道具バーが最小限 / 「…」からマイスタイルに保存・インスペクターを開く / 写真・図形・文字の上のメニューの回帰。
import { readFileSync } from 'node:fs';
import { bottomTools, captionBox, selectCaption } from './scenarios.mjs';

const BAR = '[data-akari-ui="preview-context-bar"]';
const WIN = '[data-akari-ui="preview-context-window"]';

export default async function after(api) {
  const { scenario, chrome, previewShot, windowShot, evaluate, main, browser, sleep, pressHost, hostButton, key, mouse, S } = api;
  const files = [api.editPath, api.captionsPath];

  // ---- 書き込みの数え方（15ms ごとに中身を見て、変わった回数を数える）----
  const last = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
  const writes = [];
  const poll = setInterval(() => {
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (text !== last.get(f)) { last.set(f, text); writes.push({ at: Date.now(), file: f === api.editPath ? 'edit.json' : 'captions.json' }); }
    }
  }, 15);
  const mark = () => writes.length;
  const since = m => writes.slice(m).map(w => w.file);
  const both = () => files.map(f => readFileSync(f, 'utf8')).join('\n---\n');
  const cue = id => JSON.parse(readFileSync(api.captionsPath, 'utf8')).captions.find(c => c.id === id) ?? null;
  const settle = async (m, ms = 2500) => { const end = Date.now() + ms; let n = since(m).length; while (Date.now() < end) { await sleep(150); const k = since(m).length; if (k !== n) { n = k; } } };

  const state = async () => (await api.executeCommand(main, 'akari.contextBar.getState'))?.value ?? null;
  /** プレビューの字幕（選んだ字幕）の計算済みの見た目 */
  const captionLook = async (text = '字幕のメニュー') => evaluate(browser, `(() => {
    const leaf = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes(${S(text)})
      && e.getBoundingClientRect().width > 0 && !e.closest('#caption-select-box'));
    if (!leaf) return null;
    const line = leaf.closest('.akari-caption__line') ?? leaf;
    const plate = leaf.closest('.caption-row-plate') ?? line.parentElement;
    const cs = getComputedStyle(line), ps = getComputedStyle(plate), ls = getComputedStyle(leaf);
    const bgOf = n => { for (let e = n; e && e !== document.body; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; } return null; };
    return { color: ls.color, fontWeight: ls.fontWeight, fontSize: cs.fontSize, fontFamily: ls.fontFamily.slice(0, 80), lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing, stroke: ls.webkitTextStrokeWidth + ' ' + ls.webkitTextStrokeColor, plateBg: bgOf(leaf),
      paintOrder: ls.paintOrder, textShadow: ls.textShadow.slice(0, 80), plateBox: (() => { const b = plate.getBoundingClientRect(); return [+b.width.toFixed(1), +b.height.toFixed(1)]; })() };
  })()`, api.view.contextId, api.view.sessionId);

  const undoOnce = async () => {
    const before = both();
    await evaluate(main, `(() => { const e = document.activeElement; if (e && e !== document.body) e.blur(); return true; })()`);
    await key('z', 'KeyZ', 90, ['meta']);
    for (let i = 0; i < 30 && both() === before; i++) await sleep(200);
    await sleep(900);
  };
  const ensureCaption = async () => {
    const s = await state();
    if (s?.kind === 'caption' && s?.selectedId === 'c-0001') return s;
    await key('Escape', 'Escape', 27);
    await selectCaption(api);
    for (let i = 0; i < 25; i++) { const s2 = await state(); if (s2?.kind === 'caption') return s2; await sleep(200); }
    return state();
  };
  const openWindow = async name => {
    const open = await evaluate(main, `(() => { const w = document.querySelector(${S(WIN)}); return !!w && w.getClientRects().length > 0 && getComputedStyle(w).display !== 'none' ? w.getAttribute('data-akari-window') : null; })()`);
    if (open !== name) await pressHost(`${BAR} [data-akari-bar-item="${name}"]`);
    await sleep(500);
    return evaluate(main, `(() => { const w = document.querySelector(${S(WIN)}); return w ? { kind: w.getAttribute('data-akari-window'), text: w.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300),
      controls: [...w.querySelectorAll('button, input')].map(n => n.getAttribute('data-caption-preset') ?? n.getAttribute('data-caption-color') ?? n.getAttribute('data-caption-toggle') ?? n.getAttribute('data-caption-field') ?? n.tagName).slice(0, 40) } : null; })()`);
  };
  /** 1 つの操作: 書き込み回数・undo 1 回で元へ・プレビューの見た目 */
  const operation = async (name, run, opts = {}) => {
    await ensureCaption();
    const head = both();
    const look0 = await captionLook();
    const cue0 = cue('c-0001');
    const m = mark();
    const extra = await run();
    await settle(m);
    const writesAfter = since(m);
    const look1 = await captionLook();
    const cue1 = cue('c-0001');
    const cue2 = cue('c-0002');
    const shot = await previewShot(`op-${name}`);
    const win = await windowShot(`op-${name}-window`);
    await undoOnce();
    await sleep(600);
    const look2 = await captionLook();
    const back = both() === head;
    const row = { writes: writesAfter.length, files: writesAfter, cueStyleBefore: cue0?.style ?? cue0?.textStyle ?? null,
      cueStyleAfter: cue1?.style ?? cue1?.textStyle ?? null, otherCueStyleAfter: cue2?.style ?? cue2?.textStyle ?? null,
      lookBefore: look0, lookAfter: look1, lookAfterUndo: look2, undoBackToStart: back, shot, win, ...(extra ?? {}) };
    if (!back) { row.undoWrites = 'undo 後も元と違う'; }
    return row;
  };
  /** 窓の中の range を本物のマウスで 3 歩ドラッグ（最中の書き込み 0 回・離して 1 回） */
  const dragRange = async (field, fractions) => {
    const r = await evaluate(main, `(() => { const i = document.querySelector(${S(`${WIN} input[type="range"][data-caption-field="${field}"]`)}); if (!i) return null; const b = i.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height, min: +i.min, max: +i.max, value: +i.value }; })()`);
    if (!r) throw new Error(`no range ${field}`);
    const pad = 8;
    const xAt = f => r.left + pad + (r.width - pad * 2) * f;
    const y = r.top + r.height / 2;
    const f0 = (r.value - r.min) / (r.max - r.min);
    const m = mark();
    await mouse('mouseMoved', xAt(f0), y);
    await mouse('mousePressed', xAt(f0), y);
    const during = [];
    for (const [i, f] of fractions.entries()) {
      await mouse('mouseMoved', xAt(f), y, [], 1);
      await sleep(500);
      during.push({ step: i + 1, value: await evaluate(main, `document.querySelector(${S(`${WIN} input[type="range"][data-caption-field="${field}"]`)})?.value`),
        look: await captionLook(), writes: since(m).length, shot: await previewShot(`live-${field}-${i + 1}`) });
    }
    await mouse('mouseReleased', xAt(fractions.at(-1)), y);
    await sleep(300);
    return { start: r.value, during, writesDuring: during.at(-1)?.writes ?? null };
  };

  // 起動直後の読み直し（負荷が高いと起きる）が落ち着くのを待つ
  await sleep(10000);
  await api.refreshView().catch(() => undefined);
  await scenario('select', async () => {
    await selectCaption(api);
    for (let i = 0; i < 25; i++) { const s = await state(); if (s?.kind === 'caption') break; await sleep(200); }
    await sleep(800);
    const shot = await previewShot('01-select-caption');
    const win = await windowShot('01-select-caption-window');
    return { shot, win, state: await state(), chrome: await chrome(), bottom: await bottomTools(api) };
  });

  await scenario('bold', async () => operation('bold', async () => { await pressHost(`${BAR} [data-akari-bar-item="captionBold"]`); }));
  await scenario('textColor', async () => operation('text-color', async () => {
    const w = await openWindow('captionTextColor');
    await pressHost(`${WIN} [data-caption-color="color"][data-value="#f5c451"]`);
    return { window: w };
  }));
  await scenario('strokeColor', async () => operation('stroke-color', async () => {
    const w = await openWindow('captionStrokeColor');
    await pressHost(`${WIN} [data-caption-color="strokeColor"][data-value="#4da3ff"]`);
    return { window: w };
  }));
  await scenario('cushion', async () => operation('cushion', async () => {
    const w = await openWindow('captionCushion');
    await pressHost(`${WIN} [data-caption-toggle="cushion"]`);
    return { window: w };
  }));
  await scenario('cushionColor', async () => operation('cushion-color', async () => {
    const w = await openWindow('captionCushion');
    await pressHost(`${WIN} [data-caption-color="backgroundColor"][data-value="#4da3ff"]`);
    return { window: w };
  }));
  await scenario('preset', async () => operation('preset', async () => {
    const w = await openWindow('captionPreset');
    await pressHost(`${WIN} [data-caption-preset="subtitle-news"]`);
    return { window: w };
  }));
  await scenario('font', async () => operation('font', async () => {
    const w = await openWindow('captionFont');
    const target = await hostButton(`${WIN} [data-caption-field="fontFamily"]`);
    const fontInput = await evaluate(main, `(() => { const i = document.querySelector(${S(`${WIN} [data-caption-field="fontFamily"]`)}); return i ? { tag: i.tagName, type: i.type ?? null, options: i.tagName === 'SELECT' ? [...i.options].map(o => o.value).slice(0, 30) : null } : null; })()`);
    if (fontInput?.tag === 'SELECT') {
      const pick = fontInput.options.find(o => /Mincho|明朝/i.test(o)) ?? fontInput.options.find(o => o) ?? '';
      await evaluate(main, `(() => { const i = document.querySelector(${S(`${WIN} [data-caption-field="fontFamily"]`)}); i.value = ${S('__PICK__')}.replace('__PICK__', ${S(pick)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      return { window: w, fontInput, picked: pick };
    }
    const fontButton = await evaluate(main, `(() => [...document.querySelectorAll(${S(`${WIN} [data-caption-font]`)})].map(b => b.getAttribute('data-caption-font')).slice(0, 30))()`);
    if (fontButton?.length) {
      const pick = fontButton.find(o => /Mincho|明朝/i.test(o)) ?? fontButton[1] ?? fontButton[0];
      await pressHost(`${WIN} [data-caption-font=${S(pick)}]`);
      return { window: w, fontButtons: fontButton, picked: pick };
    }
    await api.hostClick(target.x, target.y);
    await evaluate(main, `(() => { const i = document.querySelector(${S(`${WIN} [data-caption-field="fontFamily"]`)}); i.select?.(); return true; })()`);
    await main.send('Input.insertText', { text: 'Hiragino Mincho ProN' });
    await key('Enter', 'Enter', 13);
    await key('Tab', 'Tab', 9);
    return { window: w, fontInput, picked: 'Hiragino Mincho ProN' };
  }));
  await scenario('size', async () => operation('size', async () => {
    const w = await openWindow('captionSize');
    return { window: w, live: await dragRange('sizePx', [0.45, 0.55, 0.65]) };
  }));
  await scenario('lineHeight', async () => operation('line-height', async () => {
    const w = await openWindow('captionSpacing');
    return { window: w, live: await dragRange('lineHeight', [0.6, 0.75, 0.9]) };
  }));
  await scenario('letterSpacing', async () => operation('letter-spacing', async () => {
    const w = await openWindow('captionSpacing');
    return { window: w, live: await dragRange('letterSpacingEm', [0.5, 0.65, 0.8]) };
  }));
  await scenario('strokeWidth', async () => operation('stroke-width', async () => {
    const w = await openWindow('captionStroke');
    return { window: w, live: await dragRange('strokeWidth', [0.3, 0.45, 0.6]) };
  }));

  // 全字幕モード（この字幕だけ動く の切り替え）を入れたときの範囲 — 基点の下の道具バーの太字と同じ扱いか
  await scenario('groupScope', async () => {
    await ensureCaption();
    await evaluate(browser, `(() => { document.querySelector('#caption-select-box [data-caption-tool="group"]').click(); return true; })()`, api.view.contextId, api.view.sessionId);
    await sleep(600);
    const groupOn = await evaluate(browser, `document.querySelector('#caption-select-box [data-caption-tool="group"]').classList.contains('on')`, api.view.contextId, api.view.sessionId);
    const row = await operation('group-bold', async () => { await pressHost(`${BAR} [data-akari-bar-item="captionBold"]`); });
    await ensureCaption();
    await evaluate(browser, `(() => { const b = document.querySelector('#caption-select-box [data-caption-tool="group"]'); if (b.classList.contains('on')) b.click(); return true; })()`, api.view.contextId, api.view.sessionId);
    await sleep(400);
    return { groupOn, ...row };
  });

  // 下の道具バー: 4 つ（既定に戻すは字幕固有の位置のあるときだけ）とその動き
  await scenario('bottom', async () => {
    await ensureCaption();
    const before = await bottomTools(api);
    const click = async tool => { const b = await evaluate(browser, `(() => { const n = document.querySelector('#caption-select-box [data-caption-tool=${S(tool)}]'); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, api.view.contextId, api.view.sessionId);
      if (!b) return null; await api.viewClick(b.x, b.y); await sleep(500); return true; };
    const toggles = {};
    for (const tool of ['snap', 'clamp', 'group', 'snap#2']) {
      const name = tool.split('#')[0];
      const on0 = (await bottomTools(api)).visible.find(t => t.tool === name)?.on ?? null;
      const m = mark();
      await click(name);
      const on1 = (await bottomTools(api)).visible.find(t => t.tool === name)?.on ?? null;
      await click(name);
      const on2 = (await bottomTools(api)).visible.find(t => t.tool === name)?.on ?? null;
      toggles[tool] = { on0, on1, on2, writes: since(m).length };
    }
    // 字幕を動かして「位置と大きさを既定に戻す」を出す → 押す → 位置が戻る
    await ensureCaption();
    const box = await captionBox(api);
    const o = api.outer;
    const head = both();
    const m = mark();
    await mouse('mouseMoved', o.x + box.cx, o.y + box.cy);
    await mouse('mousePressed', o.x + box.cx, o.y + box.cy);
    for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', o.x + box.cx + i * 8, o.y + box.cy - i * 14, [], 1); await sleep(60); }
    await mouse('mouseReleased', o.x + box.cx + 48, o.y + box.cy - 84);
    await settle(m, 2500);
    await ensureCaption();
    const moved = { writes: since(m).length, cue: cue('c-0001') };
    const afterMove = await bottomTools(api);
    const shot = await previewShot('bottom-after-move');
    const m2 = mark();
    const pressedReset = await click('reset');
    await settle(m2, 2500);
    const reset = { pressed: pressedReset, writes: since(m2).length, cue: cue('c-0001') };
    const resetShot = await previewShot('bottom-after-reset');
    if (both() !== head) { await undoOnce(); await undoOnce(); }
    return { before, toggles, moved, afterMove, shot, reset, resetShot, backToStart: both() === head };
  });

  // 「…」: マイスタイルに保存・インスペクターを開く
  await scenario('more', async () => {
    await ensureCaption();
    await pressHost(`${BAR} [data-akari-bar-item="captionMore"]`);
    await sleep(500);
    const opened = await chrome();
    const moreItems = await evaluate(main, `[...document.querySelectorAll('[data-akari-menu-item^="caption"]')].filter(n => n.getClientRects().length > 0).map(n => ({ key: n.getAttribute('data-akari-menu-item'), label: n.textContent.trim(), in: n.closest('[data-akari-ui]')?.getAttribute('data-akari-ui') ?? null }))`);
    const shot = await windowShot('more-open');
    const m = mark();
    await pressHost('[data-akari-menu-item="captionMyStyleSave"]');
    await sleep(1500);
    const dialog = await evaluate(main, `(() => { const vis = n => n && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
      const d = [...document.querySelectorAll('dialog, .dialogBlock, .p-Widget.dialogOverlay, [role="dialog"], [data-akari-ui*="mystyle"], [data-akari-ui*="my-style"]')].filter(vis);
      return d.map(n => ({ tag: n.tagName, ui: n.getAttribute('data-akari-ui'), cls: String(n.className).slice(0, 80), text: n.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200) })); })()`);
    const saveShot = await windowShot('more-mystyle-save');
    const writesOnOpen = since(m).length;
    await key('Escape', 'Escape', 27);
    await sleep(800);
    await evaluate(main, `(() => { const b = [...document.querySelectorAll('.dialogOverlay button, [role="dialog"] button')].find(x => /キャンセル|閉じる|やめる/.test(x.textContent)); if (b) b.click(); return true; })()`);
    await sleep(600);
    await ensureCaption();
    await pressHost(`${BAR} [data-akari-bar-item="captionMore"]`);
    await sleep(500);
    await pressHost('[data-akari-menu-item="captionInspector"]');
    await sleep(1500);
    const inspector = await evaluate(main, `(() => { const p = document.querySelector('[data-akari-ui="panel:inspector"]'); if (!p) return null;
      const vis = p.getClientRects().length > 0; const active = document.activeElement;
      const tab = p.querySelector('[aria-selected="true"], .is-active, .active');
      return { visible: vis, activeTab: tab ? tab.textContent.trim().slice(0, 40) : null, focus: active ? (active.getAttribute('data-akari-field') ?? active.getAttribute('name') ?? active.tagName) : null,
        text: p.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300) }; })()`);
    const inspectorShot = await windowShot('more-inspector');
    return { opened: opened.more ?? opened.window, moreItems, menu: opened.menu, shot, dialog, saveShot, writesOnOpen, inspector, inspectorShot };
  });

  // 回帰: 写真・図形・文字（字幕の袋を item として選ぶ）の上のメニュー
  await scenario('regress', async () => {
    const out = {};
    for (const [name, id] of [['shape', 'shape-a'], ['photo', 'photo-1'], ['text', 'captions']]) {
      await key('Escape', 'Escape', 27);
      await api.executeCommand(main, 'akari.contextBar.run', { action: 'selectLayer', targetId: id });
      await sleep(1200);
      const c = await chrome();
      out[name] = { state: (await state())?.kind ?? null, bar: c.bar?.items?.map(i => i.key) ?? [], menu: c.menu?.items?.map(i => i.key) ?? [], shot: await previewShot(`regress-${name}`) };
    }
    // 図形の塗りの不透明度（B-1 の窓）が今までどおり書けるか: 書き込み 1 回・undo で戻る
    await api.executeCommand(main, 'akari.contextBar.run', { action: 'selectLayer', targetId: 'shape-a' });
    await sleep(900);
    const head = both();
    const m = mark();
    await api.executeCommand(main, 'akari.contextBar.run', { action: 'write', path: 'opacity', value: 0.5 });
    await settle(m, 2000);
    const opacity = JSON.parse(readFileSync(api.editPath, 'utf8')).tracks.flatMap(t => t.items).find(i => i.id === 'shape-a')?.opacity ?? null;
    const w = since(m).length;
    await undoOnce();
    out.shapeOpacity = { writes: w, opacity, undoBack: both() === head };
    return out;
  });

  clearInterval(poll);
}
