import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runNarrationCommand } from '../src/narration-command.mjs';
import { readInternalEdit, projectLegacyEdit } from '../../edit-store/lib/index.js';

test('彩: URL 優先順・声レシピ・自由 caption・速度・provenance と非音声エラー', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-irodori-'));
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.AKARI_IRODORI_URL;
  const oldTimeout = process.env.AKARI_IRODORI_TIMEOUT_MS;
  const calls = [];
  try {
    process.env.AKARI_IRODORI_URL = 'http://env.invalid:8088/';
    process.env.AKARI_IRODORI_TIMEOUT_MS = '12345';
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: async () => fakeWav(1) };
    };
    const run = async (...options) => {
      const output = collectLogs();
      const result = await runNarrationCommand(['generate', '--project', scratch, '--engine', 'irodori', '--text', 'こんにちは', '--json', ...options], output);
      return { result, json: JSON.parse(output.lines.at(-1)) };
    };
    let value = await run('--voice', 'bright-female', '--speed', '4');
    assert.equal(value.result.exitCode, 0);
    assert.equal(calls[0].url, 'http://env.invalid:8088/v1/audio/speech');
    assert.equal(calls[0].init.signal.reason, undefined);
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'irodori-tts', input: 'こんにちは', voice: 'none', response_format: 'wav',
      speed: 4, irodori: { caption: '明るく元気な若い女性の声。はきはきと楽しそうに話す。' } });
    assert.equal(value.json.provenance.voice, 'recipe:bright-female');
    assert.equal(value.json.provenance.server, 'env.invalid:8088');
    assert.equal(value.json.provenance.experimental, true);
    assert.equal(value.json.speed_applied, true);
    assert.equal(value.json.duration_s, 1);
    value = await run('--irodori-url', 'https://option.invalid:443/', '--voice', 'custom', '--style', '低く話す');
    assert.equal(value.result.exitCode, 0);
    assert.equal(calls[1].url, 'https://option.invalid/v1/audio/speech');
    assert.equal(JSON.parse(calls[1].init.body).irodori.caption, '低く話す');
    assert.equal(value.json.provenance.voice, 'caption:custom');
    value = await run('--irodori-url', 'http://proxy.invalid/tts/');
    assert.equal(value.result.exitCode, 0);
    assert.equal(calls[2].url, 'http://proxy.invalid/tts/v1/audio/speech');
    assert.equal(value.json.provenance.server, 'proxy.invalid:80');
    for (const url of ['file:///tmp/speech', 'http://user:pass@host.invalid', 'http://host.invalid/?secret=1']) {
      assert.equal((await run('--irodori-url', url)).result.exitCode, 2);
    }
    assert.equal((await run('--voice', 'custom')).result.exitCode, 2);
    process.env.AKARI_IRODORI_TIMEOUT_MS = 'bad';
    assert.equal((await run()).result.exitCode, 2);
    process.env.AKARI_IRODORI_TIMEOUT_MS = '20';
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    value = await run();
    assert.equal(value.result.exitCode, 1);
    assert.match(value.json.error, /接続できません/);
    process.env.AKARI_IRODORI_TIMEOUT_MS = '12345';
    globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from('{"error":"model unavailable"}') });
    value = await run();
    assert.equal(value.result.exitCode, 1);
    assert.match(value.json.error, /model unavailable/);
    delete process.env.AKARI_IRODORI_URL;
    const defaultOutput = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'irodori', '--text', 'こんにちは', '--dry-run', '--json'], defaultOutput)).exitCode, 0);
    assert.equal(JSON.parse(defaultOutput.lines[0]).request.endpoint, 'http://127.0.0.1:8088/v1/audio/speech');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.AKARI_IRODORI_URL; else process.env.AKARI_IRODORI_URL = oldUrl;
    if (oldTimeout === undefined) delete process.env.AKARI_IRODORI_TIMEOUT_MS; else process.env.AKARI_IRODORI_TIMEOUT_MS = oldTimeout;
    await rm(scratch, { recursive: true, force: true });
  }
});

