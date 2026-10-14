import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { projectFileHash, writeProjectFilesTransactional, writeProjectFilesGuarded,
  recoverInterruptedProjectWrite, recoverInterruptedProjectWriteDetailed } from '../lib/write-gate.js';
import { projectFileContentHash } from '../lib/index.js';
import { planCaptionStyleEdit } from '../lib/index.js';

const fixture = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'akari-write-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const read = (root, name) => readFile(join(root, name), 'utf8');
const busy = () => Object.assign(new Error('削除待ち'), { code: 'EBUSY' });
const forkRequest = (helper, request) => new Promise((resolve, reject) => {
  const child = fork(helper, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let received = false;
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (!received) reject(new Error(`子プロセスが応答前に終了しました: ${code ?? signal}`));
  });
  child.once('message', message => { received = true; resolve(message); child.disconnect(); });
  child.send(request, error => { if (error) reject(error); });
});

test('比較なしの保存は journal と work を作らず相対名を正規化する', async () => fixture(async root => {
  const notified = [];
  const result = await writeProjectFilesTransactional(root, { label: '通常', files: { './edit.json': { next: '新' } } },
    { onDidWrite: (_path, _text, name) => { notified.push(name); } });
  assert.deepEqual(result.written, ['edit.json']);
  assert.deepEqual(notified, ['edit.json']);
  await assert.rejects(stat(join(root, '.akari/work')), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, '.akari/write-journal.json')), { code: 'ENOENT' });
}));

test('同じ相対先と予約された書き込み先を拒む', async () => fixture(async root => {
  for (const files of [
    { 'edit.json': { next: 'a' }, './edit.json': { next: 'b' } },
    { 'edit.json': { next: 'a' }, 'EDIT.JSON': { next: 'b' } },
    { '.akari/write.lock': { next: 'a' } },
    { '.akari/write.lock.wait': { next: 'a' } },
    { '.akari/write.lock.claim': { next: 'a' } },
    { '.akari/write.lock.claim/child': { next: 'a' } },
    { '.akari/write.lock.probe-test': { next: 'a' } },
    { '.akari/write-journal.json': { next: 'a' } },
    { '.akari/work/journal/a': { next: 'a' } },
    { 'edit.json:stream': { next: 'a' } }
  ]) await assert.rejects(writeProjectFilesTransactional(root, { label: '拒否', files }));
}));

test('比較なしで毎回書く保存は書き先を読まない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  await writeFile(join(root, 'captions.json'), '前');
  await writeFile(join(root, 'edit.json'), '旧');
  const reads = [];
  await writeProjectFilesTransactional(root, { label: '比較なし', files: {
    'captions.json': { next: '後' }, 'edit.json': { next: '新' }
  } }, { writeUnchanged: true, hooks: { fs: {
    readFile: async (...args) => { reads.push(args[0]); return fs.readFile(...args); }
  } } });
  assert.deepEqual(reads, [join(root, '.akari', 'write-journal.json')]);
}));

test('競り合いの無い保存は lock と journal と印への既定の呼び出し回数を保つ', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  const marker = join(root, '.akari', 'write.lock.wait');
  const journal = join(root, '.akari', 'write-journal.json');
  const calls = { lockCreate: 0, journalRead: 0, lockRemove: 0, markerRemove: 0 };
  await mkdir(join(root, '.akari'));
  await writeProjectFilesTransactional(root, { label: '通常', files: { 'edit.json': { next: '一' } } }, {
    writeUnchanged: true, hooks: { fs: {
      writeFile: async (...args) => {
        if (args[0] === lock && args[2]?.flag === 'wx') calls.lockCreate++;
        return fs.writeFile(...args);
      },
      readFile: async (...args) => {
        if (args[0] === journal) calls.journalRead++;
        return fs.readFile(...args);
      },
      unlink: async path => {
        if (path === lock) calls.lockRemove++;
        if (path === marker) calls.markerRemove++;
        return fs.unlink(path);
      }
    } }
  });
  assert.deepEqual(calls, { lockCreate: 1, journalRead: 1, lockRemove: 1, markerRemove: 1 });
}));

test('待ち手の印を消すと次の取得を譲り、印が無ければ譲らない', async () => fixture(async root => {
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const fs = await import('node:fs/promises');
  const marker = join(root, '.akari', 'write.lock.wait');
  await mkdir(join(root, '.akari'));
  await writeFile(marker, '');
  let removedAt = 0;
  await writeProjectFilesTransactional(root, { label: '印あり', files: { 'edit.json': { next: '一' } } },
    { writeUnchanged: true, hooks: { fs: { unlink: async path => {
      await fs.unlink(path);
      if (path === marker) removedAt = Date.now();
    } } } });
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  const deadline = state.yieldUntil.get(root);
  assert.ok(deadline > removedAt);
  let acquiredAt = 0;
  await writeProjectFilesTransactional(root, { label: '譲る', files: { 'edit.json': { next: '二' } } }, {
    writeUnchanged: true, hooks: { fs: { writeFile: async (...args) => {
      if (String(args[0]).endsWith('write.lock')) acquiredAt = Date.now();
      return fs.writeFile(...args);
    } } }
  });
  assert.ok(acquiredAt >= deadline - 5);
  const yieldedAt = state.yieldUntil.get(root);
  await writeProjectFilesTransactional(root, { label: '印なし', files: { 'edit.json': { next: '三' } } },
    { writeUnchanged: true });
  assert.equal(state.yieldUntil.get(root), yieldedAt);
}));

