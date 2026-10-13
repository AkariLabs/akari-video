import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { projectFileHash, writeProjectFilesTransactional, writeProjectFilesGuarded,
  recoverInterruptedProjectWrite } from '../lib/write-gate.js';
import { projectFileContentHash } from '../lib/index.js';
import { planCaptionStyleEdit } from '../lib/index.js';

const fixture = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'akari-write-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const read = (root, name) => readFile(join(root, name), 'utf8');

test('配列ルートの既定スタイルは captions より先に並ぶ', () => {
  const captions = [{ id: 'c-1', start: 0, end: 1, text: '本文' }];
  const result = planCaptionStyleEdit({ captions, targets: [{ default: true }],
    parts: { look: { color: '#ffffff' } } });
  assert.deepEqual(Object.keys(result.next.captions), ['default_text_style', 'captions']);
});

test('書き込み成功後は空の退避フォルダと lock の一時ファイルを残さない', async () => fixture(async root => {
  await writeProjectFilesTransactional(root, { label: '保存', files: {
    'captions.json': { next: '本文' },
  } });
  for (const name of ['.akari/work/journal', '.akari/write.lock', '.akari/write.lock.claim',
    '.akari/write-journal.json']) {
    await assert.rejects(stat(join(root, name)), { code: 'ENOENT' });
  }
  assert.equal((await stat(join(root, '.akari/work'))).isDirectory(), true);
  assert.equal((await stat(join(root, '.akari'))).isDirectory(), true);
}));

test('壊れた記録を退避した後は退避フォルダとファイルを残す', async () => fixture(async root => {
  await mkdir(join(root, '.akari'), { recursive: true });
  await writeFile(join(root, '.akari', 'write-journal.json'), '壊れた JSON');
  assert.match(await recoverInterruptedProjectWrite(root), /壊れていたので退避/);
  const journalRoot = join(root, '.akari', 'work', 'journal');
  const entries = await readdir(journalRoot);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^broken-[\da-f-]+\.json$/i);
  assert.equal(await readFile(join(journalRoot, entries[0]), 'utf8'), '壊れた JSON');
}));

test('復元できた失敗と中断後の回復は空の退避フォルダを消す', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '失敗', files: {
    'captions.json': { next: '後' }, 'edit.json': { next: '後' },
  } }, { hooks: { rename: async (from, to, index) => {
    if (index === 2) throw new Error('失敗');
    await rename(from, to);
  } } }), /失敗/);
  await assert.rejects(stat(join(root, '.akari/work/journal')), { code: 'ENOENT' });
  await assert.rejects(writeProjectFilesTransactional(root, { label: '中断', files: {
    'captions.json': { next: '後' },
  } }, { hooks: { crashAfterFirstRename: true } }));
  assert.match(await recoverInterruptedProjectWrite(root), /元に戻しました/);
  await assert.rejects(stat(join(root, '.akari/work/journal')), { code: 'ENOENT' });
}));

test('日本語・絵文字・サロゲートペアの生バイト hash がブラウザ版と一致する', () => {
  for (const value of ['字幕', '🎬', '\uD83D\uDE00', '\uD800x']) {
    assert.equal(projectFileHash(value), projectFileContentHash(value));
  }
});

test('相対 projectRoot の edit.json に saved-by が付き通知のパスは従来の文字列を保つ', async () => fixture(async root => {
  const projectRoot = relative(process.cwd(), root);
  const paths = [];
  await writeProjectFilesGuarded(projectRoot, { 'edit.json': '{"version":1}' }, {
    appVersion: '1.2.3', onDidWrite: path => paths.push(path)
  });
  assert.deepEqual(paths, [join(projectRoot, 'edit.json')]);
  const stamped = JSON.parse(await read(root, '.akari/saved-by.json'));
  assert.equal(stamped.appVersion, '1.2.3');
}));

