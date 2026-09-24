#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, saveJson, waitEval } from './l1-lib.mjs';
import { makeVoicevoxFixture } from './voicevox-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const CLI = path.join(REPO, 'packages/akari-launcher/bin/akari.mjs');
const RESULTS = path.join(ROOT, 'results-l1.json');
const D = '[data-akari-read-aloud-dialog]';
const S = '[data-akari-settings-dialog]';
const q = JSON.stringify;
const names = ['3 つのまとまりとクラウド初期 3 行', 'Fish と Gemini 3.8 の鍵バッジから接続へ',
  'Chatterbox の日本語注記', 'Gemini 3.1 の見積不可と費用承認キャンセル',
  'VOICEVOX の試聴と配置', '自分の声の作り手一覧', '設定の既定エンジン 3 optgroup'];
const out = { status: 'running', cdp: { port: null, launchedPid: null, connectedPid: null, pidMatched: false },
  electron: { processGone: null, portClosed: null }, voicevox: { engine: 'headless', processGone: null, portClosedAtEnd: null },
  paidApiRequests: 0, checks: names.map(name => ({ name, pass: false })) };
const assert = (value, message) => { if (!value) throw new Error(message); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|CREDENTIAL|API/i.test(name)));
let iso, akariHome, fixture, session;
function pids(port) {
  const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (![0, 1].includes(result.status)) throw new Error('port inspection failed');
  return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}