test('lock を待つ側は印を置き、次に放す側が一回で消す', async () => fixture(async root => {
  await mkdir(join(root, '.akari'));
  await writeFile(join(root, '.akari', 'write.lock'), JSON.stringify({
    pid: process.pid, host: hostname(), created_at: new Date().toISOString(), nonce: '別の持ち主'
  }));
  await assert.rejects(writeProjectFilesTransactional(root, { label: '待機', files: {
    'edit.json': { next: '不可' }
  } }, { waitTimeoutMs: 30, writeUnchanged: true }), /待ち時間/);
  const marker = join(root, '.akari', 'write.lock.wait');
  assert.equal((await stat(marker)).isFile(), true);
  await rm(join(root, '.akari', 'write.lock'));
  await writeProjectFilesTransactional(root, { label: '解放', files: { 'edit.json': { next: '可' } } },
    { writeUnchanged: true });
  await assert.rejects(stat(marker), { code: 'ENOENT' });
}));

test('lock 作成の EPERM は待ちの印を置かず次の取得も譲らない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const lock = join(root, '.akari', 'write.lock');
  const marker = join(root, '.akari', 'write.lock.wait');
  let failures = 2, markerCreates = 0;
  const hooks = { fs: { writeFile: async (...args) => {
    if (args[0] === marker && args[2]?.flag === 'wx') markerCreates++;
    if (args[0] === lock && args[2]?.flag === 'wx') {
      if (failures-- > 0) throw Object.assign(new Error('削除待ち'), { code: 'EPERM' });
    }
    return fs.writeFile(...args);
  } } };
  await writeProjectFilesTransactional(root, { label: '再試行', files: { 'edit.json': { next: '一' } } }, { hooks });
  assert.equal(markerCreates, 0);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  assert.equal(state.yieldUntil.has(root), false);
  const yieldedAt = state.yieldUntil.get(root);
  await writeProjectFilesTransactional(root, { label: '次', files: { 'edit.json': { next: '二' } } }, { hooks });
  assert.equal(state.yieldUntil.get(root), yieldedAt);
  assert.equal(markerCreates, 0);
}));

test('EEXIST の後に lock が消えていたら待ちの印を置かない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  const marker = join(root, '.akari', 'write.lock.wait');
  await mkdir(dirname(lock));
  let first = true, markerCreates = 0;
  await writeProjectFilesTransactional(root, { label: '消えた持ち主', files: { 'edit.json': { next: '一' } } }, {
    hooks: { fs: { writeFile: async (...args) => {
      if (args[0] === marker && args[2]?.flag === 'wx') markerCreates++;
      if (args[0] === lock && args[2]?.flag === 'wx' && first) {
        first = false;
        throw Object.assign(new Error('直前に解放'), { code: 'EEXIST' });
      }
      return fs.writeFile(...args);
    } } }
  });
  assert.equal(markerCreates, 0);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
}));

test('生きた持ち主を待って作った印は取得直後に自分で消す', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const lock = join(root, '.akari', 'write.lock');
  const marker = join(root, '.akari', 'write.lock.wait');
  await mkdir(dirname(lock));
  await writeFile(lock, JSON.stringify({
    pid: process.pid, host: hostname(), created_at: new Date().toISOString(), nonce: '別の持ち主'
  }));
  let markerCreates = 0, markerRemoves = 0;
  const hooks = { fs: {
    writeFile: async (...args) => {
      if (args[0] === marker && args[2]?.flag === 'wx') {
        markerCreates++;
        await fs.writeFile(...args);
        await fs.unlink(lock);
        return;
      }
      return fs.writeFile(...args);
    },
    unlink: async path => {
      await fs.unlink(path);
      if (path === marker) markerRemoves++;
    }
  } };
  await writeProjectFilesTransactional(root, { label: '待機', files: { 'edit.json': { next: '一' } } }, { hooks });
  assert.equal(markerCreates, 1);
  assert.equal(markerRemoves, 1);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  assert.equal(state.yieldUntil.has(root), false);
  const yieldedAt = state.yieldUntil.get(root);
  await writeProjectFilesTransactional(root, { label: '次', files: { 'edit.json': { next: '二' } } }, { hooks });
  assert.equal(state.yieldUntil.get(root), yieldedAt);
}));

