#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { launch, stop, fireCommand, sanitize, saveJson, sleep, waitEval } from './l1-lib.mjs';
import { makeVoicevoxFixture } from './voicevox-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CLI = path.join(REPO, 'packages/akari-launcher/bin/akari.mjs');
const RESULTS = path.join(ROOT, 'results-l1.json');
const D = '[data-akari-read-aloud-dialog]';
const V = '[data-akari-voice-clone-dialog]';
const S = '[data-akari-settings-dialog]';
const q = JSON.stringify;
const names = [
  '読み上げ 4 枚目に自分の声と新・旧 2 声',
  '新しい声を試聴・置く・voice ID と provenance',
  '旧い owner-ja は鍵なしで生成不可',
  '設定の自分の声 2 行と旧い場所ピル',
  '名前変更が設定とポップアップに反映',
  '旧い声の移行は新旧を残し旧い場所ピルを外す',
  '新しい声を消すと正本が消え偽彩に DELETE',
  'ウィザード保存先は一時 AKARI_HOME の実パス'
];
const out = { status: 'running', executedAt: new Date().toISOString(),
  cdp: { port: null, launchedPid: null, connectedPid: null, pidMatched: false },
  electron: { processGone: null, portClosed: null },
  voicevox: { engine: 'headless', processGone: null, portClosedAtEnd: null },
  fakeIrodori: { pid: null, processGone: null, portClosed: null },
  checks: names.map(name => ({ name, pass: false, measured: null })) };
const assert = (value, message) => { if (!value) throw new Error(message); };
let iso, akariHome, fixture, fake, session;
function pids(port) {
  const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (![0, 1].includes(result.status)) throw new Error('port inspection failed');
  return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}
