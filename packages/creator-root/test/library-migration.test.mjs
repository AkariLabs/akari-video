import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCreatorRoot, migrateAssetLibrary, resolveAssetLibraryRoots, readLibraryLocation,
  writeLibraryLocation, cloudSyncKind, updateMachinePointer, changeAssetLibraryLocation } from '../src/index.mjs';

test('置き場の再変更は location を書き、既存移行を使って素材を動かす', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio', 'song', 'song.wav'), 'music');
  assert.equal((await migrateAssetLibrary({ env: f.env })).state, 'done');
  const destination = path.join(f.temp, 'other-library');
  const progress = [];
  const result = await changeAssetLibraryLocation(destination, { env: f.env, onProgress: value => progress.push(value) });
  assert.equal(result.state, 'done');
  assert.equal(readLibraryLocation(f.env).root, destination);
  assert.equal(resolveAssetLibraryRoots(f.env).write, destination);
  assert.equal(await fs.readFile(path.join(destination, 'audio', 'song', 'song.wav'), 'utf8'), 'music');
  assert.ok(progress.length > 0);
});

test('同期フォルダ pending は旧置き場を使い、同意後に移る', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'still', 'photo', 'photo.png'), 'image');
  const destination = path.join(f.temp, 'OneDrive', 'library');
  const pending = await changeAssetLibraryLocation(destination, { env: f.env });
  assert.equal(pending.state, 'pending');
  assert.equal(resolveAssetLibraryRoots(f.env).write, f.old);
  assert.equal(await fs.readFile(path.join(f.old, 'still', 'photo', 'photo.png'), 'utf8'), 'image');
  const moved = await migrateAssetLibrary({ env: f.env, allowCloud: true });
  assert.equal(moved.state, 'done');
  assert.equal(resolveAssetLibraryRoots(f.env).write, destination);
});

test('今は移さないの後でも別の置き場を選べる', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'still', 'photo', 'photo.png'), 'image');
  await writeLibraryLocation({ root: path.join(f.temp, 'OneDrive', 'library'), state: 'declined' }, f.env);
  const destination = path.join(f.temp, 'local-library');
  assert.equal((await changeAssetLibraryLocation(destination, { env: f.env })).state, 'done');
  assert.equal(resolveAssetLibraryRoots(f.env).write, destination);
});

test('再変更が途中で止まっても旧置き場を読み、次回起動で続ける', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio', 'a', 'a.wav'), 'a');
  await put(path.join(f.old, 'still', 'b', 'b.png'), 'b');
  await migrateAssetLibrary({ env: f.env });
  const destination = path.join(f.temp, 'new-library');
  await put(path.join(destination, 'still', 'b', 'collision.png'), 'other');
  const first = await changeAssetLibraryLocation(destination, { env: f.env });
  assert.equal(first.state, 'migrating');
  assert.deepEqual(resolveAssetLibraryRoots(f.env).read, [destination, f.root, f.old]);
  assert.equal(await fs.readFile(path.join(f.root, 'still', 'b', 'b.png'), 'utf8'), 'b');
  await fs.rm(path.join(destination, 'still', 'b'), { recursive: true });
  assert.equal((await migrateAssetLibrary({ env: f.env, automatic: true })).state, 'done');
  assert.equal(await fs.readFile(path.join(destination, 'still', 'b', 'b.png'), 'utf8'), 'b');
  assert.equal(readLibraryLocation(f.env).previousRoot, undefined);
});

async function fixture(t, name = 'creator') {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-migration-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'), creator = path.join(temp, name);
  const env = { AKARI_HOME: home, AKARI_CREATOR_ROOT: creator };
  await createCreatorRoot(creator);
  return { temp, home, creator, env, old: path.join(home, 'assets'), root: path.join(creator, 'library') };
}
async function put(file, text = 'asset') { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
const exdev = async () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); };