test('自分の印を消した後に別の待ち手が置いた印には譲る', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const lock = join(root, '.akari', 'write.lock');
  const marker = join(root, '.akari', 'write.lock.wait');
  await mkdir(dirname(lock));
  await writeFile(lock, JSON.stringify({
    pid: process.pid, host: hostname(), created_at: new Date().toISOString(), nonce: '別の持ち主'
  }));
  let markerRemoves = 0, acquiredAt = 0;
  const hooks = { fs: {
    writeFile: async (...args) => {
      if (args[0] === marker && args[2]?.flag === 'wx') {
        await fs.writeFile(...args);
        await fs.unlink(lock);
        return;
      }
      if (args[0] === lock && args[2]?.flag === 'wx') acquiredAt = Date.now();
      return fs.writeFile(...args);
    },
    unlink: async path => {
      await fs.unlink(path);
      if (path === marker && ++markerRemoves === 1) await fs.writeFile(marker, '');
    }
  } };
  await writeProjectFilesTransactional(root, { label: '二人待ち', files: { 'edit.json': { next: '一' } } }, { hooks });
  assert.equal(markerRemoves, 2);
  const deadline = state.yieldUntil.get(root);
  assert.equal(typeof deadline, 'number');
  await writeProjectFilesTransactional(root, { label: '次', files: { 'edit.json': { next: '二' } } }, { hooks });
  assert.ok(acquiredAt >= deadline - 5);
}));

test('lock の削除が三回塞がれても裏で消し、次の保存は待たない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  let failures = 3;
  await writeProjectFilesTransactional(root, { label: '先', files: { 'edit.json': { next: '先' } } }, {
    writeUnchanged: true, hooks: { fs: { unlink: async path => {
      if (path.endsWith('write.lock') && failures-- > 0) throw busy();
      return fs.unlink(path);
    } } }
  });
  assert.equal(failures, 2);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await stat(join(root, '.akari', 'write.lock')).then(() => false,
      error => error.code === 'ENOENT')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await assert.rejects(stat(join(root, '.akari', 'write.lock')), { code: 'ENOENT' });
  failures = 3;
  await writeProjectFilesTransactional(root, { label: '再び塞ぐ', files: { 'edit.json': { next: '間' } } }, {
    writeUnchanged: true, hooks: { fs: { unlink: async path => {
      if (path.endsWith('write.lock') && failures-- > 0) throw busy();
      return fs.unlink(path);
    } } }
  });
  const began = Date.now();
  await writeProjectFilesTransactional(root, { label: '次', files: { 'edit.json': { next: '次' } } },
    { writeUnchanged: true });
  assert.ok(Date.now() - began < 10_000);
  await assert.rejects(stat(join(root, '.akari', 'write.lock')), { code: 'ENOENT' });
}));

test('lock の削除が一回失敗した保存はその場で待たず裏の回収より先に返る', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  let attempts = 0;
  await writeProjectFilesTransactional(root, { label: '保存', files: { 'edit.json': { next: '内容' } } }, {
    hooks: { fs: { unlink: async path => {
      if (path === lock && ++attempts === 1) throw busy();
      return fs.unlink(path);
    } } }
  });
  assert.equal(attempts, 1);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await stat(lock).then(() => false, error => error.code === 'ENOENT')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await assert.rejects(stat(lock), { code: 'ENOENT' });
  assert.equal(attempts, 2);
}));

test('lock 作成の EPERM を再試行し削除の EBUSY でも保存を成功させる', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  let createFailures = 3, deleteFailures = 2;
  const hooks = { fs: {
    writeFile: async (...args) => { if (args[2]?.flag === 'wx' && createFailures-- > 0)
      throw Object.assign(new Error('作成待ち'), { code: 'EPERM' });
      return fs.writeFile(...args); },
    unlink: async path => { if (path.endsWith('write.lock') && deleteFailures-- > 0) throw busy();
      return fs.unlink(path); }
  } };
  await writeProjectFilesTransactional(root, { label: '再試行', files: { 'edit.json': { next: '一' } } }, { hooks });
  assert.equal(await read(root, 'edit.json'), '一');
  assert.ok(createFailures < 0);
  await writeProjectFilesTransactional(root, { label: '再取得', files: { 'edit.json': { next: '二' } } }, { hooks });
  await writeProjectFilesTransactional(root, { label: '解放', files: { 'edit.json': { next: '三' } } }, { hooks });
  assert.ok(deleteFailures < 0);
  await assert.rejects(stat(join(root, '.akari/write.lock')), { code: 'ENOENT' });
}));

test('消せなかった自分の lock は次の保存で待たずに回収する', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  await writeProjectFilesTransactional(root, { label: '先', files: { 'edit.json': { next: '先' } } }, {
    hooks: { fs: { unlink: async path => { if (path.endsWith('write.lock')) throw busy(); return fs.unlink(path); } } }
  });
  const started = Date.now();
  await writeProjectFilesTransactional(root, { label: '次', files: { 'edit.json': { next: '次' } } });
  assert.ok(Date.now() - started < 10_000);
  assert.equal(await read(root, 'edit.json'), '次');
}));

