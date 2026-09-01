import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, evalOn, listTargets } from '../preview-writeback-v2/scripts/cdp-lib.mjs';

/** webview target の既定 context を先に試し、preview-stage を所有する context を返す。 */
export async function connectItemKeyframesPreview(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const targets = (await listTargets(port))
      .filter(target => target.type === 'iframe' || target.type === 'webview');
    for (const target of targets) {
      let cdp;
      try {
        cdp = new CDP(target.webSocketDebuggerUrl);
        await cdp.connect();
        const contexts = [];
        cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context));
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        const contextDeadline = Math.min(deadline, Date.now() + 2_000);
        while (Date.now() < contextDeadline) {
          for (const contextId of [undefined, ...contexts.map(context => context.id)]) {
            try {
              if (await evalOn(cdp, `Boolean(document.getElementById('preview-stage'))`, contextId)) {
                return { cdp, contextId };
              }
            } catch (error) {
              lastError = error;
            }
          }
          await sleep(100);
        }
      } catch (error) {
        lastError = error;
      }
      try { cdp?.close(); } catch {}
    }
    await sleep(250);
  }
  throw new Error(`preview content context not found${lastError ? `: ${lastError.message}` : ''}`);
}
