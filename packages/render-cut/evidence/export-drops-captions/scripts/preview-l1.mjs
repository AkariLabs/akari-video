#!/usr/bin/env node
// シェル実機のプレビューが「2 回書き出した後の edit.json」（sources = 素材 1 本 + 書き出し mp4 2 本）で話した言葉を出すかの L1。
// cdp-lib.mjs / l1-lib.mjs は akari-preview の既存 L1 証跡（placed-text-feedback-polish）の写し。
// 使い方: node preview-l1.mjs <phase> <2 回書き出し済みのプロジェクト> [--port=9485]
// 実機の Electron を専用ポート・専用の一時ディレクトリで起動し、0.75 秒 / 2.25 秒へ移動して字幕プレートを数える。
import { cp, rm, realpath, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { S, command, launch, sanitize, saveJson, sleep, stop, waitEval } from './l1-lib.mjs';

const [PHASE, SRC] = process.argv.slice(2);
if (!PHASE || !SRC) throw new Error('usage: node preview-l1.mjs <phase> <project>');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON_REL = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ELECTRON = existsSync(path.join(SHELL, ELECTRON_REL)) ? path.join(SHELL, ELECTRON_REL) : path.join(REPO, ELECTRON_REL);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9485);
const TMP = path.join(os.tmpdir(), 'export-drops-captions-preview');
const RESULTS = path.join(ROOT, `results-preview-${PHASE}.json`);
const out = { phase: PHASE, status: 'running', samples: [], previewWarnings: [], screenshots: [] };

async function waitFor(label, fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(300); }
  throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
// webview（入れ子 iframe）の中で #preview-stage を持つ文脈を探す。
async function view() {
  let cdp, ctx, url;
  const attach = async () => {
    cdp?.close(); cdp = undefined;
    await waitFor('preview stage', async () => {
      for (const target of (await listTargets(PORT)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
        const client = new CDP(target.webSocketDebuggerUrl);
        try { await client.connect(); } catch { continue; }
        const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
        try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
        await sleep(300);
        for (const c of [undefined, ...contexts.map(c => c.id)]) {
          try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; url = target.url; return true; } } catch {}
        }
        client.close();
      }
      return false;
    }, 600_000);
  };
  await attach();
  return { url: () => url, eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }, close: () => cdp?.close() };
}
// 字幕層の全プレート（id・本文・枠の位置）とプレビュー画面の大きさ。
const PLATES = `(()=>{const f=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];const frame=f?{x:f.x,y:f.y,w:f.width,h:f.height}:null;const plates=[...document.querySelectorAll('.caption-row-plate')].map(p=>{const l=p.querySelector('.akari-caption__line')||p.querySelector('.akari-caption__plate')||p;const r=l.getBoundingClientRect();const cs=getComputedStyle(p);return{id:p.id,text:(l.textContent||'').trim(),visible:r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none',cx:frame?Math.round((r.left+r.width/2-frame.x)/frame.w*1000)/1000:null,cy:frame?Math.round((r.top+r.height/2-frame.y)/frame.h*1000)/1000:null}}).filter(p=>p.visible);return{frame,plates}})()`;

let session;
try {
  const work = path.join(TMP, `work-${PHASE}`);
  await rm(work, { recursive: true, force: true });
  await cp(path.resolve(SRC), work, { recursive: true });
  const project = await realpath(work);
  const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  out.sources = edit.sources.map(s => s.path);
  session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(TMP, 'runs', PHASE) });
  out.pid = session.pid;
  session.cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type !== 'warning' && p.type !== 'error') return;
    const text = p.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (/akari-preview|caption|字幕/i.test(text)) out.previewWarnings.push(sanitize(text.slice(0, 300), REPO));
  });
  const editUri = `file://${path.join(project, 'edit.json')}`;
  await evalOn(session.cdp, command('akari.annotations.open'));
  await waitEval(session.cdp, `document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 600_000 });
  await waitFor('preview webview', async () => {
    await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: 0.75 }));
    await sleep(3000);
    return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
  }, 600_000);
  const v = await view();
  for (const [t, expected] of [[0.75, ['c-0001', 'c-0101']], [2.25, ['c-0002', 'c-0101']]]) {
    await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: t }));
    let m;
    try {
      m = await waitFor(`plates at ${t}`, async () => {
        const r = await v.eval(PLATES);
        return expected.every(id => r.plates.some(p => p.id.startsWith(`caption-plate-${id}`))) ? r : null;
      }, 180_000);
    } catch (error) { m = await v.eval(PLATES); m.error = sanitize(error, REPO); }
    await sleep(1500);
    const file = `preview-${PHASE}-${t}.png`;
    // プレビューの webview の枠だけを撮る（ユーザー名・プロジェクト一覧などの UI を証跡に残さない）。
    // 字幕を数えた webview（target の URL と src が一致する iframe）を優先し、見つからなければ最大の iframe。
    const clip = await evalOn(session.cdp, `(()=>{const all=[...document.querySelectorAll('iframe')];const hit=all.find(f=>f.src===${JSON.stringify(v.url())}.replace(/#.*$/u,'')||f.src===${JSON.stringify(v.url())});const r=(hit?[hit]:all).map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()`);
    const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip });
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
    out.samples.push({ t, expected, pass: !m.error, ...m });
    console.log(t, m.error ? 'MISSING' : 'OK', S(m.plates.map(p => [p.id, p.text, p.cx, p.cy])));
    await saveJson(RESULTS, out);
  }
  v.close();
  out.status = out.samples.every(s => s.pass) ? 'pass' : 'fail';
} catch (error) {
  out.status = 'error'; out.error = sanitize(error, REPO);
  console.error(out.error);
} finally {
  await stop(session);
  // Theia のバックエンド（Electron Helper）がプロセスグループの外に残ることがある → 自分の一時ディレクトリを指すものだけ止める。
  try { execFileSync('pkill', ['-f', 'lib/backend/main.js .*export-drops-captions-preview/']); } catch {}
  await saveJson(RESULTS, out);
  console.log('status', out.status);
}
