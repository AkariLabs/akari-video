import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
const script = source.split('const ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT = `')[1].split('`;')[0];

test('soft reload serializes only on identity change and preserves changes during remount', async () => {
  let serializations = 0;
  let mounts = 0;
  let releaseRemount;
  const stage = {children:[], append(...nodes) {this.children.push(...nodes);}};
  const runtime = {
    mount() {
      mounts++;
      if (mounts === 2) return new Promise(resolve => {releaseRemount = resolve;});
      return Promise.resolve();
    },
    tick() {},
  };
  const first = {overlays:[{id:'one',html:'<b>large</b>'}]};
  const state = {summary:first};
  const JSONSpy = {stringify(value) {serializations++; return JSON.stringify(value);}};
  vm.runInNewContext(script, {
    window:{akari:{runtime,state}}, document:{getElementById:()=>stage,querySelectorAll:()=>[]},
    JSON:JSONSpy, console,
  });
  await runtime.mount(first);
  assert.equal(serializations, 1);
  for (let i=0;i<100;i++) runtime.tick(i/30,true);
  assert.equal(serializations, 1, 'unchanged summary must skip serialization');
  assert.equal(mounts, 1);

  state.summary = {overlays:[{id:'one',html:'<b>large</b>'}]};
  runtime.tick(4,true);
  assert.equal(serializations, 2);
  assert.equal(mounts, 1, 'equal contents do not remount');

  state.summary = {overlays:[{id:'two'}]};
  runtime.tick(5,true);
  assert.equal(serializations, 3);
  assert.equal(mounts, 2);
  state.summary = {overlays:[{id:'three'}]};
  runtime.tick(6,true);
  assert.equal(serializations, 4);
  assert.equal(mounts, 2, 'in-flight mount is serialized');
  releaseRemount();
  await new Promise(resolve=>setImmediate(resolve));
  runtime.tick(7,true);
  assert.equal(mounts, 3, 'new identity during mount remounts on next tick');
  await new Promise(resolve=>setImmediate(resolve));
  for (let i=0;i<10;i++) runtime.tick(8+i/30,true);
  assert.equal(serializations, 4);
  assert.equal(mounts, 3);
  state.summary.overlays = [{id:'four'}];
  runtime.tick(9,true);
  assert.equal(serializations, 5, 'replacement overlays on the same summary are inspected');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mounts, 4);
});
