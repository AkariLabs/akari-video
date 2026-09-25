// run-l1.mjs から読む AFTER の筋書き（上のバー・窓・小さなメニュー・⋯・ロック・コピー / 貼り付け・スタイルをコピー）。
// --label after-other --project b1-other --only pasteOther は、前の実行でコピーしたものを別のプロジェクトで貼る。

const CLIP_FILE = '/tmp/libcanvas-b1-context-bar-clip.json';
const KEYS = (bar) => (bar?.items ?? []).map(item => item.key);

export default async function scenarios(api) {
  const { scenario, selectItem, chrome, webviewHandles, previewShot, key, pb, sleep, readEdit, findItem, allItems,
    pressHost, hostButton, hostClick, evaluate, main, mouse, itemBox, waitEditChange, viewClick, stageBox } = api;
  const editText = async () => JSON.stringify(await readEdit());
  const state = async () => (await api.executeCommand(main, 'akari.contextBar.getState'))?.value ?? null;
  /** プレビューで押して選ぶ。重なりで別のものに当たったら、タイムラインから選び直す（記録に残す）。 */
  const picks = [];
  const pick = async id => {
    await selectItem(id);
    await sleep(500);
    if ((await state())?.selectedId === id) { picks.push({ id, by: 'preview' }); return 'preview'; }
    await api.executeCommand(main, 'akari.contextBar.run', { action: 'selectLayer', targetId: id });
    await sleep(1200);
    const ok = (await state())?.selectedId === id;
    picks.push({ id, by: ok ? 'timeline' : 'failed' });
    return ok ? 'timeline' : 'failed';
  };
  const press = async (selector, wait = true) => {
    const before = await editText();
    await pressHost(selector);
    if (wait) await waitEditChange(before, 6000);
    await sleep(900);
  };
  const setField = async (selector, value) => {
    const before = await editText();
    await evaluate(main, `(() => { const input = document.querySelector(${JSON.stringify(selector)});
      input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitEditChange(before, 6000);
    await sleep(900);
  };
  const inspectorText = () => evaluate(main, `(() => { const p = document.querySelector('[data-akari-ui="panel:inspector"]');
    return p ? p.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const inspectorInput = name => evaluate(main, `(() => { const f = document.querySelector('[data-inspector-field="${name}"] input');
    return f ? f.value : null; })()`);

  if (api.label.startsWith('after-other')) {
    await scenario('pasteOther', async () => {
      // 前の実行でアプリがコピーした JSON（一時ファイル）をこの確認の間だけ OS のクリップボードへ載せる（終わると run-l1 が元へ戻す）
      const saved = await import('node:fs').then(fs => fs.readFileSync(CLIP_FILE, 'utf8'));
      pb(['pbcopy'], saved);
      const clip = pb(['pbpaste']).stdout ?? '';
      let parsed = null;
      try { parsed = JSON.parse(clip); } catch { /* 文字列 */ }
      const stage = await stageBox();
      // 何も選んでいない出力プレビューに焦点を置いて ⌘V
      await viewClick(stage.x + stage.width / 2, Math.max(4, stage.y - 12));
      await key('Escape', 'Escape', 27);
      const selectedBefore = (await api.executeCommand(main, 'akari.contextBar.getState'))?.value?.selectedId ?? null;
      await sleep(500);
      const before = await editText();
      await key('v', 'KeyV', 86, ['meta']);
      await waitEditChange(before, 8000);
      await sleep(2500);
      const edit = await readEdit();
      const pasted = allItems(edit).find(entry => entry.id.startsWith(parsed?.item?.id ?? '---'));
      const item = pasted ? findItem(edit, pasted.id) : null;
      const shot = await previewShot('20-paste-other-project');
      return { clipboardKind: parsed?.kind ?? null, clipboardItemId: parsed?.item?.id ?? null, selectedBefore,
        pasted: item, sources: edit.sources, shot, chrome: await chrome() };
    });
    return;
  }

  // 1. 図形: 中央上のバー（図形の項目）→ 塗りの色 → インスペクターの色パネル → 色を選ぶ → プレビュー・インスペクター・edit.json に同じ値
  await scenario('shape', async () => {
    await pick('shape-a');
    await sleep(800);
    const first = await chrome();
    const shot = await previewShot('01-shape-bar');
    await pressHost('[data-akari-ui="preview-context-bar"] [data-akari-bar-item="fill"]');
    await sleep(1500);
    const panelOpen = (await chrome()).inspectorColorPanel;
    const dot = await evaluate(main, `(() => {
      const dots = [...document.querySelectorAll('[data-akari-ui="panel:inspector-color"] button[data-cp-paint]')]
        .filter(b => b.getBoundingClientRect().width > 0 && !String(b.style.background).includes('gradient') && !b.classList.contains('is-current'));
      const solid = [...document.querySelectorAll('[data-akari-ui="panel:inspector-color"] button[data-cp-paint]')]
        .filter(b => b.getBoundingClientRect().width > 0 && /^#[0-9A-F]{6}$/i.test(b.title) && !b.classList.contains('is-current'));
      const pick = solid.find(b => b.title.toUpperCase() === '#4C7A8C') ?? solid[3] ?? dots[0];
      if (!pick) return null;
      const r = pick.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: pick.title, background: pick.style.background };
    })()`);
    const before = await editText();
    if (dot) await hostClick(dot.x, dot.y);
    await waitEditChange(before, 6000);
    await sleep(2500);
    const edit = await readEdit();
    const after = await chrome();
    const barDot = await evaluate(main, `(() => { const d = document.querySelector('[data-akari-bar-item="fill"] .akari-ctx-dot'); return d ? getComputedStyle(d).backgroundColor : null; })()`);
    const shapeFill = await evaluate(api.browser, `(() => { const n = document.querySelector('[data-overlay-id="shape-a"] svg path'); return n ? getComputedStyle(n).fill : null; })()`,
      api.view.contextId, api.view.sessionId);
    const shot2 = await previewShot('02-shape-fill-changed');
    const window = await api.windowShot('03-shape-fill-window');
    return { barKeys: KEYS(first.bar), bar: first.bar, menu: first.menu, shot, panelOpen, dot,
      fillInEdit: findItem(edit, 'shape-a')?.source?.params?.fill, barDot, previewFill: shapeFill, shot2, window,
      inspectorColorPanel: after.inspectorColorPanel };
  });

  // 2. 不透明度の窓: 変えるとプレビューとインスペクターに同じ値
  await scenario('opacity', async () => {
    await pick('shape-a');
    await pressHost('[data-akari-bar-item="opacity"]');
    await sleep(700);
    const open = await chrome();
    const shot = await previewShot('04-opacity-window');
    await setField('[data-akari-ui="preview-context-window"] input[type="number"][data-field="opacity"]', 60);
    await sleep(1500);
    const edit = await readEdit();
    const previewOpacity = await evaluate(api.browser, `(() => { const n = document.querySelector('[data-overlay-id="shape-a"]'); return n ? getComputedStyle(n).opacity : null; })()`,
      api.view.contextId, api.view.sessionId);
    const inspector = await inspectorText();
    return { window: open.window, opacityInEdit: findItem(edit, 'shape-a')?.opacity, previewOpacity,
      inspectorShows60: /60\s*%?/.test(inspector ?? ''), shot };
  });

  // 3. 配置の窓: 重なり順・画面に揃える・数値・レイヤー一覧（並べ替え・開いたまま選ぶ）
  await scenario('arrange', async () => {
    await pick('shape-a');
    await pressHost('[data-akari-bar-item="arrange"]');
    await sleep(1800);
    const open = await chrome();
    const rows = await evaluate(main, `[...document.querySelectorAll('[data-akari-ui="preview-context-window"] [data-layer]')].map(r => ({ id: r.dataset.layer, text: r.textContent.replace(/\\s+/g, ' ').trim(), selected: r.classList.contains('is-selected') }))`);
    const shot = await previewShot('05-arrange-window');
    const trackOrder = async () => (await readEdit()).tracks.map(track => track.items?.map(item => item.id).join('+'));
    const beforeOrder = await trackOrder();
    // shape-a の行のつまみを、いちばん上（前面）の行へドラッグ
    await evaluate(main, `document.querySelector('[data-akari-ui="preview-context-window"] .akari-ctx-layers')?.scrollIntoView({ block: 'nearest' })`);
    await sleep(300);
    const grip = await hostButton('[data-akari-ui="preview-context-window"] [data-grip="shape-a"]');
    const topRow = await evaluate(main, `(() => { const r = document.querySelector('[data-akari-ui="preview-context-window"] [data-layer]'); if (!r) return null; const b = r.getBoundingClientRect(); return { id: r.dataset.layer, x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const before = await editText();
    if (grip && topRow) {
      await mouse('mouseMoved', grip.x, grip.y);
      await mouse('mousePressed', grip.x, grip.y);
      for (let step = 1; step <= 6; step++) {
        await mouse('mouseMoved', grip.x + (topRow.x - grip.x) * step / 6, grip.y + (topRow.y - grip.y) * step / 6, [], 1);
        await sleep(60);
      }
      await mouse('mouseReleased', topRow.x, topRow.y);
    }
    await waitEditChange(before, 6000);
    await sleep(2000);
    const afterOrder = await trackOrder();
    const rowsAfter = await evaluate(main, `[...document.querySelectorAll('[data-akari-ui="preview-context-window"] [data-layer]')].map(r => r.dataset.layer)`);
    // 開いたまま別の行を押して選ぶ
    await pressHost('[data-akari-ui="preview-context-window"] [data-select-layer="shape-b"]');
    await sleep(1800);
    const afterPick = await chrome();
    const selectedRow = await evaluate(main, `(() => { const r = document.querySelector('[data-akari-ui="preview-context-window"] .akari-ctx-layer.is-selected'); return r ? r.dataset.layer : null; })()`);
    const shot2 = await previewShot('06-arrange-reordered');
    // 数値: X を書く → edit.json とインスペクター
    await setField('[data-akari-ui="preview-context-window"] input[data-geo="x"]', 640);
    await sleep(1200);
    const x = findItem(await readEdit(), 'shape-b')?.transform?.x;
    const inspectorX = await evaluate(main, `(() => { const p = document.querySelector('[data-akari-ui="panel:inspector"]');
      return p ? [...p.querySelectorAll('input')].map(i => i.value).filter(v => v === '640').length : null; })()`);
    // 最前面へ（P5 と同じ操作）
    const beforeZ = await trackOrder();
    await press('[data-akari-ui="preview-context-window"] [data-z="back"]');
    const afterZ = await trackOrder();
    return { window: open.window, rows, beforeOrder, afterOrder, rowsAfter, windowStillOpen: afterPick.window?.kind ?? null,
      selectedRow, x, inspectorX, beforeZ, afterZ, shot, shot2 };
  });

  // 4. ライン: ラインの項目・線の種類の窓
  await scenario('line', async () => {
    await key('Escape', 'Escape', 27);
    await pick('line');
    await sleep(800);
    const bar = (await chrome()).bar;
    const shot = await previewShot('07-line-bar');
    await pressHost('[data-akari-bar-item="dash"]');
    await sleep(700);
    const shotWindow = await previewShot('08-line-dash-window');
    await press('[data-akari-ui="preview-context-window"] [data-choice="dash"][data-value="dash"]');
    await pressHost('[data-akari-bar-item="ends"]');
    await sleep(700);
    await press('[data-akari-ui="preview-context-window"] [data-action="swapEnds"]');
    const params = findItem(await readEdit(), 'line')?.source?.params;
    return { barKeys: KEYS(bar), bar, dash: params?.dash, startCap: params?.startCap, endCap: params?.endCap, shot, shotWindow };
  });

  // 5. 写真: 写真の項目
  await scenario('photo', async () => {
    await key('Escape', 'Escape', 27);
    await pick('photo-1');
    await sleep(1000);
    const state = await chrome();
    const shot = await previewShot('09-photo-bar');
    return { barKeys: KEYS(state.bar), bar: state.bar, menu: state.menu, shot };
  });

  // 6. 小さなメニュー: ロック → つまみが消え削除できない・複製はできる → ⋯
  await scenario('lock', async () => {
    await key('Escape', 'Escape', 27);
    await pick('shape-a');
    await sleep(800);
    const menuBefore = (await chrome()).menu;
    await press('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="lock"]');
    await sleep(1500);
    const locked = findItem(await readEdit(), 'shape-a')?.locked;
    const state = await chrome();
    const handles = await webviewHandles();
    const frameLocked = await evaluate(api.browser, `(() => { const f = document.querySelector('.akari-interaction-selection-frame'); return f ? f.classList.contains('is-locked') : null; })()`,
      api.view.contextId, api.view.sessionId);
    const shot = await previewShot('10-locked');
    // ドラッグしても動かない
    const box = await itemBox('shape-a');
    const beforeDrag = await editText();
    if (box) {
      await api.viewClick(box.cx, box.cy);
      const ox = api.outer.x, oy = api.outer.y;
      await mouse('mousePressed', ox + box.cx, oy + box.cy);
      await mouse('mouseMoved', ox + box.cx + 60, oy + box.cy + 40, [], 1);
      await mouse('mouseMoved', ox + box.cx + 120, oy + box.cy + 60, [], 1);
      await mouse('mouseReleased', ox + box.cx + 120, oy + box.cy + 60);
      await sleep(1500);
    }
    const movedWhileLocked = (await editText()) !== beforeDrag;
    // Delete キーでも消えない
    await pick('shape-a');
    await key('Delete', 'Delete', 46);
    await sleep(1500);
    const stillThere = !!findItem(await readEdit(), 'shape-a');
    // 複製はできる
    await press('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="duplicate"]');
    await sleep(1200);
    const edit = await readEdit();
    const copy = allItems(edit).find(entry => entry.id.startsWith('shape-a-copy'));
    // ⋯ のメニュー
    await pick('shape-a');
    await sleep(600);
    await pressHost('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="more"]');
    await sleep(1200);
    const more = (await chrome()).more;
    const shotMore = await previewShot('11-more-menu');
    await key('Escape', 'Escape', 27);
    // ロックを外す（鍵から）
    await pick('shape-a');
    await press('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="lock"]');
    const unlocked = findItem(await readEdit(), 'shape-a')?.locked === undefined;
    return { menuBefore, locked, deleteDisabled: state.menu?.items.find(item => item.key === 'delete')?.disabled,
      lockPressed: state.menu?.items.find(item => item.key === 'lock')?.pressed, handles, frameLocked, movedWhileLocked,
      stillThere, duplicated: copy ? findItem(edit, copy.id) : null, more, unlocked, shot, shotMore };
  });

  // 7. ⌘C → クリップボードに edit.json の item（JSON）/ ⌘V → 20px ずらして貼る
  await scenario('copyPaste', async () => {
    await key('Escape', 'Escape', 27);
    await pick('shape-b');
    await sleep(600);
    pb(['pbcopy'], 'after-marker');
    await key('c', 'KeyC', 67, ['meta']);
    await sleep(1200);
    const clip = pb(['pbpaste']).stdout ?? '';
    let parsed = null;
    try { parsed = JSON.parse(clip); } catch { /* 文字列 */ }
    const before = await editText();
    await key('v', 'KeyV', 86, ['meta']);
    await waitEditChange(before, 8000);
    await sleep(1500);
    const edit = await readEdit();
    const original = findItem(edit, 'shape-b');
    const pasted = allItems(edit).find(entry => entry.id.startsWith('shape-b-copy'));
    const item = pasted ? findItem(edit, pasted.id) : null;
    const shot = await previewShot('12-pasted');
    return { clipboardKind: parsed?.kind ?? null, clipboardItem: parsed?.item ?? null, clipboardSources: parsed?.sources ?? null,
      pastedId: pasted?.id ?? null, offset: item ? { dx: item.transform.x - original.transform.x, dy: item.transform.y - original.transform.y } : null,
      sameLook: item ? JSON.stringify(item.source) === JSON.stringify(original.source) : null, shot };
  });

  // 8. スタイルをコピー → 別の図形を押すと塗り・枠が写る / Esc でやめる
  await scenario('styleCopy', async () => {
    await key('Escape', 'Escape', 27);
    // 元の図形に枠を付けておく（枠の太さの窓から）
    await pick('shape-a');
    await pressHost('[data-akari-bar-item="weight"]');
    await sleep(700);
    await setField('[data-akari-ui="preview-context-window"] input[type="number"][data-field="weight"]', 12);
    await key('Escape', 'Escape', 27);
    await pick('shape-a');
    await pressHost('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="more"]');
    await sleep(900);
    await pressHost('[data-akari-ui="preview-element-more"] [data-akari-menu-item="copyStyle"]');
    await sleep(900);
    const hint = await evaluate(main, `(() => { const h = document.querySelector('[data-akari-ui="preview-style-copy-hint"]'); return h && !h.hidden ? h.textContent.trim() : null; })()`);
    const shotHint = await previewShot('13-style-copy-hint');
    const before = await editText();
    // 次に押したもの（プレビューで押す）へ写る。押して選ばれたものを相手として確かめる
    await selectItem('shape-b');
    await waitEditChange(before, 8000);
    await sleep(2000);
    const target = (await state())?.selectedId ?? null;
    const edit = await readEdit();
    const from = findItem(edit, 'shape-a')?.source?.params;
    const to = target ? findItem(edit, target)?.source?.params : null;
    const shot = await previewShot('14-style-applied');
    // Esc でやめる
    await pick('line');
    await key('c', 'KeyC', 67, ['meta', 'alt']);
    await sleep(800);
    const armed = (await chrome()).styleCopy;
    await key('Escape', 'Escape', 27);
    await sleep(800);
    const cancelled = (await chrome()).styleCopy;
    return { hint, target, from: { fill: from?.fill, stroke: from?.stroke, strokeWidth: from?.strokeWidth },
      to: { fill: to?.fill, stroke: to?.stroke, strokeWidth: to?.strokeWidth, preset: to?.preset }, armedByShortcut: armed, afterEsc: cancelled,
      shotHint, shot };
  });

  // 9. 動かしている間はバー・小さなメニューを隠す
  await scenario('busy', async () => {
    await key('Escape', 'Escape', 27);
    await pick('shape-b');
    await sleep(800);
    const box = await itemBox('shape-b');
    const ox = api.outer.x, oy = api.outer.y;
    await mouse('mousePressed', ox + box.cx, oy + box.cy);
    await mouse('mouseMoved', ox + box.cx + 20, oy + box.cy + 10, [], 1);
    await mouse('mouseMoved', ox + box.cx + 40, oy + box.cy + 20, [], 1);
    await sleep(500);
    const during = await evaluate(main, `(() => { const layer = document.querySelector('[data-akari-ui="preview-context-layer"]');
      const bar = document.querySelector('[data-akari-ui="preview-context-bar"]');
      return { busy: layer?.hasAttribute('data-busy') ?? null, barVisibility: bar ? getComputedStyle(bar).visibility : null }; })()`);
    const shot = await previewShot('15-busy');
    await mouse('mouseReleased', ox + box.cx + 40, oy + box.cy + 20);
    await sleep(1500);
    const after = await evaluate(main, `(() => { const bar = document.querySelector('[data-akari-ui="preview-context-bar"]'); return bar ? getComputedStyle(bar).visibility : null; })()`);
    return { during, barVisibilityAfter: after, shot };
  });

  // 選べたかの記録
  await scenario('picks', async () => picks);

  // 10. 最後に ⌘C（別のプロジェクトへ貼る用）
  await scenario('copyForOther', async () => {
    await key('Escape', 'Escape', 27);
    await pick('photo-1');
    await sleep(600);
    // タイムラインから選んだときは焦点がプレビューに無いので、⋯ のメニューの「コピー」で（小さなメニューが置かれるまで待つ）
    for (let i = 0; i < 20; i++) {
      if (await evaluate(main, `Boolean(document.querySelector('[data-akari-ui="preview-element-menu"].is-placed:not([hidden])'))`)) break;
      await sleep(500);
    }
    await pressHost('[data-akari-ui="preview-element-menu"] [data-akari-menu-item="more"]');
    await sleep(900);
    await pressHost('[data-akari-ui="preview-element-more"] [data-akari-menu-item="copy"]');
    await sleep(1200);
    const clip = pb(['pbpaste']).stdout ?? '';
    let parsed = null;
    try { parsed = JSON.parse(clip); } catch { /* 文字列 */ }
    if (parsed?.kind === 'akari-video/edit-item') (await import('node:fs')).writeFileSync(CLIP_FILE, clip);
    return { kind: parsed?.kind ?? null, itemId: parsed?.item?.id ?? null, sources: parsed?.sources ?? null };
  });
}
