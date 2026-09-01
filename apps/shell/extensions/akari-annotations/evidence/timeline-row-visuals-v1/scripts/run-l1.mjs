#!/usr/bin/env node

// UI-b（timeline-row-visuals）L1。実機 Electron（tier 2）+ CDP。
//   (a) 同一段で隣接する cut-a / cut-b の境界が画素で判別できる（BEFORE = 旧 CSS を !important で
//       復元して撮る / AFTER = 現行ビルド。境界近傍の列平均輝度の隣接差で機械判定）
//   (b) 字幕袋の刻みと HTML 袋の刻みが同一クラス = 同一の高さ・色調・角丸
//   (c) 純グループ持ちトラックのヘッダ最上段にトラック行（アイコン・名前・目・スピーカー）が残り、
//       その下に木の行が積まれ、ヘッダの行とストリップのチップが行単位で揃う

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const execFileAsync = promisify(execFile);
const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9783);
if (!workspaceDir || !evidenceDir) throw new Error('usage: run-l1.mjs <port> <workspaceDir> <evidenceDir>');

const SUBROW_STRIDE = 24;
const records = [];
let main;

const record = (step, data = {}) => {
  records.push({ t: new Date().toISOString(), step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
};
const assert = (condition, message, data = {}) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`);
  record('assertion-ok', { message, ...data });
};
const waitFor = async (description, predicate, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};
const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
// run-log は公開リポにコミットされるので実行機のパスを落とす（Governance の tracked-file leak scan）。
const redact = value => JSON.parse(JSON.stringify(value)
  .replaceAll(JSON.stringify(workspaceDir).slice(1, -1), '<workspace>')
  .replace(/\\?\/private\\?\/tmp\\?\/[A-Za-z0-9_.-]+/gu, '<scratch>')
  .replace(/\\?\/Users\\?\/[A-Za-z0-9_.-]+/gu, '<home>'));
const rect = selector => evalOn(main, `(() => {
  const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return null;
  const r=element.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height,
    right:r.right,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2};
})()`);
const click = async (selector, options = {}) => {
  await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  let target;
  let hit;
  for (let attempt = 0; attempt < 3; attempt++) {
    await evalOn(main, `document.querySelector(${JSON.stringify(selector)})
      ?.scrollIntoView({block:'center',inline:'nearest'})`);
    await sleep(120);
    target = await rect(selector);
    assert(target?.width > 0 && target?.height > 0, 'click target is visible', { selector, target, attempt });
    hit = await evalOn(main, `(() => {
      const wanted=document.querySelector(${JSON.stringify(selector)});
      const r=wanted?.getBoundingClientRect();
      const actual=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
      return {matches:actual===wanted||wanted?.contains(actual),tag:actual?.tagName,
        html:actual?.outerHTML?.slice(0,240)};
    })()`);
    if (hit.matches) {
      await realClick(main, target.x, target.y, options);
      await sleep(250);
      return;
    }
  }
  assert(false, 'click target is topmost at its center', { selector, target, hit });
};
const shot = async name => {
  await screenshot(main, path.join(evidenceDir, name));
  record('screenshot', { name });
};
const shotClip = async (name, clip) => {
  const { data } = await main.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  });
  const file = path.join(evidenceDir, name);
  await writeFile(file, Buffer.from(data, 'base64'));
  record('screenshot-clip', { name, clip });
  return file;
};
// PNG は ffmpeg で rgb24 の生バイトへ落として読む（Node に PNG デコーダが無いため）。
const columnProfile = async pngPath => {
  const rawPath = `${pngPath}.rgb`;
  await rm(rawPath, { force: true });
  await execFileAsync('ffmpeg', ['-y', '-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath]);
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pngPath]);
  const [width, height] = stdout.trim().split(',').map(Number);
  const buffer = await readFile(rawPath);
  await rm(rawPath, { force: true });
  const columns = [];
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 1; y < height - 1; y++) {
      const offset = (y * width + x) * 3;
      sum += 0.299 * buffer[offset] + 0.587 * buffer[offset + 1] + 0.114 * buffer[offset + 2];
    }
    columns.push(Number((sum / Math.max(1, height - 2)).toFixed(2)));
  }
  let maxDelta = 0;
  let at = -1;
  for (let x = 1; x < columns.length; x++) {
    const delta = Math.abs(columns[x] - columns[x - 1]);
    if (delta > maxDelta) { maxDelta = delta; at = x; }
  }
  return {
    width, height, columns,
    min: Math.min(...columns), max: Math.max(...columns),
    maxAdjacentDelta: Number(maxDelta.toFixed(2)), maxAt: at
  };
};
// 旧意匠（main c8526483 の `.akari-annotations-strip-clip`）を !important で復元して BEFORE を撮る。
const LEGACY_CLIP_CSS = `.akari-annotations-widget .akari-annotations-strip-clip{
  border:1px solid #3f3f46 !important;border-right-width:2px !important;}`;
const setLegacyClipCss = enabled => evalOn(main, `(() => {
  const id='akari-l1-legacy-clip-css';
  const existing=document.getElementById(id);
  if(!${enabled}){existing?.remove();return false}
  if(existing)return true;
  const style=document.createElement('style');
  style.id=id;style.textContent=${JSON.stringify(LEGACY_CLIP_CSS)};
  document.head.appendChild(style);return true;
})()`);
async function openTimeline() {
  let opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(250);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1200);
    opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  }
  assert(opened, 'timeline opened');
  await domWait('timeline tracks rendered', `document.querySelectorAll('.akari-track-header-row').length > 0`);
}

