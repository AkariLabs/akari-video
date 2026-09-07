import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync, realpathSync, mkdtempSync, writeFileSync, rmSync, cpSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimes, readDeclarations, registryPath, browserManifest, validateRuntimeDeclarations} from '../runtimes.mjs';
import {renderOverlaySheet} from '../../render-cut/src/rasterize.mjs';
import {enumerateDeclaredRenderInputs, hashDeclaredRenderInputs} from '../../render-cut/src/render-inputs.mjs';
import {dummyEntry} from './fixtures/dummy-entry.mjs';
const registry = readFileSync(registryPath, 'utf8');
const html = '<div><script type="application/json" data-akari-dummy-scene>{"image":"image.png","color":"blue"}</script></div>';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'akari-registry-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  writeFileSync(join(root,'fragment.html'), html);
  writeFileSync(join(root,'image.png'), 'first image');
  const edit = {output:{width:32,height:32,fps:30},overlays:[{id:'d',html:'fragment.html',start:2,duration:3}]};
  writeFileSync(join(root,'edit.json'), JSON.stringify(edit));
  return {root,edit};
}
test('registry is idempotent, drains late registration and isolates list mutations', () => {
  const runtime = {id:'d',selector:'[d]',render(){},inspect(){},dispose(){}};
  const context = vm.createContext({window:{akari:{pendingRuntimes:[runtime]}}});
  vm.runInContext(registry, context);
  const api = context.window.akari.runtimes;
  vm.runInContext(registry, context);
  assert.equal(context.window.akari.runtimes, api);
  assert.equal(api.list().length, 1);
  api.list().pop(); assert.equal(api.list().length,1);
  api.register(runtime); assert.equal(api.list().length,1);
  assert.equal(api.forContainer({querySelector:selector => selector === '[d]'}).length,1);
  assert.throws(() => api.register({id:'bad'}));
  const overlay = readFileSync(new URL('../src/overlay-runtime.js',import.meta.url),'utf8');
  assert.ok(overlay.startsWith(registry), 'script-only host bootstrap must match canonical registry');
});
test('common declaration parser ignores comments and similar attribute names', () => {
  assert.equal(readDeclarations('<!--'+html+'-->',dummyEntry).length,0);
  assert.equal(readDeclarations(html.replace('dummy-scene','dummy-scene-other'),dummyEntry).length,0);
  assert.equal(readDeclarations(html.replace('type="application/json" data-akari-dummy-scene', "data-akari-dummy-scene type='application/json'"),dummyEntry).length,1);
});
test('third runtime raster injection and 2D baseline require no host edits', t => {
  const {root,edit} = fixture(t);
  const sheet = renderOverlaySheet({projectRoot:root,edit,duration:5,overlays:[{...edit.overlays[0],html,htmlPath:'fragment.html'}]});
  assert.match(sheet,/window.akari.dummyRuntime = entry/);
  assert.match(sheet,/data:image\/png;base64,Zmlyc3QgaW1hZ2U=/);
  assert.ok(sheet.indexOf('await window.__akariSeekVideos(seconds)') < sheet.indexOf('for (const [dummyContainer'));
  assert.ok(!sheet.includes('seconds % video.duration'));
  const baseline = renderOverlaySheet({overlays:[{id:'o1',html:'<div>Hello</div>',htmlPath:'pack/variants/press.html',start:2,duration:3}],edit:{output:{width:320,height:180,fps:30}},projectRoot:'/tmp/project',duration:5});
  assert.equal(createHash('sha256').update(baseline).digest('hex'),'397dddb4feb40ae417c671aa1d742eaf1b65e99ab41c05cb9bf5cbcfc388d7f3');
  assert.ok(browserManifest().runtimes.some(entry => entry.id === 'dummy'));
});
test('third runtime reference is bound and content-hashed by render-inputs', async t => {
  const {root,edit} = fixture(t);
  const inputs = await enumerateDeclaredRenderInputs({projectRoot:root,edit});
  const dependency = inputs.find(input => input.role === 'overlay:d:dummy-image');
  assert.equal(dependency.absolute_path,realpathSync(join(root,'image.png')));
  const before = await hashDeclaredRenderInputs([dependency]);
  writeFileSync(dependency.absolute_path,'second image');
  assert.notDeepEqual(await hashDeclaredRenderInputs([dependency]),before);
});
test('third runtime is validated through the unmodified asset CLI with test-only preload', t => {
  const {root} = fixture(t);
  const dir = join(root,'overlay/lower-third-clean');
  cpSync(new URL('../../schemas/test/fixtures/asset/valid-library/overlay/lower-third-clean',import.meta.url),dir,{recursive:true});
  writeFileSync(join(dir,'fragment.html'),html); writeFileSync(join(dir,'image.png'),'image');
  const args = ['--import',fileURLToPath(new URL('./fixtures/dummy-entry.mjs',import.meta.url)),fileURLToPath(new URL('../../schemas/bin/validate-asset.mjs',import.meta.url)),dir];
  let result = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  writeFileSync(join(dir,'fragment.html'),html.replace('blue','red'));
  result = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/dummy color must be blue/);
  writeFileSync(join(dir,'fragment.html'),html.replace('image.png','absent.png'));
  result = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/absent.png/);
});
test('ready polling handles loading, ready and error for any registered runtime', async t => {
  const sheet = renderOverlaySheet({projectRoot:'/tmp',edit:{output:{width:32,height:32,fps:30}},duration:1,overlays:[]});
  assert.doesNotMatch(sheet,/waitForDummyContainer/);
  const {root,edit} = fixture(t);
  const generated = renderOverlaySheet({projectRoot:root,edit,duration:5,overlays:[{...edit.overlays[0],html,htmlPath:'fragment.html'}]});
  const body = generated.slice(generated.indexOf('    async function waitForDummyContainer'),generated.indexOf('    window.__akariReady'));
  for (const end of ['ready','error','idle']) {
    const states = ['loading','loading',end], delays=[], errors=[];
    const context = vm.createContext({window:{akari:{dummyRuntime:{inspect:()=>({status:states.shift()})}}},setTimeout:(fn,ms)=>{delays.push(ms);fn();},console:{error:(...args)=>errors.push(args)}});
    vm.runInContext(body,context);
    await context.waitForDummyContainer({});
    assert.deepEqual(delays,[10,10]); assert.equal(errors.length,end === 'ready' ? 0 : 1);
  }
});

test('invalid requires metadata does not crash runtime validation', () => {
  assert.deepEqual(validateRuntimeDeclarations('<div/>', {
    meta:{requires:{}}, category:'overlay', name:'fragment.html', payloadFiles:[], validateReference(){},
  }), []);
});
