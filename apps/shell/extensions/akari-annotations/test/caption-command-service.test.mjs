import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { projectFileHash, writeProjectFilesTransactional } from '../../../../../packages/edit-store/lib/write-gate.js';

const uri = path => pathToFileURL(path).toString();
const caption = extra => ({ id: 'c-0001', start: 0, end: 1, text: '猫',
  speaker: null, sourceRef: null, edited: false, ...extra });
async function fixture(fn, row = caption()) {
  const root = await mkdtemp(join(tmpdir(), 'akari-caption-rpc-'));
  const captionsPath = join(root, 'captions.json');
  const editPath = join(root, 'edit.json');
  await writeFile(captionsPath, `${JSON.stringify({ captions: [row] }, null, 2)}\n`);
  await writeFile(editPath, '{"version":2,"output":{"fps":30},"sources":[],"tracks":[]}\n');
  const request = { projectRootUri: uri(root), captionsUri: uri(captionsPath), editUri: uri(editPath) };
  try { await fn({ root, captionsPath, editPath, request, service: new AkariAnnotationsServiceImpl() }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const read = path => readFile(path, 'utf8');

test('Windows のドライブ文字と日本語 URI の大小差でも字幕コマンドと比較付き保存が通る',
  { skip: process.platform !== 'win32' }, async () => fixture(async f => {
    const folder = join(f.root, '日本語の字幕');
    await mkdir(folder);
    const editPath = join(folder, 'edit.json');
    const captionsPath = join(folder, 'captions.json');
    await writeFile(editPath, await read(f.editPath));
    await writeFile(captionsPath, await read(f.captionsPath));
    const caseUri = (path, drive) => {
      const value = new URL(uri(path));
      value.pathname = value.pathname.replace(/^\/[A-Za-z]:/u, `/${drive}:`);
      return value.toString();
    };
    const drive = /^file:\/\/\/([A-Za-z]):/u.exec(uri(folder))[1];
    const request = { projectRootUri: caseUri(folder, drive.toLowerCase()),
      editUri: caseUri(editPath, drive.toUpperCase()),
      captionsUri: caseUri(captionsPath, drive.toLowerCase()) };
    assert.match(request.captionsUri, /%E6%97%A5/u);
    const applied = await f.service.applyCaptionStyle({ ...request,
      input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#ffffff' } } } });
    assert.equal(applied.ok, true);
    const sized = await f.service.setCaptionSize({ ...request,
      input: { targets: [{ caption_id: 'c-0001' }], size_px: 72 } });
    assert.equal(sized.ok, true);
    const dry = await f.service.migrateCaptionLook({ ...request, input: { dryRun: true } });
    assert.equal(dry.ok, true);
    const before = await read(captionsPath);
    const snapshot = await f.service.writeEditSnapshot({ ...request, captionsSource: before,
      expectedHashes: { captions: projectFileHash(before) } });
    assert.equal(snapshot.conflict, undefined);
  }));

test('字幕の適用・解除・当て直し・大きさ変更 RPC が前後の全文を返す', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  const applied = await f.service.applyCaptionStyle({ ...f.request,
    expectedHashes: { captions: projectFileHash(before) },
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { size_px: 56, color: '#fff' } },
      source: { kind: 'my', id: 'test' } } });
  assert.equal(applied.ok, true);
  assert.equal(applied.before['captions.json'].text, before);
  assert.equal(applied.after['captions.json'].text, await read(f.captionsPath));
  const reapply = await f.service.reapplyCaptionStyle({ ...f.request,
    input: { styles: { entries: [{ source: { kind: 'my', id: 'test' }, look: { color: '#000' } }] },
      apply: [{ target: { caption_id: 'c-0001' }, part: 'look' }] } });
  assert.equal(reapply.ok, true);
  assert.ok(Array.isArray(reapply.items));
  const sized = await f.service.setCaptionSize({ ...f.request,
    input: { targets: [{ caption_id: 'c-0001' }], size_px: 72 } });
  assert.equal(sized.ok, true);
  assert.equal(JSON.parse(await read(f.captionsPath)).captions[0].text_style.size_px, 72);
  const cleared = await f.service.clearCaptionStyle({ ...f.request,
    input: { targets: [{ caption_id: 'c-0001' }], mode: 'run' } });
  assert.equal(cleared.ok, true);
}));

test('競合する期待 hash は何も書かず形のある結果を返す', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  const result = await f.service.applyCaptionStyle({ ...f.request,
    expectedHashes: { captions: projectFileHash('別の内容') },
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#fff' } } } });
  assert.deepEqual([result.ok, result.conflict, result.files], [false, true, ['captions.json']]);
  assert.equal(await read(f.captionsPath), before);
}));

test('字幕コマンド RPC は実行時に旧い入力欄を落とす', async () => fixture(async f => {
  const result = await f.service.applyCaptionStyle({ ...f.request, input: {
    targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#ffffff' } },
    legacy: { size: 'style' }, captions: { captions: [] }, edit: {}, assetReferences: {}, catalog: {}
  } });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(await read(f.captionsPath)).captions[0].text_style.color, '#ffffff');
}));