try {
  await mkdir(evidenceDir, { recursive: true });
  const targets = await listTargets(port);
  const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
    ?? targets.find(entry => entry.type === 'page');
  if (!target) throw new Error('Theia page target not found');
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 1800, height: 1200, deviceScaleFactor: 1, mobile: false
  });
  await domWait('frontend ready', `document.readyState === 'complete'`);
  const onboarding = await evalOn(main, `(() => {
    const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');
    if(button){button.click();return true}return false
  })()`);
  if (onboarding) await sleep(500);
  await openTimeline();
  await domWait('cut chips rendered', `document.querySelectorAll('[data-akari-item-kind="cut"]').length >= 2`);

  // ---------------------------------------------------------------- (a) カット境界
  const cutA = await rect('[data-akari-item-kind="cut"][data-akari-item-id="0"]');
  const cutB = await rect('[data-akari-item-kind="cut"][data-akari-item-id="1"]');
  assert(cutA && cutB && Math.abs(cutA.right - cutB.left) <= 1.5 && cutA.top === cutB.top,
    'cut-a and cut-b are time-adjacent on the same lane', { cutA, cutB });
  const seamX = Math.round(cutA.right);
  const seamClip = {
    x: seamX - 8, y: Math.round(cutA.top) + 1,
    width: 16, height: Math.max(8, Math.round(cutA.height) - 2)
  };
  const clipStyles = await evalOn(main, `(() => {
    const element=document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="0"]');
    const style=getComputedStyle(element);
    return {borderLeft:style.borderLeftWidth+' '+style.borderLeftColor,
      borderRight:style.borderRightWidth+' '+style.borderRightColor,
      borderTop:style.borderTopWidth+' '+style.borderTopColor,
      hasFilmstrip:Boolean(element.querySelector('.akari-annotations-strip-clip-filmstrip'))};
  })()`);
  record('clip-style-after', clipStyles);

  await setLegacyClipCss(true);
  await sleep(400);
  const legacyStyles = await evalOn(main, `(() => {
    const style=getComputedStyle(document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="0"]'));
    return {borderLeft:style.borderLeftWidth+' '+style.borderLeftColor,
      borderRight:style.borderRightWidth+' '+style.borderRightColor};
  })()`);
  record('clip-style-before', legacyStyles);
  await shot('01-before.png');
  const beforeSeam = await columnProfile(await shotClip('03-seam-before.png', seamClip));

  await setLegacyClipCss(false);
  await sleep(400);
  await shot('02-after.png');
  const afterSeam = await columnProfile(await shotClip('04-seam-after.png', seamClip));

  // 対照窓: cut-a の内側（境界でない場所）。フィルムストリップの絵柄そのものが持つ
  // 列間の揺れを測り、「境界の画素差が意匠由来であって絵柄由来ではない」ことを示す。
  const controlClip = {
    x: Math.round(cutA.left + cutA.width * 0.45), y: seamClip.y,
    width: seamClip.width, height: seamClip.height
  };
  const controlSeam = await columnProfile(await shotClip('05-control-inside-cut-a.png', controlClip));

  const summarize = profile => ({
    min: Number(profile.min.toFixed(2)), max: Number(profile.max.toFixed(2)),
    maxAdjacentDelta: profile.maxAdjacentDelta, maxAt: profile.maxAt, columns: profile.columns
  });
  record('seam-metric', {
    seamClip, controlClip,
    before: summarize(beforeSeam), after: summarize(afterSeam), controlAfter: summarize(controlSeam)
  });
  // AFTER は 2px の暗い谷（#09090b）+ 1px の明るいハイライト（rgba(250,250,250,.55)）を必ず作るので、
  // 絵柄によらず「近黒の列」と「その隣の明るい列」が並ぶ。BEFORE にはその谷が無く、
  // 境界の画素差はフィルムストリップの絵柄任せ（= 実機指摘「1 本の帯に見える」）。
  assert(afterSeam.min <= 25, 'AFTER seam contains a near-black designed valley', {
    afterMin: afterSeam.min, beforeMin: beforeSeam.min
  });
  assert(beforeSeam.min - afterSeam.min >= 30,
    'the designed valley is new: the BEFORE seam never gets that dark',
    { beforeMin: beforeSeam.min, afterMin: afterSeam.min });
  assert(afterSeam.maxAdjacentDelta >= 60,
    'AFTER seam shows at least 60/255 of luminance step between neighbouring columns',
    { after: afterSeam.maxAdjacentDelta, before: beforeSeam.maxAdjacentDelta });
  assert(afterSeam.maxAdjacentDelta >= controlSeam.maxAdjacentDelta * 2,
    'the AFTER seam step is at least double the ordinary column-to-column variation inside one clip',
    { seam: afterSeam.maxAdjacentDelta, controlInsideClip: controlSeam.maxAdjacentDelta });

  // ---------------------------------------------------------------- (b) 刻みの意匠統一
  const ticks = await evalOn(main, `(() => {
    const read=selector=>{
      const nodes=[...document.querySelectorAll(selector)];
      if(nodes.length===0)return {count:0};
      const style=getComputedStyle(nodes[0]);
      return {count:nodes.length,className:nodes[0].className,
        width:style.width,height:style.height,borderRadius:style.borderTopLeftRadius,
        background:style.backgroundColor,position:style.position,
        allSameClass:nodes.every(node=>node.className===nodes[0].className)};
    };
    return {caption:read('[data-akari-tree-bag-tick="caps"]'),html:read('[data-akari-tree-bag-tick="intro"]')};
  })()`);
  record('tick-vocabulary', ticks);
  assert(ticks.caption.count > 0 && ticks.html.count > 0,
    'both the captions bag and the HTML bag render tick bands', ticks);
  assert(ticks.caption.className === 'akari-annotations-tree-tick'
    && ticks.html.className === 'akari-annotations-tree-tick'
    && ticks.caption.allSameClass && ticks.html.allSameClass,
  'captions and HTML bag ticks share one design class', ticks);
  assert(ticks.caption.width === ticks.html.width && ticks.caption.height === ticks.html.height
    && ticks.caption.borderRadius === ticks.html.borderRadius
    && ticks.caption.background === ticks.html.background,
  'captions and HTML bag ticks share height / tone / corner radius', ticks);

  // ---------------------------------------------------------------- (c) トラック行の復活
  const headerSelector = '.akari-track-header-row[data-akari-timeline-track-id="v-deco"]';
  const trackLine = await evalOn(main, `(() => {
    const header=document.querySelector(${JSON.stringify(headerSelector)});
    if(!header)return null;
    const line=header.querySelector(':scope > .akari-track-header-trackline');
    const headerRect=header.getBoundingClientRect();
    const lineRect=line?.getBoundingClientRect();
    const groupRow=header.querySelector('[data-akari-tree-row-id="g-deco"]');
    const groupRect=groupRow?.getBoundingClientRect();
    return {
      kind:header.dataset.akariKind,
      hasTrackLine:Boolean(line),
      icon:Boolean(line?.querySelector('.akari-track-header-icon svg')),
      name:line?.querySelector('.akari-track-header-name')?.textContent,
      eye:Boolean(line?.querySelector('button[data-akari-toggle="visibility"] svg')),
      speaker:Boolean(line?.querySelector('button[data-akari-toggle="mute"] svg')),
      resizeHandleStaysOnHeader:header.querySelector(':scope > .akari-track-header-resize-handle')!==null
        || header.querySelector('.akari-track-header-resize-handle')===null,
      trackLineTopOffset:lineRect&&headerRect?Math.round(lineRect.top-headerRect.top):null,
      groupRowTopOffset:groupRect&&headerRect?Math.round(groupRect.top-headerRect.top):null,
      headerHeight:headerRect?.height
    };
  })()`);
  record('track-line', trackLine);
  assert(trackLine?.hasTrackLine && trackLine.icon && trackLine.eye && trackLine.speaker
    && typeof trackLine.name === 'string' && trackLine.name.length > 0,
  'pure-group track header keeps icon / name / eye / speaker on its top line', trackLine);
  // `.akari-track-header-row` は border-top 1px を持つので、絶対配置の子の top は
  // border-box 上端から 1px 下がる。行の「積み方」は トラック行 → 木の行 の差で見る。
  assert(trackLine.trackLineTopOffset <= 1
    && trackLine.groupRowTopOffset - trackLine.trackLineTopOffset === SUBROW_STRIDE,
  'the track line is the top row and the tree rows start one stride below', trackLine);
  assert(trackLine.resizeHandleStaysOnHeader,
    'the resize handle is not swallowed by the track line', trackLine);

  const alignedCollapsed = await evalOn(main, `(() => {
    const headerRow=document.querySelector('[data-akari-tree-row-id="g-deco"]')?.getBoundingClientRect();
    const chip=document.querySelector('.akari-annotations-strip [data-akari-item-id="g-deco"]')
      ?.getBoundingClientRect();
    return headerRow&&chip?{headerTop:headerRow.top,chipTop:chip.top,diff:Math.round(headerRow.top-chip.top)}:null;
  })()`);
  record('row-alignment-collapsed', alignedCollapsed);
  assert(alignedCollapsed && Math.abs(alignedCollapsed.diff) <= 2,
    'header tree row and strip chip stay on the same row after the track line is inserted', alignedCollapsed);

  const beforeToggle = await evalOn(main, `(() => {
    const band=document.querySelector('.akari-track-band[data-akari-lane="v-deco"]');
    return {pressed:document.querySelector(${JSON.stringify(headerSelector)})
      ?.querySelector('button[data-akari-toggle="visibility"]')?.getAttribute('aria-pressed'),
      bandHidden:band?.classList.contains('akari-track-band-hidden')??null,
      bandOpacity:band?getComputedStyle(band).opacity:null};
  })()`);
  await click(`${headerSelector} button[data-akari-toggle="visibility"]`);
  await sleep(400);
  const afterToggle = await evalOn(main, `(() => {
    const band=document.querySelector('.akari-track-band[data-akari-lane="v-deco"]');
    return {pressed:document.querySelector(${JSON.stringify(headerSelector)})
      ?.querySelector('button[data-akari-toggle="visibility"]')?.getAttribute('aria-pressed'),
      bandHidden:band?.classList.contains('akari-track-band-hidden')??null,
      bandOpacity:band?getComputedStyle(band).opacity:null};
  })()`);
  await click(`${headerSelector} button[data-akari-toggle="visibility"]`);
  await sleep(400);
  const restoredToggle = await evalOn(main, `document.querySelector(${JSON.stringify(headerSelector)})
    ?.querySelector('button[data-akari-toggle="visibility"]')?.getAttribute('aria-pressed')`);
  record('eye-toggle', { beforeToggle, afterToggle, restoredToggle });
  assert(beforeToggle.pressed === 'true' && afterToggle.pressed === 'false' && restoredToggle === 'true',
    'the eye on a pure-group track toggles and restores', { beforeToggle, afterToggle, restoredToggle });

  const mutePressed = await evalOn(main, `document.querySelector(${JSON.stringify(headerSelector)})
    ?.querySelector('button[data-akari-toggle="mute"]')?.getAttribute('aria-pressed')`);
  await click(`${headerSelector} button[data-akari-toggle="mute"]`);
  await sleep(400);
  const muteAfter = await evalOn(main, `document.querySelector(${JSON.stringify(headerSelector)})
    ?.querySelector('button[data-akari-toggle="mute"]')?.getAttribute('aria-pressed')`);
  await click(`${headerSelector} button[data-akari-toggle="mute"]`);
  await sleep(400);
  const muteRestored = await evalOn(main, `document.querySelector(${JSON.stringify(headerSelector)})
    ?.querySelector('button[data-akari-toggle="mute"]')?.getAttribute('aria-pressed')`);
  record('speaker-toggle', { mutePressed, muteAfter, muteRestored });
  assert(mutePressed === 'true' && muteAfter === 'false' && muteRestored === 'true',
    'the speaker on a pure-group track toggles and restores',
    { mutePressed, muteAfter, muteRestored });

  await click('[data-akari-tree-toggle="g-deco"]');
  await domWait('pure group expanded',
    `document.querySelectorAll('${headerSelector} [data-akari-tree-row-id]').length >= 3`);
  const expanded = await evalOn(main, `(() => {
    const header=document.querySelector(${JSON.stringify(headerSelector)});
    const headerRect=header.getBoundingClientRect();
    const line=header.querySelector(':scope > .akari-track-header-trackline');
    const lineTop=line.getBoundingClientRect().top;
    const rows=[...header.querySelectorAll('[data-akari-tree-row-id]')].map(row=>{
      const rowTop=row.getBoundingClientRect().top;
      const chip=document.querySelector(
        '.akari-annotations-strip [data-akari-item-id="'+CSS.escape(row.dataset.akariTreeRowId)+'"]');
      return {id:row.dataset.akariTreeRowId,
        topOffset:Math.round(rowTop-lineTop),
        rowChipDiff:chip?Math.round(rowTop-chip.getBoundingClientRect().top):null};
    });
    const lane=document.querySelector('.akari-track-band[data-akari-lane="v-deco"]')?.getBoundingClientRect();
    return {rows,headerHeight:headerRect.height,laneHeight:lane?.height,
      topDiff:lane?Math.round(headerRect.top-lane.top):null,
      trackLineVisible:Boolean(line.querySelector('.akari-track-header-name'))};
  })()`);
  record('expanded-rows', expanded);
  assert(expanded.rows.length >= 3 && expanded.trackLineVisible,
    'expanding the pure group stacks child rows under the surviving track line', expanded);
  assert(expanded.rows.every((row, index) => row.topOffset === SUBROW_STRIDE * (index + 1)),
    'tree rows are stacked one stride apart below the track line', expanded);
  const misaligned = expanded.rows.filter(row => row.rowChipDiff !== null && Math.abs(row.rowChipDiff) > 2);
  assert(misaligned.length === 0,
    'every rendered strip chip sits on the same row as its header row', { misaligned, rows: expanded.rows });
  assert(expanded.topDiff === 0 && Math.abs(expanded.headerHeight - (expanded.laneHeight ?? 0)) <= 1,
    'header column and strip lane keep the same top and height for the taller track', expanded);
  assert(expanded.headerHeight >= SUBROW_STRIDE * (expanded.rows.length + 1),
    'track height grew by the extra track line row', expanded);
  await shot('06-track-line-expanded.png');

  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'PASS', finishedAt: new Date().toISOString(), records: redact(records)
  }, null, 2)}\n`);
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'FAIL', finishedAt: new Date().toISOString(),
    error: redact(String(error?.stack ?? error)), records: redact(records)
  }, null, 2)}\n`);
  throw error;
} finally {
  main?.close();
}
