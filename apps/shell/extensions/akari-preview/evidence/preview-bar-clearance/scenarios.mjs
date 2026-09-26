// run-l1.mjs から読む筋書き（BEFORE / AFTER 共通）。
// 上のメニュー（字幕のスタイルのバー / 小さなメニュー）の下端と、出力の枠（#preview-stage）の上端の間隔を
// fit / 100% / 200% で測り、2 本指スクロール（ctrl なしの wheel）とピンチ（ctrl ありの wheel）の結果を記録する。

const OUTPUT = { landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } };

/** webview の中の出力の枠・ペイン・ズームの状態（view px）。 */
export async function viewState(api) {
  return api.evaluate(api.browser, `(() => {
    const r = n => { if (!n) return null; const b = n.getBoundingClientRect(); return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) }; };
    const zoomLayer = document.getElementById('zoom-layer');
    return { stage: r(document.getElementById('preview-stage')), pane: r(document.querySelector('.preview-pane')),
      zoomTransform: zoomLayer?.style.transform ?? null, zoomValue: document.getElementById('zoom-value')?.textContent ?? null,
      stageStyle: (() => { const s = document.getElementById('preview-stage'); if (!s) return null; const c = getComputedStyle(s); return { top: c.top, transform: c.transform, transition: c.transition, gutterTop: c.getPropertyValue('--akari-preview-gutter-top') || null, className: s.className }; })(),
      playing: document.getElementById('play-toggle')?.getAttribute('aria-label') ?? null };
  })()`, api.view.contextId, api.view.sessionId);
}

/** 本体の座標にそろえた計測: バー・小さなメニューの下端と出力の枠の上端。 */
export async function measure(api) {
  const chrome = await api.chrome();
  const view = await viewState(api);
  const outer = api.outer;
  const stageHost = view.stage ? { x: +(outer.x + view.stage.x).toFixed(2), y: +(outer.y + view.stage.y).toFixed(2), width: view.stage.width, height: view.stage.height } : null;
  const barBottom = chrome.bar ? +(chrome.bar.rect.top + chrome.bar.rect.height).toFixed(2) : null;
  const menuBottom = chrome.menu ? +(chrome.menu.rect.top + chrome.menu.rect.height).toFixed(2) : null;
  return {
    bar: chrome.bar ? { rect: chrome.bar.rect, bottom: barBottom, items: chrome.bar.items.length } : null,
    menu: chrome.menu ? { rect: chrome.menu.rect, bottom: menuBottom } : null,
    frame: chrome.frame,
    stageHost,
    stageTop: stageHost?.y ?? null,
    gapBarToStage: barBottom !== null && stageHost ? +(stageHost.y - barBottom).toFixed(2) : null,
    overlapsBar: barBottom !== null && stageHost ? stageHost.y < barBottom : null,
    view,
  };
}

async function clickPreset(api, zoom) {
  // プリセットのボタンを webview の中で押す（本体のクリックだと選択が外れる位置に当たることがあるため）
  return api.evaluate(api.browser, `(() => { const b = document.querySelector('.zoom-preset[data-zoom="${zoom}"]'); if (!b) return false; b.click(); return true; })()`,
    api.view.contextId, api.view.sessionId);
}
async function fitReset(api) {
  // 既存の「fit に戻す」操作 = ズームのスライダーのダブルクリック
  return api.evaluate(api.browser, `(() => { const s = document.getElementById('zoom-slider'); if (!s) return false; s.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`,
    api.view.contextId, api.view.sessionId);
}
export async function wheel(api, x, y, deltaX, deltaY, modifiers = 0) {
  await api.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, modifiers });
  await api.main.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers });
  await api.sleep(450);
}
function outputAt(stageHost, output, x, y) {
  return { x: +((x - stageHost.x) / stageHost.width * output.width).toFixed(2), y: +((y - stageHost.y) / stageHost.height * output.height).toFixed(2) };
}

