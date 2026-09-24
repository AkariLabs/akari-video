#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, screenshot } from '../../voice-clone-wizard/scripts/cdp-lib.mjs';
import { launch, stop, fireCommand, sanitize, saveJson, sleep, waitEval } from '../../voice-clone-wizard/scripts/l1-lib.mjs';
import { makeVoicevoxFixture } from '../../voice-clone-wizard/scripts/voicevox-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const D = '[data-akari-voice-clone-dialog]';
const q = JSON.stringify;
const names = [
  'ウィザードで Gemini 3.8 を選べる',
  '選択後に固定の日本語同意文が出る',
  '同意録音をこの PC で照合できる',
  '次へで費用承認を表示しキャンセルできる',
  '設定の写しを足すでも同意の段が出る',
];
const out = { status: 'running', executedAt: new Date().toISOString(),
  checks: names.map(name => ({ name, pass: false })), cdp: {}, voicevox: {}, network: { postVoices: null, guardInstalled: false } };
let iso, session, fixture;
const assert = (value, message) => { if (!value) throw new Error(message); };
const click = (cdp, selector) => evalOn(cdp, `document.querySelector(${q(selector)})?.click()`);
function listenerPids(port) {
  const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (![0, 1].includes(result.status)) throw new Error('lsof failed');
  return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}
