#!/usr/bin/env node
// L1（CDP 3 手順）: 素材 2 本の合成プロジェクトで、台本の行が「その行の素材」の中で完結することを実機で見る。
//  素材 1 = オーナー実プロジェクトの素材の TMP コピー（実無音 8.61–11.30 を持つ）
//  素材 2 = ffmpeg lavfi で作る 20 秒の映像 + 音声（5〜9 秒が無音。実測値は silencedetect で取る）
//  edit.json の区間は src-1（0〜26 秒）→ src-2（0〜20 秒）の順。素材 2 の output オフセットは 26 秒
//  1. 素材 2 の行の範囲エディタ: 波形 RPC（getClipWaveform）の videoUri が素材 2・語の帯に素材 1 の語が出ない
//  2. 素材 2 の行の outStart が 26 + 行の start（= 2.00 ではない）・行の時刻ボタンのシークがその時刻へ行く
//  3. 素材 1 の行（c-0003）の範囲エディタは従来どおり（波形 = 素材 1・語の帯は c-0002〜c-0004 の語）
// Electron は detached にせず、HOME / AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir を TMP の作業領域へ向ける。
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURES = path.join(REPO, 'apps/shell/extensions/akari-transcript/test/fixtures/daihon-cut-range-free');
const VENDOR_FFMPEG = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const OWNER_MEDIA = process.env.AKARI_OWNER_MEDIA
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video/assets/IMG_4606のコヒ_ー.MOV');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22191);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

// 素材 1（オーナー実素材）の既知の値 — 前票 daihon-cut-range-free / daihon-silence-by-row-source の実測
const SRC1 = { row: 'c-0003', next: 'c-0004', silence: { start: 8.61, end: 11.30 }, outStart: 5.2, text: '頑張っておりました' };
const SRC1_OUT = 26;        // src-1 の区間 in 0 → out 26（= 素材 2 の output オフセット）
const FPS = 30;
const SYNTH = { duration: 20, silenceFrom: 5, silenceTo: 9, name: 'synthetic.mp4' };
// 素材 2（合成）の字幕 2 行。行間 [4.5, 9.5] に合成した無音（5〜9 秒）が丸ごと入る。
// 文字はオーナー素材の台詞と 1 文字も重ならないものを選ぶ（語の帯の混入をテキストだけで判定するため）
const SRC2 = {
  rowA: { id: 'c-0009', start: 2.0, end: 4.5, text: 'ピポパ音源',
    words: [{ text: 'ピポ', start: 2.0, end: 3.2 }, { text: 'パ音源', start: 3.3, end: 4.5 }] },
  rowB: { id: 'c-0010', start: 9.5, end: 12.0, text: 'ブザ合図',
    words: [{ text: 'ブザ', start: 9.5, end: 10.7 }, { text: '合図', start: 10.8, end: 12.0 }] }
};

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replaceAll(os.homedir(), '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"]+/g, '<TMP>')
  .replace(/\/Users\/[^\s)'"]+/g, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${path.basename(command)} exited ${code}: ${sanitize(stderr.slice(-1500))}`)));
  });
}

async function ffmpegPath() {
  if (await stat(VENDOR_FFMPEG).then(() => true).catch(() => false)) return VENDOR_FFMPEG;
  return 'ffmpeg';
}