test('resolution precedence, malformed/unknown location, declined and home/platform rules', async t => {
  const f = await fixture(t);
  assert.deepEqual(resolveAssetLibraryRoots(f.env), { write: f.old, read: [f.old], source: 'legacy' });
  for (const content of ['{', '{}', '{"version":99,"root":"/wrong","state":"done"}', '{"version":0,"root":"relative","state":"done"}']) {
    await put(path.join(f.home, 'library-location.json'), content);
    assert.equal(resolveAssetLibraryRoots(f.env).write, f.old);
  }
  await writeLibraryLocation({ root: f.root, state: 'migrating' }, f.env);
  assert.deepEqual(resolveAssetLibraryRoots(f.env), { write: f.root, read: [f.root, f.old], source: 'location' });
  const override = path.join(f.temp, 'custom');
  assert.deepEqual(resolveAssetLibraryRoots({ ...f.env, AKARI_LIBRARY_ROOT: override }).read, [override, f.old]);
  assert.deepEqual(resolveAssetLibraryRoots({ ...f.env, AKARI_LIBRARY_ROOT: f.old }).read, [f.old]);
  await writeLibraryLocation({ root: f.root, state: 'declined' }, f.env);
  assert.equal(resolveAssetLibraryRoots(f.env).write, f.old);
  assert.equal(resolveAssetLibraryRoots({ USERPROFILE: f.temp }, { platform: 'win32' }).write, path.join(f.temp, '.akari/assets'));
  assert.equal(resolveAssetLibraryRoots({ HOME: f.temp }).write, path.join(f.temp, '.akari/assets'));
});

test('same disk migrates ancillary files; repeated invocation and one shared notice', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio/theme/track.wav'), 'abc');
  await put(path.join(f.old, 'audio/declarations.json'), '{}');
  await put(path.join(f.old, 'audio/INDEX.md'), 'index');
  await put(path.join(f.old, 'store/pack/asset'), 'pack');
  await put(path.join(f.old, 'installed.json'), '{"packs":{}}');
  const notices = [];
  const first = await migrateAssetLibrary({ env: f.env, notify: s => notices.push(s) });
  assert.equal(first.state, 'done'); assert.equal(first.moved, 3); assert.equal(first.bytes, 26);
  assert.deepEqual(first.failures, []);
  assert.equal(await fs.readFile(path.join(f.root, 'audio/theme/track.wav'), 'utf8'), 'abc');
  assert.equal(existsSync(path.join(f.old, 'audio')), false);
  assert.ok(readLibraryLocation(f.env).migratedAt); assert.ok(readLibraryLocation(f.env).notifiedAt);
  assert.equal((await migrateAssetLibrary({ env: f.env, automatic: true, notify: s => notices.push(s) })).moved, 0);
  assert.equal((await migrateAssetLibrary({ env: f.env, notify: s => notices.push(s) })).moved, 0);
  assert.equal(notices.length, 1);
});

test('EXDEV verifies nested data and dangling symlink without following it', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio/theme/track.wav'), 'abc');
  await fs.symlink('missing', path.join(f.old, 'audio/dangling'));
  const result = await migrateAssetLibrary({ env: f.env, fsOps: { rename: exdev } });
  assert.equal(result.state, 'done'); assert.equal(result.bytes, 3);
  assert.equal(await fs.readFile(path.join(f.root, 'audio/theme/track.wav'), 'utf8'), 'abc');
  assert.equal(await fs.readlink(path.join(f.root, 'audio/dangling')), 'missing');
  assert.equal(existsSync(path.join(f.old, 'audio')), false);
});

test('EXDEV corrupt same-size copy retains original; resume completes', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio/theme/track.wav'), 'abc');
  const broken = await migrateAssetLibrary({ env: f.env, fsOps: { rename: exdev, cp: async (src, dest, options) => {
    await fs.cp(src, dest, options); await fs.writeFile(path.join(dest, 'theme/track.wav'), 'bad');
  } } });
  assert.equal(broken.state, 'migrating'); assert.match(broken.failures[0].message, /sha256/);
  assert.equal(await fs.readFile(path.join(f.old, 'audio/theme/track.wav'), 'utf8'), 'abc');
  assert.equal(existsSync(path.join(f.root, 'audio')), false);
  assert.equal((await migrateAssetLibrary({ env: f.env })).state, 'done');
});

