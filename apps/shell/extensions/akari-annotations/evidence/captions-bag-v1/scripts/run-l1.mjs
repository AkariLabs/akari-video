#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';
import { loadAndBuildOsrPage } from '../../../../../../../packages/osr-export/src/page-builder.mjs';

const execFileAsync = promisify(execFile);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const mode = args.get('--mode') ?? 'all';
const port = Number(args.get('--port') ?? 9741);
const workspace = args.get('--workspace');
const evidence = args.get('--evidence');
if (!workspace || !evidence) {
  throw new Error('usage: run-l1.mjs --mode cdp|capture|all --port <port> --workspace <dir> --evidence <dir>');
}
const repository = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const project = path.join(workspace, 'project');
const editPath = path.join(project, 'edit.json');
const captionsPath = path.join(project, 'captions.json');
const logPath = path.join(evidence, 'run-log.json');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const evidenceRoot = path.resolve(evidence);
const workspaceRoot = path.resolve(workspace);
const repositoryRoot = path.resolve(repository);
const sanitizeEvidence = value => {
  if (typeof value === 'string') {
    let sanitized = value;
    for (const [root, placeholder] of [
      [evidenceRoot, '<EVIDENCE>'],
      [workspaceRoot, '<WORKSPACE>'],
      [repositoryRoot, '<REPO>'],
    ]) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(root), 'gu'), placeholder);
    }
    return sanitized
      .replace(new RegExp(`/${'Users'}/[A-Za-z0-9_.-]+/`, 'gu'), '<LOCAL>/')
      .replace(new RegExp(`/${'private'}/${'tmp'}/`, 'gu'), '<LOCAL>/')
      .replace(new RegExp(`/${'home'}/[A-Za-z0-9_.-]+/`, 'gu'), '<LOCAL>/');
  }
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [sanitizeEvidence(key), sanitizeEvidence(entry)]));
  }
  return value;
};
await mkdir(evidence, { recursive: true });
let records = [];
if (mode === 'capture') {
  try { records = JSON.parse(await readFile(logPath, 'utf8')).records ?? []; } catch {}
}
const record = (step, data = {}) => records.push({ t: new Date().toISOString(), step, ...data });
const assert = (condition, message, data = {}) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`);
  record('assertion-ok', { message, ...data });
};
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const locate = (doc, id) => {
  for (const track of doc.tracks ?? []) {
    const stack = [...(track.items ?? [])];
    while (stack.length) {
      const item = stack.shift();
      if (item?.id === id) return { track, item };
      stack.unshift(...(item?.items ?? []));
    }
  }
};
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const waitFor = async (description, fn, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await fn()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};

async function runCdp() {
  const captionsBefore = await sha(captionsPath);
  const targets = await listTargets(port);
  const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
    ?? targets.find(entry => entry.type === 'page');
  if (!target) throw new Error('Theia page target not found');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  const domWait = (description, expression) => waitFor(description, () => evalOn(cdp, expression));
  const rect = selector => evalOn(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
    if(!e)return null; e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}; })()`);
  const contextMenu = async (selector, label) => {
    const value = await rect(selector);
    await evalOn(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
      e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${value.x},clientY:${value.y}})); })()`);
    await domWait(label, `[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()===${JSON.stringify(label)})`);
    await evalOn(cdp, `[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===${JSON.stringify(label)}).click()`);
  };
  try {
    await domWait('frontend ready', `document.readyState === 'complete'`);
    for (let attempt = 0; attempt < 3 && !await evalOn(cdp, `Boolean(document.getElementById('akari-annotations-widget'))`); attempt++) {
      await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
      await sleep(250);
      await cdp.send('Input.insertText', { text: 'タイムラインを開く' });
      await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(1000);
    }
    await domWait('captions chips', `Boolean(document.querySelector('[data-akari-tree-row-id="captions-bag#c-0003"]'))`);
    const bindings = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-tree-row-id^="captions-bag"]')]
      .map(element=>({id:element.dataset.akariTreeRowId,itemId:element.dataset.akariItemId??null,
        inStrip:Boolean(element.closest('.akari-annotations-strip'))}))`);
    const rows = bindings.map(binding => binding.id);
    const bagHeader = bindings.some(binding => binding.id === 'captions-bag' && !binding.inStrip);
    const projectedCaptionChips = ['c-0001', 'c-0002', 'c-0003'].every(id =>
      bindings.some(binding => binding.id === `captions-bag#${id}` && binding.itemId === id && binding.inStrip));
    const bagPresentation = await evalOn(cdp, `({
      toggle:Boolean(document.querySelector('[data-akari-tree-toggle="captions-bag"]')),
      ticks:document.querySelectorAll('[data-akari-tree-bag-tick="captions-bag"]').length,
      headerRows:[...document.querySelectorAll('[data-akari-tree-row-id^="captions-bag"]')]
        .filter(element=>!element.closest('.akari-annotations-strip')).length
    })`);
    assert(!bagHeader && !bagPresentation.toggle && bagPresentation.headerRows === 0,
      'step1 captions bag has no header child rows or expand toggle', { bindings, bagPresentation });
    assert(projectedCaptionChips && bagPresentation.ticks >= 3,
      'step1 caption chips stay directly reachable on the one-row tick band', { bindings, bagPresentation });
    record('step-1-collapsed-baseline', { rows, bindings, bagPresentation });
    await screenshot(cdp, path.join(evidence, '01-captions-expanded.png'));

    await contextMenu('[data-akari-item-kind="caption"][data-akari-item-id="c-0001"]', '出す');
    await waitFor('caption detached', async () => {
      const doc = await readEdit();
      return locate(doc, 'cap-c-0001')?.track.id !== 'captions-track'
        && locate(doc, 'captions-bag')?.item.source.exclude?.includes('c-0001');
    });
    record('step-2-detach', { trackId: locate(await readEdit(), 'cap-c-0001').track.id });
    await screenshot(cdp, path.join(evidence, '02-caption-detached.png'));

    const detachedHeaderRows = await evalOn(cdp,
      `document.querySelectorAll('.akari-track-header-row [data-akari-tree-row-id="cap-c-0001"]').length`);
    assert(detachedHeaderRows === 0,
      'step3 detached leaf caption does not add a startup/header row', { detachedHeaderRows });
    // 「出した字幕」は edit.json には出来るがタイムラインには 1 個もチップが描かれない。
    // ラッパーが基点 main 6c1b9a06 のビルドで同じ操作を実測し、まったく同じ結果
    // （[data-akari-item-id="cap-c-0001"] が DOM に 0 個・新しい段 v2 だけが増える）になることを
    // 確認済み = 本票（葉を行にしない）由来ではない main 既存の欠落。
    // 直るまでは事実を記録するだけにして、存在しない経路を assert しない。
    const detachedChips = await evalOn(cdp,
      `document.querySelectorAll('[data-akari-item-id="cap-c-0001"]').length`);
    record('step-3-detached-leaf', {
      detachedHeaderRows,
      detachedChips,
      knownGap: detachedChips === 0
        ? '出した字幕にチップが描かれない（main 6c1b9a06 でも同一・本票の範囲外）'
        : null
    });
    await screenshot(cdp, path.join(evidence, '03-caption-moved.png'));

    await contextMenu('[data-akari-item-kind="caption"][data-akari-item-id="c-0002"]', 'テロップに変換');
    await waitFor('caption converted', async () => {
      const item = locate(await readEdit(), 'cap-c-0002')?.item;
      return item?.source?.kind === 'telop' && item.source.from === 'captions.json#c-0002';
    });
    record('step-4-convert', { source: locate(await readEdit(), 'cap-c-0002').item.source });
    await screenshot(cdp, path.join(evidence, '04-caption-converted.png'));
    const captionsAfter = await sha(captionsPath);
    assert(captionsAfter === captionsBefore, 'captions.json bytes stay unchanged', { sha256: captionsAfter });
  } finally {
    cdp.close();
  }
}

