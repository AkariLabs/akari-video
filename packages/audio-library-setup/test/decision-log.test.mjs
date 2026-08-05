import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readToneDecision } from '../shared/decision-log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'bin', 'suggest-bgm.mjs');

const CATALOG = {
  tracks: [
    { id: 'bgm-lofi-piano-084', title: 'Lofi', kind: 'bgm', tags: ['bpm-84'], files: [] },
    { id: 'bgm-jazzhop-piano-086', title: 'Jazzhop', kind: 'bgm', tags: ['bpm-86'], files: [] },
    { id: 'bgm-harddance-145', title: 'Hard Dance', kind: 'bgm', tags: ['bpm-145'], files: [] },
  ],
};

function logWith(...rows) {
  return [
    '| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function toneRow(json, at = '2026-08-05T10:00:00+09:00', note = '') {
  return `| ${at} | direction | tone | \`${json}\`${note ? ` ${note}` : ''} | test | owner | Checkpoint 1 |`;
}

async function fixtureRoot(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const catalogPath = path.join(root, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify(CATALOG));
  return { root, catalogPath };
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AKARI_HOME: path.join(root, '.akari') },
  });
}

test('readToneDecision: 複数 tone と tempo、該当した生の行を返す', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-decision-log-read-'));
  try {
    const decisionPath = path.join(root, 'decision-log.md');
    const row = toneRow('{"tone":["親しみ","高級感"],"tempo":"ゆったり"}', undefined, '会話の温度感を保つ');
    await writeFile(decisionPath, logWith(row));

    assert.deepEqual(await readToneDecision(decisionPath), {
      tones: ['親しみ', '高級感'],
      tempo: 'ゆったり',
      line: row,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: decision-log の複数 tone + tempo ありで BGM を提案する', async () => {
  const { root, catalogPath } = await fixtureRoot('akari-decision-log-cli-tempo-');
  try {
    const decisionPath = path.join(root, 'decision-log.md');
    await writeFile(decisionPath, logWith(toneRow('{"tone":["親しみ","高級感"],"tempo":"ゆったり"}')));
    const result = runCli(root, ['--from-decision-log', decisionPath, '--catalog', catalogPath, '--json']);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.query, { tones: ['親しみ', '高級感'], tempo: 'ゆったり', count: 5 });
    assert.equal(parsed.suggestions[0].id, 'bgm-jazzhop-piano-086');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: decision-log の tempo なしでも tone から BGM を提案する', async () => {
  const { root, catalogPath } = await fixtureRoot('akari-decision-log-cli-no-tempo-');
  try {
    const decisionPath = path.join(root, 'decision-log.md');
    await writeFile(decisionPath, logWith(toneRow('{"tone":["勢い"]}')));
    const result = runCli(root, ['--from-decision-log', decisionPath, '--catalog', catalogPath, '--json']);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.query, { tones: ['勢い'], tempo: null, count: 5 });
    assert.equal(parsed.suggestions[0].id, 'bgm-harddance-145');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readToneDecision: 同じキーが複数あれば最後の行が勝つ', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-decision-log-latest-'));
  try {
    const decisionPath = path.join(root, 'decision-log.md');
    const latest = toneRow('{"tone":["勢い"],"tempo":"高速"}', '2026-08-05T11:00:00+09:00');
    await writeFile(decisionPath, logWith(
      toneRow('{"tone":["親しみ"]}', '2026-08-05T10:00:00+09:00'),
      latest,
    ));

    const result = await readToneDecision(decisionPath);
    assert.deepEqual(result.tones, ['勢い']);
    assert.equal(result.tempo, '高速');
    assert.equal(result.line, latest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: 明示した --tone は decision-log より優先する', async () => {
  const { root, catalogPath } = await fixtureRoot('akari-decision-log-override-');
  try {
    const decisionPath = path.join(root, 'decision-log.md');
    await writeFile(decisionPath, logWith(toneRow('{"tone":["親しみ"]}')));
    const result = runCli(root, [
      '--from-decision-log', decisionPath, '--tone', '勢い', '--catalog', catalogPath, '--json',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.query.tones, ['勢い']);
    assert.equal(parsed.suggestions[0].id, 'bgm-harddance-145');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: decision-log の語彙外 tone / tempo は値を示して exit 1', async () => {
  const { root, catalogPath } = await fixtureRoot('akari-decision-log-vocabulary-');
  try {
    for (const [name, json, invalid] of [
      ['tone', '{"tone":["疾走"]}', '疾走'],
      ['tempo', '{"tone":["勢い"],"tempo":"爆速"}', '爆速'],
    ]) {
      const decisionPath = path.join(root, `${name}.md`);
      await writeFile(decisionPath, logWith(toneRow(json)));
      const result = runCli(root, ['--from-decision-log', decisionPath, '--catalog', catalogPath]);
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, /語彙外/);
      assert.ok(result.stderr.includes(invalid), `${name}: 語彙外の値 ${invalid} がエラーに無い`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: 方針行なし / ファイル欠損 / 壊れた JSON は理由を示して exit 1', async () => {
  const { root, catalogPath } = await fixtureRoot('akari-decision-log-errors-');
  try {
    const noRowPath = path.join(root, 'no-row.md');
    await writeFile(noRowPath, logWith('| 2026-08-05T10:00:00+09:00 | direction | captions | 付ける | test | owner | Checkpoint 1 |'));
    const brokenPath = path.join(root, 'broken.md');
    await writeFile(brokenPath, logWith(toneRow('{"tone":[}')));

    for (const [decisionPath, reason] of [
      [noRowPath, /\(direction, tone\).*見つかりません/],
      [path.join(root, 'missing.md'), /ファイルが見つかりません/],
      [brokenPath, /JSON が壊れています/],
    ]) {
      const result = runCli(root, ['--from-decision-log', decisionPath, '--catalog', catalogPath]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, reason);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