test('裏の lock 片付け中は回復と保存が同時に臨界区間へ入らない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  let entered;
  const backgroundEntered = new Promise(resolve => { entered = resolve; });
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  let removals = 0;
  await writeFile(join(root, 'edit.json'), '前');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '中断', files: {
    'edit.json': { expectedHash: projectFileHash('前'), next: '後' }
  } }, { hooks: { crashAfterJournal: true, fs: { unlink: async path => {
    if (path === lock && ++removals === 1) throw busy();
    if (path === lock && removals === 2) {
      await fs.unlink(path);
      entered();
      await gate;
      return;
    }
    return fs.unlink(path);
  } } } }));
  await backgroundEntered;
  await assert.rejects(stat(lock), { code: 'ENOENT' });
  let completed = 0;
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const backgroundChain = state.chains.get(root);
  const recovering = recoverInterruptedProjectWriteDetailed(root).then(result => { completed++; return result; });
  const queuedBy = Date.now() + 10_000;
  while (state.chains.get(root) === backgroundChain && Date.now() < queuedBy)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.notEqual(state.chains.get(root), backgroundChain);
  const recoveringChain = state.chains.get(root);
  const saving = writeProjectFilesTransactional(root, { label: '保存', files: {
    'captions.json': { next: '後' }
  } }).then(result => { completed++; return result; });
  assert.notEqual(state.chains.get(root), recoveringChain);
  assert.equal(completed, 0);
  resume();
  const [detail, written] = await Promise.all([recovering, saving]);
  assert.deepEqual(detail.restored, []);
  assert.deepEqual(written.written, ['captions.json']);
  assert.equal(await read(root, 'captions.json'), '後');
}));

test('印つき journal は成功した内容を戻さず片付ける', async () => fixture(async root => {
  await writeFile(join(root, 'edit.json'), '前');
  const fs = await import('node:fs/promises');
  await writeProjectFilesTransactional(root, { label: '成功', files: {
    'edit.json': { expectedHash: projectFileHash('前'), next: '後' }
  } }, { hooks: { fs: { unlink: async path => {
    if (path.endsWith('write-journal.json')) throw busy();
    return fs.unlink(path);
  } } } });
  assert.equal((JSON.parse(await read(root, '.akari/write-journal.json'))).committed, true);
  assert.equal(await read(root, 'edit.json'), '後');
  await writeProjectFilesTransactional(root, { label: '別', files: { 'captions.json': { next: '別' } } });
  assert.equal(await read(root, 'edit.json'), '後');
}));

test('印と journal 削除が両方失敗しても次の保存は成功を巻き戻さない', async () => fixture(async root => {
  await writeFile(join(root, 'edit.json'), '前');
  const fs = await import('node:fs/promises');
  await writeProjectFilesTransactional(root, { label: '完了', files: {
    'edit.json': { expectedHash: projectFileHash('前'), next: '後' }
  } }, { hooks: { fs: {
    writeFile: async (...args) => { if (String(args[1]).includes('"committed": true')) throw busy();
      return fs.writeFile(...args); },
    unlink: async path => { if (path.endsWith('write-journal.json')) throw busy(); return fs.unlink(path); }
  } } });
  assert.equal((JSON.parse(await read(root, '.akari/write-journal.json'))).committed, undefined);
  await writeProjectFilesTransactional(root, { label: '次', files: { 'captions.json': { next: '次' } } });
  assert.equal(await read(root, 'edit.json'), '後');
}));

test('退避が無い journal は通知して続く保存を塞がない', async () => fixture(async root => {
  await writeFile(join(root, 'edit.json'), '前');
  await assert.rejects(writeProjectFilesTransactional(root, { label: '落下', files: {
    'edit.json': { expectedHash: projectFileHash('前'), next: '後' }
  } }, { hooks: { crashAfterFirstRename: true } }));
  await rm(join(root, '.akari/work'), { recursive: true, force: true });
  const detail = await recoverInterruptedProjectWriteDetailed(root);
  assert.deepEqual(detail.missing, ['edit.json']);
  for (let index = 0; index < 3; index++) await writeProjectFilesTransactional(root,
    { label: '継続', files: { 'captions.json': { next: String(index) } } });
  assert.equal(await read(root, 'edit.json'), '後');
}));

test('journal が無ければ生きた lock があっても回復はすぐ返る', async () => fixture(async root => {
  await mkdir(join(root, '.akari'));
  await writeFile(join(root, '.akari/write.lock'), JSON.stringify({
    pid: process.pid, host: hostname(), created_at: new Date().toISOString()
  }));
  const started = Date.now();
  assert.equal(await recoverInterruptedProjectWrite(root), undefined);
  assert.ok(Date.now() - started < 10_000);
}));

