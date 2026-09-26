// run-l1.mjs から読む操作の筋書き。BEFORE は「字幕を選ぶと今は上下に何が出るか」だけを記録する。
export async function captionBox(api, text = '字幕のメニュー') {
  return api.evaluate(api.browser, `(() => {
    const hit = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && (e.textContent || '').includes(${JSON.stringify(text)})
      && e.getBoundingClientRect().width > 0 && !e.closest('#caption-select-box'));
    if (!hit) return null;
    const b = hit.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  })()`, api.view.contextId, api.view.sessionId);
}
export async function selectCaption(api, text) {
  const box = await captionBox(api, text);
  if (!box) throw new Error('caption not mounted');
  await api.viewClick(box.cx, box.cy);
  await api.sleep(900);
  return box;
}
/** webview の中の字幕の下の道具バー（見えているボタン）。 */
export async function bottomTools(api) {
  return api.evaluate(api.browser, `(() => {
    const box = document.getElementById('caption-select-box');
    const vis = n => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden' && !n.hidden;
    if (!box) return null;
    const r = box.querySelector('.akari-caption-select-tools')?.getBoundingClientRect();
    return { active: box.classList.contains('is-active'),
      rect: r ? { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) } : null,
      all: [...box.querySelectorAll('[data-caption-tool]')].map(b => b.getAttribute('data-caption-tool')),
      visible: [...box.querySelectorAll('[data-caption-tool]')].filter(vis).map(b => ({ tool: b.getAttribute('data-caption-tool'),
        label: b.getAttribute('aria-label'), tip: b.querySelector('.akari-caption-tool-tip')?.textContent ?? null, on: b.classList.contains('on') })) };
  })()`, api.view.contextId, api.view.sessionId);
}
export default async function scenarios(api) {
  const { scenario, selectItem, chrome, previewShot, windowShot } = api;
  if (api.label.startsWith('before')) {
    await scenario('caption', async () => {
      const box = await selectCaption(api);
      const shot = await previewShot('01-select-caption');
      const win = await windowShot('01-select-caption-window');
      return { box, shot, win, chrome: await chrome(), bottom: await bottomTools(api) };
    });
    await scenario('shape', async () => {
      await selectItem('shape-a');
      const shot = await previewShot('02-select-shape');
      return { shot, chrome: await chrome() };
    });
    await scenario('photo', async () => {
      await selectItem('photo-1');
      const shot = await previewShot('03-select-photo');
      return { shot, chrome: await chrome() };
    });
    return;
  }
  const after = await import('./scenarios-after.mjs');
  await after.default(api);
}
