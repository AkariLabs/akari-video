// AFTER だけで回す追加の筋書き: 選び直し・解除の時系列（猶予と移行）・再生中・P-1 のドロップ。
import { measure, viewState } from './scenarios.mjs';

async function sampleStage(api, ms, step = 40) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await viewState(api);
    out.push({ t: Date.now() - t0, top: v.stage ? +(api.outer.y + v.stage.y).toFixed(1) : null, h: v.stage?.height ?? null });
    await api.sleep(step);
  }
  return out;
}
async function clickCaption(api, text = '字幕のメニュー') {
  const box = await api.evaluate(api.browser, `(() => {
    const hit = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes(${JSON.stringify(text)})
      && e.getBoundingClientRect().width > 0 && !e.closest('#caption-select-box'));
    if (!hit) return null; const b = hit.getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; })()`,
    api.view.contextId, api.view.sessionId);
  if (!box) throw new Error('caption not mounted');
  await api.viewClick(box.cx, box.cy);
  return box;
}
const summarize = samples => {
  const tops = samples.map(s => s.top).filter(v => v !== null);
  return { first: tops[0], last: tops.at(-1), distinct: [...new Set(tops)].length,
    changes: samples.filter((s, i) => i > 0 && s.top !== samples[i - 1].top).map(s => ({ t: s.t, top: s.top })) };
};