test('彩 engines は health で available / unconfigured と network を返し、voices は固定 4 件', async () => {
  const oldFetch = globalThis.fetch;
  try {
    let healthy = true;
    globalThis.fetch = async url => ({ ok: String(url).includes('/health') && healthy, json: async () => '0.0.0' });
    const list = async url => {
      const output = collectLogs();
      assert.equal((await runNarrationCommand(['engines', '--json', '--irodori-url', url], output)).exitCode, 0);
      return JSON.parse(output.lines[0]).engines.find(row => row.id === 'irodori');
    };
    let row = await list('http://192.0.2.1:8088/');
    assert.equal(row.place, 'network'); assert.equal(row.availability.state, 'available');
    assert.equal(row.availability.detail.url, '192.0.2.1:8088');
    healthy = false; row = await list('http://127.0.0.1:8088');
    assert.equal(row.place, 'local'); assert.equal(row.availability.state, 'unconfigured');
    assert.match(row.availability.detail.setup_url, /Irodori-TTS-Server/);
    const output = collectLogs();
    assert.equal((await runNarrationCommand(['voices', '--engine', 'irodori', '--json'], output)).exitCode, 0);
    const voices = JSON.parse(output.lines[0]).voices;
    assert.deepEqual(voices.map(voice => voice.id), ['narrator-male', 'bright-female', 'slow-explainer', 'custom']);
    assert.equal(voices[0].default, true);
  } finally { globalThis.fetch = oldFetch; }
});

test('彩 URL が不正でも engines 全体は exit 0、彩だけ unconfigured・静的 voices は取得可', async () => {
  const oldUrl = process.env.AKARI_IRODORI_URL;
  const oldFetch = globalThis.fetch;
  try {
    process.env.AKARI_IRODORI_URL = 'not a URL';
    globalThis.fetch = async () => ({ ok: false, json: async () => '0.0.0' });
    for (const args of [['engines', '--json'], ['engines', '--json', '--irodori-url', 'file:///tmp/model']]) {
      const output = collectLogs();
      assert.equal((await runNarrationCommand(args, output)).exitCode, 0);
      const engines = JSON.parse(output.lines[0]).engines;
      assert.deepEqual(engines.map(row => row.id), ['voicevox', 'gemini-tts', 'irodori', 'fal-qwen3']);
      assert.equal(engines[2].availability.state, 'unconfigured');
      assert.match(engines[2].availability.label, /接続先 URL が正しくありません/);
      assert.match(engines[2].availability.detail.setup_url, /Irodori-TTS-Server/);
    }
    const output = collectLogs();
    assert.equal((await runNarrationCommand(['voices', '--engine', 'irodori', '--irodori-url', 'broken', '--json'], output)).exitCode, 0);
    assert.equal(JSON.parse(output.lines[0]).voices.length, 4);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.AKARI_IRODORI_URL; else process.env.AKARI_IRODORI_URL = oldUrl;
  }
});

function collectLogs() {
  const lines = [];
  const errors = [];
  return { log: (line) => lines.push(line), logError: (line) => errors.push(line), lines, errors };
}

test('akari narration --help: generate の使い方を表示して exit 0', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['--help'], output);
  assert.equal(result.exitCode, 0);
  assert.match(output.lines.join('\n'), /サブコマンド:/);
  assert.match(output.lines.join('\n'), /akari narration generate/);
});

test('akari narration generate: 不明な引数は exit 2', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['generate', '--unknown'], output);
  assert.equal(result.exitCode, 2);
  assert.match(output.errors.join('\n'), /不明な引数/);
});

test('akari narration: 不明なサブコマンドは従来どおり JSON エラーと exit 2', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['unknown'], output);
  assert.equal(result.exitCode, 2);
  assert.match(output.errors.join('\n'), /不明なサブコマンド/);
  assert.equal(JSON.parse(output.lines.at(-1)).error.includes('不明なサブコマンド'), true);
});