test('比較付きスナップショットも transitionOut を拒む', async () => fixture(async f => {
  const before = await read(f.editPath);
  await assert.rejects(f.service.writeEditSnapshot({ ...f.request,
    editSource: '{"transitionOut":1}', expectedHashes: { edit: projectFileHash(before) } }), /transitionOut/);
  assert.equal(await read(f.editPath), before);
}));

test('壊れた v1 は invalid と診断を返して保存しない', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  const result = await f.service.applyCaptionStyle({ ...f.request,
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#fff' } } } });
  assert.deepEqual([result.ok, result.invalid], [false, true]);
  assert.ok(result.diagnostics.length);
  assert.equal(await read(f.captionsPath), before);
}, caption({ runs: [{ id: 'r-0001', from: 0, to: 1, look: 5 }] })));

test('移行 RPC は dry-run と保存を分け競合時は元の値を保つ', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  const dry = await f.service.migrateCaptionLook({ ...f.request, input: { dryRun: true } });
  assert.equal(dry.ok, true);
  assert.equal(await read(f.captionsPath), before);
  const conflict = await f.service.migrateCaptionLook({ ...f.request,
    expectedHashes: { captions: projectFileHash('別') }, input: {} });
  assert.equal(conflict.conflict, true);
  assert.equal(await read(f.captionsPath), before);
  const saved = await f.service.migrateCaptionLook({ ...f.request, input: {} });
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(await read(f.captionsPath)).captions[0].style_preset, undefined);
}, caption({ style_preset: 'neon' })));

test('全文スナップショットの期待 hash は競合を返し、省略時は従来どおり書く', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  const conflict = await f.service.writeEditSnapshot({ ...f.request, captionsSource: '次',
    expectedHashes: { captions: projectFileHash('別') } });
  assert.equal(conflict.conflict, true);
  assert.equal(await read(f.captionsPath), before);
  const written = await f.service.writeEditSnapshot({ ...f.request, captionsSource: before });
  assert.deepEqual(written, { committed: false });
}));

test('中断した書き込みをプロジェクトを読む前に回復できる', async () => fixture(async f => {
  const before = await read(f.captionsPath);
  await assert.rejects(writeProjectFilesTransactional(f.root, { label: '落下', files: {
    'captions.json': { expectedHash: projectFileHash(before), next: '途中' }
  } }, { hooks: { crashAfterFirstRename: true } }));
  const result = await f.service.recoverInterruptedWrite({ projectRootUri: f.request.projectRootUri });
  assert.match(result.notice, /前回の書き込みが途中で止まったので元に戻しました: captions\.json/);
  assert.equal(await read(f.captionsPath), before);
}));

test('回復 RPC は戻したファイルが無い理由を正しく通知する', async () => {
  for (const mode of ['元のまま', 'その後に変更', '退避なし']) await fixture(async f => {
    const before = await read(f.captionsPath);
    await assert.rejects(writeProjectFilesTransactional(f.root, { label: '中断', files: {
      'captions.json': { expectedHash: projectFileHash(before), next: '途中' }
    } }, { hooks: { [mode === '元のまま' ? 'crashAfterJournal' : 'crashAfterFirstRename']: true } }));
    if (mode === 'その後に変更') await writeFile(f.captionsPath, '第三者');
    if (mode === '退避なし') await rm(join(f.root, '.akari', 'work'), { recursive: true });
    const result = await f.service.recoverInterruptedWrite({ projectRootUri: f.request.projectRootUri });
    assert.doesNotMatch(result.notice, /元に戻しました/);
    if (mode === '元のまま') assert.match(result.notice, /ファイルは元のままでした/);
    if (mode === 'その後に変更') assert.match(result.notice, /その後に変更されていたのでそのまま/);
    if (mode === '退避なし') assert.match(result.notice, /退避が見つからないので戻せませんでした/);
  });
});