export default async function scenariosAfter(api) {
  const { scenario, sleep, previewShot } = api;

  // 選び直し（字幕 → 図形 → 字幕）と解除: 余白は広がったまま、解除から約 1 秒保って 150ms 程度で戻る
  await scenario('reselect-timeline', async () => {
    await sleep(1600);
    const idle = await measure(api);
    await clickCaption(api);
    const afterCaption = await sampleStage(api, 900);
    const mCaption = await measure(api);
    await api.selectItem('shape-a');
    const afterShape = await sampleStage(api, 900);
    const mShape = await measure(api);
    await clickCaption(api);
    const afterCaption2 = await sampleStage(api, 700);
    await api.key('Escape', 'Escape', 27);
    const tEsc = Date.now();
    const afterDeselect = await sampleStage(api, 2000, 30);
    const mDeselected = await measure(api);
    return { idleTop: idle.stageTop, mCaption, mShape, mDeselected, escToFirstSampleMs: Date.now() - tEsc - 2000,
      afterCaption: summarize(afterCaption), afterShape: summarize(afterShape), afterCaption2: summarize(afterCaption2),
      afterDeselect: summarize(afterDeselect), rawDeselect: afterDeselect };
  });

  // 再生中は動かない: 字幕を選んで余白が広がった状態で再生 → 再生中に選択を外す（Escape）→ 猶予を過ぎても動かない → 止めたら戻る
  // （出力プレビューの上をクリックすると再生が止まるため、再生中の「選ぶ」は操作として作れない。解除側で確かめる）
  await scenario('playing', async () => {
    await sleep(1600);
    const idle = await measure(api);
    await clickCaption(api);
    await sleep(900);
    const selected = await measure(api);
    await api.evaluate(api.browser, `(() => { document.getElementById('play-toggle').click(); return true; })()`, api.view.contextId, api.view.sessionId);
    await sleep(400);
    const playingLabel = (await viewState(api)).playing;
    await api.key('Escape', 'Escape', 27);
    const whilePlaying = await sampleStage(api, 1800);
    const mPlaying = await measure(api);
    await api.evaluate(api.browser, `(() => { const b = document.getElementById('play-toggle'); if (b.getAttribute('aria-label') === '一時停止') b.click(); return true; })()`, api.view.contextId, api.view.sessionId);
    const afterPause = await sampleStage(api, 900);
    const mPaused = await measure(api);
    return { idleTop: idle.stageTop, selectedTop: selected.stageTop, selectedGap: selected.gapBarToStage, playingLabel, mPlaying, mPaused,
      whilePlaying: summarize(whilePlaying), afterPause: summarize(afterPause), shotPaused: await previewShot('playing-then-paused') };
  });

  // P-1: 字幕を選んで余白が広がった状態で、ライブラリの写真を出力の枠の右上 (0.75, 0.25) に落とす
  await scenario('drop', async () => {
    await api.key('Escape', 'Escape', 27);
    await sleep(1600);
    const output = (await api.readEdit()).output;
    await clickCaption(api);
    await sleep(900);
    const clearance = await measure(api);
    // ライブラリ → 画像のカテゴリ
    const libTab = await api.evaluate(api.main, `(() => { const e = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'ライブラリ' && e.getBoundingClientRect().width > 0);
      if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!libTab) throw new Error('library tab not found');
    await api.hostClick(libTab.x, libTab.y);
    await sleep(3000);
    const cat = await api.evaluate(api.main, `(() => { const b = document.querySelector('[data-akari-library-category=image]'); if (!b) return null; b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (cat) { await api.hostClick(cat.x, cat.y); await sleep(3000); }
    const card = await api.evaluate(api.main, `(() => { const el = [...document.querySelectorAll('[data-akari-catalog-item]')].find(e => e.getAttribute('draggable') === 'true' && e.getAttribute('data-akari-catalog-item-state') !== 'locked');
      if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
      return { key: el.getAttribute('data-akari-catalog-item'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(30, r.height / 2)) }; })()`);
    if (!card) throw new Error('no draggable catalog card');
    const beforeDrag = await measure(api);
    const s = beforeDrag.stageHost;
    const drop = { x: Math.round(s.x + 0.75 * s.width), y: Math.round(s.y + 0.25 * s.height) };
    const expected = { x: (drop.x - s.x) / s.width * output.width - output.width / 2, y: (drop.y - s.y) / s.height * output.height - output.height / 2 };
    const beforeText = JSON.stringify(await api.readEdit());
    const events = [];
    api.main.on('Input.dragIntercepted', p => events.push(p));
    await api.main.send('Input.setInterceptDrags', { enabled: true });
    await api.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
    await api.main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await api.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
    await sleep(400);
    let duringDrag = null;
    if (events.length) {
      const data = events[0].data;
      const at = (type, x, y) => api.main.send('Input.dispatchDragEvent', { type, x, y, data });
      await at('dragEnter', drop.x - 60, drop.y + 40); await sleep(150);
      for (const [x, y] of [[drop.x - 30, drop.y + 20], [drop.x, drop.y], [drop.x, drop.y]]) { await at('dragOver', x, y); await sleep(250); }
      duringDrag = await measure(api);
      await api.screenshot('drop-during-drag');
      await at('drop', drop.x, drop.y);
    }
    await api.main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
    await api.main.send('Input.setInterceptDrags', { enabled: false });
    let after;
    for (let i = 0; i < 180; i++) { await sleep(500); after = await api.readEdit(); if (JSON.stringify(after) !== beforeText) break; }
    await sleep(1500);
    after = await api.readEdit();
    const beforeIds = new Set(api.allItems(JSON.parse(beforeText)).map(i => i.id));
    const added = api.allItems(after).filter(i => !beforeIds.has(i.id)).map(i => ({ ...i, item: api.findItem(after, i.id) }));
    const placed = added[0]?.item;
    const afterDrop = await measure(api);
    // 余白の猶予が切れたあと（選択を外して 1.6 秒）に、置いた写真の描画位置を出力 px へ換算
    await api.key('Escape', 'Escape', 27);
    await sleep(1800);
    const settled = await measure(api);
    const layerIds = await api.evaluate(api.browser, `[...document.querySelectorAll('[data-akari-layer-id]')].map(n => n.getAttribute('data-akari-layer-id'))`, api.view.contextId, api.view.sessionId);
    const rendered = placed ? await api.evaluate(api.browser, `(() => { const n = [...document.querySelectorAll('[data-akari-layer-id]')].find(e => e.getAttribute('data-akari-layer-id') === ${JSON.stringify(placed.id)} || e.getAttribute('data-akari-layer-id').endsWith(${JSON.stringify(placed.id)})); if (!n) return null;
      const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`, api.view.contextId, api.view.sessionId) : null;
    const st = settled.stageHost;
    const renderedCenterOutput = rendered ? {
      x: +(((api.outer.x + rendered.x + rendered.width / 2) - st.x) / st.width * output.width - output.width / 2).toFixed(2),
      y: +(((api.outer.y + rendered.y + rendered.height / 2) - st.y) / st.height * output.height - output.height / 2).toFixed(2) } : null;
    const settledShot = await previewShot('drop-after-settled');
    return { card, clearanceTop: clearance.stageTop, clearanceGap: clearance.gapBarToStage, drop, stageAtDrop: s, duringDragStage: duringDrag?.stageHost ?? null,
      dragIntercepted: events.length > 0, expectedTransformXY: { x: +expected.x.toFixed(2), y: +expected.y.toFixed(2) },
      placed: placed ? { id: placed.id, transform: placed.transform } : null,
      errorXY: placed?.transform ? { x: +(placed.transform.x - expected.x).toFixed(2), y: +(placed.transform.y - expected.y).toFixed(2) } : null,
      afterDropStage: afterDrop.stageHost, settledStage: st, renderedCenterOutput,
      renderedErrorXY: renderedCenterOutput && placed?.transform ? { x: +(renderedCenterOutput.x - placed.transform.x).toFixed(2), y: +(renderedCenterOutput.y - placed.transform.y).toFixed(2) } : null,
      layerIds, settledShot };
  });
}