/** 素材 2 を作る: 20 秒・440Hz のサイン波（5〜9 秒だけ無音）+ 単色映像。 */
async function makeSyntheticSource(ffmpeg, target) {
  const audio = `aevalsrc='0.5*sin(2*PI*440*t)*(lt(t,${SYNTH.silenceFrom})+gte(t,${SYNTH.silenceTo}))':d=${SYNTH.duration}:s=48000`;
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1b3a6b:s=640x360:r=30:d=${SYNTH.duration}`,
    '-f', 'lavfi', '-i', audio,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', target]);
}

/** アプリと同じフィルタで素材の無音を測る（期待値をハードコードしないため）。 */
async function measureSilences(ffmpeg, target) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', target,
    '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-']);
  const spans = [];
  let open;
  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) { open = Number(start[1]); continue; }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && open !== undefined) { spans.push({ start: open, end: Number(end[1]) }); open = undefined; }
  }
  return spans;
}

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

/** 台本 widget の実体（WidgetManager 経由）。行モデルの実値と RPC フックのために使う。 */
const WIDGET = `(()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getOrCreateWidget==='function'&&typeof k.prototype?.getWidgets==='function');if(!K)return null;const list=window.theia.container.get(K).getWidgets('akari-daihon-widget')||[];return list[0]??null})()`;

async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,chip:r.querySelector('.akari-daihon-gapchip')?.textContent??null}));const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({rows,editor:e?e.className:null})})()`).catch(error => String(error));
}

