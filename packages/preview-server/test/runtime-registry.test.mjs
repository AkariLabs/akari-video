import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {runtimes,runtimeRoot,registryPath,browserManifest} from '../../overlay-runtime/runtimes.mjs';
import '../../overlay-runtime/test-harness/fixtures/dummy-entry.mjs';

// Exercise the actual early HTTP route block without starting the rest of the
// server (which also starts project watchers and requires built edit-store code).
const server = readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const begin=server.indexOf("  if (req.method === 'GET' && pathname === '/runtimes.json')");
const end=server.indexOf("  if (pathname === '/' ||",begin);
const route=vm.runInNewContext(`(function(req,res,pathname){${server.slice(begin,end)}})`,{
  runtimes,runtimeRoot,registryPath,browserManifest,path,MIME:{'.js':'text/javascript'},
  serveFile(res,file,mime){res.writeHead(200,{'Content-Type':mime});res.end(readFileSync(file,'utf8'));},
});
function get(url,method='GET') {
  // Unclaimed GET routes reach the server's ordinary static-file/404 fallback.
  const result=method === 'GET' ? {status:404} : {};
  route({method,headers:{}},{writeHead(status,headers){Object.assign(result,{status,headers});},end(body){result.body=body;}},url);
  return result;
}
test('GET /runtimes.json and its allowlisted script routes include a test-only third entry', () => {
  const response=get('/runtimes.json');
  assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');
  const manifest=JSON.parse(response.body);
  const entry=manifest.runtimes.find(entry=>entry.id==='dummy');assert.ok(entry);
  assert.equal(get(manifest.registry).body,readFileSync(registryPath,'utf8'));
  assert.match(get(entry.scripts[0].url).body,/window.akari.dummyRuntime/);
  for (const entry of manifest.runtimes) for (const script of entry.scripts) assert.equal(get(script.url).status,200);
  assert.equal(get('/__akari/runtimes/../../secret').status,404);
  assert.equal(get('/unknown-runtime.js').status,404);
  assert.equal(get('/../dummy-runtime.js').status,404);
  assert.equal(get('/nested/dummy-runtime.js').status,404);
  assert.equal(get('/dummy-runtime.js').status,200);
  assert.equal(get('/runtimes.json','POST').status,undefined);
});

test('browser script URLs preserve basenames and reject collisions across entries', () => {
  for (const [index, entry] of browserManifest().runtimes.entries()) {
    assert.deepEqual(entry.scripts.map(script => script.url), runtimes[index].scripts.map(script => '/' + path.basename(script.path)));
  }
  const count = runtimes.length;
  runtimes.push({id:'collision',declaration:{attr:'data-collision'},scripts:[{path:'another/vendor/three-bundle.js'}]});
  try {
    assert.throws(browserManifest, /Runtime script URL collision at \/three-bundle\.js: three:src\/vendor\/three-bundle\.js and collision:another\/vendor\/three-bundle\.js/);
    assert.throws(() => get('/runtimes.json'), /Runtime script URL collision/);
  } finally { runtimes.length = count; }
  assert.doesNotThrow(browserManifest);
});
