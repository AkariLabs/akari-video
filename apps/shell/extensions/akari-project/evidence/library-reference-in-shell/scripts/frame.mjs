// Evaluate an expression in every execution context of the preview webview iframe target (wrapper-written verification script).
const port = Number(process.env.CDP_PORT || 9431);
const expr = process.argv[2];
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = targets.find(x => x.type === 'iframe' && /akari-output-preview/.test(x.url));
if (!t) { console.log('no preview iframe'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const contexts = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.executionContextCreated') contexts.push(d.params.context); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);
await send('Runtime.enable'); await new Promise(r => setTimeout(r, 800));
const results = [];
for (const c of contexts) {
  const r = await send('Runtime.evaluate', { expression: expr, contextId: c.id, returnByValue: true, awaitPromise: true });
  results.push({ ctx: c.id, origin: c.origin, name: c.name, value: r.result?.result?.value, err: r.result?.exceptionDetails?.text });
}
console.log(JSON.stringify(results, null, 1)); ws.close(); process.exit(0);