test('journal が無い新しいプロジェクトを開いても .akari を作らない', async () => fixture(async root => {
  assert.equal(await recoverInterruptedProjectWrite(root), undefined);
  await assert.rejects(stat(join(root, '.akari')), { code: 'ENOENT' });
}));

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
    '.akari/write.lock.wait',
    '.akari/write-journal.json']) {
    await assert.rejects(stat(join(root, name)), { code: 'ENOENT' });
  }
  await assert.rejects(stat(join(root, '.akari/work')), { code: 'ENOENT' });
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
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' }, 'edit.json': { next: '後' },
  } }, { hooks: { rename: async (from, to, index) => {
    if (index === 2) throw new Error('失敗');
    await rename(from, to);
  } } }), /失敗/);
  await assert.rejects(stat(join(root, '.akari/work/journal')), { code: 'ENOENT' });
  await assert.rejects(writeProjectFilesTransactional(root, { label: '中断', files: {
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
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
    'captions.json': { expectedHash: projectFileHash(original), next: '新' }, 'edit.json': { next: '新' },
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
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
  } }, { hooks: { crashAfterJournal: true } }));
  let notice;
  const result = await writeProjectFilesTransactional(root, { label: '次', files: {
    'captions.json': { next: '次' },
  } }, { onRecovered: value => { notice = value; } });
  assert.match(notice, /前回の書き込みが途中で止まっていました/);
  assert.match(notice, /ファイルは元のままでした/);
  assert.doesNotMatch(notice, /元に戻しました/);
  assert.equal(result.recovered, notice);
  assert.equal(await read(root, 'captions.json'), '次');
}));

test('1 つ目の rename 後に落ちたら次の比較前に元のバイト列へ戻す', async () => fixture(async root => {
  const original = Buffer.from([0, 255, 10]);
  await writeFile(join(root, 'captions.json'), original);
  await assert.rejects(writeProjectFilesTransactional(root, { label: '落下', files: {
    'captions.json': { expectedHash: projectFileHash(original), next: '後' },
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
    'captions.json': { expectedHash: projectFileHash('前'), next: '後' },
  } }, { hooks: { crashAfterFirstRename: true } }));
  await writeFile(join(root, 'captions.json'), '第三者');
  const notice = await recoverInterruptedProjectWrite(root);
  assert.match(notice, /その後に変更されていたのでそのまま/);
  assert.doesNotMatch(notice, /元に戻しました/);
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

test('長く待って奪った lock は取得時刻を刻み別の待ち手に奪われない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  const state = globalThis[Symbol.for('akari.edit-store.write-locks')];
  const base = Date.now();
  let clock = base;
  let attempted;
  const firstAttempt = new Promise(resolve => { attempted = resolve; });
  await mkdir(dirname(lock));
  await writeFile(lock, JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date(base).toISOString(), nonce: '生きた持ち主' }));
  const first = writeProjectFilesTransactional(root, { label: '奪取', files: {
    'edit.json': { next: '新' }
  } }, { waitTimeoutMs: 20_000, hooks: { now: () => clock, processAlive: () => true,
    fs: { writeFile: async (...args) => {
      if (args[0] === lock && args[2]?.flag === 'wx' && clock === base) {
        try { return await fs.writeFile(...args); }
        catch (error) { attempted(); throw error; }
      }
      if (args[0] === lock && args[2]?.flag === 'wx' && clock > base + 30_000) {
        await fs.writeFile(...args);
        assert.equal(JSON.parse(await readFile(lock, 'utf8')).created_at,
          new Date(clock).toISOString());
        // 排他 lock 自体の競り合いを見るため、この試験の二番手だけプロセス内の鎖を外す。
        state.chains.delete(root);
        await assert.rejects(writeProjectFilesTransactional(root, { label: '別の待ち手', files: {
          'captions.json': { next: '不可' }
        } }, { waitTimeoutMs: 25, hooks: { now: () => clock, processAlive: () => true } }), /待ち時間/);
        return;
      }
      return fs.writeFile(...args);
    } }
  } });
  await firstAttempt;
  clock = base + 30_001;
  await first;
  assert.equal(await read(root, 'edit.json'), '新');
}));

test('古い claim は片付けて奪取し新しい claim は保持する', async () => fixture(async root => {
  const lock = join(root, '.akari', 'write.lock');
  const claim = `${lock}.claim`;
  await mkdir(claim, { recursive: true });
  await writeFile(join(claim, '残骸'), '');
  await writeFile(lock, JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date().toISOString(), nonce: '死んだ持ち主' }));
  const old = new Date(Date.now() - 31_000);
  await utimes(claim, old, old);
  await writeProjectFilesTransactional(root, { label: '古い claim', files: {
    'edit.json': { next: '成功' }
  } }, { hooks: { processAlive: () => false } });
  assert.equal(await read(root, 'edit.json'), '成功');
  await assert.rejects(stat(claim), { code: 'ENOENT' });
  await assert.rejects(stat(lock), { code: 'ENOENT' });
  await mkdir(claim);
  await writeFile(lock, JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date().toISOString(), nonce: '死んだ持ち主' }));
  await assert.rejects(writeProjectFilesTransactional(root, { label: '新しい claim', files: {
    'edit.json': { next: '不可' }
  } }, { waitTimeoutMs: 30, hooks: { processAlive: () => false } }), /待ち時間/);
  assert.equal((await stat(claim)).isDirectory(), true);
}));

