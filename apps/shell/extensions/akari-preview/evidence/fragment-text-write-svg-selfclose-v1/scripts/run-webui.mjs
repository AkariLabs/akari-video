#!/usr/bin/env node
// Web UI（preview-server）で同梱サンプルの断片 1 本の文字を直し、PUT /api/overlay-html の経路で保存されるかを実ブラウザで確かめる。
// before = 記録だけ / after = 200 で保存され、断片ファイルの差分が足した 1 文字の 1 行だけであることを検査する。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { compareTags } from './tag-ruler.mjs';

const [, , baseArg, fixtureArg, outArg, modeArg] = process.argv;
const mode = modeArg ?? 'after';
if (!baseArg || !fixtureArg || !outArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-webui.mjs <server-url> <fixture.json> <out> <before|after>');
}
const base = new URL(baseArg).origin;
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(base)) throw new Error('the preview server must be on 127.0.0.1');
const out = path.resolve(outArg);
const ITEM = process.env.AKARI_FTW_WEB_ITEM ?? 'demo-title';
const SELECTOR = process.env.AKARI_FTW_WEB_SELECTOR ?? '.demo-title__lead';
const INSERTED = 'Q';
const REFUSAL = '断片の構造が変わったため、元ソースの文字だけを安全に保存できません';
const logPath = path.join(out, `run-log-webui-${mode}.json`);
const log = { mode, item: ITEM, selector: SELECTOR, startedAt: new Date().toISOString(), status: 'FAIL' };
await mkdir(out, { recursive: true });
let browser;
try {
  const fixture = JSON.parse(await readFile(fixtureArg, 'utf8'));
  const project = fixture.project;
  const item = fixture.items.find(candidate => candidate.id === ITEM);
  if (!item) throw new Error(`item not in the sample: ${ITEM}`);
  const file = path.join(project, item.path);
  const original = await readFile(file, 'utf8');
  const editBefore = await readFile(path.join(project, 'edit.json'), 'utf8');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const puts = [];
  page.on('request', request => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/overlay-html')) puts.push(request.postDataJSON());
  });
  // 動画のデコードに依らないよう、既存の preview-server のブラウザテストと同じく frameEngine=0 で開く。
  await page.goto(`${base}/?frameEngine=0`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => Number(document.getElementById('seek')?.max) > 0, null, { timeout: 60000 });
  await page.click('#edit-toggle');
  const seconds = Math.round(item.at + item.duration * 0.6) / fixture.fps;
  await page.evaluate(value => {
    const seek = document.getElementById('seek');
    seek.value = String(value);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new Event('change', { bubbles: true }));
  }, seconds);
  const locator = page.locator(`#overlay-stage > [data-overlay-id="${ITEM}"] ${SELECTOR}`).first();
  await locator.waitFor({ state: 'attached', timeout: 30000 });
  await sleep(1200);
  const box = await locator.boundingBox();
  if (!box) throw new Error('text element has no box');
  log.target = { seconds, box, text: await locator.textContent() };
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(500);
  log.opened = await page.evaluate(() => ({ editable: document.activeElement?.isContentEditable === true,
    className: document.activeElement?.getAttribute?.('class') ?? null, text: document.activeElement?.textContent ?? null }));
  if (!log.opened.editable) throw new Error('text edit did not open');
  await page.keyboard.insertText(INSERTED);
  log.typed = await page.evaluate(() => document.activeElement?.textContent ?? null);
  const responded = page.waitForResponse(response => response.url().endsWith('/api/overlay-html'), { timeout: 30000 });
  await page.keyboard.press('Enter');
  const response = await responded;
  log.put = { status: response.status(), body: await response.json().catch(() => null) };
  await sleep(1200);
  const current = await readFile(file, 'utf8');
  log.fragmentChanged = current !== original;
  log.editJsonChanged = (await readFile(path.join(project, 'edit.json'), 'utf8')) !== editBefore;
  if (puts[0]?.html) {
    await writeFile(path.join(out, `webui-${mode}-${ITEM}.sent.html`), puts[0].html);
    log.sent = { id: puts[0].id, length: puts[0].html.length };
    log.tagCompare = compareTags(original, puts[0].html);
  }
  if (log.fragmentChanged) {
    const a = original.split('\n'), b = current.split('\n');
    const changed = a.length === b.length ? a.map((line, index) => index).filter(index => a[index] !== b[index]) : null;
    let onlyInserted = false;
    if (changed?.length === 1) {
      const before = a[changed[0]], after = b[changed[0]];
      for (let index = 0; index < after.length && !onlyInserted; index++) {
        if (after[index] === INSERTED && after.slice(0, index) + after.slice(index + 1) === before) onlyInserted = true;
      }
      log.fragmentDiff = { line: changed[0] + 1, removed: before.slice(0, 200), added: after.slice(0, 200) };
    }
    log.fragmentDiff = { ...(log.fragmentDiff ?? {}), changedLines: changed?.length ?? null, sameLineCount: a.length === b.length,
      onlyInsertedCharacter: onlyInserted };
  }
  // 本当に構造が変わった html（SVG の中に要素を 1 つ足したもの）は、この経路でも拒否され、断片は書き換わらない
  if (puts[0]?.html) {
    const tampered = puts[0].html.replace('</svg>', '<circle></circle></svg>');
    const refused = await page.evaluate(async ({ id, html }) => {
      const response = await fetch('/api/overlay-html', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, html }) });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, { id: ITEM, html: tampered });
    const error = refused.body?.error ?? '';
    log.structureChange = { tampered: tampered !== puts[0].html, ...refused,
      fragmentUnchanged: (await readFile(file, 'utf8')) === current,
      refusedWithDetail: refused.status === 422 && error.startsWith(REFUSAL) && error.includes('最初の違い') };
  }
  const saved = log.put.status === 200 && log.fragmentChanged && log.fragmentDiff?.changedLines === 1
    && log.fragmentDiff.onlyInsertedCharacter === true && log.editJsonChanged === false;
  log.result = saved ? 'saved' : log.put.status === 200 ? 'unexpected' : 'refused';
  log.status = mode === 'before' ? 'RECORDED'
    : saved && log.structureChange?.refusedWithDetail === true && log.structureChange.fragmentUnchanged === true ? 'PASS' : 'FAIL';
} catch (error) {
  log.fatalError = String(error?.stack ?? error);
} finally {
  log.finishedAt = new Date().toISOString();
  await browser?.close().catch(() => undefined);
  await writeFile(logPath, JSON.stringify(log, null, 2) + '\n');
}
console.log(`webui/${mode}: ${log.status} ${JSON.stringify({ result: log.result ?? null, put: log.put ?? null })} ${logPath}`);
process.exitCode = log.status === 'FAIL' ? 1 : 0;