test('interruption resumes with both roots visible, collisions never overwrite and late old CLI writes move', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'audio/theme/track.wav'), 'old');
  await put(path.join(f.old, 'still/card/frame.png'), 'image');
  let calls = 0;
  const interrupted = await migrateAssetLibrary({ env: f.env, fsOps: { rename: async (...args) => {
    if (++calls === 2) throw new Error('interrupted'); return fs.rename(...args);
  } } });
  assert.equal(interrupted.state, 'migrating'); assert.equal(interrupted.moved, 1);
  assert.ok(existsSync(path.join(f.root, 'audio/theme/track.wav')));
  assert.ok(existsSync(path.join(f.old, 'still/card/frame.png')));
  assert.equal((await migrateAssetLibrary({ env: f.env })).state, 'done');
  await put(path.join(f.old, 'audio/theme/track.wav'), 'conflict');
  await put(path.join(f.old, 'audio/new/track.wav'), 'late');
  const late = await migrateAssetLibrary({ env: f.env });
  assert.equal(late.moved, 1); assert.deepEqual(late.skipped, ['audio/theme']);
  assert.equal(await fs.readFile(path.join(f.root, 'audio/theme/track.wav'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(f.old, 'audio/theme/track.wav'), 'utf8'), 'conflict');
  assert.equal(await fs.readFile(path.join(f.root, 'audio/new/track.wav'), 'utf8'), 'late');
});

for (const crossDevice of [false, true]) test(`kit assets, skills and absolute indexes survive assets -> library (${crossDevice ? 'EXDEV' : 'rename'})`, async t => {
  const f = await fixture(t);
  const kit = path.join(f.old, 'store/kit/package');
  await put(path.join(kit, 'assets/still/card/frame.png'), 'kit');
  await put(path.join(kit, 'skills/hello/SKILL.md'), 'skill');
  await fs.mkdir(path.join(f.old, 'still'), { recursive: true });
  await fs.symlink('../../assets/store/kit/package/assets/still/card', path.join(f.old, 'still/card'));
  await put(path.join(f.old, 'installed.json'), JSON.stringify({ packs: { kit: { root: kit } } }));
  await put(path.join(f.home, 'kits/installed.json'), JSON.stringify({ kits: [{ kitDir: kit }] }));
  const skillLink = path.join(f.home, 'kits/plugin/skills/hello');
  await fs.mkdir(path.dirname(skillLink), { recursive: true });
  await fs.symlink(path.relative(path.dirname(skillLink), path.join(kit, 'skills/hello')), skillLink);
  const result = await migrateAssetLibrary({ env: f.env, fsOps: crossDevice ? { rename: exdev } : {} });
  assert.deepEqual(result.failures, []);
  assert.equal(await fs.readFile(path.join(f.root, 'still/card/frame.png'), 'utf8'), 'kit');
  assert.equal(await fs.readFile(path.join(skillLink, 'SKILL.md'), 'utf8'), 'skill');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'installed.json'))).packs.kit.root, path.join(f.root, 'store/kit/package'));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.home, 'kits/installed.json'))).kits[0].kitDir, path.join(f.root, 'store/kit/package'));
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(await fs.readdir(f.old), []);
  const second = await migrateAssetLibrary({ env: f.env });
  assert.equal(second.moved, 0);
  assert.deepEqual(second.skipped, []);
});

for (const [name, kind] of [['OneDrive', 'OneDrive'], ['Dropbox', 'Dropbox'], ['Mobile Documents', 'iCloud Drive'], ['CloudStorage/GoogleDrive-x', 'Google Drive']]) {
  test(`cloud ${name} remains pending with total bytes`, async t => {
    const f = await fixture(t, name + '/creator');
    await put(path.join(f.old, 'audio/theme/a.wav'), 'abc');
    const result = await migrateAssetLibrary({ env: f.env, automatic: true });
    assert.equal(result.state, 'pending'); assert.equal(result.cloud, kind); assert.equal(result.totalBytes, 3);
    assert.equal(result.moved, 0); assert.ok(existsSync(path.join(f.old, 'audio/theme/a.wav')));
    assert.equal(readLibraryLocation(f.env).state, 'pending');
    assert.deepEqual(resolveAssetLibraryRoots({ AKARI_HOME: f.home }), { write: f.old, read: [f.old], source: 'legacy' });
    assert.equal(cloudSyncKind(f.creator), kind);
  });
}

test('no creator does nothing; cwd does not select a creator; machine pointer pins location', async t => {
  const f = await fixture(t);
  const env = { AKARI_HOME: f.home };
  assert.equal((await migrateAssetLibrary({ env })).root, null);
  assert.equal(existsSync(f.home), false);
  await updateMachinePointer(f.creator, env);
  assert.equal((await migrateAssetLibrary({ env })).root, f.root);
  const second = path.join(f.temp, 'second'); await createCreatorRoot(second);
  assert.equal(resolveAssetLibraryRoots({ ...env, AKARI_CREATOR_ROOT: second }).write, f.root);
});