test('生きた claim は作成から三十秒まで保持し死んだ claim は mtime の五秒後に消す', async () => fixture(async root => {
  const lock = join(root, '.akari', 'write.lock'), claim = `${lock}.claim`;
  await mkdir(claim, { recursive: true });
  await writeFile(lock, JSON.stringify({ pid: 456, host: hostname(), created_at: new Date().toISOString(), nonce: 'old' }));
  await writeFile(join(claim, 'owner.json'), JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date(Date.now() - 6_000).toISOString() }));
  await assert.rejects(writeProjectFilesTransactional(root, { label: 'live claim', files: {
    'edit.json': { next: 'blocked' }
  } }, { waitTimeoutMs: 30, hooks: { processAlive: pid => pid === 123 } }), /待ち時間/);
  assert.equal((await stat(claim)).isDirectory(), true);
  const old = new Date(Date.now() - 6_000);
  await utimes(claim, old, old);
  await writeProjectFilesTransactional(root, { label: 'dead claim', files: {
    'edit.json': { next: 'saved' }
  } }, { hooks: { processAlive: () => false } });
  assert.equal(await read(root, 'edit.json'), 'saved');
  await assert.rejects(stat(claim), { code: 'ENOENT' });
}));

for (const sample of [
  { name: '生きた pid の claim は二十九秒で保持する', owner: { pid: 123, host: hostname() }, age: 29_000, blocked: true },
  { name: '生きた pid の claim は三十一秒で消す', owner: { pid: 123, host: hostname() }, age: 31_000 },
  { name: '自分の pid の取り残し claim は直ちに消す', owner: { pid: process.pid, host: hostname() }, age: 0 },
  { name: 'pid 0 の claim は五秒後に消す', owner: { pid: 0, host: hostname() }, age: 6_000 },
  { name: '生きた pid 4 の claim は三十一秒で消す', owner: { pid: 4, host: hostname() }, age: 31_000 },
  { name: '小数 pid の claim は五秒後に消す', owner: { pid: 2.5, host: hostname() }, age: 6_000 },
  { name: '負の pid の claim は五秒後に消す', owner: { pid: -1, host: hostname() }, age: 6_000 },
  { name: '文字列 pid の claim は五秒後に消す', owner: { pid: '4', host: hostname() }, age: 6_000 },
  { name: '未来の作成時刻の claim は mtime 三十一秒で消す', owner: { pid: 123, host: hostname() }, age: 31_000, future: true },
  { name: '空の owner.json の claim は五秒後に消す', raw: '', age: 6_000 },
  { name: 'null の owner.json の claim は五秒後に消す', raw: 'null', age: 6_000 },
  { name: '壊れた owner.json の claim は五秒後に消す', raw: '{', age: 6_000 },
  { name: 'owner.json の無い claim は五秒後に消す', age: 6_000 },
  { name: '別 host の claim は五秒後に消す', owner: { pid: 123, host: 'other-host' }, age: 6_000 },
  { name: '死んだ pid の claim は五秒後に消す', owner: { pid: 123, host: hostname() }, age: 6_000, dead: true }
]) test(sample.name, async () => fixture(async root => {
  const clock = Date.now();
  const lock = join(root, '.akari', 'write.lock'), claim = `${lock}.claim`;
  await mkdir(claim, { recursive: true });
  await writeFile(lock, JSON.stringify({ pid: 456, host: hostname(),
    created_at: new Date(clock - 31_000).toISOString(), nonce: 'old' }));
  if (sample.owner) await writeFile(join(claim, 'owner.json'), JSON.stringify({ ...sample.owner,
    created_at: new Date(clock + (sample.future ? 10_000 : -sample.age)).toISOString() }));
  else if (sample.raw !== undefined) await writeFile(join(claim, 'owner.json'), sample.raw);
  const old = new Date(clock - sample.age);
  await utimes(claim, old, old);
  const mkdirClaim = async (...args) => {
    if (args[0] === claim && sample.blocked) {
      try { await stat(claim); }
      catch (error) { if (error.code === 'ENOENT') return mkdir(...args); throw error; }
      throw Object.assign(new Error('CLAIM_HELD'), { code: 'CLAIM_HELD' });
    }
    return mkdir(...args);
  };
  const attempt = writeProjectFilesTransactional(root, { label: 'claim', files: { 'edit.json': { next: 'saved' } } },
    { hooks: { now: () => clock, processAlive: pid => !sample.dead && (pid === 123 || pid === 4),
      fs: { mkdir: mkdirClaim } } });
  if (sample.blocked) {
    await assert.rejects(attempt, /CLAIM_HELD/);
    assert.equal((await stat(claim)).isDirectory(), true);
  } else {
    await attempt;
    assert.equal(await read(root, 'edit.json'), 'saved');
    await assert.rejects(stat(claim), { code: 'ENOENT' });
  }
}));

