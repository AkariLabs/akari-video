// 手順 0 / 4 の筋書き（検証専用・ラッパー作成）。v0.1.87 相当・最新・修正後の共通の観測。
// 字幕（話した言葉）/ 置いた文字 × 低い / 高い の 4 件それぞれで:
//   (1) 選んだときの横幅（折り返し幅）のつまみ e / w の有無・矩形・見える割合・押せるか（elementFromPoint）・四隅との重なり、
//       e を左へドラッグ → captions.json の wrap_width_pct・プレートの幅・行数、⌘Z 1 回で元へ戻るか
//   (2) 編集パネルの「折り返し幅」の欄に WRAP（環境変数 CWWC_WRAP・既定 25。BEFORE の記録は 40）を入れる → wrap_width_pct・プレートの幅・行数
//   (3) 編集パネルの「字間」の数字に 0.3 を入れる / スライダーを → キーで動かす / 上のメニューの「間隔」の
//       ミニポップアップの文字間隔を変える → letter_spacing_em・字の computed letter-spacing・行の幅
import { readFile, writeFile } from 'node:fs/promises';
import { CASES } from './fixture.mjs';

const WRAP = Number(process.env.CWWC_WRAP ?? 25);

export const MEASURE = id => `(() => {
  const vis = n => !!n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
  const R = b => ({ l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
  const host = [...document.querySelectorAll('.caption-row-plate')].find(n => (n.getAttribute('data-caption-key') || n.id || '').includes(${JSON.stringify(id)}) && n.getBoundingClientRect().width > 0);
  const plate = host?.querySelector('.akari-caption__plate');
  const lines = host ? [...host.querySelectorAll('.akari-caption__line')].filter(vis) : [];
  const tops = new Set();
  for (const line of lines) {
    const range = document.createRange(); range.selectNodeContents(line);
    for (const r of range.getClientRects()) if (r.width > 0.5) tops.add(Math.round(r.top));
  }
  const cs = plate ? getComputedStyle(plate) : null;
  const lcs = lines[0] ? getComputedStyle(lines[0]) : null;
  const inkRects = lines.flatMap(line => { const range = document.createRange(); range.selectNodeContents(line); return [...range.getClientRects()].filter(r => r.width > 0.5); });
  const ink = inkRects.length ? { l: Math.min(...inkRects.map(r => r.left)), r: Math.max(...inkRects.map(r => r.right)) } : null;
  const stage = document.getElementById('preview-layers').getBoundingClientRect();
  const box = document.getElementById('caption-select-box');
  const boxRect = box && box.classList.contains('is-active') ? box.getBoundingClientRect() : null;
  // v0.1.88 より前はつまみが字幕プレートの中（#caption-plate）にある。場所を問わず見える字幕のつまみを集める
  const handles = [...document.querySelectorAll('.akari-caption-handle')].filter(h => h.getClientRects().length > 0).map(h => {
    const b = h.getBoundingClientRect(); const s = getComputedStyle(h);
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const after = getComputedStyle(h, '::after');
    return { h: h.getAttribute('data-h'), rect: R(b), visible: vis(h), pe: s.pointerEvents, z: s.zIndex,
      inViewport: cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight,
      hit: !top ? null : (top === h || h.contains(top)) ? 'self' : (top.getAttribute?.('data-h') ? 'handle:' + top.getAttribute('data-h') : (top.id || String(top.className) || top.tagName).slice(0, 50)),
      afterSize: after.content && after.content !== 'none' ? [after.width, after.height] : null,
      container: h.closest('#caption-select-box') ? 'caption-select-box' : h.closest('.caption-row-plate') ? 'caption-plate' : 'other' };
  });
  return { found: !!host, hostStyle: host?.getAttribute('style')?.slice(0, 600) ?? null,
    plate: plate ? { rect: R(plate.getBoundingClientRect()), width: cs.width, maxWidth: cs.maxWidth, letterSpacing: cs.letterSpacing,
      wrapVar: cs.getPropertyValue('--caption-wrap-width').trim(), widthVar: cs.getPropertyValue('--caption-width').trim(),
      lsVar: cs.getPropertyValue('--caption-letter-spacing').trim() } : null,
    line: lcs ? { width: lcs.width, whiteSpace: lcs.whiteSpace, letterSpacing: lcs.letterSpacing, rect: R(lines[0].getBoundingClientRect()) } : null,
    lineCount: tops.size, inkWidth: ink ? +(ink.r - ink.l).toFixed(1) : null,
    stage: R(stage), selectBox: boxRect ? R(boxRect) : null, handles };
})()`;

