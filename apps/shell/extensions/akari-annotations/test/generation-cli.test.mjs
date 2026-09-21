import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GenerationCliManager, generationDraftPath } from '../lib/node/generation-cli.js';

test('GenerationCliManager は偽 CLI を非 detached で起動し stdout を保持する', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-cli-'));
  try {
    await mkdir(path.dirname(generationDraftPath(root, 'clip-a')), { recursive: true });
    await writeFile(generationDraftPath(root, 'clip-a'), JSON.stringify({ modelId: 'fal:h3-i2v', inputs: {}, output: {} }));
    let invocation;
    const spawnImpl = (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => true; child.exitCode = null; child.killed = false;
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"ok":true}\n')); child.emit('close', 0); });
      return child;
    };
    const manager = new GenerationCliManager({ spawnImpl, env: { AKARI_GENERATE_CLI: '/tmp/fake-generate.mjs' } });
    const result = await manager.start(root, 'clip-a');
    assert.equal(result.ok, true);
    assert.equal(result.stdout, '{"ok":true}\n');
    assert.equal(invocation.options.detached, false);
    assert.deepEqual(invocation.args.slice(1, 4), ['generate', 'video', root]);
    assert.ok(invocation.args.includes('--yes'));
    assert.equal(invocation.args.includes('--inputs'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generationDraftPath は itemId のパストラバーサルを拒否する', () => {
  assert.throws(() => generationDraftPath('/tmp/project', '../outside'), /itemId/);
});

import { readFile, copyFile } from 'node:fs/promises';
import { generationFields, GENERATION_CAMERA_MOVES } from '../lib/browser/inspector/generation-fields.js';
const catalog = JSON.parse(await readFile(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8')).models;

test('偽 CLI は --inputs 無しで next を読み、カメラ 6 種 × 2 記法の provider body に日本語を送らない', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-camera-cli-'));
  try {
    const cliUrl = new URL('../../../../../packages/generate/src/cli/video.mjs', import.meta.url).href;
    const fake = path.join(root, 'fake-cli.mjs');
    await writeFile(fake, `import { writeFile } from 'node:fs/promises';
import { runVideoCommand } from ${JSON.stringify(cliUrl)};
const args = process.argv.slice(2);
await writeFile(${JSON.stringify(path.join(root, 'args.json'))}, JSON.stringify(args));
const result = await runVideoCommand([...args.slice(2), '--dry-run'], { log: text => console.log(text), errorLog: text => console.error(text) });
process.exitCode = result.exitCode;\n`);
    await copyFile(new URL('../../../../../packages/generate/test/fixtures/cli-video/assets/stills/start.png', import.meta.url), path.join(root, 'still.png'));
    await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 's', path: 'still.png' }], tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'clip-a', at: 0, duration: 180, source: { kind: 'media', src: 's', in: 0, out: 6 } }] }], audio: { narration: [], sfx: [] } }));
    const manager = new GenerationCliManager({ env: { ...process.env, AKARI_GENERATE_CLI: fake, AKARI_HOME: path.join(root, 'home') } });
    for (const id of ['fal:h3-i2v', 'fal:kling-v3-standard-i2v']) for (const move of GENERATION_CAMERA_MOVES) {
      const model = catalog.find(row => row.id === id);
      const current = { modelId: id, inputs: { prompt: 'A garden.', first_frame: { path: 'still.png' } }, output: { duration_s: 6, resolution: model.resolutions?.[0] ?? null } };
      const camera = generationFields({ snapshot: {}, catalogRow: model, draft: current, defaults: { catalog }, actions: { update: async (key, value) => { current.inputs.camera = value; return { ok: true }; } } }).find(field => field.name === 'camera');
      await camera.write({}, move.label);
      await writeFile(path.join(root, 'still.png.meta.json'), JSON.stringify({ version: 1, kind: 'still', status: 'done', next: { kind: 'video', status: 'planned', model: { id }, inputs: current.inputs, output: current.output } }));
      const result = await manager.start(root, 'clip-a');
      assert.equal(result.ok, true, result.stderr || result.stdout);
      const args = JSON.parse(await readFile(path.join(root, 'args.json'), 'utf8'));
      assert.equal(args.includes('--inputs'), false);
      assert.equal(args.includes('--model'), false);
      const body = JSON.parse(result.stdout.trim().split('\n').find(line => line.startsWith('{'))).body;
      assert.equal(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(JSON.stringify(body)), false);
      assert.ok(body.prompt.includes(move[model.inputs.camera]), JSON.stringify(body));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
