// run-l1.mjs から読む筋書き（BEFORE: 基点のビルド）。
// - bar: 字幕を選んだときの今の上のメニュー（項目・段数・高さ）を撮る（fixtures/captions.json）
// - props: スキーマに既にある項目（italic / underline / text_transform / vertical / align / vertical_align /
//   line_height / letter_spacing_em）をひとつずつ持つ字幕（fixtures/captions-props.json）をプレビューで描き、
//   字幕の行の computed style と出力の枠のスクショを残す（書き出しとの比較は render-parity.mjs）

async function stageClip(api) {
  const s = await api.stageBox();
  return { x: api.outer.x + s.x, y: api.outer.y + s.y, width: s.width, height: s.height };
}

export async function captionComputed(api) {
  return api.evaluate(api.browser, `(() => {
    const vis = n => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
    const lines = [...document.querySelectorAll('.akari-caption__line, .caption-row-plate, [class*="caption"]')].filter(vis);
    const line = lines.find(n => n.classList.contains('akari-caption__line')) ?? lines[0];
    if (!line) return null;
    const c = getComputedStyle(line);
    const b = line.getBoundingClientRect();
    const plate = line.closest('.caption-row-plate');
    return { cls: String(line.className), text: line.textContent.slice(0, 60),
      fontStyle: c.fontStyle, textDecorationLine: c.textDecorationLine, textDecorationColor: c.textDecorationColor,
      textTransform: c.textTransform, writingMode: c.writingMode, textOrientation: c.textOrientation, textAlign: c.textAlign,
      lineHeight: c.lineHeight, letterSpacing: c.letterSpacing, opacity: c.opacity, color: c.color,
      rect: { left: b.left, top: b.top, width: b.width, height: b.height },
      plate: plate ? (() => { const p = plate.getBoundingClientRect(); const pc = getComputedStyle(plate);
        return { rect: { left: p.left, top: p.top, width: p.width, height: p.height }, writingMode: pc.writingMode, textAlign: pc.textAlign, alignItems: pc.alignItems, justifyContent: pc.justifyContent }; })() : null };
  })()`, api.view.contextId, api.view.sessionId);
}

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

export default async function scenarios(api) {
  const { scenario, previewShot, screenshot, sleep } = api;
  const props = api.captionsPath && (await import('node:fs/promises')).readFile(api.captionsPath, 'utf8')
    .then(text => JSON.parse(text).captions.some(c => c.id === 'c-0010'));

  if (!(await props)) {
    await scenario('bar', async () => {
      const picked = await selectCaptionText(api, '字幕のメニュー');
      await sleep(900);
      const chrome = await api.chrome();
      const out = { picked, bar: chrome.bar, window: chrome.window };
      if (chrome.bar) {
        const r = chrome.bar.rect;
        out.rows = null;
        out.barShot = await screenshot('bar', { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 });
      }
      out.previewShot = await previewShot('caption-selected');
      out.windowShot = await api.windowShot('caption-selected-window');
      return out;
    });
    return;
  }

  await scenario('props', async () => {
    const edit = JSON.parse(await (await import('node:fs/promises')).readFile(api.captionsPath, 'utf8'));
    const out = [];
    for (const cue of edit.captions) {
      const t = cue.start + 0.5;
      await api.evaluate(api.browser, `(() => { window.postMessage({type:'akari-preview-seek',time:${t}}, '*'); return true; })()`, api.view.contextId, api.view.sessionId);
      await sleep(1500);
      const computed = await captionComputed(api);
      const shot = await screenshot(`prop-${cue.id}`, await stageClip(api));
      out.push({ id: cue.id, t, text_style: cue.text_style ?? null, computed, shot });
    }
    return out;
  });
}