async function selectPhoto(api) {
  // 写真のレイヤー要素（frame-engine 描画中は visibility:hidden でも矩形は持つ）の中心を押す
  const hit = await api.evaluate(api.browser, `(() => { const n = document.querySelector('[data-akari-layer-id="photo-1"]'); if (!n) return null;
    const b = n.getBoundingClientRect(); return b.width > 0 ? { cx: b.left + b.width / 2, cy: b.top + b.height / 2, width: b.width, height: b.height } : null; })()`,
    api.view.contextId, api.view.sessionId);
  if (hit) {
    await api.viewClick(hit.cx, hit.cy);
    await api.sleep(800);
    // 1 回目がホバーだけで選択にならないことがある（BEFORE の横長で実測）ので、バーが出ていなければもう 1 回
    if (!(await api.chrome()).bar) { await api.viewClick(hit.cx, hit.cy); await api.sleep(800); hit.retried = true; }
    return hit;
  }
  const edit = await api.readEdit();
  const item = api.findItem(edit, 'photo-1');
  const stage = await api.stageBox();
  const k = stage.width / edit.output.width;
  const t = item.transform ?? {};
  const cx = stage.x + (edit.output.width / 2 + (t.x ?? 0)) * k;
  const cy = stage.y + (edit.output.height / 2 + (t.y ?? 0)) * k;
  await api.viewClick(cx, cy);
  await api.sleep(800);
  return { cx, cy };
}
async function selectCaption(api) {
  const box = await api.evaluate(api.browser, `(() => {
    const hit = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes('字幕のメニュー')
      && e.getBoundingClientRect().width > 0 && !e.closest('#caption-select-box'));
    if (!hit) return null;
    const b = hit.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  })()`, api.view.contextId, api.view.sessionId);
  if (!box) throw new Error('caption not mounted');
  await api.viewClick(box.cx, box.cy);
  await api.sleep(900);
  return box;
}
async function selectKind(api, kind) {
  if (kind === 'caption') return selectCaption(api);
  if (kind === 'photo') return selectPhoto(api);
  return api.selectItem('shape-a');
}

export default async function scenarios(api) {
  const { scenario, previewShot, sleep } = api;
  const output = OUTPUT[api.aspect];

  await scenario('none', async () => {
    await fitReset(api);
    await sleep(600);
    return { m: await measure(api), shot: await previewShot('none-fit') };
  });

  for (const kind of ['caption', 'photo', 'shape']) {
    await scenario(`select-${kind}`, async () => {
      await fitReset(api);
      await sleep(400);
      const picked = await selectKind(api, kind);
      await sleep(900);
      const out = { picked, fit: await measure(api), fitShot: await previewShot(`${kind}-fit`) };
      await clickPreset(api, 1);
      await sleep(700);
      out.zoom100 = await measure(api);
      out.zoom100Shot = await previewShot(`${kind}-100`);
      await clickPreset(api, 2);
      await sleep(700);
      out.zoom200 = await measure(api);
      out.zoom200Shot = await previewShot(`${kind}-200`);
      await fitReset(api);
      await sleep(600);
      out.afterReset = await measure(api);
      return out;
    });
  }

  // 2 本指スクロール（ctrl なし）とピンチ（ctrl あり）。字幕を選んだ状態（上のメニューが出ている）で測る
  await scenario('wheel', async () => {
    await fitReset(api);
    await sleep(400);
    await selectCaption(api);
    await sleep(900);
    const base = await measure(api);
    const pane = base.view.pane;
    // ペインの左下寄り（出力の枠の外・再生の帯の上）で回す
    const px = api.outer.x + pane.x + Math.min(40, pane.width * 0.05);
    const py = api.outer.y + pane.y + pane.height * 0.55;
    const out = { at: { x: px, y: py }, base };
    await wheel(api, px, py, 0, 60);
    out.scrollDown60 = await measure(api);
    out.scrollDownShot = await previewShot('wheel-scroll-down');
    await wheel(api, px, py, 0, -120);
    out.scrollUp120 = await measure(api);
    out.scrollUpShot = await previewShot('wheel-scroll-up');
    await wheel(api, px, py, 50, 0);
    out.scrollRight50 = await measure(api);
    await fitReset(api);
    await sleep(600);
    out.afterFitReset = await measure(api);
    // ズーム 200% で 2 本指スクロール
    await clickPreset(api, 2);
    await sleep(700);
    out.zoom200 = await measure(api);
    await wheel(api, px, py, 40, 80);
    out.zoom200Scrolled = await measure(api);
    out.zoom200ScrolledShot = await previewShot('wheel-zoom200-scrolled');
    await fitReset(api);
    await sleep(600);
    out.afterFitReset2 = await measure(api);
    out.afterFitReset2Shot = await previewShot('wheel-after-fit-reset');
    return out;
  });

  await scenario('pinch', async () => {
    await fitReset(api);
    await sleep(600);
    const base = await measure(api);
    const s = base.stageHost;
    // 出力の枠の左上 1/4 の点を基準にピンチ（拡大）
    const cx = s.x + s.width * 0.25;
    const cy = s.y + s.height * 0.3;
    const out = { at: { x: cx, y: cy }, base, outputUnderCursorBefore: outputAt(s, output, cx, cy) };
    out.beforeShot = await previewShot('pinch-before');
    await wheel(api, cx, cy, 0, -40, 2);
    await wheel(api, cx, cy, 0, -40, 2);
    const after = await measure(api);
    out.after = after;
    out.outputUnderCursorAfter = outputAt(after.stageHost, output, cx, cy);
    out.afterShot = await previewShot('pinch-after');
    await fitReset(api);
    await sleep(600);
    out.afterFitReset = await measure(api);
    return out;
  });

  if (api.label.startsWith('after')) {
    const after = await import('./scenarios-after.mjs');
    await after.default(api);
  }
}