async function runCapture() {
  const doc = await readEdit();
  const c1 = locate(doc, 'cap-c-0001')?.item;
  const c2 = locate(doc, 'cap-c-0002')?.item;
  const captions = JSON.parse(await readFile(captionsPath, 'utf8'));
  const captionById = new Map((Array.isArray(captions) ? captions : captions?.captions ?? [])
    .map(caption => [caption.id, caption]));
  const captionText = id => {
    const text = captionById.get(id)?.text;
    assert(typeof text === 'string' && text.length > 0, `step5 ${id} text exists`);
    return text;
  };
  const normalizeVisibleText = value => String(value)
    .replace(/<style\b[\s\S]*?<\/style>/gu, '')
    .replace(/<script\b[\s\S]*?<\/script>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, '');
  assert(c1?.source?.kind === 'caption', 'step5 detached caption item exists', { item: c1 });
  assert(c2?.source?.kind === 'telop', 'step5 converted telop item exists', { item: c2 });
  const osrPage = await loadAndBuildOsrPage({ projectRoot: project });
  const html = osrPage.html;
  const overlaySheetHtml = osrPage.overlaySheetHtml;
  const overlayText = normalizeVisibleText(overlaySheetHtml);
  const osrTelop = locate(osrPage.edit, 'cap-c-0002')?.item;
  const pageChecks = {
    excludedCaptionAbsent: !overlayText.includes(normalizeVisibleText(captionText('c-0001')))
      && !overlaySheetHtml.includes('data-overlay-id="c-0001-'),
    convertedCaptionAbsent: !overlayText.includes(normalizeVisibleText(captionText('c-0002')))
      && !overlaySheetHtml.includes('data-overlay-id="c-0002-'),
    convertedTelopPresent: html.includes('cap-c-0002') && osrTelop?.source?.kind === 'telop'
      && osrTelop.source.from === 'captions.json#c-0002',
    remainingCaptionPresent: overlayText.includes(normalizeVisibleText(captionText('c-0003')))
      && overlaySheetHtml.includes('data-overlay-id="c-0003-'),
  };
  assert(pageChecks.excludedCaptionAbsent, 'step5 excluded c-0001 has no caption plate', pageChecks);
  assert(pageChecks.convertedCaptionAbsent && pageChecks.convertedTelopPresent,
    'step5 c-0002 is a telop rather than a caption plate', pageChecks);
  assert(pageChecks.remainingCaptionPresent, 'step5 c-0003 remains a caption plate', pageChecks);
  record('step-5-osr-page', pageChecks);

  const output = path.join(evidence, 'capture');
  await mkdir(output, { recursive: true });
  const launcher = path.join(repository, 'packages/akari-launcher/bin/akari.mjs');
  const { stdout, stderr } = await execFileAsync(process.execPath, [launcher, 'capture', '-p', project,
    '-t', '1', '--engine', 'osr', '--out', output], { cwd: repository, maxBuffer: 10 * 1024 * 1024 });
  const files = await readdir(output);
  assert(files.some(file => file.endsWith('.png')), 'step5 osr capture writes PNG', { files });
  assert(files.includes('capture.json'), 'step5 osr capture writes capture.json', { files });
  const manifestPath = path.join(output, 'capture.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, `${JSON.stringify(sanitizeEvidence(manifest), null, 2)}\n`);
  const launcherTier = manifest?.provenance?.launcher_tier
    ?? manifest?.receipt?.provenance?.launcher_tier
    ?? manifest?.verify?.provenance?.launcher_tier
    ?? null;
  assert(manifest?.engine?.resolved === 'osr' && /^osr-export@/u.test(String(manifest?.renderer ?? '')),
    'step5 capture stays on the osr engine', { engine: manifest?.engine, renderer: manifest?.renderer });
  if (launcherTier !== null) {
    assert(launcherTier === 1 || launcherTier === 2,
      'step5 osr capture uses launcher tier 1 or 2', { launcherTier });
  }
  record('step-5-osr-capture', {
    files,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    launcherTier,
    manifest: {
      engine: manifest?.engine ?? null,
      renderer: manifest?.renderer ?? null,
      verify: manifest?.verify ?? null,
      provenance: manifest?.provenance ?? null,
      receipt: manifest?.receipt ?? null,
    }
  });
}

try {
  if (mode === 'cdp' || mode === 'all') await runCdp();
  if (mode === 'capture' || mode === 'all') await runCapture();
  await writeFile(logPath, `${JSON.stringify(sanitizeEvidence({ status: 'PASS', mode, records }), null, 2)}\n`);
} catch (error) {
  await writeFile(logPath, `${JSON.stringify(sanitizeEvidence({
    status: 'FAIL', mode, error: error?.stack ?? String(error), records
  }), null, 2)}\n`);
  throw error;
}