async function choosePort() { for (let port = 19691; port <= 19700; port++) if (!pids(port).length) return port; throw new Error('CDP port unavailable'); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function stopFake() {
  if (!fake) return { processGone: true, portClosed: true };
  fake.child.kill('SIGTERM');
  for (let i = 0; i < 50 && alive(fake.child.pid); i++) await sleep(200);
  if (alive(fake.child.pid)) fake.child.kill('SIGKILL');
  for (let i = 0; i < 25 && alive(fake.child.pid); i++) await sleep(200);
  return { processGone: !alive(fake.child.pid), portClosed: pids(fake.port).length === 0 };
}
async function requests() { const text = await readFile(fake.log, 'utf8').catch(() => ''); return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
async function startFake(home, akariRoot) {
  const portFile = path.join(home, 'fake-port'), log = path.join(home, 'fake-requests.jsonl');
  await writeFile(log, '');
  const env = { ...process.env, HOME: home, AKARI_HOME: akariRoot, AKARI_CREDENTIALS_FILE: path.join(home, 'credentials.env') };
  delete env.FAL_KEY;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/fake-irodori.mjs'), portFile, log], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    const port = Number(await readFile(portFile, 'utf8').catch(() => ''));
    if (port) return { child, port, url: `http://127.0.0.1:${port}`, log };
    await sleep(100);
  }
  child.kill('SIGTERM'); throw new Error('fake server did not start');
}
async function shot(cdp, number) {
  if (number >= 4 && number <= 7) {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-group="自分の声"]')) &&
      !document.querySelector('[data-akari-settings-group="エンジン"]')?.textContent.includes('確認中…')`,
      { label: 'voice settings settled', timeoutMs: 60000 });
    await evalOn(cdp, `document.querySelector('[data-akari-settings-group="自分の声"]')?.scrollIntoView({block:'center'})`);
    await sleep(150);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const clip = await evalOn(cdp, `(()=>{const e=document.querySelector('.dialogBlock');if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
  assert(clip, 'dialog crop missing');
  const cropped = spawnSync('magick', ['png:-', '-crop', `${clip.width}x${clip.height}+${clip.x}+${clip.y}`, '+repage', 'png:-'],
    { input: Buffer.from(data, 'base64'), maxBuffer: 10_000_000 });
  if (cropped.status !== 0) throw new Error('screenshot crop failed');
  await writeFile(path.join(ROOT, `${String(number).padStart(2, '0')}.png`), cropped.stdout);
}
async function check(number, cdp, fn) {
  const started = Date.now();
  try { out.checks[number - 1].measured = await fn(); out.checks[number - 1].pass = true; }
  catch (error) { out.checks[number - 1].measured = { error: sanitize(error, REPO) }; }
  try { await shot(cdp, number); }
  catch (error) { out.checks[number - 1].screenshotError = sanitize(error, REPO); out.checks[number - 1].pass = false; }
  out.checks[number - 1].seconds = Number(((Date.now() - started) / 1000).toFixed(2));
  await saveJson(RESULTS, out);
  if (!out.checks[number - 1].pass) throw new Error(`check ${number} failed`);
}
async function click(cdp, selector) { await evalOn(cdp, `document.querySelector(${q(selector)})?.click()`); }
async function close(cdp, selector) {
  if (await evalOn(cdp, `Boolean(document.querySelector(${q(selector)}))`)) {
    await click(cdp, `${selector} .closeButton`);
    await waitEval(cdp, `!document.querySelector(${q(selector)})`, { label: 'close dialog' });
  }
}
async function confirm(cdp, label) {
  await waitEval(cdp, `document.querySelector('[data-akari-voice-confirmation]')?.textContent.includes(${q(label)})`, { label: 'confirmation' });
  const clicked = await evalOn(cdp, `(()=>{const button=document.querySelector('[data-akari-voice-confirmation] [data-akari-voice-confirm]');
    if(button?.textContent?.trim()!==${q(label)})return false;button.click();return true})()`);
  assert(clicked, 'confirmation button missing');
  await waitEval(cdp, `!document.querySelector('[data-akari-voice-confirmation]')`, { label: 'confirmation closed', timeoutMs: 30000 });
}
async function openRead(cdp) {
  await evalOn(cdp, fireCommand('akari.caption.readAloud', { captionIds: ['c-0001'] }));
  await waitEval(cdp, `Boolean(document.querySelector(${q(D)}))`, { label: 'read aloud dialog' });
  await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' [aria-label="自分の声"] option[value="sample-narration"]')}))`,
    { label: 'voice profile options' });
}
async function openSettings(cdp) {
  await evalOn(cdp, fireCommand('akari.settings.open', 'narration'));
  await waitEval(cdp, `Boolean(document.querySelector(${q(S + ' [data-akari-voice-action="create"]')}))`, { label: 'voice settings' });
}
async function setValue(cdp, selector, value) {
  await evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});e.value=${q(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function upload(cdp, file) {
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `${V} input[type=file]` });
  assert(nodeId, 'file input missing');
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId });
  await waitEval(cdp, `document.querySelector(${q(V + ' [data-voice-next]')})?.disabled === false`, { label: 'file accepted' });
}
function runVoice(env, args) {
  const result = spawnSync(process.execPath, [CLI, 'voice', ...args, '--json'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 360000 });
  if (result.status !== 0) throw new Error(`voice ${args[0]} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim());
}
try {
  iso = await mkdtemp(path.join(os.tmpdir(), 'akari-voice-wiring-l1-'));
  akariHome = await mkdtemp(path.join(os.tmpdir(), 'akari-voice-home-l1-'));
  const home = path.join(iso, 'home'), wav = path.join(iso, 'voicevox.wav');
  const env = { ...process.env, HOME: home, AKARI_HOME: akariHome, AKARI_CREDENTIALS_FILE: path.join(home, 'credentials.env') };
  delete env.FAL_KEY;
  await mkdir(home, { recursive: true });
  const generated = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs'), path.join(iso, 'fixture')], { env, encoding: 'utf8', timeout: 240000 });
  if (generated.status !== 0) throw new Error(`project fixture failed: ${generated.stderr}`);
  const project = path.join(iso, 'fixture', 'spoken');
  const avatarDir = path.join(akariHome, 'avatars', 'sample');
  await mkdir(avatarDir, { recursive: true });
  await writeFile(path.join(avatarDir, 'avatar.json'), JSON.stringify({ version: 0, id: 'sample', display_name: 'サンプル',
    variants: [], persona: { first_person: '私', tone: '静か', speech_style: '自然', verbal_tics: [], energy: 50,
      ng: [], default_role: 'narrator' }, renditions: [], default_rendition: null,
    rights: { subject: 'person', consent: 'self', credit_required: false, distribution: 'private' } }));
  fixture = await makeVoicevoxFixture({ shell: SHELL, home, akariHome, output: wav });
  out.voicevox = { ...out.voicevox, port: fixture.port, pid: fixture.pid, startedByScript: fixture.startedByScript };
  fake = await startFake(home, akariHome); out.fakeIrodori.pid = fake.child.pid; out.fakeIrodori.port = fake.port;
  const created = runVoice(env, ['create', '--avatar', 'sample', '--id', 'sample-narration', '--label', 'サンプルの声',
    '--audio', wav, '--script', 'quick-v1', '--consent-self']);
  assert(created.profile === 'sample-narration', 'voice create result');
  runVoice(env, ['copy', '--profile', created.profile, '--engine', 'irodori', '--irodori-url', fake.url]);
  const legacyDir = path.join(home, '.config/akari-video/voice-profiles/owner-ja');
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, 'ref-recording.wav'), await readFile(wav));
  await writeFile(path.join(legacyDir, 'meta.json'), JSON.stringify({ profile: 'owner-ja', label: 'owner-ja',
    created_at: '2026-07-20T00:00:00Z', consent: '本人の声', provider: 'fal-qwen3',
    embedding_source_url: 'https://example.invalid/embedding', reference: { file: 'ref-recording.wav', duration_s: 67 } }));
  const port = await choosePort();
  session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port,
    isoDir: path.join(iso, 'electron'), homeDir: home, akariHome, fakeWav: wav });
  out.cdp = { port, launchedPid: session.pid, connectedPid: session.cdpOwnerPid, pidMatched: session.pidMatched };
  assert(session.pidMatched, 'CDP PID differs from launched Electron');
  const cdp = session.cdp;
  await openSettings(cdp);
  await setValue(cdp, '[data-akari-irodori-url]', fake.url);
  await click(cdp, '[data-akari-narration-action="save-irodori-url"]');
  await waitEval(cdp, `document.querySelector('[data-akari-narration-engine="irodori"]')?.textContent.includes('接続済み')`,
    { label: 'saved Irodori URL connected', timeoutMs: 60000 });
  await close(cdp, S);
  await check(1, cdp, async () => {
    await openRead(cdp);
    await waitEval(cdp, `document.querySelectorAll(${q(D + ' [data-engine]')}).length===4 && document.querySelectorAll(${q(D + ' [aria-label="自分の声"] option')}).length===3`, { label: 'voice cards and profiles' });
    const cards = await evalOn(cdp, `document.querySelectorAll(${q(D + ' [data-engine]')}).length`);
    const options = await evalOn(cdp, `[...document.querySelectorAll(${q(D + ' [aria-label="自分の声"] option')})].map(e=>e.value)`);
    assert(cards === 4 && options[0] === 'sample-narration' && options.includes('owner-ja') && options.includes('__create__'), 'voice card/options/default order');
    return { cards, options, defaultFirst: options[0] === 'sample-narration' };
  });
  await check(2, cdp, async () => {
    await click(cdp, `${D} [data-engine="voice"] input[type=radio]`);
    await setValue(cdp, `${D} [aria-label="自分の声"]`, 'sample-narration');
    await waitEval(cdp, `!document.querySelector(${q(D + ' [data-read-aloud-action="preview"]')})?.disabled`, { label: 'profile available' });
    await setValue(cdp, `${D} [aria-label="読み原稿"]`, 'こんにちは。今日は新しい機能を紹介します。');
    await click(cdp, `${D} [data-read-aloud-action="preview"]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(D + ' audio')})?.src.startsWith('blob:'))`, { label: 'preview audio', timeoutMs: 360000 });
    const sent = (await requests()).find(item => item.kind === 'try' && item.voice === 'akari-sample-narration');
    assert(sent, 'voice ID not sent');
    await waitEval(cdp, `document.querySelector(${q(D + ' [data-read-aloud-action="place"]')})?.disabled===false`, { label: 'place ready' });
    await click(cdp, `${D} [data-read-aloud-action="place"]`);
    await waitEval(cdp, `document.querySelector(${q(D)})?.textContent.includes('置いた')`, { label: 'narration placed', timeoutMs: 30000 });
    const resultText = await evalOn(cdp, `document.querySelector(${q(D)})?.textContent`);
    assert(resultText.includes('provenance: 自分の声（サンプルの声）'), 'result provenance label');
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    const narration = edit.audio?.narration?.at(-1);
    assert(narration?.provenance?.voice === 'profile:sample-narration', 'provenance');
    return { voice: sent.voice, provenance: narration.provenance.voice, resultLabel: '自分の声（サンプルの声）', placeClicks: 1 };
  });
  await close(cdp, D);
  await check(3, cdp, async () => {
    await openRead(cdp);
    await click(cdp, `${D} [data-engine="voice"] input[type=radio]`);
    await setValue(cdp, `${D} [aria-label="自分の声"]`, 'owner-ja');
    await waitEval(cdp, `document.querySelector(${q(D + ' [data-voice-copy-badge]')})?.textContent.includes('写しがありません') &&
      document.querySelector(${q(D + ' [data-read-aloud-action="preview"]')})?.disabled===true`,
      { label: 'legacy copy badge' });
    const state = await evalOn(cdp, `(()=>({badge:document.querySelector(${q(D + ' [data-voice-copy-badge]')})?.textContent,
      disabled:document.querySelector(${q(D + ' [data-read-aloud-action="preview"]')})?.disabled}))()`);
    assert(state.badge.includes('写しがありません') && state.disabled, `legacy generated without key: ${JSON.stringify(state)}`);
    return state;
  });
  await close(cdp, D);
  await check(4, cdp, async () => {
    await openSettings(cdp);
    await waitEval(cdp, `document.querySelectorAll('[data-akari-voice-profile]').length===2`, { label: 'two settings profiles' });
    const rows = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-voice-profile]')].map(e=>({id:e.dataset.akariVoiceProfile,text:e.textContent}))`);
    assert(rows.find(row => row.id === 'owner-ja')?.text.includes('旧い場所'), 'legacy pill');
    const defaultLabel = await evalOn(cdp, `document.querySelector(${q(S + ' .akari-set-dropdown-button[aria-label="既定のエンジン"]')})?.textContent`);
    assert(defaultLabel?.includes('サンプルの声') && !defaultLabel.includes('owner-ja'), 'unusable legacy became default');
    return { rows: rows.map(row => ({ id: row.id, legacy: row.text.includes('旧い場所') })), defaultLabel };
  });
  await check(5, cdp, async () => {
    await setValue(cdp, '[data-akari-voice-profile="sample-narration"] input[aria-label]', '名前を変えた声');
    await click(cdp, '[data-akari-voice-profile="sample-narration"] [data-akari-voice-action="rename"]');
    await waitEval(cdp, `document.querySelector('[data-akari-voice-profile="sample-narration"]')?.textContent.includes('名前を変えた声')`, { label: 'renamed settings' });
    const settingsLabel = await evalOn(cdp, `document.querySelector('[data-akari-voice-profile="sample-narration"] .akari-set-row-label')?.textContent`);
    await close(cdp, S); await openRead(cdp);
    const popupLabel = await evalOn(cdp, `document.querySelector(${q(D + ' [aria-label="自分の声"] option[value="sample-narration"]')})?.textContent`);
    assert(settingsLabel === '名前を変えた声' && popupLabel.includes('名前を変えた声'), 'renamed popup');
    await close(cdp, D); await openSettings(cdp);
    await waitEval(cdp, `document.querySelector('[data-akari-voice-profile="sample-narration"] .akari-set-row-label')?.textContent==='名前を変えた声' &&
      !document.querySelector('[data-akari-settings-group="エンジン"]')?.textContent.includes('確認中…')`,
      { label: 'renamed voice settings loaded', timeoutMs: 60000 });
    return { settingsLabel, popupLabel, loadingComplete: true };
  });
  await check(6, cdp, async () => {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-voice-profile="owner-ja"] [data-akari-voice-action="migrate"]'))`,
      { label: 'migrate action ready' });
    await click(cdp, '[data-akari-voice-profile="owner-ja"] [data-akari-voice-action="migrate"]');
    await confirm(cdp, '移す');
    await waitEval(cdp, `document.querySelector('[data-akari-voice-profile="owner-ja"]')?.textContent.includes('旧い場所')===false`, { label: 'migrated row', timeoutMs: 60000 });
    await access(path.join(akariHome, 'avatars/sample/voice/owner-ja/meta.json'));
    await access(path.join(legacyDir, 'meta.json'));
    const rows = await evalOn(cdp, `document.querySelectorAll('[data-akari-voice-profile]').length`);
    const legacyPillGone = await evalOn(cdp, `!document.querySelector('[data-akari-voice-profile="owner-ja"]')?.textContent.includes('旧い場所')`);
    assert(rows === 2 && legacyPillGone, 'duplicate or legacy pill remains');
    return { newExists: true, oldExists: true, rows, legacyPillGone };
  });
  await check(7, cdp, async () => {
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-voice-profile="sample-narration"] [data-akari-voice-action="delete"]'))`,
      { label: 'delete action ready' });
    await click(cdp, '[data-akari-voice-profile="sample-narration"] [data-akari-voice-action="delete"]');
    await confirm(cdp, '消す');
    await waitEval(cdp, `!document.querySelector('[data-akari-voice-profile="sample-narration"]')`, { label: 'deleted row' });
    const dirs = await readdir(path.join(akariHome, 'avatars/sample/voice'), { withFileTypes: true });
    assert(!dirs.some(entry => entry.name === 'sample-narration'), 'profile directory remains');
    const deleted = (await requests()).some(item => item.kind === 'delete' && item.voice === 'akari-sample-narration');
    assert(deleted, 'fake server DELETE missing');
    return { profileGone: true, deleteRequest: deleted };
  });
  await check(8, cdp, async () => {
    await close(cdp, S);
    await evalOn(cdp, fireCommand('akari.voice.create'));
    await waitEval(cdp, `Boolean(document.querySelector(${q(V)}))`, { label: 'wizard' });
    await click(cdp, `${V} [data-voice-consent-self]`);
    await click(cdp, `${V} [data-voice-next]`);
    await upload(cdp, wav);
    await click(cdp, `${V} [data-voice-next]`);
    await waitEval(cdp, `document.querySelectorAll(${q(V + ' [data-voice-check]')}).length===4`, { label: 'wizard check', timeoutMs: 360000 });
    await click(cdp, `${V} [data-voice-next]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(V + ' [data-voice-engine="irodori"]')}))`, { label: 'wizard copy' });
    await click(cdp, `${V} [data-voice-next]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(V + ' [data-voice-compare="irodori"]')}))`, { label: 'wizard compare', timeoutMs: 360000 });
    await click(cdp, `${V} [data-voice-next]`);
    await waitEval(cdp, `Boolean(document.querySelector(${q(V + ' input[aria-label="名前"]')}))`, { label: 'wizard save' });
    const shown = await evalOn(cdp, `([...document.querySelectorAll(${q(V + ' div')})].find(e=>!e.children.length&&e.textContent?.startsWith('保存先: '))?.textContent??'').slice(5)`);
    const expected = `${path.join(akariHome, 'avatars', 'sample', 'voice', 'sample-narration')}${path.sep}`;
    const copyLabel = await evalOn(cdp, `document.querySelector(${q(V)})?.textContent.includes('彩（自分の PC）')`);
    assert(shown === expected && !shown.startsWith('~') && copyLabel, 'external AKARI_HOME display');
    return { exactPathMatch: true, outsideHome: !akariHome.startsWith(`${home}${path.sep}`),
      tildeOmitted: false, copyLabel: '彩（自分の PC）' };
  });
  await close(cdp, V);
  out.status = 'pass';
} catch (error) { out.status = 'fail'; out.error = sanitize(error, REPO); }
finally {
  const errors = [];
  try { out.electron = await stop(session); if (!out.electron.processGone || !out.electron.portClosed) out.status = 'fail'; }
  catch (error) { errors.push(`Electron: ${sanitize(error, REPO)}`); out.status = 'fail'; }
  try { out.fakeIrodori = { ...out.fakeIrodori, ...await stopFake() }; if (!out.fakeIrodori.processGone || !out.fakeIrodori.portClosed) out.status = 'fail'; }
  catch (error) { errors.push(`fake Irodori: ${sanitize(error, REPO)}`); out.status = 'fail'; }
  try { if (fixture) { const result = await fixture.stop(); out.voicevox = { ...out.voicevox, ...result };
    if (!result.processGone || !result.portClosedAtEnd) out.status = 'fail'; } }
  catch (error) { errors.push(`VOICEVOX: ${sanitize(error, REPO)}`); out.status = 'fail'; }
  if (errors.length) out.cleanupErrors = errors;
  await saveJson(RESULTS, out);
  if (iso) await rm(iso, { recursive: true, force: true });
  if (akariHome) await rm(akariHome, { recursive: true, force: true });
}
if (out.status !== 'pass') process.exitCode = 1;
