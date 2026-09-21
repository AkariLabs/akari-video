import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCreatorRoot, migrateAssetLibrary, writeLibraryLocation } from '../../creator-root/src/index.mjs';
import { runStoreCommand } from '../src/store-command.mjs';
import { loadInstalledItems } from '../../asset-resolver/src/installed.mjs';
import { linkKitAssets, registerKitAssets } from '../src/kits.mjs';
import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'launcher-library-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp,'home'), creator = path.join(temp,'creator'), root = path.join(creator,'library');
  const env = { ...process.env, AKARI_HOME: home, AKARI_CREATOR_ROOT: creator, AKARI_LIBRARY_ROOT: '' };
  await createCreatorRoot(creator);
  return { temp, home, creator, root, env };
}
async function put(file, value) { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,value); }
function zip(dir, target) { const result=spawnSync('zip',['-qr',target,'.'],{cwd:dir,encoding:'utf8'}); assert.equal(result.status,0,result.stderr); }

test('store install --from and kit links use pinned/env locations; index remains readable while migrating', async t => {
  const f = await fixture(t); await writeLibraryLocation({ root: f.root, state:'done' },f.env);
  const payload = path.join(f.temp,'payload'); const text = 'installed media';
  await put(path.join(payload,'assets/still/card/frame.txt'),text);
  await put(path.join(payload,'PACK.json'),JSON.stringify({ version:1, contents:[{
    id:'card',title:'Card',path:'assets/still/card',version:1,
    files:[{path:'frame.txt',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]
  }] }));
  const zipPath=path.join(f.temp,'pack.zip'); zip(payload,zipPath);
  const result=await runStoreCommand(['install','test-pack','--from',zipPath],{env:f.env,log:()=>{},fetchImpl:()=>assert.fail('offline')});
  assert.equal(result.exitCode,0);
  assert.ok(existsSync(path.join(f.root,'installed.json')));
  assert.equal((await loadInstalledItems(f.env))[0].files[0].local_path,path.join(f.root,'store/test-pack/assets/still/card/frame.txt'));
  assert.equal(existsSync(path.join(f.home,'assets')),false);
  const declarations = path.join(f.temp,'declarations'); await put(path.join(declarations,'declarations.json'),'{}');
  const declarationZip=path.join(f.temp,'declarations.zip'); zip(declarations,declarationZip);
  assert.equal((await runStoreCommand(['install','sounds-declaration-pack','--from',declarationZip],{env:f.env,log:()=>{}})).exitCode,0);
  assert.equal(await fs.readFile(path.join(f.root,'audio/declarations.json'),'utf8'),'{}');
  const kit=path.join(f.root,'store/kit'); await put(path.join(kit,'assets/still/kit-card/file.txt'),'kit');
  const manifest={id:'kit',version:1,assets:[{category:'still',id:'kit-card'}]};
  const links=linkKitAssets(kit,manifest,f.home,{env:f.env,validateAssetPath:'/absent-validator'});
  registerKitAssets(f.home,manifest,kit,links.items,f.env);
  assert.equal(await fs.readFile(path.join(f.root,'still/kit-card/file.txt'),'utf8'),'kit');
  // Simulate installed.json moving before store/: the reader finds old absolute pack roots.
  await fs.mkdir(path.join(f.home,'assets'),{recursive:true});
  await fs.rename(path.join(f.root,'store'),path.join(f.home,'assets/store'));
  await fs.mkdir(path.join(f.root,'store/test-pack/assets/still/card'),{recursive:true});
  assert.equal((await loadInstalledItems(f.env)).find(x=>x.id==='card').files[0].local_path,path.join(f.home,'assets/store/test-pack/assets/still/card/frame.txt'));
  assert.equal((await migrateAssetLibrary({env:f.env})).state,'done');
  const custom={...f.env,AKARI_LIBRARY_ROOT:path.join(f.temp,'custom')};
  assert.equal((await runStoreCommand(['install','test-pack','--from',zipPath],{env:custom,log:()=>{}})).exitCode,0);
  assert.ok(existsSync(path.join(custom.AKARI_LIBRARY_ROOT,'store/test-pack/PACK.json')));
});

test('launcher startup invokes shared migration and only announces once', async t => {
  const f=await fixture(t); await put(path.join(f.home,'assets/audio/theme/track.wav'),'sound');
  const project=path.join(f.temp,'project'); await fs.mkdir(project);
  const lines=[];
  const options={env:f.env,projectRoot:project,assets:resolveRepoAssets(path.resolve(import.meta.dirname,'../../..')),
    scaffold:async()=>({copy:{copiedFiles:[]},fallback:{writtenFiles:[]},git:{action:'skipped'}}),
    runDoctor:()=>{},resolveClaude:()=>'/fake/claude',spawnClaude:()=>({status:0}),
    checkUpdate:()=>null,refreshUpdate:()=>{},showAssetIntro:async()=>{},log:line=>lines.push(line)};
  assert.equal((await run(['--here'],options)).exitCode,0);
  assert.ok(existsSync(path.join(f.root,'audio/theme/track.wav')));
  assert.equal((await run(['--here'],options)).exitCode,0);
  assert.equal(lines.filter(line=>line.includes('素材の置き場を見える場所に移しました')).length,1);
});

test('pending store installs stay in the legacy library', async t => {
  const f = await fixture(t);
  const cloudRoot = path.join(f.temp, 'OneDrive/Akari/library');
  await writeLibraryLocation({ root: cloudRoot, state: 'pending' }, f.env);
  const payload = path.join(f.temp, 'declarations');
  await put(path.join(payload, 'declarations.json'), '{}');
  const zipPath = path.join(f.temp, 'declarations.zip');
  zip(payload, zipPath);
  const result = await runStoreCommand(['install', 'sounds-declaration-pack', '--from', zipPath], { env: f.env, log: () => {} });
  assert.equal(result.exitCode, 0);
  assert.equal(await fs.readFile(path.join(f.home, 'assets/audio/declarations.json'), 'utf8'), '{}');
  assert.equal(existsSync(cloudRoot), false);
});