test('hash が合えば複数ファイルを全部書く', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await writeFile(join(root, 'edit.json'), '旧');
  const result = await writeProjectFilesTransactional(root, { label: '全部', files: {
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
    'edit.json': { expectedHash: projectFileHash('旧'), next: '新' },
  } });
  assert.deepEqual(result.written, ['captions.json', 'edit.json']);
  assert.equal(await read(root, 'captions.json'), '後');
  assert.equal(await read(root, 'edit.json'), '新');
}));

test('比較後の通知は書いたファイルだけ rename の前後で対になる', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await writeFile(join(root, 'edit.json'), '同じ');
  const calls = [];
  const options = { onWillWrite: (_path, name) => calls.push(`will:${name}`),
    onDidWrite: (_path, _text, name) => calls.push(`did:${name}`) };
  await assert.rejects(writeProjectFilesTransactional(root, { label: '競合', files: {
    'captions.json': { expectedHash: projectFileHash('古い'), next: '後' }
  } }, options), error => error.code === 'AKARI_WRITE_CONFLICT');
  assert.deepEqual(calls, []);
  await writeProjectFilesTransactional(root, { label: '成功', files: {
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
    'edit.json': { expectedHash: projectFileHash('同じ'), next: '同じ' }
  } }, options);
  assert.deepEqual(calls, ['will:captions.json', 'did:captions.json']);
}));

test('captions は合うが読んだ edit.json が変われば何も書かない', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await writeFile(join(root, 'edit.json'), '別の操作');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '競合', files: {
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
    'edit.json': { expectedHash: projectFileHash('旧'), next: null },
  } }), error => error.name === 'ConflictError' && error.code === 'AKARI_WRITE_CONFLICT'
    && error.files.includes('edit.json'));
  assert.equal(await read(root, 'captions.json'), '前');
}));

test('2 つ目の rename が失敗したら 1 つ目を元のバイト列へ戻す', async () => fixture(async root => {
  const original = Buffer.from([0, 255, 10]);
  await writeFile(join(root, 'captions.json'), original);
  await writeFile(join(root, 'edit.json'), '旧');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '復元', files: {
    'captions.json': { next: '新' }, 'edit.json': { next: '新' },
  } }, { hooks: { rename: async (from, to, index) => {
    if (index === 2) throw new Error('失敗');
    await rename(from, to);
  } } }), /失敗/);
  assert.deepEqual(await readFile(join(root, 'captions.json')), original);
  assert.equal(await read(root, 'edit.json'), '旧');
}));

test('journal の直後に落ちたら次の書き込み前に回復の通知を返す', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '落下', files: {
    'captions.json': { next: '後' },
  } }, { hooks: { crashAfterJournal: true } }));
  let notice;
  const result = await writeProjectFilesTransactional(root, { label: '次', files: {
    'captions.json': { next: '次' },
  } }, { onRecovered: value => { notice = value; } });
  assert.match(notice, /前回の書き込みが途中で止まった/);
  assert.equal(result.recovered, notice);
  assert.equal(await read(root, 'captions.json'), '次');
}));

test('1 つ目の rename 後に落ちたら次の比較前に元のバイト列へ戻す', async () => fixture(async root => {
  const original = Buffer.from([0, 255, 10]);
  await writeFile(join(root, 'captions.json'), original);
  await assert.rejects(writeProjectFilesTransactional(root, { label: '落下', files: {
    'captions.json': { next: '後' },
  } }, { hooks: { crashAfterFirstRename: true } }));
  const result = await writeProjectFilesTransactional(root, { label: '次', files: {
    'captions.json': { expectedHash: projectFileHash(original), next: null },
  } });
  assert.match(result.recovered, /captions\.json/);
  assert.deepEqual(await readFile(join(root, 'captions.json')), original);
}));