test('akari narration generate --dry-run: VOICEVOX を起動せず従来形式の JSON を返す', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-command-test-'));
  try {
    const readingFile = join(scratch, 'reading.txt');
    await writeFile(readingFile, 'テストです。', 'utf8');
    const output = collectLogs();
    const result = await runNarrationCommand([
      'generate', '--project', scratch, '--engine', 'voicevox',
      '--reading-file', readingFile, '--t', '1.5', '--dry-run'
    ], output);
    assert.equal(result.exitCode, 0);
    const json = JSON.parse(output.lines.at(-1));
    assert.equal(json.dry_run, true);
    assert.equal(json.engine, 'voicevox');
    assert.equal(json.output_path, 'out/narration/n-0001.wav');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

function fakeWav(seconds = 3) {
  const dataBytes = 24000 * 2 * seconds;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test('engines JSON: VOICEVOX の available / needs / unconfigured と fal 鍵状態', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-list-'));
  const priorFetch = globalThis.fetch;
  const priorRun = process.env.VOICEVOX_RUN;
  const priorCredentials = process.env.AKARI_CREDENTIALS_FILE;
  const priorFalKey = process.env.FAL_KEY;
  try {
    delete process.env.FAL_KEY;
    process.env.AKARI_CREDENTIALS_FILE = join(scratch, 'credentials.env');
    process.env.VOICEVOX_RUN = join(scratch, 'run');
    let up = false;
    globalThis.fetch = async () => ({ ok: up, json: async () => '0.25.2' });
    const get = async () => {
      const output = collectLogs();
      assert.equal((await runNarrationCommand(['engines', '--json'], { ...output,
        engineRuntime: { pidPath: join(scratch, 'voicevox.pid'), isProcessAlive: () => false,
          readProcessCommand: () => assert.fail('ps を呼ばない') } })).exitCode, 0);
      assert.equal(output.lines.length, 1);
      return JSON.parse(output.lines[0]);
    };
    let result = await get();
    assert.deepEqual(result.engines.map(engine => engine.id), ['voicevox', 'gemini-tts', 'irodori', 'fal-qwen3']);
    assert.equal(result.engines[0].availability.state, 'unconfigured');
    assert.deepEqual(result.engines[0].availability.detail.running, false);
    assert.deepEqual(result.engines[0].availability.detail.app_found, false);
    assert.equal(result.engines[1].availability.state, 'unconfigured');
    assert.equal(result.engines[2].availability.state, 'unconfigured');
    assert.equal(JSON.stringify(result).includes(scratch), false);
    await writeFile(process.env.VOICEVOX_RUN, '');
    await writeFile(process.env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=test-secret');
    result = await get();
    assert.equal(result.engines[0].availability.state, 'needs');
    assert.equal(result.engines[0].availability.detail.app_found, true);
    assert.equal(result.engines[1].availability.state, 'available');
    assert.equal(JSON.stringify(result).includes('test-secret'), false);
    up = true;
    result = await get();
    assert.equal(result.engines[0].availability.state, 'available');
    assert.equal(result.engines[0].availability.detail.version, '0.25.2');
  } finally {
    globalThis.fetch = priorFetch;
    if (priorRun === undefined) delete process.env.VOICEVOX_RUN; else process.env.VOICEVOX_RUN = priorRun;
    if (priorCredentials === undefined) delete process.env.AKARI_CREDENTIALS_FILE; else process.env.AKARI_CREDENTIALS_FILE = priorCredentials;
    if (priorFalKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = priorFalKey;
    await rm(scratch, { recursive: true, force: true });
  }
});

test('engines の fal availability は一時 HOME / AKARI_HOME の fal の写しだけを数える', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-fal-availability-'));
  const inspect = async (name, { fal = false, irodori = false, legacy = false, key = true, userProfileOnly = false } = {}) => {
    const root = join(scratch, name);
    const home = join(root, 'home');
    const akariHome = join(root, 'separate-akari-home');
    const env = { AKARI_CREDENTIALS_FILE: join(root, 'missing-credentials.env'),
      ...(userProfileOnly ? { USERPROFILE: home } : { HOME: home }),
      ...(!userProfileOnly ? { AKARI_HOME: akariHome } : {}),
      ...(key ? { FAL_KEY: 'test-only-key' } : {}) };
    if (fal || irodori) {
      const dir = join(userProfileOnly ? join(home, '.akari') : akariHome, 'avatars', 'person', 'voice', 'sample');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ version: 2, profile: 'sample',
        engines: { ...(fal ? { 'fal-qwen3': { embedding_source_url: 'https://example.invalid/embedding' } } : {}),
          ...(irodori ? { irodori: { voice_id: 'sample' } } : {}) } }));
    }
    if (legacy) {
      const dir = join(home, '.config', 'akari-video', 'voice-profiles', 'old');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ profile: 'old', embedding_source_url: 'https://example.invalid/old' }));
    }
    const output = collectLogs();
    const result = await runNarrationCommand(['engines', '--json'], { ...output,
      engineRuntime: { env, fetchImpl: async () => ({ ok: false }), pidPath: join(root, 'missing-voicevox.pid'),
        isProcessAlive: () => false } });
    assert.equal(result.exitCode, 0, output.errors.join('\n'));
    assert.equal(output.lines.length, 1);
    assert.equal(output.lines[0].includes('test-only-key'), false);
    return JSON.parse(output.lines[0]).engines.find(engine => engine.id === 'fal-qwen3').availability;
  };
  try {
    assert.deepEqual(await inspect('new-fal', { fal: true }),
      { state: 'available', label: '声プロファイルを使用できます', detail: { profiles_with_fal: 1 } });
    assert.deepEqual(await inspect('irodori-only', { irodori: true }),
      { state: 'needs', label: 'fal の写しがある声がありません（自分の声をつくる）', detail: { profiles_with_fal: 0 } });
    assert.deepEqual(await inspect('legacy-only', { legacy: true }),
      { state: 'available', label: '声プロファイルを使用できます', detail: { profiles_with_fal: 1 } });
    assert.deepEqual(await inspect('empty'),
      { state: 'needs', label: 'fal の写しがある声がありません（自分の声をつくる）', detail: { profiles_with_fal: 0 } });
    assert.deepEqual(await inspect('no-key', { fal: true, key: false }),
      { state: 'unconfigured', label: 'fal の鍵を登録', detail: { profiles_with_fal: 1 } });
    assert.deepEqual(await inspect('userprofile-only', { fal: true, userProfileOnly: true }),
      { state: 'available', label: '声プロファイルを使用できます', detail: { profiles_with_fal: 1 } });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('壊れた meta.json があっても engines --json は fal を needs にして一覧を返す', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-broken-profile-'));
  try {
    const home = join(scratch, 'home');
    const akariHome = join(scratch, 'akari');
    const valid = join(akariHome, 'avatars', 'person', 'voice', 'valid');
    const broken = join(home, '.config', 'akari-video', 'voice-profiles', 'broken');
    await mkdir(valid, { recursive: true });
    await mkdir(broken, { recursive: true });
    await writeFile(join(valid, 'meta.json'), JSON.stringify({ version: 2, profile: 'valid',
      engines: { 'fal-qwen3': { embedding_source_url: 'https://example.invalid/embedding' } } }));
    await writeFile(join(broken, 'meta.json'), '{ invalid json');
    const output = collectLogs();
    const result = await runNarrationCommand(['engines', '--json'], { ...output,
      engineRuntime: { env: { HOME: home, AKARI_HOME: akariHome, FAL_KEY: 'test-only-key' },
        fetchImpl: async () => ({ ok: false }), pidPath: join(scratch, 'missing-voicevox.pid'), isProcessAlive: () => false } });
    assert.equal(result.exitCode, 0, output.errors.join('\n'));
    assert.equal(output.lines.length, 1);
    const engines = JSON.parse(output.lines[0]).engines;
    assert.deepEqual(engines.map(engine => engine.id), ['voicevox', 'gemini-tts', 'irodori', 'fal-qwen3']);
    assert.equal(typeof engines[0].availability.state, 'string');
    assert.equal(typeof engines[2].availability.state, 'string');
    assert.deepEqual(engines[3].availability,
      { state: 'needs', label: 'fal の写しがある声がありません（自分の声をつくる）', detail: { profiles_with_fal: 0 } });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('engines の fal availability は共通鍵の新旧・指定・環境変数を反映し、鍵を表示しない', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-credentials-'));
  const names = ['HOME', 'AKARI_HOME', 'AKARI_CREDENTIALS_FILE', 'FAL_KEY', 'VOICEVOX_RUN'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  try {
    process.env.HOME = scratch;
    process.env.AKARI_HOME = join(scratch, 'akari');
    process.env.VOICEVOX_RUN = join(scratch, 'missing-run');
    delete process.env.AKARI_CREDENTIALS_FILE; delete process.env.FAL_KEY;
    globalThis.fetch = async () => ({ ok: false });
    const newer = join(process.env.AKARI_HOME, 'credentials.env');
    const older = join(scratch, '.config', 'akari-video', 'credentials.env');
    const explicit = join(scratch, 'explicit.env');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(scratch, '.config', 'akari-video'), { recursive: true });
    await mkdir(process.env.AKARI_HOME, { recursive: true });
    const inspect = async () => {
      const output = collectLogs();
      assert.equal((await runNarrationCommand(['engines', '--json'], { ...output,
        engineRuntime: { pidPath: join(scratch, 'pid'), isProcessAlive: () => false } })).exitCode, 0);
      const raw = output.lines[0];
      for (const key of ['old-dummy', 'new-dummy', 'explicit-dummy', 'env-dummy']) assert.equal(raw.includes(key), false);
      const engines = JSON.parse(raw).engines;
      const state = engines.find(engine => engine.id === 'gemini-tts').availability.state;
      if (state === 'unconfigured') assert.equal(engines.find(engine => engine.id === 'fal-qwen3').availability.state, 'unconfigured');
      return state;
    };
    assert.equal(await inspect(), 'unconfigured');
    await writeFile(older, 'FAL_KEY=old-dummy'); assert.equal(await inspect(), 'available');
    await writeFile(newer, 'FAL_KEY=new-dummy'); assert.equal(await inspect(), 'available');
    await writeFile(explicit, 'FAL_KEY=explicit-dummy'); process.env.AKARI_CREDENTIALS_FILE = explicit;
    assert.equal(await inspect(), 'available');
    process.env.FAL_KEY = 'env-dummy'; assert.equal(await inspect(), 'available');
    delete process.env.FAL_KEY;
    const unreadable = join(scratch, 'unreadable-credentials');
    await mkdir(unreadable);
    process.env.AKARI_CREDENTIALS_FILE = unreadable;
    assert.equal(await inspect(), 'unconfigured');
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; }
    await rm(scratch, { recursive: true, force: true });
  }
});

test('start は切り離し起動して pid を記録し、stop はその pid だけ止める', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-start-'));
  try {
    const runPath = join(scratch, 'run');
    const pidPath = join(scratch, 'voicevox.pid');
    await writeFile(runPath, 'fake');
    let running = false;
    let detached = false;
    let windowsHide = false;
    let unref = false;
    const killed = [];
    const runtime = { pidPath, env: { VOICEVOX_RUN: runPath },
      fetchImpl: async () => ({ ok: running, json: async () => '0.25.2' }),
      spawnImpl: (command, args, options) => {
        assert.equal(command, runPath); assert.deepEqual(args, []);
        detached = options.detached;
        windowsHide = options.windowsHide;
        return { pid: 43210, unref: () => { unref = true; } };
      },
      sleep: async () => { running = true; },
      isProcessAlive: pid => pid === 43210,
      readProcessCommand: pid => pid === 43210 ? runPath : null,
      killProcess: (pid, signal) => { killed.push([pid, signal]); running = false; } };
    const start = collectLogs();
    assert.equal((await runNarrationCommand(['start', '--engine', 'voicevox', '--json'], { ...start, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(start.lines[0]), { status: 'ok', already_running: false, version: '0.25.2' });
    assert.equal(await readFile(pidPath, 'utf8'), '43210\n');
    assert.equal(detached && unref && windowsHide, true);
    const stop = collectLogs();
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...stop, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(stop.lines[0]), { status: 'ok', stopped: true, managed: true });
    assert.deepEqual(killed, [[43210, 'SIGTERM']]);
    await assert.rejects(readFile(pidPath, 'utf8'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('既に動く VOICEVOX は起動せず、AKARI の pid が無ければ止めない', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-external-'));
  try {
    const runtime = { pidPath: join(scratch, 'missing.pid'),
      fetchImpl: async () => ({ ok: true, json: async () => '0.25.2' }),
      spawnImpl: () => assert.fail('spawn しない'), killProcess: () => assert.fail('外部アプリを止めない') };
    const start = collectLogs();
    assert.equal((await runNarrationCommand(['start', '--engine', 'voicevox', '--json'], { ...start, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(start.lines[0]), { status: 'ok', already_running: true, version: '0.25.2' });
    const stop = collectLogs();
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...stop, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(stop.lines[0]), { status: 'ok', stopped: false, managed: false });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('古い pid が死亡済みなら engines/start/stop は managed にせずファイルを掃除する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-stale-dead-'));
  try {
    const runPath = join(scratch, 'run');
    const pidPath = join(scratch, 'voicevox.pid');
    await writeFile(runPath, 'fake');
    const runtime = { pidPath, env: { VOICEVOX_RUN: runPath },
      fetchImpl: async () => ({ ok: true, json: async () => '0.25.2' }),
      isProcessAlive: pid => { assert.equal(pid, 43210); return false; },
      readProcessCommand: () => assert.fail('死亡 PID のコマンドは読まない'),
      spawnImpl: () => assert.fail('既に起動中なら spawn しない'),
      killProcess: () => assert.fail('死亡 PID は kill しない') };
    await writeFile(pidPath, '43210\n');
    const list = collectLogs();
    assert.equal((await runNarrationCommand(['engines', '--json'], { ...list, engineRuntime: runtime })).exitCode, 0);
    assert.equal(JSON.parse(list.lines[0]).engines[0].availability.detail.managed, false);
    await assert.rejects(readFile(pidPath, 'utf8'));
    await writeFile(pidPath, '43210\n');
    const start = collectLogs();
    assert.equal((await runNarrationCommand(['start', '--engine', 'voicevox', '--json'], { ...start, engineRuntime: runtime })).exitCode, 0);
    assert.equal(JSON.parse(start.lines[0]).already_running, true);
    await assert.rejects(readFile(pidPath, 'utf8'));
    await writeFile(pidPath, '43210\n');
    const stop = collectLogs();
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...stop, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(stop.lines[0]), { status: 'ok', stopped: false, managed: false });
    await assert.rejects(readFile(pidPath, 'utf8'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('pid が再利用され別コマンドなら外部 VOICEVOX の起動中も止めない', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-stale-reused-'));
  try {
    const runPath = join(scratch, 'run');
    const pidPath = join(scratch, 'voicevox.pid');
    await writeFile(runPath, 'fake');
    const runtime = { pidPath, env: { VOICEVOX_RUN: runPath },
      fetchImpl: async () => ({ ok: true, json: async () => '0.25.2' }),
      isProcessAlive: () => true,
      readProcessCommand: () => '/usr/bin/unrelated-task',
      killProcess: () => assert.fail('再利用 PID は kill しない') };
    await writeFile(pidPath, '43210\n');
    const list = collectLogs();
    assert.equal((await runNarrationCommand(['engines', '--json'], { ...list, engineRuntime: runtime })).exitCode, 0);
    assert.equal(JSON.parse(list.lines[0]).engines[0].availability.detail.managed, false);
    await assert.rejects(readFile(pidPath, 'utf8'));
    await writeFile(pidPath, '43210\n');
    const stop = collectLogs();
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...stop, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(stop.lines[0]), { status: 'ok', stopped: false, managed: false });
    await assert.rejects(readFile(pidPath, 'utf8'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('生存 PID の実行コマンドが vv-engine run と一致するときだけ managed=true で停止する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-managed-'));
  try {
    const runPath = join(scratch, 'vv-engine', 'run');
    const pidPath = join(scratch, 'voicevox.pid');
    await writeFile(pidPath, '43210\n');
    let running = true;
    const kills = [];
    const runtime = { pidPath, env: { VOICEVOX_RUN: runPath },
      fetchImpl: async () => ({ ok: running, json: async () => '0.25.2' }),
      isProcessAlive: () => true,
      readProcessCommand: () => `${runPath} --host 127.0.0.1`,
      killProcess: (pid, signal) => { kills.push([pid, signal]); running = false; } };
    const list = collectLogs();
    assert.equal((await runNarrationCommand(['engines', '--json'], { ...list, engineRuntime: runtime })).exitCode, 0);
    assert.equal(JSON.parse(list.lines[0]).engines[0].availability.detail.managed, true);
    const stop = collectLogs();
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...stop, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(stop.lines[0]), { status: 'ok', stopped: true, managed: true });
    assert.deepEqual(kills, [[43210, 'SIGTERM']]);
    await assert.rejects(readFile(pidPath, 'utf8'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('検査後にプロセスが終了した競合では stopped=false を返す', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-voicevox-stop-race-'));
  try {
    const runPath = join(scratch, 'run');
    const pidPath = join(scratch, 'voicevox.pid');
    await writeFile(pidPath, '43210\n');
    const output = collectLogs();
    const runtime = { pidPath, env: { VOICEVOX_RUN: runPath },
      isProcessAlive: () => true, readProcessCommand: () => runPath,
      fetchImpl: () => assert.fail('停止済みなら HTTP を呼ばない'),
      killProcess: () => { const error = new Error('not found'); error.code = 'ESRCH'; throw error; } };
    assert.equal((await runNarrationCommand(['stop', '--engine', 'voicevox', '--json'], { ...output, engineRuntime: runtime })).exitCode, 0);
    assert.deepEqual(JSON.parse(output.lines[0]), { status: 'ok', stopped: false, managed: false });
    await assert.rejects(readFile(pidPath, 'utf8'));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('Gemini voices JSON は Leda が先頭で 30 声', async () => {
  const output = collectLogs();
  assert.equal((await runNarrationCommand(['voices', '--engine', 'gemini-tts', '--json'], output)).exitCode, 0);
  const json = JSON.parse(output.lines[0]);
  assert.equal(json.voices.length, 30);
  assert.deepEqual(json.voices[0], { id: 'Leda', label: 'Leda（Youthful）', default: true });
});

test('VOICEVOX voices JSON は speakers.styles を平坦化する', async () => {
  const priorFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => url.endsWith('/version')
      ? { ok: true }
      : { ok: true, json: async () => [{ name: 'ずんだもん', styles: [{ id: 3, name: 'ノーマル' }, { id: 1, name: 'あまあま' }] }] };
    const output = collectLogs();
    assert.equal((await runNarrationCommand(['voices', '--engine', 'voicevox', '--json'], output)).exitCode, 0);
    assert.deepEqual(JSON.parse(output.lines[0]).voices, [
      { id: '3', label: 'ずんだもん ノーマル', group: 'ずんだもん' },
      { id: '1', label: 'ずんだもん あまあま', group: 'ずんだもん' },
    ]);
  } finally { globalThis.fetch = priorFetch; }
});

test('Gemini の enum 外の声と未承認は送信せず exit 2', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-approval-'));
  const priorFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('unexpected fetch'); };
    const base = ['generate', '--project', scratch, '--engine', 'gemini-tts', '--text', 'こんにちは', '--json'];
    const bad = collectLogs();
    assert.equal((await runNarrationCommand([...base, '--voice', 'Foo'], bad)).exitCode, 2);
    assert.match(bad.errors[0], /Leda/);
    assert.match(bad.errors[0], /Zubenelgenubi/);
    const pending = collectLogs();
    assert.equal((await runNarrationCommand(base, pending)).exitCode, 2);
    assert.equal(pending.lines.length, 1);
    assert.deepEqual(JSON.parse(pending.lines[0]), { version: 1, status: 'needs_approval', estimate_usd: 0.00025, chars: 5 });
    const pendingWithSpeed = collectLogs();
    assert.equal((await runNarrationCommand([...base, '--speed', '1.2'], pendingWithSpeed)).exitCode, 2);
    assert.equal(JSON.parse(pendingWithSpeed.lines[0]).speed_applied, false);
    assert.equal(JSON.parse(pendingWithSpeed.lines[0]).warnings.length, 1);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    await rm(scratch, { recursive: true, force: true });
  }
});

test('--apply は --t 必須、--apply 無しの省略は 0 秒扱い', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-time-'));
  try {
    const output = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'voicevox',
      '--text', 'こんにちは', '--apply', '--json'], output)).exitCode, 1);
    assert.match(output.errors[0], /--t/);
    const dryRun = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'voicevox',
      '--text', 'こんにちは', '--dry-run', '--json'], dryRun)).exitCode, 0);
    assert.equal(dryRun.lines.length, 1);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('Gemini --json は 1 行・ログを stderr・speed 警告・payload と provenance', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-gemini-'));
  const priorFetch = globalThis.fetch;
  const priorCredentials = process.env.AKARI_CREDENTIALS_FILE;
  try {
    process.env.AKARI_CREDENTIALS_FILE = join(scratch, 'credentials.env');
    await writeFile(process.env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=test-secret');
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return url === 'https://fal.run/fal-ai/gemini-tts'
        ? { ok: true, json: async () => ({ audio: { url: 'https://example.invalid/audio.mp3' } }) }
        : { ok: true, arrayBuffer: async () => Buffer.from('mock-mp3') };
    };
    const output = collectLogs();
    const result = await runNarrationCommand(['generate', '--project', scratch, '--engine', 'gemini-tts',
      '--text', 'こんにちは', '--t', '0', '--voice', 'Leda', '--style', '穏やかに', '--speed', '1.2', '--yes', '--json'], output);
    assert.equal(result.exitCode, 0);
    assert.equal(output.lines.length, 1);
    assert.match(output.errors.join('\n'), /推定費用/);
    assert.match(output.errors.join('\n'), /--speed に対応していない/);
    const json = JSON.parse(output.lines[0]);
    assert.equal(json.status, 'ok');
    assert.equal(json.speed_applied, false);
    assert.equal(json.warnings.length >= 1, true);
    assert.equal(json.provenance.price_verified, false);
    assert.equal(json.provenance.voice, 'gemini:Leda');
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      prompt: 'こんにちは', voice: 'Leda', model: 'gemini-2.5-flash-tts',
      output_format: 'mp3', language_code: 'Japanese (Japan)', style_instructions: '穏やかに',
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorCredentials === undefined) delete process.env.AKARI_CREDENTIALS_FILE; else process.env.AKARI_CREDENTIALS_FILE = priorCredentials;
    await rm(scratch, { recursive: true, force: true });
  }
});

test('VOICEVOX speedScale と caption_ref は v1 / v2 の --apply 後も検証を通る', async () => {
  const priorFetch = globalThis.fetch;
  const wav = fakeWav();
  const synthesisBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/version')) return { ok: true, json: async () => '0.0.0' };
    if (url.endsWith('/speakers')) return { ok: true, json: async () => [{ name: 'ずんだもん', styles: [{ id: 3, name: 'ノーマル' }] }] };
    if (url.includes('/audio_query')) return { ok: true, json: async () => ({ speedScale: 1 }) };
    if (url.includes('/synthesis')) {
      synthesisBodies.push(JSON.parse(init.body));
      return { ok: true, arrayBuffer: async () => wav };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    for (const [version, fixture] of [[1, 'schemas/examples/edit-v1-sample/edit.json'], [2, 'edit-store/test/fixtures/edit-v2.json']]) {
      const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-apply-'));
      try {
        await copyFile(new URL(`../../${fixture}`, import.meta.url), join(scratch, 'edit.json'));
        const output = collectLogs();
        const result = await runNarrationCommand(['generate', '--project', scratch, '--engine', 'voicevox',
          '--text', 'こんにちは', '--t', '0', '--speed', '1.2', '--caption-ref', 'c-0002', '--apply', '--json'], output);
        assert.equal(result.exitCode, 0, output.errors.join('\n'));
        const json = JSON.parse(output.lines[0]);
        assert.equal(json.duration_s, 3);
        assert.equal(json.speed_applied, true);
        const edit = JSON.parse(await readFile(join(scratch, 'edit.json')));
        const entry = edit.audio.narration.at(-1);
        assert.equal(entry.caption_ref, 'c-0002');
        if (version === 2) assert.equal(projectLegacyEdit(readInternalEdit(edit)).audioNarration.some(item => item.id === entry.id), true);
      } finally { await rm(scratch, { recursive: true, force: true }); }
    }
    assert.deepEqual(synthesisBodies.map(body => body.speedScale), [1.2, 1.2]);
  } finally { globalThis.fetch = priorFetch; }
});

test('narration --profile は新 → 旧の順で解決し、彩は voice_id を caption 無しで送る', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-profile-'));
  const oldHome = process.env.HOME, oldAkari = process.env.AKARI_HOME, oldCredentials = process.env.AKARI_CREDENTIALS_FILE;
  const oldFetch = globalThis.fetch;
  try {
    process.env.HOME = scratch; process.env.AKARI_HOME = join(scratch, 'akari');
    process.env.AKARI_CREDENTIALS_FILE = join(scratch, 'credentials.env');
    await writeFile(process.env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=test-only\n');
    const oldDir = join(scratch, '.config', 'akari-video', 'voice-profiles', 'owner-ja');
    const newDir = join(process.env.AKARI_HOME, 'avatars', 'person', 'voice', 'owner-ja');
    const { mkdir, readFile } = await import('node:fs/promises');
    await mkdir(oldDir, { recursive: true }); await mkdir(newDir, { recursive: true });
    await writeFile(join(oldDir, 'meta.json'), JSON.stringify({ profile: 'owner-ja', reference_text: '旧原稿', embedding_source_url: 'https://example.invalid/old' }));
    await writeFile(join(newDir, 'meta.json'), JSON.stringify({ version: 2, profile: 'owner-ja', reference_text: '新原稿',
      engines: { 'fal-qwen3': { embedding_source_url: 'https://example.invalid/new' }, irodori: { voice_id: 'akari-owner-ja' } } }));
    const fal = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'fal-qwen3', '--profile', 'owner-ja', '--text', 'こんにちは', '--dry-run', '--json'], fal)).exitCode, 0);
    assert.equal(JSON.parse(fal.lines[0]).request.body.speaker_voice_embedding_file_url, 'https://example.invalid/new');
    const iro = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'irodori', '--profile', 'owner-ja', '--text', 'こんにちは', '--dry-run', '--json'], iro)).exitCode, 0);
    const body = JSON.parse(iro.lines[0]).request.body;
    assert.equal(body.voice, 'akari-owner-ja'); assert.equal(body.irodori, undefined);
    const meta = JSON.parse(await readFile(join(newDir, 'meta.json'), 'utf8'));
    delete meta.engines.irodori;
    await writeFile(join(newDir, 'meta.json'), JSON.stringify(meta));
    const missing = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'irodori', '--profile', 'owner-ja', '--text', 'こんにちは', '--dry-run', '--json'], missing)).exitCode, 2);
    assert.match(JSON.parse(missing.lines[0]).error, /彩の写しがありません/);
    const { rm: remove } = await import('node:fs/promises');
    await remove(newDir, { recursive: true });
    const legacy = collectLogs();
    assert.equal((await runNarrationCommand(['generate', '--project', scratch, '--engine', 'fal-qwen3', '--profile', 'owner-ja', '--text', 'こんにちは', '--dry-run', '--json'], legacy)).exitCode, 0);
    assert.equal(JSON.parse(legacy.lines[0]).request.body.speaker_voice_embedding_file_url, 'https://example.invalid/old');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldAkari === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = oldAkari;
    if (oldCredentials === undefined) delete process.env.AKARI_CREDENTIALS_FILE; else process.env.AKARI_CREDENTIALS_FILE = oldCredentials;
    await rm(scratch, { recursive: true, force: true });
  }
});