export default async function scenarios(api) {
  const { scenario, evaluate, browser, main, sleep, S } = api;
  const V = expr => evaluate(browser, expr, api.view.contextId, api.view.sessionId);
  const H = expr => evaluate(main, expr);
  const shots = {};
  const shot = async name => { shots[name] = await api.previewShot(name); return shots[name]; };
  const readCaptions = async () => readFile(api.captionsPath, 'utf8');
  const cue = (text, id) => (JSON.parse(text).captions ?? []).find(c => c.id === id);
  const seek = async t => { await V(`(() => { window.postMessage({type:'akari-preview-seek',time:${t}}, '*'); return true; })()`); await sleep(1400); };
  const vmouse = (type, x, y, buttons) => api.mouse(type, api.outer.x + x, api.outer.y + y, [], buttons);
  const waitCaptions = async (previous, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const t = await readCaptions(); if (t !== previous) { await sleep(900); return await readCaptions(); } await sleep(150); }
    return previous;
  };
  const styleOf = (text, id) => cue(text, id)?.text_style ?? null;
  /** captions.json の書き込みがプレビューの DOM（ホストの style の変数）に反映されるまで待つ（最大 6 秒） */
  const settled = async (id, predicate) => {
    const deadline = Date.now() + 6000;
    let m = await V(MEASURE(id));
    while (Date.now() < deadline && !predicate(m)) { await sleep(250); m = await V(MEASURE(id)); }
    return m;
  };
  const pick = s => s ? { wrap_width_pct: s.wrap_width_pct, letter_spacing_em: s.letter_spacing_em, position: s.position, text_anchor: s.text_anchor, zone: s.zone } : null;
  const select = async c => {
    await api.key('Escape', 'Escape', 27);
    await seek(c.at);
    const p = await V(`(() => { const host = [...document.querySelectorAll('.caption-row-plate')].find(n => (n.getAttribute('data-caption-key') || n.id || '').includes(${S(c.id)}) && n.getBoundingClientRect().width > 0);
      const line = host?.querySelector('.akari-caption__line'); if (!line) return null; const r = document.createRange(); r.selectNodeContents(line); const b = r.getClientRects()[0] ?? line.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 20), y: b.top + b.height / 2 }; })()`);
    if (!p) throw new Error(`caption ${c.id} not rendered`);
    await api.viewClick(p.x, p.y);
    await sleep(1200);
  };
  /** host の input に値を入れて Enter（数字欄・スクラブ欄） */
  const typeInto = async (selector, value) => {
    const target = await H(`(() => { const n = document.querySelector(${S(selector)}); if (!n) return null; n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!target) return { error: `not found ${selector}` };
    await sleep(300);
    const again = await H(`(() => { const b = document.querySelector(${S(selector)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await api.hostClick(again.x, again.y);
    await H(`(() => { const n = document.querySelector(${S(selector)}); n.focus(); n.select?.(); return document.activeElement === n; })()`);
    await api.key('a', 'KeyA', 65, ['meta']);
    await main.send('Input.insertText', { text: String(value) });
    await sleep(200);
    await api.key('Enter', 'Enter', 13, [], '\r');
    return { ok: true, activeAfter: await H(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName`) };
  };

  // 画面を広げる（ウィンドウの大きさを CDP で変えられないので、レイアウトの大きさを上書き）
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1640, height: 940, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);
  await api.refreshView();
  const original = await readCaptions();
  // 全部の console（警告・エラー・akari のログ）を集める
  const logs = [];
  api.report.console = logs;
  for (const cdp of [browser, main]) {
    cdp.on('Runtime.consoleAPICalled', params => { if (['error', 'warning', 'warn', 'log', 'info'].includes(params.type)) {
      const text = params.args.map(a => a.value ?? a.description ?? a.type).join(' ');
      if (/akari|caption|字幕|文字|wrap|Error/i.test(text) && !/speech sidecar/.test(text)) logs.push(`${params.type}: ${text.slice(0, 400)}`); } });
    cdp.on('Runtime.exceptionThrown', params => logs.push(`exception: ${String(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text).slice(0, 400)}`));
  }
  const pointerLog = () => V(`(() => { if (!window.__cwwcPointer) { window.__cwwcPointer = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(t, e => window.__cwwcPointer.push(t + ':' + e.pointerId + ':' + (e.target?.getAttribute?.('data-h') ?? e.target?.className ?? e.target?.tagName)), true); }
    const out = window.__cwwcPointer.slice(); window.__cwwcPointer.length = 0; return out; })()`);
  await pointerLog();
  const hostPointerLog = () => H(`(() => { if (!window.__cwwcHost) { window.__cwwcHost = []; for (const t of ['pointerdown', 'pointerup', 'mouseup', 'pointercancel']) window.addEventListener(t, e => window.__cwwcHost.push(t + ':' + (e.target?.tagName ?? '') + '.' + String(e.target?.className ?? '').slice(0, 40) + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true); }
    const out = window.__cwwcHost.slice(); window.__cwwcHost.length = 0; return out; })()`);
  await hostPointerLog();

  for (const c of CASES) {
    await scenario(c.key, async () => {
      const out = { id: c.id, kind: c.kind, height: c.height };
      // (1) つまみ
      await select(c);
      out.selected = await V(MEASURE(c.id));
      out.selectedShot = await shot(`${c.key}-1-selected`);
      const e = out.selected.handles.find(h => h.h === 'e' && h.visible);
      out.edgeHandles = out.selected.handles.filter(h => h.h === 'e' || h.h === 'w').map(h => h.h);
      if (e) {
        await pointerLog(); await hostPointerLog();
        const before = await readCaptions();
        const from = { x: e.rect.l + e.rect.w / 2, y: e.rect.t + e.rect.h / 2 };
        const dx = -Math.max(30, out.selected.selectBox.w * 0.35);
        await vmouse('mouseMoved', from.x, from.y); await sleep(80);
        await vmouse('mousePressed', from.x, from.y); await sleep(120);
        for (let i = 1; i <= 12; i++) { await vmouse('mouseMoved', from.x + dx * i / 12, from.y, 1); await sleep(35); }
        out.dragMid = await V(MEASURE(c.id));
        out.dragMidShot = await shot(`${c.key}-1-drag-mid`);
        await vmouse('mouseReleased', from.x + dx, from.y); await sleep(300);
        let after = await waitCaptions(before);
        out.dragPointer = await pointerLog();
        // CDP の離す操作が webview に届かず（ホストの iframe 要素に落ちる）ジェスチャが残ることがある（手順 0 で観測・アプリ起因と特定できず）。
        // その場合は同じ点でもう一度離して、その事実を記録する
        if (after === before && (await V(`document.body.classList.contains('akari-caption-transforming')`))) {
          out.dragReleaseLost = { hostPointer: await hostPointerLog() };
          await vmouse('mouseMoved', from.x + dx, from.y, 1); await sleep(100);
          await vmouse('mouseReleased', from.x + dx, from.y); await sleep(300);
          after = await waitCaptions(before);
          out.dragReleaseLost.retryWritten = after !== before;
          out.dragReleaseLost.retryPointer = await pointerLog();
        }
        out.dragHostPointer = await hostPointerLog();
        out.dragBodyClasses = await V(`[...document.body.classList].filter(c => /akari-caption/.test(c))`);
        out.drag = { dx, written: after !== before, before: pick(styleOf(before, c.id)), after: pick(styleOf(after, c.id)), measure: await V(MEASURE(c.id)) };
        out.dragShot = await shot(`${c.key}-1-drag-after`);
        await api.key('z', 'KeyZ', 90, ['meta']);
        const undone = await waitCaptions(after);
        out.undo = { changed: undone !== after, restored: JSON.stringify(styleOf(undone, c.id)) === JSON.stringify(styleOf(before, c.id)), style: pick(styleOf(undone, c.id)), measure: await V(MEASURE(c.id)) };
      }
      // (2) 折り返し幅の欄
      await select(c);
      {
        const before = await readCaptions();
        const pre = await V(MEASURE(c.id));
        out.wrapField = await typeInto('[data-akari-ui="field:inspector-caption-wrap-width"] input.akari-inspector-number-input, [data-akari-field="caption-wrap-width"] input', WRAP);
        const after = await waitCaptions(before);
        out.wrapField = { ...out.wrapField, written: after !== before, before: pick(styleOf(before, c.id)), after: pick(styleOf(after, c.id)), pre,
          post: await settled(c.id, m => (m.hostStyle ?? '').includes(`--caption-wrap-width: ${WRAP}%`)) };
        out.wrapFieldShot = await shot(`${c.key}-2-wrap-field-${WRAP}`);
      }
      // (3a) 字間の数字
      await select(c);
      {
        const before = await readCaptions();
        const pre = await V(MEASURE(c.id));
        out.lsNumber = await typeInto('[data-akari-field="caption-letter-spacing"] input[type="number"]', 0.3);
        const after = await waitCaptions(before);
        out.lsNumber = { ...out.lsNumber, written: after !== before, before: pick(styleOf(before, c.id)), after: pick(styleOf(after, c.id)), pre, post: await V(MEASURE(c.id)) };
        out.lsNumberShot = await shot(`${c.key}-3-letter-spacing-number`);
      }
      // (3b) 字間のスライダー（← を 10 回 = −0.1em）
      await select(c);
      {
        const before = await readCaptions();
        const pre = await V(MEASURE(c.id));
        const r = await H(`(() => { const n = document.querySelector('[data-akari-field="caption-letter-spacing"] input[type="range"]'); if (!n) return null; n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, value: n.value }; })()`);
        if (r) {
          await H(`(() => { document.querySelector('[data-akari-field="caption-letter-spacing"] input[type="range"]').focus(); return true; })()`);
          for (let i = 0; i < 10; i++) await api.key('ArrowLeft', 'ArrowLeft', 37);
          const after = await waitCaptions(before);
          out.lsSlider = { startValue: r.value, endValue: await H(`document.querySelector('[data-akari-field="caption-letter-spacing"] input[type="range"]').value`), written: after !== before,
            before: pick(styleOf(before, c.id)), after: pick(styleOf(after, c.id)), pre, post: await V(MEASURE(c.id)) };
        } else out.lsSlider = { error: 'no slider' };
      }
      // (3c) 上のメニューの「間隔」のミニポップアップ（数字に 0.05。直前のスライダーで 0.2 になっている）
      await select(c);
      {
        const before = await readCaptions();
        const pre = await V(MEASURE(c.id));
        const item = await api.hostButton('[data-akari-ui="preview-context-bar"] [data-akari-bar-item="captionSpacing"]');
        if (item) {
          await api.hostClick(item.x, item.y);
          await sleep(800);
          out.spacingPopup = await H(`(() => { const w = document.querySelector('[data-akari-ui="preview-context-window"]'); if (!w) return null;
            return { kind: w.getAttribute('data-akari-window'), text: w.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200),
              inputs: [...w.querySelectorAll('input')].map(i => ({ type: i.type, label: i.getAttribute('aria-label'), value: i.value, name: i.name })) }; })()`);
          const label = out.spacingPopup?.inputs.find(i => /文字|字間|letter/i.test(i.label ?? '') && i.type === 'number')?.label
            ?? out.spacingPopup?.inputs.find(i => /文字|字間|letter/i.test(i.label ?? ''))?.label;
          if (label) {
            const sel = `[data-akari-ui="preview-context-window"] input[aria-label=${S(label)}]${out.spacingPopup.inputs.some(i => i.label === label && i.type === 'number') ? '[type="number"]' : ''}`;
            const type = await H(`document.querySelector(${S(sel)}).type`);
            if (type === 'range') {
              await H(`(() => { document.querySelector(${S(sel)}).focus(); return true; })()`);
              for (let i = 0; i < 20; i++) await api.key('ArrowRight', 'ArrowRight', 39);
              out.spacingInput = { label, type };
            } else out.spacingInput = { label, type, ...(await typeInto(sel, 0.05)) };
            const after = await waitCaptions(before);
            out.spacing = { written: after !== before, before: pick(styleOf(before, c.id)), after: pick(styleOf(after, c.id)), pre, post: await V(MEASURE(c.id)) };
            out.spacingShot = await shot(`${c.key}-3-spacing-popup`);
          }
          await api.key('Escape', 'Escape', 27);
        } else out.spacingPopup = 'no captionSpacing item in the context bar';
      }
      return out;
    });
  }
  api.report.shots = shots;
  api.report.captionsFinal = JSON.parse(await readCaptions());
  api.report.captionsOriginal = JSON.parse(original);
}