test('dry-run writes nothing; concurrent attempts are serialized', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'file'), 'hello');
  assert.equal((await migrateAssetLibrary({ env: f.env, dryRun: true })).totalBytes, 5);
  assert.equal(readLibraryLocation(f.env), null);
  let unblock, entered;
  const gate = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = migrateAssetLibrary({ env: f.env, fsOps: { rename: async (...args) => { entered(); await gate; return fs.rename(...args); } } });
  await started;
  assert.equal((await migrateAssetLibrary({ env: f.env })).busy, true);
  unblock(); assert.equal((await first).moved, 1);
  assert.equal((await migrateAssetLibrary({ env: f.env })).moved, 0);
});

test('kit alias resolves in one read root at every rename boundary, including EXDEV resume', async t => {
  const f = await fixture(t);
  const target = path.join(f.old,'store/kit/assets/still/card');
  await put(path.join(target,'frame.png'),'kit');
  await fs.mkdir(path.join(f.old,'still'),{recursive:true});
  await fs.symlink('../store/kit/assets/still/card',path.join(f.old,'still/card'));
  const visible = () => resolveAssetLibraryRoots(f.env).read.some(root => existsSync(path.join(root,'still/card/frame.png')));
  assert.equal(visible(),true);
  const result = await migrateAssetLibrary({ env:f.env, fsOps:{ rename:async (...args) => {
    assert.equal(visible(),true,'before rename');
    await fs.rename(...args);
    assert.equal(visible(),true,'after rename');
  } } });
  assert.deepEqual(result.failures,[]); assert.equal(visible(),true);
});

test('a dead migration owner is recovered and an explicit override still requires a creator', async t => {
  const f=await fixture(t);
  const { spawnSync }=await import('node:child_process');
  const child=spawnSync(process.execPath,['-e',''],{encoding:'utf8'});
  assert.equal(child.status,0);
  await put(path.join(f.home,'library-migration.lock'),String(child.pid));
  await put(path.join(f.old,'file'),'asset');
  assert.equal((await migrateAssetLibrary({env:f.env})).state,'done');
  assert.equal(existsSync(path.join(f.home,'library-migration.lock')),false);
  const env={AKARI_HOME:path.join(f.temp,'no-creator-home'),AKARI_LIBRARY_ROOT:path.join(f.temp,'custom')};
  assert.equal((await migrateAssetLibrary({env})).root,null);
  assert.equal(existsSync(env.AKARI_HOME),false);
});


test('equivalent kit aliases survive a failed store move and are removed on resume', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'store/kit/assets/still/card/frame.png'), 'kit');
  await fs.mkdir(path.join(f.old, 'still'), { recursive: true });
  const alias = path.join(f.old, 'still/card');
  await fs.symlink('../../assets/store/kit/assets/still/card', alias);
  const first = await migrateAssetLibrary({ env: f.env, fsOps: { rename: async (source, dest) => {
    if (path.basename(source) === 'store') throw new Error('interrupted store move');
    return fs.rename(source, dest);
  } } });
  assert.equal(first.state, 'migrating');
  assert.ok((await fs.lstat(alias)).isSymbolicLink());
  const resumed = await migrateAssetLibrary({ env: f.env });
  assert.equal(resumed.state, 'done');
  assert.deepEqual(resumed.skipped, []);
  assert.deepEqual(await fs.readdir(f.old), []);
  assert.equal(await fs.readFile(path.join(f.root, 'still/card/frame.png'), 'utf8'), 'kit');
  assert.deepEqual((await migrateAssetLibrary({ env: f.env })).skipped, []);
});

test('different kit alias targets remain real conflicts', async t => {
  const f = await fixture(t);
  await put(path.join(f.old, 'store/kit/assets/still/card/frame.png'), 'old');
  await put(path.join(f.root, 'store/other/frame.png'), 'new');
  await fs.mkdir(path.join(f.old, 'still'), { recursive: true });
  await fs.mkdir(path.join(f.root, 'still'), { recursive: true });
  await fs.symlink('../../assets/store/kit/assets/still/card', path.join(f.old, 'still/card'));
  await fs.symlink('../store/other', path.join(f.root, 'still/card'));
  const result = await migrateAssetLibrary({ env: f.env });
  assert.deepEqual(result.skipped, ['still/card']);
  assert.ok((await fs.lstat(path.join(f.old, 'still/card'))).isSymbolicLink());
  assert.equal(await fs.readFile(path.join(f.root, 'still/card/frame.png'), 'utf8'), 'new');
});