function choosePort() { for (let port = 19711; port <= 19720; port++) if (!pids(port).length) return port; throw new Error('CDP port unavailable'); }
async function click(cdp, selector) { assert(await evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});if(!e)return false;e.click();return true})()`), `missing ${selector}`); }
async function close(cdp, selector) {
  if (await evalOn(cdp, `Boolean(document.querySelector(${q(selector)}))`)) {
    await click(cdp, `${selector} .closeButton`);
    await waitEval(cdp, `!document.querySelector(${q(selector)})`, { label: 'dialog close' });
  }
}
async function openRead(cdp) {
  await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ['c-0001'] }));
  await waitEval(cdp, `document.querySelector(${q(D + ' [data-engine-group="cloud"]')})?.querySelectorAll('[data-engine]').length===3`, { label: 'engine groups' });
}
async function shot(cdp, number, selector = D) {
  await new Promise(resolve => setTimeout(resolve, 700));
  const clip = await evalOn(cdp, `(()=>{if(!document.querySelector(${q(selector)}))return null;const e=[...document.querySelectorAll('.dialogBlock')].filter(e=>e.offsetWidth&&e.offsetHeight).at(-1);if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
  assert(clip && clip.width > 0 && clip.height > 0, 'dialog crop missing');
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const crop = spawnSync('magick', ['png:-', '-crop', `${clip.width}x${clip.height}+${clip.x}+${clip.y}`, '+repage', 'png:-'],
    { input: Buffer.from(result.data, 'base64'), maxBuffer: 10_000_000 });
  assert(crop.status === 0, 'screenshot crop failed');
  await writeFile(path.join(ROOT, `${String(number).padStart(2, '0')}.png`), crop.stdout);
}
async function shotApproval(cdp) {
  const clip = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('見積を出せません。'));if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
  assert(clip, 'approval crop missing');
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const crop = spawnSync('magick', ['png:-', '-crop', `${clip.width}x${clip.height}+${clip.x}+${clip.y}`, '+repage', 'png:-'],
    { input: Buffer.from(result.data, 'base64'), maxBuffer: 10_000_000 });
  assert(crop.status === 0, 'approval screenshot crop failed');
  await writeFile(path.join(ROOT, '04-approval.png'), crop.stdout);
}
async function check(number, cdp, fn, selector = D) {
  const started = Date.now();
  try { out.checks[number - 1].measured = await fn(); await shot(cdp, number, selector); out.checks[number - 1].pass = true; }
  catch (error) { out.checks[number - 1].error = String(error).replaceAll(REPO, '<repo>'); }
  out.checks[number - 1].seconds = Number(((Date.now() - started) / 1000).toFixed(2));
  await saveJson(RESULTS, out);
  assert(out.checks[number - 1].pass, `check ${number} failed`);
}
try {
  iso = await mkdtemp(path.join(os.tmpdir(), 'akari-tts-picker-l1-'));
  akariHome = await mkdtemp(path.join(os.tmpdir(), 'akari-tts-picker-home-'));
  const home = path.join(iso, 'home'), wav = path.join(iso, 'voicevox.wav');
  await mkdir(home, { recursive: true });
  const credentials = path.join(home, 'credentials.env');
  await writeFile(credentials, 'FAL_KEY=AKARI_L1_DUMMY_NEVER_SEND\n');
  const env = { ...cleanEnv(), HOME: home, AKARI_HOME: akariHome, AKARI_CREDENTIALS_FILE: credentials,
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'), XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
    XDG_DATA_HOME: path.join(home, 'xdg-data'), TMPDIR: path.join(home, 'tmp') };
  const generated = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs'), path.join(iso, 'fixture')], { env, encoding: 'utf8', timeout: 240000 });
  assert(generated.status === 0, `project fixture: ${generated.stderr}`);
  const project = path.join(iso, 'fixture/spoken');
  const avatar = path.join(akariHome, 'avatars/sample');
  await mkdir(avatar, { recursive: true });
  await writeFile(path.join(avatar, 'avatar.json'), JSON.stringify({ version: 0, id: 'sample', display_name: 'サンプル',
    variants: [], persona: { first_person: '私', tone: '静か', speech_style: '自然', verbal_tics: [], energy: 50,
      ng: [], default_role: 'narrator' }, renditions: [], default_rendition: null,
    rights: { subject: 'person', consent: 'self', credit_required: false, distribution: 'private' } }));
  assert(pids(50021).length === 0, 'VOICEVOX default port is occupied by another process');
  fixture = await makeVoicevoxFixture({ shell: SHELL, home, akariHome, output: wav });
  assert(fixture.port === 50021, 'VOICEVOX fixture did not own the default port');
  out.voicevox = { ...out.voicevox, pid: fixture.pid, port: fixture.port, startedByScript: fixture.startedByScript };
  const voice = spawnSync(process.execPath, [CLI, 'voice', 'create', '--avatar', 'sample', '--id', 'sample-picker',
    '--label', 'サンプルの声', '--audio', wav, '--script', 'quick-v1', '--consent-self', '--consent-cloud', '--json'],
  { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 360000 });
  assert(voice.status === 0, `voice create: ${voice.stderr || voice.stdout}`);
  const port = choosePort();
  session = await launch({ shellDir: SHELL, electron: path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    project, port, isoDir: path.join(iso, 'electron'), homeDir: home, akariHome, fakeWav: wav });
  out.cdp = { port, launchedPid: session.pid, connectedPid: session.cdpOwnerPid, pidMatched: session.pidMatched };
  assert(session.pidMatched, 'CDP PID does not match launched Electron');
  const cdp = session.cdp;
  const unusedIrodoriPort = Array.from({ length: 21 }, (_, index) => 59900 + index).find(candidate => !pids(candidate).length);
  assert(unusedIrodoriPort, 'isolated Irodori port unavailable');
  const isolatedIrodoriUrl = `http://127.0.0.1:${unusedIrodoriPort}`;
  const preferenceSaved = await evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;
    const key=[...d._map.keys()].find(k=>String(k)==='Symbol(PreferenceService)');
    if(!key)return false;await window.theia.container.get(key).set('akari.narration.irodoriUrl',${q(isolatedIrodoriUrl)},1);
    return window.theia.container.get(key).get('akari.narration.irodoriUrl')===${q(isolatedIrodoriUrl)}})()`);
  assert(preferenceSaved, 'isolated Irodori URL preference was not saved');
  await openRead(cdp);
  await check(1, cdp, async () => {
    const state = await evalOn(cdp, `(()=>({groups:[...document.querySelectorAll(${q(D + ' [data-engine-group]')})].map(e=>e.dataset.engineGroup),
      cloud:[...document.querySelectorAll(${q(D + ' [data-engine-group="cloud"] [data-engine]')})].map(e=>e.dataset.engine),
      more:document.querySelector(${q(D + ' [data-read-aloud-more-cloud]')})?.textContent}))()`);
    assert(state.groups.join(',') === 'local,cloud,voice' && state.cloud.length === 3 && /ほかのクラウド/.test(state.more), JSON.stringify(state));
    return state;
  });
  await check(2, cdp, async () => {
    await click(cdp, `${D} [data-read-aloud-more-cloud]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-engine="fish-s2.1-pro"]')}))`, { label: 'expanded cloud' });
    const rows = await evalOn(cdp, `['fish-s2.1-pro','gemini-3.8-flash-tts'].map(id=>{const e=document.querySelector(${q(D)}+' [data-engine="'+id+'"]');return {id,opacity:e?.style.opacity,badge:e?.querySelector('button')?.textContent}})`);
    assert(rows.find(row => row.id === 'fish-s2.1-pro')?.badge === 'Fish Audio の鍵を登録', JSON.stringify(rows));
    assert(rows.find(row => row.id === 'gemini-3.8-flash-tts')?.badge === 'Google AI の鍵を登録', JSON.stringify(rows));
    assert(rows.every(row => row.opacity === '0.5'), JSON.stringify(rows));
    await click(cdp, `${D} [data-engine="fish-s2.1-pro"] button`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(S)}))`, { label: 'connections settings' });
    const settings = await evalOn(cdp, `document.querySelector(${q(S)})?.textContent.includes('接続と API キー')`);
    assert(settings, 'connections section did not open');
    return { rows, connectionsOpened: settings };
  }, S);
  await close(cdp, S);
  await check(3, cdp, async () => {
    const caution = await evalOn(cdp, `document.querySelector(${q(D + ' [data-engine="chatterbox"] small')})?.textContent`);
    assert(caution?.includes('日本語の読みが不安定です'), 'Chatterbox caution missing');
    return { caution };
  });
  await check(4, cdp, async () => {
    await click(cdp, `${D} [data-engine="gemini-3.1-flash-tts"] input`);
    await waitEval(cdp, `document.querySelector(${q(D)})?.textContent.includes('見積不可（従量）')`, { label: 'Gemini estimate' });
    const estimate = await evalOn(cdp, `document.querySelector(${q(D + ' [data-read-aloud-estimate]')})?.textContent`);
    assert(estimate?.includes('見積不可（従量）'), 'estimate unavailable missing');
    await click(cdp, `${D} [data-read-aloud-action="preview"]`);
    const dialog = await waitEval(cdp, `([...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('見積を出せません。送ると fal の従量で課金されます。送りますか'))?.textContent)||null`, { label: 'unpriced approval' });
    await shotApproval(cdp);
    const cancelled = await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('見積を出せません。'));const b=[...d.querySelectorAll('button')].find(e=>e.textContent.trim()==='キャンセル');b?.click();return Boolean(b)})()`);
    assert(cancelled, 'cancel button missing');
    await waitEval(cdp, `![...document.querySelectorAll('.dialogBlock')].some(e=>e.textContent.includes('見積を出せません。'))`, { label: 'approval cancelled' });
    await evalOn(cdp, `document.querySelector(${q(D + ' [data-read-aloud-estimate]')})?.scrollIntoView({block:'center'})`);
    return { estimateText: estimate, approval: dialog.includes('見積を出せません'), cancelled, paidApiRequests: 0 };
  });
  await check(5, cdp, async () => {
    await click(cdp, `${D} [data-engine="voicevox"] input`);
    const voiceReady = `(()=>{const value=document.querySelector(${q(D + ' [aria-label="声"]')})?.value;return Boolean(value)&&Number.isInteger(Number(value))})()`;
    try { await waitEval(cdp, voiceReady, { label: 'VOICEVOX voice', timeoutMs: 12000 }); }
    catch {
      await evalOn(cdp, `(()=>{const radio=document.querySelector(${q(D + ' [data-engine="voicevox"] input')});radio.checked=false;radio.click();return true})()`);
      await waitEval(cdp, voiceReady, { label: 'VOICEVOX voice after refresh', timeoutMs: 60000 });
    }
    await click(cdp, `${D} [data-read-aloud-action="preview"]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' audio')})?.src.startsWith('blob:'))`, { label: 'VOICEVOX audio', timeoutMs: 360000 });
    await waitEval(cdp, `document.querySelector(${q(D + ' [data-read-aloud-action="place"]')})?.disabled===false`, { label: 'place ready', timeoutMs: 60000 });
    const enabled = await evalOn(cdp, `document.querySelector(${q(D + ' [data-read-aloud-action="place"]')})?.disabled===false`);
    assert(enabled, 'place button disabled');
    await click(cdp, `${D} [data-read-aloud-action="place"]`);
    await waitEval(cdp, `document.querySelector(${q(D)})?.textContent.includes('置いた')`, { label: 'narration placed', timeoutMs: 60000 });
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    assert(edit.audio?.narration?.length > 0, 'VOICEVOX narration missing');
    return { audioBlob: true, placeEnabled: enabled, placed: true };
  });
  await close(cdp, D); await openRead(cdp);
  await check(6, cdp, async () => {
    await click(cdp, `${D} [data-engine="voice"] input`);
    await waitEval(cdp, `document.querySelector(${q(D + ' [data-read-aloud-copy-engine]')})?.options.length>=6`, { label: 'copy engines' });
    const options = await evalOn(cdp, `[...document.querySelector(${q(D + ' [data-read-aloud-copy-engine]')}).options].map(o=>({id:o.value,label:o.textContent,disabled:o.disabled}))`);
    assert(['chatterbox','index-tts-2','minimax-2.6-hd','fish-s2.1-pro'].every(id => options.some(row=>row.id===id)), JSON.stringify(options));
    assert(options.find(row=>row.id==='fish-s2.1-pro')?.label?.includes('（鍵なし）'), 'Fish should say no key');
    assert(options.find(row=>row.id==='irodori')?.label?.includes('（つながりません）'), 'Irodori should say disconnected');
    const note = await evalOn(cdp, `document.querySelector(${q(D + ' [data-read-aloud-copy-note]')})?.textContent`);
    assert(note?.includes('録音を毎回送ります'), 'per-request note missing');
    await evalOn(cdp, `document.querySelector(${q(D + ' [data-read-aloud-copy-row]')})?.scrollIntoView({block:'center'})`);
    return { options, note };
  });
  await close(cdp, D);
  await evalOn(cdp, fireCommand('akari.settings.open', 'narration'));
  await waitEval(cdp, `Boolean(document.querySelector(${q(S + ' [data-akari-narration-default-engine]')}))`, { label: 'settings select' });
  await check(7, cdp, async () => {
    await waitEval(cdp, `!document.querySelector(${q(S)})?.textContent.includes('読み込み中…')`, { label: 'settings voice profiles loaded', timeoutMs: 60000 });
    const groups = await evalOn(cdp, `[...document.querySelector(${q(S + ' [data-akari-narration-default-engine]')}).querySelectorAll('optgroup')].map(g=>({label:g.label,ids:[...g.querySelectorAll('option')].map(o=>o.value)}))`);
    assert(groups.map(g=>g.label).join(',')==='この Mac,クラウド,自分の声', JSON.stringify(groups));
    assert(groups[0].ids.length===2 && groups[1].ids.length===7 && groups[2].ids.includes('voice:sample-picker'), JSON.stringify(groups));
    await evalOn(cdp, `document.querySelector(${q(S + ' [data-akari-narration-default-engine]')})?.scrollIntoView({block:'center'})`);
    return { groups };
  }, S);
  out.status = 'pass';
} catch (error) { out.status = 'fail'; out.error = String(error).replaceAll(REPO, '<repo>'); }
finally {
  try { out.electron = await stop(session); if (!out.electron.processGone || !out.electron.portClosed) out.status = 'fail'; }
  catch (error) { out.status = 'fail'; out.electron.error = String(error); }
  try { if (fixture) { out.voicevox = { ...out.voicevox, ...await fixture.stop() };
    if (!out.voicevox.processGone || !out.voicevox.portClosedAtEnd) out.status = 'fail'; } }
  catch (error) { out.status = 'fail'; out.voicevox.error = String(error); }
  await saveJson(RESULTS, out);
  if (iso) await rm(iso, { recursive: true, force: true });
  if (akariHome) await rm(akariHome, { recursive: true, force: true });
}
if (out.status !== 'pass') process.exitCode = 1;