async function rect(cdp, selector) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 20_000 })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await sleep(140);
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`);
}

/** クリック点に本当にその要素があるか（別パネルに覆われていないか）を確かめてから押す。 */
async function hitTest(cdp, selector, point) {
  return evalOn(cdp, `(()=>{const e=document.elementFromPoint(${point.x},${point.y});const t=document.querySelector(${S(selector)});return{same:Boolean(e&&t&&(e===t||t.contains(e)||e.contains(t))),hit:e?(e.className||e.tagName):null}})()`);
}

async function clickSelector(cdp, selector) {
  const point = await rect(cdp, selector);
  const hit = await hitTest(cdp, selector, point);
  await realClick(cdp, point.x, point.y);
  return { point, hit };
}

/** 波形 RPC（getClipWaveform）の要求を widget の annotationsService 参照ごと包んで記録する。 */
async function hookWaveformRpc(cdp) {
  return evalOn(cdp, `(()=>{const w=${WIDGET};if(!w)return 'no-widget';window.__akariWaveCalls=window.__akariWaveCalls||[];if(w.__akariWaveHooked)return 'already';const service=w.annotationsService;const wrapped=new Proxy(service,{get(target,property,receiver){const value=Reflect.get(target,property,receiver);if(property==='getClipWaveform'&&typeof value==='function'){return request=>{try{window.__akariWaveCalls.push(JSON.parse(JSON.stringify(request)));}catch(error){window.__akariWaveCalls.push({error:String(error)});}return value(request);};}return value;}});Object.defineProperty(w,'annotationsService',{value:wrapped,configurable:true,writable:true});w.__akariWaveHooked=true;return 'hooked'})()`);
}

const clearWaveCalls = cdp => evalOn(cdp, `(()=>{window.__akariWaveCalls=[];return true})()`);
const waveCalls = cdp => evalOn(cdp, `(()=>JSON.parse(JSON.stringify(window.__akariWaveCalls||[])))()`);

/** 範囲エディタの語の帯（.band）の title から語と秒を読む。 */
const bandsOf = cdp => evalOn(cdp, `(()=>[...document.querySelectorAll('.akari-daihon-cutrange .band')].map(b=>b.title))()`);

/** 行モデルの実値（outStart / outEnd / src）。 */
const rowsOf = cdp => evalOn(cdp, `(()=>{const w=${WIDGET};if(!w)return null;return (w.rows||[]).map(r=>({id:r.id,start:r.start,end:r.end,outStart:r.outStart,outEnd:r.outEnd,src:r.src===undefined?'<undefined>':r.src}))})()`);

/** 波形が描き終わる（RPC の結果が入る）まで待つ。SS に実波形を残すため。 */
async function waitWaveform(cdp) {
  return waitEval(cdp,
    `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.waveform&&m.waveform!=='loading'?m.waveform:null})()`,
    { label: '波形の描画', timeoutMs: 120_000 });
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

/** 「m:ss.cc」表記を秒へ戻す（widget の formatTime の逆）。 */
function parseClock(text) {
  const matched = String(text ?? '').match(/(\d+):(\d{2})\.(\d{2})/);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) + Number(matched[3]) / 100 : null;
}

const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-per-source-l1-')));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const editPath = path.join(project, 'edit.json');
const synthPath = path.join(project, 'assets', SYNTH.name);
let child; let cdp;
try {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(profile, { recursive: true });
  await cp(OWNER_MEDIA, path.join(project, 'assets/owner.MOV'));       // 原本は読むだけ
  const ffmpeg = await ffmpegPath();
  await makeSyntheticSource(ffmpeg, synthPath);
  const synthSilences = await measureSilences(ffmpeg, synthPath);
  const target = synthSilences.find(span => span.start < SRC2.rowB.start && span.end > SRC2.rowA.end);
  assert(target, `合成素材に行間 ${SRC2.rowA.end}–${SRC2.rowB.start} を覆う無音が無い: ${JSON.stringify(synthSilences)}`);
  const expectedSilence = { start: target.start, end: target.end };

  const ownerCaptions = JSON.parse(await readFile(path.join(FIXTURES, 'captions-owner.json'), 'utf8'));
  const ownerChars = new Set([...ownerCaptions.captions.map(caption => caption.text).join('')]);
  const synthChars = new Set([...`${SRC2.rowA.text}${SRC2.rowB.text}`]);
  const shared = [...synthChars].filter(character => ownerChars.has(character));
  assert(shared.length === 0, `合成字幕の文字がオーナー字幕と重なっている: ${shared.join('')}`);

  const captions = {
    ...ownerCaptions,
    captions: [...ownerCaptions.captions, ...[SRC2.rowA, SRC2.rowB].map((row, index) => ({
      id: row.id, start: row.start, end: row.end, text: row.text, speaker: null,
      sourceRef: { segment: index }, edited: false, src: 'src-2', words: row.words
    }))]
  };
  const edit = { version: 2, output: { width: 640, height: 360, fps: FPS }, sources: [
    { id: 'src-1', path: 'assets/owner.MOV' },
    { id: 'src-2', path: `assets/${SYNTH.name}` }
  ], tracks: [
    { id: 'video', lane: 'visual', items: [
      { id: 'owner', at: 0, duration: SRC1_OUT * FPS, source: { kind: 'media', src: 'src-1', in: 0, out: SRC1_OUT } },
      { id: 'synth', at: SRC1_OUT * FPS, duration: SYNTH.duration * FPS, source: { kind: 'media', src: 'src-2', in: 0, out: SYNTH.duration } }
    ] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ] };
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`);
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  // analysis.json は置かない。無音一覧は getClipSilences（その場で silencedetect）で素材ごとに取る経路を通す。
  const originalCaptions = await readFile(captionsPath, 'utf8');
  const originalEdit = await readFile(editPath, 'utf8');
  out.fixture = {
    ffmpeg: ffmpeg === VENDOR_FFMPEG ? '<WORKTREE>/packages/media-bin/vendor/darwin-arm64/ffmpeg' : 'ffmpeg',
    syntheticSilences: synthSilences, expectedSilence,
    src2OutputOffset: SRC1_OUT,
    expectedOutStart: { [SRC2.rowA.id]: SRC1_OUT + SRC2.rowA.start, [SRC2.rowB.id]: SRC1_OUT + SRC2.rowB.start },
    buggyOutStart: { [SRC2.rowA.id]: SRC2.rowA.start }
  };
  await save();

  child = spawn(ELECTRON, [SHELL_DIR, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, HOME: profile, AKARI_HOME: path.join(profile, 'akari-home'), THEIA_CONFIG_DIR: path.join(profile, 'theia') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  let electronExit;
  child.stdout.on('data', chunk => log.push(String(chunk)));
  child.stderr.on('data', chunk => log.push(String(chunk)));
  child.once('close', (code, signal) => { electronExit = { code, signal }; });
  let page;
  for (let attempt = 0; attempt < 600 && !page; attempt += 1) {
    page = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined);
    if (electronExit) break;
    if (!page) await sleep(300);
  }
  assert(page, `CDP page target did not appear; electron=${JSON.stringify(electronExit)} log=${sanitize(log.join('').slice(-3000))}`);
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  out.rendererErrors = [];
  cdp.on('Runtime.exceptionThrown', params => {
    out.rendererErrors.push(sanitize(params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? ''));
  });
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
  await evalOn(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b){b.click();return 'clicked';} return 'none'; })()`).catch(() => undefined);
  out.workspaceRoots = await waitEval(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.tryGetRoots==='function');if(!K)return null;const ws=window.theia.container.get(K);await ws.ready;return (ws.tryGetRoots()||[]).length})()`, { label: 'workspace roots', timeoutMs: 180_000 });
  await save();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    try { await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===10`, { label: '10 行（素材 1 の 8 行 + 素材 2 の 2 行）', timeoutMs: 40_000 }); break; }
    catch (error) { if (attempt === 2) throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)} | log=${sanitize(log.join('').slice(-1200))}`); }
  }
  out.waveHook = await hookWaveformRpc(cdp);
  assert(out.waveHook === 'hooked', `波形 RPC をフックできない: ${out.waveHook}`);
  await save();

  // 1. 素材 2 の行の範囲エディタ: 波形が素材 2・語の帯に素材 1 の語が出ない
  await step('1. 素材 2 の行の範囲エディタで波形 RPC が素材 2 のファイル・語の帯に素材 1 の語が出ない', async () => {
    await waitEval(cdp,
      `(()=>{const c=document.querySelector('.akari-daihon-row[data-caption-id="${SRC2.rowA.id}"] .akari-daihon-gapchip');return c&&c.dataset.source==='silence'?c.title:null})()`,
      { label: '素材 2 のチップ', timeoutMs: 180_000 })
      .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
    await clearWaveCalls(cdp);
    await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
    await clickSelector(cdp, `.akari-daihon-row[data-caption-id="${SRC2.rowA.id}"] .akari-daihon-gapchip`);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '範囲エディタ' })
      .catch(async error => {
        const dom = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');return JSON.stringify({editor:e?e.outerHTML.slice(0,400):null,notifications:[...document.querySelectorAll('.akari-daihon-footer')].map(n=>n.textContent).slice(0,2)})})()`).catch(String);
        throw new Error(`${sanitize(error)} | dom=${dom} | renderer=${JSON.stringify((out.rendererErrors ?? []).slice(-4))}`);
      });
    const calls = await waitEval(cdp, `(()=>{const c=window.__akariWaveCalls||[];return c.length?JSON.parse(JSON.stringify(c)):null})()`, { label: '波形 RPC の送信' });
    const request = calls[calls.length - 1];
    assert(String(request.videoUri).endsWith(`/${SYNTH.name}`),
      `波形 RPC が素材 2 を読んでいない: ${sanitize(request.videoUri)}`);
    assert(!String(request.videoUri).endsWith('/owner.MOV'), `波形 RPC が素材 1 を読んでいる: ${sanitize(request.videoUri)}`);
    const bands = await bandsOf(cdp);
    assert(bands.length >= 2, `語の帯が出ていない: ${JSON.stringify(bands)}`);
    const texts = bands.map(title => title.replace(/\s*\([\d.]+–[\d.]+\)$/u, ''));
    const intruders = texts.filter(text => [...text].some(character => ownerChars.has(character)));
    assert(intruders.length === 0, `語の帯に素材 1 の語が混ざっている: ${JSON.stringify(intruders)} / all=${JSON.stringify(texts)}`);
    assert(texts.every(text => [...text].every(character => synthChars.has(character))),
      `語の帯に素材 2 以外の語がある: ${JSON.stringify(texts)}`);
    const waveformStatus = await waitWaveform(cdp);
    const metrics = await evalOn(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m?{waveform:m.waveform,buckets:m.buckets,window:m.window,silences:m.silences,labels:m.labels}:null})()`);
    assert(waveformStatus === 'ready' && metrics.buckets > 0, `波形が出ていない: ${waveformStatus} / buckets=${metrics.buckets}`);
    await rect(cdp, '.akari-daihon-cutrange .wave');
    await shot(cdp, 1, 'range-editor-source-2-waveform-words');
    return {
      videoUri: `<TMP>/${path.basename(String(request.videoUri))}`,
      projectRootUri: '<TMP>',
      startSeconds: request.startSeconds, endSeconds: request.endSeconds, bucketCount: request.bucketCount,
      bandTexts: texts, waveform: metrics?.waveform ?? null, buckets: metrics?.buckets ?? null,
      editorSilences: metrics?.silences ?? null, expectedSilence
    };
  });

  // 2. 素材 2 の行の outStart が素材 2 の区間の output 時刻・時刻ボタンのシークがその時刻へ行く
  await step(`2. 素材 2 の行の outStart が ${SRC1_OUT + SRC2.rowA.start}（= 素材 1 の区間長 ${SRC1_OUT} + 行の start ${SRC2.rowA.start}）でシークもその時刻へ行く`, async () => {
    const rows = await rowsOf(cdp);
    assert(Array.isArray(rows) && rows.length === 10, `行モデルを読めない: ${JSON.stringify(rows)?.slice(0, 200)}`);
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const row of [SRC2.rowA, SRC2.rowB]) {
      const actual = byId.get(row.id);
      const expected = SRC1_OUT + row.start;
      assert(actual && Math.abs(actual.outStart - expected) < 0.001,
        `${row.id} の outStart が ${JSON.stringify(actual)}（${expected} のはず）`);
      assert(Math.abs(actual.outStart - row.start) > 0.001,
        `${row.id} の outStart が素材 1 の区間へ写ったままの ${actual.outStart}`);
      assert(actual.src === 'src-2', `${row.id} の row.src が ${actual.src}`);
    }
    const ownerRow = byId.get(SRC1.row);
    assert(ownerRow && Math.abs(ownerRow.outStart - SRC1.outStart) < 0.001,
      `素材 1 の ${SRC1.row} の outStart が ${JSON.stringify(ownerRow)}（${SRC1.outStart} のはず）`);
    assert(ownerRow.src === 'src-1', `素材 1 の行の src が ${ownerRow.src}`);
    await evalOn(cdp, `(()=>{const f=document.querySelector('.akari-daihon-footer');if(f)f.textContent='(cleared)';return true})()`);
    await clickSelector(cdp, `.akari-daihon-row[data-caption-id="${SRC2.rowA.id}"] .akari-daihon-tc`);
    const footer = await waitEval(cdp,
      `(()=>{const f=document.querySelector('.akari-daihon-footer');const t=f?f.textContent:'';return t&&t!=='(cleared)'?t:null})()`,
      { label: 'シークの通知', timeoutMs: 60_000 });
    const seeked = parseClock(footer);
    const expected = SRC1_OUT + SRC2.rowA.start;
    assert(seeked !== null && Math.abs(seeked - expected) < 0.02,
      `シーク先が ${footer}（${expected} 秒のはず）`);
    assert(Math.abs(seeked - SRC2.rowA.start) > 0.02, `シーク先が行の start のまま: ${footer}`);
    await shot(cdp, 2, 'row-source-2-outstart-seek');
    return { rows, footer, seeked, expected, seekedToPreview: footer.includes('シークしました') };
  });

  // 3. 素材 1 の行（c-0003）の範囲エディタは従来どおり
  await step(`3. 素材 1 の行（${SRC1.row}）の範囲エディタは従来どおり（波形 = 素材 1・語の帯は素材 1 の語）`, async () => {
    let opened;
    const attempts = [];
    for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
      await clearWaveCalls(cdp);
      await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
      const click = await clickSelector(cdp, `.akari-daihon-row[data-caption-id="${SRC1.row}"] .akari-daihon-gapchip`);
      attempts.push(click.hit);
      opened = await waitEval(cdp,
        `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.target&&Math.abs(m.target.start-${SRC1.silence.start})<0.05?{target:m.target}:null})()`,
        { label: `素材 1 の範囲エディタ（${attempt + 1} 回目）`, timeoutMs: 20_000 }).catch(() => undefined);
    }
    if (!opened) throw new Error(`素材 1 の範囲エディタが開かない | clicks=${JSON.stringify(attempts)} | dom=${await domDump(cdp)}`);
    const calls = await waitEval(cdp, `(()=>{const c=window.__akariWaveCalls||[];return c.length?JSON.parse(JSON.stringify(c)):null})()`, { label: '素材 1 の波形 RPC' });
    const request = calls[calls.length - 1];
    assert(String(request.videoUri).endsWith('/owner.MOV'), `波形 RPC が素材 1 を読んでいない: ${sanitize(request.videoUri)}`);
    const bands = await bandsOf(cdp);
    const texts = bands.map(title => title.replace(/\s*\([\d.]+–[\d.]+\)$/u, ''));
    assert(texts.length >= 2, `語の帯が出ていない: ${JSON.stringify(texts)}`);
    const intruders = texts.filter(text => [...text].some(character => synthChars.has(character)));
    assert(intruders.length === 0, `語の帯に素材 2 の語が混ざっている: ${JSON.stringify(intruders)}`);
    assert(texts.some(text => SRC1.text.includes(text)), `語の帯に ${SRC1.row} の語が無い: ${JSON.stringify(texts)}`);
    const waveformStatus = await waitWaveform(cdp);
    const metrics = await evalOn(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m?{waveform:m.waveform,buckets:m.buckets,window:m.window,silences:m.silences}:null})()`);
    assert(waveformStatus === 'ready' && metrics.buckets > 0, `波形が出ていない: ${waveformStatus} / buckets=${metrics.buckets}`);
    assert(metrics?.silences?.some(span => Math.abs(span.start - SRC1.silence.start) < 0.02 && Math.abs(span.end - SRC1.silence.end) < 0.02),
      `素材 1 の無音が出ていない: ${JSON.stringify(metrics?.silences)}`);
    await rect(cdp, '.akari-daihon-cutrange .wave');
    await shot(cdp, 3, 'range-editor-source-1-unchanged');
    return {
      videoUri: `<TMP>/${path.basename(String(request.videoUri))}`,
      startSeconds: request.startSeconds, endSeconds: request.endSeconds,
      bandTexts: texts, waveform: metrics?.waveform ?? null, buckets: metrics?.buckets ?? null,
      editorSilences: metrics?.silences ?? null
    };
  });

  out.chips = await evalOn(cdp, `(()=>[...document.querySelectorAll('.akari-daihon-row')].map(r=>({id:r.dataset.captionId,chip:r.querySelector('.akari-daihon-gapchip')?.textContent?.trim()??null,source:r.querySelector('.akari-daihon-gapchip')?.dataset.source??null})))()`);
  out.untouched = {
    captions: (await readFile(captionsPath, 'utf8')) === originalCaptions,
    edit: (await readFile(editPath, 'utf8')) === originalEdit
  };
  assert(out.untouched.captions && out.untouched.edit, `見ただけでファイルが変わった: ${JSON.stringify(out.untouched)}`);
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
} finally {
  cdp?.close();
  const pid = child?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    await sleep(800);
  }
  const survivors = await new Promise(resolve => {
    const probe = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(profile)} | grep -v grep | wc -l`]);
    let stdout = '';
    probe.stdout.on('data', chunk => { stdout += chunk; });
    probe.once('close', () => resolve(Number(stdout.trim())));
  });
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, workdir: '<TMP>' };
  await save();
}
process.stdout.write(`${JSON.stringify({ status: out.status, steps: out.steps.map(s => [s.name, s.pass]), screenshots: out.screenshots, cleanup: out.cleanup, error: out.error })}\n`);
process.exit(out.status === 'pass' ? 0 : 1);