test('回復時にその後の変更があればそのファイルを触らない', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '落下', files: {
    'captions.json': { next: '後' },
  } }, { hooks: { crashAfterFirstRename: true } }));
  await writeFile(join(root, 'captions.json'), '第三者');
  const notice = await recoverInterruptedProjectWrite(root);
  assert.match(notice, /その後に変更されていたのでそのまま/);
  assert.equal(await read(root, 'captions.json'), '第三者');
}));

test('壊れた journal は退避してファイルを触らない', async () => fixture(async root => {
  await mkdir(join(root, '.akari'), { recursive: true });
  await writeFile(join(root, 'captions.json'), '前');
  await writeFile(join(root, '.akari', 'write-journal.json'), '壊れた JSON');
  assert.match(await recoverInterruptedProjectWrite(root), /壊れていたので退避/);
  assert.equal(await read(root, 'captions.json'), '前');
}));

test('死んだ持ち主の lock は奪える', async () => fixture(async root => {
  await mkdir(join(root, '.akari'), { recursive: true });
  await writeFile(join(root, '.akari', 'write.lock'), JSON.stringify({
    pid: 99999999, host: hostname(), created_at: new Date().toISOString(),
  }));
  await writeProjectFilesTransactional(root, { label: '奪取', files: { 'captions.json': { next: '新' } } },
    { hooks: { processAlive: () => false } });
  assert.equal(await read(root, 'captions.json'), '新');
}));

test('生きている持ち主の lock は 30 秒間奪えず 31 秒で奪える', async () => fixture(async root => {
  const now = Date.now();
  await mkdir(join(root, '.akari'), { recursive: true });
  await writeFile(join(root, '.akari', 'write.lock'), JSON.stringify({
    pid: 123, host: hostname(), created_at: new Date(now).toISOString(),
  }));
  await assert.rejects(writeProjectFilesTransactional(root, { label: '待機', files: {
    'captions.json': { next: '不可' },
  } }, { waitTimeoutMs: 30, hooks: { now: () => now + 30_000, processAlive: () => true } }), /待ち時間/);
  await writeProjectFilesTransactional(root, { label: '期限切れ', files: {
    'captions.json': { next: '可' },
  } }, { hooks: { now: () => now + 31_000, processAlive: () => true } });
  assert.equal(await read(root, 'captions.json'), '可');
}));

test('2 つのプロセスが同じ hash を読んで書くと片方だけ Conflict になる', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'write-transaction-child.mjs');
  const run = next => new Promise((resolve, reject) => {
    const child = fork(helper, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    child.on('error', reject);
    child.on('exit', code => { if (code !== 0) reject(new Error(`子プロセスが終了しました: ${code}`)); });
    child.on('message', message => { resolve(message); child.disconnect(); });
    child.send({ root, hash: projectFileHash('前'), next });
  });
  const results = await Promise.all([run('甲'), run('乙')]);
  assert.equal(results.filter(result => result.code === 'AKARI_WRITE_CONFLICT').length, 1);
  assert.ok(['甲', '乙'].includes(await read(root, 'captions.json')));
}));

test('同じプロセスの並行書き込みは順に通る', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  const hash = projectFileHash('前');
  const results = await Promise.allSettled(['甲', '乙'].map(next =>
    writeProjectFilesTransactional(root, { label: '並行', files: {
      'captions.json': { expectedHash: hash, next },
    } })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'AKARI_WRITE_CONFLICT').length, 1);
}));

test('従来の殻は edit → 刻印 → 通知の順で null 候補を飛ばす', async () => fixture(async root => {
  const calls = [];
  await writeProjectFilesGuarded(root, { 'edit.json': '{}', 'captions.json': null }, {
    appVersion: '1.2.3', debounceMs: 5, lintRunner: async () => ({ pass: true, errors: [], findings: [] }),
    onDidWrite: path => calls.push(path.endsWith('edit.json') ? 'edit' : '別'),
  });
  assert.deepEqual(calls, ['edit']);
  assert.match(await read(root, '.akari/saved-by.json'), /1\.2\.3/);
  await assert.rejects(read(root, 'captions.json'));
}));