function choosePort() {
  for (let port = 19731; port <= 19740; port++) if (!listenerPids(port).length) return port;
  throw new Error('CDP ポートが空いていません');
}
async function upload(cdp, selector, file) {
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert(nodeId, `${selector} missing`);
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId });
}
async function check(i, cdp, fn) {
  try {
    out.checks[i - 1].measured = await fn(); out.checks[i - 1].pass = true;
    await screenshot(cdp, path.join(ROOT, `${String(i).padStart(2, '0')}.png`));
  } catch (error) { out.checks[i - 1].error = sanitize(error, REPO); }
  await saveJson(path.join(ROOT, 'results-l1.json'), out);
  if (!out.checks[i - 1].pass) throw new Error(`${names[i - 1]} failed`);
}
async function synth(port, text, output) {
  const base = `http://127.0.0.1:${port}`;
  const query = await fetch(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=1`, { method: 'POST' });
  assert(query.ok, 'VOICEVOX audio_query failed');
  const payload = await query.json(); payload.volumeScale = 0.5;
  const response = await fetch(`${base}/synthesis?speaker=1`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert(response.ok, 'VOICEVOX synthesis failed');
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
}
try {
  process.env.GEMINI_API_KEY = 'dummy-never-send';
  delete process.env.FAL_KEY;
  delete process.env.FISH_AUDIO_API_KEY;
  iso = await mkdtemp(path.join(os.tmpdir(), 'akari-gemini-voice-l1-'));
  const home = path.join(iso, 'home'), project = path.join(iso, 'project');
  const source = path.join(iso, 'source.wav'), consent = path.join(iso, 'consent.wav');
  const networkLog = path.join(iso, 'network.jsonl');
  await mkdir(project, { recursive: true }); await writeFile(path.join(project, 'README.md'), '# L1 project\n');
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'credentials.env'), 'GEMINI_API_KEY=dummy-never-send\n', { mode: 0o600 });
  const avatar = path.join(home, '.akari/avatars/sample');
  await mkdir(avatar, { recursive: true });
  await writeFile(path.join(avatar, 'avatar.json'), JSON.stringify({ version: 0, id: 'sample', display_name: 'サンプル',
    variants: [], persona: { first_person: '私', tone: '静か', speech_style: '自然', verbal_tics: [], energy: 50,
      ng: [], default_role: 'narrator' }, voice: { lane: 'recorded', ref: 'profile:sample', credit: null },
    renditions: [], default_rendition: null,
    rights: { subject: 'person', consent: 'self', credit_required: false, distribution: 'private' } }));
  fixture = await makeVoicevoxFixture({ shell: SHELL, home, output: source });
  out.voicevox = { engine: fixture.engine, port: fixture.port, pid: fixture.pid };
  await synth(fixture.port, '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。', consent);
  const probe = spawnSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', source], { encoding: 'utf8' });
  const duration = Number(probe.stdout.trim()); assert(duration >= 10 && duration <= 30, `source duration ${duration}`);
  const seeded = path.join(avatar, 'voice', 'seed'); await mkdir(seeded, { recursive: true });
  await writeFile(path.join(seeded, 'ref-recording.wav'), await readFile(source));
  await writeFile(path.join(seeded, 'meta.json'), JSON.stringify({ version: 2, profile: 'seed', avatar: 'sample', label: 'サンプルの声',
    created_at: new Date().toISOString(), consent: { self_voice: true, cloud_upload: true },
    reference: { file: 'ref-recording.wav', duration_s: duration, verification: { score: 0.95, backend: 'speech-analyzer' } },
    reference_text: fixture.text, engines: {} }));
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${path.join(ROOT, 'scripts/network-guard.cjs')}`.trim();
  process.env.AKARI_GEMINI_NETWORK_LOG = networkLog;
  const port = choosePort();
  session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port,
    isoDir: path.join(iso, 'electron'), homeDir: home, fakeWav: consent });
  out.cdp = { port, launchedPid: session.pid, connectedPid: session.cdpOwnerPid, pidMatched: session.pidMatched };
  assert(session.pidMatched, 'CDP PID mismatch');
  const cdp = session.cdp;
  await evalOn(cdp, fireCommand('akari.voice.create'));
  await waitEval(cdp, `Boolean(document.querySelector(${q(D)}))`, { label: 'voice dialog' });
  await click(cdp, `${D} [data-voice-consent-self]`);
  await click(cdp, `${D} [data-voice-consent-cloud]`);
  await click(cdp, `${D} [data-voice-next]`);
  await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-record]')}))`, { label: 'record step' });
  await upload(cdp, `${D} input[type=file]`, source);
  await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-next]')})?.disabled === false`, { label: 'source upload' });
  await click(cdp, `${D} [data-voice-next]`);
  await waitEval(cdp, `document.querySelectorAll(${q(D + ' [data-voice-check]')}).length === 4`, { label: 'source check', timeoutMs: 360_000 });
  await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-next]')})?.disabled === false`, { label: 'source accepted' });
  await click(cdp, `${D} [data-voice-next]`);
  await check(1, cdp, async () => {
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-engine="gemini-3.8-flash-tts"]')}))`, { label: 'Gemini card' });
    const card = await evalOn(cdp, `(()=>{const e=document.querySelector(${q(D + ' [data-voice-engine="gemini-3.8-flash-tts"]')});return{disabled:e?.querySelector('input')?.disabled,checked:e?.querySelector('input')?.checked,watermark:e?.textContent.includes('写しには Google の透かしが入ります')}})()`);
    assert(card.disabled === false && card.watermark, 'Gemini card disabled or watermark missing'); return card;
  });
  await click(cdp, `${D} [data-voice-engine="gemini-3.8-flash-tts"] input`);
  await click(cdp, `${D} [data-voice-next]`);
  await check(2, cdp, async () => {
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [data-voice-script="consent-gemini"]')}))`, { label: 'consent step' });
    const text = await evalOn(cdp, `document.querySelector(${q(D + ' [data-voice-script="consent-gemini"]')})?.textContent`);
    const watermark = await evalOn(cdp, `document.querySelector(${q(D + ' [data-gemini-watermark]')})?.textContent`);
    assert(text === '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。' &&
      watermark === '写しには Google の透かしが入ります', 'consent phrase or watermark');
    return { text, watermark };
  });
  await click(cdp, `${D} [data-voice-record]`);
  await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-record]')})?.textContent.includes('止める')`, { label: 'consent recording' });
  await sleep(10400);
  await click(cdp, `${D} [data-voice-record]`);
  await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-next]')})?.disabled === false`, { label: 'consent recorded' });
  await click(cdp, `${D} [data-voice-next]`);
  await check(3, cdp, async () => {
    await waitEval(cdp, `(()=>{const text=document.querySelector(${q(D)})?.textContent??'';return text.includes('同意文との一致')||text.includes('聞き取りができない')||text.includes('声を操作できません')})()`,
      { label: 'consent check', timeoutMs: 360_000 });
    const state = await evalOn(cdp, `(()=>{const d=document.querySelector(${q(D)});return{text:d?.textContent,disabled:d?.querySelector('[data-voice-next]')?.disabled}})()`);
    assert(state.text.includes('✓ 同意文との一致') && !state.disabled, `consent check failed: ${state.text.slice(-250)}`);
    return { match: state.text.match(/同意文との一致 \d+%/)?.[0], nextEnabled: !state.disabled };
  });
  await click(cdp, `${D} [data-voice-next]`);
  await check(4, cdp, async () => {
    await waitEval(cdp, `[...document.querySelectorAll('.dialogBlock')].some(e=>e.textContent.includes('声づくりの料金は見積不可'))`, { label: 'cost approval' });
    const content = await evalOn(cdp, `[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('声づくりの料金は見積不可'))?.textContent`);
    assert(content.includes('Google'), 'Google approval missing');
    await screenshot(cdp, path.join(ROOT, '04-approval.png'));
    await evalOn(cdp, `[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('声づくりの料金は見積不可'))?.querySelector('.dialogControl button.secondary')?.click()`);
    await waitEval(cdp, `![...document.querySelectorAll('.dialogBlock')].some(e=>e.textContent.includes('声づくりの料金は見積不可'))`, { label: 'approval cancelled' });
    return { approval: true, cancelled: true };
  });
  await click(cdp, `${D} .closeButton`);
  await evalOn(cdp, fireCommand('akari.settings.open', 'narration'));
  await check(5, cdp, async () => {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-voice-action="copy-gemini"]'))`, { label: 'settings Gemini action' });
    await click(cdp, '[data-akari-voice-action="copy-gemini"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-gemini-consent]'))`, { label: 'settings consent' });
    const text = await evalOn(cdp, `document.querySelector('[data-akari-gemini-consent] [data-gemini-consent-script]')?.textContent`);
    const watermark = await evalOn(cdp, `document.querySelector('[data-akari-gemini-consent] [data-gemini-watermark]')?.textContent`);
    assert(text?.includes('Googleがこの音声を使用') && watermark === '写しには Google の透かしが入ります', 'settings consent phrase or watermark missing');
    return { text, watermark, dialog: true };
  });
  await evalOn(cdp, `[...document.querySelectorAll('[data-akari-gemini-consent] button')].find(e=>e.textContent==='キャンセル')?.click()`);
  out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
} catch (error) { out.status = 'fail'; out.error = sanitize(error, REPO); }
finally {
  try { out.electron = await stop(session); } catch (error) { out.cleanupError = sanitize(error, REPO); out.status = 'fail'; }
  try { if (fixture) out.voicevox = { ...out.voicevox, ...await fixture.stop() }; }
  catch (error) { out.cleanupError = sanitize(error, REPO); out.status = 'fail'; }
  if (iso) {
    const lines = (await readFile(path.join(iso, 'network.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return {}; } });
    out.network = { postVoices: lines.filter(line => line.kind === 'blocked-post').length,
      guardInstalled: lines.some(line => line.kind === 'installed'), observedProcesses: lines.filter(line => line.kind === 'installed').length };
    if (out.network.postVoices !== 0 || !out.network.guardInstalled) out.status = 'fail';
  }
  await saveJson(path.join(ROOT, 'results-l1.json'), out);
}
if (out.status !== 'pass') process.exitCode = 1;