test('回復 RPC は記録の無いプロジェクトに .akari を作らずファイルの URI を拒む', async () => fixture(async f => {
  assert.deepEqual(await f.service.recoverInterruptedWrite({ projectRootUri: f.request.projectRootUri }), {});
  await assert.rejects(stat(join(f.root, '.akari')), { code: 'ENOENT' });
  await assert.rejects(f.service.recoverInterruptedWrite({ projectRootUri: uri(f.editPath) }));
}));

test('別名タイムラインの適用は対象字幕だけを書き標準字幕を保つ', async () => fixture(async f => {
  const captionsPath = join(f.root, 'captions.b.json');
  const editPath = join(f.root, 'edit.b.json');
  const standard = await read(f.captionsPath);
  await writeFile(captionsPath, standard);
  await writeFile(editPath, await read(f.editPath));
  const result = await f.service.applyCaptionStyle({ ...f.request,
    captionsUri: uri(captionsPath), editUri: uri(editPath),
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#ffffff' } } } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.written, ['captions.b.json']);
  assert.equal(result.before['captions.b.json'].text, standard);
  assert.equal(result.after['captions.b.json'].text, await read(captionsPath));
  assert.equal(await read(f.captionsPath), standard);
}));

test('別名スナップショットの期待 hash は競合を検出する', async () => fixture(async f => {
  const captionsPath = join(f.root, 'captions.b.json');
  const editPath = join(f.root, 'edit.b.json');
  await writeFile(captionsPath, await read(f.captionsPath));
  await writeFile(editPath, await read(f.editPath));
  const before = await read(captionsPath);
  const result = await f.service.writeEditSnapshot({ ...f.request,
    captionsUri: uri(captionsPath), editUri: uri(editPath), captionsSource: '変更',
    expectedHashes: { captions: projectFileHash('別') } });
  assert.deepEqual([result.conflict, result.files], [true, ['captions.b.json']]);
  assert.equal(await read(captionsPath), before);
}));

test('比較付き RPC は競合と無変更を通知せず実書き込みだけ前後で通知する', async () => fixture(async f => {
  const calls = [];
  f.service.client = { onWillWrite: path => calls.push(`will:${path}`),
    onDidWrite: path => calls.push(`did:${path}`), onLintResult: () => {} };
  const before = await read(f.captionsPath);
  const conflict = await f.service.applyCaptionStyle({ ...f.request,
    expectedHashes: { captions: projectFileHash('別') },
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#ffffff' } } } });
  assert.equal(conflict.conflict, true);
  assert.deepEqual(calls, []);
  await f.service.writeEditSnapshot({ ...f.request, captionsSource: before,
    expectedHashes: { captions: projectFileHash(before) } });
  assert.deepEqual(calls, []);
  const result = await f.service.applyCaptionStyle({ ...f.request,
    input: { targets: [{ caption_id: 'c-0001' }], parts: { look: { color: '#ffffff' } } } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^will:.*captions\.json$/);
  assert.equal(calls[1], calls[0].replace(/^will:/, 'did:'));
}));

test('比較付きスナップショットは変わる edit だけ前後で通知する', async () => fixture(async f => {
  const calls = [];
  f.service.client = { onWillWrite: path => calls.push(`will:${path}`),
    onDidWrite: path => calls.push(`did:${path}`), onLintResult: () => {} };
  const captions = await read(f.captionsPath);
  const edit = await read(f.editPath);
  const result = await f.service.writeEditSnapshot({ ...f.request,
    captionsSource: captions, editSource: `${edit} `,
    expectedHashes: { captions: projectFileHash(captions), edit: projectFileHash(edit) } });
  assert.deepEqual(result, { committed: false });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^will:.*edit\.json$/);
  assert.equal(calls[1], calls[0].replace(/^will:/, 'did:'));
}));