test('五秒より古い試し書きの残骸を次の保存で掃除する', async () => fixture(async root => {
  const folder = join(root, '.akari');
  await mkdir(folder);
  const probe = join(folder, 'write.lock.probe-leftover');
  await writeFile(probe, '');
  const old = new Date(Date.now() - 6_000);
  await utimes(probe, old, old);
  await writeProjectFilesTransactional(root, { label: 'probe cleanup', files: { 'edit.json': { next: 'saved' } } });
  await assert.rejects(stat(probe), { code: 'ENOENT' });
}));

test('claim の後始末が失敗しても次の自分の保存で回収する', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock'), claim = `${lock}.claim`;
  await mkdir(dirname(lock));
  await writeFile(lock, JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date(Date.now() - 31_000).toISOString(), nonce: 'old' }));
  await writeProjectFilesTransactional(root, { label: 'first', files: { 'edit.json': { next: 'one' } } },
    { hooks: { processAlive: () => false, fs: { rm: async (path, options) => {
      if (path === claim) throw Object.assign(new Error('busy'), { code: 'EIO' });
      return fs.rm(path, options);
    } } } });
  assert.equal((await stat(claim)).isDirectory(), true);
  await writeFile(lock, JSON.stringify({ pid: 123, host: hostname(),
    created_at: new Date(Date.now() - 31_000).toISOString(), nonce: 'old-again' }));
  await writeProjectFilesTransactional(root, { label: 'second', files: { 'edit.json': { next: 'two' } } },
    { hooks: { processAlive: () => false } });
  assert.equal(await read(root, 'edit.json'), 'two');
  await assert.rejects(stat(claim), { code: 'ENOENT' });
}));

test('試し書きの後始末が失敗しても次の保存で古い残骸を掃除する', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  await mkdir(dirname(lock));
  let blocked = true, probe;
  await writeProjectFilesTransactional(root, { label: 'first', files: { 'edit.json': { next: 'one' } } },
    { hooks: { fs: {
      writeFile: async (...args) => {
        if (args[0] === lock && blocked) throw Object.assign(new Error('busy'), { code: 'EPERM' });
        if (String(args[0]).includes('write.lock.probe-')) { probe = args[0]; blocked = false; }
        return fs.writeFile(...args);
      },
      unlink: async path => {
        if (path === probe) throw Object.assign(new Error('busy'), { code: 'EIO' });
        return fs.unlink(path);
      }
    } } });
  assert.equal(await read(root, 'edit.json'), 'one');
  assert.ok(probe);
  const old = new Date(Date.now() - 6_000);
  await utimes(probe, old, old);
  await writeProjectFilesTransactional(root, { label: 'second', files: { 'edit.json': { next: 'two' } } });
  assert.equal(await read(root, 'edit.json'), 'two');
  await assert.rejects(stat(probe), { code: 'ENOENT' });
}));

test('試し書きの unlink が一回 EBUSY でも保存でき残骸を残さない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  let blocked = true, failed = false;
  const lock = join(root, '.akari', 'write.lock');
  await mkdir(dirname(lock));
  await writeProjectFilesTransactional(root, { label: 'probe', files: { 'edit.json': { next: 'saved' } } },
    { hooks: { fs: {
      writeFile: async (...args) => {
        if (args[0] === lock && blocked) throw Object.assign(new Error('busy'), { code: 'EPERM' });
        if (String(args[0]).includes('write.lock.probe-')) blocked = false;
        return fs.writeFile(...args);
      },
      unlink: async path => {
        if (String(path).includes('write.lock.probe-') && !failed) { failed = true; throw busy(); }
        return fs.unlink(path);
      }
    } } });
  assert.equal(await read(root, 'edit.json'), 'saved');
  assert.equal(failed, true);
  assert.equal((await fs.readdir(join(root, '.akari'))).some(name => name.startsWith('write.lock.probe-')), false);
}));

test('使い直した lock が別の持ち主に替わったら放すときに消さない', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  let first = true;
  await writeProjectFilesTransactional(root, { label: 'first', files: { 'edit.json': { next: 'one' } } },
    { hooks: { fs: { unlink: async path => {
      if (path === lock && first) { first = false; throw busy(); }
      return fs.unlink(path);
    } } } });
  const replacement = JSON.stringify({ pid: 999, host: hostname(), created_at: new Date().toISOString(), nonce: 'other' });
  let lockReads = 0;
  await writeProjectFilesTransactional(root, { label: 'reuse', files: { 'edit.json': { next: 'two' } } },
    { hooks: { fs: { readFile: async (...args) => {
      if (args[0] === lock && ++lockReads === 2) await fs.writeFile(lock, replacement);
      return fs.readFile(...args);
    } } } });
  assert.equal(await read(root, 'edit.json'), 'two');
  assert.equal(await readFile(lock, 'utf8'), replacement);
}));

