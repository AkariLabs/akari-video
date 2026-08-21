import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, listTargets, evalOn } from './cdp-lib.mjs';

export async function connectPreview(port, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const targets = (await listTargets(port)).filter(t => t.type === 'iframe' || t.type === 'webview');
    for (const t of targets) {
      let cdp;
      try {
        cdp = new CDP(t.webSocketDebuggerUrl);
        await cdp.connect();
        const contexts = [];
        cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await sleep(800);
        for (const c of contexts) {
          try {
            const ok = await evalOn(cdp, `!!document.getElementById('overlay-stage')`, c.id);
            if (ok) return { cdp, contextId: c.id };
          } catch { /* other frame */ }
        }
        cdp.close();
      } catch { try { cdp && cdp.close(); } catch { /* ignore */ } }
    }
    await sleep(1000);
  }
  throw new Error('preview content context not found');
}
export { evalOn, sleep, CDP, listTargets };

export async function connectMain(port, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    let cdp;
    try {
      const targets = await listTargets(port);
      const page = targets.find(t => t.type === 'page');
      if (!page) { await sleep(2000); continue; }
      cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.connect(8000);
      await cdp.send('Page.enable', {}, 8000);
      await cdp.send('Runtime.enable', {}, 8000);
      return cdp;
    } catch (error) {
      console.log('[connectMain-retry]', i, String(error && error.message).slice(0, 60));
      try { cdp && cdp.close(); } catch { /* ignore */ }
      await sleep(2000);
    }
  }
  throw new Error('main target not reachable');
}
