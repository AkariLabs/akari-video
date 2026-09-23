// 合成音と偽サーバーだけで CLI 証跡を再生成する。実プロファイル・実 API は使わない。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVoiceCommand } from '../../src/voice-command.mjs';

const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-voice-evidence-'));
const env = { ...process.env, HOME: root, AKARI_HOME: path.join(root, 'akari') };
const events = [];
const source = path.join(root, 'synthetic.wav');
const answer = path.join(root, 'answer.wav');
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (result.status !== 0) throw new Error('ffmpeg による合成音の生成に失敗');
}
function clean(value) {
  if (typeof value === 'string') {
    if (path.isAbsolute(value) && value.includes('akari-voice-try-')) return `<tmp>/${path.basename(value)}`;
    return value.replaceAll(root, '<tmp>');
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
async function step(name, args, runtime = {}, expected = 0) {
  const lines = [];
  const result = await runVoiceCommand([...args, '--json'], { env, ...runtime, log: line => lines.push(line), logError: () => {} });
  assert.equal(result.exitCode, expected, `${name}: ${lines.join(' ')}`);
  assert.equal(lines.length, 1);
  const json = JSON.parse(lines[0]);
  events.push({ step: name, exit_code: result.exitCode, result: clean(json) });
  return json;
}
const requests = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method, endpoint: req.url.slice(1),
      multipart_file: req.url === '/v1/audio/voices' && body.includes(Buffer.from('name="file"')),
      multipart_voice_id: req.url === '/v1/audio/voices' && body.includes(Buffer.from('akari-sample')),
      speech_voice: req.url === '/v1/audio/speech' ? JSON.parse(body.toString('utf8')).voice : null });
    if (req.url === '/v1/audio/speech') { res.setHeader('Content-Type', 'audio/wav'); res.end(fs.readFileSync(answer)); }
    else { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
  });
});
try {
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-f', 'lavfi', '-i', 'anoisesrc=duration=20:amplitude=0.0001',
    '-filter_complex', '[0:a]volume=3[s];[s][1:a]amix=inputs=2:duration=first', '-ac', '1', '-ar', '48000', source]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-ac', '1', '-ar', '48000', answer]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await step('check-synthetic-low-score', ['check', '--audio', source, '--script', 'quick-v1']);
  const create = ['create', '--avatar', 'person', '--id', 'sample', '--label', '合成テスト', '--audio', source, '--script', 'quick-v1', '--consent-self', '--consent-cloud'];
  await step('create-rejected-low-score', create, {}, 2);
  await step('create-with-unavailable-verification', create, { verifyScript: () => ({ status: 'unavailable' }) });
  let falFetchCalls = 0;
  await step('fal-copy-rejected-unavailable', ['copy', '--profile', 'sample', '--engine', 'fal-qwen3', '--yes'],
    { fetchImpl: () => { falFetchCalls++; throw new Error('unexpected fetch'); } }, 2);
  assert.equal(falFetchCalls, 0);
  events.push({ step: 'fal-fetch-guard', calls: falFetchCalls });
  await step('profiles-after-create', ['profiles']);
  await step('copy-irodori', ['copy', '--profile', 'sample', '--engine', 'irodori', '--irodori-url', url]);
  const tried = await step('try-irodori', ['try', '--profile', 'sample', '--engine', 'irodori', '--text', '合成音です。', '--irodori-url', url]);
  fs.rmSync(path.dirname(tried.path), { recursive: true, force: true });
  await step('delete', ['delete', '--profile', 'sample', '--irodori-url', url]);
  const old = path.join(root, '.config', 'akari-video', 'voice-profiles', 'owner-ja');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'ref-recording.wav'), fs.readFileSync(answer));
  fs.writeFileSync(path.join(old, 'meta.json'), JSON.stringify({ profile: 'owner-ja', provider: 'fal-qwen3', reference_text: '合成テスト',
    embedding_source_url: 'https://example.invalid/synthetic', reference: { original_path: '<synthetic>' }, consent: 'test' }));
  await step('migrate-fake-legacy', ['migrate-legacy', '--profile', 'owner-ja', '--avatar', 'person']);
  assert.equal(fs.existsSync(path.join(old, 'meta.json')), true);
  events.push({ step: 'fake-server-requests', requests });
  const data = { version: 1, fixture: 'ffmpeg sine + low noise; isolated HOME and AKARI_HOME; local fake HTTP server', events };
  const raw = `${JSON.stringify(clean(data), null, 2)}\n`;
  assert.equal(raw.includes(root), false);
  assert.equal(raw.includes(os.userInfo().username), false);
  assert.equal(/FAL_KEY|Key [A-Za-z0-9]/.test(raw), false);
  fs.writeFileSync(output, raw);
} finally {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