test('書き込めないフォルダは元の EPERM で早く失敗する', async () => fixture(async root => {
  const lock = join(root, '.akari', 'write.lock');
  await mkdir(dirname(lock));
  const original = Object.assign(new Error('権限なし'), { code: 'EPERM' });
  let lockAttempts = 0, probeAttempts = 0;
  const started = Date.now();
  await assert.rejects(writeProjectFilesTransactional(root, { label: '権限', files: {
    'edit.json': { next: '不可' }
  } }, { hooks: { fs: { writeFile: async (path, ...args) => {
    if (path === lock && args[1]?.flag === 'wx') lockAttempts++;
    if (String(path).includes('write.lock.probe-')) probeAttempts++;
    throw original;
  } } } }), error => error === original);
  assert.ok(Date.now() - started < 10_000);
  assert.ok(lockAttempts >= 5);
  assert.ok(probeAttempts >= 1);
}));

test('lock 名だけの EPERM は試し書き成功後も取り直す', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const lock = join(root, '.akari', 'write.lock');
  await mkdir(dirname(lock));
  let blocked = true, probes = 0;
  const result = writeProjectFilesTransactional(root, { label: '競り合い', files: {
    'edit.json': { next: '成功' }
  } }, { waitTimeoutMs: 20_000, hooks: { fs: { writeFile: async (...args) => {
    if (args[0] === lock && blocked) throw Object.assign(new Error('競り合い'), { code: 'EPERM' });
    if (String(args[0]).includes('write.lock.probe-')) { probes++; blocked = false; }
    return fs.writeFile(...args);
  } } } });
  await result;
  assert.ok(probes > 0);
  assert.equal(await read(root, 'edit.json'), '成功');
}));

for (const code of ['EBUSY', 'EPERM']) {
  test(`lock 作成が 40 回 EPERM でも試し書きが成功し、unlink が ${code} で失敗し続けても保存できる`,
    async () => fixture(async root => {
      const fs = await import('node:fs/promises');
      const lock = join(root, '.akari', 'write.lock');
      await mkdir(dirname(lock));
      let blocked = 40, probes = 0;
      await writeProjectFilesTransactional(root, { label: '競り合い', files: {
        'edit.json': { next: '成功' }
      } }, { waitTimeoutMs: 8_000, hooks: { fs: {
        writeFile: async (...args) => {
          if (args[0] === lock && args[2]?.flag === 'wx' && blocked-- > 0)
            throw Object.assign(new Error('競り合い'), { code: 'EPERM' });
          if (String(args[0]).includes('write.lock.probe-')) probes++;
          return fs.writeFile(...args);
        },
        unlink: async path => {
          if (String(path).includes('write.lock.probe-'))
            throw Object.assign(new Error('削除待ち'), { code });
          return fs.unlink(path);
        }
      } } });
      assert.equal(await read(root, 'edit.json'), '成功');
      assert.equal(blocked, -1);
      assert.ok(probes > 0 && probes <= 2);
      assert.ok((await fs.readdir(join(root, '.akari'))).filter(name => name.startsWith('write.lock.probe-')).length <= 2);
    }));
}

test('比較つきの読み取り EBUSY は再試行して保存する', async () => fixture(async root => {
  const fs = await import('node:fs/promises');
  const target = join(root, 'edit.json');
  await writeFile(target, '前');
  let failures = 2;
  await writeProjectFilesTransactional(root, { label: '比較', files: {
    'edit.json': { expectedHash: projectFileHash('前'), next: '後' }
  } }, { hooks: { fs: { readFile: async (...args) => {
    if (args[0] === target && failures-- > 0) throw busy();
    return fs.readFile(...args);
  } } } });
  assert.equal(failures, -1);
  assert.equal(await read(root, 'edit.json'), '後');
}));

test('2 つのプロセスが同じ hash を読んで書くと片方だけ Conflict になる', async () => fixture(async root => {
  await writeFile(join(root, 'captions.json'), '前');
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'write-transaction-child.mjs');
  const run = next => forkRequest(helper, { root, hash: projectFileHash('前'), next });
  const results = await Promise.all([run('甲'), run('乙')]);
  assert.equal(results.filter(result => result.code === 'AKARI_WRITE_CONFLICT').length, 1);
  assert.ok(['甲', '乙'].includes(await read(root, 'captions.json')));
}));

test('二つのプロセスが各 100 回の比較なし保存を失敗なく終える', async () => fixture(async root => {
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'write-transaction-child.mjs');
  const run = () => forkRequest(helper, { root, repeat: 100 });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map(result => result.written), [100, 100]);
  assert.equal(results.filter(result => result.message).length, 0);
  assert.ok(results.every(result => result.maxWaitMs < 20_000));
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