async function snapshot(root, dir = root) {
  const { createHash } = await import('node:crypto');
  const rows = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    const relative = path.relative(root, file);
    if (stat.isSymbolicLink()) rows.push([relative, 'link', await fs.readlink(file)]);
    else if (stat.isDirectory()) rows.push([relative, 'directory'], ...await snapshot(root, file));
    else rows.push([relative, 'file', createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
  }
  return rows;
}

for (const layout of ['same', 'legacy-link', 'root-link', 'nested-root', 'nested-legacy', 'linked-parent', 'missing-nested-root']) {
  for (const state of [null, 'migrating', 'done']) {
    test(`overlapping roots preserve state and all bytes twice: ${layout}, ${state}`, async t => {
      const f = await fixture(t);
      let root = f.root;
      if (layout === 'same') root = f.old;
      else if (layout === 'legacy-link') {
        await fs.mkdir(root, { recursive: true });
        await fs.mkdir(f.home, { recursive: true });
        await fs.symlink(root, f.old, 'dir');
      } else if (layout === 'root-link') {
        await fs.mkdir(f.old, { recursive: true });
        await fs.rmdir(root);
        await fs.symlink(f.old, root, 'dir');
      } else if (layout === 'nested-root') root = path.join(f.old, 'nested');
      else if (layout === 'nested-legacy') root = f.home;
      else if (layout === 'linked-parent' || layout === 'missing-nested-root') {
        await fs.mkdir(f.old, { recursive: true });
        const alias = path.join(f.temp, 'alias');
        await fs.symlink(f.old, alias, 'dir');
        root = path.join(alias, 'one/two');
      }
      await put(path.join(f.old, 'audio/theme/file'), 'preserve this');
      if (layout !== 'missing-nested-root') await fs.mkdir(root, { recursive: true });
      const env = { ...f.env, AKARI_LIBRARY_ROOT: root };
      if (state) await writeLibraryLocation({ root, state }, env);
      const before = await snapshot(f.temp);
      for (let i = 0; i < 2; i++) {
        const result = await migrateAssetLibrary({ env });
        assert.match(result.skippedReason, /same location|contain each other/);
        assert.equal(result.state, state);
        assert.equal(result.moved, 0);
        assert.deepEqual(result.failures, []);
        assert.deepEqual(await snapshot(f.temp), before);
      }
      if (['same', 'legacy-link', 'root-link'].includes(layout)) {
        assert.deepEqual(resolveAssetLibraryRoots(env).read, [root]);
      }
    });
  }
}

for (const kind of ['file', 'directory', 'category', 'external-alias', 'internal-alias']) {
  test(`same-realpath entry never deletes real data: ${kind}`, async t => {
    const f = await fixture(t);
    const relative = kind === 'category' ? 'audio' : 'audio/theme';
    const source = path.join(f.old, relative), dest = path.join(f.root, relative);
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    let payload;
    if (kind.endsWith('alias')) {
      payload = path.join(kind === 'internal-alias' ? f.root : f.temp, 'target/file');
      await put(payload, 'original');
      await fs.symlink(path.dirname(payload), source, 'dir');
      await fs.symlink(path.dirname(payload), dest, 'dir');
    } else {
      payload = kind === 'file' ? source : path.join(source, 'file');
      await put(payload, 'original');
      await fs.symlink(source, dest, kind === 'file' ? 'file' : 'dir');
    }
    for (let run = 0; run < 2; run++) {
      const result = await migrateAssetLibrary({ env: f.env });
      assert.deepEqual(result.failures, []);
      assert.equal(await fs.readFile(payload, 'utf8'), 'original');
      assert.equal(await fs.readFile(kind === 'file' ? dest : path.join(dest, 'file'), 'utf8'), 'original');
      if (kind === 'internal-alias') await assert.rejects(fs.lstat(source), { code: 'ENOENT' });
      else assert.ok(await fs.lstat(source));
    }
  });
}
